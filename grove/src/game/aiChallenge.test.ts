import { describe, expect, it } from 'vitest'
import { chooseAiAction } from './ai.ts'
import { chooseAiActionChallenge } from './aiChallenge.ts'
import { apply, createGame } from './engine.ts'

describe('challenge AI', () => {
  it('returns a legal action on an opening position', () => {
    const game = createGame({
      seed: 11,
      seats: [
        { name: 'A', ai: true, strat: 'balanced' },
        { name: 'B', ai: true, strat: 'spite' },
      ],
    })
    const action = chooseAiActionChallenge(game, 0, 'balanced')
    expect(['draw', 'play', 'combo', 'end', 'morph', 'move', 'discard', 'undying']).toContain(action.type)
    const next = apply(game, action)
    expect(next.log.length).toBeGreaterThan(0)
  })

  it('wires through chooseAiAction mode', () => {
    const game = createGame({
      seed: 12,
      seats: [
        { name: 'A', ai: true, strat: 'tempo' },
        { name: 'B', ai: true, strat: 'architect' },
      ],
    })
    const action = chooseAiAction(game, 'challenge')
    expect(action.type).toBeTruthy()
  })
})
