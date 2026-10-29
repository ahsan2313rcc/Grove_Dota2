import { apply, createGame, type SeatSpec } from '../src/game/engine.ts'
import { scoreState } from '../src/game/flow.ts'
import type { Action, Game, PlayerId } from '../src/game/types.ts'
import { applyMatchResult, getPlayer, type PlayerRow } from './db.ts'
import { eloField } from './elo.ts'
import { viewFor } from './view.ts'

export interface RoomSeat {
  playerId: string
  name: string
  mmr: number
}

export interface Room {
  id: string
  seed: number
  seats: RoomSeat[]
  game: Game
  finished: boolean
  result: null | {
    scores: number[]
    deltas: number[]
    nextMmrs: number[]
  }
}

export function createRoom(id: string, seats: RoomSeat[], seed = Date.now() % 100000): Room {
  const specs: SeatSpec[] = seats.map((seat) => ({ name: seat.name, ai: false }))
  const game = createGame({ seed, mode: 'online', seats: specs })
  return { id, seed, seats, game: { ...game, veil: false }, finished: false, result: null }
}

export function legalActor(room: Room, seat: PlayerId): boolean {
  const game = room.game
  if (game.over) return false
  if (game.pending) return game.pending.actor === seat
  if (game.veil) return false
  return game.active === seat
}

export function pushAction(room: Room, seat: PlayerId, action: Action): { ok: true } | { ok: false; message: string } {
  if (room.finished || room.game.over) return { ok: false, message: 'Match is over.' }
  if (!legalActor(room, seat)) return { ok: false, message: 'Not your action.' }
  if (action.type === 'ready') {
    room.game = apply(room.game, action)
    return { ok: true }
  }
  // Ignore ready-only when not veiled
  try {
    room.game = apply(room.game, action)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Illegal play.' }
  }
  if (room.game.over && !room.finished) settle(room)
  return { ok: true }
}

function settle(room: Room) {
  room.finished = true
  const scores = room.game.players.map((player) => scoreState(room.game, player.id).total)
  const ratings = room.seats.map((seat) => getPlayer(seat.playerId)?.mmr ?? seat.mmr)
  const field = eloField(ratings, scores)
  applyMatchResult(
    room.seats.map((seat) => seat.playerId),
    scores,
    field.next,
  )
  room.result = { scores, deltas: field.deltas, nextMmrs: field.next }
}

export function seatView(room: Room, seat: PlayerId): Game {
  return viewFor(room.game, seat)
}

export function placementOf(scores: number[], seat: number): number {
  const mine = scores[seat] ?? 0
  return scores.filter((score) => score > mine).length + 1
}

export function refreshSeatMmrs(room: Room): PlayerRow[] {
  return room.seats.map((seat) => getPlayer(seat.playerId)).filter((row): row is PlayerRow => !!row)
}
