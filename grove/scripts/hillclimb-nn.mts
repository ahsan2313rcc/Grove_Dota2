/**
 * Hillclimb the Grove NN until it beats every heuristic brain at its best.
 *
 * Uses Challenge as the teacher / sparring partner (no speed shortcuts).
 * Saves checkpoints continuously; keeps `nn-value.best.json` on eval gains.
 *
 *   npx tsx scripts/hillclimb-nn.mts
 *   npx tsx scripts/hillclimb-nn.mts --target 0.55 --eval 40 --imitate 30 --duel 40
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chooseAiAction, chooseAiPending, type AiSearchMode } from '../src/game/ai.ts'
import { chooseAiPendingChallenge } from '../src/game/aiChallenge.ts'
import { aiRoster } from '../src/game/balance.ts'
import { apply, createGame } from '../src/game/engine.ts'
import { scoreState } from '../src/game/flow.ts'
import {
  encodeActionFeatures,
  encodeStateFeatures,
  hydrateModel,
  listNeuralCandidates,
  randomModel,
  setActiveModel,
  trainPair,
  type NnModel,
} from '../src/game/nnValue.ts'
import type { Action, AiStrat, Game, PlayerId } from '../src/game/types.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dir, '../src/game/data/nn-value.json')
const bestPath = join(__dir, '../src/game/data/nn-value.best.json')
const logPath = join(__dir, '../src/game/data/nn-hillclimb.log.jsonl')

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1]! : fallback
}

const TARGET = Number(arg('--target', '0.55'))
const EVAL_GAMES = Number(arg('--eval', '48'))
const IMITATE_GAMES = Number(arg('--imitate', '40'))
const DUEL_GAMES = Number(arg('--duel', '48'))
const MAX_ROUNDS = Number(arg('--rounds', '80'))
const LR = Number(arg('--lr', '0.0012'))

type TraceStep = {
  actor: PlayerId
  stateFeats: Float64Array
  actionFeats: Float64Array
  alts: Float64Array[]
}

function loadModelFile(path: string): NnModel {
  if (!existsSync(path)) return randomModel(48, 42)
  try {
    return hydrateModel(JSON.parse(readFileSync(path, 'utf8')) as NnModel)
  } catch {
    return randomModel(48, 42)
  }
}

function saveModel(model: NnModel, path: string) {
  writeFileSync(path, JSON.stringify(model))
}

function appendLog(row: Record<string, unknown>) {
  writeFileSync(logPath, `${JSON.stringify(row)}\n`, { flag: 'a' })
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

function pendingIds(game: Game, mode: AiSearchMode): string[] {
  if (mode === 'challenge' || mode === 'neural') return chooseAiPendingChallenge(game)
  return chooseAiPending(game)
}

function playMatch(
  seed: number,
  brains: [AiSearchMode, AiSearchMode],
  strats: [AiStrat, AiStrat] = ['balanced', 'balanced'],
  traceNeuralSeat: number | null = null,
): { scores: number[]; winner: number | null; steps: TraceStep[] } {
  let game = createGame({
    seed,
    seats: [
      { name: 'A', ai: true, strat: strats[0] },
      { name: 'B', ai: true, strat: strats[1] },
    ],
  })
  const steps: TraceStep[] = []
  let guard = 0
  while (!game.over && guard < 900) {
    guard += 1
    try {
      if (game.veil) {
        game = apply(game, { type: 'ready' })
        continue
      }
      if (game.pending) {
        const mode = brains[game.pending.actor] ?? 'full'
        const ids = pendingIds(game, mode)
        game = apply(game, { type: 'choose', ids })
        continue
      }
      const actor = game.active
      const mode = brains[actor] ?? 'full'
      const before = game
      const action = chooseAiAction(game, mode)
      if (traceNeuralSeat === actor && mode === 'neural') {
        const alts = listNeuralCandidates(before, actor)
          .filter((other) => JSON.stringify(other) !== JSON.stringify(action))
          .slice(0, 5)
          .map((other) => encodeActionFeatures(before, actor, other))
        steps.push({
          actor,
          stateFeats: encodeStateFeatures(before, actor),
          actionFeats: encodeActionFeatures(before, actor, action),
          alts,
        })
      }
      game = apply(game, action)
    } catch {
      break
    }
  }
  if (!game.over) game = softFinish(game)
  const scores = game.over!.scores.slice()
  const best = Math.max(...scores)
  const winners = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0)
  return { scores, winner: winners.length === 1 ? winners[0]! : null, steps }
}

function imitateChallenge(model: NnModel, games: number, seed0: number): number {
  setActiveModel(model)
  let samples = 0
  for (let g = 0; g < games; g += 1) {
    let game = createGame({ seed: seed0 + g, seats: aiRoster(2, undefined, seed0 + g) })
    let guard = 0
    while (!game.over && guard < 900) {
      guard += 1
      try {
        if (game.veil) {
          game = apply(game, { type: 'ready' })
          continue
        }
        if (game.pending) {
          game = apply(game, { type: 'choose', ids: chooseAiPendingChallenge(game) })
          continue
        }
        const actor = game.active
        const before = game
        const teacher = chooseAiAction(game, 'challenge')
        const stateFeats = encodeStateFeatures(before, actor)
        const teacherFeats = encodeActionFeatures(before, actor, teacher)
        const alts = listNeuralCandidates(before, actor)
        for (const other of alts) {
          if (JSON.stringify(other) === JSON.stringify(teacher)) continue
          trainPair(model, stateFeats, teacherFeats, encodeActionFeatures(before, actor, other), LR)
          samples += 1
        }
        // Value nudge: after teacher move, V(after) should exceed V(before).
        const after = apply({ ...before, autoAll: true }, teacher)
        const endFeats = encodeActionFeatures(before, actor, { type: 'end' })
        const afterFeats = encodeStateFeatures(after, actor)
        const beforeEnd = encodeActionFeatures(before, actor, { type: 'end' })
        // Prefer scoring `end` in the better after-state over a dummy draw prior in the before-state.
        trainPair(model, afterFeats, endFeats, encodeActionFeatures(before, actor, { type: 'draw' }), LR)
        trainPair(model, stateFeats, beforeEnd, encodeActionFeatures(before, actor, { type: 'draw' }), LR * 0.25)
        game = apply(game, teacher)
      } catch {
        break
      }
    }
  }
  setActiveModel(model)
  return samples
}

function reinforceTrace(model: NnModel, steps: TraceStep[], won: boolean) {
  const lr = won ? LR * 1.4 : LR * 0.9
  for (const step of steps) {
    for (const alt of step.alts) {
      if (won) trainPair(model, step.stateFeats, step.actionFeats, alt, lr)
      else trainPair(model, step.stateFeats, alt, step.actionFeats, lr)
    }
  }
}

function duelNeuralVs(
  model: NnModel,
  foe: AiSearchMode,
  games: number,
  seed0: number,
): { winRate: number; wins: number; losses: number; draws: number; samples: number } {
  setActiveModel(model)
  let wins = 0
  let losses = 0
  let draws = 0
  let samples = 0
  for (let g = 0; g < games; g += 1) {
    const neuralSeat = g % 2
    const brains: [AiSearchMode, AiSearchMode] =
      neuralSeat === 0 ? ['neural', foe] : [foe, 'neural']
    const result = playMatch(seed0 + g, brains, ['balanced', 'spite'], neuralSeat)
    if (result.winner === neuralSeat) {
      wins += 1
      reinforceTrace(model, result.steps, true)
      samples += result.steps.length
    } else if (result.winner === null) {
      draws += 1
    } else {
      losses += 1
      reinforceTrace(model, result.steps, false)
      samples += result.steps.length
      // Also imitate Challenge on a fresh copy of opening? skip — duel already teaches.
    }
  }
  setActiveModel(model)
  const decided = wins + losses
  return {
    winRate: decided === 0 ? 0.5 : wins / decided,
    wins,
    losses,
    draws,
    samples,
  }
}

function evalVs(model: NnModel, foe: AiSearchMode, games: number, seed0: number): number {
  setActiveModel(model)
  let wins = 0
  let losses = 0
  for (let g = 0; g < games; g += 1) {
    const neuralSeat = g % 2
    const brains: [AiSearchMode, AiSearchMode] =
      neuralSeat === 0 ? ['neural', foe] : [foe, 'neural']
    const result = playMatch(seed0 + g, brains, ['balanced', 'tempo'], null)
    if (result.winner === neuralSeat) wins += 1
    else if (result.winner !== null) losses += 1
  }
  const decided = wins + losses
  return decided === 0 ? 0.5 : wins / decided
}

function cloneModel(model: NnModel): NnModel {
  return hydrateModel({
    ...model,
    w1: model.w1.slice(),
    b1: model.b1.slice(),
    w2: model.w2.slice(),
    b2: model.b2.slice(),
  })
}

console.log(JSON.stringify({
  target: TARGET,
  evalGames: EVAL_GAMES,
  imitateGames: IMITATE_GAMES,
  duelGames: DUEL_GAMES,
  maxRounds: MAX_ROUNDS,
}, null, 2))

let model = loadModelFile(outPath)
if (!model.w1.length) model = randomModel(48, 7)
setActiveModel(model)

let bestRate = -1
let bestModel = cloneModel(model)
if (existsSync(bestPath)) {
  const priorBest = loadModelFile(bestPath)
  const priorRate = evalVs(priorBest, 'challenge', Math.min(24, EVAL_GAMES), 900_000)
  bestRate = priorRate
  bestModel = priorBest
  console.log(`Loaded best checkpoint challengeWR=${priorRate.toFixed(3)}`)
}

for (let round = 1; round <= MAX_ROUNDS; round += 1) {
  const t0 = Date.now()
  const imitateSamples = imitateChallenge(model, IMITATE_GAMES, 100_000 + round * 10_000)
  const duelCh = duelNeuralVs(model, 'challenge', DUEL_GAMES, 200_000 + round * 10_000)
  const duelFull = duelNeuralVs(model, 'full', Math.max(16, Math.floor(DUEL_GAMES / 2)), 300_000 + round * 10_000)
  const duelFast = duelNeuralVs(model, 'fast', Math.max(12, Math.floor(DUEL_GAMES / 3)), 400_000 + round * 10_000)

  const wrChallenge = evalVs(model, 'challenge', EVAL_GAMES, 500_000 + round * 10_000)
  const wrFull = evalVs(model, 'full', EVAL_GAMES, 600_000 + round * 10_000)
  const wrFast = evalVs(model, 'fast', Math.max(24, Math.floor(EVAL_GAMES / 2)), 700_000 + round * 10_000)

  model.trainedGames += IMITATE_GAMES + DUEL_GAMES
  model.trainedSamples += imitateSamples + duelCh.samples + duelFull.samples + duelFast.samples
  model.note = `hillclimb r${round}; chWR=${wrChallenge.toFixed(3)} fullWR=${wrFull.toFixed(3)} fastWR=${wrFast.toFixed(3)}; ${new Date().toISOString()}`
  saveModel(model, outPath)
  setActiveModel(model)

  const minWr = Math.min(wrChallenge, wrFull, wrFast)
  const row = {
    round,
    sec: +((Date.now() - t0) / 1000).toFixed(1),
    wrChallenge: +wrChallenge.toFixed(3),
    wrFull: +wrFull.toFixed(3),
    wrFast: +wrFast.toFixed(3),
    duelCh: +duelCh.winRate.toFixed(3),
    imitateSamples,
    trainedGames: model.trainedGames,
    trainedSamples: model.trainedSamples,
  }
  console.log(JSON.stringify(row))
  appendLog(row)

  if (minWr > bestRate) {
    bestRate = minWr
    bestModel = cloneModel(model)
    saveModel(bestModel, bestPath)
    copyFileSync(bestPath, outPath)
    console.log(`  ★ new best minWR=${bestRate.toFixed(3)} saved`)
  }

  if (wrChallenge >= TARGET && wrFull >= TARGET && wrFast >= TARGET) {
    console.log(`TARGET REACHED — neural beats all brains at ≥${TARGET}`)
    saveModel(model, outPath)
    saveModel(model, bestPath)
    process.exit(0)
  }
}

console.log(`Stopped after ${MAX_ROUNDS} rounds. bestMinWR=${bestRate.toFixed(3)} (target ${TARGET})`)
saveModel(bestModel, outPath)
saveModel(bestModel, bestPath)
setActiveModel(bestModel)
const finalCh = evalVs(bestModel, 'challenge', EVAL_GAMES, 800_000)
const finalFull = evalVs(bestModel, 'full', EVAL_GAMES, 810_000)
const finalFast = evalVs(bestModel, 'fast', EVAL_GAMES, 820_000)
console.log(JSON.stringify({ finalCh, finalFull, finalFast, bestMinWR: bestRate }, null, 2))
process.exit(finalCh >= TARGET && finalFull >= TARGET && finalFast >= TARGET ? 0 : 1)
