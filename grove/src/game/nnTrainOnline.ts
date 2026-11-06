/**
 * Online imitation updates for Debug → Train Neural.
 * Learns from Challenge (max heuristic) decisions into nnMemory,
 * while recording a full BalanceTracker report for the debug rail.
 */
import { chooseAiAction, chooseAiPending, searchModeForStrat } from './ai.ts'
import { chooseAiPendingChallenge } from './aiChallenge.ts'
import { BalanceTracker, type MatchReport } from './balance.ts'
import { apply, createGame, type SeatSpec } from './engine.ts'
import { scoreState } from './flow.ts'
import { getNnMemory, replaceNnMemory, saveNnMemory } from './nnMemory.ts'
import {
  encodeActionFeatures,
  encodeStateFeatures,
  listNeuralCandidates,
  setActiveModel,
  trainPair,
} from './nnValue.ts'
import type { Action, AiStrat, Game } from './types.ts'

const LR = 0.0015
/** Autosave browser checkpoint every N trained games. */
const AUTOSAVE_EVERY = 10

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
 * Full balance tracking is always on. When `train` is true, Challenge decisions
 * update NN memory (browser); autosaves every AUTOSAVE_EVERY games.
 */
export function runMatchWithOptionalTrain(
  seed: number,
  seats: SeatSpec[],
  train: boolean,
): { game: Game; samples: number; report: MatchReport } {
  let game = createGame({ seed, seats })
  const tracker = new BalanceTracker(seed, { lite: false })
  tracker.start(game)
  let samples = 0
  let guard = 0
  while (!game.over && guard < 900) {
    guard += 1
    try {
      if (game.veil) {
        const before = game
        game = apply(game, { type: 'ready' })
        tracker.observe(before, { type: 'ready' }, game)
        continue
      }
      if (game.pending) {
        const actor = game.pending.actor
        const strat = game.players[actor]?.strat ?? 'balanced'
        const mode = searchModeForStrat(strat, false)
        const ids = mode === 'challenge' || mode === 'neural'
          ? chooseAiPendingChallenge(game)
          : chooseAiPending(game)
        const before = game
        game = apply(game, { type: 'choose', ids })
        tracker.observe(before, { type: 'choose', ids }, game)
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
      tracker.observe(before, action, game)
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
    if (model.trainedGames % AUTOSAVE_EVERY === 0) saveNnMemory()
  }
  return { game, samples, report: tracker.finish(game) }
}
