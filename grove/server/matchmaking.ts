import type { RoomSeat } from './room.ts'

export interface QueueEntry {
  playerId: string
  name: string
  mmr: number
  seats: 2 | 3 | 4
  joinedAt: number
  socketId: string
}

const BASE_BAND = 120
const GROW_MS = 12_000
const GROW_BAND = 80

export function waitingCount(queue: QueueEntry[], seats: number): number {
  return queue.filter((entry) => entry.seats === seats).length
}

/** Try to form one match for the given party size. Mutates queue (removes matched). */
export function tryMatch(queue: QueueEntry[], seats: 2 | 3 | 4, now = Date.now()): RoomSeat[] | null {
  const pool = queue
    .filter((entry) => entry.seats === seats)
    .sort((a, b) => a.joinedAt - b.joinedAt || a.mmr - b.mmr)
  if (pool.length < seats) return null

  for (let start = 0; start < pool.length; start += 1) {
    const anchor = pool[start]!
    const wait = now - anchor.joinedAt
    const band = BASE_BAND + Math.floor(wait / GROW_MS) * GROW_BAND
    const group: QueueEntry[] = [anchor]
    for (let index = 0; index < pool.length && group.length < seats; index += 1) {
      if (index === start) continue
      const candidate = pool[index]!
      const mmrOk = group.every((member) => Math.abs(member.mmr - candidate.mmr) <= band)
      if (mmrOk) group.push(candidate)
    }
    if (group.length < seats) continue

    const ids = new Set(group.map((entry) => entry.socketId))
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (ids.has(queue[index]!.socketId)) queue.splice(index, 1)
    }
    return group.map((entry) => ({ playerId: entry.playerId, name: entry.name, mmr: entry.mmr }))
  }
  return null
}
