/**
 * Online imitation updates for Debug → Train Neural.
 * Learns from Challenge (max heuristic) decisions into nnMemory.
 */
import { chooseAiAction, chooseAiPending, heuristicFace, searchModeForStrat } from './ai.ts'
import { chooseAiPendingChallenge } from './aiChallenge.ts'
import { apply, createGame, type SeatSpec } from './engine.ts'
import { scoreState } from './flow.ts'
import { getNnMemory, replaceNnMemory } from './nnMemory.ts'
import {
  encodeActionFeatures,
  encodeStateFeatures,
  listNeuralCandidates,
  setActiveModel,
  trainPair,
} from './nnValue.ts'
import type { Action, AiStrat, Game } from './types.ts'

const LR = 0.0015

export function learnFromTeacher(before: Game, actor: number, teacher: Action): number {
  const model = getNnMemory()
  setActiveModel(model)
  const stateFeats = encodeStateFeatures(before, actor)
  const teacherFeats = encodeActionFeatures(before, actor, teacher)
  let n = 0
  for (const other of listNeuralCandidates(before, actor)) {
    if (JSON.stringify(other) === JSON.stringify(teacher)) continue
    trainPair(model, stateFeats, teacherFeats, encodeActionFeatures(before, actor, other), LR)
    n += 1
  }
  model.trainedSamples += n
  replaceNnMemory(model)
  return n
}

function softFinish(game: Game): Game {
  const parts = game.players.map((p) => scoreState(game, p.id))
  return {
    ...game,
    over: { reason: 'halt', scores: parts.map((p) => p.total), parts },
    pending: null,
    veil: false,
    queue: [],
    echoes: [],
    after: null,
  }
}

/**
 * Play one match with max Challenge for heuristic seats / Neural for neural seats.
 * When `train` is true, every Challenge decision updates NN memory.
 */
export function runMatchWithOptionalTrain(
  seed: number,
  seats: SeatSpec[],
  train: boolean,
): { game: Game; samples: number } {
  let game = createGame({ seed, seats })
  let samples = 0
  let guard = 0
  while (!game.over && guard < 900) {
    guard += 1
    try {
      if (game.veil) {
        game = apply(game, { type: 'ready' })
        continue
      }
      if (game.pending) {
        const actor = game.pending.actor
        const strat = game.players[actor]?.strat ?? 'balanced'
        const mode = searchModeForStrat(strat, false)
        const ids = mode === 'challenge' || mode === 'neural'
          ? chooseAiPendingChallenge(game)
          : chooseAiPending(game)
        game = apply(game, { type: 'choose', ids })
        continue
      }
      const actor = game.active
      const strat = (game.players[actor]?.strat ?? 'balanced') as AiStrat
      const mode = searchModeForStrat(strat, false)
      const before = game
      const action = chooseAiAction(game, mode)
      if (train && mode === 'challenge') {
        samples += learnFromTeacher(before, actor, action)
      }
      game = apply(game, action)
    } catch {
      break
    }
  }
  if (!game.over) game = softFinish(game)
  if (train) {
    const model = getNnMemory()
    model.trainedGames += 1
    model.note = `online train; games=${model.trainedGames}; ${new Date().toISOString()}`
    replaceNnMemory(model)
  }
  void heuristicFace
  return { game, samples }
}
