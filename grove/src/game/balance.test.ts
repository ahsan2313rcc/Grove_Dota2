import { describe, expect, it } from 'vitest'
import { AI_STRATS } from './ai.ts'
import { ALL_STRAT_FILTER, runMatchFast, summarizeReports } from './balance.ts'

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
    expect(summary.avgCardsByTurn.length).toBe(summary.avgPtsByTurn.length)
    expect(summary.turnLabels.length).toBe(summary.avgPtsByTurn.length)
    expect(summary.kindSwing.length).toBeGreaterThan(0)
    expect(summary.byStrat.length).toBeGreaterThan(0)
  })

  it('filters graphs and tables to enabled strats', () => {
    const reports = [
      runMatchFast(11, 2),
      runMatchFast(12, 2, ['tempo', 'tempo']),
      runMatchFast(13, 2, ['spite', 'spite']),
    ]
    const all = summarizeReports(reports, ALL_STRAT_FILTER)
    expect(all.matches).toBe(3)
    expect(all.finished).toBe(3)
    expect(all.avgPtsByTurn.length).toBeGreaterThan(0)

    const tempo = summarizeReports(reports, { strats: ['tempo'], mixOnly: false })
    expect(tempo.matches).toBeGreaterThan(0)
    expect(tempo.avgPtsByTurn.length).toBe(tempo.turnLabels.length)
    expect(tempo.avgPtsByTurn.length).toBeGreaterThan(0)
    expect(tempo.byStrat.every((row) => row.strat === 'tempo')).toBe(true)
    expect(tempo.kindSwing.every((row) => row.plays > 0)).toBe(true)
    expect(tempo.cards.length).toBeGreaterThan(0)
    expect(tempo.cardsLow.length).toBeGreaterThan(0)
    expect(tempo.cards[0]!.avgRelativeSwing).toBeGreaterThanOrEqual(tempo.cards[tempo.cards.length - 1]!.avgRelativeSwing)
    expect(tempo.cardsLow[0]!.avgRelativeSwing).toBeLessThanOrEqual(tempo.cardsLow[tempo.cardsLow.length - 1]!.avgRelativeSwing)

    const spite = summarizeReports(reports, { strats: ['spite'], mixOnly: false })
    expect(spite.cards.length).toBeGreaterThan(0)
    expect(spite.cardsLow.length).toBeGreaterThan(0)
    // Filtered rankings should differ from the unfiltered absolute list shape.
    expect(spite.cards[0]!.avgRelativeSwing).toBeGreaterThanOrEqual(spite.cardsLow[0]!.avgRelativeSwing)

    const mixOnly = summarizeReports(reports, { strats: [], mixOnly: true })
    expect(mixOnly.matches).toBe(reports.filter((report) => report.mixture).length)
    expect(mixOnly.avgPtsByTurn.length).toBe(mixOnly.turnLabels.length)
  })
})

