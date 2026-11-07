import { describe, expect, it } from 'vitest'
import { apply, createGame } from './engine.ts'
import { blankTeam, makeHero, setPlayer } from './flow.ts'
import type { Game, PlayerId } from './types.ts'

describe("Heaven's Halberd", () => {
  it('blocks playing heroes and Blink, but Satanic can still reactivate', () => {
    let game = seated()
    game = setPlayer(game, 0, (seat) => ({ ...seat, noHeroNow: true, actions: 3 }))

    const heroUid = uid(game, 0, 'sven')
    const before = game.players[0].hand.length
    game = apply(game, { type: 'play', uid: heroUid, team: 'new' })
    expect(game.players[0].hand.some((card) => card.uid === heroUid)).toBe(true)
    expect(game.players[0].hand.length).toBe(before)
    expect(game.log.some((line) => /cannot play hero cards/i.test(line))).toBe(true)

    game = apply(game, { type: 'play', uid: uid(game, 0, 'blink'), team: '' })
    expect(game.pending).toBeNull()
    expect(game.log.some((line) => /Blink is a hero play|cannot play hero cards/i.test(line))).toBe(true)
    expect(game.players[0].hand.some((card) => card.defId === 'sven')).toBe(true)

    const foe = game.players[1].teams[0]!.heroes[0]!.uid
    game = apply(game, { type: 'play', uid: uid(game, 0, 'satanic'), team: '' })
    game = choose(game, `hero:${foe}`)
    const teamPick = game.pending?.choices.find((choice) => choice.id.startsWith('team:') || choice.id.startsWith('new'))
    expect(teamPick).toBeTruthy()
    game = choose(game, teamPick!.id)
    game = choose(game, 'yes')
    expect(game.log.some((line) => /Satanic fires/i.test(line))).toBe(true)
    expect(game.pending?.resume.kind === 'cast' || game.log.some((line) => /Laguna|fires/i.test(line))).toBe(true)
  })
})

function seated(): Game {
  let game = apply(
    createGame({
      seed: 4,
      seats: [
        { name: 'You', ai: false },
        { name: 'Foe', ai: false },
      ],
    }),
    { type: 'ready' },
  )
  game = only(game, 0, ['sven', 'blink', 'satanic'])
  game = only(game, 1, ['lina'])
  const lina = game.players[1].hand.find((card) => card.defId === 'lina')!
  game = setPlayer(game, 1, (seat) => ({
    ...seat,
    hand: [],
    teams: [{ ...blankTeam('foe-a'), heroes: [makeHero(lina, 1, 1, game)] }],
  }))
  return game
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
    players: next.players.map((seat) => (seat.id === player ? { ...seat, hand: found, actions: 3 } : seat)) as Game['players'],
  }
}

function uid(game: Game, player: PlayerId, defId: string): string {
  const card = game.players[player].hand.find((entry) => entry.defId === defId)
  if (!card) throw new Error(`missing ${defId}`)
  return card.uid
}
