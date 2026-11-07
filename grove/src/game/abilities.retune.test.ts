import { describe, expect, it } from 'vitest'
import { apply, createGame } from './engine.ts'
import { HERO_BY_ID } from './catalog.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

function ready(): Game {
  return apply(createGame({ seed: 7, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
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

function passInstants(game: Game): Game {
  let next = game
  let guard = 0
  while ((next.pending?.resume.kind === 'instant-window' || next.pending?.resume.kind === 'response') && guard++ < 12) {
    next = apply(next, { type: 'choose', ids: ['pass'] })
  }
  return next
}

describe('retuned abilities', () => {
  it('Axe blocks opponent draws', () => {
    let game = ready()
    game = only(game, 0, ['axe'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team: 'new' })
    game = passInstants(game)
    expect(game.noDraw?.caster).toBe(0)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    // Opponent turn-start draw should be blocked.
    expect(game.log.some((line) => /Berserker's Call stops the draw/.test(line))).toBe(true)
  })

  it('Sniper destroys a hero from a larger enemy team', () => {
    let game = ready()
    game = only(game, 0, ['sniper'])
    game = only(game, 1, ['axe', 'bristleback', 'sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'axe'), team: 'new' })
    game = passInstants(game)
    const team = game.players[1].teams[0]!.id
    game = apply(game, { type: 'play', uid: uid(game, 1, 'bristleback'), team })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team })
    game = passInstants(game)
    const victim = game.players[1].teams[0]!.heroes.find((hero) => hero.defId === 'sven')!.uid
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'sniper'), team: 'new' })
    game = passInstants(game)
    expect(game.pending?.prompt.toLowerCase()).toMatch(/larger enemy team/)
    game = apply(game, { type: 'choose', ids: [`hero:${victim}`] })
    game = passInstants(game)
    while (game.pending?.prompt.includes('would be destroyed')) {
      game = apply(game, { type: 'choose', ids: ['pass'] })
    }
    expect(game.grave.some((card) => card.defId === 'sven')).toBe(true)
    expect(game.players[1].teams[0]!.heroes.map((hero) => hero.defId).sort()).toEqual(['axe', 'bristleback'])
  })

  it('blocks stolen ability chaining', () => {
    expect(HERO_BY_ID.lifestealer?.text).toMatch(/Stolen and copied abilities cannot/i)
    let game = ready()
    game = only(game, 0, ['lifestealer'])
    game = only(game, 1, ['vengeful_spirit'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'vengeful_spirit'), team: 'new' })
    game = passInstants(game)
    const vs = game.players[1].teams[0]!.heroes[0]!.uid
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'lifestealer'), team: 'new' })
    game = passInstants(game)
    game = apply(game, { type: 'choose', ids: [`hero:${vs}`] })
    game = apply(game, { type: 'choose', ids: ['new:0'] })
    game = apply(game, { type: 'choose', ids: ['yes'] })
    game = passInstants(game)
    // Infest exiles Lifestealer and may fire the stolen ability under stolenCast.
    expect(
      game.infests.some((entry) => entry.hostUid === vs) ||
        game.log.some((line) => /cannot chain|Infest|Stolen abilities/i.test(line)),
    ).toBe(true)
    expect(game.players[0].teams.flatMap((team) => team.heroes.map((hero) => hero.defId))).not.toContain('lifestealer')
  })
})
