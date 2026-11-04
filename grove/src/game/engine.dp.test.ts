import { describe, expect, it } from 'vitest'
import { apply, createGame, playableFromGrave } from './engine.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

describe('Death Prophet Exorcism', () => {
  it('exposes and plays the top grave card while Death Prophet is controlled', () => {
    let game = ready()
    game = only(game, 0, ['death_prophet', 'sven'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'death_prophet'), team: 'new' })
    // Dump Sven into the grave via a forced discard path: play then destroy is heavy — put card in grave directly.
    const sven = game.players[0].hand.find((card) => card.defId === 'sven')!
    game = {
      ...game,
      grave: [...game.grave, sven],
      players: game.players.map((seat) =>
        seat.id === 0 ? { ...seat, hand: seat.hand.filter((card) => card.uid !== sven.uid) } : seat,
      ) as Game['players'],
    }
    const top = playableFromGrave(game, 0)
    expect(top?.defId).toBe('sven')
    game = apply(game, { type: 'play', uid: top!.uid, team: 'new' })
    let guard = 0
    while (game.pending && guard++ < 12) {
      game = apply(game, { type: 'choose', ids: ['pass'] })
    }
    expect(game.players[0].teams.some((team) => team.heroes.some((hero) => hero.defId === 'sven'))).toBe(true)
    expect(game.grave.some((card) => card.uid === sven.uid)).toBe(false)
  })
})

function ready(): Game {
  const game = createGame({ seed: 9, mode: 'hotseat', names: ['Radiant', 'Dire'] })
  return apply(game, { type: 'ready' })
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
