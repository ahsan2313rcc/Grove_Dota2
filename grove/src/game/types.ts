export type PlayerId = number
export type Attr = 'STR' | 'AGI' | 'INT' | 'UNI'
export type Range = 'Melee' | 'Ranged'
export type TerrainKind = 'river' | 'jungle' | 'lane'
export type CardKind = 'hero' | 'item' | 'terrain' | 'rune' | 'neutral' | 'tower' | 'ancient'
export type Timing = 'cast' | 'aura' | 'instant' | 'trap'
export type AiStrat = 'balanced' | 'tempo' | 'architect' | 'spite' | 'neural'

export interface CardInst {
  uid: string
  defId: string
  kind: CardKind
}

export interface Timed {
  caster: PlayerId
  fromTurn: number
}

export interface BoardHero {
  uid: string
  defId: string
  owner: PlayerId
  controller: PlayerId
  enteredTurn: number
  enteredSeq: number
  attrMode: 'base' | 'none' | 'set'
  attrSet: Attr[]
  gained: Attr | null
  token: boolean
  roshan: boolean
  rupture: boolean
  omni: boolean
  abaddon: boolean
  shield: Timed | null
  ward: Timed | null
  hidden: Timed | null
  bkb: Timed | null
  /** Io Tether: cannot be destroyed during this game turn. */
  tether: number | null
  muted: boolean
  dawn: { caster: PlayerId; turn: number } | null
  wk: boolean
  refract: boolean
  held: { card: CardInst; owner: PlayerId; mode: 'morph' | 'razor'; takenTurn: number } | null
  castTurn: number
}

/** Face-down trap hero attached to a team (does not count as a board hero). */
export interface TeamTrap {
  uid: string
  defId: string
  owner: PlayerId
}

export interface Team {
  id: string
  heroes: BoardHero[]
  gaze: boolean
  noEnter: Timed | null
  noLeave: Timed | null
  glyph: Timed | null
  /** Juggernaut Blade Fury: destroy an enemy when a hero here activates. */
  blade: Timed | null
  /** @deprecated legacy Techies mine; prefer `trap`. */
  mine: CardInst | null
  trap: TeamTrap | null
  /** Templar Assassin ward: heroes here cannot be destroyed until the controller's next turn. */
  guard: Timed | null
}

export interface Combo {
  id: string
  owner: PlayerId
  cards: CardInst[]
  points: number
  kind: TerrainKind | 'mixed' | 'pair'
  protectedBy: string | null
}

export interface Player {
  id: PlayerId
  name: string
  ai: boolean
  strat: AiStrat
  hand: CardInst[]
  teams: Team[]
  combos: Combo[]
  actions: number
  skip: boolean
  noHeroNext: boolean
  noHeroNow: boolean
  /** Orchid: this seat cannot activate abilities until the caster's next turn. */
  orchid: Timed | null
  bkb: Timed | null
  mailTurn: number | null
  handLimit: number
}

export interface GraveMark {
  card: CardInst
  turn: number
  origin:
    | { type: 'hand'; player: PlayerId }
    | { type: 'board'; hero: BoardHero; teamId: string }
    | { type: 'deck' }
}

export interface Choice {
  id: string
  label: string
  hint?: string
  defId?: string
}

export interface CastResume {
  kind: 'cast'
  actor: PlayerId
  sourceUid: string
  defId: string
  picked: string[]
  echo?: boolean
  armed?: boolean
  /** Instant interrupt window already opened for this cast. */
  windowed?: boolean
  steps?: number
  /** Blade Fury tax already collected for this cast. */
  juggPaid?: boolean
}

export type Resume =
  | CastResume
  | { kind: 'save'; uid: string; cause: string; force: boolean }
  | { kind: 'counter'; uid: string; team: string; actor: PlayerId; extras?: string[]; fromGrave?: boolean }
  | { kind: 'pugna'; cast: CastResume }
  | { kind: 'venomancer'; cast: CastResume }
  /** Opponents may play an Instant before a hero ability fires. */
  | { kind: 'instant-window'; cast: CastResume; heroUid: string; seats: PlayerId[]; index: number }
  /** Instant hero from interrupt — pick a team before seating. */
  | { kind: 'instant-place'; cast: CastResume; heroUid: string; seats: PlayerId[]; index: number; cardUid: string }
  | { kind: 'free-play-offer'; uid: string; actor: PlayerId }
  | { kind: 'torment'; heroUid: string; cast: CastResume | null }
  | { kind: 'slark-trap'; owner: PlayerId; card: CardInst }
  | { kind: 'bounty-trap'; controller: PlayerId; target: PlayerId | null }
  | { kind: 'ancient-place'; actor: PlayerId; card: CardInst }
  | { kind: 'limit'; player: PlayerId; then: 'end' | 'none' }
  | { kind: 'sand'; players: PlayerId[]; index: number }
  | { kind: 'kunkka-split'; cards: string[]; picker: PlayerId }
  | { kind: 'kunkka-choose'; pileA: string[]; pileB: string[]; picker: PlayerId }
  | { kind: 'io'; cards: string[]; actor: PlayerId }
  | { kind: 'beast'; heroes: string[]; actor: PlayerId }
  | { kind: 'keep'; heroes: string[]; teamId: string; mode: 'destroy' | 'hand'; actor: PlayerId }
  | { kind: 'wyvern'; heroes: string[]; actor: PlayerId }
  | { kind: 'bristle'; actor: PlayerId }
  | { kind: 'mail'; actor: PlayerId }
  | { kind: 'pa'; rest: PlayerId[] }
  | { kind: 'tinker'; actor: PlayerId; cardUid: string }
  | { kind: 'alive'; uid: string; cast: CastResume }
  | { kind: 'kez-trap'; teamId: string; trap: TeamTrap; card: CardInst }
  | { kind: 'shaman-trap'; teamId: string; trap: TeamTrap; card: CardInst }
  | { kind: 'jugg-kill'; actor: PlayerId; after: CastResume }
  | { kind: 'discard'; player: PlayerId; n: number; cause: string }
  | { kind: 'weaver-ancient'; actor: PlayerId; card: CardInst }
  | { kind: 'restack'; actor: PlayerId; cards: string[]; placed: string[] }
  /** Opponents may play an Instant after the active player's action resolves. */
  | { kind: 'response' }
  | { kind: 'response-place'; cardUid: string }

export interface Pending {
  actor: PlayerId
  prompt: string
  mode: 'pick' | 'look' | 'split' | 'assign' | 'groups' | 'keep'
  choices: Choice[]
  min: number
  max: number
  resume: Resume
}

export interface StackDestroy {
  uid: string
  cause: string
  force: boolean
  window: boolean
  by: PlayerId | null
  /** Board hero that caused the destroy (for Tormentor revenge). */
  sourceUid?: string | null
}

export interface Phased {
  hero: BoardHero
  teamId: string
  owner: PlayerId
  fromTurn: number
}

export interface Lasso {
  uid: string
  caster: PlayerId
  owner: PlayerId
  /** Team the hero should return to when the lasso ends. */
  teamId: string
  fromTurn: number
}

export interface Over {
  reason: string
  scores: number[]
  parts: ScoreParts[]
}

export interface ScoreParts {
  teams: number
  terrains: number
  total: number
}

export interface Game {
  rng: number
  nextId: number
  mode: 'hotseat' | 'ai' | 'online'
  autoAll: boolean
  deck: CardInst[]
  grave: CardInst[]
  exile: CardInst[]
  runes: CardInst[]
  neutrals: CardInst[]
  towers: CardInst[]
  players: Player[]
  active: PlayerId
  turn: number
  log: string[]
  pending: Pending | null
  after: Resume | null
  queue: StackDestroy[]
  over: Over | null
  veil: boolean
  seq: number
  graveThisTurn: number
  enteredThisTurn: string[]
  lastGrave: GraveMark | null
  /** Ogre Magi ward: this hero uid activates its next ability twice. */
  multicast: string | null
  silence: Timed | null
  naga: Timed | null
  lockPlay: Timed | null
  /** Shiva: opponents of caster cannot fire/reactivate hero abilities. */
  frost: Timed | null
  troll: { player: PlayerId; turn: number } | null
  viper: { uid: string; owner: PlayerId; fromTurn: number }[]
  maledict: { player: PlayerId; turn: number }[]
  /** Warlock: bonded team — destroy another hero there when an enemy dies (until caster's next turn). */
  bonds: { teamId: string; fromTurn: number; caster: PlayerId }[]
  /** Bloodseeker Instant: enemy leavers are destroyed until caster's next turn. */
  rupture: Timed | null
  /** Jakiro: opponents start with one fewer action until caster's next turn. */
  taxAction: Timed | null
  soulbind: { a: string; b: string; turn: number }[]
  sdBan: { uid: string; sdUid: string; caster: PlayerId }[]
  phased: Phased[]
  lassos: Lasso[]
  reveal: { viewer: PlayerId; target: PlayerId; turn: number }[]
  destroyDepth: number
  live: boolean
  pendingDraws: { player: PlayerId; n: number }[]
  limbo: CardInst[]
  echoes: CastResume[]
  /** Entrant abilities held back while a trap resolves (last in fires first). */
  laterCasts: { uid: string; cast: CastResume }[]
  /** Nested stolen/copied fires cannot chain-steal (anti-loop). */
  stolenCast: boolean
  /** Refresher: this seat takes another turn after the current one ends. */
  extraTurn: PlayerId | null
  /** Axe: opponents of caster cannot draw from the deck. */
  noDraw: Timed | null
  /** Necrophos: opponents cannot play heroes of this attribute. */
  attrBan: { attr: Attr; caster: PlayerId } | null
  /** Amplify / free-item grants remaining this turn. */
  freeItems: number
  /** Clinkz: item cards that may be played for free from exile this turn. */
  clinkzExile: CardInst[]
  /** Dark Seer: until end of turn, destroyed enemies are stolen instead. */
  darkSeer: { actor: PlayerId; turn: number } | null
  /** Primal Beast: controller may play items as instants until their next turn. */
  primalItems: Timed | null
  /** Card uids that may be played for free this turn (Heart, reward offers, etc.). */
  freePlay: string[]
  /** Most recently played hero card (for Spirit Breaker). */
  lastPlayedHero: { uid: string; defId: string; player: PlayerId; turn: number } | null
  /**
   * Controllers who had Death Prophet protection during the current destroy cascade.
   * Cleared when the destroy queue drains so mid-queue DP deaths still exile teammates.
   */
  exorcismPulse: PlayerId[]
  /** Rubick Spell Steal: these hero uids cannot resolve abilities for the rest of the turn. */
  spellNullify: { uid: string; fromTurn: number }[]
  /** Medusa: full exiled teams held until she leaves. */
  medusaHold: { medusaUid: string; owner: PlayerId; cards: CardInst[] }[]
  /** Lifestealer Infest: return LS when host is destroyed. */
  infests: { ls: CardInst; hostUid: string; homeTeamId: string; owner: PlayerId }[]
  /**
   * Ancient revealed: the final round is running. The +10 goes to whoever controls the Ancient on the board at the end.
   * `bonusSeat` is legacy and always null.
   * Each seat then gets one end-turn; when `endsLeft` hits 0 the match finishes.
   */
  ancient: { bonusSeat: PlayerId | null; endsLeft: number } | null
  /** When false, The Ancient is not in the deck and cannot end the match. */
  ancientEnabled: boolean
  /** Discards owed; the discarding player picks the cards unless the effect says random. */
  discardsDue?: DiscardDue[]
  /** Target score for this match (null = off). */
  winScore?: number | null
  /** Seats that ended a turn at the target; each wins at its next turn if still alone at or above it. */
  holds?: { seat: PlayerId; turn: number }[]
  /** Response window owed after the active player's last action resolves. */
  respond?: ResponseWindow | null
  /** Seats that passed on every response window for the rest of this turn. */
  passTurn?: PlayerId[]
}

export interface ResponseWindow {
  about: string
  seats: PlayerId[]
  index: number
}

export interface DiscardDue {
  player: PlayerId
  n: number
  cause: string
}

export type Action =
  | { type: 'ready' }
  | { type: 'draw' }
  | { type: 'end' }
  /** `uid` is the active hero (fires). `extras` are silent companions into the same team. */
  | { type: 'play'; uid: string; team: string; extras?: string[] }
  | { type: 'combo'; uids: string[] }
  | { type: 'move'; uid: string; team: string }
  | { type: 'morph'; uid: string }
  | { type: 'undying'; team: string; discards: string[] }
  | { type: 'discard'; uid: string }
  | { type: 'choose'; ids: string[] }
