import { describe, expect, it } from 'vitest'
import { HEROES, ITEMS, REWARDS, firesAbility } from './catalog.ts'
import { runMatchFast } from './balance.ts'

describe('completeness', () => {
  it('every cast/instant hero declares timing and text', () => {
    for (const hero of HEROES) {
      expect(hero.text.length).toBeGreaterThan(8)
      expect(['cast', 'aura', 'instant', 'trap']).toContain(hero.timing)
      if (hero.timing === 'cast' || hero.timing === 'instant') {
        expect(firesAbility(hero.id)).toBe(true)
      }
    }
  })

  it('items and rewards have playable text', () => {
    for (const item of ITEMS) expect(item.text.length).toBeGreaterThan(8)
    for (const reward of REWARDS) expect(reward.text.length).toBeGreaterThan(8)
  })

  it('AI matches finish across a seed batch', () => {
    const seeds = [1, 7, 11, 12, 13, 19, 27, 33, 41, 58]
    let finished = 0
    for (const seed of seeds) {
      if (runMatchFast(seed, 2).over) finished += 1
    }
    expect(finished).toBe(seeds.length)
  }, 60_000)
})
