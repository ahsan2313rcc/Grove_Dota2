import { describe, expect, it } from 'vitest'
import { tryMatch, type QueueEntry } from './matchmaking.ts'

function entry(partial: Partial<QueueEntry> & Pick<QueueEntry, 'playerId' | 'socketId' | 'mmr'>): QueueEntry {
  return {
    name: partial.playerId,
    seats: 2,
    joinedAt: 0,
    ...partial,
  }
}

describe('matchmaking', () => {
  it('pairs two close mmr players', () => {
    const queue = [
      entry({ playerId: 'a', socketId: 's1', mmr: 1000, joinedAt: 1 }),
      entry({ playerId: 'b', socketId: 's2', mmr: 1040, joinedAt: 2 }),
    ]
    const matched = tryMatch(queue, 2, 10_000)
    expect(matched?.map((seat) => seat.playerId).sort()).toEqual(['a', 'b'])
    expect(queue).toHaveLength(0)
  })

  it('waits when the band is too tight for a huge gap', () => {
    const queue = [
      entry({ playerId: 'a', socketId: 's1', mmr: 1000, joinedAt: 1000 }),
      entry({ playerId: 'b', socketId: 's2', mmr: 1600, joinedAt: 1000 }),
    ]
    expect(tryMatch(queue, 2, 1000)).toBeNull()
    expect(queue).toHaveLength(2)
    // Band grows +80 every 12s; 600 MMR gap needs ~72s of wait.
    const later = tryMatch(queue, 2, 1000 + 90_000)
    expect(later).not.toBeNull()
  })

  it('fills a 3-seat lobby', () => {
    const queue = [
      entry({ playerId: 'a', socketId: 's1', mmr: 1000, seats: 3, joinedAt: 1 }),
      entry({ playerId: 'b', socketId: 's2', mmr: 1010, seats: 3, joinedAt: 2 }),
      entry({ playerId: 'c', socketId: 's3', mmr: 990, seats: 3, joinedAt: 3 }),
    ]
    const matched = tryMatch(queue, 3, 5000)
    expect(matched).toHaveLength(3)
  })
})
