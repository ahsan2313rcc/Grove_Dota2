import { describe, expect, it } from 'vitest'
import { runDebugChecks } from './labDebug.ts'

describe('ability lab debug checks', () => {
  it('passes every registered regression', () => {
    const results = runDebugChecks()
    expect(results.length).toBeGreaterThan(0)
    const failed = results.filter((entry) => !entry.ok)
    expect(failed.map((entry) => `${entry.name}: ${entry.detail}`)).toEqual([])
  })

  it('attaches Puck checks only to Puck', () => {
    expect(runDebugChecks('puck').every((entry) => entry.defId === 'puck')).toBe(true)
    expect(runDebugChecks('axe')).toEqual([])
  })
})