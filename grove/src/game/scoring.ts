import type { Attr, Range } from './types.ts'

export interface ScoreBody {
  attrs: Attr[]
  range: Range | null
  count: number
}

const MONO = [0, 1, 3, 6, 10, 15]

export function scoreBodies(bodies: ScoreBody[]): { points: number; why: string } {
  const expanded = bodies.flatMap((body) => Array.from({ length: body.count }, () => body))
  if (expanded.length === 0) return { points: 0, why: 'Empty' }

  let bestMono = 0
  let monoWhy = ''
  for (const color of ['STR', 'AGI', 'INT'] as const) {
    let count = 0
    for (const body of expanded) {
      if (body.attrs.includes(color) || body.attrs.includes('UNI')) count += 1
    }
    const points = MONO[Math.min(count, 5)] ?? 0
    if (points > bestMono) {
      bestMono = points
      monoWhy = `${label(color)} ×${Math.min(count, 5)}`
    }
  }

  const colors = new Set<Attr>()
  for (const body of expanded) {
    for (const attr of body.attrs) colors.add(attr)
  }
  let mix = 0
  if (colors.size >= 4) mix = 10
  else if (colors.size >= 3) mix = 5

  let bonus = 0
  let bonusWhy = ''
  if (mix > 0) {
    const ranges = expanded.map((body) => body.range).filter((range): range is Range => range !== null)
    if (ranges.length > 0 && new Set(ranges).size === 1) {
      bonus = colors.size >= 4 ? 2 : 1
      bonusWhy = ranges[0] === 'Melee' ? ' + Melee' : ' + Ranged'
    }
  }

  const mixPoints = mix + bonus
  if (mixPoints > bestMono) {
    const kind = colors.size >= 4 ? 'Four attributes' : 'Three attributes'
    return { points: mixPoints, why: `${kind}${bonusWhy}` }
  }
  if (bestMono === 0) return { points: 0, why: 'No attribute' }
  return { points: bestMono, why: monoWhy }
}

function label(attr: Attr): string {
  if (attr === 'STR') return 'Strength'
  if (attr === 'AGI') return 'Agility'
  if (attr === 'INT') return 'Intelligence'
  return 'Universal'
}
