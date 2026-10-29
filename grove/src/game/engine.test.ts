import { afterEach, describe, expect, it } from 'vitest'
import { chooseAiAction } from './ai.ts'
import { apply, createGame, morphCasts, teamsFor } from './engine.ts'
import { attrsOf, blankTeam } from './flow.ts'
import { DEFAULT_SCORE_RULES, resetScoreRules, scoreBodies, setScoreRules } from './scoring.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

afterEach(() => {
  resetScoreRules()
})

describe('scoring', () => {
  it('scores mono teams, mixed teams, and empty attributes', () => {
    // Core bonus +0/0/3/6/10 → max 15. Mix attrs +0/0/2/4 + atk 0/0/1/2/3 → max 12.
    expect(scoreBodies([{ attrs: ['STR'], range: 'Melee', count: 1 }]).points).toBe(1)
    expect(scoreBodies([{ attrs: ['STR'], range: 'Melee', count: 2 }]).points).toBe(2)
    expect(scoreBodies([{ attrs: ['STR'], range: 'Melee', count: 3 }]).points).toBe(6)
    expect(scoreBodies([{ attrs: ['STR'], range: 'Melee', count: 4 }]).points).toBe(10)
    expect(scoreBodies([{ attrs: ['STR'], range: 'Melee', count: 5 }]).points).toBe(15)
    expect(scoreBodies([{ attrs: ['UNI'], range: 'Ranged', count: 5 }]).points).toBe(15)
    expect(scoreBodies([{ attrs: ['AGI'], range: 'Melee', count: 2 }]).points).toBe(2)
    const mixed = scoreBodies([
      { attrs: ['STR'], range: 'Melee', count: 1 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
      { attrs: ['INT'], range: 'Melee', count: 1 },
    ])
    expect(mixed.points).toBe(6)
    const four = scoreBodies([
      { attrs: ['STR'], range: 'Ranged', count: 1 },
      { attrs: ['AGI'], range: 'Ranged', count: 1 },
      { attrs: ['INT'], range: 'Ranged', count: 1 },
      { attrs: ['UNI'], range: 'Ranged', count: 1 },
    ])
    expect(four.points).toBe(10)
    const fullMix = scoreBodies([
      { attrs: ['STR'], range: 'Melee', count: 2 },
      { attrs: ['AGI'], range: 'Melee', count: 1 },
      { attrs: ['INT'], range: 'Melee', count: 1 },
      { attrs: ['UNI'], range: 'Melee', count: 1 },
    ])
    expect(fullMix.points).toBe(12)
    expect(scoreBodies([
      { attrs: ['STR'], range: 'Melee', count: 4 },
      { attrs: ['UNI'], range: 'Melee', count: 1 },
    ]).points).toBe(8)
    expect(scoreBodies([{ attrs: [], range: 'Melee', count: 4 }]).points).toBe(6)
    expect(scoreBodies([{ attrs: [], range: 'Melee', count: 5 }]).points).toBe(8)
    expect(scoreBodies([{ attrs: ['STR', 'AGI', 'INT'], range: 'Melee', count: 1 }]).points).toBe(3)
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
    expect(scoreBodies([{ attrs: ['STR'], range: 'Melee', count: 3 }]).why).toContain('Melee')
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
    expect(game.players[0].combos[0]?.points).toBe(5)
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

  it('rejects playing a single setting', () => {
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
})

describe('heroes', () => {
  it('draws for Lycan when an ally enters his team', () => {
    let game = ready()
    game = only(game, 0, ['lycan', 'riki'])
    const lycan = uid(game, 0, 'lycan')
    const riki = uid(game, 0, 'riki')
    game = apply(game, { type: 'play', uid: lycan, team: 'new' })
    const team = game.players[0].teams[0]?.id ?? ''
    const hand = game.players[0].hand.length
    game = apply(game, { type: 'play', uid: riki, team })
    expect(game.players[0].hand.length).toBe(hand)
    expect(game.log.some((line) => line.includes('draws'))).toBe(true)
  })

  it('keeps enemies from targeting Riki', () => {
    let game = ready()
    game = only(game, 0, ['riki'])
    game = only(game, 1, ['doom'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'riki'), team: 'new' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'doom'), team: 'new' })
    expect(game.pending?.choices.some((choice) => choice.defId === 'riki') ?? false).toBe(false)
  })

  it('lets Night Stalker steal two cards', () => {
    let game = ready()
    game = only(game, 0, ['night_stalker'])
    const before = game.players[1].hand.length
    game = apply(game, { type: 'play', uid: uid(game, 0, 'night_stalker'), team: 'new' })
    game = apply(game, { type: 'choose', ids: ['player:1'] })
    expect(game.players[1].hand.length).toBe(before - 2)
    expect(game.players[0].hand.length).toBe(2)
  })

  it('destroys a team with Enigma', () => {
    let game = ready()
    game = only(game, 0, ['enigma'])
    game = only(game, 1, ['riki'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'riki'), team: 'new' })
    const team = game.players[1].teams[0]?.id ?? ''
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'enigma'), team: 'new' })
    game = apply(game, { type: 'choose', ids: [`team:${team}`] })
    expect(game.players[1].teams.length).toBe(0)
  })

  it('keeps Tidehunter’s team and returns every other hero', () => {
    let game = ready()
    game = only(game, 0, ['sven', 'tidehunter'])
    game = only(game, 1, ['riki', 'earthshaker'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'sven'), team: 'new' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'riki'), team: 'new' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'earthshaker'), team: 'new' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'tidehunter'), team: 'new' })
    expect(game.players[0].teams.flatMap((team) => team.heroes.map((hero) => hero.defId))).toEqual(['tidehunter'])
    expect(game.players[1].teams).toEqual([])
    expect(game.players[0].hand.map((card) => card.defId)).toContain('sven')
    expect(game.players[1].hand.map((card) => card.defId).sort()).toEqual(['earthshaker', 'riki'])
  })

  it('destroys every Intelligence hero with Mana Void', () => {
    let game = ready()
    game = only(game, 0, ['anti_mage'])
    game = only(game, 1, ['crystal_maiden', 'riki'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'crystal_maiden'), team: 'new' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'riki'), team: 'new' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'anti_mage'), team: 'new' })
    if (game.pending?.prompt.includes('would be destroyed')) game = apply(game, { type: 'choose', ids: ['pass'] })
    expect(game.players[1].teams.flatMap((team) => team.heroes.map((hero) => hero.defId))).toEqual(['riki'])
    expect(game.grave.some((card) => card.defId === 'crystal_maiden')).toBe(true)
  })

  it('gathers a team with Reverse Polarity and leaves the rest', () => {
    let game = ready()
    game = only(game, 0, ['magnus'])
    game = only(game, 1, ['earthshaker', 'sven', 'riki'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'earthshaker'), team: 'new' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'riki'), team: 'new' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const shaker = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'earthshaker')?.uid ?? ''
    const sven = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'sven')?.uid ?? ''
    game = apply(game, { type: 'play', uid: uid(game, 0, 'magnus'), team: 'new' })
    game = apply(game, { type: 'choose', ids: [`hero:${shaker}`, `hero:${sven}`] })
    const sizes = game.players[1].teams.map((team) => team.heroes.map((hero) => hero.defId).sort())
    expect(sizes).toContainEqual(['riki'])
    expect(sizes).toContainEqual(['earthshaker', 'sven'])
    expect(game.grave.some((card) => card.defId === 'earthshaker' || card.defId === 'sven' || card.defId === 'riki')).toBe(false)
  })

  it('destroys one hero of the chosen attribute per opponent', () => {
    let game = ready()
    game = only(game, 0, ['gyrocopter'])
    game = only(game, 1, ['sven', 'elder_titan', 'riki'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    const withSven = game.players[1].teams[0]?.id ?? ''
    game = apply(game, { type: 'play', uid: uid(game, 1, 'riki'), team: withSven })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'elder_titan'), team: 'new' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const sven = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'sven')?.uid ?? ''
    game = apply(game, { type: 'play', uid: uid(game, 0, 'gyrocopter'), team: 'new' })
    game = apply(game, { type: 'choose', ids: ['attr:STR'] })
    game = apply(game, { type: 'choose', ids: [`hero:${sven}`] })
    const left = game.players[1].teams.flatMap((team) => team.heroes.map((hero) => hero.defId)).sort()
    expect(left).toEqual(['elder_titan', 'riki'])
    expect(game.grave.some((card) => card.defId === 'sven')).toBe(true)
  })

  it('exiles under Razor without copying the attribute or the ability', () => {
    let game = ready()
    game = only(game, 0, ['razor'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const sven = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'sven')
    game = apply(game, { type: 'play', uid: uid(game, 0, 'razor'), team: 'new' })
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

  it('lets Morphling copy an attribute and cast only on that turn', () => {
    let game = ready()
    game = only(game, 0, ['morphling'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const sven = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'sven')
    game = apply(game, { type: 'play', uid: uid(game, 0, 'morphling'), team: 'new' })
    game = apply(game, { type: 'choose', ids: [`hero:${sven?.uid ?? ''}`] })
    const morph = game.players[0].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'morphling')
    expect(morph?.held?.mode).toBe('morph')
    expect(attrsOf(game, morph!)).toEqual(['AGI', 'STR'])
    expect(morphCasts(game).map((cast) => cast.label)).toEqual(['Cast Sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const later = game.players[0].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'morphling')
    expect(later?.held?.card.defId).toBe('sven')
    expect(attrsOf(game, later!)).toEqual(['AGI', 'STR'])
    expect(morphCasts(game)).toEqual([])
  })

  it('discards Nyx to send the countered card to the grave', () => {
    let game = ready()
    game = only(game, 0, ['sven'])
    game = only(game, 1, ['nyx_assassin'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'sven'), team: 'new' })
    expect(game.pending?.prompt).toContain('counter Sven')
    const nyx = game.pending?.choices.find((choice) => choice.id.startsWith('nyx:'))?.id ?? ''
    game = apply(game, { type: 'choose', ids: [nyx] })
    expect(game.players[0].teams).toEqual([])
    expect(game.grave.map((card) => card.defId).sort()).toEqual(['nyx_assassin', 'sven'])
    expect(game.players[0].actions).toBe(1)
  })

  it('mutes an enemy hero with Orchid', () => {
    let game = ready()
    game = only(game, 0, ['orchid'])
    game = only(game, 1, ['sven', 'refresher'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    const sven = game.players[1].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'sven')
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'orchid'), team: '' })
    expect(game.players[0].actions).toBe(2)
    game = apply(game, { type: 'choose', ids: [`hero:${sven?.uid ?? ''}`] })
    expect(game.players[1].teams[0]?.heroes[0]?.muted).toBe(true)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'refresher'), team: '' })
    game = apply(game, { type: 'choose', ids: [`hero:${sven?.uid ?? ''}`] })
    expect(game.log.at(-1)).toContain('Orchid')
    expect(game.pending).toBeNull()
  })

  it('returns an Eul target at the end of the turn without firing', () => {
    let game = ready()
    game = only(game, 0, ['euls'])
    game = only(game, 1, ['chen'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const pile = game.neutrals.length
    game = apply(game, { type: 'play', uid: uid(game, 1, 'chen'), team: 'new' })
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
    expect(game.players[1].hand.length).toBe(hand)
    expect(game.neutrals.length).toBe(pile - 1)
  })

  it('exiles with Scythe, tucks with Abyssal, draws off Greaves, and steals with Satanic', () => {
    let game = ready()
    game = only(game, 0, ['scythe'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
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
    const sven = game.players[1].teams[0]?.heroes[0]?.uid ?? ''
    const before = game.players[0].hand.length
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'abyssal'), team: '' })
    game = apply(game, { type: 'choose', ids: [`hero:${sven}`] })
    game = apply(game, { type: 'choose', ids: ['deck:bottom'] })
    expect(game.deck.at(-1)?.defId).toBe('sven')
    expect(game.players[0].hand.length).toBe(before)

    game = ready()
    game = only(game, 0, ['greaves', 'river', 'jungle'])
    const river = uid(game, 0, 'river')
    const jungle = uid(game, 0, 'jungle')
    game = apply(game, { type: 'play', uid: uid(game, 0, 'greaves'), team: '' })
    game = apply(game, { type: 'choose', ids: [`card:${river}`, `card:${jungle}`] })
    expect(game.players[0].hand.length).toBe(4)
    expect(game.grave.some((card) => card.defId === 'river')).toBe(true)

    game = ready()
    game = only(game, 0, ['satanic'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
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

  it('gives the caster another turn', () => {
    let game = ready()
    game = only(game, 0, ['faceless_void'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'faceless_void'), team: 'new' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    expect(game.active).toBe(0)
    expect(game.players[1].skip).toBe(false)
    expect(game.log.some((line) => line.includes('skips'))).toBe(true)
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
})

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
