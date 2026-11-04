import { describe, expect, it } from 'vitest'
import {
  DRAW_MULT,
  REMOVAL_MULT,
  bounceHandEv,
  controlEv,
  effectEv,
  DEFAULT_CALIBRATION,
  trapEv,
} from './evModel.ts'

describe('evModel', () => {
  it('ranks permanent exile above destroy and hostage below', () => {
    expect(REMOVAL_MULT.exilePermanent).toBeGreaterThan(REMOVAL_MULT.destroy)
    expect(REMOVAL_MULT.exileHostage).toBeLessThan(REMOVAL_MULT.destroy)
    expect(REMOVAL_MULT.toBottom).toBeLessThan(REMOVAL_MULT.destroy)
  })

  it('values dig/search above blind draw', () => {
    expect(DRAW_MULT.dig).toBeGreaterThan(DRAW_MULT.draw)
    expect(DRAW_MULT.search).toBeGreaterThan(DRAW_MULT.dig)
  })

  it('bounce includes body + ability opportunity + action tax', () => {
    const ev = bounceHandEv({ vBody: 3, vAbility: 2, isAura: false, alpha: 2.5 })
    expect(ev).toBeCloseTo(3 + 0.85 * 2 + 2.5, 5)
    const aura = bounceHandEv({ vBody: 3, vAbility: 2, isAura: true, alpha: 2.5 })
    expect(aura).toBeCloseTo(3 + 2.5, 5)
  })

  it('control sums gained and denied body/ability', () => {
    expect(
      controlEv({
        vBodyGained: 2,
        vBodyDenied: 3,
        vAbilityGained: 1,
        vAbilityDenied: 1.5,
      }),
    ).toBeCloseTo(7.5, 5)
  })

  it('trap sums block bracket and trigger EV', () => {
    expect(trapEv(1.5, 4)).toBeCloseTo(5.5, 5)
  })

  it('effectEv uses calibration yardsticks', () => {
    const cal = { ...DEFAULT_CALIBRATION, alpha: 2, beta: 1, meanVBody: 3, meanVAbility: 1 }
    expect(effectEv('destroy', cal)).toBeCloseTo(3, 5)
    expect(effectEv('exilePermanent', cal)).toBeCloseTo(3.3, 5)
    expect(effectEv('exileHostage', cal)).toBeCloseTo(2.1, 5)
    expect(effectEv('exileTempo', cal)).toBeCloseTo(2, 5)
    expect(effectEv('dig', cal)).toBeGreaterThan(effectEv('draw', cal))
  })
})
