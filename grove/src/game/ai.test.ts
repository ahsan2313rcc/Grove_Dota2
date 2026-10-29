import { describe, expect, it } from 'vitest'
import { AI_STRATS, chooseAiAction } from './ai.ts'
import { apply, createGame } from './engine.ts'
import type { AiStrat } from './types.ts'

describe('ai strats', () => {
  it('exposes four personalities', () => {
    expect(AI_STRATS.map((entry) => entry.id)).toEqual(['balanced', 'tempo', 'architect', 'spite'])
  })

  it('each strat returns a legal action on an opening hand', () => {
    for (const strat of AI_STRATS.map((entry) => entry.id) as AiStrat[]) {
      let game = createGame({
        seed: 58,
        seats: [
          { name: 'A', ai: true, strat },
          { name: 'B', ai: true, strat: 'balanced' },
        ],
      })
      const action = chooseAiAction(game)
      expect(['draw', 'play', 'combo', 'end', 'morph', 'move', 'discard']).toContain(action.type)
      game = apply(game, action)
      expect(game.log.length).toBeGreaterThan(0)
    }
  })

  it('never tries to play a lone setting', () => {
    for (const strat of AI_STRATS.map((entry) => entry.id) as AiStrat[]) {
      let game = createGame({
        seed: 91,
        seats: [
          { name: 'A', ai: true, strat },
          { name: 'B', ai: true, strat: 'spite' },
        ],
      })
      for (let step = 0; step < 40 && !game.over; step += 1) {
        if (game.veil) {
          game = apply(game, { type: 'ready' })
          continue
        }
        if (game.pending) {
          game = { ...game, pending: null }
          continue
        }
        const action = chooseAiAction(game)
        if (action.type === 'play') {
          const card = game.players[game.active]?.hand.find((entry) => entry.uid === action.uid)
          expect(card?.kind).not.toBe('setting')
        }
        game = apply(game, action)
      }
    }
  })
})
