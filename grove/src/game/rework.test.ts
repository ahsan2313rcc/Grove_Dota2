import { describe, expect, it } from 'vitest'
import { apply, createGame } from './engine.ts'
import { allLocs, makeHero, newTeam, putOnTeam, scoreState } from './flow.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

function ready(seed = 2): Game {
  const game = createGame({ seed, mode: 'hotseat', names: ['Radiant', 'Dire'] })
  return apply(game, { type: 'ready' })
}

function pull(game: Game, defId: string): [Game, CardInst] {
  const card =
    game.deck.find((entry) => entry.defId === defId) ??
    game.players.flatMap((seat) => seat.hand).find((entry) => entry.defId === defId)
  if (!card) throw new Error(`missing ${defId}`)
  return [
    {
      ...game,
      deck: game.deck.filter((entry) => entry.uid !== card.uid),
      players: game.players.map((seat) => ({ ...seat, hand: seat.hand.filter((entry) => entry.uid !== card.uid) })),
    },
    card,
  ]
}

/** Replace a seat's hand with exactly these cards; the old hand goes to the deck bottom. */
function toHand(game: Game, player: PlayerId, defIds: string[]): Game {
  const old = game.players[player].hand
  let next: Game = {
    ...game,
    deck: [...game.deck, ...old],
    players: game.players.map((seat) => (seat.id === player ? { ...seat, hand: [] } : seat)),
  }
  for (const defId of defIds) {
    const [pulled, card] = pull(next, defId)
    next = { ...pulled, players: pulled.players.map((seat) => (seat.id === player ? { ...seat, hand: [...seat.hand, card] } : seat)) }
  }
  return next
}

function team(game: Game, player: PlayerId, defIds: string[]): [Game, string] {
  const made = newTeam(game, player)
  if (!made) throw new Error('no team')
  let [next, teamId] = made
  for (const defId of defIds) {
    const [pulled, card] = pull(next, defId)
    next = putOnTeam(pulled, player, teamId, makeHero(card, player, player, pulled))
  }
  return [next, teamId]
}

function uidOf(game: Game, player: PlayerId, defId: string): string {
  return game.players[player].hand.find((card) => card.defId === defId)?.uid ?? ''
}

function drain(game: Game, pick: (game: Game) => string[] | null = () => null): Game {
  let next = game
  let guard = 0
  while (next.pending && guard++ < 20) {
    const pending = next.pending
    const custom = pick(next)
    if (custom) {
      next = apply(next, { type: 'choose', ids: custom })
      continue
    }
    if (pending.resume.kind === 'instant-window') {
      next = apply(next, { type: 'choose', ids: ['pass'] })
      continue
    }
    const ids = pending.choices.slice(0, Math.max(1, pending.min)).map((choice) => choice.id)
    next = apply(next, { type: 'choose', ids })
  }
  return next
}

function heroCount(game: Game, player: PlayerId): number {
  return allLocs(game).filter((loc) => loc.player.id === player).length
}

describe('Clinkz Death Pact', () => {
  it('does not make hand items free', () => {
    let game = toHand(ready(), 0, ['clinkz', 'assault'])
    const items = game.deck.filter((card) => card.kind === 'item' && card.defId !== 'assault').slice(0, 5)
    game = { ...game, deck: [...items, ...game.deck.filter((card) => !items.includes(card))] }
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'clinkz'), team: 'new' }))
    expect(game.clinkzExile.length).toBe(5)
    expect(game.freeItems).toBe(0)
    const before = game.players[0].actions
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'assault'), team: '' }))
    // Assault costs its action, then grants +2.
    expect(game.players[0].actions).toBe(before - 1 + 2)
  })

  it('keeps a refused exile item in exile instead of leaking it into hand', () => {
    let game = toHand(ready(), 0, ['clinkz'])
    const items = game.deck.filter((card) => card.kind === 'item').slice(0, 5)
    game = { ...game, deck: [...items, ...game.deck.filter((card) => !items.includes(card))] }
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'clinkz'), team: 'new' }))
    ;[game] = team(game, 1, ['doom'])
    const free = game.clinkzExile[0]!
    game = apply(game, { type: 'play', uid: free.uid, team: '' })
    expect(game.players[0].hand.some((card) => card.uid === free.uid)).toBe(false)
    expect(game.clinkzExile.some((card) => card.uid === free.uid)).toBe(true)
  })
})

describe('team movement', () => {
  it('Beastmaster keeps every hero when splitting a team', () => {
    let game = toHand(ready(3), 0, ['beastmaster'])
    ;[game] = team(game, 1, ['axe', 'sven', 'lina', 'zeus'])
    game = apply(game, { type: 'play', uid: uidOf(game, 0, 'beastmaster'), team: 'new' })
    game = drain(game, (current) =>
      current.pending?.mode === 'groups'
        ? current.pending.choices.map((choice, index) => `${index % 3}:${choice.id}`)
        : null,
    )
    expect(heroCount(game, 1)).toBe(4)
    expect(game.players[1].teams.map((entry) => entry.heroes.length).sort()).toEqual([1, 1, 2])
  })

  it('Grimstroke steals a whole team without losing heroes', () => {
    let game = toHand(ready(4), 0, ['grimstroke', 'river', 'jungle', 'lane'])
    const terrains = game.players[0].hand.filter((card) => card.kind === 'terrain').map((card) => card.uid)
    game = apply(game, { type: 'combo', uids: terrains })
    ;[game] = team(game, 1, ['axe', 'sven', 'tiny'])
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'grimstroke'), team: 'new' }))
    expect(heroCount(game, 1)).toBe(0)
    expect(heroCount(game, 0)).toBe(4)
    expect(scoreState(game, 0).teams).toBeGreaterThan(0)
  })
})
