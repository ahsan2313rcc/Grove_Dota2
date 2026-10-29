import { describe, expect, it } from 'vitest'
import { eloField, eloPair, expectedScore, START_MMR } from './elo.ts'

describe('elo', () => {
  it('starts at 1000 and moves the favorite less on an upset', () => {
    expect(START_MMR).toBe(1000)
    const fair = eloPair(1000, 1000, 1)
    expect(fair.deltaA).toBe(16)
    expect(fair.deltaB).toBe(-16)
    const upset = eloPair(1200, 800, 0)
    expect(upset.deltaA).toBeLessThan(-16)
    expect(upset.deltaB).toBeGreaterThan(16)
  })

  it('ranks a three-player field', () => {
    const { next, deltas } = eloField([1000, 1000, 1000], [20, 10, 5])
    expect(next[0]).toBeGreaterThan(1000)
    expect(next[2]).toBeLessThan(1000)
    expect(deltas.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, -1)
  })

  it('expected score is symmetric', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5)
    expect(expectedScore(1200, 800) + expectedScore(800, 1200)).toBeCloseTo(1)
  })
})
