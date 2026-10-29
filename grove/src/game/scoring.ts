import type { Attr, Range } from './types.ts'

export interface ScoreBody {
  attrs: Attr[]
  range: Range | null
  count: number
}

/** Tunable scoring used by the table and debug rail. Indices are 1-based sizes (slot 0 unused). */
export interface ScoreRules {
  /** Points per hero body (Meepo counts as 2). */
  heroPoints: number
  /** Core mono bonus by hero count 1..5. */
  coreBonus: [number, number, number, number, number]
  /** Mix attribute bonus by distinct attrs 1..4. */
  mixBonus: [number, number, number, number]
  /** Same-attack bonus by hero count 1..5. */
  attackBonus: [number, number, number, number, number]
  /** When true, mono teams also take the attack bonus. */
  attackOnCore: boolean
  /** When true, mixed / open teams take the attack bonus. */
  attackOnMix: boolean
  /** Three-of-a-kind setting combo points. */
  coreCombo: number
  /** Mixed River/Jungle/Lane combo points. */
  mixCombo: number
}

export const DEFAULT_SCORE_RULES: ScoreRules = {
  heroPoints: 1,
  coreBonus: [0, 0, 3, 6, 10],
  mixBonus: [0, 0, 2, 4],
  attackBonus: [0, 0, 1, 2, 3],
  attackOnCore: false,
  attackOnMix: true,
  coreCombo: 5,
  mixCombo: 5,
}

let current: ScoreRules = cloneRules(DEFAULT_SCORE_RULES)

const ATTRS: Attr[] = ['STR', 'AGI', 'INT', 'UNI']

export function getScoreRules(): ScoreRules {
  return cloneRules(current)
}

export function setScoreRules(next: ScoreRules): ScoreRules {
  current = normalizeRules(next)
  return getScoreRules()
}

export function resetScoreRules(): ScoreRules {
  current = cloneRules(DEFAULT_SCORE_RULES)
  return getScoreRules()
}

export function cloneRules(rules: ScoreRules): ScoreRules {
  return {
    heroPoints: rules.heroPoints,
    coreBonus: [...rules.coreBonus] as ScoreRules['coreBonus'],
    mixBonus: [...rules.mixBonus] as ScoreRules['mixBonus'],
    attackBonus: [...rules.attackBonus] as ScoreRules['attackBonus'],
    attackOnCore: rules.attackOnCore,
    attackOnMix: rules.attackOnMix,
    coreCombo: rules.coreCombo,
    mixCombo: rules.mixCombo,
  }
}

export function normalizeRules(rules: ScoreRules): ScoreRules {
  const clamp = (value: number) => {
    const n = Number.isFinite(value) ? Math.round(value) : 0
    return Math.max(0, Math.min(99, n))
  }
  return {
    heroPoints: Math.max(0, Math.min(9, clamp(rules.heroPoints))),
    coreBonus: rules.coreBonus.map(clamp) as ScoreRules['coreBonus'],
    mixBonus: rules.mixBonus.map(clamp) as ScoreRules['mixBonus'],
    attackBonus: rules.attackBonus.map(clamp) as ScoreRules['attackBonus'],
    attackOnCore: !!rules.attackOnCore,
    attackOnMix: !!rules.attackOnMix,
    coreCombo: clamp(rules.coreCombo),
    mixCombo: clamp(rules.mixCombo),
  }
}

export function scoreBodies(bodies: ScoreBody[], rules: ScoreRules = current): { points: number; why: string } {
  const expanded = bodies.flatMap((body) => Array.from({ length: body.count }, () => body))
  if (expanded.length === 0) return { points: 0, why: 'Empty' }

  const union = new Set<Attr>()
  let allHaveAttr = true
  for (const body of expanded) {
    if (body.attrs.length === 0) allHaveAttr = false
    for (const attr of body.attrs) {
      if (ATTRS.includes(attr)) union.add(attr)
    }
  }

  const base = expanded.length * rules.heroPoints
  const attack = attackBonus(expanded, rules)
  if (allHaveAttr && union.size === 1) {
    const color = [...union][0] ?? 'STR'
    const size = Math.min(expanded.length, 5)
    const bonus = rules.coreBonus[size - 1] ?? 0
    const atk = rules.attackOnCore ? attack.points : 0
    const whyAtk = rules.attackOnCore ? attack.why : ''
    return { points: base + bonus + atk, why: `${label(color)} ×${size}${whyAtk}` }
  }

  const mix = mixBonus(union.size, rules)
  const atk = rules.attackOnMix ? attack.points : 0
  const whyAtk = rules.attackOnMix ? attack.why : ''
  const why = union.size === 0 ? 'No attribute' : mix.why
  return { points: base + mix.points + atk, why: `${why}${whyAtk}` }
}

function mixBonus(colors: number, rules: ScoreRules): { points: number; why: string } {
  if (colors >= 4) return { points: rules.mixBonus[3] ?? 0, why: 'Four attributes' }
  if (colors === 3) return { points: rules.mixBonus[2] ?? 0, why: 'Three attributes' }
  if (colors === 2) return { points: rules.mixBonus[1] ?? 0, why: 'Two attributes' }
  if (colors === 1) return { points: rules.mixBonus[0] ?? 0, why: 'One attribute' }
  return { points: 0, why: 'No attribute' }
}

function attackBonus(bodies: ScoreBody[], rules: ScoreRules): { points: number; why: string } {
  const ranges = bodies.map((body) => body.range).filter((range): range is Range => range !== null)
  if (ranges.length < 1 || new Set(ranges).size !== 1) return { points: 0, why: '' }
  const count = Math.min(ranges.length, 5)
  const points = rules.attackBonus[count - 1] ?? 0
  if (points <= 0 && count < 3) return { points: 0, why: '' }
  if (points <= 0) return { points: 0, why: '' }
  return { points, why: ranges[0] === 'Melee' ? ' + Melee' : ' + Ranged' }
}

export function teamShape(why: string): 'core' | 'mix' | 'open' {
  if (/^(Strength|Agility|Intelligence|Universal) /.test(why)) return 'core'
  if (why.includes('attributes') || why.startsWith('One attribute')) return 'mix'
  return 'open'
}

function label(attr: Attr): string {
  if (attr === 'STR') return 'Strength'
  if (attr === 'AGI') return 'Agility'
  if (attr === 'INT') return 'Intelligence'
  return 'Universal'
}
