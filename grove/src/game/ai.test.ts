import { describe, expect, it } from 'vitest'
import { AI_STRATS, chooseAiAction } from './ai.ts'
import { apply, createGame } from './engine.ts'
import { preferredFoeFromScores, standingOf } from './flow.ts'
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

  it('aims sabotage at the seat immediately above in standing', () => {
    expect(preferredFoeFromScores([20, 12, 8], 2)).toBe(1)
    expect(preferredFoeFromScores([20, 12, 8], 1)).toBe(0)
    expect(preferredFoeFromScores([20, 12, 8], 0)).toBe(1)
    expect(standingOf([20, 12, 8], 2)).toBe(3)
    expect(standingOf([20, 12, 8], 0)).toBe(1)
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
