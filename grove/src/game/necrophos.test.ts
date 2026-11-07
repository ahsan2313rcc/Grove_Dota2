import { describe, expect, it } from 'vitest'
import { apply, createGame } from './engine.ts'
import { blankTeam, findHero, makeHero, removeHero, setPlayer } from './flow.ts'
import type { Game, PlayerId } from './types.ts'

describe("Necrophos Reaper's Scythe", () => {
  it('bans the exiled attribute while Necrophos stays, then lifts when he leaves', () => {
    let game = ready()
    game = only(game, 0, ['necrophos'])
    game = only(game, 1, ['axe', 'tidehunter'])

    const axeCard = game.players[1].hand.find((card) => card.defId === 'axe')!
    const axeHero = makeHero(axeCard, 1, 1, game)
    game = setPlayer(game, 1, (seat) => ({
      ...seat,
      hand: seat.hand.filter((card) => card.uid !== axeCard.uid),
      teams: [{ ...blankTeam('foe-a'), heroes: [axeHero] }],
    }))
    const axeUid = axeHero.uid

    game = apply(game, { type: 'play', uid: uid(game, 0, 'necrophos'), team: 'new' })
    game = passUntilCast(game)
    while (game.pending?.resume.kind === 'cast') {
      const pick =
        game.pending.choices.find((choice) => choice.id === `hero:${axeUid}`)
        ?? game.pending.choices[0]
      if (!pick) break
      game = apply(game, { type: 'choose', ids: [pick.id] })
      game = passInstants(game)
    }
    game = passInstants(game)

    const necro = game.players[0].teams.flatMap((team) => team.heroes).find((hero) => hero.defId === 'necrophos')
    expect(necro).toBeTruthy()
    expect(game.attrBan).toEqual({ attr: 'STR', caster: 0, sourceUid: necro!.uid })
    expect(findHero(game, axeUid)).toBeNull()

    // Force foe's turn with Tidehunter still in hand.
    game = {
      ...game,
      active: 1,
      veil: false,
      pending: null,
      respond: null,
      players: game.players.map((seat) =>
        seat.id === 1 ? { ...seat, actions: 2, hand: seat.hand.filter((card) => card.defId === 'tidehunter') } : seat,
      ) as Game['players'],
    }
    const tide = uid(game, 1, 'tidehunter')
    const handBefore = game.players[1].hand.length
    game = apply(game, { type: 'play', uid: tide, team: 'new' })
    expect(game.players[1].hand.length).toBe(handBefore)
    expect(game.log.some((line) => /bans that attribute/i.test(line))).toBe(true)

    const lifted = removeHero(game, necro!.uid)
    game = lifted.state
    expect(game.attrBan).toBeNull()
    expect(game.log.some((line) => /playable again/i.test(line))).toBe(true)
  })
})

function ready(): Game {
  const game = createGame({
    seed: 11,
    seats: [
      { name: 'You', ai: false },
      { name: 'Foe', ai: false },
    ],
  })
  return apply(game, { type: 'ready' })
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
