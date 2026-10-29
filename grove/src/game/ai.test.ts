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
      expect(['draw', 'play', 'combo', 'end', 'morph', 'move']).toContain(action.type)
      game = apply(game, action)
      expect(game.log.length).toBeGreaterThan(0)
    }
  })
})
