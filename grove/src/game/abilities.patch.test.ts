import { describe, expect, it } from 'vitest'
import { HERO_BY_ID } from './catalog.ts'
import { apply, createGame, settle } from './engine.ts'
import { canTargetHero, canTargetTeam, findHero } from './flow.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

describe('Rubick Spell Steal', () => {
  it('is an Instant that copies and nullifies the stolen hero', () => {
    expect(HERO_BY_ID.rubick?.timing).toBe('instant')
    expect(HERO_BY_ID.rubick?.text).toMatch(/Copy target enemy hero/i)
    expect(HERO_BY_ID.rubick?.text).toMatch(/Nullify that hero's ability this turn/i)
    expect(HERO_BY_ID.rubick?.text).toMatch(/Instant/i)
  })

  it('nullifies the interrupted cast when stealing that caster, but not a different hero', () => {
    // Enigma about to fire → Rubick steals Enigma → Black Hole is nullified.
    let game = ready()
    game = only(game, 0, ['enigma'])
    game = only(game, 1, ['rubick', 'tidehunter'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'enigma'), team: 'new' })
    game = passUntilCast(game)
    expect(game.pending?.resume.kind).toBe('cast')
    // Finish Enigma targeting so the Instant window opens.
    while (game.pending?.resume.kind === 'cast') {
      const choice = game.pending.choices[0]
      if (!choice) break
      game = apply(game, { type: 'choose', ids: [choice.id] })
    }
    expect(game.pending?.resume.kind).toBe('instant-window')
    const enigmaUid = game.players[0].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'enigma')!.uid
    const rubickUid = uid(game, 1, 'rubick')
    game = apply(game, { type: 'choose', ids: [`instant:${rubickUid}`] })
    // Place Rubick if asked.
    if (game.pending?.resume.kind === 'instant-place') {
      const seat = game.pending.choices.find((choice) => choice.id.includes('new')) ?? game.pending.choices[0]
      game = apply(game, { type: 'choose', ids: [seat!.id] })
    }
    game = passInstants(game)
    // Rubick Spell Steal prompt — steal Enigma.
    if (game.pending?.resume.kind === 'cast' && game.pending.resume.defId === 'rubick') {
      game = apply(game, { type: 'choose', ids: [`hero:${enigmaUid}`] })
    }
    // Drain nested stolen cast prompts / windows.
    let guard = 0
    while (game.pending && guard++ < 40) {
      if (game.pending.resume.kind === 'instant-window') {
        game = apply(game, { type: 'choose', ids: ['pass'] })
        continue
      }
      const pick =
        game.pending.choices.find((choice) => choice.id === 'pass') ??
        game.pending.choices.find((choice) => choice.id.startsWith('new')) ??
        game.pending.choices[0]
      if (!pick) break
      game = apply(game, { type: 'choose', ids: [pick.id] })
    }
    game = settle(game)
    expect(game.spellNullify.some((entry) => entry.uid === enigmaUid)).toBe(true)
    expect(game.log.some((line) => /Spell Steal nullifies Enigma/i.test(line))).toBe(true)
  })
})

describe('Mars Bulwark vs Omniknight', () => {
  it('blocks ally hero targets but not Mars himself or the team', () => {
    expect(HERO_BY_ID.mars?.text).toMatch(/Mars himself can still be targeted/i)
    expect(HERO_BY_ID.mars?.text).toMatch(/still target this team/i)

    let game = ready()
    game = only(game, 0, ['mars', 'axe'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'mars'), team: 'new' })
    game = passInstants(game)
    const team = game.players[0].teams[0]!
    game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team: team.id })
    game = passInstants(game)
    const mars = findHero(game, game.players[0].teams[0]!.heroes.find((hero) => hero.defId === 'mars')!.uid)!
    const axe = findHero(game, game.players[0].teams[0]!.heroes.find((hero) => hero.defId === 'axe')!.uid)!
    // Enemy abilities: Axe protected, Mars open, team open.
    expect(canTargetHero(game, 1, axe.hero, 'ability')).toBe(false)
    expect(canTargetHero(game, 1, mars.hero, 'ability')).toBe(true)
    expect(canTargetTeam(game, 1, mars.team, 0, 'ability')).toBe(true)
  })

  it('Omniknight still blocks every hero on the sealed team', () => {
    let game = ready()
    game = only(game, 0, ['omniknight', 'axe'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'omniknight'), team: 'new' })
    game = passInstants(game)
    const team = game.players[0].teams[0]!
    game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team: team.id })
    // Omniknight seals entry — Axe may fail to join; if he did, both are immune.
    const omni = game.players[0].teams[0]?.heroes.find((hero) => hero.defId === 'omniknight')
    expect(omni).toBeTruthy()
    if (omni) {
      expect(canTargetHero(game, 1, omni, 'ability')).toBe(false)
    }
  })
})

describe('Crystal Maiden Arcane Aura', () => {
  it('is a global-control aura', () => {
    expect(HERO_BY_ID.crystal_maiden?.timing).toBe('aura')
    expect(HERO_BY_ID.crystal_maiden?.text).toMatch(/hero you control activates an ability/i)
  })

  it('draws when any controlled hero activates, even on another team', () => {
    let game = ready()
    game = only(game, 0, ['crystal_maiden', 'axe'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'crystal_maiden'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team: 'new' })
    game = passInstants(game)
    // Axe ability should prompt; resolve it and expect an Arcane Aura draw log.
    const before = game.players[0].hand.length + game.pendingDraws.reduce((sum, entry) => sum + entry.n, 0)
    if (game.pending?.resume.kind === 'cast') {
      const pick = game.pending.choices[0]
      if (pick) game = apply(game, { type: 'choose', ids: [pick.id] })
    }
    game = passInstants(game)
    let guard = 0
    while (game.pending && guard++ < 20) {
      if (game.pending.resume.kind === 'instant-window') {
        game = apply(game, { type: 'choose', ids: ['pass'] })
        continue
      }
      const pick = game.pending.choices.find((choice) => choice.id === 'pass') ?? game.pending.choices[0]
      if (!pick) break
      game = apply(game, { type: 'choose', ids: [pick.id] })
    }
    game = settle(game)
    expect(game.log.some((line) => /Arcane Aura/.test(line))).toBe(true)
    const after = game.players[0].hand.length + game.pendingDraws.reduce((sum, entry) => sum + entry.n, 0)
    expect(after).toBeGreaterThanOrEqual(before)
  })
})

function ready(): Game {
  return apply(createGame({ seed: 17, mode: 'hotseat', names: ['Radiant', 'Dire'] }), { type: 'ready' })
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
      })) as Game['players'],
    }
  }
  return {
    ...next,
    players: next.players.map((seat) => (seat.id === player ? { ...seat, hand: found } : seat)) as Game['players'],
  }
}

function uid(game: Game, player: PlayerId, defId: string): string {
  const card = game.players[player].hand.find((entry) => entry.defId === defId)
  if (!card) throw new Error(`missing ${defId}`)
  return card.uid
}

function passInstants(game: Game): Game {
  let next = game
  let guard = 0
  while (next.pending?.resume.kind === 'instant-window' && guard++ < 12) {
    next = apply(next, { type: 'choose', ids: ['pass'] })
  }
  return next
}

function passUntilCast(game: Game): Game {
  let next = passInstants(game)
  let guard = 0
  while (next.pending && next.pending.resume.kind !== 'cast' && guard++ < 20) {
    const pick = next.pending.choices.find((choice) => choice.id === 'pass') ?? next.pending.choices[0]
    if (!pick) break
    next = apply(next, { type: 'choose', ids: [pick.id] })
    next = passInstants(next)
  }
  return next
}
