import { describe, expect, it } from 'vitest'
import { searchModeForStrat } from './ai.ts'
import { AI_POWER_MAX, AI_POWER_MIN, aiSearchBudget, setAiThoughtPower } from './aiPower.ts'

describe('ai thought power', () => {
  it('scales budget from min to max', () => {
    const low = aiSearchBudget(AI_POWER_MIN)
    const high = aiSearchBudget(AI_POWER_MAX)
    expect(high.depth).toBeGreaterThan(low.depth)
    expect(high.beam).toBeGreaterThan(low.beam)
    expect(high.handPly).toBeGreaterThan(low.handPly)
    expect(high.pendingTry).toBeGreaterThan(low.pendingTry)
  })

  it('clamps setAiThoughtPower', () => {
    expect(setAiThoughtPower(0)).toBe(AI_POWER_MIN)
    expect(setAiThoughtPower(99)).toBe(AI_POWER_MAX)
    expect(setAiThoughtPower(7)).toBe(7)
  })

  it('keeps Stats/batch heuristics on Challenge (no demotion vs Neural)', () => {
    expect(searchModeForStrat('balanced', true)).toBe('challenge')
    expect(searchModeForStrat('spite', true)).toBe('challenge')
    expect(searchModeForStrat('tempo', true)).toBe('challenge')
    expect(searchModeForStrat('architect', true)).toBe('challenge')
    expect(searchModeForStrat('neural', true)).toBe('neural')
    expect(searchModeForStrat('neural', false)).toBe('neural')
  })
})
