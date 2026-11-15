import { HEROES, ITEMS, TERRAINS } from './catalog.ts'

/** How many cards of each kind go into the shared deck before The Ancient is inserted. */
export type DeckLimits = {
  heroes: number
  items: number
  terrains: number
}

export const PRINTED_HERO_COUNT = HEROES.length
export const PRINTED_ITEM_COUNT = ITEMS.reduce((sum, item) => sum + item.copies, 0)
export const PRINTED_TERRAIN_COUNT = TERRAINS.length * 12

/** Lobby default: 36 random heroes, the full item set, and 12 of each terrain. */
export const DEFAULT_DECK_LIMITS: DeckLimits = {
  heroes: 36,
  items: PRINTED_ITEM_COUNT,
  terrains: PRINTED_TERRAIN_COUNT,
}

/** Full printed main deck. Tests and online leave createGame on this when no limit is passed. */
export const FULL_DECK_LIMITS: DeckLimits = {
  heroes: PRINTED_HERO_COUNT,
  items: PRINTED_ITEM_COUNT,
  terrains: PRINTED_TERRAIN_COUNT,
}

export const HERO_DECK_MAX = PRINTED_HERO_COUNT
/** Extra copies are allowed above the printed item set. */
export const ITEM_DECK_MAX = PRINTED_ITEM_COUNT * 2
export const TERRAIN_DECK_MAX = PRINTED_TERRAIN_COUNT * 2

const STORAGE_KEY = 'grove.deck.v1'

function clampCount(value: unknown, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(max, n))
}

export function clampDeckLimits(raw: Partial<DeckLimits> | null | undefined): DeckLimits {
  return {
    heroes: clampCount(raw?.heroes, HERO_DECK_MAX, DEFAULT_DECK_LIMITS.heroes),
    items: clampCount(raw?.items, ITEM_DECK_MAX, DEFAULT_DECK_LIMITS.items),
    terrains: clampCount(raw?.terrains, TERRAIN_DECK_MAX, DEFAULT_DECK_LIMITS.terrains),
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
