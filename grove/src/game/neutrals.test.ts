import { describe, expect, it } from 'vitest'
import { apply, createGame } from './engine.ts'
import { blankTeam, makeHero, setPlayer } from './flow.ts'
import { firesAbility, REWARD_BY_ID } from './catalog.ts'
import { LAB_BROKEN, LAB_FLAGGED, runLab } from './lab.ts'
import type { Game, PlayerId } from './types.ts'

describe('neutral abilities', () => {
  it('documents Ability Lab broken vs flagged criteria', () => {
    expect(LAB_BROKEN).toMatch(/prompt stayed open|vanished/i)
    expect(LAB_FLAGGED).toMatch(/suspicious|fizzle|Instant window/i)
  })

  it('marks firing neutrals as cast or Instant abilities', () => {
    expect(firesAbility('roshan')).toBe(true)
    expect(firesAbility('thunderhide')).toBe(true)
    expect(firesAbility('ice_shaman')).toBe(true)
    expect(firesAbility('black_dragon')).toBe(true)
    expect(firesAbility('stone_golem')).toBe(false)
    expect(firesAbility('tormentor')).toBe(false)
    expect(REWARD_BY_ID.roshan?.spell).toBe('Bash')
  })

  it('Roshan silences opponents until the caster\'s next turn without blocking hero plays', () => {
    let game = ready()
    game = only(game, 0, ['roshan', 'sven'])
    game = only(game, 1, ['lina'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'roshan'), team: 'new' })
    game = passInstants(game)
    expect(game.silence).toBeTruthy()
    expect(game.players[1].noHeroNow).toBe(false)
    expect(game.log.some((line) => /silences opponents/i.test(line))).toBe(true)

    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    expect(game.silence).toBeTruthy()
    const before = game.log.length
    const lina = game.players[1].hand.find((card) => card.defId === 'lina')!
    game = apply(game, { type: 'play', uid: lina.uid, team: 'new' })
    game = passInstants(game)
    expect(find(game, 'lina')).toBeTruthy()
    const added = game.log.slice(before)
    expect(added.some((line) => /plays Lina/i.test(line))).toBe(true)
    expect(added.some((line) => /Laguna|Choose an enemy/i.test(line))).toBe(false)
    expect(game.pending).toBeNull()
    expect(added.some((line) => /cannot play hero cards/i.test(line))).toBe(false)

    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    expect(game.silence).toBeNull()
  })

  it('Stone Golem is immune to enemy abilities', () => {
    let game = ready()
    game = only(game, 0, ['stone_golem'])
    game = only(game, 1, ['lina'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'stone_golem'), team: 'new' })
    const golem = game.players[0].teams[0]!.heroes[0]!
    expect(golem.defId).toBe('stone_golem')
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'lina'), team: 'new' })
    game = passInstants(game)
    const heroPick = game.pending?.choices.find((choice) => choice.id === `hero:${golem.uid}`)
    expect(heroPick).toBeFalsy()
    expect(find(game, 'stone_golem')).toBeTruthy()
  })

  it('Thunderhide draws one on play', () => {
    let game = ready()
    game = only(game, 0, ['thunderhide'])
    const before = game.players[0].hand.length
    game = apply(game, { type: 'play', uid: uid(game, 0, 'thunderhide'), team: 'new' })
    game = passInstants(game)
    expect(game.players[0].hand.length).toBe(before) // spent the neutral, drew 1
    expect(game.log.some((line) => /Static Charge draws 1/i.test(line))).toBe(true)
  })

  it('Black Dragon makes an opponent discard one', () => {
    let game = ready()
    game = only(game, 0, ['black_dragon'])
    game = only(game, 1, ['sven', 'lane'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'black_dragon'), team: 'new' })
    game = passInstants(game)
    expect(game.pending?.prompt).toMatch(/discard/i)
    game = apply(game, { type: 'choose', ids: ['player:1'] })
    game = passInstants(game)
    // Rival answers the discard prompt with their only auto pick when autoAll is off — force choose.
    if (game.pending?.resume.kind === 'discard') {
      const pick = game.pending.choices[0]?.id
      if (pick) game = apply(game, { type: 'choose', ids: [pick] })
    }
    expect(game.players[1].hand.length).toBe(1)
    expect(game.log.some((line) => /Fireball/i.test(line))).toBe(true)
  })

  it('Ice Shaman returns a hero to hand without leaving them on the board', () => {
    let game = ready()
    game = only(game, 0, ['ice_shaman'])
    game = only(game, 1, ['sven'])
    const sven = game.players[1].hand.find((card) => card.defId === 'sven')!
    game = setPlayer(game, 1, (seat) => ({
      ...seat,
      hand: [],
      teams: [{ ...blankTeam('foe-a'), heroes: [makeHero(sven, 1, 1, game)] }],
    }))
    game = apply(game, { type: 'play', uid: uid(game, 0, 'ice_shaman'), team: 'new' })
    game = passInstants(game)
    expect(game.pending?.prompt).toMatch(/hand/i)
    game = apply(game, { type: 'choose', ids: [`hero:${sven.uid}`] })
    game = passInstants(game)
    expect(find(game, 'sven')).toBeNull()
    expect(game.players[1].hand.some((card) => card.defId === 'sven')).toBe(true)
    expect(game.log.some((line) => /Frost Bind/i.test(line))).toBe(true)
  })

  it('lab auto-play keeps the new neutrals from going broken', () => {
    for (const id of ['stone_golem', 'thunderhide', 'ice_shaman', 'black_dragon', 'roshan', 'tormentor']) {
      expect(runLab(id).issues).toEqual([])
    }
  })
})

function ready(): Game {
  return apply(createGame({ seed: 11, mode: 'hotseat', names: ['You', 'Foe'] }), { type: 'ready' })
}

function passInstants(game: Game): Game {
  let next = game
  let guard = 0
  while ((next.pending?.resume.kind === 'instant-window' || next.pending?.resume.kind === 'response') && guard++ < 12) {
    next = apply(next, { type: 'choose', ids: ['pass'] })
  }
  return next
}

function only(game: Game, player: PlayerId, defIds: string[]): Game {
  let next = game
  const found = defIds.map((defId) => {
    const card =
      next.players[player].hand.find((entry) => entry.defId === defId)
      ?? next.deck.find((entry) => entry.defId === defId)
      ?? next.neutrals.find((entry) => entry.defId === defId)
      ?? next.grave.find((entry) => entry.defId === defId)
    if (!card) throw new Error(`missing ${defId}`)
    next = {
      ...next,
      deck: next.deck.filter((entry) => entry.uid !== card.uid),
      neutrals: next.neutrals.filter((entry) => entry.uid !== card.uid),
      grave: next.grave.filter((entry) => entry.uid !== card.uid),
      players: next.players.map((seat) => ({
        ...seat,
        hand: seat.hand.filter((entry) => entry.uid !== card.uid),
      })) as Game['players'],
    }
    return card
  })
  return {
    ...next,
    players: next.players.map((seat) => (seat.id === player ? { ...seat, hand: found } : seat)) as Game['players'],
  }
}

function uid(game: Game, player: PlayerId, defId: string): string {
  return game.players[player].hand.find((card) => card.defId === defId)?.uid ?? ''
}

function find(game: Game, defId: string) {
  for (const player of game.players) {
    for (const team of player.teams) {
      const hero = team.heroes.find((entry) => entry.defId === defId)
      if (hero) return hero
    }
  }
  return null
}
