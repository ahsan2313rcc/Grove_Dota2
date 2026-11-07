import type { MatchReport } from '../game/balance.ts'
import type { AiStrat, Game } from '../game/types.ts'
import type { ScoreRules } from '../game/scoring.ts'
import { cloneRules, DEFAULT_SCORE_RULES } from '../game/scoring.ts'

const LOCAL_KEY = 'grove.local.match'
const DEBUG_KEY = 'grove.local.debug'
const ONLINE_AUTH_KEY = 'grove.online.auth'
/** Set when the player leaves on purpose, so a later reload stays on the lobby. */
const LEFT_KEY = 'grove.nav.left'

/** In-memory fallback when localStorage is unavailable (tests / private mode). */
const memory = new Map<string, string>()

function storeGet(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key)
  } catch {
    // fall through
  }
  return memory.get(key) ?? null
}

function storeSet(key: string, value: string): void {
  memory.set(key, value)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    // memory only
  }
}

function storeRemove(key: string): void {
  memory.delete(key)
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export type SavedLocalMatch = {
  v: 1
  seed: number
  game: Game
  rules: ScoreRules
  savedAt: number
}

export type SavedOnlineAuth = {
  name: string
  password: string
}

export function loadLocalMatch(): SavedLocalMatch | null {
  try {
    const raw = storeGet(LOCAL_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SavedLocalMatch
    if (!data || data.v !== 1 || !data.game || typeof data.seed !== 'number') return null
    if (data.game.over) {
      clearLocalMatch()
      return null
    }
    return {
      ...data,
      rules: data.rules ? cloneRules(data.rules) : cloneRules(DEFAULT_SCORE_RULES),
    }
  } catch {
    return null
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let savePending: SavedLocalMatch | null = null

export function flushPendingLocalMatch(): void {
  if (!savePending) return
  const payload = savePending
  savePending = null
  storeSet(LOCAL_KEY, JSON.stringify(payload))
}

/** Persist the local match. Debounced so AI ticks don't hitch the UI on every write. */
export function saveLocalMatch(seed: number, game: Game, rules: ScoreRules, immediate = false): void {
  if (game.over || game.mode === 'online') {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    savePending = null
    clearLocalMatch()
    return
  }
  savePending = {
    v: 1,
    seed,
    game,
    rules: cloneRules(rules),
    savedAt: Date.now(),
  }
  if (immediate) {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    flushPendingLocalMatch()
    return
  }
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushPendingLocalMatch()
  }, 500)
}

export function clearLocalMatch(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  savePending = null
  storeRemove(LOCAL_KEY)
}

/** Player chose Leave. A refresh should open the lobby, not jump back into the match. */
export function markVoluntaryLeave(): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(LEFT_KEY, '1')
  } catch {
    // ignore
  }
}

/** True when this load follows Leave. Consumes the flag (cached so Strict Mode's double init agrees). */
let leaveDecision: boolean | null = null
export function takeVoluntaryLeave(): boolean {
  if (leaveDecision !== null) return leaveDecision
  try {
    if (typeof sessionStorage === 'undefined') {
      leaveDecision = false
      return false
    }
    const left = sessionStorage.getItem(LEFT_KEY) === '1'
    if (left) sessionStorage.removeItem(LEFT_KEY)
    leaveDecision = left
    return left
  } catch {
    leaveDecision = false
    return false
  }
}

export function loadOnlineAuth(): SavedOnlineAuth | null {
  try {
    const raw = storeGet(ONLINE_AUTH_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SavedOnlineAuth
    if (!data?.name || !data?.password) return null
    return data
  } catch {
    return null
  }
}

export function saveOnlineAuth(name: string, password: string): void {
  storeSet(ONLINE_AUTH_KEY, JSON.stringify({ name, password }))
}

export function clearOnlineAuth(): void {
  storeRemove(ONLINE_AUTH_KEY)
}

export function describeLocalMatch(saved: SavedLocalMatch): string {
  const humans = saved.game.players.filter((player) => !player.ai).length
  const ais = saved.game.players.length - humans
  const mode = humans >= 2 ? 'Hotseat' : ais > 0 ? 'Solo' : 'Match'
  const turn = saved.game.turn
  return `${mode} · turn ${turn} · seed ${saved.seed}`
}

/** Last debug/sim session so lobby can reopen Stats without starting from scratch. */
export type SavedDebugSession = {
  v: 1
  seed: number
  seats: number
  strats: AiStrat[]
  queueSize: number
  view: 'stats' | 'watch'
  trainNeural: boolean
  thoughtPower: number
  reports: MatchReport[]
  rules: ScoreRules
  /** True while a debug session is open, so a reload can return to it. */
  active: boolean
  savedAt: number
}

export function loadDebugSession(): SavedDebugSession | null {
  try {
    const raw = storeGet(DEBUG_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SavedDebugSession
    if (!data || data.v !== 1 || typeof data.seed !== 'number') return null
    if (!Array.isArray(data.strats) || !Array.isArray(data.reports)) return null
    return {
      ...data,
      seats: Math.max(2, Math.min(8, Math.floor(data.seats) || 2)),
      queueSize: Math.max(1, Math.floor(data.queueSize) || 100),
      view: data.view === 'watch' ? 'watch' : 'stats',
      trainNeural: !!data.trainNeural,
      thoughtPower: Math.floor(data.thoughtPower) || 7,
      active: data.active === true,
      rules: data.rules ? cloneRules(data.rules) : cloneRules(DEFAULT_SCORE_RULES),
    }
  } catch {
    return null
  }
}

export function saveDebugSession(session: Omit<SavedDebugSession, 'v' | 'savedAt'>): void {
  const payload: SavedDebugSession = {
    v: 1,
    ...session,
    // Keep the on-disk copy small so a long sim cannot blow the storage quota.
    reports: session.reports.slice(-80),
    rules: cloneRules(session.rules),
    savedAt: Date.now(),
  }
  storeSet(DEBUG_KEY, JSON.stringify(payload))
}

export function clearDebugSession(): void {
  storeRemove(DEBUG_KEY)
}

export function describeDebugSession(saved: SavedDebugSession): string {
  const finished = saved.reports.filter((report) => report.over).length
  const when = new Date(saved.savedAt).toLocaleString()
  return `${saved.seats} AI · seed ${saved.seed} · ${finished} finished · ${when}`
}
