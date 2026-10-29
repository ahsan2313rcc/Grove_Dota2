import { chooseAiAction, cycleStrat, DEFAULT_STRAT } from './ai.ts'
import { display, HERO_BY_ID } from './catalog.ts'
import { apply, createGame, type SeatSpec } from './engine.ts'
import { scoreState, scoreTeam } from './flow.ts'
import { teamShape } from './scoring.ts'
import type { Action, AiStrat, Attr, CardInst, CardKind, Game } from './types.ts'

export type PlayKind = CardKind | 'combo' | 'draw' | 'morph' | 'move' | 'other'
export type RelBucket = 'hero' | 'setting' | 'loot' | 'other'

/** Empty `strats` means every personality. `mixOnly` keeps matches where seats use different strats. */
export type StratFilter = {
  strats: AiStrat[]
  mixOnly: boolean
}

export const ALL_STRAT_FILTER: StratFilter = { strats: [], mixOnly: false }

export function allowsStrat(filter: StratFilter, strat: AiStrat): boolean {
  return filter.strats.length === 0 || filter.strats.includes(strat)
}

export interface SwingEvent {
  seed: number
  turn: number
  actor: number
  actorStrat: AiStrat
  defId: string
  name: string
  kind: PlayKind
  bucket: RelBucket
  attr: Attr | null
  instant: boolean
  actorSwing: number
  relativeSwing: number
  fieldSwing: number
}

export interface RoundEvent {
  seed: number
  turn: number
  actor: number
  actorStrat: AiStrat
  cardsPlayed: number
  pointsDelta: number
  endScore: number
}

export interface EventCounts {
  drawDeck: number
  drawGrave: number
  discard: number
  exile: number
  destroy: number
  playHero: number
  playItem: number
  playInstant: number
  playSetting: number
  playRune: number
  playNeutral: number
  playTower: number
  playMorph: number
  playMove: number
  drawAction: number
}

export interface ShapeCounts {
  coreTeams: number
  mixTeams: number
  openTeams: number
  coreTeams3: number
  coreTeams4: number
  coreTeams5: number
  mixTeams3: number
  mixTeams4: number
  coreSettings: number
  mixSettings: number
  coreTeamPoints: number
  mixTeamPoints: number
  coreTeamPoints3: number
  coreTeamPoints4: number
  coreTeamPoints5: number
  mixTeamPoints3: number
  mixTeamPoints4: number
  coreSettingPoints: number
  mixSettingPoints: number
}

export interface MatchReport {
  seed: number
  seats: number
  seatStrats: AiStrat[]
  mixture: boolean
  turns: number
  actions: number
  finalScores: number[]
  winner: number | null
  winnerStrat: AiStrat | null
  swings: SwingEvent[]
  rounds: RoundEvent[]
  events: EventCounts
  seatEvents: EventCounts[]
  shapes: ShapeCounts
  seatShapes: ShapeCounts[]
  over: boolean
}

export interface CardBalanceRow {
  defId: string
  name: string
  kind: PlayKind
  bucket: RelBucket
  attr: Attr | null
  instant: boolean
  plays: number
  avgActorSwing: number
  avgRelativeSwing: number
  avgAbsSwing: number
  totalActorSwing: number
}

export interface StratBalanceRow {
  strat: AiStrat
  seats: number
  wins: number
  finishes: number
  avgScore: number
  avgSelfSwing: number
  avgRelSwing: number
  plays: number
}

export interface ShapeCompareRow {
  id:
    | 'core_team'
    | 'core_team_3'
    | 'core_team_4'
    | 'core_team_5'
    | 'mix_team'
    | 'mix_team_3'
    | 'mix_team_4'
    | 'core_setting'
    | 'mix_setting'
  label: string
  count: number
  avgCount: number
  totalPoints: number
  avgPoints: number
}

export interface EventStatRow {
  id: keyof EventCounts
  label: string
  total: number
  perMatch: number
}

export interface AttrStatRow {
  attr: Attr | 'none'
  plays: number
  avgActorSwing: number
  avgRelativeSwing: number
}

export interface BalanceSummary {
  matches: number
  finished: number
  seats: number
  filter: StratFilter
  avgTurns: number
  avgFinalSpread: number
  avgWinnerScore: number
  cards: CardBalanceRow[]
  cardsLow: CardBalanceRow[]
  heroHigh: CardBalanceRow[]
  heroLow: CardBalanceRow[]
  settingHigh: CardBalanceRow[]
  settingLow: CardBalanceRow[]
  lootHigh: CardBalanceRow[]
  lootLow: CardBalanceRow[]
  contested: CardBalanceRow[]
  avgPtsByTurn: number[]
  avgCardsByTurn: number[]
  turnLabels: number[]
  kindSwing: { kind: PlayKind; plays: number; avgActorSwing: number; avgRelativeSwing: number }[]
  byStrat: StratBalanceRow[]
  shapeCompare: ShapeCompareRow[]
  eventStats: EventStatRow[]
  byAttr: AttrStatRow[]
}

const EMPTY_EVENTS = (): EventCounts => ({
  drawDeck: 0,
  drawGrave: 0,
  discard: 0,
  exile: 0,
  destroy: 0,
  playHero: 0,
  playItem: 0,
  playInstant: 0,
  playSetting: 0,
  playRune: 0,
  playNeutral: 0,
  playTower: 0,
  playMorph: 0,
  playMove: 0,
  drawAction: 0,
})

const EMPTY_SHAPES = (): ShapeCounts => ({
  coreTeams: 0,
  mixTeams: 0,
  openTeams: 0,
  coreTeams3: 0,
  coreTeams4: 0,
  coreTeams5: 0,
  mixTeams3: 0,
  mixTeams4: 0,
  coreSettings: 0,
  mixSettings: 0,
  coreTeamPoints: 0,
  mixTeamPoints: 0,
  coreTeamPoints3: 0,
  coreTeamPoints4: 0,
  coreTeamPoints5: 0,
  mixTeamPoints3: 0,
  mixTeamPoints4: 0,
  coreSettingPoints: 0,
  mixSettingPoints: 0,
})

export class BalanceTracker {
  readonly seed: number
  private swings: SwingEvent[] = []
  private rounds: RoundEvent[] = []
  private events: EventCounts = EMPTY_EVENTS()
  private seatEvents: EventCounts[] = []
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
    this.seatEvents = game.players.map(() => EMPTY_EVENTS())
  }

  observe(before: Game, action: Action, after: Game) {
    if (!this.started) this.start(before)
    this.actions += 1
    const actor = before.active

    if (after.turn !== this.turnNo || after.active !== this.turnActor) {
      this.flushRound(before)
      this.turnActor = after.active
      this.turnNo = after.turn
      this.turnCards = 0
      this.turnStartScores = totals(after)
    }

    this.tallyEvents(before, after, actor)

    if (action.type === 'play') {
      const held = before.players[before.active]?.hand.find((card) => card.uid === action.uid)
      // Rejected plays (e.g. lone setting) leave the card in hand — do not pollute Rel tables.
      const resolved = held && !after.players[before.active]?.hand.some((card) => card.uid === action.uid)
      if (held && resolved) {
        this.turnCards += 1
        this.recordSwing(before, after, actor, held.defId, held.kind)
        this.tallyPlay(actor, held.kind, display(held.defId).instant)
      }
    } else if (action.type === 'combo') {
      this.turnCards += 1
      const ids = action.uids
        .map((uid) => before.players[before.active]?.hand.find((card) => card.uid === uid)?.defId)
        .filter((id): id is string => !!id)
      const mixed = new Set(ids).size > 1
      this.recordSwing(before, after, before.active, mixed ? 'mixed_path' : (ids[0] ?? 'setting'), 'combo')
      this.bumpEvent(before.active, 'playSetting')
    } else if (action.type === 'morph') {
      this.turnCards += 1
      const loc = before.players.flatMap((player) => player.teams.flatMap((team) => team.heroes)).find((hero) => hero.uid === action.uid)
      this.recordSwing(before, after, before.active, loc?.defId ?? 'morphling', 'morph')
      this.bumpEvent(before.active, 'playMorph')
    } else if (action.type === 'draw') {
      this.turnCards += 1
      this.recordSwing(before, after, before.active, 'draw', 'draw')
      this.bumpEvent(before.active, 'drawAction')
    } else if (action.type === 'move') {
      this.recordSwing(before, after, before.active, 'ember_spirit', 'move')
      this.bumpEvent(before.active, 'playMove')
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

  private bumpEvent(actor: number, key: keyof EventCounts, amount = 1) {
    this.events[key] += amount
    const seat = this.seatEvents[actor] ?? (this.seatEvents[actor] = EMPTY_EVENTS())
    seat[key] += amount
  }

  private tallyPlay(actor: number, kind: CardKind, instant: boolean) {
    if (kind === 'hero') this.bumpEvent(actor, 'playHero')
    if (kind === 'item') this.bumpEvent(actor, 'playItem')
    if (kind === 'rune') this.bumpEvent(actor, 'playRune')
    if (kind === 'neutral') this.bumpEvent(actor, 'playNeutral')
    if (kind === 'tower') this.bumpEvent(actor, 'playTower')
    if (instant) this.bumpEvent(actor, 'playInstant')
  }

  private tallyEvents(before: Game, after: Game, actor: number) {
    const beforeHand = cardMap(before.players[actor]?.hand ?? [])
    const afterHand = cardMap(after.players[actor]?.hand ?? [])
    const beforeGrave = cardMap(before.grave)
    const afterGrave = cardMap(after.grave)
    const beforeDeck = cardMap(before.deck)
    const beforeExile = cardMap(before.exile)
    const afterExile = cardMap(after.exile)
    const beforeBoard = boardMap(before)
    const afterBoard = boardMap(after)

    for (const [uid] of afterHand) {
      if (beforeHand.has(uid)) continue
      if (beforeDeck.has(uid)) this.bumpEvent(actor, 'drawDeck')
      else if (beforeGrave.has(uid)) this.bumpEvent(actor, 'drawGrave')
    }

    for (const [uid] of beforeHand) {
      if (afterHand.has(uid)) continue
      if (afterGrave.has(uid)) this.bumpEvent(actor, 'discard')
      if (afterExile.has(uid) && !beforeExile.has(uid)) this.bumpEvent(actor, 'exile')
    }

    for (const [uid] of beforeBoard) {
      if (afterBoard.has(uid)) continue
      if (afterGrave.has(uid)) this.bumpEvent(actor, 'destroy')
      if (afterExile.has(uid) && !beforeExile.has(uid)) this.bumpEvent(actor, 'exile')
    }

    for (const [uid] of afterExile) {
      if (beforeExile.has(uid)) continue
      if (beforeGrave.has(uid) && !afterGrave.has(uid)) this.bumpEvent(actor, 'exile')
    }
  }

  private report(game: Game, includeOpenRound: boolean): MatchReport {
    const scores = totals(game)
    const best = Math.max(...scores, 0)
    const winners = scores.map((score, index) => (score === best ? index : -1)).filter((id) => id >= 0)
    const seatStrats = game.players.map((player) => player.strat ?? DEFAULT_STRAT)
    const rounds = this.rounds.slice()
    if (includeOpenRound && this.started) {
      const start = this.turnStartScores[this.turnActor] ?? 0
      const end = scores[this.turnActor] ?? 0
      rounds.push({
        seed: this.seed,
        turn: this.turnNo,
        actor: this.turnActor,
        actorStrat: seatStrats[this.turnActor] ?? DEFAULT_STRAT,
        cardsPlayed: this.turnCards,
        pointsDelta: end - start,
        endScore: end,
      })
    }
    return {
      seed: this.seed,
      seats: game.players.length,
      seatStrats,
      mixture: new Set(seatStrats).size > 1,
      turns: game.turn,
      actions: this.actions,
      finalScores: scores,
      winner: winners.length === 1 ? winners[0]! : null,
      winnerStrat: winners.length === 1 ? (seatStrats[winners[0]!] ?? null) : null,
      swings: this.swings.slice(),
      rounds,
      events: { ...this.events },
      seatEvents: game.players.map((_, index) => ({ ...(this.seatEvents[index] ?? EMPTY_EVENTS()) })),
      shapes: shapeCounts(game),
      seatShapes: game.players.map((player) => shapeCountsFor(game, player.id)),
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
      actorStrat: game.players[this.turnActor]?.strat ?? DEFAULT_STRAT,
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
    const info = defId === 'draw' || defId === 'mixed_path' ? null : display(defId)
    const name = defId === 'draw' ? 'Draw' : defId === 'mixed_path' ? 'Mixed path' : (info?.name ?? defId)
    const shownKind: PlayKind = kind === 'combo' ? 'combo' : kind
    const bucket = relBucket(shownKind, defId)
    const attr = shownKind === 'hero' ? (HERO_BY_ID[defId]?.attr ?? info?.attr ?? null) : null
    const instant = !!info?.instant || (shownKind === 'hero' && HERO_BY_ID[defId]?.timing === 'instant')
    this.swings.push({
      seed: this.seed,
      turn: before.turn,
      actor,
      actorStrat: before.players[actor]?.strat ?? DEFAULT_STRAT,
      defId,
      name,
      kind: shownKind,
      bucket,
      attr,
      instant,
      actorSwing,
      relativeSwing,
      fieldSwing,
    })
  }
}

export function summarizeReports(reports: MatchReport[], filter: StratFilter = ALL_STRAT_FILTER): BalanceSummary {
  const scoped = reports.filter((report) => {
    if (filter.mixOnly && !report.mixture) return false
    if (filter.strats.length === 0) return true
    return filter.strats.some((strat) => report.seatStrats.includes(strat))
  })
  const finished = scoped.filter((report) => report.over)
  const cardMap = new Map<string, { defId: string; name: string; kind: PlayKind; bucket: RelBucket; attr: Attr | null; instant: boolean; plays: number; actor: number; relative: number; abs: number }>()
  const kindMap = new Map<PlayKind, { plays: number; actor: number; relative: number }>()
  const attrMap = new Map<Attr | 'none', { plays: number; actor: number; relative: number }>()
  const ptsByTurn = new Map<number, number[]>()
  const cardsByTurn = new Map<number, number[]>()
  const stratMap = new Map<AiStrat, { seats: number; wins: number; finishes: number; score: number; actor: number; relative: number; plays: number }>()
  const eventTotals = EMPTY_EVENTS()
  const shapeTotals = EMPTY_SHAPES()
  const filteringPlays = filter.strats.length > 0

  for (const report of scoped) {
    for (let seat = 0; seat < report.seatStrats.length; seat += 1) {
      const strat = report.seatStrats[seat]!
      if (!allowsStrat(filter, strat)) continue
      addEvents(eventTotals, report.seatEvents[seat] ?? EMPTY_EVENTS())
      addShapes(shapeTotals, report.seatShapes[seat] ?? EMPTY_SHAPES())
      const row = stratMap.get(strat) ?? { seats: 0, wins: 0, finishes: 0, score: 0, actor: 0, relative: 0, plays: 0 }
      row.seats += 1
      stratMap.set(strat, row)
    }
    if (report.over) {
      for (let index = 0; index < report.seatStrats.length; index += 1) {
        const strat = report.seatStrats[index]!
        if (!allowsStrat(filter, strat)) continue
        const row = stratMap.get(strat) ?? { seats: 0, wins: 0, finishes: 0, score: 0, actor: 0, relative: 0, plays: 0 }
        row.finishes += 1
        row.score += report.finalScores[index] ?? 0
        if (report.winner === index) row.wins += 1
        stratMap.set(strat, row)
      }
    }

    for (const swing of report.swings) {
      if (!allowsStrat(filter, swing.actorStrat)) continue
      const key = `${swing.kind}:${swing.defId}`
      const row = cardMap.get(key) ?? {
        defId: swing.defId,
        name: swing.name,
        kind: swing.kind,
        bucket: swing.bucket,
        attr: swing.attr,
        instant: swing.instant,
        plays: 0,
        actor: 0,
        relative: 0,
        abs: 0,
      }
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

      if (swing.bucket === 'hero') {
        const attrKey = swing.attr ?? 'none'
        const attrRow = attrMap.get(attrKey) ?? { plays: 0, actor: 0, relative: 0 }
        attrRow.plays += 1
        attrRow.actor += swing.actorSwing
        attrRow.relative += swing.relativeSwing
        attrMap.set(attrKey, attrRow)
      }

      const stratRow = stratMap.get(swing.actorStrat) ?? { seats: 0, wins: 0, finishes: 0, score: 0, actor: 0, relative: 0, plays: 0 }
      stratRow.plays += 1
      stratRow.actor += swing.actorSwing
      stratRow.relative += swing.relativeSwing
      stratMap.set(swing.actorStrat, stratRow)
    }
    for (const round of report.rounds) {
      if (!allowsStrat(filter, round.actorStrat)) continue
      const turn = Math.max(1, round.turn)
      const pts = ptsByTurn.get(turn) ?? []
      pts.push(round.pointsDelta)
      ptsByTurn.set(turn, pts)
      const cards = cardsByTurn.get(turn) ?? []
      cards.push(round.cardsPlayed)
      cardsByTurn.set(turn, cards)
    }
  }

  const cards = [...cardMap.values()].map((row) => ({
    defId: row.defId,
    name: row.name,
    kind: row.kind,
    bucket: row.bucket,
    attr: row.attr,
    instant: row.instant,
    plays: row.plays,
    avgActorSwing: row.actor / row.plays,
    avgRelativeSwing: row.relative / row.plays,
    avgAbsSwing: row.abs / row.plays,
    totalActorSwing: row.actor,
  }))

  const ranked = cards.filter((row) => row.kind !== 'draw' && row.plays >= 1)
  const heroRows = ranked.filter((row) => row.bucket === 'hero')
  const settingRows = ranked.filter((row) => row.bucket === 'setting')
  const lootRows = ranked.filter((row) => row.bucket === 'loot')

  const spreads = finished.map((report) => Math.max(...report.finalScores) - Math.min(...report.finalScores))
  const winnerScores = finished.map((report) => Math.max(...report.finalScores))
  const turnSeries = seriesFromTurnBuckets(ptsByTurn, cardsByTurn, filteringPlays)
  const matchCount = Math.max(1, scoped.length)

  return {
    matches: scoped.length,
    finished: finished.length,
    seats: scoped[0]?.seats ?? reports[0]?.seats ?? 0,
    filter,
    avgTurns: average(finished.map((report) => report.turns)),
    avgFinalSpread: average(spreads),
    avgWinnerScore: average(winnerScores),
    cards: rankHigh(ranked),
    cardsLow: rankLow(ranked),
    heroHigh: rankHigh(heroRows),
    heroLow: rankLow(heroRows),
    settingHigh: rankHigh(settingRows),
    settingLow: rankLow(settingRows),
    lootHigh: rankHigh(lootRows),
    lootLow: rankLow(lootRows),
    contested: [...ranked]
      .sort((a, b) => b.plays - a.plays || b.avgAbsSwing - a.avgAbsSwing)
      .slice(0, 16),
    avgPtsByTurn: turnSeries.pts,
    avgCardsByTurn: turnSeries.cards,
    turnLabels: turnSeries.labels,
    kindSwing: [...kindMap.entries()]
      .map(([kind, row]) => ({
        kind,
        plays: row.plays,
        avgActorSwing: row.actor / row.plays,
        avgRelativeSwing: row.relative / row.plays,
      }))
      .sort((a, b) => Math.abs(b.avgRelativeSwing) - Math.abs(a.avgRelativeSwing)),
    byStrat: [...stratMap.entries()]
      .map(([strat, row]) => ({
        strat,
        seats: row.seats,
        wins: row.wins,
        finishes: row.finishes,
        avgScore: row.finishes ? row.score / row.finishes : 0,
        avgSelfSwing: row.plays ? row.actor / row.plays : 0,
        avgRelSwing: row.plays ? row.relative / row.plays : 0,
        plays: row.plays,
      }))
      .sort((a, b) => b.wins - a.wins || b.avgScore - a.avgScore),
    shapeCompare: [
      shapeRow('core_team', 'Core team', shapeTotals.coreTeams, shapeTotals.coreTeamPoints, matchCount),
      shapeRow('core_team_3', 'Core team ×3', shapeTotals.coreTeams3, shapeTotals.coreTeamPoints3, matchCount),
      shapeRow('core_team_4', 'Core team ×4', shapeTotals.coreTeams4, shapeTotals.coreTeamPoints4, matchCount),
      shapeRow('core_team_5', 'Core team ×5', shapeTotals.coreTeams5, shapeTotals.coreTeamPoints5, matchCount),
      shapeRow('mix_team', 'Mixed team', shapeTotals.mixTeams, shapeTotals.mixTeamPoints, matchCount),
      shapeRow('mix_team_3', 'Mixed · 3 attrs', shapeTotals.mixTeams3, shapeTotals.mixTeamPoints3, matchCount),
      shapeRow('mix_team_4', 'Mixed · 4 attrs', shapeTotals.mixTeams4, shapeTotals.mixTeamPoints4, matchCount),
      shapeRow('core_setting', 'Core setting', shapeTotals.coreSettings, shapeTotals.coreSettingPoints, matchCount),
      shapeRow('mix_setting', 'Mixed setting', shapeTotals.mixSettings, shapeTotals.mixSettingPoints, matchCount),
    ],
    eventStats: [
      eventRow('drawDeck', 'Draw from deck', eventTotals.drawDeck, matchCount),
      eventRow('drawGrave', 'Draw from grave', eventTotals.drawGrave, matchCount),
      eventRow('drawAction', 'Draw actions', eventTotals.drawAction, matchCount),
      eventRow('discard', 'Discard', eventTotals.discard, matchCount),
      eventRow('destroy', 'Destroy', eventTotals.destroy, matchCount),
      eventRow('exile', 'Exile', eventTotals.exile, matchCount),
      eventRow('playHero', 'Hero plays', eventTotals.playHero, matchCount),
      eventRow('playItem', 'Item plays', eventTotals.playItem, matchCount),
      eventRow('playInstant', 'Instant plays', eventTotals.playInstant, matchCount),
      eventRow('playSetting', 'Setting combos', eventTotals.playSetting, matchCount),
      eventRow('playRune', 'Rune plays', eventTotals.playRune, matchCount),
      eventRow('playNeutral', 'Neutral plays', eventTotals.playNeutral, matchCount),
      eventRow('playTower', 'Tower plays', eventTotals.playTower, matchCount),
      eventRow('playMorph', 'Morph casts', eventTotals.playMorph, matchCount),
      eventRow('playMove', 'Ember moves', eventTotals.playMove, matchCount),
    ],
    byAttr: [...attrMap.entries()]
      .map(([attr, row]) => ({
        attr,
        plays: row.plays,
        avgActorSwing: row.actor / row.plays,
        avgRelativeSwing: row.relative / row.plays,
      }))
      .sort((a, b) => b.plays - a.plays || Math.abs(b.avgRelativeSwing) - Math.abs(a.avgRelativeSwing)),
  }
}

function rankHigh(rows: CardBalanceRow[]): CardBalanceRow[] {
  return [...rows].sort((a, b) => b.avgRelativeSwing - a.avgRelativeSwing || b.plays - a.plays).slice(0, 12)
}

function rankLow(rows: CardBalanceRow[]): CardBalanceRow[] {
  return [...rows].sort((a, b) => a.avgRelativeSwing - b.avgRelativeSwing || b.plays - a.plays).slice(0, 12)
}

function shapeRow(
  id: ShapeCompareRow['id'],
  label: string,
  count: number,
  points: number,
  matches: number,
): ShapeCompareRow {
  return {
    id,
    label,
    count,
    avgCount: count / matches,
    totalPoints: points,
    avgPoints: count ? points / count : 0,
  }
}

function eventRow(id: keyof EventCounts, label: string, total: number, matches: number): EventStatRow {
  return { id, label, total, perMatch: total / matches }
}

function seriesFromTurnBuckets(
  ptsByTurn: Map<number, number[]>,
  cardsByTurn: Map<number, number[]>,
  compact: boolean,
): { pts: number[]; cards: number[]; labels: number[] } {
  const turns = [...new Set([...ptsByTurn.keys(), ...cardsByTurn.keys()])].sort((a, b) => a - b)
  if (turns.length === 0) return { pts: [], cards: [], labels: [] }

  if (compact) {
    return {
      labels: turns,
      pts: turns.map((turn) => average(ptsByTurn.get(turn) ?? [])),
      cards: turns.map((turn) => average(cardsByTurn.get(turn) ?? [])),
    }
  }

  const max = turns[turns.length - 1]!
  const labels = Array.from({ length: max }, (_, index) => index + 1)
  return {
    labels,
    pts: labels.map((turn) => average(ptsByTurn.get(turn) ?? [])),
    cards: labels.map((turn) => average(cardsByTurn.get(turn) ?? [])),
  }
}

export function aiRoster(count: number, strats?: AiStrat[], offset = 0): SeatSpec[] {
  return Array.from({ length: count }, (_, index) => {
    const strat = strats && strats.length > 0 ? strats[index % strats.length]! : cycleStrat(index + offset)
    return {
      name: `${strat[0]!.toUpperCase()}${strat.slice(1)} ${index + 1}`,
      ai: true,
      strat,
    }
  })
}

export function runMatchFast(seed: number, seats: number, strats?: AiStrat[], guard = 4000): MatchReport {
  let game = createGame({ seed, seats: aiRoster(seats, strats, seed) })
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

function relBucket(kind: PlayKind, defId: string): RelBucket {
  if (kind === 'hero' || kind === 'morph') return 'hero'
  if (kind === 'combo' || kind === 'setting' || defId === 'mixed_path' || defId === 'river' || defId === 'jungle' || defId === 'lane') return 'setting'
  if (kind === 'item' || kind === 'rune' || kind === 'neutral' || kind === 'tower') return 'loot'
  return 'other'
}

function mixAttrCount(why: string): number {
  if (why.startsWith('Four attributes')) return 4
  if (why.startsWith('Three attributes')) return 3
  if (why.startsWith('Two attributes')) return 2
  return 0
}

function shapeCounts(game: Game): ShapeCounts {
  const shapes = EMPTY_SHAPES()
  for (const player of game.players) addShapes(shapes, shapeCountsFor(game, player.id))
  return shapes
}

function shapeCountsFor(game: Game, playerId: number): ShapeCounts {
  const shapes = EMPTY_SHAPES()
  const player = game.players[playerId]
  if (!player) return shapes
  for (const team of player.teams) {
    const scored = scoreTeam(game, team)
    const shape = teamShape(scored.why)
    // Core tiers are by hero count; mix tiers are by attribute count (+2 / +4).
    const size = team.heroes.reduce((sum, hero) => sum + (hero.defId === 'meepo' ? 2 : 1), 0)
    const mixAttrs = mixAttrCount(scored.why)
    if (shape === 'core') {
      shapes.coreTeams += 1
      shapes.coreTeamPoints += scored.points
      if (size === 3) {
        shapes.coreTeams3 += 1
        shapes.coreTeamPoints3 += scored.points
      } else if (size === 4) {
        shapes.coreTeams4 += 1
        shapes.coreTeamPoints4 += scored.points
      } else if (size >= 5) {
        shapes.coreTeams5 += 1
        shapes.coreTeamPoints5 += scored.points
      }
    } else if (shape === 'mix') {
      shapes.mixTeams += 1
      shapes.mixTeamPoints += scored.points
      if (mixAttrs === 3) {
        shapes.mixTeams3 += 1
        shapes.mixTeamPoints3 += scored.points
      } else if (mixAttrs >= 4) {
        shapes.mixTeams4 += 1
        shapes.mixTeamPoints4 += scored.points
      }
    } else {
      shapes.openTeams += 1
    }
  }
  for (const combo of player.combos) {
    if (combo.kind === 'mixed') {
      shapes.mixSettings += 1
      shapes.mixSettingPoints += combo.points
    } else {
      shapes.coreSettings += 1
      shapes.coreSettingPoints += combo.points
    }
  }
  return shapes
}

function cardMap(cards: CardInst[]): Map<string, CardInst> {
  return new Map(cards.map((card) => [card.uid, card]))
}

function boardMap(game: Game): Map<string, string> {
  const map = new Map<string, string>()
  for (const player of game.players) {
    for (const team of player.teams) {
      for (const hero of team.heroes) map.set(hero.uid, hero.defId)
    }
  }
  return map
}

function addEvents(target: EventCounts, source: EventCounts) {
  for (const key of Object.keys(target) as (keyof EventCounts)[]) target[key] += source[key]
}

function addShapes(target: ShapeCounts, source: ShapeCounts) {
  for (const key of Object.keys(target) as (keyof ShapeCounts)[]) target[key] += source[key]
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
