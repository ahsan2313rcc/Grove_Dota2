import type { MatchReport } from '../game/balance.ts'
import type { AiStrat, Game } from '../game/types.ts'
import type { ScoreRules } from '../game/scoring.ts'
import { cloneRules, DEFAULT_SCORE_RULES } from '../game/scoring.ts'

const LOCAL_KEY = 'grove.local.match'
const DEBUG_KEY = 'grove.local.debug'
const ONLINE_AUTH_KEY = 'grove.online.auth'

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

export function saveLocalMatch(seed: number, game: Game, rules: ScoreRules): void {
  if (game.over || game.mode === 'online') {
    clearLocalMatch()
    return
  }
  const payload: SavedLocalMatch = {
    v: 1,
    seed,
    game,
    rules: cloneRules(rules),
    savedAt: Date.now(),
  }
  storeSet(LOCAL_KEY, JSON.stringify(payload))
}

export function clearLocalMatch(): void {
  storeRemove(LOCAL_KEY)
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
