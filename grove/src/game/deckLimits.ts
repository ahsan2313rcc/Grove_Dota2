import { HEROES, ITEMS, TERRAINS } from './catalog.ts'

/** Random draws an even split from the roster. Set A is a fixed list of 48. */
export type HeroSource = 'random' | 'set-a'

/** How many cards of each kind go into the shared deck before The Ancient is inserted. */
export type DeckLimits = {
  heroes: number
  items: number
  terrains: number
  heroSource: HeroSource
}

export const PRINTED_HERO_COUNT = HEROES.length
export const PRINTED_ITEM_COUNT = ITEMS.reduce((sum, item) => sum + item.copies, 0)
export const PRINTED_TERRAIN_COUNT = TERRAINS.length * 12
/** Set A is 12 heroes from each attribute. */
export const HERO_SET_A_SIZE = 48

/** Lobby default: 48 heroes, the full item set, and 12 of each terrain. */
export const DEFAULT_DECK_LIMITS: DeckLimits = {
  heroes: 48,
  items: PRINTED_ITEM_COUNT,
  terrains: PRINTED_TERRAIN_COUNT,
  heroSource: 'random',
}

/** Full printed main deck. Tests and online leave createGame on this when no limit is passed. */
export const FULL_DECK_LIMITS: DeckLimits = {
  heroes: PRINTED_HERO_COUNT,
  items: PRINTED_ITEM_COUNT,
  terrains: PRINTED_TERRAIN_COUNT,
  heroSource: 'random',
}

export const HERO_DECK_MAX = PRINTED_HERO_COUNT
/** Printed 36, then +12 commons, +12 rares, +12 uniques. */
export const ITEM_DECK_STEPS = [36, 48, 60, 72] as const
/** 12, 16, 20, or 24 of each terrain. */
export const TERRAIN_DECK_STEPS = [36, 48, 60, 72] as const
export const ITEM_DECK_MAX = ITEM_DECK_STEPS[ITEM_DECK_STEPS.length - 1]!
export const TERRAIN_DECK_MAX = TERRAIN_DECK_STEPS[TERRAIN_DECK_STEPS.length - 1]!

export type ItemTier = 'common' | 'rare' | 'unique'

const STORAGE_KEY = 'grove.deck.v1'
const TIER_ORDER: ItemTier[] = ['common', 'rare', 'unique']

function clampCount(value: unknown, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(max, n))
}

function snapStep(value: unknown, steps: readonly number[], fallback: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return steps.reduce((best, step) => (Math.abs(step - n) < Math.abs(best - n) ? step : best), steps[0]!)
}

export function itemTier(printedCopies: number): ItemTier {
  if (printedCopies >= 3) return 'common'
  if (printedCopies === 2) return 'rare'
  return 'unique'
}

/** Tiers added on top of the printed 36, in order: commons, then rares, then uniques. */
export function extraItemTiers(total: number): ItemTier[] {
  const steps = Math.round((snapStep(total, ITEM_DECK_STEPS, PRINTED_ITEM_COUNT) - PRINTED_ITEM_COUNT) / 12)
  return TIER_ORDER.slice(0, Math.max(0, Math.min(TIER_ORDER.length, steps)))
}

/** Copy count for every item at a lobby item step. Extras double that tier's printed copies. */
export function itemCopyCounts(total: number): { id: string; copies: number }[] {
  const extra = new Set(extraItemTiers(total))
  return ITEMS.map((item) => ({
    id: item.id,
    copies: item.copies + (extra.has(itemTier(item.copies)) ? item.copies : 0),
  }))
}

export function itemStepLabel(total: number): string {
  const extra = extraItemTiers(total)
  if (extra.length === 0) return 'printed set'
  const names = extra.map((tier) => (tier === 'common' ? 'commons' : tier === 'rare' ? 'rares' : 'uniques'))
  return '+ ' + names.join(', ')
}

export function clampDeckLimits(raw: Partial<DeckLimits> | null | undefined): DeckLimits {
  const heroSource: HeroSource = raw?.heroSource === 'set-a' ? 'set-a' : 'random'
  return {
    heroes: clampCount(raw?.heroes, heroSource === 'set-a' ? HERO_SET_A_SIZE : HERO_DECK_MAX, DEFAULT_DECK_LIMITS.heroes),
    items: snapStep(raw?.items, ITEM_DECK_STEPS, DEFAULT_DECK_LIMITS.items),
    terrains: snapStep(raw?.terrains, TERRAIN_DECK_STEPS, DEFAULT_DECK_LIMITS.terrains),
    heroSource,
  }
}

/** Copies of River, Jungle, then Lane. Remainder goes to the earlier terrains. */
export function terrainCopies(total: number): number[] {
  const kinds = TERRAINS.length
  const clamped = clampCount(total, TERRAIN_DECK_MAX, 0)
  const base = Math.floor(clamped / kinds)
  let extra = clamped % kinds
  return TERRAINS.map(() => {
    const count = base + (extra > 0 ? 1 : 0)
    if (extra > 0) extra -= 1
    return count
  })
}

export function terrainSplitLabel(total: number): string {
  const copies = terrainCopies(total)
  return TERRAINS.map((terrain, index) => `${copies[index]} ${terrain.name}`).join(' · ')
}

export function loadDeckLimits(): DeckLimits {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_DECK_LIMITS }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_DECK_LIMITS }
    return clampDeckLimits(JSON.parse(raw) as Partial<DeckLimits>)
  } catch {
    return { ...DEFAULT_DECK_LIMITS }
  }
}

export function saveDeckLimits(limits: DeckLimits): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clampDeckLimits(limits)))
  } catch {
    // Private mode and full storage still play with the in-memory choice.
  }
}
