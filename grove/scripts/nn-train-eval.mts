/**
 * Train Neural via outcome RL, then evaluate vs heuristic seat strats (2p).
 *
 *   npx tsx scripts/nn-train-eval.mts
 *   npx tsx scripts/nn-train-eval.mts --train 1000 --eval 40 --power 5
 *   npx tsx scripts/nn-train-eval.mts --skip-train   # eval only, use saved weights
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chooseAiAction, chooseAiPending, searchModeForStrat } from '../src/game/ai.ts'
import { chooseAiPendingChallenge } from '../src/game/aiChallenge.ts'
import { setAiThoughtPower } from '../src/game/aiPower.ts'
import { getNnMemory, replaceNnMemory } from '../src/game/nnMemory.ts'
import { runMatchWithOptionalTrain } from '../src/game/nnTrainOnline.ts'
import {
  chooseAiActionNeural,
  chooseAiPendingNeural,
  hydrateModel,
  randomModel,
  setActiveModel,
  type NnModel,
} from '../src/game/nnValue.ts'
import { apply, createGame } from '../src/game/engine.ts'
import { scoreState } from '../src/game/flow.ts'
import type { Action, AiStrat, Game } from '../src/game/types.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dir, '../src/game/data')
const outPath = join(dataDir, 'nn-value.json')
const reportPath = join(dataDir, 'nn-train-eval-report.json')

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1]! : fallback
}

const TRAIN_GAMES = Number(arg('--train', '1000'))
const EVAL_GAMES = Number(arg('--eval', '40'))
const POWER = Number(arg('--power', '5'))
const SKIP_TRAIN = process.argv.includes('--skip-train')
const FOES: AiStrat[] = ['balanced', 'tempo', 'architect', 'spite']

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

function pendingIds(game: Game, mode: ReturnType<typeof searchModeForStrat>): string[] {
  if (mode === 'neural') return chooseAiPendingNeural(game)
  if (mode === 'challenge') return chooseAiPendingChallenge(game)
  return chooseAiPending(game)
}

function playDuel(seed: number, neuralSeat: 0 | 1, foe: AiStrat): {
  winner: number | null
  scores: number[]
  turns: number
  reason: string
} {
  const strats: [AiStrat, AiStrat] =
    neuralSeat === 0 ? ['neural', foe] : [foe, 'neural']
  let game = createGame({
    seed,
    seats: [
      { name: 'A', ai: true, strat: strats[0] },
      { name: 'B', ai: true, strat: strats[1] },
    ],
  })
  let guard = 0
  let stall = 0
  let lastMark = `${game.turn}|${game.active}|${game.deck.length}|${game.log.at(-1)}`
  while (!game.over && guard < 1400) {
    guard += 1
    const beforeMark = lastMark
    try {
      if (game.veil) {
        game = apply(game, { type: 'ready' })
      } else if (game.pending) {
        const mode = searchModeForStrat(game.players[game.pending.actor]?.strat ?? 'balanced')
        const ids = pendingIds(game, mode)
        const before = game
        game = apply(game, { type: 'choose', ids })
        if (game.pending && game.pending.prompt === before.pending?.prompt && stall >= 2) {
          game = { ...game, pending: null, log: [...game.log, 'Forced past a stuck choice.'] }
        }
      } else {
        const actor = game.active
        const strat = game.players[actor]?.strat ?? 'balanced'
        const mode = searchModeForStrat(strat)
        let action: Action =
          mode === 'neural'
            ? chooseAiActionNeural(game, actor, strat)
            : chooseAiAction(game, mode)
        if (stall >= 4 && game.players[actor]?.actions) {
          const hand = game.players[actor]!.hand
          const pitch = hand.find((c) => c.kind === 'terrain') ?? hand[0]
          if (pitch) action = { type: 'discard', uid: pitch.uid }
        } else if (stall >= 6) {
          action = { type: 'end' }
        }
        game = apply(game, action)
      }
    } catch {
      break
    }
    const mark = `${game.turn}|${game.active}|${game.deck.length}|${game.log.at(-1)}`
    if (mark === beforeMark) stall += 1
    else stall = 0
    lastMark = mark
    if (stall >= 12) break
  }
  if (!game.over) game = softFinish(game)
  const scores = game.over!.scores.slice()
  const best = Math.max(...scores)
  const winners = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0)
  return {
    winner: winners.length === 1 ? winners[0]! : null,
    scores,
    turns: game.turn,
    reason: game.over!.reason,
  }
}

function evalVs(foe: AiStrat, games: number, seed0: number) {
  let wins = 0
  let losses = 0
  let draws = 0
  const turns: number[] = []
  for (let g = 0; g < games; g += 1) {
    const neuralSeat = (g % 2) as 0 | 1
    const result = playDuel(seed0 + g, neuralSeat, foe)
    turns.push(result.turns)
    if (result.winner === neuralSeat) wins += 1
    else if (result.winner === null) draws += 1
    else losses += 1
    if ((g + 1) % 10 === 0 || g + 1 === games) {
      const decided = wins + losses
      const wr = decided === 0 ? 0.5 : wins / decided
      console.log(JSON.stringify({
        foe,
        done: g + 1,
        wins,
        losses,
        draws,
        winRate: +wr.toFixed(3),
      }))
    }
  }
  const decided = wins + losses
  return {
    foe,
    games,
    wins,
    losses,
    draws,
    winRate: decided === 0 ? 0.5 : wins / decided,
    avgTurns: turns.reduce((a, b) => a + b, 0) / Math.max(1, turns.length),
  }
}

function saveModel(model: NnModel) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(outPath, JSON.stringify(model))
}

function loadModel(): NnModel {
  if (!existsSync(outPath)) return randomModel(48, 7)
  try {
    return hydrateModel(JSON.parse(readFileSync(outPath, 'utf8')) as NnModel)
  } catch {
    return randomModel(48, 7)
  }
}

setAiThoughtPower(POWER)
console.log(JSON.stringify({ TRAIN_GAMES, EVAL_GAMES, POWER, SKIP_TRAIN, FOES }, null, 2))

let model: NnModel
if (SKIP_TRAIN) {
  model = loadModel()
  setActiveModel(model)
  console.log(JSON.stringify({
    phase: 'skip-train',
    trainedGames: model.trainedGames,
    trainedSamples: model.trainedSamples,
    note: model.note,
  }))
} else {
  // Fresh outcome-RL self-play.
  model = randomModel(48, 11)
  model.note = 'fresh-before-train'
  replaceNnMemory(model)

  const t0 = Date.now()
  let samples = 0
  for (let g = 0; g < TRAIN_GAMES; g += 1) {
    const seats = [
      { name: 'NeuralA', ai: true, strat: 'neural' as const },
      { name: 'NeuralB', ai: true, strat: 'neural' as const },
    ]
    const { samples: n, game } = runMatchWithOptionalTrain(100_000 + g, seats, true)
    samples += n
    if ((g + 1) % 25 === 0 || g === 0 || g + 1 === TRAIN_GAMES) {
      const mem = getNnMemory()
      setActiveModel(mem)
      console.log(JSON.stringify({
        phase: 'train',
        game: g + 1,
        of: TRAIN_GAMES,
        samples,
        trainedGames: mem.trainedGames,
        trainedSamples: mem.trainedSamples,
        lastScores: game.over?.scores,
        sec: +((Date.now() - t0) / 1000).toFixed(1),
      }))
    }
  }
  model = getNnMemory()
  model.note = `outcome-RL train-eval; games=${TRAIN_GAMES}; ${new Date().toISOString()}`
  setActiveModel(model)
  saveModel(model)
  console.log(JSON.stringify({
    phase: 'train-done',
    sec: +((Date.now() - t0) / 1000).toFixed(1),
    trainedGames: model.trainedGames,
    trainedSamples: model.trainedSamples,
    saved: outPath,
  }))
}

const evalStart = Date.now()
const results = []
for (const foe of FOES) {
  console.log(`\n=== eval vs ${foe} ===`)
  results.push(evalVs(foe, EVAL_GAMES, 700_000 + FOES.indexOf(foe) * 10_000))
}

const summary = {
  trainedGames: model.trainedGames,
  trainedSamples: model.trainedSamples,
  thoughtPower: POWER,
  evalGamesPerFoe: EVAL_GAMES,
  results,
  overall: (() => {
    const wins = results.reduce((s, r) => s + r.wins, 0)
    const losses = results.reduce((s, r) => s + r.losses, 0)
    const draws = results.reduce((s, r) => s + r.draws, 0)
    const decided = wins + losses
    return {
      wins,
      losses,
      draws,
      winRate: decided === 0 ? 0.5 : wins / decided,
    }
  })(),
  evalSec: +((Date.now() - evalStart) / 1000).toFixed(1),
  at: new Date().toISOString(),
}

writeFileSync(reportPath, JSON.stringify(summary, null, 2))
console.log('\n=== SUMMARY ===')
console.log(JSON.stringify(summary, null, 2))
