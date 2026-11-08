import { chooseAiAction, chooseAiPendingForSeat, cycleStrat, DEFAULT_STRAT, searchModeForStrat } from './ai.ts'
import { display, firesAbility, HERO_BY_ID } from './catalog.ts'
import { apply, comboShape, createGame, type SeatSpec } from './engine.ts'
import {
  DEFAULT_CALIBRATION,
  diffPlayEffects,
  EMPTY_EFFECTS,
  impactOf,
  type PlayEffects,
} from './evModel.ts'
import {
  abilitiesLocked,
  attrsOf,
  findHand,
  findHero,
  heroWeight,
  isTrapHero,
  orchidLocked,
  scoreState,
  scoreTeam,
  silenced,
  standingOf,
} from './flow.ts'
import { getScoreRules } from './scoring.ts'
import type { Action, AiStrat, Attr, CardInst, CardKind, Game, Team } from './types.ts'

export type { PlayEffects } from './evModel.ts'
export { EMPTY_EFFECTS, impactOf, pressureOf, diffPlayEffects, addEffects } from './evModel.ts'

export type PlayKind = CardKind | 'combo' | 'draw' | 'morph' | 'move' | 'ability' | 'other'
export type RelBucket = 'hero' | 'terrain' | 'loot' | 'ability' | 'other'

/** Primary on-play effect family for ability activations (one type per hero). */
export type AbilityEffectType =
  | 'destroy'
  | 'exile'
  | 'bounce'
  | 'control'
  | 'move'
  | 'deny'
  | 'protect'
  | 'draw'
  | 'discard'
  | 'reveal'
  | 'trap'
  | 'other'

export const ABILITY_EFFECT_LABELS: Record<AbilityEffectType, string> = {
  destroy: 'Destroy',
  exile: 'Exile',
  bounce: 'Bounce (hand/deck)',
  control: 'Control / steal',
  move: 'Move / reshape',
  deny: 'Deny / lock',
  protect: 'Protect / immune',
  draw: 'Draw / dig',
  discard: 'Discard',
  reveal: 'Reveal',
  trap: 'Trap',
  other: 'Other',
}

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
  /** Links body + ability swings from one hero play. */
  playId: number | null
  /** True when the on-play ability was silenced / orchid-locked / frost-locked. */
  silenced: boolean
  actorSwing: number
  relativeSwing: number
  fieldSwing: number
  destroy: number
  discard: number
  exile: number
  control: number
  bounce: number
  /** Mechanical EV bag of the play (fixed per-effect values). */
  pressure: number
  /** Actor rel (own score − mean opponent) when the play started. */
  startRel?: number
  /** Rel change from the play's start to the start of turn +1, +3, +5, +10 (final scores past the end). */
  horizon?: number[]
}

/** Game-turn offsets measured for every play. */
export const IMPACT_HORIZONS = [1, 3, 5, 10] as const
/** Blend of horizon advantages that makes up Impact. */
export const IMPACT_WEIGHTS = [0.35, 0.3, 0.25, 0.1] as const

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
  /** Board control flips toward the credited seat. */
  steal: number
  /** Heroes bounced from board to a hand. */
  bounce: number
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
  /** Exclusive same-attr stacks: size≥3 and stack exactly 3 / 4 / 5+ (mixed boards count). */
  coreTeams3: number
  coreTeams4: number
  coreTeams5: number
  mixTeams3: number
  mixTeams4: number
  /** Mono-core teams in each exclusive stack bucket (for avg pts). */
  pureCore3: number
  pureCore4: number
  pureCore5: number
  /** Mixed teams with exactly 3 / 4+ attrs and 3+ heroes. */
  pureMix3: number
  pureMix4: number
  /** Teams of 1 / 2 heroes (no CORE / MIXED shape). */
  smallTeams1: number
  smallTeams2: number
  coreTerrains: number
  /** Three Rivers / Jungles / Lanes (also counted in coreTerrains). */
  riverTerrains: number
  jungleTerrains: number
  laneTerrains: number
  mixTerrains: number
  pairTerrains: number
  coreTeamPoints: number
  mixTeamPoints: number
  coreTeamPoints3: number
  coreTeamPoints4: number
  coreTeamPoints5: number
  mixTeamPoints3: number
  mixTeamPoints4: number
  smallTeamPoints1: number
  smallTeamPoints2: number
  coreTeamHeroes: number
  mixTeamHeroes: number
  coreTeamHeroes3: number
  coreTeamHeroes4: number
  coreTeamHeroes5: number
  mixTeamHeroes3: number
  mixTeamHeroes4: number
  smallTeamHeroes1: number
  smallTeamHeroes2: number
  coreTerrainPoints: number
  riverTerrainPoints: number
  jungleTerrainPoints: number
  laneTerrainPoints: number
  mixTerrainPoints: number
  pairTerrainPoints: number
}

/** Board shape + seat scores captured at the end of a turn. */
export interface ShapeSnapshot {
  turn: number
  scores: number[]
  seatShapes: ShapeCounts[]
}

/**
 * Full table-round snapshot (everyone has acted once).
 * Round R ends when `game.turn === seats * R`.
 * Always recorded (even in lite Stats batches) — cheap numbers only.
 */
export interface RoundSnapshot {
  round: number
  turn: number
  scores: number[]
  hands: number[]
}

/** Milestone table-rounds shown in Stats. */
export const ROUND_MILESTONES = [1, 3, 5, 10, 15, 20] as const

/** Mid-checkpoint margin within this many pts counts as contesting (not held / behind). */
export const LEAD_CONTEST_BAND = 5

export type LeadKind = 'held' | 'contesting' | 'behind'

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
  /** Per-turn shape/score snapshots (end of each seat's turn). */
  shapeHistory: ShapeSnapshot[]
  /** End-of-table-round score + hand sizes (lite-safe). */
  roundHistory?: RoundSnapshot[]
  /** Seat that drew The Ancient (null if never drawn / grave-exile reveal / deck-empty end). */
  ancientDrawer?: number | null
  /** Strat of the Ancient drawer when set. */
  ancientDrawerStrat?: AiStrat | null
  /** True when the final round started because The Ancient was revealed (any source). */
  ancientRevealed?: boolean
  events: EventCounts
  seatEvents: EventCounts[]
  shapes: ShapeCounts
  seatShapes: ShapeCounts[]
  over: boolean
  /** `game.over.reason` when finished (Ancient / score hold / final round / …). */
  overReason: string | null
}

/** Avg score / hand at a milestone table-round. */
export interface RoundMilestoneRow {
  round: number
  samples: number
  /** Mean score by seat index (padded to summary.seats). */
  avgScoreBySeat: number[]
  avgHandBySeat: number[]
  /** Per-seat sample counts used for the averages. */
  samplesBySeat: number[]
  byStrat: { strat: AiStrat; samples: number; avgScore: number; avgHand: number }[]
}

/**
 * Come-from-behind / contesting / held-lead wins.
 * Mid checkpoint = latest milestone round strictly before the final table-round.
 * Compared to the best other seat at that checkpoint:
 * Held = ahead by more than LEAD_CONTEST_BAND · Contesting = within ±BAND · Behind = down by more than BAND.
 */
export interface LeadOutcomeRow {
  key: string
  kind: 'strat' | 'seat'
  label: string
  wins: number
  heldLead: number
  contesting: number
  fromBehind: number
  /** Wins with a usable mid checkpoint. */
  samples: number
}

/** Ancient-draw outcomes (true draws only — not grave/exile reveals). */
export interface AncientDrawRow {
  key: string
  kind: 'strat' | 'seat' | 'total'
  label: string
  draws: number
  wins: number
  /** draws where the match finished with a sole winner. */
  decided: number
}

export type TurnGraphMetric = 'rel' | 'self' | 'seatScore' | 'cards' | 'pointsDelta'

export interface TurnGraphPoint {
  turn: number
  value: number
  samples: number
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
  /** Wins among those presence matches (match-level correlation). */
  wins: number
  winRate: number
  /**
   * Play-weighted win rate: among `plays`, how often the actor's seat won the match.
   * Prefer this over match presence for hero context (Enigma 120/200 → 60%).
   */
  playWins: number
  playWinRate: number
  /** Plays where the on-play ability resolved (not silenced). */
  abilityPlays: number
  abilityWins: number
  /** Win rate among ability-fired plays (e.g. Black Hole landed). */
  abilityWinRate: number
  /** Plays where the on-play ability was silenced / orchid / frost-locked. */
  silencedPlays: number
  silencedWins: number
  /** Win rate among silenced plays. */
  silencedWinRate: number
  /** Mean mechanical EV bag (fixed per-effect values) — shown as EV. */
  avgPressure: number
  /**
   * Measured Impact: rel change over +1/+3/+5/+10 turns after the play, minus what an
   * average play at the same stage of the game gained, blended by IMPACT_WEIGHTS.
   */
  avgImpact: number
  /** Mean rel change at each horizon (not baseline-adjusted). */
  avgHorizon: number[]
  avgDestroy: number
  avgDiscard: number
  avgExile: number
  avgSteal: number
  avgBounce: number
}

export interface StratBalanceRow {
  strat: AiStrat
  seats: number
  wins: number
  finishes: number
  avgScore: number
  /** Mean final margin: own score − best other seat (negative when behind). */
  avgMargin: number
  avgStanding: number
  avgSelfSwing: number
  avgRelSwing: number
  plays: number
}

/** Same rollup as StratBalanceRow, keyed by seat index. */
export interface SeatBalanceRow {
  seat: number
  wins: number
  finishes: number
  avgScore: number
  avgMargin: number
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
    | 'small_team_1'
    | 'small_team_2'
    | 'river_terrain'
    | 'jungle_terrain'
    | 'lane_terrain'
    | 'mix_terrain'
    | 'pair_terrain'
  label: string
  count: number
  avgCount: number
  totalPoints: number
  avgPoints: number
  /** Pure exact-size instances (mono core, or mix attrs with matching hero count); null where it does not apply. */
  pureCount: number | null
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

export interface AbilityTypeRow {
  id: AbilityEffectType
  label: string
  plays: number
  avgActorSwing: number
  avgRelativeSwing: number
  /** Measured Impact (same baseline as card tables). */
  avgImpact: number
  /** Matches where a filtered seat activated this effect type at least once. */
  presence: number
  wins: number
  winRate: number
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
  /** All hero body plays (placement), sortable source for the Heroes table. */
  heroes: CardBalanceRow[]
  /**
   * Combined body+ability hero-play swings for the Heroes table mode cycle:
   * total / silenced / not silenced.
   */
  heroPlaysTotal: CardBalanceRow[]
  heroPlaysSilenced: CardBalanceRow[]
  heroPlaysOpen: CardBalanceRow[]
  /** Ability activations (on-play cast / reactivate), separate from body placement. */
  abilities: CardBalanceRow[]
  /** @deprecated kept for older callers — same as rankHigh(heroes) */
  heroHigh: CardBalanceRow[]
  /** @deprecated kept for older callers — same as rankLow(heroes) */
  heroLow: CardBalanceRow[]
  terrains: CardBalanceRow[]
  terrainHigh: CardBalanceRow[]
  terrainLow: CardBalanceRow[]
  loot: CardBalanceRow[]
  lootHigh: CardBalanceRow[]
  lootLow: CardBalanceRow[]
  contested: CardBalanceRow[]
  avgPtsByTurn: number[]
  avgCardsByTurn: number[]
  turnLabels: number[]
  kindSwing: { kind: PlayKind; plays: number; avgActorSwing: number; avgRelativeSwing: number }[]
  /** Ability activations rolled up by primary effect family. */
  byAbilityType: AbilityTypeRow[]
  byStrat: StratBalanceRow[]
  bySeat: SeatBalanceRow[]
  shapeCompare: ShapeCompareRow[]
  eventStats: EventStatRow[]
  byAttr: AttrStatRow[]
  /** Max turn index across traced matches (for scrubber). */
  maxTurn: number
  /** Available hero defIds that appear in swings (for graph picker). */
  graphHeroes: { defId: string; name: string }[]
  /** Avg score + hand size at table-rounds 1/3/5/10/15/20. */
  roundMilestones: RoundMilestoneRow[]
  /** Come-from-behind / contesting / held-lead wins by strat. */
  leadByStrat: LeadOutcomeRow[]
  /** Come-from-behind / contesting / held-lead wins by seat index. */
  leadBySeat: LeadOutcomeRow[]
  /** Who drew The Ancient and whether they won. */
  ancientDraws: AncientDrawRow[]
  /** Ancient revealed somehow (draw / grave / exile / deck-empty), for context. */
  ancientReveals: number
}

const EMPTY_EVENTS = (): EventCounts => ({
  drawDeck: 0,
  drawGrave: 0,
  discard: 0,
  exile: 0,
  destroy: 0,
  steal: 0,
  bounce: 0,
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
  smallTeams1: 0,
  smallTeams2: 0,
  coreTerrains: 0,
  riverTerrains: 0,
  jungleTerrains: 0,
  laneTerrains: 0,
  mixTerrains: 0,
  pairTerrains: 0,
  coreTeamPoints: 0,
  mixTeamPoints: 0,
  coreTeamPoints3: 0,
  coreTeamPoints4: 0,
  coreTeamPoints5: 0,
  mixTeamPoints3: 0,
  mixTeamPoints4: 0,
  smallTeamPoints1: 0,
  smallTeamPoints2: 0,
  coreTeamHeroes: 0,
  mixTeamHeroes: 0,
  coreTeamHeroes3: 0,
  coreTeamHeroes4: 0,
  coreTeamHeroes5: 0,
  mixTeamHeroes3: 0,
  mixTeamHeroes4: 0,
  smallTeamHeroes1: 0,
  smallTeamHeroes2: 0,
  coreTerrainPoints: 0,
  riverTerrainPoints: 0,
  jungleTerrainPoints: 0,
  laneTerrainPoints: 0,
  mixTerrainPoints: 0,
  pairTerrainPoints: 0,
})

type ImpactFrame = {
  actor: number
  actorStrat: AiStrat
  defId: string
  kind: PlayKind
  turn: number
  startTotals: number[]
  /** Snapshot at frame open — effects are diffs once on seal (not every step). */
  startState: Game
  playId: number | null
  silenced: boolean
  effects: PlayEffects
}

/** Hero play waiting to split body placement vs on-play ability. */
type AbilitySplit = {
  defId: string
  sourceUid: string
  actor: number
  playId: number
  silenced: boolean
}

export class BalanceTracker {
  readonly seed: number
  /** Skip shape-history / event tallies — for batch sims (~debug turn graphs only). */
  readonly lite: boolean
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
  private abilitySplit: AbilitySplit | null = null
  private playSeq = 0
  private shapeHistory: ShapeSnapshot[] = []
  /** End-of-table-round score/hand snapshots (always on — Stats lite included). */
  private roundHistory: RoundSnapshot[] = []
  /** Seat that drew The Ancient (null = never / non-draw reveal). */
  private ancientDrawer: number | null = null
  private ancientRevealed = false
  /** Scores at the start of each game turn, for play horizons. */
  private turnTotals = new Map<number, number[]>()

  constructor(seed: number, opts: { lite?: boolean } = {}) {
    this.seed = seed
    this.lite = !!opts.lite
  }

  start(game: Game) {
    this.started = true
    this.turnActor = game.active
    this.turnNo = game.turn
    this.turnCards = 0
    this.turnStartScores = totals(game)
    this.turnTotals = new Map([[game.turn, this.turnStartScores.slice()]])
    this.seatEvents = game.players.map(() => EMPTY_EVENTS())
    this.seatPlaySets = game.players.map(() => new Set())
    this.shapeHistory = []
    this.roundHistory = []
    this.ancientDrawer = game.ancient?.drawer ?? null
    this.ancientRevealed = !!game.ancient
  }

  observe(before: Game, action: Action, after: Game) {
    if (!this.started) this.start(before)
    this.actions += 1
    if (!before.ancient && after.ancient) {
      this.ancientRevealed = true
      if (after.ancient.drawer != null) this.ancientDrawer = after.ancient.drawer
    }
    // Credit Instant / Illusion / save spends to the pending seat, not the turn owner.
    const eventActor =
      action.type === 'choose' && before.pending
        ? before.pending.actor
        : before.active

    if (after.turn !== this.turnNo || after.active !== this.turnActor) {
      this.flushRound(before)
      this.turnActor = after.active
      this.turnNo = after.turn
      this.turnCards = 0
      this.turnStartScores = totals(after)
      if (!this.turnTotals.has(after.turn)) this.turnTotals.set(after.turn, this.turnStartScores.slice())
    }

    // Keep event tallies (cheap); shapeHistory is the heavy optional graph feed.
    this.tallyEvents(before, after, eventActor)

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
        this.abilitySplit = null
        const kind = held.card.kind
        const playId = ++this.playSeq
        const muted = abilitySuppressed(after, held.player.id, held.card.uid)
        this.openImpact(before, held.player.id, held.card.defId, kind, playId, muted)
        this.tallyPlay(held.player.id, held.card.kind, display(held.card.defId).instant, held.card.defId)
        if (kind === 'hero' && firesAbility(held.card.defId)) {
          // Split body vs ability when cast / Instant window opens; auto-resolves still log a 0-swing ability row.
          this.abilitySplit = {
            defId: held.card.defId,
            sourceUid: held.card.uid,
            actor: held.player.id,
            playId,
            silenced: muted,
          }
        }
      }
    } else if (action.type === 'combo') {
      this.turnCards += 1
      const actor = before.active
      const ids = action.uids
        .map((uid) => {
          const hand = before.players[actor]?.hand.find((card) => card.uid === uid)
          if (hand) return hand.defId
          return before.grave.find((card) => card.uid === uid && card.kind === 'terrain')?.defId
        })
        .filter((id): id is string => !!id)
      // Split 1-of-each (River+Jungle+Lane) from pair (2+1); both used to share mixed_path.
      const shape = comboShape(ids.map((defId) => ({ defId })))
      const defId =
        shape === 'core' ? (ids[0] ?? 'terrain') : shape === 'mixed' ? 'one_of_each' : 'pair_combo'
      this.sealImpact(before)
      this.openImpact(before, before.active, defId, 'combo')
      this.bumpEvent(before.active, 'playTerrain')
    } else if (action.type === 'morph') {
      this.turnCards += 1
      if (!this.lite) {
        const loc = before.players.flatMap((player) => player.teams.flatMap((team) => team.heroes)).find((hero) => hero.uid === action.uid)
        this.sealImpact(before)
        this.openImpact(before, before.active, loc?.defId ?? 'morphling', 'morph')
      }
    } else if (action.type === 'draw') {
      this.turnCards += 1
      this.bumpEvent(before.active, 'drawAction')
      // Lite batch sims skip draw impact frames (noise + expensive totals()).
      if (!this.lite) {
        this.sealImpact(before)
        this.openImpact(before, before.active, 'draw', 'draw')
      }
    } else if (action.type === 'move') {
      if (!this.lite) {
        this.sealImpact(before)
        this.openImpact(before, before.active, 'ember_spirit', 'move')
      }
    }

    // Effect EV is computed once on seal from startState→after (not every micro-step).
    this.maybeSplitAbility(before, after)

    if (!resolving(after)) this.sealImpact(after)
    if (after.over) {
      this.sealImpact(after)
      this.flushRound(after)
    }
  }

  /** When on-play cast / Instant interrupt begins, seal body swing and open an ability swing. */
  private maybeSplitAbility(_before: Game, after: Game) {
    const split = this.abilitySplit
    if (!split || !this.impact) return
    if (this.impact.defId !== split.defId || this.impact.kind !== 'hero') return
    const resume = after.pending?.resume
    const castStarting =
      (resume?.kind === 'cast' && resume.defId === split.defId && resume.sourceUid === split.sourceUid) ||
      (resume?.kind === 'instant-window' &&
        resume.heroUid === split.sourceUid &&
        resume.cast.defId === split.defId) ||
      (resume?.kind === 'pugna' && resume.cast.defId === split.defId && resume.cast.sourceUid === split.sourceUid)
    if (castStarting) {
      // Split before Instant pass / resolve so the ability frame captures the cast delta.
      const muted = split.silenced || abilitySuppressed(after, split.actor, split.sourceUid)
      this.sealImpact(after)
      this.openImpact(after, split.actor, split.defId, 'ability', split.playId, muted)
      this.abilitySplit = null
      return
    }
    // Other prompts still open — wait for the cast (or cancel).
    if (resolving(after)) return
    // Settled without a cast prompt: keep body seating, then record a 0-swing ability activation.
    this.sealImpact(after)
    this.openImpact(after, split.actor, split.defId, 'ability', split.playId, split.silenced)
    this.sealImpact(after)
    this.abilitySplit = null
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
    const beforeGrave = cardMap(before.grave)
    const afterGrave = cardMap(after.grave)
    const beforeDeck = cardMap(before.deck)
    const beforeExile = cardMap(before.exile)
    const afterExile = cardMap(after.exile)
    const beforeBoard = boardHeroMap(before)
    const afterBoard = boardHeroMap(after)
    const afterHands = allHandsMap(after)

    // Start-of-turn draws land in the next seat's hand while the previous seat is still "acting".
    for (const player of after.players) {
      const prior = player.id === actor ? beforeHand : cardMap(before.players[player.id]?.hand ?? [])
      for (const uid of player.hand.map((card) => card.uid)) {
        if (prior.has(uid)) continue
        if (beforeDeck.has(uid)) this.bumpEvent(player.id, 'drawDeck')
        else if (beforeGrave.has(uid)) this.bumpEvent(player.id, 'drawGrave')
      }
    }

    // Discard / exile from any seat's hand — credit the acting seat (often forced by an opponent).
    for (const player of before.players) {
      const prior = cardMap(player.hand)
      const next = cardMap(after.players[player.id]?.hand ?? [])
      for (const [uid] of prior) {
        if (next.has(uid)) continue
        if (afterGrave.has(uid)) this.bumpEvent(actor, 'discard')
        if (afterExile.has(uid) && !beforeExile.has(uid)) this.bumpEvent(actor, 'exile')
      }
    }

    for (const [uid, prior] of beforeBoard) {
      const next = afterBoard.get(uid)
      if (!next) {
        if (afterGrave.has(uid)) this.bumpEvent(actor, 'destroy')
        else if (afterExile.has(uid) && !beforeExile.has(uid)) this.bumpEvent(actor, 'exile')
        else if (afterHands.has(uid)) this.bumpEvent(actor, 'bounce')
        continue
      }
      // Control flip toward the credited seat.
      if (prior.controller !== actor && next.controller === actor) this.bumpEvent(actor, 'steal')
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
      swings: this.swings.map((swing) => ({
        ...swing,
        horizon: IMPACT_HORIZONS.map((offset) => {
          const at = this.turnTotals.get(swing.turn + offset) ?? scores
          return relOf(at, swing.actor) - (swing.startRel ?? 0)
        }),
      })),
      seatPlays: game.players.map((_, index) => [...(this.seatPlaySets[index] ?? [])]),
      rounds,
      shapeHistory: this.shapeHistory.slice(),
      roundHistory: this.roundHistory.slice(),
      ancientDrawer: this.ancientDrawer,
      ancientDrawerStrat: this.ancientDrawer != null ? (seatStrats[this.ancientDrawer] ?? null) : null,
      ancientRevealed: this.ancientRevealed || !!game.ancient,
      events: { ...this.events },
      seatEvents: game.players.map((_, index) => ({ ...(this.seatEvents[index] ?? EMPTY_EVENTS()) })),
      shapes: shapeCounts(game),
      seatShapes: game.players.map((player) => shapeCountsFor(game, player.id)),
      over: !!game.over,
      overReason: game.over?.reason ?? null,
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
    if (!this.lite) {
      this.shapeHistory.push({
        turn: this.turnNo,
        scores: endScores.slice(),
        seatShapes: game.players.map((player) => shapeCountsFor(game, player.id)),
      })
    }
    // Full table-round boundary: turn N*seats finishes round N.
    const seats = game.players.length
    if (seats > 0 && this.turnNo > 0 && this.turnNo % seats === 0) {
      const round = this.turnNo / seats
      const prior = this.roundHistory[this.roundHistory.length - 1]
      if (!prior || prior.round !== round) {
        this.roundHistory.push({
          round,
          turn: this.turnNo,
          scores: endScores.slice(),
          hands: game.players.map((player) => player.hand.length),
        })
      }
    }
    this.turnCards = 0
    this.turnStartScores = endScores
  }

  private openImpact(
    at: Game,
    actor: number,
    defId: string,
    kind: PlayKind,
    playId: number | null = null,
    silencedPlay = false,
  ) {
    this.impact = {
      actor,
      actorStrat: at.players[actor]?.strat ?? DEFAULT_STRAT,
      defId,
      kind,
      turn: at.turn,
      startTotals: totals(at),
      startState: at,
      playId,
      silenced: silencedPlay,
      effects: EMPTY_EFFECTS(),
    }
    if (
      defId !== 'draw'
      && defId !== 'mixed_path'
      && defId !== 'one_of_each'
      && defId !== 'pair_combo'
      && defId !== 'ember_spirit'
    ) {
      const set = this.seatPlaySets[actor] ?? (this.seatPlaySets[actor] = new Set())
      set.add(defId)
    }
  }

  private sealImpact(at: Game) {
    const frame = this.impact
    if (!frame) return
    this.impact = null
    // One net EV diff for the whole resolution frame (body or ability).
    // Lite sims skip per-body scoreTeam and use calibration means (big speed win).
    frame.effects = diffPlayEffects(
      frame.startState,
      at,
      frame.actor,
      frame.defId,
      DEFAULT_CALIBRATION,
      this.lite ? { cheapBodies: true } : undefined,
    )
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
    const info =
      defId === 'draw' || defId === 'mixed_path' || defId === 'one_of_each' || defId === 'pair_combo'
        ? null
        : display(defId)
    const name =
      defId === 'draw'
        ? 'Draw'
        : defId === 'one_of_each' || defId === 'mixed_path'
          ? '1 of each'
          : defId === 'pair_combo'
            ? 'Mixed combo'
            : (info?.name ?? defId)
    const shownKind: PlayKind = frame.kind === 'combo' ? 'combo' : frame.kind
    const bucket = relBucket(shownKind, defId)
    const attr =
      shownKind === 'hero' || shownKind === 'morph' || shownKind === 'ability'
        ? (HERO_BY_ID[defId]?.attr ?? info?.attr ?? null)
        : null
    const instant =
      !!info?.instant
      || ((shownKind === 'hero' || shownKind === 'ability') && HERO_BY_ID[defId]?.timing === 'instant')
    const effects = frame.effects
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
      playId: frame.playId,
      silenced: frame.silenced,
      actorSwing,
      relativeSwing,
      fieldSwing,
      destroy: effects.destroy,
      discard: effects.discard,
      exile: effects.exile,
      control: effects.control,
      bounce: effects.bounce,
      pressure: impactOf(relativeSwing, effects, DEFAULT_CALIBRATION),
      startRel: relOf(beforeTotals, actor),
    })
  }
}

function abilitySuppressed(game: Game, actor: number, sourceUid?: string): boolean {
  if (silenced(game) || orchidLocked(game, actor) || abilitiesLocked(game, actor)) return true
  if (sourceUid) {
    const loc = findHero(game, sourceUid)
    if (loc?.hero.muted) return true
  }
  return false
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
    playWins: number
    destroy: number
    discard: number
    exile: number
    control: number
    bounce: number
    pressure: number
    impact: number
    horizon: number[]
  }
  const cardMap = new Map<string, CardAgg>()
  const presenceMap = new Map<string, { presence: number; wins: number }>()
  const kindMap = new Map<PlayKind, { plays: number; actor: number; relative: number }>()
  const attrMap = new Map<Attr | 'none', { plays: number; actor: number; relative: number }>()
  const abilityTypeMap = new Map<AbilityEffectType, { plays: number; actor: number; relative: number; impact: number; presence: number; wins: number }>()
  const ptsByTurn = new Map<number, number[]>()
  const cardsByTurn = new Map<number, number[]>()
  type SeatAgg = { wins: number; finishes: number; score: number; margin: number; standing: number; actor: number; relative: number; plays: number }
  const stratMap = new Map<AiStrat, SeatAgg & { seats: number }>()
  const seatMap = new Map<number, SeatAgg>()
  const eventTotals = EMPTY_EVENTS()
  const shapeTotals = EMPTY_SHAPES()
  const filteringPlays = filter.strats.length > 0
  const impactFor = impactBaseline(scoped, filter)

  const emptyAgg = (): SeatAgg => ({ wins: 0, finishes: 0, score: 0, margin: 0, standing: 0, actor: 0, relative: 0, plays: 0 })
  const marginOf = (scores: number[], seat: number) => {
    const mine = scores[seat] ?? 0
    let bestOther = -Infinity
    for (let i = 0; i < scores.length; i += 1) {
      if (i === seat) continue
      bestOther = Math.max(bestOther, scores[i] ?? 0)
    }
    return Number.isFinite(bestOther) ? mine - bestOther : 0
  }
  /** Milestone round → seat/strat accumulators. */
  const milestoneAcc = new Map<number, {
    samples: number
    scoreBySeat: number[]
    handBySeat: number[]
    seatSamples: number[]
    byStrat: Map<AiStrat, { samples: number; score: number; hand: number }>
  }>()
  const leadStratAcc = new Map<AiStrat, { wins: number; heldLead: number; contesting: number; fromBehind: number; samples: number }>()
  const leadSeatAcc = new Map<number, { wins: number; heldLead: number; contesting: number; fromBehind: number; samples: number }>()
  const ancientStratAcc = new Map<AiStrat, { draws: number; wins: number; decided: number }>()
  const ancientSeatAcc = new Map<number, { draws: number; wins: number; decided: number }>()
  let ancientDrawTotal = { draws: 0, wins: 0, decided: 0 }
  let ancientReveals = 0

  for (const report of scoped) {
    const seatAbilityTypes: Set<AbilityEffectType>[] = report.seatStrats.map(() => new Set())
    for (let seat = 0; seat < report.seatStrats.length; seat += 1) {
      const strat = report.seatStrats[seat]!
      if (!allowsStrat(filter, strat)) continue
      addEvents(eventTotals, report.seatEvents[seat] ?? EMPTY_EVENTS())
      addShapes(shapeTotals, report.seatShapes[seat] ?? EMPTY_SHAPES())
      const row = stratMap.get(strat) ?? { ...emptyAgg(), seats: 0 }
      row.seats += 1
      stratMap.set(strat, row)
      if (!seatMap.has(seat)) seatMap.set(seat, emptyAgg())
    }
    if (report.over) {
      for (let index = 0; index < report.seatStrats.length; index += 1) {
        const strat = report.seatStrats[index]!
        if (!allowsStrat(filter, strat)) continue
        const margin = marginOf(report.finalScores, index)
        const row = stratMap.get(strat) ?? { ...emptyAgg(), seats: 0 }
        row.finishes += 1
        row.score += report.finalScores[index] ?? 0
        row.margin += margin
        row.standing += standingOf(report.finalScores, index)
        if (report.winner === index) row.wins += 1
        stratMap.set(strat, row)

        const seatRow = seatMap.get(index) ?? emptyAgg()
        seatRow.finishes += 1
        seatRow.score += report.finalScores[index] ?? 0
        seatRow.margin += margin
        seatRow.standing += standingOf(report.finalScores, index)
        if (report.winner === index) seatRow.wins += 1
        seatMap.set(index, seatRow)
      }
    }

    // Table-round score/hand milestones + come-from-behind / held-lead outcomes.
    for (const snap of report.roundHistory ?? []) {
      if (!(ROUND_MILESTONES as readonly number[]).includes(snap.round)) continue
      const seatCount = Math.max(report.seats, snap.scores.length, snap.hands.length)
      let bucket = milestoneAcc.get(snap.round)
      if (!bucket) {
        bucket = {
          samples: 0,
          scoreBySeat: Array.from({ length: seatCount }, () => 0),
          handBySeat: Array.from({ length: seatCount }, () => 0),
          seatSamples: Array.from({ length: seatCount }, () => 0),
          byStrat: new Map(),
        }
        milestoneAcc.set(snap.round, bucket)
      }
      while (bucket.scoreBySeat.length < seatCount) {
        bucket.scoreBySeat.push(0)
        bucket.handBySeat.push(0)
        bucket.seatSamples.push(0)
      }
      bucket.samples += 1
      for (let seat = 0; seat < seatCount; seat += 1) {
        const strat = report.seatStrats[seat]
        if (strat == null || !allowsStrat(filter, strat)) continue
        const score = snap.scores[seat] ?? 0
        const hand = snap.hands[seat] ?? 0
        bucket.scoreBySeat[seat] = (bucket.scoreBySeat[seat] ?? 0) + score
        bucket.handBySeat[seat] = (bucket.handBySeat[seat] ?? 0) + hand
        bucket.seatSamples[seat] = (bucket.seatSamples[seat] ?? 0) + 1
        const stratRow = bucket.byStrat.get(strat) ?? { samples: 0, score: 0, hand: 0 }
        stratRow.samples += 1
        stratRow.score += score
        stratRow.hand += hand
        bucket.byStrat.set(strat, stratRow)
      }
    }

    if (report.ancientRevealed) ancientReveals += 1
    if (report.ancientDrawer != null) {
      const drawer = report.ancientDrawer
      const drawerStrat = report.ancientDrawerStrat ?? report.seatStrats[drawer]
      if (drawerStrat != null && allowsStrat(filter, drawerStrat)) {
        const decided = report.over && report.winner != null
        const won = decided && report.winner === drawer
        ancientDrawTotal.draws += 1
        if (decided) ancientDrawTotal.decided += 1
        if (won) ancientDrawTotal.wins += 1
        const stratRow = ancientStratAcc.get(drawerStrat) ?? { draws: 0, wins: 0, decided: 0 }
        stratRow.draws += 1
        if (decided) stratRow.decided += 1
        if (won) stratRow.wins += 1
        ancientStratAcc.set(drawerStrat, stratRow)
        const seatRow = ancientSeatAcc.get(drawer) ?? { draws: 0, wins: 0, decided: 0 }
        seatRow.draws += 1
        if (decided) seatRow.decided += 1
        if (won) seatRow.wins += 1
        ancientSeatAcc.set(drawer, seatRow)
      }
    }

    if (report.over && report.winner != null) {
      const winner = report.winner
      const winnerStrat = report.seatStrats[winner]
      if (winnerStrat != null && allowsStrat(filter, winnerStrat)) {
        const mid = midLeadSnapshot(report)
        const kind = mid ? leadOutcomeKind(mid.scores, winner) : null
        const stratLead = leadStratAcc.get(winnerStrat) ?? { wins: 0, heldLead: 0, contesting: 0, fromBehind: 0, samples: 0 }
        stratLead.wins += 1
        if (kind) {
          stratLead.samples += 1
          if (kind === 'held') stratLead.heldLead += 1
          else if (kind === 'contesting') stratLead.contesting += 1
          else stratLead.fromBehind += 1
        }
        leadStratAcc.set(winnerStrat, stratLead)

        const seatLead = leadSeatAcc.get(winner) ?? { wins: 0, heldLead: 0, contesting: 0, fromBehind: 0, samples: 0 }
        seatLead.wins += 1
        if (kind) {
          seatLead.samples += 1
          if (kind === 'held') seatLead.heldLead += 1
          else if (kind === 'contesting') seatLead.contesting += 1
          else seatLead.fromBehind += 1
        }
        leadSeatAcc.set(winner, seatLead)
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
        playWins: 0,
        destroy: 0,
        discard: 0,
        exile: 0,
        control: 0,
        bounce: 0,
        pressure: 0,
        impact: 0,
        horizon: IMPACT_HORIZONS.map(() => 0),
      }
      row.plays += 1
      row.actor += swing.actorSwing
      row.relative += swing.relativeSwing
      row.abs += Math.abs(swing.relativeSwing)
      if (report.over && report.winner === swing.actor) row.playWins += 1
      row.destroy += swing.destroy
      row.discard += swing.discard
      row.exile += swing.exile
      row.control += swing.control
      row.bounce += swing.bounce
      row.pressure += swing.pressure
      row.impact += impactFor(swing)
      swing.horizon?.forEach((value, index) => {
        row.horizon[index] = (row.horizon[index] ?? 0) + value
      })
      cardMap.set(key, row)

      const kind = kindMap.get(swing.kind) ?? { plays: 0, actor: 0, relative: 0 }
      kind.plays += 1
      kind.actor += swing.actorSwing
      kind.relative += swing.relativeSwing
      kindMap.set(swing.kind, kind)

      if (swing.bucket === 'hero' || swing.bucket === 'ability') {
        const attrKey = swing.attr ?? 'none'
        const attrRow = attrMap.get(attrKey) ?? { plays: 0, actor: 0, relative: 0 }
        attrRow.plays += 1
        attrRow.actor += swing.actorSwing
        attrRow.relative += swing.relativeSwing
        attrMap.set(attrKey, attrRow)
      }

      if (swing.kind === 'ability') {
        const type = abilityEffectType(swing.defId)
        const typeRow = abilityTypeMap.get(type) ?? { plays: 0, actor: 0, relative: 0, impact: 0, presence: 0, wins: 0 }
        typeRow.plays += 1
        typeRow.actor += swing.actorSwing
        typeRow.relative += swing.relativeSwing
        typeRow.impact += impactFor(swing)
        abilityTypeMap.set(type, typeRow)
        seatAbilityTypes[swing.actor]?.add(type)
      }

      const stratRow = stratMap.get(swing.actorStrat) ?? { ...emptyAgg(), seats: 0 }
      stratRow.plays += 1
      stratRow.actor += swing.actorSwing
      stratRow.relative += swing.relativeSwing
      stratMap.set(swing.actorStrat, stratRow)

      const seatRow = seatMap.get(swing.actor) ?? emptyAgg()
      seatRow.plays += 1
      seatRow.actor += swing.actorSwing
      seatRow.relative += swing.relativeSwing
      seatMap.set(swing.actor, seatRow)
    }

    if (report.over) {
      for (let seat = 0; seat < seatAbilityTypes.length; seat += 1) {
        if (!allowsStrat(filter, report.seatStrats[seat]!)) continue
        const won = report.winner === seat
        for (const type of seatAbilityTypes[seat] ?? []) {
          const typeRow = abilityTypeMap.get(type) ?? { plays: 0, actor: 0, relative: 0, impact: 0, presence: 0, wins: 0 }
          typeRow.presence += 1
          if (won) typeRow.wins += 1
          abilityTypeMap.set(type, typeRow)
        }
      }
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
    return finishCardRow({
      defId: row.defId,
      name: row.name,
      kind: row.kind,
      bucket: row.bucket,
      attr: row.attr,
      instant: row.instant,
      plays: row.plays,
      actor: row.actor,
      relative: row.relative,
      abs: row.abs,
      pressure: row.pressure,
      impact: row.impact,
      horizon: row.horizon,
      destroy: row.destroy,
      discard: row.discard,
      exile: row.exile,
      control: row.control,
      bounce: row.bounce,
      presence: presence.presence,
      wins: presence.wins,
      playWins: row.playWins,
      abilityPlays: 0,
      abilityWins: 0,
      silencedPlays: 0,
      silencedWins: 0,
    })
  })

  // Prefer cards with enough samples so one-off spikes don't dominate Rel tables.
  const minPlays = Math.max(1, Math.min(6, Math.floor(Math.max(1, finished.length) / 8)))
  const ranked = cards.filter((row) => row.kind !== 'draw' && row.plays >= minPlays)
  const heroRows = ranked.filter((row) => row.bucket === 'hero')
  const terrainRows = ranked.filter((row) => row.bucket === 'terrain')
  const lootRows = ranked.filter((row) => row.bucket === 'loot')
  // Include low-sample rows in full tables so sorting can surface rare cards.
  const allHeroRows = cards.filter((row) => row.bucket === 'hero')
  const allAbilityRows = cards.filter((row) => row.bucket === 'ability')
  const allTerrainRows = cards.filter((row) => row.bucket === 'terrain')
  const allLootRows = cards.filter((row) => row.bucket === 'loot')

  // Combined body+ability swings per hero play (playId), for total / silenced / open modes.
  const heroPlayModes = buildHeroPlayModes(scoped, filter, presenceMap, impactFor)

  const spreads = finished.map((report) => Math.max(...report.finalScores) - Math.min(...report.finalScores))
  const winnerScores = finished.map((report) => Math.max(...report.finalScores))
  const turnSeries = seriesFromTurnBuckets(ptsByTurn, cardsByTurn, filteringPlays)
  const matchCount = Math.max(1, scoped.length)
  const seats = scoped[0]?.seats ?? reports[0]?.seats ?? 0
  const maxTurn = Math.max(
    1,
    ...scoped.map((report) => report.turns),
    ...scoped.flatMap((report) => (report.shapeHistory ?? []).map((snap) => snap.turn)),
  )
  const heroNameMap = new Map<string, string>()
  for (const report of scoped) {
    for (const swing of report.swings) {
      if (swing.bucket === 'hero' || swing.bucket === 'ability') heroNameMap.set(swing.defId, swing.name)
    }
  }

  return {
    matches: scoped.length,
    finished: finished.length,
    seats,
    filter,
    avgTurns: average(finished.map((report) => report.turns)),
    avgFinalSpread: average(spreads),
    avgWinnerScore: average(winnerScores),
    cards: rankHigh(ranked),
    cardsLow: rankLow(ranked),
    heroes: allHeroRows,
    heroPlaysTotal: heroPlayModes.total,
    heroPlaysSilenced: heroPlayModes.silenced,
    heroPlaysOpen: heroPlayModes.open,
    abilities: allAbilityRows,
    terrains: allTerrainRows,
    loot: allLootRows,
    heroHigh: rankHigh(heroRows),
    heroLow: rankLow(heroRows),
    terrainHigh: rankHigh(terrainRows),
    terrainLow: rankLow(terrainRows),
    lootHigh: rankHigh(lootRows),
    lootLow: rankLow(lootRows),
    contested: [...ranked]
      .sort((a, b) => Math.abs(b.avgImpact) * Math.sqrt(b.plays) - Math.abs(a.avgImpact) * Math.sqrt(a.plays) || b.plays - a.plays)
      .slice(0, 48),
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
    byAbilityType: [...abilityTypeMap.entries()]
      .map(([id, row]) => ({
        id,
        label: ABILITY_EFFECT_LABELS[id],
        plays: row.plays,
        avgActorSwing: row.plays ? row.actor / row.plays : 0,
        avgRelativeSwing: row.plays ? row.relative / row.plays : 0,
        avgImpact: row.plays ? row.impact / row.plays : 0,
        presence: row.presence,
        wins: row.wins,
        winRate: row.presence ? row.wins / row.presence : 0,
      }))
      .sort((a, b) => Math.abs(b.avgImpact) - Math.abs(a.avgImpact) || b.plays - a.plays),
    byStrat: [...stratMap.entries()]
      .map(([strat, row]) => ({
        strat,
        seats: row.seats,
        wins: row.wins,
        finishes: row.finishes,
        avgScore: row.finishes ? row.score / row.finishes : 0,
        avgMargin: row.finishes ? row.margin / row.finishes : 0,
        avgStanding: row.finishes ? row.standing / row.finishes : 0,
        avgSelfSwing: row.plays ? row.actor / row.plays : 0,
        avgRelSwing: row.plays ? row.relative / row.plays : 0,
        plays: row.plays,
      }))
      .sort((a, b) => b.wins - a.wins || a.avgStanding - b.avgStanding || b.avgScore - a.avgScore),
    bySeat: [...seatMap.entries()]
      .map(([seat, row]) => ({
        seat,
        wins: row.wins,
        finishes: row.finishes,
        avgScore: row.finishes ? row.score / row.finishes : 0,
        avgMargin: row.finishes ? row.margin / row.finishes : 0,
        avgStanding: row.finishes ? row.standing / row.finishes : 0,
        avgSelfSwing: row.plays ? row.actor / row.plays : 0,
        avgRelSwing: row.plays ? row.relative / row.plays : 0,
        plays: row.plays,
      }))
      .sort((a, b) => a.seat - b.seat),
    shapeCompare: buildShapeCompareRows(shapeTotals, matchCount),
    eventStats: [
      eventRow('drawDeck', 'Draw from deck', eventTotals.drawDeck, matchCount),
      eventRow('drawGrave', 'Draw from grave', eventTotals.drawGrave, matchCount),
      eventRow('drawAction', 'Draw actions', eventTotals.drawAction, matchCount),
      eventRow('discard', 'Discard', eventTotals.discard, matchCount),
      eventRow('destroy', 'Destroy', eventTotals.destroy, matchCount),
      eventRow('exile', 'Exile', eventTotals.exile, matchCount),
      eventRow('steal', 'Control steal', eventTotals.steal, matchCount),
      eventRow('bounce', 'Bounce to hand', eventTotals.bounce, matchCount),
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
    maxTurn,
    graphHeroes: [...heroNameMap.entries()]
      .map(([defId, name]) => ({ defId, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    roundMilestones: ROUND_MILESTONES.map((round) => {
      const bucket = milestoneAcc.get(round)
      const seatN = Math.max(seats, bucket?.scoreBySeat.length ?? 0)
      const avgScoreBySeat = Array.from({ length: seatN }, (_, seat) => {
        const n = bucket?.seatSamples[seat] ?? 0
        return n ? (bucket!.scoreBySeat[seat] ?? 0) / n : 0
      })
      const avgHandBySeat = Array.from({ length: seatN }, (_, seat) => {
        const n = bucket?.seatSamples[seat] ?? 0
        return n ? (bucket!.handBySeat[seat] ?? 0) / n : 0
      })
      return {
        round,
        samples: bucket?.samples ?? 0,
        avgScoreBySeat,
        avgHandBySeat,
        samplesBySeat: Array.from({ length: seatN }, (_, seat) => bucket?.seatSamples[seat] ?? 0),
        byStrat: [...(bucket?.byStrat.entries() ?? [])]
          .map(([strat, row]) => ({
            strat,
            samples: row.samples,
            avgScore: row.samples ? row.score / row.samples : 0,
            avgHand: row.samples ? row.hand / row.samples : 0,
          }))
          .sort((a, b) => b.avgScore - a.avgScore || a.strat.localeCompare(b.strat)),
      }
    }),
    leadByStrat: [...leadStratAcc.entries()]
      .map(([strat, row]) => ({
        key: strat,
        kind: 'strat' as const,
        label: strat,
        wins: row.wins,
        heldLead: row.heldLead,
        contesting: row.contesting,
        fromBehind: row.fromBehind,
        samples: row.samples,
      }))
      .sort((a, b) => b.wins - a.wins || b.heldLead - a.heldLead),
    leadBySeat: [...leadSeatAcc.entries()]
      .map(([seat, row]) => ({
        key: `seat:${seat}`,
        kind: 'seat' as const,
        label: `Seat ${seat + 1}`,
        wins: row.wins,
        heldLead: row.heldLead,
        contesting: row.contesting,
        fromBehind: row.fromBehind,
        samples: row.samples,
      }))
      .sort((a, b) => Number(a.key.slice(5)) - Number(b.key.slice(5))),
    ancientDraws: [
      {
        key: 'total',
        kind: 'total' as const,
        label: 'All draws',
        draws: ancientDrawTotal.draws,
        wins: ancientDrawTotal.wins,
        decided: ancientDrawTotal.decided,
      },
      ...[...ancientStratAcc.entries()]
        .map(([strat, row]) => ({
          key: strat,
          kind: 'strat' as const,
          label: strat,
          draws: row.draws,
          wins: row.wins,
          decided: row.decided,
        }))
        .sort((a, b) => b.draws - a.draws || b.wins - a.wins),
      ...[...ancientSeatAcc.entries()]
        .map(([seat, row]) => ({
          key: `seat:${seat}`,
          kind: 'seat' as const,
          label: `Seat ${seat + 1}`,
          draws: row.draws,
          wins: row.wins,
          decided: row.decided,
        }))
        .sort((a, b) => Number(a.key.slice(5)) - Number(b.key.slice(5))),
    ].filter((row) => row.kind === 'total' || row.draws > 0),
    ancientReveals,
  }
}

/** Sole max-score seat, or null on a tie / empty. */
export function soleLeader(scores: number[]): number | null {
  if (scores.length === 0) return null
  let best = -Infinity
  let who: number | null = null
  let tied = false
  for (let i = 0; i < scores.length; i += 1) {
    const score = scores[i] ?? 0
    if (score > best) {
      best = score
      who = i
      tied = false
    } else if (score === best) {
      tied = true
    }
  }
  return tied ? null : who
}

/**
 * Winner vs best other seat at the mid checkpoint.
 * Margin within ±LEAD_CONTEST_BAND → contesting.
 */
export function leadOutcomeKind(scores: number[], winner: number): LeadKind {
  const mine = scores[winner] ?? 0
  let bestOther = -Infinity
  for (let i = 0; i < scores.length; i += 1) {
    if (i === winner) continue
    bestOther = Math.max(bestOther, scores[i] ?? 0)
  }
  if (!Number.isFinite(bestOther)) bestOther = mine
  const margin = mine - bestOther
  if (Math.abs(margin) <= LEAD_CONTEST_BAND) return 'contesting'
  return margin > 0 ? 'held' : 'behind'
}

/**
 * Mid-game checkpoint for lead analysis: latest milestone round strictly before
 * the final completed table-round (so the endgame itself is not the checkpoint).
 */
export function midLeadSnapshot(report: MatchReport): RoundSnapshot | null {
  const history = report.roundHistory ?? []
  if (history.length === 0) return null
  const finalRound = Math.max(...history.map((snap) => snap.round))
  const candidates = history
    .filter((snap) => (ROUND_MILESTONES as readonly number[]).includes(snap.round) && snap.round < finalRound)
    .sort((a, b) => b.round - a.round)
  if (candidates[0]) return candidates[0]!
  // Short games: use the earliest snapshot that is not the final round.
  const earlier = [...history].filter((snap) => snap.round < finalRound).sort((a, b) => b.round - a.round)
  return earlier[0] ?? null
}

/** Shape compare rows for a scrubber turn (`null` = final board). */
export function summarizeShapesAtTurn(
  reports: MatchReport[],
  filter: StratFilter,
  turn: number | null,
): ShapeCompareRow[] {
  const scoped = reports.filter((report) => {
    if (filter.mixOnly && !report.mixture) return false
    if (filter.strats.length === 0) return true
    return filter.strats.some((strat) => report.seatStrats.includes(strat))
  })
  const shapeTotals = EMPTY_SHAPES()
  let matchCount = 0
  for (const report of scoped) {
    matchCount += 1
    const snap =
      turn == null
        ? null
        : [...report.shapeHistory].reverse().find((entry) => entry.turn <= turn) ?? report.shapeHistory[0] ?? null
    const seats = snap ? snap.seatShapes : report.seatShapes
    for (let seat = 0; seat < report.seatStrats.length; seat += 1) {
      if (!allowsStrat(filter, report.seatStrats[seat]!)) continue
      addShapes(shapeTotals, seats[seat] ?? EMPTY_SHAPES())
    }
  }
  return buildShapeCompareRows(shapeTotals, Math.max(1, matchCount))
}

/** Average Y value by turn for the scrubber graph. */
export function buildTurnGraph(
  reports: MatchReport[],
  filter: StratFilter,
  metric: TurnGraphMetric,
  heroDefId: string | null = null,
): TurnGraphPoint[] {
  const scoped = reports.filter((report) => {
    if (filter.mixOnly && !report.mixture) return false
    if (filter.strats.length === 0) return true
    return filter.strats.some((strat) => report.seatStrats.includes(strat))
  })
  const buckets = new Map<number, number[]>()
  const push = (turn: number, value: number) => {
    const list = buckets.get(turn) ?? []
    list.push(value)
    buckets.set(turn, list)
  }

  if (metric === 'rel' || metric === 'self') {
    for (const report of scoped) {
      const byPlay = new Map<number, SwingEvent[]>()
      for (const swing of report.swings) {
        if (!allowsStrat(filter, swing.actorStrat)) continue
        if (heroDefId && swing.defId !== heroDefId) continue
        if (swing.bucket !== 'hero' && swing.bucket !== 'ability') continue
        if (swing.playId == null) {
          push(swing.turn, metric === 'rel' ? swing.relativeSwing : swing.actorSwing)
          continue
        }
        const list = byPlay.get(swing.playId) ?? []
        list.push(swing)
        byPlay.set(swing.playId, list)
      }
      for (const group of byPlay.values()) {
        const turn = group[0]!.turn
        const value = group.reduce(
          (sum, swing) => sum + (metric === 'rel' ? swing.relativeSwing : swing.actorSwing),
          0,
        )
        push(turn, value)
      }
    }
  } else if (metric === 'seatScore') {
    for (const report of scoped) {
      for (const snap of report.shapeHistory) {
        for (let seat = 0; seat < report.seatStrats.length; seat += 1) {
          if (!allowsStrat(filter, report.seatStrats[seat]!)) continue
          push(snap.turn, snap.scores[seat] ?? 0)
        }
      }
    }
  } else {
    for (const report of scoped) {
      for (const round of report.rounds) {
        if (!allowsStrat(filter, round.actorStrat)) continue
        push(round.turn, metric === 'cards' ? round.cardsPlayed : round.pointsDelta)
      }
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, values]) => ({
      turn,
      value: values.reduce((sum, n) => sum + n, 0) / values.length,
      samples: values.length,
    }))
}

function maxCoreTeamPoints(): number {
  const rules = getScoreRules()
  return rules.heroPoints * 5 + (rules.coreBonus[4] ?? 0)
}

function maxMixTeamPoints(): number {
  const rules = getScoreRules()
  // Peak non-pure-core board: 4-attr mix + ATK, or CORE×3 + MIXED×3 (no ATK), or CORE×4 splash.
  const mixAtk = (rules.mixBonus[3] ?? 0) + (rules.attackOnMix ? (rules.attackBonus[4] ?? 0) : 0)
  const coreMix = (rules.coreBonus[2] ?? 0) + (rules.mixBonus[2] ?? 0)
  const coreSplash = rules.coreBonus[3] ?? 0
  return rules.heroPoints * 5 + Math.max(mixAtk, coreMix, coreSplash)
}

function buildShapeCompareRows(shapeTotals: ShapeCounts, matchCount: number): ShapeCompareRow[] {
  const coreStackN = shapeTotals.coreTeams3 + shapeTotals.coreTeams4 + shapeTotals.coreTeams5
  const pureCoreN = shapeTotals.pureCore3 + shapeTotals.pureCore4 + shapeTotals.pureCore5
  return [
    shapeRow('core_team', 'Core team', coreStackN, shapeTotals.coreTeamPoints, shapeTotals.coreTeamHeroes, pureCoreN, matchCount, coreStackN, maxCoreTeamPoints()),
    shapeRow('core_team_3', 'Core ×3 same attr', shapeTotals.coreTeams3, shapeTotals.coreTeamPoints3, shapeTotals.coreTeamHeroes3, shapeTotals.pureCore3, matchCount, shapeTotals.coreTeams3, maxCoreTeamPoints()),
    shapeRow('core_team_4', 'Core ×4 same attr', shapeTotals.coreTeams4, shapeTotals.coreTeamPoints4, shapeTotals.coreTeamHeroes4, shapeTotals.pureCore4, matchCount, shapeTotals.coreTeams4, maxCoreTeamPoints()),
    shapeRow('core_team_5', 'Core ×5 same attr', shapeTotals.coreTeams5, shapeTotals.coreTeamPoints5, shapeTotals.coreTeamHeroes5, shapeTotals.pureCore5, matchCount, shapeTotals.coreTeams5, maxCoreTeamPoints()),
    shapeRow('mix_team', 'Mixed team', shapeTotals.mixTeams, shapeTotals.mixTeamPoints, shapeTotals.mixTeamHeroes, shapeTotals.pureMix3 + shapeTotals.pureMix4, matchCount, shapeTotals.mixTeams, maxMixTeamPoints()),
    shapeRow('mix_team_3', 'Mixed · 3 attrs', shapeTotals.mixTeams3, shapeTotals.mixTeamPoints3, shapeTotals.mixTeamHeroes3, shapeTotals.pureMix3, matchCount, shapeTotals.mixTeams3, maxMixTeamPoints()),
    shapeRow('mix_team_4', 'Mixed · 4 attrs', shapeTotals.mixTeams4, shapeTotals.mixTeamPoints4, shapeTotals.mixTeamHeroes4, shapeTotals.pureMix4, matchCount, shapeTotals.mixTeams4, maxMixTeamPoints()),
    shapeRow('small_team_1', 'Small · 1 hero', shapeTotals.smallTeams1, shapeTotals.smallTeamPoints1, shapeTotals.smallTeamHeroes1, null, matchCount, shapeTotals.smallTeams1),
    shapeRow('small_team_2', 'Small · 2 heroes', shapeTotals.smallTeams2, shapeTotals.smallTeamPoints2, shapeTotals.smallTeamHeroes2, null, matchCount, shapeTotals.smallTeams2),
    shapeRow('river_terrain', 'River · 3 alike', shapeTotals.riverTerrains, shapeTotals.riverTerrainPoints, shapeTotals.riverTerrains * 3, null, matchCount),
    shapeRow('jungle_terrain', 'Jungle · 3 alike', shapeTotals.jungleTerrains, shapeTotals.jungleTerrainPoints, shapeTotals.jungleTerrains * 3, null, matchCount),
    shapeRow('lane_terrain', 'Lane · 3 alike', shapeTotals.laneTerrains, shapeTotals.laneTerrainPoints, shapeTotals.laneTerrains * 3, null, matchCount),
    shapeRow('mix_terrain', '1 of each · River+Jungle+Lane', shapeTotals.mixTerrains, shapeTotals.mixTerrainPoints, shapeTotals.mixTerrains * 3, null, matchCount),
    shapeRow('pair_terrain', 'Mixed combo · 2 + 1', shapeTotals.pairTerrains, shapeTotals.pairTerrainPoints, shapeTotals.pairTerrains * 3, null, matchCount),
  ]
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
  pureCount: number | null,
  matches: number,
  /** Denominator for avg pts (defaults to `count`). */
  pointsDenom: number = count,
  /** Sanity cap for a single team score under current rules (core ≤15, mix ≤12 by default). */
  maxTeamPoints?: number,
): ShapeCompareRow {
  const denom = pointsDenom > 0 ? pointsDenom : 0
  const rawAvg = denom ? points / denom : 0
  // Cap protects balancing UI if a stale sample slips in; raw still visible via totalPoints/count.
  const avgPoints = maxTeamPoints != null ? Math.min(rawAvg, maxTeamPoints) : rawAvg
  return {
    id,
    label,
    count,
    avgCount: count / matches,
    totalPoints: points,
    avgPoints,
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

export function runMatchFast(seed: number, seats: number, strats?: AiStrat[], guard = 2500): MatchReport {
  let game = createGame({ seed, seats: aiRoster(seats, strats, seed) })
  const tracker = new BalanceTracker(seed, { lite: true })
  tracker.start(game)
  let steps = 0
  let noProgress = 0
  let endsWithoutDeckDrop = 0
  let lastDeck = game.deck.length
  let lastMark = matchMark(game)
  while (!game.over && steps < guard) {
    steps += 1
    const beforeMark = matchMark(game)

    try {
      if (game.veil) {
        const before = game
        game = apply(game, { type: 'ready' })
        tracker.observe(before, { type: 'ready' }, game)
      } else if (game.pending) {
        const before = game
        const ids = chooseAiPendingForSeat(game)
        game = apply(game, { type: 'choose', ids })
        tracker.observe(before, { type: 'choose', ids }, game)
        if (game.pending && pendingKey(game.pending) === pendingKey(before.pending)) {
          game = { ...game, pending: null, log: [...game.log, 'Forced past a stuck choice.'] }
        }
      } else {
        const strat = game.players[game.active]?.strat ?? DEFAULT_STRAT
        const mode = searchModeForStrat(strat, true)
        const action = chooseAiAction(game, mode)
        const before = game
        game = apply(game, action)
        tracker.observe(before, action, game)
        if (action.type === 'end') {
          if (game.deck.length >= lastDeck) endsWithoutDeckDrop += 1
          else {
            lastDeck = game.deck.length
            endsWithoutDeckDrop = 0
          }
        } else if (game.deck.length < lastDeck) {
          lastDeck = game.deck.length
          endsWithoutDeckDrop = 0
        }
      }

      if (game.veil) {
        const before = game
        game = apply(game, { type: 'ready' })
        tracker.observe(before, { type: 'ready' }, game)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'sim error'
      game = softFinish(game, `Match halted (${reason}).`)
      break
    }

    const afterMark = matchMark(game)
    if (afterMark === beforeMark) {
      noProgress += 1
      try {
        game = nudgeStuck(game, tracker, noProgress)
      } catch {
        game = softFinish(game, 'Match halted (soft-lock).')
        break
      }
    } else if (afterMark === lastMark) {
      noProgress += 1
      if (noProgress >= 6) {
        try {
          game = nudgeStuck(game, tracker, noProgress)
        } catch {
          game = softFinish(game, 'Match halted (soft-lock).')
          break
        }
      }
    } else {
      noProgress = 0
      lastMark = afterMark
    }

    // Recycle loops / endless final-round thrash — cut them short with distinct reasons.
    if (endsWithoutDeckDrop >= 16) {
      game = softFinish(game, 'Match halted (recycle loop).')
      break
    }
    if (noProgress >= 14) {
      game = softFinish(game, 'Match halted (soft-lock).')
      break
    }
    if (steps >= 700) {
      game = softFinish(game, 'Match halted (step cap).')
      break
    }
  }
  if (!game.over) game = softFinish(game, 'Match halted (soft-lock).')
  return tracker.finish(game)
}

function pendingKey(pending: Game['pending']): string {
  if (!pending) return ''
  return `${pending.actor}|${pending.resume.kind}|${pending.prompt}|${pending.choices.length}|${pending.min}|${pending.max}`
}

function matchMark(game: Game): string {
  return [
    game.turn,
    game.active,
    game.deck.length,
    game.grave.length,
    game.exile.length,
    game.veil ? 1 : 0,
    game.ancient?.endsLeft ?? '-',
    pendingKey(game.pending),
    game.players.map((player) => `${player.actions}:${player.hand.length}:${player.teams.length}`).join('|'),
  ].join('/')
}

function nudgeStuck(game: Game, tracker: BalanceTracker, depth: number): Game {
  if (game.over) return game
  if (game.veil) {
    const before = game
    const next = apply(game, { type: 'ready' })
    tracker.observe(before, { type: 'ready' }, next)
    return next
  }
  if (game.pending) {
    const before = game
    const ids = chooseAiPendingForSeat(game)
    let next = apply(game, { type: 'choose', ids })
    tracker.observe(before, { type: 'choose', ids }, next)
    if (next.pending && pendingKey(next.pending) === pendingKey(before.pending)) {
      next = { ...next, pending: null, log: [...next.log, 'Forced past a stuck choice.'] }
    }
    return next
  }
  // Escalating escapes: discard → end → hard clear.
  if (depth >= 3) {
    const hand = game.players[game.active]?.hand ?? []
    const terrain = hand.find((card) => card.kind === 'terrain')
    const any = terrain ?? hand[0]
    if (any && game.players[game.active]!.actions > 0) {
      const before = game
      const next = apply(game, { type: 'discard', uid: any.uid })
      if (matchMark(next) !== matchMark(before)) {
        tracker.observe(before, { type: 'discard', uid: any.uid }, next)
        return next
      }
    }
  }
  if (depth >= 5) {
    const before = game
    let next = apply(game, { type: 'end' })
    tracker.observe(before, { type: 'end' }, next)
    if (next.veil) {
      const veiled = next
      next = apply(next, { type: 'ready' })
      tracker.observe(veiled, { type: 'ready' }, next)
    }
    if (matchMark(next) !== matchMark(before)) return next
  }
  if (depth >= 10) {
    return softFinish(game, 'Match halted (soft-lock).')
  }
  return game
}

function softFinish(game: Game, reason: string): Game {
  const parts = game.players.map((player) => scoreState(game, player.id))
  const scores = parts.map((part) => part.total)
  return {
    ...game,
    pending: null,
    veil: false,
    queue: [],
    echoes: [],
    laterCasts: [],
    after: null,
    pendingDraws: [],
    over: { reason, scores, parts },
    log: [...game.log, reason],
  }
}

function relBucket(kind: PlayKind, defId: string): RelBucket {
  if (kind === 'ability') return 'ability'
  if (kind === 'hero' || kind === 'morph') return 'hero'
  if (
    kind === 'combo'
    || kind === 'terrain'
    || defId === 'mixed_path'
    || defId === 'one_of_each'
    || defId === 'pair_combo'
    || defId === 'river'
    || defId === 'jungle'
    || defId === 'lane'
  ) {
    return 'terrain'
  }
  if (kind === 'item' || kind === 'rune' || kind === 'neutral' || kind === 'tower') return 'loot'
  return 'other'
}

/** Primary effect family from hero text (one label per ability activation). */
export function abilityEffectType(defId: string): AbilityEffectType {
  const hero = HERO_BY_ID[defId]
  if (!hero) return 'other'
  if (hero.timing === 'trap') return 'trap'
  const t = hero.text.toLowerCase()
  if (/destroy/.test(t)) return 'destroy'
  if (/exile/.test(t)) return 'exile'
  if (/return .* (hand|deck)|put .* (top|bottom) of the deck|bounce/.test(t)) return 'bounce'
  if (/take control|steal|swap control|swap hands|swap .* team/.test(t)) return 'control'
  if (/move |redistribute|form a new team/.test(t)) return 'move'
  if (/cannot (play|draw|activate|reactivate)|lose(?:s)? (?:their )?remaining actions|skip their next turn|lose an action/.test(t)) return 'deny'
  if (/immune|cannot be destroyed|return it to your hand instead|shallow grave|false promise/.test(t)) return 'protect'
  if (/draw |reveal the top|search the deck|take .* from the grave/.test(t)) return 'draw'
  if (/discard/.test(t)) return 'discard'
  if (/reveal/.test(t)) return 'reveal'
  return 'other'
}

/** Largest mono-attribute stack on the team. Multi-attr heroes do not pad a stack. */
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
  // When a core stack is active, strip attack bonus from reported shape points.
  const noAtk = { ...getScoreRules(), attackOnCore: false, attackOnMix: false }
  for (const team of player.teams) {
    const scored = scoreTeam(game, team)
    const size = team.heroes.length
    const sameAttr = maxSameAttrStackFor(game, team)
    const distinctAttrs = distinctAttrCount(game, team)
    const hasCore = size >= 3 && sameAttr >= 3
    const hasMix = size >= 3 && distinctAttrs >= 3
    const corePts = hasCore ? scoreTeam(game, team, noAtk).points : scored.points
    const mixPts = hasCore ? corePts : scored.points

    if (hasCore) {
      shapes.coreTeams += 1
      shapes.coreTeamPoints += corePts
      shapes.coreTeamHeroes += size
      if (sameAttr === 3) {
        shapes.coreTeams3 += 1
        shapes.coreTeamPoints3 += corePts
        shapes.coreTeamHeroes3 += size
        if (distinctAttrs === 1) shapes.pureCore3 += 1
      } else if (sameAttr === 4) {
        shapes.coreTeams4 += 1
        shapes.coreTeamPoints4 += corePts
        shapes.coreTeamHeroes4 += size
        if (distinctAttrs === 1) shapes.pureCore4 += 1
      } else {
        shapes.coreTeams5 += 1
        shapes.coreTeamPoints5 += corePts
        shapes.coreTeamHeroes5 += size
        if (distinctAttrs === 1) shapes.pureCore5 += 1
      }
    }

    // Dual-count: a 3× core with 3+ attrs also lands in mix ×attrs.
    if (hasMix) {
      shapes.mixTeams += 1
      shapes.mixTeamPoints += mixPts
      shapes.mixTeamHeroes += size
      if (distinctAttrs === 3) {
        shapes.mixTeams3 += 1
        shapes.mixTeamPoints3 += mixPts
        shapes.mixTeamHeroes3 += size
        if (size === 3) shapes.pureMix3 += 1
      } else {
        shapes.mixTeams4 += 1
        shapes.mixTeamPoints4 += mixPts
        shapes.mixTeamHeroes4 += size
        if (size === distinctAttrs) shapes.pureMix4 += 1
      }
    }

    if (!hasCore && !hasMix) {
      shapes.openTeams += 1
      if (size === 1) {
        shapes.smallTeams1 += 1
        shapes.smallTeamPoints1 += scored.points
        shapes.smallTeamHeroes1 += 1
      } else if (size === 2) {
        shapes.smallTeams2 += 1
        shapes.smallTeamPoints2 += scored.points
        shapes.smallTeamHeroes2 += 2
      }
    }
  }
  for (const combo of player.combos) {
    if (combo.kind === 'mixed') {
      shapes.mixTerrains += 1
      shapes.mixTerrainPoints += combo.points
    } else if (combo.kind === 'pair') {
      shapes.pairTerrains += 1
      shapes.pairTerrainPoints += combo.points
    } else if (combo.kind === 'river') {
      shapes.coreTerrains += 1
      shapes.coreTerrainPoints += combo.points
      shapes.riverTerrains += 1
      shapes.riverTerrainPoints += combo.points
    } else if (combo.kind === 'jungle') {
      shapes.coreTerrains += 1
      shapes.coreTerrainPoints += combo.points
      shapes.jungleTerrains += 1
      shapes.jungleTerrainPoints += combo.points
    } else if (combo.kind === 'lane') {
      shapes.coreTerrains += 1
      shapes.coreTerrainPoints += combo.points
      shapes.laneTerrains += 1
      shapes.laneTerrainPoints += combo.points
    }
  }
  return shapes
}

function distinctAttrCount(game: Game, team: Team): number {
  const union = new Set<string>()
  for (const hero of team.heroes) {
    for (const attr of attrsOf(game, hero)) union.add(attr)
  }
  return union.size
}

function buildHeroPlayModes(
  reports: MatchReport[],
  filter: StratFilter,
  presenceMap: Map<string, { presence: number; wins: number }>,
  impactFor: (swing: SwingEvent) => number,
): { total: CardBalanceRow[]; silenced: CardBalanceRow[]; open: CardBalanceRow[] } {
  type PlayAgg = {
    defId: string
    name: string
    attr: Attr | null
    instant: boolean
    actorStrat: AiStrat
    /** Ability suppressed on this play. */
    silenced: boolean
    /** Seat won the finished match. */
    won: boolean
    actor: number
    relative: number
    destroy: number
    discard: number
    exile: number
    control: number
    bounce: number
    pressure: number
    impact: number
    horizon: number[]
  }
  const plays: PlayAgg[] = []
  for (const report of reports) {
    const byId = new Map<number, SwingEvent[]>()
    for (const swing of report.swings) {
      if (!allowsStrat(filter, swing.actorStrat)) continue
      if (swing.bucket !== 'hero' && swing.bucket !== 'ability') continue
      if (swing.playId == null) continue
      const list = byId.get(swing.playId) ?? []
      list.push(swing)
      byId.set(swing.playId, list)
    }
    for (const group of byId.values()) {
      const head = group[0]!
      const silenced = group.some((swing) => swing.silenced)
      plays.push({
        defId: head.defId,
        name: head.name,
        attr: head.attr,
        instant: head.instant,
        actorStrat: head.actorStrat,
        silenced,
        won: !!report.over && report.winner === head.actor,
        actor: group.reduce((sum, swing) => sum + swing.actorSwing, 0),
        relative: group.reduce((sum, swing) => sum + swing.relativeSwing, 0),
        destroy: group.reduce((sum, swing) => sum + swing.destroy, 0),
        discard: group.reduce((sum, swing) => sum + swing.discard, 0),
        exile: group.reduce((sum, swing) => sum + swing.exile, 0),
        control: group.reduce((sum, swing) => sum + swing.control, 0),
        bounce: group.reduce((sum, swing) => sum + swing.bounce, 0),
        pressure: group.reduce((sum, swing) => sum + swing.pressure, 0),
        // Horizons run from the body placement, so the ability frame is not counted twice.
        impact: impactFor(head),
        horizon: head.horizon ?? IMPACT_HORIZONS.map(() => 0),
      })
    }
  }

  type RowAgg = {
    defId: string
    name: string
    attr: Attr | null
    instant: boolean
    plays: number
    actor: number
    relative: number
    abs: number
    destroy: number
    discard: number
    exile: number
    control: number
    bounce: number
    pressure: number
    impact: number
    horizon: number[]
    playWins: number
    abilityPlays: number
    abilityWins: number
    silencedPlays: number
    silencedWins: number
  }

  const toRows = (subset: PlayAgg[], opts?: { lockSilenced?: boolean; lockOpen?: boolean }): CardBalanceRow[] => {
    const map = new Map<string, RowAgg>()
    for (const play of subset) {
      const row = map.get(play.defId) ?? {
        defId: play.defId,
        name: play.name,
        attr: play.attr,
        instant: play.instant,
        plays: 0,
        actor: 0,
        relative: 0,
        abs: 0,
        destroy: 0,
        discard: 0,
        exile: 0,
        control: 0,
        bounce: 0,
        pressure: 0,
        impact: 0,
        horizon: IMPACT_HORIZONS.map(() => 0),
        playWins: 0,
        abilityPlays: 0,
        abilityWins: 0,
        silencedPlays: 0,
        silencedWins: 0,
      }
      row.plays += 1
      row.actor += play.actor
      row.relative += play.relative
      row.abs += Math.abs(play.relative)
      row.destroy += play.destroy
      row.discard += play.discard
      row.exile += play.exile
      row.control += play.control
      row.bounce += play.bounce
      row.pressure += play.pressure
      row.impact += play.impact
      play.horizon.forEach((value, index) => {
        row.horizon[index] = (row.horizon[index] ?? 0) + value
      })
      if (play.won) row.playWins += 1
      // Always accumulate ability/silenced partitions from the full play flags,
      // even when the subset is already filtered (mode tables stay comparable).
      if (play.silenced) {
        row.silencedPlays += 1
        if (play.won) row.silencedWins += 1
      } else {
        row.abilityPlays += 1
        if (play.won) row.abilityWins += 1
      }
      map.set(play.defId, row)
    }
    return [...map.values()].map((row) => {
      const presence = presenceMap.get(row.defId) ?? { presence: 0, wins: 0 }
      // Mode views: when locked to silenced/open, ability/silenced counts mirror that slice.
      const abilityPlays = opts?.lockSilenced ? 0 : opts?.lockOpen ? row.plays : row.abilityPlays
      const abilityWins = opts?.lockSilenced ? 0 : opts?.lockOpen ? row.playWins : row.abilityWins
      const silencedPlays = opts?.lockOpen ? 0 : opts?.lockSilenced ? row.plays : row.silencedPlays
      const silencedWins = opts?.lockOpen ? 0 : opts?.lockSilenced ? row.playWins : row.silencedWins
      return finishCardRow({
        defId: row.defId,
        name: row.name,
        kind: 'hero',
        bucket: 'hero',
        attr: row.attr,
        instant: row.instant,
        plays: row.plays,
        actor: row.actor,
        relative: row.relative,
        abs: row.abs,
        pressure: row.pressure,
        impact: row.impact,
        horizon: row.horizon,
        destroy: row.destroy,
        discard: row.discard,
        exile: row.exile,
        control: row.control,
        bounce: row.bounce,
        presence: presence.presence,
        wins: presence.wins,
        playWins: row.playWins,
        abilityPlays,
        abilityWins,
        silencedPlays,
        silencedWins,
      })
    })
  }

  return {
    total: toRows(plays),
    silenced: toRows(
      plays.filter((play) => play.silenced),
      { lockSilenced: true },
    ),
    open: toRows(
      plays.filter((play) => !play.silenced),
      { lockOpen: true },
    ),
  }
}

type CardRowParts = {
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
  pressure: number
  impact: number
  horizon: number[]
  destroy: number
  discard: number
  exile: number
  control: number
  bounce: number
  presence: number
  wins: number
  playWins: number
  abilityPlays: number
  abilityWins: number
  silencedPlays: number
  silencedWins: number
}

function finishCardRow(parts: CardRowParts): CardBalanceRow {
  const plays = parts.plays
  return {
    defId: parts.defId,
    name: parts.name,
    kind: parts.kind,
    bucket: parts.bucket,
    attr: parts.attr,
    instant: parts.instant,
    plays,
    avgActorSwing: plays ? parts.actor / plays : 0,
    avgRelativeSwing: plays ? parts.relative / plays : 0,
    avgAbsSwing: plays ? parts.abs / plays : 0,
    totalActorSwing: parts.actor,
    presence: parts.presence,
    wins: parts.wins,
    winRate: parts.presence ? parts.wins / parts.presence : 0,
    playWins: parts.playWins,
    playWinRate: plays ? parts.playWins / plays : 0,
    abilityPlays: parts.abilityPlays,
    abilityWins: parts.abilityWins,
    abilityWinRate: parts.abilityPlays ? parts.abilityWins / parts.abilityPlays : 0,
    silencedPlays: parts.silencedPlays,
    silencedWins: parts.silencedWins,
    silencedWinRate: parts.silencedPlays ? parts.silencedWins / parts.silencedPlays : 0,
    avgPressure: plays ? parts.pressure / plays : 0,
    avgImpact: plays ? parts.impact / plays : 0,
    avgHorizon: parts.horizon.map((value) => (plays ? value / plays : 0)),
    avgDestroy: plays ? parts.destroy / plays : 0,
    avgDiscard: plays ? parts.discard / plays : 0,
    avgExile: plays ? parts.exile / plays : 0,
    avgSteal: plays ? parts.control / plays : 0,
    avgBounce: plays ? parts.bounce / plays : 0,
  }
}

function cardMap(cards: CardInst[]): Map<string, CardInst> {
  return new Map(cards.map((card) => [card.uid, card]))
}

function allHandsMap(game: Game): Map<string, CardInst> {
  const map = new Map<string, CardInst>()
  for (const player of game.players) {
    for (const card of player.hand) map.set(card.uid, card)
  }
  return map
}

function boardHeroMap(game: Game): Map<string, { defId: string; controller: number }> {
  const map = new Map<string, { defId: string; controller: number }>()
  for (const player of game.players) {
    for (const team of player.teams) {
      for (const hero of team.heroes) {
        map.set(hero.uid, { defId: hero.defId, controller: hero.controller })
      }
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

/** Seat score minus the mean opponent (the Rel used throughout Stats). */
function relOf(scores: number[], seat: number): number {
  return (scores[seat] ?? 0) - mean(scores.filter((_, id) => id !== seat))
}

/**
 * Per-play Impact: each horizon's rel change minus the mean change of every play at the
 * same stage of the game (4-turn buckets), blended by IMPACT_WEIGHTS. Positive = the play
 * left its seat better off over the following turns than a typical play did.
 */
function impactBaseline(reports: MatchReport[], filter: StratFilter): (swing: SwingEvent) => number {
  const sums = new Map<number, { n: number; h: number[] }>()
  const bucketOf = (turn: number) => Math.min(15, Math.floor(Math.max(0, turn - 1) / 4))
  for (const report of reports) {
    for (const swing of report.swings) {
      if (!swing.horizon || !allowsStrat(filter, swing.actorStrat)) continue
      const bucket = sums.get(bucketOf(swing.turn)) ?? { n: 0, h: IMPACT_HORIZONS.map(() => 0) }
      bucket.n += 1
      swing.horizon.forEach((value, index) => {
        bucket.h[index] = (bucket.h[index] ?? 0) + value
      })
      sums.set(bucketOf(swing.turn), bucket)
    }
  }
  return (swing) => {
    if (!swing.horizon) return 0
    const bucket = sums.get(bucketOf(swing.turn))
    if (!bucket || bucket.n === 0) return 0
    return swing.horizon.reduce((sum, value, index) => sum + IMPACT_WEIGHTS[index]! * (value - bucket.h[index]! / bucket.n), 0)
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
