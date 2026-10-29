import { describe, expect, it } from 'vitest'
import { AI_STRATS } from './ai.ts'
import { runMatchFast, summarizeReports } from './balance.ts'

describe('balance', () => {
  it('records card swings and turn graphs for a finished AI match', () => {
    const report = runMatchFast(58, 2)
    expect(report.over).toBe(true)
    expect(report.swings.length).toBeGreaterThan(0)
    expect(report.rounds.length).toBeGreaterThan(0)
    expect(report.finalScores).toHaveLength(2)
    expect(report.seatStrats).toHaveLength(2)
    expect(report.mixture).toBe(true)
    expect(report.swings.every((swing) => AI_STRATS.some((entry) => entry.id === swing.actorStrat))).toBe(true)

    const summary = summarizeReports([report])
    expect(summary.finished).toBe(1)
    expect(summary.cards.length).toBeGreaterThan(0)
    expect(summary.contested.length).toBeGreaterThan(0)
    expect(summary.avgPtsByTurn.length).toBeGreaterThan(0)
    expect(summary.avgCardsByTurn.length).toBeGreaterThan(0)
    expect(summary.kindSwing.length).toBeGreaterThan(0)
    expect(summary.byStrat.length).toBeGreaterThan(0)
  })

  it('aggregates multiple parallel seeds and filters by strat', () => {
    const reports = [
      runMatchFast(11, 2),
      runMatchFast(12, 2, ['tempo', 'tempo']),
      runMatchFast(13, 2, ['spite', 'spite']),
    ]
    const all = summarizeReports(reports, 'all')
    expect(all.matches).toBe(3)
    expect(all.finished).toBe(3)
    expect(all.avgTurns).toBeGreaterThan(0)

    const tempo = summarizeReports(reports, 'tempo')
    expect(tempo.matches).toBeGreaterThan(0)
    expect(tempo.filter).toBe('tempo')

    const mixOnly = summarizeReports(reports, 'mix')
    expect(mixOnly.matches).toBe(reports.filter((report) => report.mixture).length)
  })
})
