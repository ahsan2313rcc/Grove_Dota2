/**
 * Outcome training for the Neural value net from AI-vs-AI games.
 *
 * Every seat's top-level decisions are recorded — heuristic seats included — so the
 * net learns from whatever is being played, not just its own games. When the game
 * ends each recorded state gets a target in rel points (seat score − best opponent):
 *
 *   T = 0.10·rel(now) + 0.15·rel(+1 turn) + 0.20·rel(+3) + 0.20·rel(+5)
 *     + 0.15·rel(+10) + 0.20·placement·12
 *
 * rel(now) carries the play's own effect; the later horizons catch auras, traps,
 * engines and discard paying off; placement (+1 winner … −1 last) ties it to winning.
 * Horizons past the end of the game use the final scores.
 *
 * Training: the new game's samples plus an equal draw from a replay buffer of recent
 * games, a few Adam passes. Seats keep their own strat while training; only Neural
 * seats explore.
 */
import { chooseAiAction, chooseAiPendingForSeat, searchModeForStrat } from './ai.ts'
import { BalanceTracker, type MatchReport } from './balance.ts'
import { apply, createGame, type SeatSpec } from './engine.ts'
import { scoreState } from './flow.ts'
import { getNnMemory, saveNnMemory } from './nnMemory.ts'
import {
  chooseAiActionNeural,
  chooseAiPendingNeural,
  encodeFeatures,
  loadModel,
  NN_SCALE,
  relOf,
  trainBatch,
  type NnFeatures,
} from './nnValue.ts'
import type { Action, Game, PlayerId } from './types.ts'

export const HORIZON_WEIGHTS = { now: 0.1, t1: 0.15, t3: 0.2, t5: 0.2, t10: 0.15, place: 0.2 } as const
/** Rel points a 1st-vs-last placement is worth in the target. */
export const PLACEMENT_POINTS = 12
export const TRAIN_EXPLORE = 0.12
const AUTOSAVE_EVERY = 10
const REPLAY_CAP = 40_000
const BATCH = 64
const EPOCHS = 2
const LR = 0.0015

type Pending = { seat: PlayerId; turn: number; relNow: number; f: NnFeatures }
type Sample = { f: NnFeatures; y: number }

const replay: Sample[] = []
let replayCursor = 0

export function replaySize(): number {
  return replay.length
}

export function clearReplay() {
  replay.length = 0
  replayCursor = 0
}

function pushReplay(sample: Sample) {
  if (replay.length < REPLAY_CAP) replay.push(sample)
  else {
    replay[replayCursor] = sample
    replayCursor = (replayCursor + 1) % REPLAY_CAP
  }
}

function totals(game: Game): number[] {
  return game.players.map((player) => scoreState(game, player.id).total)
}

/** +1 for first … −1 for last; tied seats share the average of their slots. */
export function placementOf(scores: number[], seat: PlayerId): number {
  const n = scores.length
  if (n < 2) return 0
  const mine = scores[seat] ?? 0
  const above = scores.filter((score) => score > mine).length
  const tied = scores.filter((score) => score === mine).length - 1
  const rank = above + tied / 2
  return 1 - (2 * rank) / (n - 1)
}

/**
 * Records decision states during a match and turns them into training targets at
 * the end. Use one per match; call `observe` after every applied top-level step.
 */
export class NnGameRecorder {
  private states: Pending[] = []
  /** Scores at the start of each game turn (index = game.turn). */
  private turnScores = new Map<number, number[]>()
  private lastTurn = -1
  private lastKey = ''
  private done = false

  observe(after: Game, actor: PlayerId) {
    // React StrictMode replays state updaters; the same step must not count twice.
    const key = `${after.turn}|${after.active}|${after.log.length}|${after.deck.length}|${after.pending?.prompt ?? ''}|${actor}`
    if (key === this.lastKey || this.done) return
    this.lastKey = key
    const newTurn = after.turn !== this.lastTurn
    if (newTurn) {
      this.turnScores.set(after.turn, totals(after))
      this.lastTurn = after.turn
    }
    if (after.over) return
    const net = loadModel(getNnMemory())
    const scores = totals(after)
    for (const player of after.players) {
      // The deciding seat every step; every other seat once per turn, from its own seat.
      if (player.id !== actor && !newTurn) continue
      this.states.push({
        seat: player.id,
        turn: after.turn,
        relNow: relOf(scores, player.id),
        f: encodeFeatures(after, player.id, net),
      })
    }
  }

  get size(): number {
    return this.states.length
  }

  private relAt(turn: number, seat: PlayerId, final: number[]): number {
    const scores = this.turnScores.get(turn) ?? final
    return relOf(scores, seat)
  }

  targets(final: Game): Sample[] {
    const scores = final.over?.scores ?? totals(final)
    const w = HORIZON_WEIGHTS
    return this.states.map((entry) => {
      const t = entry.turn
      const y =
        w.now * entry.relNow
        + w.t1 * this.relAt(t + 1, entry.seat, scores)
        + w.t3 * this.relAt(t + 3, entry.seat, scores)
        + w.t5 * this.relAt(t + 5, entry.seat, scores)
        + w.t10 * this.relAt(t + 10, entry.seat, scores)
        + w.place * placementOf(scores, entry.seat) * PLACEMENT_POINTS
      return { f: entry.f, y: y / NN_SCALE }
    })
  }

  /** Train on this game + replay; returns samples learned from this game. */
  finish(final: Game): number {
    if (this.done) return 0
    this.done = true
    const fresh = this.targets(final)
    if (fresh.length === 0) return 0
    const model = getNnMemory()
    const pool: Sample[] = [...fresh]
    for (let k = 0; k < fresh.length && replay.length > 0; k += 1) {
      pool.push(replay[Math.floor(Math.random() * replay.length)]!)
    }
    for (let epoch = 0; epoch < EPOCHS; epoch += 1) {
      shuffleInPlace(pool)
      for (let start = 0; start < pool.length; start += BATCH) {
        trainBatch(model, pool.slice(start, start + BATCH), LR)
      }
    }
    for (const sample of fresh) pushReplay(sample)
    model.trainedGames += 1
    model.note = `outcome regression · horizons now/+1/+3/+5/+10/placement · ${model.trainedGames} games`
    if (model.trainedGames % AUTOSAVE_EVERY === 0) saveNnMemory()
    this.states = []
    return fresh.length
  }
}

function shuffleInPlace<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = list[i]!
    list[i] = list[j]!
    list[j] = tmp
  }
}

function softFinish(game: Game, reason = 'Match halted (soft-lock).'): Game {
  const parts = game.players.map((p) => scoreState(game, p.id))
  return {
    ...game,
    over: { reason, scores: parts.map((p) => p.total), parts },
    pending: null,
    veil: false,
    queue: [],
    echoes: [],
    laterCasts: [],
    after: null,
  }
}

function mark(game: Game): string {
  return `${game.turn}|${game.active}|${game.deck.length}|${game.pending?.prompt ?? ''}|${game.log.at(-1) ?? ''}`
}

export type TrainRunOptions = {
  train: boolean
  /** Heuristic seats use the batch-fast brain (≈50× quicker, weaker play). */
  fast?: boolean
}

/**
 * Plays one AI-vs-AI match with every seat on its own strat, tracked for Stats.
 * With `train`, all seats' decisions feed the Neural net at the end.
 */
export function runMatchWithOptionalTrain(
  seed: number,
  seats: SeatSpec[],
  train: boolean | TrainRunOptions,
): { game: Game; samples: number; report: MatchReport } {
  const opts: TrainRunOptions = typeof train === 'boolean' ? { train } : train
  let game = createGame({ seed, seats })
  const tracker = new BalanceTracker(seed, { lite: false })
  tracker.start(game)
  const recorder = opts.train ? new NnGameRecorder() : null
  let guard = 0
  let stall = 0
  let lastMark = mark(game)

  while (!game.over && guard < 1500) {
    guard += 1
    const beforeMark = lastMark
    try {
      if (game.veil) {
        const before = game
        game = apply(game, { type: 'ready' })
        tracker.observe(before, { type: 'ready' }, game)
      } else if (game.pending) {
        const actor = game.pending.actor
        const before = game
        const strat = before.players[actor]?.strat ?? 'balanced'
        const ids = strat === 'neural'
          ? chooseAiPendingNeural(before, recorder ? { explore: TRAIN_EXPLORE } : {})
          : chooseAiPendingForSeat(before)
        game = apply(game, { type: 'choose', ids })
        tracker.observe(before, { type: 'choose', ids }, game)
        recorder?.observe(game, actor)
        if (game.pending && game.pending.prompt === before.pending?.prompt && stall >= 2) {
          game = { ...game, pending: null, log: [...game.log, 'Forced past a stuck choice.'] }
        }
      } else {
        const actor = game.active
        const before = game
        const strat = before.players[actor]?.strat ?? 'balanced'
        let action: Action = strat === 'neural'
          ? chooseAiActionNeural(before, actor, strat, { explore: recorder ? TRAIN_EXPLORE : 0, fast: !!opts.fast })
          : chooseAiAction(before, searchModeForStrat(strat, !!opts.fast))
        if (stall >= 3 && (before.players[actor]?.actions ?? 0) > 0) {
          const hand = before.players[actor]?.hand ?? []
          const pitch = hand.find((c) => c.kind === 'terrain') ?? hand[0]
          if (pitch) action = { type: 'discard', uid: pitch.uid }
        } else if (stall >= 5) {
          action = { type: 'end' }
        }
        game = apply(game, action)
        tracker.observe(before, action, game)
        recorder?.observe(game, actor)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'sim error'
      game = softFinish(game, `Match halted (${reason}).`)
      break
    }
    const afterMark = mark(game)
    stall = afterMark === beforeMark ? stall + 1 : 0
    lastMark = afterMark
    if (stall >= 12) {
      game = softFinish(game, 'Match halted (soft-lock).')
      break
    }
  }

  if (!game.over) game = softFinish(game, guard >= 1500 ? 'Match halted (step cap).' : 'Match halted (soft-lock).')
  const samples = recorder ? recorder.finish(game) : 0
  return { game, samples, report: tracker.finish(game) }
}
