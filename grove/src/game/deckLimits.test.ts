import { describe, expect, it } from 'vitest'
import { HEROES, ITEMS } from './catalog.ts'
import {
  clampDeckLimits,
  DEFAULT_DECK_LIMITS,
  extraItemTiers,
  itemCopyCounts,
  itemStepLabel,
  PRINTED_HERO_COUNT,
  PRINTED_ITEM_COUNT,
  terrainCopies,
} from './deckLimits.ts'
import { createGame } from './engine.ts'
import { DEFAULT_SCORE_RULES } from './scoring.ts'
import type { CardInst, Game } from './types.ts'

const seats = [
  { name: 'Radiant', ai: false },
  { name: 'Dire', ai: false },
]

function zone(game: Game, kind: CardInst['kind']): CardInst[] {
  return [
    ...game.deck,
    ...game.players.flatMap((player) => player.hand),
    ...game.grave,
    ...game.exile,
  ].filter((card) => card.kind === kind)
}

describe('deck limits', () => {
  it('deals the lobby default of 36 heroes, 36 items, and 36 terrains', () => {
    const game = createGame({ seed: 11, seats, deck: DEFAULT_DECK_LIMITS })
    const heroes = zone(game, 'hero')
    expect(heroes).toHaveLength(36)
    expect(new Set(heroes.map((card) => card.defId)).size).toBe(36)
    expect(zone(game, 'item')).toHaveLength(36)
    const terrains = zone(game, 'terrain')
    expect(terrains).toHaveLength(36)
    for (const id of ['river', 'jungle', 'lane']) {
      expect(terrains.filter((card) => card.defId === id)).toHaveLength(12)
    }
  })

  it('deals the same heroes for the same seed', () => {
    const ids = (seed: number) =>
      zone(createGame({ seed, seats, deck: DEFAULT_DECK_LIMITS }), 'hero')
        .map((card) => card.defId)
        .sort()
    expect(ids(11)).toEqual(ids(11))
    expect(ids(11)).not.toEqual(ids(12))
  })

  it('keeps every hero when the deck option is omitted', () => {
    const game = createGame({ seed: 11, seats })
    expect(zone(game, 'hero')).toHaveLength(HEROES.length)
    expect(zone(game, 'item')).toHaveLength(PRINTED_ITEM_COUNT)
    expect(zone(game, 'terrain')).toHaveLength(36)
  })

  it('adds commons, then rares, then uniques in steps of 12', () => {
    const count = (total: number, id: string) => itemCopyCounts(total).find((item) => item.id === id)?.copies
    expect(extraItemTiers(36)).toEqual([])
    expect(itemStepLabel(36)).toBe('printed set')
    expect(count(36, 'clarity')).toBe(3)
    expect(count(36, 'orchid')).toBe(2)
    expect(count(36, 'scythe')).toBe(1)

    expect(extraItemTiers(48)).toEqual(['common'])
    expect(count(48, 'clarity')).toBe(6)
    expect(count(48, 'gloves')).toBe(6)
    expect(count(48, 'orchid')).toBe(2)
    expect(count(48, 'scythe')).toBe(1)

    expect(extraItemTiers(60)).toEqual(['common', 'rare'])
    expect(count(60, 'orchid')).toBe(4)
    expect(count(60, 'blink')).toBe(4)
    expect(count(60, 'scythe')).toBe(1)

    expect(extraItemTiers(72)).toEqual(['common', 'rare', 'unique'])
    expect(count(72, 'scythe')).toBe(2)
    expect(count(72, 'refresher')).toBe(2)
    expect(itemCopyCounts(72).reduce((sum, item) => sum + item.copies, 0)).toBe(72)

    const game = createGame({ seed: 3, seats, deck: { heroes: 0, items: 60, terrains: 48 } })
    const items = zone(game, 'item')
    expect(items).toHaveLength(60)
    expect(items.filter((card) => card.defId === 'clarity')).toHaveLength(6)
    expect(items.filter((card) => card.defId === 'orchid')).toHaveLength(4)
    expect(items.filter((card) => card.defId === 'scythe')).toHaveLength(1)
    const terrains = zone(game, 'terrain')
    expect(terrains).toHaveLength(48)
    for (const id of ['river', 'jungle', 'lane']) {
      expect(terrains.filter((card) => card.defId === id)).toHaveLength(16)
    }
    expect(zone(game, 'hero')).toHaveLength(0)
    expect(ITEMS.filter((item) => item.copies === 3)).toHaveLength(4)
    expect(ITEMS.filter((item) => item.copies === 2)).toHaveLength(6)
    expect(ITEMS.filter((item) => item.copies === 1)).toHaveLength(12)
  })

  it('clamps heroes and snaps items and terrains onto the lobby steps', () => {
    const limits = clampDeckLimits({ heroes: 999, items: -4, terrains: 3.2 })
    expect(limits.heroes).toBe(PRINTED_HERO_COUNT)
    expect(limits.items).toBe(36)
    expect(limits.terrains).toBe(36)
    expect(clampDeckLimits({ heroes: 0, items: 54, terrains: 70 }).items).toBe(48)
    expect(clampDeckLimits({ heroes: 0, items: 54, terrains: 70 }).terrains).toBe(72)
    expect(terrainCopies(48)).toEqual([16, 16, 16])
    expect(terrainCopies(72)).toEqual([24, 24, 24])
  })

  it('places The Ancient near the end by default', () => {
    expect(DEFAULT_SCORE_RULES.ancientDepths).toEqual([80, 80, 80, 80, 80, 80, 80])
  })
})
