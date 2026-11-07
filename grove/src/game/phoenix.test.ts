import { describe, expect, it } from 'vitest'
import { apply, createGame } from './engine.ts'
import { blankTeam, findHero, makeHero, setPlayer } from './flow.ts'
import type { Game, PlayerId } from './types.ts'

describe('Phoenix Supernova', () => {
  it('exiles Phoenix and sinks the chosen enemy team when you pay', () => {
    let game = setup()
    const foeTeam = game.players[1].teams[0]!
    const before = foeTeam.heroes.map((hero) => hero.uid)

    game = apply(game, { type: 'play', uid: uid(game, 0, 'phoenix'), team: 'new' })
    game = passUntilCast(game)
    expect(game.pending?.resume.kind).toBe('cast')
    game = apply(game, { type: 'choose', ids: ['exile:yes'] })
    game = passUntilCast(game)
    expect(game.pending?.prompt).toMatch(/bottom of the deck/i)
    game = apply(game, { type: 'choose', ids: [`team:${foeTeam.id}`] })
    game = passInstants(game)

    expect(findHero(game, before[0]!)).toBeNull()
    expect(game.players[0].teams.flatMap((team) => team.heroes).some((hero) => hero.defId === 'phoenix')).toBe(false)
    expect(game.exile.some((card) => card.defId === 'phoenix')).toBe(true)
    for (const uid of before) {
      expect(game.deck.some((card) => card.uid === uid)).toBe(true)
    }
    const bottom = game.deck.slice(-before.length).map((card) => card.uid)
    expect(bottom.sort()).toEqual([...before].sort())
  })

  it('does nothing to the enemy team if you keep Phoenix', () => {
    let game = setup()
    const foeUid = game.players[1].teams[0]!.heroes[0]!.uid

    game = apply(game, { type: 'play', uid: uid(game, 0, 'phoenix'), team: 'new' })
    game = passUntilCast(game)
    game = apply(game, { type: 'choose', ids: ['exile:no'] })
    game = passInstants(game)

    expect(findHero(game, foeUid)).toBeTruthy()
    expect(game.players[0].teams.flatMap((team) => team.heroes).some((hero) => hero.defId === 'phoenix')).toBe(true)
    expect(game.log.some((line) => /Supernova passes/i.test(line))).toBe(true)
  })
})

function setup(): Game {
  let game = apply(
    createGame({
      seed: 19,
      seats: [
        { name: 'You', ai: false },
        { name: 'Foe', ai: false },
      ],
    }),
    { type: 'ready' },
  )
  game = only(game, 0, ['phoenix'])
  game = only(game, 1, ['axe', 'sven'])
  const axe = game.players[1].hand.find((card) => card.defId === 'axe')!
  const sven = game.players[1].hand.find((card) => card.defId === 'sven')!
  game = setPlayer(game, 1, (seat) => ({
    ...seat,
    hand: [],
    teams: [{
      ...blankTeam('foe-a'),
      heroes: [makeHero(axe, 1, 1, game), makeHero(sven, 1, 1, game)],
    }],
  }))
  return game
}

function only(game: Game, player: PlayerId, defIds: string[]): Game {
  let next = game
  const found = defIds.map((defId) => {
    const card =
      next.players[player].hand.find((entry) => entry.defId === defId)
      ?? next.deck.find((entry) => entry.defId === defId)
      ?? next.grave.find((entry) => entry.defId === defId)
    if (!card) throw new Error(`missing ${defId}`)
    next = {
      ...next,
      deck: next.deck.filter((entry) => entry.uid !== card.uid),
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
    players: next.players.map((seat) => (seat.id === player ? { ...seat, hand: found, actions: 3 } : seat)) as Game['players'],
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
  while ((next.pending?.resume.kind === 'instant-window' || next.pending?.resume.kind === 'response') && guard++ < 12) {
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
