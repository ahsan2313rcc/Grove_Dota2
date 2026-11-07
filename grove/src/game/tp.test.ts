import { describe, expect, it } from 'vitest'
import { apply, createGame, responseCards } from './engine.ts'
import { blankTeam, makeHero, setPlayer } from './flow.ts'
import type { Game, PlayerId } from './types.ts'

describe('Teleportation Scroll', () => {
  it('moves a hero you control on an opponent turn without spending an action', () => {
    let game = seated()
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    expect(game.active).toBe(1)
    game = setPlayer(game, 0, (seat) => ({ ...seat, actions: 0 }))
    const sven = game.players[0].teams[0]!.heroes[0]!
    const from = game.players[0].teams[0]!.id
    game = apply(game, { type: 'play', uid: uid(game, 0, 'tp_scroll'), team: '' })
    expect(game.pending?.prompt).toMatch(/hero you control/i)
    game = choose(game, `hero:${sven.uid}`)
    const dest = game.pending?.choices.find(
      (choice) => choice.id.startsWith('new') || (choice.id.startsWith('team:') && choice.id !== `team:${from}`),
    )
    expect(dest).toBeTruthy()
    game = choose(game, dest!.id)
    const home = game.players[0].teams.find((team) => team.heroes.some((hero) => hero.uid === sven.uid))
    expect(home?.id).not.toBe(from)
    expect(game.players[0].actions).toBe(0)
    expect(game.log.some((line) => /Only Instant cards/i.test(line))).toBe(false)
  })

  it('shows up as an interrupt when a hero can move, and stays hidden when none can', () => {
    let game = seated()
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    const scroll = game.players[0].hand.find((card) => card.defId === 'tp_scroll')
    game = apply(game, { type: 'play', uid: uid(game, 1, 'assault'), team: '' })
    expect(game.pending?.resume.kind).toBe('response')
    expect(game.pending?.choices.some((choice) => choice.id === `instant:${scroll?.uid}`)).toBe(true)

    game = setPlayer(game, 0, (seat) => ({ ...seat, teams: [] }))
    expect(responseCards(game, 0).some((card) => card.defId === 'tp_scroll')).toBe(false)
  })
})

function seated(): Game {
  let game = apply(
    createGame({
      seed: 5,
      seats: [
        { name: 'You', ai: false },
        { name: 'Foe', ai: false },
      ],
    }),
    { type: 'ready' },
  )
  game = only(game, 0, ['sven', 'tp_scroll'])
  game = only(game, 1, ['assault'])
  const sven = game.players[0].hand.find((card) => card.defId === 'sven')!
  return setPlayer(game, 0, (seat) => ({
    ...seat,
    hand: seat.hand.filter((card) => card.uid !== sven.uid),
    teams: [{ ...blankTeam('you-a'), heroes: [makeHero(sven, 0, 0, game)] }],
  }))
}

function choose(game: Game, id: string): Game {
  return apply(game, { type: 'choose', ids: [id] })
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
    players: next.players.map((seat) => (seat.id === player ? { ...seat, hand: found } : seat)) as Game['players'],
  }
}

function uid(game: Game, player: PlayerId, defId: string): string {
  return game.players[player].hand.find((card) => card.defId === defId)?.uid ?? ''
}
