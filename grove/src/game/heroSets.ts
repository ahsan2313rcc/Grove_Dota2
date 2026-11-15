import { HEROES } from './catalog.ts'
import type { DeckLimits, HeroSource } from './deckLimits.ts'
import type { Attr } from './types.ts'

export const HERO_ATTRS: Attr[] = ['STR', 'AGI', 'INT', 'UNI']

/**
 * Set A, strongest first within each attribute.
 * Full list: 10 instants, 7 auras, 2 traps, with destroy, save, and exile.
 */
export const HERO_SET_A: Record<Attr, readonly string[]> = {
  STR: [
    'tidehunter',
    'sven',
    'lifestealer',
    'doom',
    'mars',
    'dawnbreaker',
    'wraith_king',
    'earth_spirit',
    'ogre_magi',
  ],
  AGI: [
    'faceless_void',
    'terrorblade',
    'medusa',
    'anti_mage',
    'razor',
    'bloodseeker',
    'nyx_assassin',
    'viper',
    'monkey_king',
  ],
  INT: [
    'lina',
    'necrophos',
    'winter_wyvern',
    'silencer',
    'rubick',
    'oracle',
    'dazzle',
    'puck',
    'ancient_apparition',
  ],
  UNI: [
    'enigma',
    'bane',
    'void_spirit',
    'magnus',
    'io',
    'natures_prophet',
    'windranger',
    'brewmaster',
    'snapfire',
  ],
}

export function heroPools(source: HeroSource): Record<Attr, readonly string[]> {
  if (source === 'set-a') return HERO_SET_A
  return {
    STR: HEROES.filter((hero) => hero.attr === 'STR').map((hero) => hero.id),
    AGI: HEROES.filter((hero) => hero.attr === 'AGI').map((hero) => hero.id),
    INT: HEROES.filter((hero) => hero.attr === 'INT').map((hero) => hero.id),
    UNI: HEROES.filter((hero) => hero.attr === 'UNI').map((hero) => hero.id),
  }
}

/** Deal as evenly as possible. A remainder goes to Strength, then Agility, then Intelligence. */
export function heroQuotas(total: number, pools: Record<Attr, readonly string[]>): Record<Attr, number> {
  const quota: Record<Attr, number> = { STR: 0, AGI: 0, INT: 0, UNI: 0 }
  let left = Math.max(0, Math.round(total))
  while (left > 0) {
    let gave = false
    for (const attr of HERO_ATTRS) {
      if (left <= 0) break
      if (quota[attr] < pools[attr].length) {
        quota[attr] += 1
        left -= 1
        gave = true
      }
    }
    if (!gave) break
  }
  return quota
}

export function heroSplitLabel(limits: Pick<DeckLimits, 'heroes' | 'heroSource'>): string {
  const quota = heroQuotas(limits.heroes, heroPools(limits.heroSource))
  return HERO_ATTRS.map((attr) => quota[attr] + ' ' + attr).join(' · ')
}
