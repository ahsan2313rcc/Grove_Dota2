import { afterEach, describe, expect, it } from 'vitest'
import { chooseAiAction } from './ai.ts'
import { apply, createGame, morphCasts, teamsFor } from './engine.ts'
import { attrsOf, blankTeam, scoreTeam, toExile, toGrave } from './flow.ts'
import { DEFAULT_SCORE_RULES, resetScoreRules, scoreBodies, setScoreRules, teamShape } from './scoring.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

afterEach(() => {
  resetScoreRules()
})

describe('scoring', () => {
  it('matches the CORE / MIXED / ATK truth table (melee unless noted)', () => {
    const row = (
      bodies: Parameters<typeof scoreBodies>[0],
      points: number,
      shape: 'core' | 'mix' | 'open',
    ) => {
      const scored = scoreBodies(bodies)
      expect(scored.points).toBe(points)
      expect(teamShape(scored.why)).toBe(shape)
      return scored
    }

    // 1–2 heroes: flat only, no shape.
    row([{ attrs: ['STR'], range: 'Melee', count: 1 }], 1, 'open')
    row([{ attrs: ['STR'], range: 'Melee', count: 2 }], 2, 'open')
    row([
      { attrs: ['STR'], range: 'Melee', count: 1 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
    ], 2, 'open')

    // 3 heroes.
    row([
      { attrs: ['STR'], range: 'Melee', count: 2 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
    ], 4, 'open') // 3+0+0+1 atk
    row([
      { attrs: ['STR'], range: 'Melee', count: 1 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
      { attrs: ['INT'], range: 'Melee', count: 1 },
    ], 6, 'mix') // 3+0+2+1
    row([{ attrs: ['STR'], range: 'Melee', count: 3 }], 6, 'core') // 3+3+0+0

    // 4 heroes.
    row([{ attrs: ['STR'], range: 'Melee', count: 4 }], 10, 'core') // 4+6
    row([
      { attrs: ['STR'], range: 'Melee', count: 3 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
    ], 7, 'core') // 4+3 — CORE blocks atk
    row([
      { attrs: ['STR'], range: 'Melee', count: 2 },
      { attrs: ['AGI'], range: 'Melee', count: 2 },
    ], 6, 'open') // 4+0+0+2
    row([
      { attrs: ['STR'], range: 'Melee', count: 2 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
      { attrs: ['INT'], range: 'Melee', count: 1 },
    ], 8, 'mix') // 4+0+2+2
    row([
      { attrs: ['STR'], range: 'Melee', count: 1 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
      { attrs: ['INT'], range: 'Melee', count: 1 },
      { attrs: ['UNI'], range: 'Melee', count: 1 },
    ], 10, 'mix') // 4+0+4+2

    // 5 heroes.
    row([
      { attrs: ['STR'], range: 'Melee', count: 2 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
      { attrs: ['INT'], range: 'Melee', count: 1 },
      { attrs: ['UNI'], range: 'Melee', count: 1 },
    ], 12, 'mix') // 5+0+4+3
    const coreMix = row([
      { attrs: ['STR'], range: 'Melee', count: 3 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
      { attrs: ['INT'], range: 'Melee', count: 1 },
    ], 10, 'core') // 5+3+2+0 — CORE+MIXED stack; no atk
    expect(coreMix.why).toMatch(/STR x3/)
    expect(coreMix.why).toMatch(/ATTR x3/)
    expect(coreMix.why).toMatch(/MELEE x5/)
    row([
      { attrs: ['STR'], range: 'Melee', count: 4 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
    ], 11, 'core') // 5+6
    row([{ attrs: ['STR'], range: 'Melee', count: 5 }], 15, 'core') // 5+10
    row([
      { attrs: ['STR'], range: 'Melee', count: 2 },
      { attrs: ['AGI'], range: 'Melee', count: 2 },
      { attrs: ['INT'], range: 'Melee', count: 1 },
    ], 10, 'mix') // 5+0+2+3
    row([
      { attrs: ['STR'], range: 'Melee', count: 3 },
      { attrs: ['AGI'], range: 'Melee', count: 2 },
    ], 8, 'core') // 5+3

    // Display: MELEE/RANGE xN is body count, never ATK points (4 ranged → RANGE x4).
    const fourRanged = scoreBodies([
      { attrs: ['STR'], range: 'Ranged', count: 1 },
      { attrs: ['AGI'], range: 'Ranged', count: 1 },
      { attrs: ['INT'], range: 'Ranged', count: 1 },
      { attrs: ['UNI'], range: 'Ranged', count: 1 },
    ])
    expect(fourRanged.points).toBe(10)
    expect(fourRanged.why).toContain('RANGE x4')
    expect(fourRanged.why).not.toContain('ATK +')
    expect(fourRanged.attack).toEqual({ tag: 'R', count: 4, points: 2 })

    expect(scoreBodies([{ attrs: [], range: 'Melee', count: 4 }]).points).toBe(6)
    expect(scoreBodies([{ attrs: [], range: 'Melee', count: 5 }]).points).toBe(8)
    expect(scoreBodies([{ attrs: ['STR', 'AGI', 'INT'], range: 'Melee', count: 1 }]).points).toBe(1)
    expect(scoreBodies([{ attrs: ['STR'], range: 'Melee', count: 2 }]).why).toMatch(/^Small/)

    // Neutrals have a real range (e.g. Stone Golem Melee) and fill CORE / ATK.
    const withNeutral = scoreBodies([
      { attrs: ['STR'], range: 'Melee', count: 2, scoresFlat: true },
      { attrs: ['STR'], range: 'Melee', count: 1, scoresFlat: false },
    ])
    expect(withNeutral.points).toBe(5) // 2 flat + core×3
    expect(withNeutral.why).toMatch(/STR x3/)
    expect(withNeutral.why).toContain('MELEE x3')

    // 3 melee heroes + 1 melee neutral → ATK count 4.
    const mixNeutral = scoreBodies([
      { attrs: ['STR'], range: 'Melee', count: 1, scoresFlat: true },
      { attrs: ['AGI'], range: 'Melee', count: 1, scoresFlat: true },
      { attrs: ['INT'], range: 'Melee', count: 1, scoresFlat: true },
      { attrs: ['STR'], range: 'Melee', count: 1, scoresFlat: false },
    ])
    expect(mixNeutral.why).toContain('ATTR x3')
    expect(mixNeutral.why).toContain('MELEE x4')
    expect(mixNeutral.points).toBe(7) // 3 flat + mix +2 + atk +2 (count 4)
    expect(mixNeutral.attack).toEqual({ tag: 'M', count: 4, points: 2 })

    // Ranged neutral (Thunderhide) pads Ranged ATK, not Melee.
    const rangedNeutral = scoreBodies([
      { attrs: ['AGI'], range: 'Ranged', count: 2, scoresFlat: true },
      { attrs: ['AGI'], range: 'Ranged', count: 1, scoresFlat: false },
    ])
    expect(rangedNeutral.why).toContain('RANGE x3')
    expect(rangedNeutral.attack.tag).toBe('R')

    // CORE blocks ATK points but still shows the range count in the label.
    const coreMelee = scoreBodies([{ attrs: ['STR'], range: 'Melee', count: 3 }])
    expect(coreMelee.why).toContain('MELEE x3')
    expect(coreMelee.why).not.toContain('ATK +')
    expect(coreMelee.attack.points).toBe(0)

    // Mixed range: 3 Ranged still scores RANGE x3 even with Melee on the team.
    const mixedRange = scoreBodies([
      { attrs: ['STR'], range: 'Ranged', count: 1 },
      { attrs: ['AGI'], range: 'Ranged', count: 1 },
      { attrs: ['INT'], range: 'Ranged', count: 1 },
      { attrs: ['UNI'], range: 'Melee', count: 2 },
    ])
    expect(mixedRange.why).toContain('RANGE x3')
    expect(mixedRange.attack).toEqual({ tag: 'R', count: 3, points: 1 })
    expect(mixedRange.points).toBe(10) // 5 flat + mix +4 + atk +1

    // Symmetric: 3 Melee + 2 Ranged → MELEE x3.
    const mixedMelee = scoreBodies([
      { attrs: ['STR'], range: 'Melee', count: 1 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
      { attrs: ['INT'], range: 'Melee', count: 1 },
      { attrs: ['UNI'], range: 'Ranged', count: 1 },
      { attrs: ['STR'], range: 'Ranged', count: 1 },
    ])
    expect(mixedMelee.attack).toEqual({ tag: 'M', count: 3, points: 1 })
    expect(mixedMelee.why).toContain('MELEE x3')
  })

  it('Brewmaster picks the single attr that maximizes the team', () => {
    let game = ready()
    game = only(game, 0, ['brewmaster', 'sven', 'axe'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'sven'), team: 'new' })
    const team = game.players[0].teams[0]!.id
    game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team, extras: [uid(game, 0, 'brewmaster')] })
    const scored = scoreTeam(game, game.players[0].teams[0]!)
    // 3 STR bodies: 3 flat + core×3 (+3) = 6; brew must count as STR, not open a mix.
    expect(scored.points).toBe(6)
    expect(scored.why).toMatch(/^STR x3/)
    expect(attrsOf(game, game.players[0].teams[0]!.heroes.find((hero) => hero.defId === 'brewmaster')!)).toEqual(['STR'])
  })

  it('applies debug score rules including attack on core and mix toggles', () => {
    setScoreRules({
      ...DEFAULT_SCORE_RULES,
      heroPoints: 1,
      coreBonus: [0, 0, 0, 0, 0],
      mixBonus: [0, 0, 2, 4],
      attackBonus: [0, 0, 1, 2, 3],
      attackOnCore: true,
      attackOnMix: false,
      coreCombo: 7,
      mixCombo: 4,
    })
    expect(scoreBodies([{ attrs: ['STR'], range: 'Melee', count: 3 }]).points).toBe(4)
    expect(scoreBodies([{ attrs: ['STR'], range: 'Melee', count: 3 }]).why).toContain('MELEE x3')
    expect(scoreBodies([
      { attrs: ['STR'], range: 'Melee', count: 1 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
      { attrs: ['INT'], range: 'Melee', count: 1 },
    ]).points).toBe(5)
    let game = ready()
    game = give(game, 'river', 0)
    game = give(game, 'river', 0)
    game = give(game, 'river', 0)
    const rivers = game.players[0].hand.filter((card) => card.defId === 'river').slice(0, 3).map((card) => card.uid)
    game = apply(game, { type: 'combo', uids: rivers })
    expect(game.players[0].combos[0]?.points).toBe(7)
  })
})

describe('turn', () => {
  it('deals 3 each and draws 2 for seat 0 on turn 1', () => {
    const raw = createGame({ seed: 2, mode: 'hotseat', names: ['Radiant', 'Dire'] })
    expect(raw.turn).toBe(1)
    expect(raw.active).toBe(0)
    expect(raw.players[0].actions).toBe(2)
    expect(raw.players[0].hand.length).toBe(5)
    expect(raw.players[1].hand.length).toBe(3)
    expect(raw.players[1].actions).toBe(0)
    expect(raw.ancientEnabled).toBe(true)
    expect(raw.deck.some((card) => card.defId === 'ancient') || raw.ancient !== null).toBe(true)
  })

  it('can omit The Ancient when endgame is disabled', () => {
    const raw = createGame({ seed: 2, mode: 'hotseat', names: ['Radiant', 'Dire'], ancientEndgame: false })
    expect(raw.ancientEnabled).toBe(false)
    expect(raw.deck.some((card) => card.defId === 'ancient')).toBe(false)
    expect(raw.ancient).toBeNull()
  })

  it('places The Ancient by seat count (mid / deep / last)', () => {
    const depth = (seats: number, seed: number) => {
      const names = Array.from({ length: seats }, (_, index) => `P${index + 1}`)
      const game = createGame({
        seed,
        mode: 'hotseat',
        seats: names.map((name) => ({ name, ai: false })),
      })
      // Turn-1 draw already took 2 from the top after placement.
      const idx = game.deck.findIndex((card) => card.defId === 'ancient')
      expect(idx).toBeGreaterThanOrEqual(0)
      const postInsertLen = game.deck.length + 2
      const insertIndex = idx + 2
      const preInsertLen = postInsertLen - 1
      return { insertIndex, preInsertLen, postInsertLen }
    }

    for (const seed of [2, 7, 19, 58, 91]) {
      const d2 = depth(2, seed)
      expect(d2.insertIndex).toBeGreaterThanOrEqual(Math.floor(0.4 * d2.preInsertLen))
      expect(d2.insertIndex).toBeLessThanOrEqual(Math.floor(0.6 * d2.preInsertLen))

      const d5 = depth(5, seed)
      expect(d5.insertIndex).toBeGreaterThanOrEqual(Math.floor(0.7 * d5.preInsertLen))
      expect(d5.insertIndex).toBeLessThanOrEqual(Math.floor(0.8 * d5.preInsertLen))

      const d8 = depth(8, seed)
      expect(d8.insertIndex).toBe(d8.preInsertLen)
      expect(d8.insertIndex).toBe(d8.postInsertLen - 1)
    }
  })

  it('draws 2 at the start of a new turn', () => {
    let game = ready()
    const foeBefore = game.players[1].hand.length
    game = apply(game, { type: 'end' })
    expect(game.active).toBe(1)
    expect(game.players[1].hand.length).toBe(foeBefore + 2)
    expect(game.players[1].actions).toBe(2)
  })

  it('discards down to 7 only when ending the turn', () => {
    let game = ready()
    // Pad the hand well above the limit, then draw at turn start without a discard prompt.
    while (game.players[1].hand.length < 8) game = give(game, 'river', 1)
    const before = game.players[1].hand.length
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    expect(game.active).toBe(1)
    expect(game.players[1].hand.length).toBe(before + 2)
    expect(game.pending).toBeNull()
    expect(game.players[1].actions).toBe(2)
    // Action-draw still works above the hand limit.
    const over = game.players[1].hand.length
    game = apply(game, { type: 'draw' })
    expect(game.players[1].hand.length).toBe(over + 1)
    expect(game.players[1].actions).toBe(1)
    // Ending while over the limit opens the discard prompt.
    game = apply(game, { type: 'end' })
    expect(game.pending?.resume.kind).toBe('limit')
    expect(game.pending?.prompt).toContain('Discard down to 7')
    expect(game.active).toBe(1)
  })

  it('revealing The Ancient by draw awards +10 and ends after one turn each', () => {
    let game = ready()
    const ancient = game.deck.find((card) => card.defId === 'ancient')
    expect(ancient).toBeTruthy()
    game = { ...game, deck: [ancient!, ...game.deck.filter((card) => card.uid !== ancient!.uid)] }
    const before = game.players[0].hand.length
    game = apply(game, { type: 'draw' })
    expect(game.ancient).toEqual({ bonusSeat: 0, endsLeft: 2 })
    expect(game.players[0].hand.length).toBe(before)
    expect(game.players[0].hand.some((card) => card.defId === 'ancient')).toBe(false)
    expect(game.over).toBeNull()
    game = apply(game, { type: 'end' })
    expect(game.ancient?.endsLeft).toBe(1)
    expect(game.over).toBeNull()
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'end' })
    expect(game.over).not.toBeNull()
    expect(game.over!.reason).toMatch(/Ancient/)
    expect(game.over!.scores[0]).toBeGreaterThanOrEqual(10)
  })

  it('grave/exile Ancient reveal grants no +10', () => {
    let game = ready()
    const ancient = game.deck.find((card) => card.defId === 'ancient')!
    game = { ...game, deck: game.deck.filter((card) => card.uid !== ancient.uid) }
    game = toGrave(game, ancient, { type: 'deck' })
    expect(game.ancient).toEqual({ bonusSeat: null, endsLeft: 2 })
    expect(game.grave.some((card) => card.defId === 'ancient')).toBe(false)
    game = ready()
    const again = game.deck.find((card) => card.defId === 'ancient')!
    game = { ...game, deck: game.deck.filter((card) => card.uid !== again.uid), ancient: null }
    game = toExile(game, again)
    expect(game.ancient).toEqual({ bonusSeat: null, endsLeft: 2 })
  })

  it('spends an action to draw and nothing to set a combo', () => {
    let game = ready()
    const before = game.players[0].hand.length
    game = apply(game, { type: 'draw' })
    expect(game.players[0].actions).toBe(1)
    expect(game.players[0].hand.length).toBe(before + 1)
    game = give(game, 'river', 0)
    game = give(game, 'river', 0)
    game = give(game, 'river', 0)
    const rivers = game.players[0].hand.filter((card) => card.defId === 'river').slice(0, 3).map((card) => card.uid)
    const actions = game.players[0].actions
    game = apply(game, { type: 'combo', uids: rivers })
    expect(game.players[0].actions).toBe(actions)
    expect(game.players[0].combos[0]?.points).toBe(8)
    expect(game.players[0].hand.some((card) => ['haste', 'double_damage', 'regen', 'arcane', 'shield', 'illusion'].includes(card.defId))).toBe(true)
  })

  it('scores a mixed path at 5', () => {
    let game = ready()
    for (const kind of ['river', 'jungle', 'lane']) game = give(game, kind, 0)
    const uids = ['river', 'jungle', 'lane'].map((kind) => game.players[0].hand.find((card) => card.defId === kind)?.uid ?? '')
    game = apply(game, { type: 'combo', uids })
    expect(game.players[0].combos[0]?.points).toBe(5)
    expect(game.players[0].actions).toBe(2)
  })

  it('rejects playing a single terrain', () => {
    let game = ready()
    game = give(game, 'river', 0)
    const uid = game.players[0].hand.find((card) => card.defId === 'river')?.uid ?? ''
    const hand = game.players[0].hand.length
    const actions = game.players[0].actions
    game = apply(game, { type: 'play', uid, team: 'new' })
    expect(game.players[0].hand.length).toBe(hand)
    expect(game.players[0].actions).toBe(actions)
    expect(game.players[0].combos.length).toBe(0)
    expect(game.log.some((line) => line.includes('three at a time'))).toBe(true)
  })

  it('multi-drops companions silently for one action', () => {
    let game = ready()
    game = only(game, 0, ['axe', 'phantom_assassin', 'mars'])
    const axe = uid(game, 0, 'axe')
    const phantom_assassin = uid(game, 0, 'phantom_assassin')
    const mars = uid(game, 0, 'mars')
    game = apply(game, { type: 'play', uid: axe, team: 'new', extras: [phantom_assassin, mars] })
    expect(game.players[0].actions).toBe(1)
    expect(game.players[0].teams[0]?.heroes.map((hero) => hero.defId).sort()).toEqual(['axe', 'mars', 'phantom_assassin'])
    expect(game.log.some((line) => line.includes('fields Phantom Assassin'))).toBe(true)
    expect(game.log.some((line) => line.includes('fields Mars'))).toBe(true)
    // Axe's Berserker's Call should have resolved (or asked); companions did not cast.
    expect(game.log.some((line) => /plays Axe/.test(line))).toBe(true)
  })

  it('lets Instant cards play during an opponent turn', () => {
    let game = ready()
    game = only(game, 0, ['primal_beast'])
    game = only(game, 1, ['faceless_void'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'primal_beast'), team: 'new' })
    // No-target cast arms, then Instant window opens because Dire holds Faceless Void.
    expect(game.pending?.resume.kind).toBe('instant-window')
    game = passInstants(game)
    expect(game.active).toBe(0)
    expect(game.players[0].actions).toBe(1)
    const voidUid = uid(game, 1, 'faceless_void')
    game = apply(game, { type: 'play', uid: voidUid, team: 'new' })
    expect(game.log.some((line) => /Instant Faceless Void|plays Faceless Void/.test(line))).toBe(true)
    expect(game.players[1].teams.some((team) => team.heroes.some((hero) => hero.defId === 'faceless_void'))).toBe(true)
    game = passInstants(game)
    if (game.pending?.prompt.toLowerCase().includes('opponent')) {
      game = apply(game, { type: 'choose', ids: ['player:0'] })
    }
    expect(game.players[0].actions).toBe(0)
  })

  it('opens an Instant interrupt window after targets, before resolve', () => {
    let game = ready()
    game = only(game, 0, ['primal_beast'])
    game = only(game, 1, ['orchid'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'primal_beast'), team: 'new' })
    expect(game.pending?.resume.kind).toBe('instant-window')
    expect(game.pending?.actor).toBe(1)
    expect(game.pending?.choices.some((choice) => choice.id.startsWith('instant:'))).toBe(true)
    game = apply(game, { type: 'choose', ids: ['pass'] })
    expect(game.players[0].teams[0]?.heroes.some((hero) => hero.defId === 'primal_beast')).toBe(true)
  })

  it('logs Battle Trance when Troll blocks an Instant interrupt', () => {
    let game = ready()
    game = only(game, 0, ['troll_warlord', 'primal_beast'])
    game = only(game, 1, ['orchid'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'troll_warlord'), team: 'new' })
    game = passInstants(game)
    const team = game.players[0].teams[0]?.id ?? 'new'
    game = apply(game, { type: 'play', uid: uid(game, 0, 'primal_beast'), team })
    expect(game.log.some((line) => /Battle Trance stops/.test(line))).toBe(true)
    expect(game.pending?.resume.kind === 'instant-window').toBe(false)
  })
})

describe('heroes', () => {
  it('draws for Lycan when an ally enters his team', () => {
    let game = ready()
    game = only(game, 0, ['lycan', 'phantom_assassin'])
    const lycan = uid(game, 0, 'lycan')
    const ally = uid(game, 0, 'phantom_assassin')
    game = apply(game, { type: 'play', uid: lycan, team: 'new' })
    const team = game.players[0].teams[0]?.id ?? ''
    const hand = game.players[0].hand.length
    game = apply(game, { type: 'play', uid: ally, team })
    // Spent the ally from hand, Lycan draws 1 — net hand size unchanged.
    expect(game.players[0].hand.length).toBe(hand)
    expect(game.log.some((line) => /draws 1/.test(line))).toBe(true)
  })

  it('lets traps plant on enemy teams', () => {
    let game = ready()
    game = only(game, 0, ['techies'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    const foeTeam = game.players[1].teams[0]?.id ?? ''
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const options = teamsFor(game, uid(game, 0, 'techies'))
    expect(options.some((option) => option.id === foeTeam && option.ok)).toBe(true)
    expect(options.some((option) => /Dire|Player|foe|team/i.test(option.label) || option.id === foeTeam)).toBe(true)
    game = apply(game, { type: 'play', uid: uid(game, 0, 'techies'), team: foeTeam })
    expect(game.players[1].teams[0]?.trap?.defId).toBe('techies')
    expect(game.players[1].teams[0]?.trap?.owner).toBe(0)
    expect(game.players[0].teams.some((team) => team.trap?.defId === 'techies')).toBe(false)
  })

  it('plants Techies as a trap and Zeus clears traps', () => {
    let game = ready()
    game = only(game, 0, ['zeus'])
    game = only(game, 1, ['techies', 'sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    const team = game.players[1].teams[0]?.id ?? ''
    game = apply(game, { type: 'play', uid: uid(game, 1, 'techies'), team })
    expect(game.players[1].teams[0]?.trap?.defId).toBe('techies')
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'zeus'), team: 'new' })
    game = passInstants(game)
    expect(game.players[1].teams[0]?.trap).toBeNull()
    expect(game.log.some((line) => line.includes('trap'))).toBe(true)
  })

  it('Batrider moves traps across players, never within the same player', () => {
    let game = ready()
    game = only(game, 0, ['batrider', 'techies', 'sven', 'axe'])
    game = only(game, 1, ['phantom_assassin'])
    // Two teams for seat 0 + one for seat 1.
    game = apply(game, { type: 'play', uid: uid(game, 0, 'sven'), team: 'new' })
    game = passInstants(game)
    const homeA = game.players[0].teams[0]!.id
    game = {
      ...game,
      players: [{ ...game.players[0], actions: 3 }, game.players[1]] as Game['players'],
    }
    game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team: 'new' })
    game = passInstants(game)
    const homeB = game.players[0].teams.find((team) => team.id !== homeA)!.id
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'phantom_assassin'), team: 'new' })
    game = passInstants(game)
    const foe = game.players[1].teams[0]!.id
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'techies'), team: homeA })
    expect(game.players[0].teams.find((team) => team.id === homeA)?.trap?.defId).toBe('techies')
    game = apply(game, { type: 'play', uid: uid(game, 0, 'batrider'), team: 'new' })
    game = passInstants(game)
    expect(game.pending?.prompt.toLowerCase()).toMatch(/trap/)
    game = apply(game, { type: 'choose', ids: [`team:${homeA}`] })
    const destIds = (game.pending?.choices ?? [])
      .filter((choice) => choice.id.startsWith('team:'))
      .map((choice) => choice.id.slice(5))
    expect(destIds).toContain(foe)
    expect(destIds).not.toContain(homeB)
    expect(destIds).not.toContain(homeA)
    game = apply(game, { type: 'choose', ids: [`team:${foe}`] })
    game = passInstants(game)
    expect(game.players[0].teams.some((team) => team.trap?.defId === 'techies')).toBe(false)
    expect(game.players[1].teams.some((team) => team.trap?.defId === 'techies')).toBe(true)
    expect(game.players[1].teams.find((team) => team.trap?.defId === 'techies')?.trap?.owner).toBe(0)
  })

  it('revealed non-sacrifice traps join the team; sacrifice traps go to the grave', () => {
    let game = ready()
    game = only(game, 0, ['monkey_king', 'phantom_assassin', 'sven'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'phantom_assassin'), team: 'new' })
    game = passInstants(game)
    const team = game.players[0].teams[0]?.id ?? ''
    game = apply(game, { type: 'play', uid: uid(game, 0, 'monkey_king'), team })
    expect(game.players[0].teams[0]?.trap?.defId).toBe('monkey_king')
    game = {
      ...game,
      players: [{ ...game.players[0], actions: 1 }, game.players[1]] as Game['players'],
    }
    game = apply(game, { type: 'play', uid: uid(game, 0, 'sven'), team })
    game = passInstants(game)
    expect(game.players[0].teams[0]?.trap).toBeNull()
    expect(game.players[0].teams[0]?.heroes.map((hero) => hero.defId).sort()).toEqual([
      'monkey_king',
      'phantom_assassin',
      'sven',
    ])
    expect(game.grave.some((card) => card.defId === 'monkey_king')).toBe(false)
    expect(game.log.some((line) => /Monkey King joins the team/.test(line))).toBe(true)

    // Techies still sacrifices.
    game = ready()
    game = only(game, 0, ['techies', 'sven', 'axe'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'sven'), team: 'new' })
    game = passInstants(game)
    const mineTeam = game.players[0].teams[0]?.id ?? ''
    game = apply(game, { type: 'play', uid: uid(game, 0, 'techies'), team: mineTeam })
    game = {
      ...game,
      players: [{ ...game.players[0], actions: 1 }, game.players[1]] as Game['players'],
    }
    game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team: mineTeam })
    game = passInstants(game)
    expect(game.grave.some((card) => card.defId === 'techies')).toBe(true)
    expect(game.players[0].teams.some((entry) => entry.heroes.some((hero) => hero.defId === 'techies'))).toBe(false)

    // Ogre Magi has no destroy/sacrifice clause — joins after Multicast.
    game = ready()
    game = only(game, 0, ['ogre_magi', 'sven', 'axe'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'sven'), team: 'new' })
    game = passInstants(game)
    const ogreTeam = game.players[0].teams[0]?.id ?? ''
    game = apply(game, { type: 'play', uid: uid(game, 0, 'ogre_magi'), team: ogreTeam })
    expect(game.players[0].teams[0]?.trap?.defId).toBe('ogre_magi')
    game = {
      ...game,
      players: [{ ...game.players[0], actions: 1 }, game.players[1]] as Game['players'],
    }
    game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team: ogreTeam })
    game = passInstants(game)
    expect(game.players[0].teams[0]?.trap).toBeNull()
    expect(game.players[0].teams[0]?.heroes.some((hero) => hero.defId === 'ogre_magi')).toBe(true)
    expect(game.grave.some((card) => card.defId === 'ogre_magi')).toBe(false)
  })

  it('lets Night Stalker steal two cards', () => {
    let game = ready()
    game = only(game, 0, ['night_stalker'])
    const before = game.players[1].hand.length
    game = apply(game, { type: 'play', uid: uid(game, 0, 'night_stalker'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'choose', ids: ['player:1'] })
    expect(game.players[1].hand.length).toBe(before - 2)
    expect(game.players[0].hand.length).toBe(2)
  })

  it('destroys a team with Enigma', () => {
    let game = ready()
    game = only(game, 0, ['enigma'])
    game = only(game, 1, ['phantom_assassin'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'phantom_assassin'), team: 'new' })
    game = passInstants(game)
    const foeTeam = game.players[1].teams[0]?.id ?? ''
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    // Keep only Enigma so turn-draw saves (e.g. BKB) cannot stall Black Hole.
    game = only(game, 0, ['enigma'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'enigma'), team: 'new' })
    game = passInstants(game)
    const ownTeam = game.players[0].teams[0]?.id ?? ''
    game = apply(game, { type: 'choose', ids: [`team:${ownTeam}`] })
    game = apply(game, { type: 'choose', ids: [`team:${foeTeam}`] })
    expect(game.players[1].teams.length).toBe(0)
  })

  it('returns an enemy team to hand and discards (Tidehunter)', () => {
    let game = ready()
    game = only(game, 0, ['sven', 'tidehunter'])
    game = only(game, 1, ['phantom_assassin', 'earthshaker'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'sven'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'phantom_assassin'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'play', uid: uid(game, 1, 'earthshaker'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'tidehunter'), team: 'new' })
    game = passInstants(game)
    expect(game.players[0].teams.flatMap((team) => team.heroes.map((hero) => hero.defId)).sort()).toEqual(['sven', 'tidehunter'])
    expect(game.players[1].teams.length).toBe(1)
    expect(game.players[1].teams[0]?.heroes.map((hero) => hero.defId)).toEqual(['earthshaker'])
  })

  it('destroys every Intelligence hero on a team with Mana Void', () => {
    let game = ready()
    game = only(game, 0, ['anti_mage'])
    game = only(game, 1, ['death_prophet', 'ancient_apparition', 'phantom_assassin'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'death_prophet'), team: 'new' })
    game = passInstants(game)
    const team = game.players[1].teams[0]!.id
    game = apply(game, { type: 'play', uid: uid(game, 1, 'ancient_apparition'), team })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'phantom_assassin'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'anti_mage'), team: 'new' })
    game = passInstants(game)
    expect(game.pending?.prompt.toLowerCase()).toMatch(/enemy team/)
    game = apply(game, { type: 'choose', ids: [`team:${team}`] })
    game = passInstants(game)
    while (game.pending?.prompt.includes('would be destroyed')) {
      game = apply(game, { type: 'choose', ids: ['pass'] })
    }
    expect(game.players[1].teams.flatMap((entry) => entry.heroes.map((hero) => hero.defId)).sort()).toEqual([
      'phantom_assassin',
    ])
    expect(game.exile.some((card) => card.defId === 'death_prophet') || game.grave.some((card) => card.defId === 'death_prophet')).toBe(
      true,
    )
  })

  it('gathers a team with Reverse Polarity and leaves the rest', () => {
    let game = ready()
    game = only(game, 0, ['magnus'])
    game = only(game, 1, ['earthshaker', 'sven', 'phantom_assassin'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'earthshaker'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'phantom_assassin'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const shaker = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'earthshaker')?.uid ?? ''
    const sven = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'sven')?.uid ?? ''
    game = apply(game, { type: 'play', uid: uid(game, 0, 'magnus'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'choose', ids: [`hero:${shaker}`, `hero:${sven}`] })
    game = passInstants(game)
    const sizes = game.players[1].teams.map((team) => team.heroes.map((hero) => hero.defId).sort())
    expect(sizes).toContainEqual(['phantom_assassin'])
    expect(sizes).toContainEqual(['earthshaker', 'sven'])
    expect(game.grave.some((card) => card.defId === 'earthshaker' || card.defId === 'sven' || card.defId === 'phantom_assassin')).toBe(false)
  })

  it('destroys one hero of the chosen attribute per opponent', () => {
    let game = ready()
    game = only(game, 0, ['gyrocopter'])
    game = only(game, 1, ['sven', 'elder_titan', 'phantom_assassin'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    const withSven = game.players[1].teams[0]?.id ?? ''
    game = apply(game, { type: 'play', uid: uid(game, 1, 'phantom_assassin'), team: withSven })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'elder_titan'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const sven = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'sven')?.uid ?? ''
    game = apply(game, { type: 'play', uid: uid(game, 0, 'gyrocopter'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'choose', ids: ['attr:STR'] })
    game = apply(game, { type: 'choose', ids: [`hero:${sven}`] })
    game = passInstants(game)
    while (game.pending?.prompt.includes('would be destroyed')) {
      game = apply(game, { type: 'choose', ids: ['pass'] })
    }
    const left = game.players[1].teams.flatMap((team) => team.heroes.map((hero) => hero.defId)).sort()
    expect(left).toEqual(['elder_titan', 'phantom_assassin'])
    expect(game.grave.some((card) => card.defId === 'sven')).toBe(true)
  })

  it('exiles under Razor without copying the attribute or the ability', () => {
    let game = ready()
    game = only(game, 0, ['razor'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const sven = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'sven')
    game = apply(game, { type: 'play', uid: uid(game, 0, 'razor'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'choose', ids: [`hero:${sven?.uid ?? ''}`] })
    const razor = game.players[0].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'razor')
    expect(razor?.held?.card.defId).toBe('sven')
    expect(razor?.held?.mode).toBe('razor')
    expect(attrsOf(game, razor!).includes('STR')).toBe(false)
    expect(morphCasts(game)).toEqual([])
    expect(game.players[1].teams.flatMap((team) => team.heroes)).toEqual([])
    expect(game.exile.some((card) => card.defId === 'sven')).toBe(false)
    expect(game.grave.some((card) => card.defId === 'sven')).toBe(false)
  })

  it('lets Morphling switch attribute to match the exiled hero', () => {
    let game = ready()
    game = only(game, 0, ['morphling'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const sven = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'sven')
    game = apply(game, { type: 'play', uid: uid(game, 0, 'morphling'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'choose', ids: [`hero:${sven?.uid ?? ''}`] })
    const morph = game.players[0].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'morphling')
    expect(morph?.held?.mode).toBe('morph')
    expect(attrsOf(game, morph!)).toEqual(['STR'])
    expect(morphCasts(game)).toEqual([])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const later = game.players[0].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'morphling')
    expect(later?.held?.card.defId).toBe('sven')
    expect(attrsOf(game, later!)).toEqual(['STR'])
  })

  it('discards Nyx to send the countered card to the grave', () => {
    let game = ready()
    // Primal Beast fires with no targets — Instant window opens after arming.
    game = only(game, 0, ['primal_beast'])
    game = only(game, 1, ['nyx_assassin'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'primal_beast'), team: 'new' })
    // Nyx is Instant — it appears in the interrupt window and counters the ability there.
    expect(game.pending?.resume.kind).toBe('instant-window')
    const nyx = game.pending?.choices.find((choice) => choice.id.startsWith('instant:'))?.id ?? ''
    game = apply(game, { type: 'choose', ids: [nyx] })
    expect(game.players[0].teams).toEqual([])
    expect(game.grave.map((card) => card.defId).sort()).toEqual(['nyx_assassin', 'primal_beast'])
    expect(game.players[0].actions).toBe(1)
  })

  it('locks an opponent with Orchid so they cannot activate abilities', () => {
    let game = ready()
    game = only(game, 0, ['orchid'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'orchid'), team: '' })
    expect(game.players[0].actions).toBe(2)
    game = apply(game, { type: 'choose', ids: ['player:1'] })
    expect(game.players[1].orchid).toBeTruthy()
    expect(game.log.at(-1)).toContain('Orchid')
  })

  it('lets Orchid nullify the interrupted hero ability from the Instant window', () => {
    let game = ready()
    game = only(game, 0, ['primal_beast'])
    game = only(game, 1, ['orchid'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'primal_beast'), team: 'new' })
    expect(game.pending?.resume.kind).toBe('instant-window')
    const orchid = game.pending?.choices.find((choice) => choice.id.startsWith('instant:'))?.id ?? ''
    game = apply(game, { type: 'choose', ids: [orchid] })
    expect(game.players[0].orchid).toBeTruthy()
    expect(game.players[0].teams[0]?.heroes[0]?.muted).toBe(true)
    expect(game.log.some((line) => /Orchid nullifies/.test(line))).toBe(true)
    expect(game.pending?.resume.kind === 'cast').toBe(false)
  })

  it('announces chosen targets before the Instant interrupt window', () => {
    let game = ready()
    game = only(game, 0, ['pudge'])
    game = only(game, 1, ['sven', 'orchid'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    // Sven alone fizzles (needs 3 STR) — no Instant window. Hero stays seated.
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const sven = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'sven')
    game = apply(game, { type: 'play', uid: uid(game, 0, 'pudge'), team: 'new' })
    expect(game.pending?.resume.kind).toBe('cast')
    game = apply(game, { type: 'choose', ids: ['player:1'] })
    expect(game.pending?.resume.kind).toBe('cast')
    game = apply(game, { type: 'choose', ids: [`hero:${sven?.uid ?? ''}`] })
    expect(game.pending?.resume.kind).toBe('instant-window')
    expect(game.pending?.prompt).toMatch(/targeting Sven/)
  })

  it('returns an Eul target at the end of the turn without firing', () => {
    let game = ready()
    game = only(game, 0, ['euls'])
    game = only(game, 1, ['chen'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const pile = game.neutrals.length
    game = apply(game, { type: 'play', uid: uid(game, 1, 'chen'), team: 'new' })
    game = passInstants(game)
    expect(game.neutrals.length).toBe(pile - 1)
    const hand = game.players[1].hand.length
    const chen = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'chen')
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'euls'), team: '' })
    game = apply(game, { type: 'choose', ids: [`hero:${chen?.uid ?? ''}`] })
    expect(game.phased.map((entry) => entry.hero.defId)).toEqual(['chen'])
    expect(game.players[1].teams).toEqual([])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    expect(game.phased).toEqual([])
    expect(game.players[1].teams.flatMap((team) => team.heroes.map((hero) => hero.defId))).toEqual(['chen'])
    expect(game.players[1].hand.length).toBe(hand + 2)
    expect(game.neutrals.length).toBe(pile - 1)
  })

  it('exiles with Scythe, tucks with Abyssal, draws off Greaves, and steals with Satanic', () => {
    let game = ready()
    game = only(game, 0, ['scythe'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    const hexed = game.players[1].teams[0]?.heroes[0]?.uid ?? ''
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'scythe'), team: '' })
    game = apply(game, { type: 'choose', ids: [`hero:${hexed}`] })
    expect(game.exile.some((card) => card.defId === 'sven')).toBe(true)
    expect(game.grave.some((card) => card.defId === 'sven')).toBe(false)
    expect(game.players[1].noHeroNext).toBe(false)

    game = ready()
    game = only(game, 0, ['abyssal'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    const sven = game.players[1].teams[0]?.heroes[0]?.uid ?? ''
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const before = game.players[0].hand.length
    game = apply(game, { type: 'play', uid: uid(game, 0, 'abyssal'), team: '' })
    game = apply(game, { type: 'choose', ids: [`hero:${sven}`] })
    game = apply(game, { type: 'choose', ids: ['deck:bottom'] })
    expect(game.deck.at(-1)?.defId).toBe('sven')
    expect(game.players[0].hand.length).toBe(before)

    game = ready()
    game = only(game, 0, ['greaves', 'techies'])
    game = only(game, 1, ['axe'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'axe'), team: 'new' })
    game = passInstants(game)
    const foeTeam = game.players[1].teams[0]!.id
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'techies'), team: foeTeam })
    expect(game.players[1].teams[0]?.trap?.defId).toBe('techies')
    game = apply(game, { type: 'play', uid: uid(game, 0, 'greaves'), team: '' })
    game = apply(game, { type: 'choose', ids: ['player:1'] })
    expect(game.players[1].teams[0]?.trap).toBeNull()
    expect(game.grave.some((card) => card.defId === 'techies')).toBe(true)

    game = ready()
    game = only(game, 0, ['satanic'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    const stolen = game.players[1].teams[0]?.heroes[0]?.uid ?? ''
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'satanic'), team: '' })
    game = apply(game, { type: 'choose', ids: [`hero:${stolen}`] })
    game = apply(game, { type: 'choose', ids: ['new:0'] })
    game = apply(game, { type: 'choose', ids: ['no'] })
    expect(game.players[0].teams.flatMap((team) => team.heroes.map((hero) => hero.defId))).toEqual(['sven'])
    expect(game.players[1].teams).toEqual([])
  })

  it('Refresher grants an extra turn', () => {
    let game = ready()
    game = only(game, 0, ['refresher'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'refresher'), team: '' })
    expect(game.extraTurn).toBe(0)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    expect(game.active).toBe(0)
  })

  it('Faceless Void drains remaining actions', () => {
    let game = ready()
    game = only(game, 0, ['faceless_void'])
    game = only(game, 1, ['sven', 'axe'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    expect(game.players[1].actions).toBe(2)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'faceless_void'), team: 'new' })
    game = passInstants(game)
    if (game.pending?.prompt.toLowerCase().includes('opponent')) {
      game = apply(game, { type: 'choose', ids: ['player:1'] })
    }
    expect(game.log.some((line) => line.includes('Chronosphere'))).toBe(true)
  })
})

describe('teams', () => {
  it('stops a 13th team', () => {
    let game = ready()
    const hero = game.players[0].hand.find((card) => card.kind === 'hero')
    expect(hero).toBeTruthy()
    const teams = Array.from({ length: 12 }, (_, i) => blankTeam(`t${i}`))
    game = { ...game, players: [{ ...game.players[0], teams }, game.players[1]] }
    const options = teamsFor(game, hero!.uid)
    expect(options.find((option) => option.id === 'new')?.ok).toBe(false)
    expect(options.find((option) => option.id === 'new')?.reason).toBe('12 teams is the limit.')
  })

  it('lets instant heroes seat on an existing team or open a new one, then target from text', () => {
    let game = ready()
    game = only(game, 0, ['dazzle', 'sven', 'earth_spirit'])
    game = only(game, 1, ['axe'])
    // Seed an allied team to join.
    game = apply(game, { type: 'play', uid: uid(game, 0, 'sven'), team: 'new' })
    game = passInstants(game)
    const existing = game.players[0].teams[0]!.id

    const dazzleOpts = teamsFor(game, uid(game, 0, 'dazzle'))
    expect(dazzleOpts.some((option) => option.id === existing && option.ok)).toBe(true)
    expect(dazzleOpts.some((option) => option.id === 'new' && option.ok)).toBe(true)

    // Dazzle onto the existing team — ability should ask for an allied hero.
    game = apply(game, { type: 'play', uid: uid(game, 0, 'dazzle'), team: existing })
    game = passInstants(game)
    expect(game.pending?.resume.kind).toBe('cast')
    expect(game.pending?.prompt.toLowerCase()).toMatch(/hero you own|allied hero/)
    const ally = game.pending!.choices.find((choice) => choice.id.startsWith('hero:'))
    expect(ally).toBeTruthy()
    game = apply(game, { type: 'choose', ids: [ally!.id] })
    expect(game.log.some((line) => /Shallow Grave|cannot be destroyed/i.test(line))).toBe(true)

    // Earth Spirit onto a new team — ability targets an enemy hero.
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'axe'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const spiritOpts = teamsFor(game, uid(game, 0, 'earth_spirit'))
    expect(spiritOpts.some((option) => option.id === 'new' && option.ok)).toBe(true)
    expect(spiritOpts.filter((option) => option.id !== 'new' && option.ok).length).toBeGreaterThan(0)
    game = apply(game, { type: 'play', uid: uid(game, 0, 'earth_spirit'), team: 'new' })
    game = passInstants(game)
    expect(game.pending?.resume.kind).toBe('cast')
    expect(game.pending?.prompt.toLowerCase()).toMatch(/enemy|choose a hero/)
    const enemy = game.pending!.choices.find((choice) => choice.id.startsWith('hero:'))
    expect(enemy).toBeTruthy()
  })
})

describe('bugfixes', () => {
  it('plays Clinkz exile items for free without burning the freeItems counter early', () => {
    let game = ready()
    game = only(game, 0, ['clinkz'])
    // Seed five distinct item cards on top so Skeleton Walk can exile them.
    const items = game.deck.filter((card) => card.kind === 'item').slice(0, 5)
    expect(items.length).toBe(5)
    const rest = game.deck.filter((card) => !items.some((item) => item.uid === card.uid))
    game = { ...game, deck: [...items, ...rest] }
    game = apply(game, { type: 'play', uid: uid(game, 0, 'clinkz'), team: 'new' })
    game = passInstants(game)
    expect(game.clinkzExile.some((card) => card.kind === 'item')).toBe(true)
    const free = game.clinkzExile.find((card) => card.kind === 'item')!
    const beforeActions = game.players[0].actions
    game = apply(game, { type: 'play', uid: free.uid, team: '' })
    if (game.pending?.resume.kind === 'cast') {
      const first = game.pending.choices[0]
      if (first) game = apply(game, { type: 'choose', ids: [first.id] })
    }
    // Free play: action count must not drop (Assault may even grant +2).
    expect(game.players[0].actions).toBeGreaterThanOrEqual(beforeActions)
    expect(game.clinkzExile.some((card) => card.uid === free.uid)).toBe(false)
  })

  it('Gem reveals opponent hands when naming a card', () => {
    let game = ready()
    game = only(game, 0, ['gem'])
    game = only(game, 1, ['sven', 'river'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'gem'), team: '' })
    game = apply(game, { type: 'choose', ids: ['name:sven'] })
    expect(game.reveal.some((entry) => entry.viewer === 0 && entry.target === 1 && entry.turn === game.turn)).toBe(true)
    expect(game.players[0].hand.some((card) => card.defId === 'sven')).toBe(true)
    expect(game.players[1].hand.some((card) => card.defId === 'sven')).toBe(false)
  })

  it('returns Satanic targets to their original team', () => {
    let game = ready()
    game = only(game, 0, ['satanic'])
    game = only(game, 1, ['phantom_assassin', 'juggernaut'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'phantom_assassin'), team: 'new' })
    game = passInstants(game)
    const home = game.players[1].teams[0]!.id
    game = apply(game, { type: 'play', uid: uid(game, 1, 'juggernaut'), team: home })
    game = passInstants(game)
    const pa = game.players[1].teams[0]!.heroes.find((hero) => hero.defId === 'phantom_assassin')!.uid
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'satanic'), team: '' })
    game = apply(game, { type: 'choose', ids: [`hero:${pa}`] })
    game = apply(game, { type: 'choose', ids: ['new:0'] })
    game = apply(game, { type: 'choose', ids: ['no'] })
    expect(game.players[0].teams.some((team) => team.heroes.some((hero) => hero.uid === pa))).toBe(true)
    expect(game.lassos.some((entry) => entry.uid === pa && entry.teamId === home)).toBe(true)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const back = findHeroTeam(game, pa)
    expect(back?.player).toBe(1)
    expect(back?.teamId).toBe(home)
  })
})

function findHeroTeam(game: Game, uid: string): { player: PlayerId; teamId: string } | null {
  for (const player of game.players) {
    for (const team of player.teams) {
      if (team.heroes.some((hero) => hero.uid === uid)) return { player: player.id, teamId: team.id }
    }
  }
  return null
}

describe('match', () => {
  it('plays a full game on its own', () => {
    let game = createGame({ seed: 4, mode: 'ai', names: ['You', 'The Grove'] })
    game = { ...game, autoAll: true, players: [{ ...game.players[0], ai: true }, game.players[1]] }
    let guard = 0
    while (!game.over && guard < 1600) {
      guard += 1
      if (game.veil) {
        game = apply(game, { type: 'ready' })
        continue
      }
      game = apply(game, chooseAiAction(game))
    }
    expect(game.over).toBeTruthy()
  })
})

function ready(): Game {
  const game = createGame({ seed: 2, mode: 'hotseat', names: ['Radiant', 'Dire'] })
  return apply(game, { type: 'ready' })
}

/** Pass every Instant interrupt window so cast abilities can finish in tests. */
function passInstants(game: Game): Game {
  let next = game
  let guard = 0
  while (next.pending?.resume.kind === 'instant-window' && guard++ < 12) {
    next = apply(next, { type: 'choose', ids: ['pass'] })
  }
  return next
}

function give(game: Game, defId: string, player: PlayerId): Game {
  const card = game.deck.find((entry) => entry.defId === defId)
  if (!card) throw new Error(`missing ${defId}`)
  return place(game, card, player)
}

function only(game: Game, player: PlayerId, defIds: string[]): Game {
  let next = game
  const found: CardInst[] = []
  for (const defId of defIds) {
    const card = next.deck.find((entry) => entry.defId === defId)
      ?? next.players.flatMap((seat) => seat.hand).find((entry) => entry.defId === defId)
    if (!card) throw new Error(`missing ${defId}`)
    found.push(card)
    next = {
      ...next,
      deck: next.deck.filter((entry) => entry.uid !== card.uid),
      players: next.players.map((seat) => ({
        ...seat,
        hand: seat.hand.filter((entry) => entry.uid !== card.uid),
      })) as Game['players']
    }
  }
  return {
    ...next,
    players: next.players.map((seat) => (seat.id === player ? { ...seat, hand: found } : seat)) as Game['players'],
  }
}

function place(game: Game, card: CardInst, player: PlayerId): Game {
  return {
    ...game,
    deck: game.deck.filter((entry) => entry.uid !== card.uid),
    players: game.players.map((seat) => (seat.id === player ? { ...seat, hand: [...seat.hand, card] } : seat)) as Game['players'],
  }
}

function uid(game: Game, player: PlayerId, defId: string): string {
  return game.players[player].hand.find((card) => card.defId === defId)?.uid ?? ''
}
