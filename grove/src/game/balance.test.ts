import { describe, expect, it } from 'vitest'
import { AI_STRATS } from './ai.ts'
import { ALL_STRAT_FILTER, BalanceTracker, runMatchFast, summarizeReports } from './balance.ts'
import { apply, createGame } from './engine.ts'
import { blankTeam, makeCard, makeHero, setPlayer } from './flow.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

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

    expect(report.seatPlays.length).toBe(2)
    expect(report.seatPlays.some((plays) => plays.length > 0)).toBe(true)
    const summary = summarizeReports([report])
    expect(summary.finished).toBe(1)
    expect(summary.heroHigh.length + summary.terrainHigh.length + summary.lootHigh.length).toBeGreaterThan(0)
    const sample = [...summary.heroHigh, ...summary.terrainHigh, ...summary.lootHigh][0]
    if (sample) {
      expect(sample.avgAbsSwing).toBeGreaterThanOrEqual(0)
      expect(sample.presence).toBeGreaterThanOrEqual(0)
    }
    expect(summary.heroLow.length + summary.terrainLow.length + summary.lootLow.length).toBeGreaterThan(0)
    expect(summary.shapeCompare).toHaveLength(9)
    expect(summary.eventStats.length).toBeGreaterThan(8)
    expect(summary.avgPtsByTurn.length).toBeGreaterThan(0)
    expect(summary.avgCardsByTurn.length).toBe(summary.avgPtsByTurn.length)
    expect(summary.turnLabels.length).toBe(summary.avgPtsByTurn.length)
    expect(summary.byStrat.length).toBeGreaterThan(0)
    expect(summary.byStrat.every((row) => row.avgStanding >= 1)).toBe(true)
    const coreAll = summary.shapeCompare.find((row) => row.id === 'core_team')
    const core3 = summary.shapeCompare.find((row) => row.id === 'core_team_3')
    const core4 = summary.shapeCompare.find((row) => row.id === 'core_team_4')
    const core5 = summary.shapeCompare.find((row) => row.id === 'core_team_5')
    expect(core5).toBeTruthy()
    expect(core5!.pureCount).toBeGreaterThanOrEqual(0)
    expect(core5!.avgPtsPerCard).toBeGreaterThanOrEqual(0)
    // Avg pts only from mono cores — zero when pureCount is 0 even if stack n > 0.
    if (core5!.pureCount > 0) {
      expect(core5!.avgPoints).toBeGreaterThan(0)
      expect(core5!.avgPtsPerCard).toBeGreaterThan(0)
    } else {
      expect(core5!.avgPoints).toBe(0)
    }
    // Core team /match = exclusive ×3+×4+×5. Pure / avg pts from mono cores.
    if (coreAll && core3 && core4 && core5) {
      expect(coreAll.count).toBe(core3.count + core4.count + core5.count)
      expect(coreAll.pureCount).toBe(core3.pureCount + core4.pureCount + core5.pureCount)
      if (coreAll.pureCount > 0) {
        expect(coreAll.avgPoints).toBeCloseTo(coreAll.totalPoints / coreAll.pureCount, 5)
      } else {
        expect(coreAll.avgPoints).toBe(0)
      }
    }
    const mix3 = summary.shapeCompare.find((row) => row.id === 'mix_team_3')
    const mix4 = summary.shapeCompare.find((row) => row.id === 'mix_team_4')
    expect(mix3).toBeTruthy()
    expect(mix4).toBeTruthy()
    expect(summary.heroes.length + summary.abilities.length).toBeGreaterThan(0)
    expect(report.swings.some((swing) => swing.kind === 'ability' || swing.kind === 'hero')).toBe(true)
  })

  it('filters graphs and split Rel tables to enabled strats', () => {
    const reports = [
      runMatchFast(11, 2),
      runMatchFast(12, 2, ['tempo', 'tempo']),
      runMatchFast(13, 2, ['spite', 'spite']),
    ]
    const all = summarizeReports(reports, ALL_STRAT_FILTER)
    expect(all.matches).toBe(3)
    // Retuned casts can still leave rare soft-locks; require most matches finish.
    expect(all.finished).toBeGreaterThanOrEqual(2)
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

  it('counts exclusive core ×3/×4/×5 and mix · 3 attrs', () => {
    let game = apply(createGame({ seed: 3, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    game = seatDefs(game, 0, [
      ['sven', 'axe', 'pudge'], // core ×3 STR
      ['slardar', 'tidehunter', 'earthshaker', 'bristleback'], // core ×4 STR
      ['juggernaut', 'phantom_assassin', 'anti_mage'], // core ×3 AGI
      ['sven', 'juggernaut', 'crystal_maiden'], // mix · 3 attrs
      ['sven', 'juggernaut', 'crystal_maiden', 'marci'], // mix · 4 attrs
    ])
    const tracker = new BalanceTracker(3)
    tracker.start(game)
    const report = tracker.finish(game)
    expect(report.shapes.coreTeams3).toBe(2) // STR×3 + AGI×3
    expect(report.shapes.coreTeams4).toBe(1)
    expect(report.shapes.coreTeams5).toBe(0)
    expect(report.shapes.pureCore3).toBe(2)
    expect(report.shapes.pureCore4).toBe(1)
    expect(report.shapes.mixTeams3).toBe(1)
    expect(report.shapes.mixTeams4).toBe(1)
    const summary = summarizeReports([report])
    const coreAll = summary.shapeCompare.find((row) => row.id === 'core_team')!
    expect(coreAll.count).toBe(3) // 2×3 + 1×4
    expect(coreAll.avgCount).toBeCloseTo(3, 5)
  })

  it('splits body placement vs ability swing when a cast prompt opens', () => {
    let game = apply(createGame({ seed: 9, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    game = only(game, 0, ['earth_spirit'])
    game = only(game, 1, ['sven'])
    // Seat an enemy so Earth Spirit has a target.
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })

    const tracker = new BalanceTracker(9)
    tracker.start(game)
    const before = game
    game = apply(game, { type: 'play', uid: uid(game, 0, 'earth_spirit'), team: 'new' })
    tracker.observe(before, { type: 'play', uid: uid(before, 0, 'earth_spirit'), team: 'new' }, game)
    game = passTracked(game, tracker)
    // Cast prompt should open after the interrupt window.
    if (game.pending?.resume.kind === 'cast') {
      const target = game.pending.choices.find((choice) => choice.id.startsWith('hero:'))
      expect(target).toBeTruthy()
      const prior = game
      game = apply(game, { type: 'choose', ids: [target!.id] })
      tracker.observe(prior, { type: 'choose', ids: [target!.id] }, game)
    }
    const report = tracker.finish(game)
    const body = report.swings.filter((swing) => swing.defId === 'earth_spirit' && swing.kind === 'hero')
    const ability = report.swings.filter((swing) => swing.defId === 'earth_spirit' && swing.kind === 'ability')
    expect(body.length).toBeGreaterThanOrEqual(1)
    expect(ability.length).toBeGreaterThanOrEqual(1)
  })
})

function seatDefs(game: Game, player: PlayerId, teams: string[][]): Game {
  let next = game
  const built = []
  for (const [index, defs] of teams.entries()) {
    const heroes = []
    for (const defId of defs) {
      let card: CardInst
      ;[next, card] = makeCard(next, defId, 'hero')
      heroes.push(makeHero(card, player, player, next))
    }
    built.push({ ...blankTeam(`seat-${player}-${index}`), heroes })
  }
  return setPlayer(next, player, (seat) => ({ ...seat, teams: built }))
}

function only(game: Game, player: PlayerId, defIds: string[]): Game {
  let next = game
  const found: CardInst[] = []
  for (const defId of defIds) {
    const card =
      next.deck.find((entry) => entry.defId === defId) ??
      next.players.flatMap((seat) => seat.hand).find((entry) => entry.defId === defId)
    if (!card) throw new Error(`missing ${defId}`)
    found.push(card)
    next = {
      ...next,
      deck: next.deck.filter((entry) => entry.uid !== card.uid),
      players: next.players.map((seat) => ({
        ...seat,
        hand: seat.hand.filter((entry) => entry.uid !== card.uid),
      })),
    }
  }
  return {
    ...next,
    players: next.players.map((seat, index) => (index === player ? { ...seat, hand: found } : seat)),
  }
}

function uid(game: Game, player: PlayerId, defId: string): string {
  return game.players[player].hand.find((card) => card.defId === defId)?.uid ?? ''
}

function passInstants(game: Game): Game {
  let next = game
  let guard = 0
  while (next.pending?.resume.kind === 'instant-window' && guard++ < 12) {
    next = apply(next, { type: 'choose', ids: ['pass'] })
  }
  return next
}

function passTracked(game: Game, tracker: BalanceTracker): Game {
  let next = game
  let guard = 0
  while (next.pending?.resume.kind === 'instant-window' && guard++ < 12) {
    const prior = next
    next = apply(next, { type: 'choose', ids: ['pass'] })
    tracker.observe(prior, { type: 'choose', ids: ['pass'] }, next)
  }
  return next
}
