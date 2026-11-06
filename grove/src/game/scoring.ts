import type { Attr, Range } from './types.ts'

export interface ScoreBody {
  attrs: Attr[]
  range: Range | null
  count: number
  /** When false, body still fills attr / size bonuses but grants no flat hero points (neutrals). */
  scoresFlat?: boolean
}

/** Tunable scoring used by the table and debug rail. Indices are 1-based sizes (slot 0 unused). */
export interface ScoreRules {
  /** Points per hero body. */
  heroPoints: number
  /** Core mono bonus by hero count 1..5. */
  coreBonus: [number, number, number, number, number]
  /** Mix attribute bonus by distinct attrs 1..4. */
  mixBonus: [number, number, number, number]
  /** Same-attack bonus by hero count 1..5. */
  attackBonus: [number, number, number, number, number]
  /** When true, teams with a CORE (3× same attr) also take the attack bonus. */
  attackOnCore: boolean
  /** When true, teams without CORE take the attack bonus (mix or open). */
  attackOnMix: boolean
  /** Three-of-a-kind terrain combo points. */
  coreCombo: number
  /** Mixed River/Jungle/Lane combo points. */
  mixCombo: number
  /** When true, The Ancient is shuffled into the deck after the opening deal. */
  ancientEndgame: boolean
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
  ancientEndgame: true,
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
    ancientEndgame: rules.ancientEndgame !== false,
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
    ancientEndgame: rules.ancientEndgame !== false,
  }
}

/** Minimum count for CORE (3×), MIXED (3+ attrs), and ATK (M3/R3). */
export const SHAPE_MIN_HEROES = 3

/**
 * Score a team.
 *
 * Base = heroPoints × flat bodies (neutrals excluded from flat, included in shape/atk counts).
 * CORE  = 3×+ same attr → coreBonus[stack] (stacks with MIXED).
 * MIXED = 3+ distinct attrs → mixBonus[attrs] (stacks with CORE).
 * ATK   = 3+ Melee **or** 3+ Ranged (counted separately; mixed range OK) →
 *         attackBonus[n], but **only when CORE is absent** (unless `attackOnCore`;
 *         non-core boards use `attackOnMix`).
 *
 * Why label: `STR x3, ATTR +3, ATK +1 (M3)` — attr/M·R numbers are counts; ATK is points.
 */
export type AttackScore = { tag: 'M' | 'R'; count: number; points: number }

export function scoreBodies(
  bodies: ScoreBody[],
  rules: ScoreRules = current,
): { points: number; why: string; attack: AttackScore } {
  const expanded = bodies.flatMap((body) => Array.from({ length: body.count }, () => body))
  if (expanded.length === 0) return { points: 0, why: 'Empty', attack: { tag: 'M', count: 0, points: 0 } }

  const union = new Set<Attr>()
  for (const body of expanded) {
    for (const attr of body.attrs) {
      if (ATTRS.includes(attr)) union.add(attr)
    }
  }

  const flatBodies = expanded.filter((body) => body.scoresFlat !== false)
  const base = flatBodies.length * rules.heroPoints
  const size = expanded.length
  const stack = maxMonoStack(expanded)
  const attrCount = union.size
  const attack = attackInfoFor(expanded, rules)

  // Every shape bonus needs a 3+ body team (CORE also needs 3× of one attr).
  const hasCore = size >= SHAPE_MIN_HEROES && stack.count >= SHAPE_MIN_HEROES
  const hasMix = size >= SHAPE_MIN_HEROES && attrCount >= SHAPE_MIN_HEROES
  const corePts = hasCore ? (rules.coreBonus[Math.min(stack.count, 5) - 1] ?? 0) : 0
  const mixPts = hasMix ? (rules.mixBonus[Math.min(attrCount, 4) - 1] ?? 0) : 0

  // ATK excluded whenever CORE qualifies (default); attackOnCore can re-enable.
  const atkAllowed = hasCore ? rules.attackOnCore : rules.attackOnMix
  const atkPts = atkAllowed ? attack.points : 0

  const points = base + corePts + mixPts + atkPts
  return {
    points,
    why: formatWhy({ hasCore, stack, attrCount, size, attack, atkPts }),
    attack: {
      tag: attack.tag as 'M' | 'R',
      count: attack.count,
      points: atkPts,
    },
  }
}

function formatWhy(opts: {
  hasCore: boolean
  stack: { attr: Attr; count: number }
  attrCount: number
  size: number
  attack: { count: number; tag: string }
  atkPts: number
}): string {
  const { hasCore, stack, attrCount, size, attack, atkPts } = opts
  const parts: string[] = []
  if (hasCore) parts.push(`${label(stack.attr)} x${Math.min(stack.count, 5)}`)
  if (attrCount >= 2) parts.push(`ATTR +${attrCount}`)
  // Surface the range bonus when it actually scores (CORE normally blocks it).
  if (atkPts > 0) parts.push(`ATK +${atkPts}`)

  let why = parts.join(', ')
  if (!why) {
    if (size < SHAPE_MIN_HEROES) why = `Small x${size}`
    else if (attrCount === 0) why = 'No attribute'
    else if (attrCount === 1) why = `${label(stack.attr)} x${Math.min(stack.count, 5)}`
    else why = `Open x${size}`
  }
  // (M#)/(R#) = heroes sharing that attack type (not the ATK point value).
  if (attack.count >= SHAPE_MIN_HEROES) why += ` (${attack.tag}${attack.count})`
  return why
}

/** Largest mono-attribute stack (multi-attr bodies do not pad a stack). Neutrals with an attr count. */
function maxMonoStack(bodies: ScoreBody[]): { attr: Attr; count: number } {
  const tallies: Record<Attr, number> = { STR: 0, AGI: 0, INT: 0, UNI: 0 }
  for (const body of bodies) {
    if (body.attrs.length !== 1) continue
    const attr = body.attrs[0]!
    tallies[attr] += 1
  }
  let best: Attr = 'STR'
  let count = 0
  for (const attr of ATTRS) {
    if (tallies[attr] > count) {
      best = attr
      count = tallies[attr]
    }
  }
  return { attr: best, count }
}

/**
 * ATK = 3+ Melee **or** 3+ Ranged, counted separately — mixed teams still score
 * (e.g. 3 Ranged + 2 Melee → R3). Neutrals carry a real Melee/Ranged type.
 * Label uses the winning side's body count (e.g. `(R4)`), never points.
 */
function attackInfoFor(bodies: ScoreBody[], rules: ScoreRules): { points: number; count: number; tag: string } {
  let melee = 0
  let ranged = 0
  for (const body of bodies) {
    if (body.range === 'Melee') melee += 1
    else if (body.range === 'Ranged') ranged += 1
  }
  if (melee === 0 && ranged === 0) return { points: 0, count: 0, tag: 'M' }

  // Prefer the larger stack; ties keep Melee.
  const useRanged = ranged > melee
  const count = useRanged ? ranged : melee
  const tag = useRanged ? 'R' : 'M'
  const capped = Math.min(count, 5)
  const points = capped >= SHAPE_MIN_HEROES ? (rules.attackBonus[capped - 1] ?? 0) : 0
  return { points, count, tag }
}

export function teamShapes(why: string): { core: boolean; mix: boolean } {
  const core = /(STR|AGI|INT|UNI) x(\d+)/.exec(why)
  const mix = /ATTR \+(\d+)/.exec(why)
  return {
    core: !!core && Number(core[2]) >= SHAPE_MIN_HEROES,
    mix: !!mix && Number(mix[1]) >= SHAPE_MIN_HEROES,
  }
}

/** Primary shape badge: CORE wins over MIXED when both qualify. */
export function teamShape(why: string): 'core' | 'mix' | 'open' {
  const shapes = teamShapes(why)
  if (shapes.core) return 'core'
  if (shapes.mix) return 'mix'
  return 'open'
}

function label(attr: Attr): string {
  return attr
}
