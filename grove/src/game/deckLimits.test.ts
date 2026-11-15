import { describe, expect, it } from 'vitest'
import { HEROES, ITEMS } from './catalog.ts'
import {
  clampDeckLimits,
  DEFAULT_DECK_LIMITS,
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

  it('can add item copies past the printed set and split uneven terrains', () => {
    const game = createGame({
      seed: 3,
      seats,
      deck: { heroes: 0, items: PRINTED_ITEM_COUNT + 4, terrains: 10 },
    })
    const items = zone(game, 'item')
    expect(items).toHaveLength(PRINTED_ITEM_COUNT + 4)
    expect(ITEMS.some((item) => items.filter((card) => card.defId === item.id).length > item.copies)).toBe(true)
    const terrains = zone(game, 'terrain')
    expect(terrains.filter((card) => card.defId === 'river')).toHaveLength(4)
    expect(terrains.filter((card) => card.defId === 'jungle')).toHaveLength(3)
    expect(terrains.filter((card) => card.defId === 'lane')).toHaveLength(3)
    expect(zone(game, 'hero')).toHaveLength(0)
  })

  it('clamps counts onto the printed roster', () => {
    const limits = clampDeckLimits({ heroes: 999, items: -4, terrains: 3.2 })
    expect(limits.heroes).toBe(PRINTED_HERO_COUNT)
    expect(limits.items).toBe(0)
    expect(limits.terrains).toBe(3)
    expect(terrainCopies(37)).toEqual([13, 12, 12])
  })

  it('places The Ancient near the end by default', () => {
    expect(DEFAULT_SCORE_RULES.ancientDepths).toEqual([80, 80, 80, 80, 80, 80, 80])
  })
})
