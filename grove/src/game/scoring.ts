import type { Attr, Range } from './types.ts'

export interface ScoreBody {
  attrs: Attr[]
  range: Range | null
  count: number
}

const MONO_BONUS = [0, 0, 1, 3, 6, 10]
const ATTRS: Attr[] = ['STR', 'AGI', 'INT', 'UNI']

export function scoreBodies(bodies: ScoreBody[]): { points: number; why: string } {
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

  const attack = attackBonus(expanded)
  if (allHaveAttr && union.size === 1) {
    const color = [...union][0] ?? 'STR'
    const bonus = MONO_BONUS[Math.min(expanded.length, 5)] ?? 0
    return { points: expanded.length + bonus, why: `${label(color)} ×${Math.min(expanded.length, 5)}` }
  }

  const mix = mixBonus(union.size)
  const why = union.size === 0 ? 'No attribute' : mix.why
  return { points: expanded.length + mix.points + attack.points, why: `${why}${attack.why}` }
}

function mixBonus(colors: number): { points: number; why: string } {
  if (colors >= 4) return { points: 6, why: 'Four attributes' }
  if (colors === 3) return { points: 2, why: 'Three attributes' }
  if (colors === 2) return { points: 0, why: 'Two attributes' }
  return { points: 0, why: 'No attribute' }
}

function attackBonus(bodies: ScoreBody[]): { points: number; why: string } {
  const ranges = bodies.map((body) => body.range).filter((range): range is Range => range !== null)
  if (ranges.length < 3 || new Set(ranges).size !== 1) return { points: 0, why: '' }
  const count = Math.min(ranges.length, 5)
  const points = count >= 5 ? 3 : count >= 4 ? 2 : 1
  return { points, why: ranges[0] === 'Melee' ? ' + Melee' : ' + Ranged' }
}

function label(attr: Attr): string {
  if (attr === 'STR') return 'Strength'
  if (attr === 'AGI') return 'Agility'
  if (attr === 'INT') return 'Intelligence'
  return 'Universal'
}
