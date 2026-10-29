import { describe, expect, it } from 'vitest'
import { AI_STRATS } from './ai.ts'
import { ALL_STRAT_FILTER, runMatchFast, summarizeReports } from './balance.ts'

describe('balance', () => {
  it('records card swings, events, and shapes for a finished AI match', () => {
    const report = runMatchFast(58, 2)
    expect(report.over).toBe(true)
    expect(report.swings.length).toBeGreaterThan(0)
    expect(report.rounds.length).toBeGreaterThan(0)
    expect(report.finalScores).toHaveLength(2)
    expect(report.seatStrats).toHaveLength(2)
    expect(report.mixture).toBe(true)
    expect(report.events.drawDeck).toBeGreaterThan(0)
    expect(report.shapes.coreTeams + report.shapes.mixTeams + report.shapes.openTeams).toBeGreaterThan(0)
    expect(report.swings.every((swing) => AI_STRATS.some((entry) => entry.id === swing.actorStrat))).toBe(true)

    const summary = summarizeReports([report])
    expect(summary.finished).toBe(1)
    expect(summary.heroHigh.length + summary.settingHigh.length + summary.lootHigh.length).toBeGreaterThan(0)
    expect(summary.heroLow.length + summary.settingLow.length + summary.lootLow.length).toBeGreaterThan(0)
    expect(summary.shapeCompare).toHaveLength(9)
    expect(summary.eventStats.length).toBeGreaterThan(8)
    expect(summary.avgPtsByTurn.length).toBeGreaterThan(0)
    expect(summary.avgCardsByTurn.length).toBe(summary.avgPtsByTurn.length)
    expect(summary.turnLabels.length).toBe(summary.avgPtsByTurn.length)
    expect(summary.byStrat.length).toBeGreaterThan(0)
    expect(summary.byStrat.every((row) => row.avgStanding >= 1)).toBe(true)
    const core5 = summary.shapeCompare.find((row) => row.id === 'core_team_5')
    expect(core5).toBeTruthy()
    expect(core5!.pureCount).toBeGreaterThanOrEqual(0)
    expect(core5!.avgPtsPerCard).toBeGreaterThanOrEqual(0)
    if (core5!.count > 0 && core5!.avgPoints > 0) {
      expect(core5!.avgPtsPerCard).toBeGreaterThan(0)
    }
  })

  it('filters graphs and split Rel tables to enabled strats', () => {
    const reports = [
      runMatchFast(11, 2),
      runMatchFast(12, 2, ['tempo', 'tempo']),
      runMatchFast(13, 2, ['spite', 'spite']),
    ]
    const all = summarizeReports(reports, ALL_STRAT_FILTER)
    expect(all.matches).toBe(3)
    expect(all.finished).toBe(3)
    expect(all.avgPtsByTurn.length).toBeGreaterThan(0)
    expect(all.byAttr.length).toBeGreaterThan(0)

    const tempo = summarizeReports(reports, { strats: ['tempo'], mixOnly: false })
    expect(tempo.matches).toBeGreaterThan(0)
    expect(tempo.avgPtsByTurn.length).toBe(tempo.turnLabels.length)
    expect(tempo.byStrat.every((row) => row.strat === 'tempo')).toBe(true)
    expect(tempo.heroHigh[0] ? tempo.heroHigh[0].avgRelativeSwing >= (tempo.heroLow[0]?.avgRelativeSwing ?? -Infinity) : true).toBe(true)
    expect(tempo.eventStats.find((row) => row.id === 'drawDeck')?.total).toBeGreaterThan(0)
    const tempoDraw = tempo.eventStats.find((row) => row.id === 'drawDeck')!.total
    const allDraw = all.eventStats.find((row) => row.id === 'drawDeck')!.total
    expect(tempoDraw).toBeLessThan(allDraw)
    const tempoShapes = tempo.shapeCompare.find((row) => row.id === 'mix_team')!.count
    const allShapes = all.shapeCompare.find((row) => row.id === 'mix_team')!.count
    expect(tempoShapes).toBeLessThanOrEqual(allShapes)

    const mixSeats = summarizeReports(reports, { strats: [], mixOnly: true })
    expect(mixSeats.matches).toBe(reports.filter((report) => report.mixture).length)
    expect(mixSeats.shapeCompare.some((row) => row.count >= 0)).toBe(true)
  })
})
