import { chooseAiAction } from './ai.ts'
import { display } from './catalog.ts'
import { apply, createGame } from './engine.ts'
import { scoreState } from './flow.ts'
import type { Action, CardKind, Game } from './types.ts'

export type PlayKind = CardKind | 'combo' | 'draw' | 'morph' | 'move' | 'other'

export interface SwingEvent {
  seed: number
  turn: number
  actor: number
  defId: string
  name: string
  kind: PlayKind
  actorSwing: number
  relativeSwing: number
  fieldSwing: number
}

export interface RoundEvent {
  seed: number
  turn: number
  actor: number
  cardsPlayed: number
  pointsDelta: number
  endScore: number
}

export interface MatchReport {
  seed: number
  seats: number
  turns: number
  actions: number
  finalScores: number[]
  winner: number | null
  swings: SwingEvent[]
  rounds: RoundEvent[]
  over: boolean
}

export interface CardBalanceRow {
  defId: string
  name: string
  kind: PlayKind
  plays: number
  avgActorSwing: number
  avgRelativeSwing: number
  avgAbsSwing: number
  totalActorSwing: number
}

export interface BalanceSummary {
  matches: number
  finished: number
  seats: number
  avgTurns: number
  avgFinalSpread: number
  avgWinnerScore: number
  cards: CardBalanceRow[]
  contested: CardBalanceRow[]
  avgPtsByTurn: number[]
  avgCardsByTurn: number[]
  kindSwing: { kind: PlayKind; plays: number; avgActorSwing: number; avgRelativeSwing: number }[]
}

export class BalanceTracker {
  readonly seed: number
  private swings: SwingEvent[] = []
  private rounds: RoundEvent[] = []
  private actions = 0
  private turnActor = 0
  private turnNo = 1
  private turnCards = 0
  private turnStartScores: number[] = []
  private started = false

  constructor(seed: number) {
    this.seed = seed
  }

  start(game: Game) {
    this.started = true
    this.turnActor = game.active
    this.turnNo = game.turn
    this.turnCards = 0
    this.turnStartScores = totals(game)
  }

  observe(before: Game, action: Action, after: Game) {
    if (!this.started) this.start(before)
    this.actions += 1

    if (after.turn !== this.turnNo || after.active !== this.turnActor) {
      this.flushRound(before)
      this.turnActor = after.active
      this.turnNo = after.turn
      this.turnCards = 0
      this.turnStartScores = totals(after)
    }

    if (action.type === 'play') {
      const held = before.players[before.active]?.hand.find((card) => card.uid === action.uid)
      if (held) {
        this.turnCards += 1
        this.recordSwing(before, after, before.active, held.defId, held.kind)
      }
    } else if (action.type === 'combo') {
      this.turnCards += 1
      const ids = action.uids
        .map((uid) => before.players[before.active]?.hand.find((card) => card.uid === uid)?.defId)
        .filter((id): id is string => !!id)
      const mixed = new Set(ids).size > 1
      this.recordSwing(before, after, before.active, mixed ? 'mixed_path' : (ids[0] ?? 'setting'), 'combo')
    } else if (action.type === 'morph') {
      this.turnCards += 1
      const loc = before.players.flatMap((player) => player.teams.flatMap((team) => team.heroes)).find((hero) => hero.uid === action.uid)
      this.recordSwing(before, after, before.active, loc?.defId ?? 'morphling', 'morph')
    } else if (action.type === 'draw') {
      this.turnCards += 1
      this.recordSwing(before, after, before.active, 'draw', 'draw')
    } else if (action.type === 'move') {
      this.recordSwing(before, after, before.active, 'ember_spirit', 'move')
    }

    if (after.over) this.flushRound(after)
  }

  snapshot(game: Game): MatchReport {
    return this.report(game, !game.over)
  }

  finish(game: Game): MatchReport {
    if (!game.over) this.flushRound(game)
    return this.report(game, false)
  }

  private report(game: Game, includeOpenRound: boolean): MatchReport {
    const scores = totals(game)
    const best = Math.max(...scores, 0)
    const winners = scores.map((score, index) => (score === best ? index : -1)).filter((id) => id >= 0)
    const rounds = this.rounds.slice()
    if (includeOpenRound && this.started) {
      const start = this.turnStartScores[this.turnActor] ?? 0
      const end = scores[this.turnActor] ?? 0
      rounds.push({
        seed: this.seed,
        turn: this.turnNo,
        actor: this.turnActor,
        cardsPlayed: this.turnCards,
        pointsDelta: end - start,
        endScore: end,
      })
    }
    return {
      seed: this.seed,
      seats: game.players.length,
      turns: game.turn,
      actions: this.actions,
      finalScores: scores,
      winner: winners.length === 1 ? winners[0]! : null,
      swings: this.swings.slice(),
      rounds,
      over: !!game.over,
    }
  }

  private flushRound(game: Game) {
    if (!this.started) return
    const endScores = totals(game)
    const start = this.turnStartScores[this.turnActor] ?? 0
    const end = endScores[this.turnActor] ?? 0
    this.rounds.push({
      seed: this.seed,
      turn: this.turnNo,
      actor: this.turnActor,
      cardsPlayed: this.turnCards,
      pointsDelta: end - start,
      endScore: end,
    })
    this.turnCards = 0
    this.turnStartScores = endScores
  }

  private recordSwing(before: Game, after: Game, actor: number, defId: string, kind: PlayKind) {
    const beforeTotals = totals(before)
    const afterTotals = totals(after)
    const actorSwing = (afterTotals[actor] ?? 0) - (beforeTotals[actor] ?? 0)
    const oppBefore = mean(beforeTotals.filter((_, id) => id !== actor))
    const oppAfter = mean(afterTotals.filter((_, id) => id !== actor))
    const relativeSwing = actorSwing - (oppAfter - oppBefore)
    const fieldSwing = afterTotals.reduce((sum, score, id) => sum + Math.abs(score - (beforeTotals[id] ?? 0)), 0)
    const name = defId === 'draw' ? 'Draw' : defId === 'mixed_path' ? 'Mixed path' : display(defId).name
    const shownKind: PlayKind = kind === 'combo' ? 'combo' : kind
    this.swings.push({
      seed: this.seed,
      turn: before.turn,
      actor,
      defId,
      name,
      kind: shownKind,
      actorSwing,
      relativeSwing,
      fieldSwing,
    })
  }
}

export function summarizeReports(reports: MatchReport[]): BalanceSummary {
  const finished = reports.filter((report) => report.over)
  const cardMap = new Map<string, { defId: string; name: string; kind: PlayKind; plays: number; actor: number; relative: number; abs: number }>()
  const kindMap = new Map<PlayKind, { plays: number; actor: number; relative: number }>()
  const ptsByTurn: number[][] = []
  const cardsByTurn: number[][] = []

  for (const report of reports) {
    for (const swing of report.swings) {
      const key = `${swing.kind}:${swing.defId}`
      const row = cardMap.get(key) ?? { defId: swing.defId, name: swing.name, kind: swing.kind, plays: 0, actor: 0, relative: 0, abs: 0 }
      row.plays += 1
      row.actor += swing.actorSwing
      row.relative += swing.relativeSwing
      row.abs += Math.abs(swing.relativeSwing)
      cardMap.set(key, row)

      const kind = kindMap.get(swing.kind) ?? { plays: 0, actor: 0, relative: 0 }
      kind.plays += 1
      kind.actor += swing.actorSwing
      kind.relative += swing.relativeSwing
      kindMap.set(swing.kind, kind)
    }
    for (const round of report.rounds) {
      const index = Math.max(0, round.turn - 1)
      ;(ptsByTurn[index] ??= []).push(round.pointsDelta)
      ;(cardsByTurn[index] ??= []).push(round.cardsPlayed)
    }
  }

  const cards = [...cardMap.values()]
    .map((row) => ({
      defId: row.defId,
      name: row.name,
      kind: row.kind,
      plays: row.plays,
      avgActorSwing: row.actor / row.plays,
      avgRelativeSwing: row.relative / row.plays,
      avgAbsSwing: row.abs / row.plays,
      totalActorSwing: row.actor,
    }))
    .sort((a, b) => b.avgAbsSwing - a.avgAbsSwing || b.plays - a.plays)

  const contested = [...cards]
    .filter((row) => row.kind !== 'draw')
    .sort((a, b) => b.plays - a.plays || b.avgAbsSwing - a.avgAbsSwing)
    .slice(0, 16)

  const spreads = finished.map((report) => Math.max(...report.finalScores) - Math.min(...report.finalScores))
  const winnerScores = finished.map((report) => Math.max(...report.finalScores))

  return {
    matches: reports.length,
    finished: finished.length,
    seats: reports[0]?.seats ?? 0,
    avgTurns: average(finished.map((report) => report.turns)),
    avgFinalSpread: average(spreads),
    avgWinnerScore: average(winnerScores),
    cards: cards.slice(0, 24),
    contested,
    avgPtsByTurn: ptsByTurn.map((samples) => average(samples)),
    avgCardsByTurn: cardsByTurn.map((samples) => average(samples)),
    kindSwing: [...kindMap.entries()]
      .map(([kind, row]) => ({
        kind,
        plays: row.plays,
        avgActorSwing: row.actor / row.plays,
        avgRelativeSwing: row.relative / row.plays,
      }))
      .sort((a, b) => Math.abs(b.avgRelativeSwing) - Math.abs(a.avgRelativeSwing)),
  }
}

export function runMatchFast(seed: number, seats: number, guard = 4000): MatchReport {
  const roster = Array.from({ length: seats }, (_, index) => ({
    name: index === 0 ? 'AI 1' : index === 1 ? 'The Grove' : `AI ${index + 1}`,
    ai: true,
  }))
  let game = createGame({ seed, seats: roster })
  const tracker = new BalanceTracker(seed)
  tracker.start(game)
  let steps = 0
  let repeats = 0
  let last = ''
  while (!game.over && steps < guard) {
    steps += 1
    if (game.veil) {
      const before = game
      game = apply(game, { type: 'ready' })
      tracker.observe(before, { type: 'ready' }, game)
      continue
    }
    if (game.pending) {
      // Settle can exhaust its chain on rare prompts; clear so batch sims keep going.
      game = { ...game, pending: null, log: [...game.log, 'Forced past a stuck choice.'] }
      continue
    }
    const action = chooseAiAction(game)
    const before = game
    game = apply(game, action)
    tracker.observe(before, action, game)
    const marker = `${game.turn}:${game.active}:${game.log.at(-1)}:${game.deck.length}`
    if (marker === last) {
      repeats += 1
      if (repeats > 4) {
        if (game.pending) {
          game = { ...game, pending: null, log: [...game.log, 'Forced past a stuck choice.'] }
          repeats = 0
          continue
        }
        break
      }
    } else {
      repeats = 0
      last = marker
    }
  }
  return tracker.finish(game)
}

function totals(game: Game): number[] {
  return game.players.map((player) => scoreState(game, player.id).total)
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
