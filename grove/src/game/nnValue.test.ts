import { describe, expect, it } from 'vitest'
import { chooseAiAction } from './ai.ts'
import { createGame } from './engine.ts'
import {
  encodeActionFeatures,
  encodeStateFeatures,
  hydrateModel,
  loadModel,
  randomModel,
  scoreAction,
  trainPair,
} from './nnValue.ts'

describe('nn value net', () => {
  it('encodes fixed-size features and scores actions', () => {
    const game = createGame({
      seed: 3,
      seats: [
        { name: 'A', ai: true, strat: 'balanced' },
        { name: 'B', ai: true, strat: 'tempo' },
      ],
    })
    const state = encodeStateFeatures(game, 0)
    expect(state.length).toBe(48)
    const action = encodeActionFeatures(game, 0, { type: 'end' })
    expect(action.length).toBe(16)
    const net = loadModel(randomModel(48, 9))
    expect(Number.isFinite(scoreAction(net, state, action))).toBe(true)
  })

  it('trainPair reduces hinge loss on a toy preference', () => {
    const game = createGame({
      seed: 4,
      seats: [
        { name: 'A', ai: true, strat: 'balanced' },
        { name: 'B', ai: true, strat: 'tempo' },
      ],
    })
    const model = hydrateModel(randomModel(32, 2))
    const state = encodeStateFeatures(game, 0)
    const teacher = encodeActionFeatures(game, 0, { type: 'draw' })
    const other = encodeActionFeatures(game, 0, { type: 'end' })
    for (let i = 0; i < 40; i += 1) trainPair(model, state, teacher, other, 0.05)
    const net = loadModel(model)
    expect(scoreAction(net, state, teacher)).toBeGreaterThan(scoreAction(net, state, other))
  })

  it('neural mode returns an action', () => {
    const game = createGame({
      seed: 5,
      seats: [
        { name: 'A', ai: true, strat: 'balanced' },
        { name: 'B', ai: true, strat: 'spite' },
      ],
    })
    const action = chooseAiAction(game, 'neural')
    expect(action.type).toBeTruthy()
  })
})
