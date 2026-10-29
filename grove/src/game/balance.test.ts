import { describe, expect, it } from 'vitest'
import { runMatchFast, summarizeReports } from './balance.ts'

describe('balance', () => {
  it('records card swings and turn graphs for a finished AI match', () => {
    const report = runMatchFast(58, 2)
    expect(report.over).toBe(true)
    expect(report.swings.length).toBeGreaterThan(0)
    expect(report.rounds.length).toBeGreaterThan(0)
    expect(report.finalScores).toHaveLength(2)

    const summary = summarizeReports([report])
    expect(summary.finished).toBe(1)
    expect(summary.cards.length).toBeGreaterThan(0)
    expect(summary.contested.length).toBeGreaterThan(0)
    expect(summary.avgPtsByTurn.length).toBeGreaterThan(0)
    expect(summary.avgCardsByTurn.length).toBeGreaterThan(0)
    expect(summary.kindSwing.length).toBeGreaterThan(0)
  })

  it('aggregates multiple parallel seeds', () => {
    const reports = [runMatchFast(11, 2), runMatchFast(12, 2), runMatchFast(13, 2)]
    const summary = summarizeReports(reports)
    expect(summary.matches).toBe(3)
    expect(summary.finished).toBe(3)
    expect(summary.avgTurns).toBeGreaterThan(0)
  })
})
