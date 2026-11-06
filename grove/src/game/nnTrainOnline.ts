/**
 * Outcome-based Neural training (not imitation).
 *
 * Learns from multi-horizon score feedback so it can surpass heuristics:
 *  - single-play differential (after the action resolves)
 *  - +3 turn differential
 *  - +5 turn differential
 *  - full-game margin vs the decision-time margin
 *
 * Train matches play Neural (with exploration) on every AI seat; Challenge is
 * only a sparring opponent when you leave some seats on heuristic strats and
 * use Watch — batch Train forces Neural learners.
 */
import { chooseAiAction, chooseAiPending, searchModeForStrat } from './ai.ts'
import { chooseAiPendingChallenge } from './aiChallenge.ts'
import { BalanceTracker, type MatchReport } from './balance.ts'
import { apply, createGame, type SeatSpec } from './engine.ts'
import { preferredFoe, scoreState } from './flow.ts'
import { getNnMemory, replaceNnMemory, saveNnMemory } from './nnMemory.ts'
import {
  chooseAiActionNeural,
  chooseAiPendingNeural,
  encodeActionFeatures,
  encodePendingChoiceFeatures,
  encodeStateFeatures,
  listNeuralCandidates,
  setActiveModel,
  trainPair,
} from './nnValue.ts'
import type { Action, Game, PlayerId } from './types.ts'

const LR = 0.002
const EXPLORE = 0.18
const AUTOSAVE_EVERY = 10

/** Reward mix — must sum to 1. */
const W_PLAY = 0.35
const W_TURN3 = 0.25
const W_TURN5 = 0.20
const W_GAME = 0.20

type TraceStep = {
  actor: PlayerId
  turnAt: number
  selfAt: number
  relAt: number
  stateFeats: Float64Array
  actionFeats: Float64Array
  alts: Float64Array[]
  /** Immediate play reward already applied. */
  playDone: boolean
  h3Done: boolean
  h5Done: boolean
}

function seatScores(game: Game, actor: PlayerId): { self: number; rel: number } {
  const self = scoreState(game, actor).total
  const foe = scoreState(game, preferredFoe(game, actor)).total
  return { self, rel: self - foe }
}

function softClip(x: number, scale = 6): number {
  // Bound influence of huge blowouts.
  return Math.tanh(x / scale) * scale
}

function reinforce(step: TraceStep, reward: number) {
  if (step.alts.length === 0) return 0
  const mag = Math.abs(reward)
  if (mag < 0.08) return 0
  const lr = LR * Math.min(2.5, 0.4 + mag / 4)
  const model = getNnMemory()
  setActiveModel(model)
  let n = 0
  for (const alt of step.alts) {
    if (reward > 0) trainPair(model, step.stateFeats, step.actionFeats, alt, lr)
    else trainPair(model, step.stateFeats, alt, step.actionFeats, lr)
    n += 1
  }
  model.trainedSamples += n
  replaceNnMemory(model)
  return n
}

function flushHorizons(steps: TraceStep[], game: Game, nowTurn: number) {
  for (const step of steps) {
    if (!step.h3Done && nowTurn >= step.turnAt + 3) {
      const { self, rel } = seatScores(game, step.actor)
      const dSelf = softClip(self - step.selfAt)
      const dRel = softClip(rel - step.relAt)
      reinforce(step, W_TURN3 * (dSelf + 0.6 * dRel))
      step.h3Done = true
    }
    if (!step.h5Done && nowTurn >= step.turnAt + 5) {
      const { self, rel } = seatScores(game, step.actor)
      const dSelf = softClip(self - step.selfAt)
      const dRel = softClip(rel - step.relAt)
      reinforce(step, W_TURN5 * (dSelf + 0.6 * dRel))
      step.h5Done = true
    }
  }
}

function flushGame(steps: TraceStep[], game: Game) {
  for (const step of steps) {
    // Catch unfinished mid-horizons with whatever board we have.
    if (!step.h3Done) {
      const { self, rel } = seatScores(game, step.actor)
      reinforce(step, W_TURN3 * softClip((self - step.selfAt) + 0.6 * (rel - step.relAt)))
      step.h3Done = true
    }
    if (!step.h5Done) {
      const { self, rel } = seatScores(game, step.actor)
      reinforce(step, W_TURN5 * softClip((self - step.selfAt) + 0.6 * (rel - step.relAt)))
      step.h5Done = true
    }
    const { self, rel } = seatScores(game, step.actor)
    const dSelf = softClip(self - step.selfAt)
    const dRel = softClip(rel - step.relAt)
    reinforce(step, W_GAME * (dSelf + 0.75 * dRel))
  }
}

function softFinish(game: Game): Game {
  const parts = game.players.map((p) => scoreState(game, p.id))
  return {
    ...game,
    over: { reason: 'halt', scores: parts.map((p) => p.total), parts },
    pending: null,
    veil: false,
    queue: [],
    echoes: [],
    after: null,
  }
}

function recordActionStep(
  steps: TraceStep[],
  before: Game,
  actor: PlayerId,
  action: Action,
): void {
  const { self, rel } = seatScores(before, actor)
  const stateFeats = encodeStateFeatures(before, actor)
  const actionFeats = encodeActionFeatures(before, actor, action)
  const alts = listNeuralCandidates(before, actor)
    .filter((other) => JSON.stringify(other) !== JSON.stringify(action))
    .slice(0, 6)
    .map((other) => encodeActionFeatures(before, actor, other))
  steps.push({
    actor,
    turnAt: before.turn,
    selfAt: self,
    relAt: rel,
    stateFeats,
    actionFeats,
    alts,
    playDone: false,
    h3Done: false,
    h5Done: false,
  })
}

function recordPendingStep(
  steps: TraceStep[],
  before: Game,
  actor: PlayerId,
  picked: string[],
  options: string[],
): void {
  const { self, rel } = seatScores(before, actor)
  const pickId = picked[0] ?? 'pass'
  const stateFeats = encodeStateFeatures(before, actor)
  const actionFeats = encodePendingChoiceFeatures(pickId)
  const alts = options
    .filter((id) => id !== pickId)
    .slice(0, 6)
    .map((id) => encodePendingChoiceFeatures(id))
  steps.push({
    actor,
    turnAt: before.turn,
    selfAt: self,
    relAt: rel,
    stateFeats,
    actionFeats,
    alts,
    playDone: false,
    h3Done: false,
    h5Done: false,
  })
}

function applyPlayReward(step: TraceStep, before: Game, after: Game) {
  if (step.playDone) return
  const b = seatScores(before, step.actor)
  const a = seatScores(after, step.actor)
  const dSelf = softClip(a.self - b.self)
  const dRel = softClip(a.rel - b.rel)
  reinforce(step, W_PLAY * (dSelf + 0.6 * dRel))
  step.playDone = true
}

/**
 * Train match: every AI seat plays Neural with exploration and learns from
 * multi-horizon score differentials (play / +3 turns / +5 turns / game).
 * Full balance tracking stays on.
 */
export function runMatchWithOptionalTrain(
  seed: number,
  seats: SeatSpec[],
  train: boolean,
): { game: Game; samples: number; report: MatchReport } {
  let game = createGame({ seed, seats })
  const tracker = new BalanceTracker(seed, { lite: false })
  tracker.start(game)
  const steps: TraceStep[] = []
  let samples = 0
  let guard = 0
  let lastTurn = game.turn

  while (!game.over && guard < 900) {
    guard += 1
    try {
      if (game.veil) {
        const before = game
        game = apply(game, { type: 'ready' })
        tracker.observe(before, { type: 'ready' }, game)
        continue
      }
      if (game.pending) {
        const actor = game.pending.actor
        const before = game
        const options = before.pending?.choices.map((c) => c.id) ?? []
        const ids = train
          ? chooseAiPendingNeural(before, { explore: EXPLORE })
          : (() => {
            const strat = before.players[actor]?.strat ?? 'balanced'
            const mode = searchModeForStrat(strat, false)
            return mode === 'neural'
              ? chooseAiPendingNeural(before)
              : mode === 'challenge'
                ? chooseAiPendingChallenge(before)
                : chooseAiPending(before)
          })()
        if (train) recordPendingStep(steps, before, actor, ids, options)
        game = apply(game, { type: 'choose', ids })
        tracker.observe(before, { type: 'choose', ids }, game)
        if (train && steps.length > 0) {
          const step = steps[steps.length - 1]!
          if (step.actor === actor && !step.playDone) applyPlayReward(step, before, game)
        }
        if (game.turn !== lastTurn) {
          flushHorizons(steps, game, game.turn)
          lastTurn = game.turn
        }
        continue
      }

      const actor = game.active
      const before = game
      // Train mode: everyone is a Neural learner. Otherwise honor seat strat.
      const action: Action = train
        ? chooseAiActionNeural(before, actor, before.players[actor]?.strat ?? 'balanced', { explore: EXPLORE })
        : chooseAiAction(before, searchModeForStrat(before.players[actor]?.strat ?? 'balanced', false))

      if (train) recordActionStep(steps, before, actor, action)
      game = apply(game, action)
      tracker.observe(before, action, game)

      if (train && steps.length > 0) {
        const step = steps[steps.length - 1]!
        if (step.actor === actor && !step.playDone) applyPlayReward(step, before, game)
      }
      if (game.turn !== lastTurn) {
        flushHorizons(steps, game, game.turn)
        lastTurn = game.turn
      }
    } catch {
      break
    }
  }

  if (!game.over) game = softFinish(game)
  if (train) {
    flushGame(steps, game)
    samples = steps.length
    const model = getNnMemory()
    model.trainedGames += 1
    model.note = `outcome-RL; games=${model.trainedGames}; horizons=play/3/5/game; ${new Date().toISOString()}`
    replaceNnMemory(model)
    if (model.trainedGames % AUTOSAVE_EVERY === 0) saveNnMemory()
  }

  return { game, samples, report: tracker.finish(game) }
}

/** Live Watch: immediate play-differential update for a Neural decision. */
export function learnFromImmediateOutcome(
  before: Game,
  after: Game,
  actor: PlayerId,
  action: Action,
): number {
  const model = getNnMemory()
  setActiveModel(model)
  const b = seatScores(before, actor)
  const a = seatScores(after, actor)
  const reward = W_PLAY * softClip((a.self - b.self) + 0.6 * (a.rel - b.rel))
  if (Math.abs(reward) < 0.08) return 0
  const stateFeats = encodeStateFeatures(before, actor)
  const actionFeats = encodeActionFeatures(before, actor, action)
  const alts = listNeuralCandidates(before, actor)
    .filter((other) => JSON.stringify(other) !== JSON.stringify(action))
    .slice(0, 6)
  const lr = LR * Math.min(2, 0.4 + Math.abs(reward) / 4)
  let n = 0
  for (const other of alts) {
    const alt = encodeActionFeatures(before, actor, other)
    if (reward > 0) trainPair(model, stateFeats, actionFeats, alt, lr)
    else trainPair(model, stateFeats, alt, actionFeats, lr)
    n += 1
  }
  model.trainedSamples += n
  replaceNnMemory(model)
  return n
}

/** @deprecated — imitation path removed; kept as alias for live Watch. */
export function learnFromTeacher(before: Game, actor: number, teacher: Action): number {
  // No after-state here; skip. Callers should use learnFromImmediateOutcome.
  void before
  void actor
  void teacher
  return 0
}
