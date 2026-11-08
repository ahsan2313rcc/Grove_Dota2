/**
 * Thought power for base (Challenge) heuristic AI.
 * Scales beam width, turn depth, hand fanout, and pending search.
 */

export const AI_POWER_MIN = 1
export const AI_POWER_MAX = 10
export const AI_POWER_DEFAULT = 7

const STORAGE_KEY = 'grove.ai-thought-power.v1'

export type AiSearchBudget = {
  /** Beam width for turn planning. */
  beam: number
  /** Max actions looked ahead in a turn line. */
  depth: number
  /** Unique hand cards to expand. */
  handPly: number
  /** Team destinations per card. */
  teamOpts: number
  /** Pending choices to 1-ply verify. */
  pendingTry: number
}

let power = AI_POWER_DEFAULT

export function getAiThoughtPower(): number {
  return power
}

export function setAiThoughtPower(value: number): number {
  power = clamp(value)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, String(power))
  }
  return power
}

export function bootAiThoughtPower(): number {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw != null) {
      const n = Number(raw)
      if (Number.isFinite(n)) power = clamp(n)
    }
  }
  return power
}

/** Map 1..10 → search budget. 1 ≈ light, 10 ≈ max. */
export function aiSearchBudget(level = power): AiSearchBudget {
  const p = clamp(level)
  // Linear-ish curves with a floor so level 1 still plays.
  return {
    beam: Math.round(2 + (p - 1) * (14 - 2) / 9), // 2 → 14
    depth: Math.round(1 + (p - 1) * (6 - 1) / 9), // 1 → 6
    handPly: Math.round(2 + (p - 1) * (10 - 2) / 9), // 2 → 10
    teamOpts: Math.round(1 + (p - 1) * (4 - 1) / 9), // 1 → 4
    pendingTry: Math.round(3 + (p - 1) * (20 - 3) / 9), // 3 → 20
  }
}

/**
 * Compact budgets for offline training throughput only (`opts.fast` on Neural / train loops).
 * Stats matchups use `aiSearchBudget()` for both Challenge and Neural so thought power is fair.
 */
export const BATCH_CHALLENGE_BUDGET: AiSearchBudget = {
  beam: 5,
  depth: 3,
  handPly: 5,
  teamOpts: 2,
  pendingTry: 8,
}

/** Neural train-fast budget (kept in sync with nnValue FAST_BUDGET). */
export const BATCH_NEURAL_BUDGET: AiSearchBudget = {
  beam: 3,
  depth: 2,
  handPly: 4,
  teamOpts: 1,
  pendingTry: 6,
}

export function aiThoughtPowerLabel(level = power): string {
  const p = clamp(level)
  if (p <= 2) return 'Fast'
  if (p <= 4) return 'Light'
  if (p <= 6) return 'Standard'
  if (p <= 8) return 'Deep'
  return 'Max'
}

function clamp(value: number): number {
  return Math.max(AI_POWER_MIN, Math.min(AI_POWER_MAX, Math.round(value)))
}
