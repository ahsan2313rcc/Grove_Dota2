import type { Action, Game } from '../game/types.ts'

export type ClientMsg =
  | { type: 'register'; name: string; password: string }
  | { type: 'login'; name: string; password: string }
  | { type: 'queue'; seats?: 2 | 3 | 4 }
  | { type: 'cancel_queue' }
  | { type: 'action'; action: Action }
  | { type: 'leave_match' }
  | { type: 'ping' }

export type PublicPlayer = {
  id: string
  name: string
  mmr: number
  wins: number
  losses: number
  draws: number
}

export type ServerMsg =
  | { type: 'hello'; ok: true }
  | { type: 'auth_ok'; player: PublicPlayer }
  | { type: 'auth_err'; message: string }
  | { type: 'queued'; seats: number; waiting: number }
  | { type: 'queue_left' }
  | {
    type: 'match'
    roomId: string
    seat: number
    seats: number
    players: { name: string; mmr: number }[]
  }
  | { type: 'state'; roomId: string; seat: number; game: Game; seed: number }
  | {
    type: 'match_over'
    roomId: string
    scores: number[]
    placement: number
    mmrDelta: number
    mmr: number
    players: { name: string; mmr: number; delta: number }[]
  }
  | { type: 'leaderboard'; rows: PublicPlayer[] }
  | { type: 'error'; message: string }
  | { type: 'pong' }

export function parseClient(raw: string): ClientMsg | null {
  try {
    const data = JSON.parse(raw) as ClientMsg
    if (!data || typeof data !== 'object' || !('type' in data)) return null
    return data
  } catch {
    return null
  }
}
