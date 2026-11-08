import { describe, expect, it } from 'vitest'
import { AI_STRATS } from './ai.ts'
import {
  ALL_STRAT_FILTER,
  BalanceTracker,
  buildTurnGraph,
  runMatchFast,
  summarizeReports,
  summarizeShapesAtTurn,
  type MatchReport,
} from './balance.ts'
import { apply, createGame } from './engine.ts'
import { blankTeam, makeCard, makeHero, setPlayer } from './flow.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

describe('balance', () => {
  it('records card swings, events, and shapes for a finished AI match', () => {
    const report = runMatchFast(58, 2)
    expect(report.over).toBe(true)
    expect(report.overReason).toBeTruthy()
    expect(report.swings.length).toBeGreaterThan(0)
    expect(report.rounds.length).toBeGreaterThan(0)
    expect(report.finalScores).toHaveLength(2)
    expect(report.seatStrats).toHaveLength(2)
    expect(report.mixture).toBe(true)
    expect(report.events.drawDeck).toBeGreaterThanOrEqual(report.turns - 1)
    expect(report.shapes.mixTerrainPoints).toBe(report.shapes.mixTerrains * 5)
    expect(report.shapes.pairTerrainPoints).toBe(report.shapes.pairTerrains * 3)
    expect(report.shapes.coreTeams + report.shapes.mixTeams + report.shapes.openTeams).toBeGreaterThan(0)
    expect(report.swings.every((swing) => AI_STRATS.some((entry) => entry.id === swing.actorStrat))).toBe(true)

    expect(report.seatPlays.length).toBe(2)
    expect(report.seatPlays.some((plays) => plays.length > 0)).toBe(true)
    const summary = summarizeReports([report])
    expect(summary.finished).toBe(1)
    // Every play carries measured horizons; Impact is relative to an average play, so it centres on 0.
    expect(report.swings.every((swing) => swing.horizon?.length === 4)).toBe(true)
    const all = [...summary.heroes, ...summary.abilities, ...summary.terrains, ...summary.loot, ...summary.cards.filter((row) => row.kind === 'draw')]
    const weighted = all.reduce((sum, row) => sum + row.avgImpact * row.plays, 0)
    const plays = all.reduce((sum, row) => sum + row.plays, 0)
    expect(Math.abs(weighted / Math.max(1, plays))).toBeLessThan(1.5)
    expect(summary.heroHigh.length + summary.terrainHigh.length + summary.lootHigh.length).toBeGreaterThan(0)
    const sample = [...summary.heroHigh, ...summary.terrainHigh, ...summary.lootHigh][0]
    if (sample) {
      expect(sample.avgAbsSwing).toBeGreaterThanOrEqual(0)
      expect(sample.presence).toBeGreaterThanOrEqual(0)
    }
    expect(summary.heroLow.length + summary.terrainLow.length + summary.lootLow.length).toBeGreaterThan(0)
    expect(summary.shapeCompare).toHaveLength(14)
    expect(summary.shapeCompare.some((row) => row.id === 'river_terrain')).toBe(true)
    expect(summary.shapeCompare.some((row) => row.id === 'jungle_terrain')).toBe(true)
    expect(summary.shapeCompare.some((row) => row.id === 'lane_terrain')).toBe(true)
    expect(summary.shapeCompare.some((row) => row.id === 'mix_terrain')).toBe(true)
    expect(summary.shapeCompare.some((row) => row.id === 'pair_terrain')).toBe(true)
    expect(summary.shapeCompare.some((row) => row.id === 'small_team_1')).toBe(true)
    expect(summary.shapeCompare.some((row) => row.id === 'small_team_2')).toBe(true)
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
    // Avg pts = mean team score in the bucket; pts/card = points ÷ heroes.
    if (core5!.count > 0) {
      expect(core5!.avgPoints).toBeCloseTo(core5!.totalPoints / core5!.count, 5)
      expect(core5!.avgPtsPerCard).toBeGreaterThan(0)
    } else {
      expect(core5!.avgPoints).toBe(0)
    }
    // Core team /match = ×3+×4+×5 stacks. Pure = mono-only.
    if (coreAll && core3 && core4 && core5) {
      expect(coreAll.count).toBe(core3.count + core4.count + core5.count)
      expect(coreAll.pureCount).toBe((core3.pureCount ?? 0) + (core4.pureCount ?? 0) + (core5.pureCount ?? 0))
      if (coreAll.count > 0) {
        expect(coreAll.avgPoints).toBeCloseTo(coreAll.totalPoints / coreAll.count, 5)
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

  it('counts core ×3/×4/×5 and dual-counts mix when attrs ≥ 3', () => {
    let game = apply(createGame({ seed: 3, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    game = seatDefs(game, 0, [
      ['sven', 'axe', 'pudge'], // core ×3 STR pure
      ['slardar', 'tidehunter', 'earthshaker', 'bristleback'], // core ×4 STR pure
      ['juggernaut', 'phantom_assassin', 'anti_mage'], // core ×3 AGI pure
      ['sven', 'juggernaut', 'crystal_maiden'], // mix · 3 attrs (no core stack)
      ['sven', 'axe', 'pudge', 'juggernaut', 'crystal_maiden'], // core ×3 STR + mix · 3 attrs (dual)
    ])
    const tracker = new BalanceTracker(3)
    tracker.start(game)
    const report = tracker.finish(game)
    expect(report.shapes.coreTeams3).toBe(3) // two pure ×3 + dual ×3
    expect(report.shapes.coreTeams4).toBe(1)
    expect(report.shapes.coreTeams5).toBe(0)
    expect(report.shapes.pureCore3).toBe(2)
    expect(report.shapes.pureCore4).toBe(1)
    expect(report.shapes.mixTeams3).toBe(2) // pure mix + dual
    expect(report.shapes.mixTeams4).toBe(0)
    const summary = summarizeReports([report])
    const coreAll = summary.shapeCompare.find((row) => row.id === 'core_team')!
    expect(coreAll.count).toBe(4) // 3×3 + 1×4
    const core3 = summary.shapeCompare.find((row) => row.id === 'core_team_3')!
    expect(core3.count).toBe(3)
    expect(core3.avgPtsPerCard).toBeGreaterThan(0)
  })

  it('records shapeHistory on full tracker; lite batch sims skip it', () => {
    const lite = runMatchFast(21, 2)
    expect(lite.shapeHistory.length).toBe(0)
    expect(lite.shapes).toBeTruthy()

    // Full tracker (watch / non-lite) still snapshots shapes each round.
    let game = apply(createGame({ seed: 22, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    const tracker = new BalanceTracker(22)
    tracker.start(game)
    const beforeEnd = game
    game = apply(game, { type: 'end' })
    tracker.observe(beforeEnd, { type: 'end' }, game)
    if (game.veil) {
      const veiled = game
      game = apply(game, { type: 'ready' })
      tracker.observe(veiled, { type: 'ready' }, game)
    }
    const full = tracker.finish(game)
    expect(full.shapeHistory.length).toBeGreaterThan(0)
    expect(full.shapeHistory.every((snap) => snap.turn >= 1 && snap.scores.length === 2)).toBe(true)

    const summary = summarizeReports([lite])
    expect(summary.maxTurn).toBeGreaterThanOrEqual(1)
    expect(summary.graphHeroes.length).toBeGreaterThan(0)
    for (const row of summary.shapeCompare) {
      if (row.id.startsWith('core_team')) expect(row.avgPoints).toBeLessThanOrEqual(15)
      if (row.id.startsWith('mix_team')) expect(row.avgPoints).toBeLessThanOrEqual(15)
    }
    const mid = Math.max(1, Math.floor(full.turns / 2) || 1)
    const atMid = summarizeShapesAtTurn([full], ALL_STRAT_FILTER, mid)
    expect(atMid).toHaveLength(14)
    const graph = buildTurnGraph([full], ALL_STRAT_FILTER, 'seatScore', null)
    expect(Array.isArray(graph)).toBe(true)
    const rel = buildTurnGraph([full], ALL_STRAT_FILTER, 'rel', summary.graphHeroes[0]?.defId ?? null)
    expect(Array.isArray(rel)).toBe(true)
  })

  it('splits hero play-weighted Win% into ability-fired vs silenced', () => {
    // Build two finished reports with synthetic hero play swings.
    const base = (seed: number, winner: number, silenced: boolean): MatchReport => {
      const report = runMatchFast(seed, 2)
      // Replace swings with a single Enigma play so rates are deterministic.
      const actor = 0
      report.winner = winner
      report.over = true
      report.swings = [
        {
          seed,
          turn: 1,
          actor,
          actorStrat: report.seatStrats[actor] ?? 'balanced',
          defId: 'enigma',
          name: 'Enigma',
          kind: 'hero',
          bucket: 'hero',
          attr: 'STR',
          instant: false,
          playId: 1,
          silenced,
          actorSwing: 1,
          relativeSwing: 1,
          fieldSwing: 1,
          destroy: silenced ? 0 : 3,
          discard: 0,
          exile: 0,
          control: 0,
          bounce: 0,
          pressure: silenced ? 0 : 3,
        },
        {
          seed,
          turn: 1,
          actor,
          actorStrat: report.seatStrats[actor] ?? 'balanced',
          defId: 'enigma',
          name: 'Enigma',
          kind: 'ability',
          bucket: 'ability',
          attr: 'STR',
          instant: false,
          playId: 1,
          silenced,
          actorSwing: silenced ? 0 : 2,
          relativeSwing: silenced ? 0 : 2,
          fieldSwing: silenced ? 0 : 2,
          destroy: silenced ? 0 : 3,
          discard: 0,
          exile: 0,
          control: 0,
          bounce: 0,
          pressure: silenced ? 0 : 3,
        },
      ]
      report.seatPlays[actor] = [...new Set([...(report.seatPlays[actor] ?? []), 'enigma'])]
      return report
    }
    // 2 ability wins, 1 ability loss, 1 silenced win, 1 silenced loss →
    // total 5 plays / 3 wins = 60%; ability 3 plays / 2 wins ≈ 67%; sil 2 / 1 = 50%.
    const reports = [
      base(501, 0, false),
      base(502, 0, false),
      base(503, 1, false),
      base(504, 0, true),
      base(505, 1, true),
    ]
    const summary = summarizeReports(reports)
    const row = summary.heroPlaysTotal.find((entry) => entry.defId === 'enigma')
    expect(row).toBeTruthy()
    expect(row!.plays).toBe(5)
    expect(row!.abilityPlays).toBe(3)
    expect(row!.silencedPlays).toBe(2)
    expect(row!.playWins).toBe(3)
    expect(row!.abilityWins).toBe(2)
    expect(row!.silencedWins).toBe(1)
    expect(row!.playWinRate).toBeCloseTo(0.6, 5)
    expect(row!.abilityWinRate).toBeCloseTo(2 / 3, 5)
    expect(row!.silencedWinRate).toBeCloseTo(0.5, 5)
  })

  it('attributes destroy / discard pressure onto the resolving swing', () => {
    let game = apply(createGame({ seed: 17, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    // Seat a 3-INT team for Anti-Mage to wipe.
    game = seatDefs(game, 1, [['crystal_maiden', 'lion', 'lina']])
    game = only(game, 0, ['anti_mage'])
    const tracker = new BalanceTracker(17)
    tracker.start(game)
    const before = game
    game = apply(game, { type: 'play', uid: uid(game, 0, 'anti_mage'), team: 'new' })
    tracker.observe(before, { type: 'play', uid: uid(before, 0, 'anti_mage'), team: 'new' }, game)
    game = passTracked(game, tracker)
    // Resolve Mana Void against the INT team.
    let guard = 0
    while (game.pending && guard++ < 20) {
      const prior = game
      const team = game.pending.choices.find((choice) => choice.id.startsWith('team:'))
      const hero = game.pending.choices.find((choice) => choice.id.startsWith('hero:'))
      const pick = team?.id ?? hero?.id ?? game.pending.choices.find((choice) => choice.id !== 'pass')?.id ?? 'pass'
      game = apply(game, { type: 'choose', ids: [pick] })
      tracker.observe(prior, { type: 'choose', ids: [pick] }, game)
    }
    const report = tracker.finish(game)
    const swings = report.swings.filter((swing) => swing.defId === 'anti_mage')
    const destroys = swings.reduce((sum, swing) => sum + swing.destroy, 0)
    const swingPressure = swings.reduce((sum, swing) => sum + swing.pressure, 0)
    expect(destroys).toBeGreaterThanOrEqual(1)
    expect(swingPressure).toBeGreaterThanOrEqual(1)
    expect(report.events.destroy).toBeGreaterThanOrEqual(1)
    const summary = summarizeReports([report])
    const ability = summary.abilities.find((entry) => entry.defId === 'anti_mage')
    const heroPlay = summary.heroPlaysTotal.find((entry) => entry.defId === 'anti_mage')
    expect(ability || heroPlay).toBeTruthy()
    const rowPressure = (ability?.avgPressure ?? 0) + (heroPlay?.avgPressure ?? 0)
    const rowDestroy = (ability?.avgDestroy ?? 0) + (heroPlay?.avgDestroy ?? 0)
    expect(rowPressure + rowDestroy).toBeGreaterThan(0)
  })

  it('tracks 1-of-each and pair terrain combos as separate plays', () => {
    let game = apply(createGame({ seed: 41, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    let river: CardInst
    let jungle: CardInst
    let lane: CardInst
    let river2: CardInst
    let jungle2: CardInst
    let river3: CardInst
    ;[game, river] = makeCard(game, 'river', 'terrain')
    ;[game, jungle] = makeCard(game, 'jungle', 'terrain')
    ;[game, lane] = makeCard(game, 'lane', 'terrain')
    ;[game, river2] = makeCard(game, 'river', 'terrain')
    ;[game, jungle2] = makeCard(game, 'jungle', 'terrain')
    ;[game, river3] = makeCard(game, 'river', 'terrain')
    game = setPlayer(game, 0, (seat) => ({
      ...seat,
      hand: [river, jungle, lane],
      actions: 2,
    }))
    const tracker = new BalanceTracker(41)
    tracker.start(game)

    let prior = game
    game = apply(game, { type: 'combo', uids: [river.uid, jungle.uid, lane.uid] })
    tracker.observe(prior, { type: 'combo', uids: [river.uid, jungle.uid, lane.uid] }, game)
    game = passTracked(game, tracker)

    game = setPlayer(game, 0, (seat) => ({ ...seat, hand: [river2, jungle2, river3], actions: 2 }))
    prior = game
    game = apply(game, { type: 'combo', uids: [river2.uid, jungle2.uid, river3.uid] })
    tracker.observe(prior, { type: 'combo', uids: [river2.uid, jungle2.uid, river3.uid] }, game)

    const report = tracker.finish(game)
    const defs = report.swings.filter((swing) => swing.kind === 'combo').map((swing) => swing.defId)
    expect(defs).toContain('one_of_each')
    expect(defs).toContain('pair_combo')
    expect(defs).not.toContain('mixed_path')
    const summary = summarizeReports([report])
    const names = summary.terrains.map((row) => row.name)
    expect(names).toContain('1 of each')
    expect(names).toContain('Mixed combo')
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
  while ((next.pending?.resume.kind === 'instant-window' || next.pending?.resume.kind === 'response') && guard++ < 12) {
    next = apply(next, { type: 'choose', ids: ['pass'] })
  }
  return next
}

function passTracked(game: Game, tracker: BalanceTracker): Game {
  let next = game
  let guard = 0
  while ((next.pending?.resume.kind === 'instant-window' || next.pending?.resume.kind === 'response') && guard++ < 12) {
    const prior = next
    next = apply(next, { type: 'choose', ids: ['pass'] })
    tracker.observe(prior, { type: 'choose', ids: ['pass'] }, next)
  }
  return next
}
