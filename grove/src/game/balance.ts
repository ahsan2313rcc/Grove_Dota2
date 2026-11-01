import { chooseAiAction, chooseAiPending, cycleStrat, DEFAULT_STRAT } from './ai.ts'
import { display, HERO_BY_ID } from './catalog.ts'
import { apply, createGame, type SeatSpec } from './engine.ts'
import { attrsOf, findHand, heroWeight, isTrapHero, scoreState, scoreTeam, standingOf } from './flow.ts'
import { teamShape } from './scoring.ts'
import type { Action, AiStrat, Attr, CardInst, CardKind, Game, Team } from './types.ts'

export type PlayKind = CardKind | 'combo' | 'draw' | 'morph' | 'move' | 'other'
export type RelBucket = 'hero' | 'terrain' | 'loot' | 'other'

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
  playTerrain: number
  playRune: number
  playNeutral: number
  playTower: number
  playTrap: number
  immune: number
  drawAction: number
}

export interface ShapeCounts {
  coreTeams: number
  mixTeams: number
  openTeams: number
  /** Teams with a same-attr stack of exactly 3 / 4 / 5+ (counts mixed boards too). */
  coreTeams3: number
  coreTeams4: number
  coreTeams5: number
  mixTeams3: number
  mixTeams4: number
  /** Pure mono teams with exact hero count 3 / 4 / 5+. */
  pureCore3: number
  pureCore4: number
  pureCore5: number
  /** Mixed teams with 3 / 4 attrs and exactly that many heroes. */
  pureMix3: number
  pureMix4: number
  coreTerrains: number
  mixTerrains: number
  coreTeamPoints: number
  mixTeamPoints: number
  coreTeamPoints3: number
  coreTeamPoints4: number
  coreTeamPoints5: number
  mixTeamPoints3: number
  mixTeamPoints4: number
  coreTeamHeroes: number
  mixTeamHeroes: number
  coreTeamHeroes3: number
  coreTeamHeroes4: number
  coreTeamHeroes5: number
  mixTeamHeroes3: number
  mixTeamHeroes4: number
  coreTerrainPoints: number
  mixTerrainPoints: number
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
  /** Unique card defIds each seat resolved (for presence / win-rate). */
  seatPlays: string[][]
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
  /** Matches where a filtered seat played this card at least once. */
  presence: number
  /** Wins among those presence matches. */
  wins: number
  winRate: number
}

export interface StratBalanceRow {
  strat: AiStrat
  seats: number
  wins: number
  finishes: number
  avgScore: number
  avgStanding: number
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
    | 'core_terrain'
    | 'mix_terrain'
  label: string
  count: number
  avgCount: number
  totalPoints: number
  avgPoints: number
  /** Pure exact-size instances (mono core, or mix attrs with matching hero count). */
  pureCount: number
  /** Average points per hero/card in the counted set. */
  avgPtsPerCard: number
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
  terrainHigh: CardBalanceRow[]
  terrainLow: CardBalanceRow[]
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
  playTerrain: 0,
  playRune: 0,
  playNeutral: 0,
  playTower: 0,
  playTrap: 0,
  immune: 0,
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
  pureCore3: 0,
  pureCore4: 0,
  pureCore5: 0,
  pureMix3: 0,
  pureMix4: 0,
  coreTerrains: 0,
  mixTerrains: 0,
  coreTeamPoints: 0,
  mixTeamPoints: 0,
  coreTeamPoints3: 0,
  coreTeamPoints4: 0,
  coreTeamPoints5: 0,
  mixTeamPoints3: 0,
  mixTeamPoints4: 0,
  coreTeamHeroes: 0,
  mixTeamHeroes: 0,
  coreTeamHeroes3: 0,
  coreTeamHeroes4: 0,
  coreTeamHeroes5: 0,
  mixTeamHeroes3: 0,
  mixTeamHeroes4: 0,
  coreTerrainPoints: 0,
  mixTerrainPoints: 0,
})

type ImpactFrame = {
  actor: number
  actorStrat: AiStrat
  defId: string
  kind: PlayKind
  turn: number
  startTotals: number[]
}

export class BalanceTracker {
  readonly seed: number
  private swings: SwingEvent[] = []
  private rounds: RoundEvent[] = []
  private events: EventCounts = EMPTY_EVENTS()
  private seatEvents: EventCounts[] = []
  private seatPlaySets: Set<string>[] = []
  private actions = 0
  private turnActor = 0
  private turnNo = 1
  private turnCards = 0
  private turnStartScores: number[] = []
  private started = false
  /** Open card resolution — score delta is attributed when prompts / queues settle. */
  private impact: ImpactFrame | null = null

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
    this.seatPlaySets = game.players.map(() => new Set())
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

    // Instant / Illusion spent from a prompt: close the interrupted card, open the interrupt card.
    if (action.type === 'choose' && before.pending) {
      const choice = action.ids[0] ?? ''
      if (choice.startsWith('instant:') || choice.startsWith('illu:') || choice.startsWith('play:')) {
        const spent = handCardSpent(before, after, before.pending.actor)
        if (spent) {
          this.sealImpact(before)
          this.openImpact(before, before.pending.actor, spent.defId, spent.kind as PlayKind)
          this.tallyPlay(before.pending.actor, spent.kind, display(spent.defId).instant, spent.defId)
        }
      }
    }

    if (action.type === 'play') {
      const held = findHand(before, action.uid)
      const resolved = held && !after.players[held.player.id]?.hand.some((card) => card.uid === action.uid)
      if (held && resolved) {
        if (held.player.id === before.active) this.turnCards += 1
        this.sealImpact(before)
        this.openImpact(before, held.player.id, held.card.defId, held.card.kind)
        this.tallyPlay(held.player.id, held.card.kind, display(held.card.defId).instant, held.card.defId)
      }
    } else if (action.type === 'combo') {
      this.turnCards += 1
      const ids = action.uids
        .map((uid) => before.players[before.active]?.hand.find((card) => card.uid === uid)?.defId)
        .filter((id): id is string => !!id)
      const mixed = new Set(ids).size > 1
      this.sealImpact(before)
      this.openImpact(before, before.active, mixed ? 'mixed_path' : (ids[0] ?? 'terrain'), 'combo')
      this.bumpEvent(before.active, 'playTerrain')
    } else if (action.type === 'morph') {
      this.turnCards += 1
      const loc = before.players.flatMap((player) => player.teams.flatMap((team) => team.heroes)).find((hero) => hero.uid === action.uid)
      this.sealImpact(before)
      this.openImpact(before, before.active, loc?.defId ?? 'morphling', 'morph')
    } else if (action.type === 'draw') {
      this.turnCards += 1
      this.sealImpact(before)
      this.openImpact(before, before.active, 'draw', 'draw')
      this.bumpEvent(before.active, 'drawAction')
    } else if (action.type === 'move') {
      this.sealImpact(before)
      this.openImpact(before, before.active, 'ember_spirit', 'move')
    }

    if (!resolving(after)) this.sealImpact(after)
    if (after.over) {
      this.sealImpact(after)
      this.flushRound(after)
    }
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

  private tallyPlay(actor: number, kind: CardKind, instant: boolean, defId?: string) {
    if (defId && isTrapHero(defId)) this.bumpEvent(actor, 'playTrap')
    else if (kind === 'hero') this.bumpEvent(actor, 'playHero')
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

    const gainedImmune = countImmune(after) - countImmune(before)
    if (gainedImmune > 0) this.bumpEvent(actor, 'immune', gainedImmune)
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
    this.sealImpact(game)
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
      seatPlays: game.players.map((_, index) => [...(this.seatPlaySets[index] ?? [])]),
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

  private openImpact(at: Game, actor: number, defId: string, kind: PlayKind) {
    this.impact = {
      actor,
      actorStrat: at.players[actor]?.strat ?? DEFAULT_STRAT,
      defId,
      kind,
      turn: at.turn,
      startTotals: totals(at),
    }
    if (defId !== 'draw' && defId !== 'mixed_path' && defId !== 'ember_spirit') {
      const set = this.seatPlaySets[actor] ?? (this.seatPlaySets[actor] = new Set())
      set.add(defId)
    }
  }

  private sealImpact(at: Game) {
    const frame = this.impact
    if (!frame) return
    this.impact = null
    this.commitSwing(frame, totals(at))
  }

  private commitSwing(frame: ImpactFrame, afterTotals: number[]) {
    const actor = frame.actor
    const beforeTotals = frame.startTotals
    const actorSwing = (afterTotals[actor] ?? 0) - (beforeTotals[actor] ?? 0)
    const oppBefore = mean(beforeTotals.filter((_, id) => id !== actor))
    const oppAfter = mean(afterTotals.filter((_, id) => id !== actor))
    const relativeSwing = actorSwing - (oppAfter - oppBefore)
    const fieldSwing = afterTotals.reduce((sum, score, id) => sum + Math.abs(score - (beforeTotals[id] ?? 0)), 0)
    const defId = frame.defId
    const info = defId === 'draw' || defId === 'mixed_path' ? null : display(defId)
    const name = defId === 'draw' ? 'Draw' : defId === 'mixed_path' ? 'Mixed path' : (info?.name ?? defId)
    const shownKind: PlayKind = frame.kind === 'combo' ? 'combo' : frame.kind
    const bucket = relBucket(shownKind, defId)
    const attr = shownKind === 'hero' || shownKind === 'morph' ? (HERO_BY_ID[defId]?.attr ?? info?.attr ?? null) : null
    const instant = !!info?.instant || (shownKind === 'hero' && HERO_BY_ID[defId]?.timing === 'instant')
    this.swings.push({
      seed: this.seed,
      turn: frame.turn,
      actor,
      actorStrat: frame.actorStrat,
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

function resolving(game: Game): boolean {
  return !!(game.pending || game.after || game.queue.length > 0 || game.echoes.length > 0)
}

function handCardSpent(before: Game, after: Game, seat: number): CardInst | null {
  const prior = before.players[seat]?.hand ?? []
  const next = new Set((after.players[seat]?.hand ?? []).map((card) => card.uid))
  for (const card of prior) {
    if (!next.has(card.uid)) return card
  }
  return null
}

export function summarizeReports(reports: MatchReport[], filter: StratFilter = ALL_STRAT_FILTER): BalanceSummary {
  const scoped = reports.filter((report) => {
    if (filter.mixOnly && !report.mixture) return false
    if (filter.strats.length === 0) return true
    return filter.strats.some((strat) => report.seatStrats.includes(strat))
  })
  const finished = scoped.filter((report) => report.over)
  type CardAgg = {
    defId: string
    name: string
    kind: PlayKind
    bucket: RelBucket
    attr: Attr | null
    instant: boolean
    plays: number
    actor: number
    relative: number
    abs: number
    presence: number
    wins: number
  }
  const cardMap = new Map<string, CardAgg>()
  const presenceMap = new Map<string, { presence: number; wins: number }>()
  const kindMap = new Map<PlayKind, { plays: number; actor: number; relative: number }>()
  const attrMap = new Map<Attr | 'none', { plays: number; actor: number; relative: number }>()
  const ptsByTurn = new Map<number, number[]>()
  const cardsByTurn = new Map<number, number[]>()
  const stratMap = new Map<AiStrat, { seats: number; wins: number; finishes: number; score: number; standing: number; actor: number; relative: number; plays: number }>()
  const eventTotals = EMPTY_EVENTS()
  const shapeTotals = EMPTY_SHAPES()
  const filteringPlays = filter.strats.length > 0

  for (const report of scoped) {
    for (let seat = 0; seat < report.seatStrats.length; seat += 1) {
      const strat = report.seatStrats[seat]!
      if (!allowsStrat(filter, strat)) continue
      addEvents(eventTotals, report.seatEvents[seat] ?? EMPTY_EVENTS())
      addShapes(shapeTotals, report.seatShapes[seat] ?? EMPTY_SHAPES())
      const row = stratMap.get(strat) ?? { seats: 0, wins: 0, finishes: 0, score: 0, standing: 0, actor: 0, relative: 0, plays: 0 }
      row.seats += 1
      stratMap.set(strat, row)
    }
    if (report.over) {
      for (let index = 0; index < report.seatStrats.length; index += 1) {
        const strat = report.seatStrats[index]!
        if (!allowsStrat(filter, strat)) continue
        const row = stratMap.get(strat) ?? { seats: 0, wins: 0, finishes: 0, score: 0, standing: 0, actor: 0, relative: 0, plays: 0 }
        row.finishes += 1
        row.score += report.finalScores[index] ?? 0
        row.standing += standingOf(report.finalScores, index)
        if (report.winner === index) row.wins += 1
        stratMap.set(strat, row)
      }
    }

    for (let seat = 0; seat < report.seatStrats.length; seat += 1) {
      const strat = report.seatStrats[seat]!
      if (!allowsStrat(filter, strat)) continue
      const won = report.over && report.winner === seat
      for (const defId of report.seatPlays?.[seat] ?? []) {
        const entry = presenceMap.get(defId) ?? { presence: 0, wins: 0 }
        entry.presence += 1
        if (won) entry.wins += 1
        presenceMap.set(defId, entry)
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
        presence: 0,
        wins: 0,
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

      const stratRow = stratMap.get(swing.actorStrat) ?? { seats: 0, wins: 0, finishes: 0, score: 0, standing: 0, actor: 0, relative: 0, plays: 0 }
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

  const cards = [...cardMap.values()].map((row) => {
    const presence = presenceMap.get(row.defId) ?? { presence: 0, wins: 0 }
    return {
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
      presence: presence.presence,
      wins: presence.wins,
      winRate: presence.presence ? presence.wins / presence.presence : 0,
    }
  })

  // Prefer cards with enough samples so one-off spikes don't dominate Rel tables.
  const minPlays = Math.max(1, Math.min(6, Math.floor(Math.max(1, finished.length) / 8)))
  const ranked = cards.filter((row) => row.kind !== 'draw' && row.plays >= minPlays)
  const heroRows = ranked.filter((row) => row.bucket === 'hero')
  const terrainRows = ranked.filter((row) => row.bucket === 'terrain')
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
    terrainHigh: rankHigh(terrainRows),
    terrainLow: rankLow(terrainRows),
    lootHigh: rankHigh(lootRows),
    lootLow: rankLow(lootRows),
    contested: [...ranked]
      .sort((a, b) => b.avgAbsSwing * Math.sqrt(b.plays) - a.avgAbsSwing * Math.sqrt(a.plays) || b.plays - a.plays)
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
        avgStanding: row.finishes ? row.standing / row.finishes : 0,
        avgSelfSwing: row.plays ? row.actor / row.plays : 0,
        avgRelSwing: row.plays ? row.relative / row.plays : 0,
        plays: row.plays,
      }))
      .sort((a, b) => b.wins - a.wins || a.avgStanding - b.avgStanding || b.avgScore - a.avgScore),
    shapeCompare: [
      shapeRow('core_team', 'Core team', shapeTotals.coreTeams, shapeTotals.coreTeamPoints, shapeTotals.coreTeamHeroes, shapeTotals.pureCore3 + shapeTotals.pureCore4 + shapeTotals.pureCore5, matchCount),
      // n = teams with a same-attr stack of that size (incl. mixed boards); avg pts from mono cores only.
      shapeRow('core_team_3', 'Core ×3 same attr', shapeTotals.coreTeams3, shapeTotals.coreTeamPoints3, shapeTotals.coreTeamHeroes3, shapeTotals.pureCore3, matchCount, shapeTotals.pureCore3),
      shapeRow('core_team_4', 'Core ×4 same attr', shapeTotals.coreTeams4, shapeTotals.coreTeamPoints4, shapeTotals.coreTeamHeroes4, shapeTotals.pureCore4, matchCount, shapeTotals.pureCore4),
      shapeRow('core_team_5', 'Core ×5 same attr', shapeTotals.coreTeams5, shapeTotals.coreTeamPoints5, shapeTotals.coreTeamHeroes5, shapeTotals.pureCore5, matchCount, shapeTotals.pureCore5),
      shapeRow('mix_team', 'Mixed team', shapeTotals.mixTeams, shapeTotals.mixTeamPoints, shapeTotals.mixTeamHeroes, shapeTotals.pureMix3 + shapeTotals.pureMix4, matchCount),
      shapeRow('mix_team_3', 'Mixed · 3 attrs', shapeTotals.mixTeams3, shapeTotals.mixTeamPoints3, shapeTotals.mixTeamHeroes3, shapeTotals.pureMix3, matchCount),
      shapeRow('mix_team_4', 'Mixed · 4 attrs', shapeTotals.mixTeams4, shapeTotals.mixTeamPoints4, shapeTotals.mixTeamHeroes4, shapeTotals.pureMix4, matchCount),
      shapeRow('core_terrain', 'Core terrain', shapeTotals.coreTerrains, shapeTotals.coreTerrainPoints, shapeTotals.coreTerrains * 3, shapeTotals.coreTerrains, matchCount),
      shapeRow('mix_terrain', 'Mixed terrain', shapeTotals.mixTerrains, shapeTotals.mixTerrainPoints, shapeTotals.mixTerrains * 3, shapeTotals.mixTerrains, matchCount),
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
      eventRow('playTerrain', 'Terrain combos', eventTotals.playTerrain, matchCount),
      eventRow('playRune', 'Rune plays', eventTotals.playRune, matchCount),
      eventRow('playNeutral', 'Neutral plays', eventTotals.playNeutral, matchCount),
      eventRow('playTower', 'Tower plays', eventTotals.playTower, matchCount),
      eventRow('playTrap', 'Trap plants', eventTotals.playTrap, matchCount),
      eventRow('immune', 'Immunity grants', eventTotals.immune, matchCount),
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
  return [...rows]
    .sort((a, b) => b.avgRelativeSwing - a.avgRelativeSwing || b.winRate - a.winRate || b.plays - a.plays)
    .slice(0, 12)
}

function rankLow(rows: CardBalanceRow[]): CardBalanceRow[] {
  return [...rows]
    .sort((a, b) => a.avgRelativeSwing - b.avgRelativeSwing || a.winRate - b.winRate || b.plays - a.plays)
    .slice(0, 12)
}

function shapeRow(
  id: ShapeCompareRow['id'],
  label: string,
  count: number,
  points: number,
  cards: number,
  pureCount: number,
  matches: number,
  /** Denominator for avg pts (defaults to `count`). Use pure mono-core count for Core ×N rows. */
  pointsDenom: number = count,
): ShapeCompareRow {
  const denom = pointsDenom > 0 ? pointsDenom : 0
  return {
    id,
    label,
    count,
    avgCount: count / matches,
    totalPoints: points,
    avgPoints: denom ? points / denom : 0,
    pureCount,
    avgPtsPerCard: cards ? points / cards : 0,
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
  let deckStall = 0
  let lastDeck = game.deck.length
  while (!game.over && steps < guard) {
    steps += 1
    if (game.veil) {
      const before = game
      game = apply(game, { type: 'ready' })
      tracker.observe(before, { type: 'ready' }, game)
      continue
    }
    if (game.pending) {
      const ids = chooseAiPending(game)
      const before = game
      game = apply(game, { type: 'choose', ids })
      tracker.observe(before, { type: 'choose', ids }, game)
      if (game.pending === before.pending) {
        game = { ...game, pending: null, log: [...game.log, 'Forced past a stuck choice.'] }
      }
      continue
    }
    const action = chooseAiAction(game)
    const before = game
    game = apply(game, action)
    tracker.observe(before, action, game)
    if (game.deck.length < lastDeck) {
      lastDeck = game.deck.length
      deckStall = 0
    } else if (action.type === 'end') {
      deckStall += 1
    }
    // Recycle loops (Weaver et al.) can keep the deck from emptying — cut them short.
    if (deckStall >= 20 || steps >= 700) {
      break
    }
    const marker = `${game.turn}:${game.active}:${game.deck.length}:${game.players.map((p) => p.hand.length).join(',')}`
    if (marker === last) {
      repeats += 1
      if (repeats > 4) {
        if (game.pending) {
          const ids = chooseAiPending(game)
          game = apply(game, { type: 'choose', ids })
          if (game.pending) game = { ...game, pending: null, log: [...game.log, 'Forced past a stuck choice.'] }
          repeats = 0
          continue
        }
        game = apply(game, { type: 'end' })
        if (game.veil) game = apply(game, { type: 'ready' })
        repeats = 0
        last = ''
        continue
      }
    } else {
      repeats = 0
      last = marker
    }
  }
  if (!game.over) {
    // Safety net for rare recycle loops that never empty the deck.
    const parts = game.players.map((player) => scoreState(game, player.id))
    const scores = parts.map((part) => part.total)
    game = {
      ...game,
      pending: null,
      veil: false,
      over: { reason: 'Match halted (soft-lock).', scores, parts },
      log: [...game.log, 'Match halted (soft-lock).'],
    }
  }
  return tracker.finish(game)
}

function relBucket(kind: PlayKind, defId: string): RelBucket {
  if (kind === 'hero' || kind === 'morph') return 'hero'
  if (kind === 'combo' || kind === 'terrain' || defId === 'mixed_path' || defId === 'river' || defId === 'jungle' || defId === 'lane') return 'terrain'
  if (kind === 'item' || kind === 'rune' || kind === 'neutral' || kind === 'tower') return 'loot'
  return 'other'
}

function mixAttrCount(why: string): number {
  const match = why.match(/^attributes ×(\d+)/)
  if (!match) return 0
  const n = Number(match[1])
  return n >= 2 && n <= 4 ? n : 0
}

/** Largest mono-attribute stack on the team (Meepo counts as 2). Multi-attr heroes do not pad a stack. */
function maxSameAttrStackFor(game: Game, team: Team): number {
  const tallies: Record<string, number> = { STR: 0, AGI: 0, INT: 0, UNI: 0 }
  for (const hero of team.heroes) {
    const attrs = attrsOf(game, hero)
    if (attrs.length !== 1) continue
    const attr = attrs[0]!
    tallies[attr] = (tallies[attr] ?? 0) + heroWeight(hero)
  }
  return Math.max(0, tallies.STR ?? 0, tallies.AGI ?? 0, tallies.INT ?? 0, tallies.UNI ?? 0)
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
    const size = team.heroes.length
    const mixAttrs = mixAttrCount(scored.why)
    const sameAttr = maxSameAttrStackFor(game, team)

    // Inclusive stack frequency — a ×5 mono (or mixed board with a ×4 stack) still counts toward ×3/×4.
    if (sameAttr >= 3) shapes.coreTeams3 += 1
    if (sameAttr >= 4) shapes.coreTeams4 += 1
    if (sameAttr >= 5) shapes.coreTeams5 += 1

    if (shape === 'core') {
      shapes.coreTeams += 1
      shapes.coreTeamPoints += scored.points
      shapes.coreTeamHeroes += size
      // Avg pts / pts-per-card for Core ×N use mono-core scores only (not mixed-board totals).
      if (size === 3) {
        shapes.pureCore3 += 1
        shapes.coreTeamPoints3 += scored.points
        shapes.coreTeamHeroes3 += size
      } else if (size === 4) {
        shapes.pureCore4 += 1
        shapes.coreTeamPoints4 += scored.points
        shapes.coreTeamHeroes4 += size
      } else if (size >= 5) {
        shapes.pureCore5 += 1
        shapes.coreTeamPoints5 += scored.points
        shapes.coreTeamHeroes5 += size
      }
    } else if (shape === 'mix') {
      shapes.mixTeams += 1
      shapes.mixTeamPoints += scored.points
      shapes.mixTeamHeroes += size
      if (mixAttrs === 3) {
        shapes.mixTeams3 += 1
        shapes.mixTeamPoints3 += scored.points
        shapes.mixTeamHeroes3 += size
        if (size === 3) shapes.pureMix3 += 1
      } else if (mixAttrs >= 4) {
        shapes.mixTeams4 += 1
        shapes.mixTeamPoints4 += scored.points
        shapes.mixTeamHeroes4 += size
        if (size === 4) shapes.pureMix4 += 1
      }
    } else {
      shapes.openTeams += 1
    }
  }
  for (const combo of player.combos) {
    if (combo.kind === 'mixed') {
      shapes.mixTerrains += 1
      shapes.mixTerrainPoints += combo.points
    } else {
      shapes.coreTerrains += 1
      shapes.coreTerrainPoints += combo.points
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

/** Count active immunity stamps / auras for event deltas. */
function countImmune(game: Game): number {
  let n = 0
  for (const player of game.players) {
    if (player.bkb) n += 1
    for (const team of player.teams) {
      if (team.glyph) n += Math.max(1, team.heroes.length)
      const hasOmni = team.heroes.some((hero) => hero.defId === 'omniknight')
      for (const hero of team.heroes) {
        if (hero.bkb || hero.omni) n += 1
        else if (hasOmni) n += 1
      }
    }
  }
  return n
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
