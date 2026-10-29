export type PlayerId = number
export type Attr = 'STR' | 'AGI' | 'INT' | 'UNI'
export type Range = 'Melee' | 'Ranged'
export type SettingKind = 'river' | 'jungle' | 'lane'
export type CardKind = 'hero' | 'item' | 'setting' | 'rune' | 'neutral' | 'tower'
export type Timing = 'cast' | 'aura' | 'instant'
export type AiStrat = 'balanced' | 'tempo' | 'architect' | 'spite'

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
  muted: boolean
  dawn: { caster: PlayerId; turn: number } | null
  wk: boolean
  refract: boolean
  held: { card: CardInst; owner: PlayerId; mode: 'morph' | 'razor'; takenTurn: number } | null
  castTurn: number
}

export interface Team {
  id: string
  heroes: BoardHero[]
  gaze: boolean
  noEnter: Timed | null
  noLeave: Timed | null
  glyph: Timed | null
  mine: CardInst | null
}

export interface Combo {
  id: string
  owner: PlayerId
  cards: CardInst[]
  points: number
  kind: SettingKind | 'mixed'
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
  orchid: boolean
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
  steps?: number
}

export type Resume =
  | CastResume
  | { kind: 'save'; uid: string; cause: string; force: boolean }
  | { kind: 'counter'; uid: string; team: string; actor: PlayerId }
  | { kind: 'counter-combo'; uids: string[]; actor: PlayerId }
  | { kind: 'pugna'; cast: CastResume }
  | { kind: 'torment'; heroUid: string; cast: CastResume | null }
  | { kind: 'slark'; player: PlayerId; n: number }
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
  | { kind: 'tinker'; actor: PlayerId; cardUid: string }
  | { kind: 'alive'; uid: string; cast: CastResume }

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
  fromTurn: number
}

export interface Over {
  reason: string
  scores: number[]
  parts: ScoreParts[]
}

export interface ScoreParts {
  teams: number
  settings: number
  total: number
}

export interface Game {
  rng: number
  nextId: number
  mode: 'hotseat' | 'ai'
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
  multicast: PlayerId | null
  silence: Timed | null
  naga: Timed | null
  lockPlay: Timed | null
  troll: { player: PlayerId; turn: number } | null
  viper: { uid: string; owner: PlayerId; fromTurn: number }[]
  maledict: { player: PlayerId; turn: number }[]
  bonds: { teamId: string; turn: number }[]
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
}

export type Action =
  | { type: 'ready' }
  | { type: 'draw' }
  | { type: 'end' }
  | { type: 'play'; uid: string; team: string }
  | { type: 'combo'; uids: string[] }
  | { type: 'move'; uid: string; team: string }
  | { type: 'morph'; uid: string }
  | { type: 'discard'; uid: string }
  | { type: 'choose'; ids: string[] }
