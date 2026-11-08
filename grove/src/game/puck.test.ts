import { describe, expect, it } from 'vitest'
import { apply, createGame } from './engine.ts'
import { blankTeam, findHero, makeCard, makeHero, setPlayer } from './flow.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

describe('Puck Dream Coil', () => {
  it('blocks adding heroes onto an existing team while enemy Puck is up', () => {
    let game = apply(createGame({ seed: 11, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    game = seatDefs(game, 1, [['puck']])
    game = seatDefs(game, 0, [['sven']])
    game = only(game, 0, ['axe'])
    const team = game.players[0].teams[0]!.id
    game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team })
    expect(game.log.some((line) => /Dream Coil stops heroes from entering/i.test(line))).toBe(true)
    expect(findHero(game, uid(game, 0, 'axe'))).toBeNull()
    expect(game.players[0].teams[0]!.heroes.map((hero) => hero.defId)).toEqual(['sven'])
  })

  it('allows a solo new team while enemy Puck is up', () => {
    let game = apply(createGame({ seed: 12, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    game = seatDefs(game, 1, [['puck']])
    game = only(game, 0, ['axe'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team: 'new' })
    game = passInstants(game)
    expect(findDef(game, 0, 'axe')).toBeTruthy()
  })

  it('allows squad deploy onto a new team while enemy Puck is up', () => {
    let game = apply(createGame({ seed: 13, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    game = seatDefs(game, 1, [['puck']])
    game = only(game, 0, ['axe', 'mars', 'sven'])
    const axe = uid(game, 0, 'axe')
    const mars = uid(game, 0, 'mars')
    const sven = uid(game, 0, 'sven')
    game = apply(game, { type: 'play', uid: axe, team: 'new', extras: [mars, sven] })
    game = passInstants(game)
    expect(game.log.some((line) => /Dream Coil stops heroes from entering/i.test(line))).toBe(false)
    const team = game.players[0].teams.find((entry) => entry.heroes.some((hero) => hero.defId === 'axe'))
    expect(team?.heroes.map((hero) => hero.defId).sort()).toEqual(['axe', 'mars', 'sven'])
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

function findDef(game: Game, player: PlayerId, defId: string) {
  return game.players[player].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === defId)
}

function passInstants(game: Game): Game {
  let next = game
  let guard = 0
  while ((next.pending?.resume.kind === 'instant-window' || next.pending?.resume.kind === 'response') && guard++ < 12) {
    next = apply(next, { type: 'choose', ids: ['pass'] })
  }
  return next
}
