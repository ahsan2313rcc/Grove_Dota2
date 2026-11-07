import { describe, expect, it } from 'vitest'
import { chooseAiAction } from './ai.ts'
import { evaluateChallenge } from './aiChallenge.ts'
import { createGame } from './engine.ts'
import { getNnMemory, replaceNnMemory } from './nnMemory.ts'
import { NnGameRecorder, placementOf, runMatchWithOptionalTrain } from './nnTrainOnline.ts'
import {
  encodeFeatures,
  forward,
  hydrateModel,
  loadModel,
  NN_DENSE,
  NN_SCALE,
  randomModel,
  relOf,
  trainBatch,
  valueOf,
} from './nnValue.ts'

function duel(seed: number) {
  return createGame({
    seed,
    seats: [
      { name: 'A', ai: true, strat: 'balanced' },
      { name: 'B', ai: true, strat: 'tempo' },
    ],
  })
}

describe('nn value net', () => {
  it('encodes dense + sparse card features and scores a state', () => {
    const game = duel(3)
    const net = loadModel(randomModel(16, 9))
    const f = encodeFeatures(game, 0, net)
    expect(f.dense.length).toBe(NN_DENSE)
    expect(f.idx.length).toBe(f.val.length)
    // Own hand cards land in the sparse block.
    expect(f.idx.length).toBeGreaterThan(0)
    expect(Number.isFinite(forward(net, f))).toBe(true)
  })

  it('a fresh net starts from the heuristic evaluation', () => {
    const game = duel(4)
    const net = loadModel(randomModel(16, 2))
    const v = valueOf(game, 0, net)
    const prior = evaluateChallenge(game, 0, 'balanced') * 0.4
    expect(Math.abs(v - prior)).toBeLessThan(2)
  })

  it('trainBatch fits a regression target', () => {
    const game = duel(5)
    const model = randomModel(16, 3)
    const f = encodeFeatures(game, 0, loadModel(model))
    const g = encodeFeatures(game, 1, loadModel(model))
    const batch = [
      { f, y: 0.6 },
      { f: g, y: -0.4 },
    ]
    const first = trainBatch(model, batch, 0.01)
    let last = first
    for (let i = 0; i < 200; i += 1) last = trainBatch(model, batch, 0.01)
    expect(last).toBeLessThan(first * 0.1)
    const net = loadModel(model)
    expect(forward(net, f)).toBeGreaterThan(forward(net, g))
  })

  it('rejects old v1 checkpoints instead of mis-reading them', () => {
    const model = hydrateModel({ version: 1, hidden: 48, w1: [1, 2, 3], b1: [], w2: [], b2: [0] })
    expect(model.version).toBe(2)
    expect(model.trainedGames).toBe(0)
  })

  it('placement and rel use the best opponent', () => {
    expect(relOf([10, 14, 6], 0)).toBe(-4)
    expect(placementOf([10, 14, 6], 1)).toBe(1)
    expect(placementOf([10, 14, 6], 2)).toBe(-1)
    expect(placementOf([10, 14, 6], 0)).toBe(0)
    expect(placementOf([8, 8], 0)).toBe(0)
  })

  it('recorder targets blend horizons and the final placement', () => {
    const recorder = new NnGameRecorder()
    const game = duel(6)
    recorder.observe(game, 0)
    const final = { ...game, over: { reason: 'test', scores: [20, 10], parts: [] } }
    const [sample] = recorder.targets(final)
    // Every horizon is past the end, so rel = +10 for seat 0 and placement = +1.
    const expected = (0.1 * 0 + 0.15 * 10 + 0.2 * 10 + 0.2 * 10 + 0.15 * 10 + 0.2 * 12) / NN_SCALE
    expect(sample!.y).toBeCloseTo(expected, 5)
  })

  it('training runs keep every seat on its own strat and learn from all of them', () => {
    const saved = getNnMemory()
    replaceNnMemory(randomModel(16, 11))
    try {
      const seats = [
        { name: 'A', ai: true, strat: 'neural' as const },
        { name: 'B', ai: true, strat: 'balanced' as const },
      ]
      const { report, samples } = runMatchWithOptionalTrain(7, seats, { train: true, fast: true })
      expect(report.seatStrats).toEqual(['neural', 'balanced'])
      expect(samples).toBeGreaterThan(20)
      expect(getNnMemory().trainedGames).toBe(1)
      expect(getNnMemory().trainedSamples).toBeGreaterThan(samples)
    } finally {
      replaceNnMemory(saved)
    }
  }, 60_000)

  it('neural mode returns an action', () => {
    const game = createGame({
      seed: 5,
      seats: [
        { name: 'A', ai: true, strat: 'neural' },
        { name: 'B', ai: true, strat: 'spite' },
      ],
    })
    const action = chooseAiAction(game, 'neural')
    expect(action.type).toBeTruthy()
  })
})
