import { describe, expect, it } from 'vitest'
import { apply, createGame } from '../game/engine.ts'
import { makeHero, newTeam, putOnTeam } from '../game/flow.ts'
import { opponentTurnFeed } from './opponentPlay.ts'

describe('opponent action bar', () => {
  it('names the team and the result without writing that sentence into the match log', () => {
    let game = apply(createGame({ seed: 1, mode: 'hotseat', names: ['You', 'Foe'] }), { type: 'ready' })
    const card = game.deck.find((entry) => entry.defId === 'razor')!
    const made = newTeam({ ...game, deck: game.deck.filter((entry) => entry.uid !== card.uid) }, 0)
    if (!made) throw new Error('no team')
    game = putOnTeam(made[0], 0, made[1], makeHero(card, 0, 0, made[0]))
    game = {
      ...game,
      active: 0,
      log: [
        ...game.log,
        "You's turn. Round 2 · 1 pts · 2 actions.",
        'You draws 2 for the turn (5 in hand).',
        'You plays Razor — Static Link.',
        "Foe's Jakiro is exiled.",
        'Static Link: +1 action.',
      ],
    }
    expect(opponentTurnFeed(game, 1)).toEqual([
      'Opponent draws 2.',
      'Opponent plays Razor in Team A (exiles Jakiro).',
    ])
    expect(opponentTurnFeed(game, 0)).toEqual([])
    expect(game.log.some((line) => line.includes('Opponent plays Razor'))).toBe(false)
  })
})
