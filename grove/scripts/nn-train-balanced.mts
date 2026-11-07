/**
 * Train Neural from Balanced vs Balanced games (outcome RL on heuristic play),
 * then eval Neural vs Balanced.
 *
 *   npx tsx scripts/nn-train-balanced.mts
 *   npx tsx scripts/nn-train-balanced.mts --train 1000 --eval 100 --power 5
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
import type { Action, Game } from '../src/game/types.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dir, '../src/game/data')
const outPath = join(dataDir, 'nn-value-balanced.json')
const reportPath = join(dataDir, 'nn-train-balanced-report.json')

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1]! : fallback
}

const TRAIN_GAMES = Number(arg('--train', '775'))
const EVAL_GAMES = Number(arg('--eval', '100'))
const POWER = Number(arg('--power', '5'))
const SKIP_TRAIN = process.argv.includes('--skip-train')

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

function pendingIds(game: Game, neural: boolean): string[] {
  if (neural) return chooseAiPendingNeural(game)
  const mode = searchModeForStrat('balanced', false)
  if (mode === 'challenge') return chooseAiPendingChallenge(game)
  return chooseAiPending(game)
}

function playDuel(seed: number, neuralSeat: 0 | 1) {
  let game = createGame({
    seed,
    seats: [
      { name: 'A', ai: true, strat: neuralSeat === 0 ? 'neural' : 'balanced' },
      { name: 'B', ai: true, strat: neuralSeat === 1 ? 'neural' : 'balanced' },
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
        const neural = game.players[game.pending.actor]?.strat === 'neural'
        const before = game
        game = apply(game, { type: 'choose', ids: pendingIds(game, neural) })
        if (game.pending && game.pending.prompt === before.pending?.prompt && stall >= 2) {
          game = { ...game, pending: null, log: [...game.log, 'Forced past a stuck choice.'] }
        }
      } else {
        const actor = game.active
        const neural = game.players[actor]?.strat === 'neural'
        let action: Action = neural
          ? chooseAiActionNeural(game, actor, 'balanced')
          : chooseAiAction(game, searchModeForStrat('balanced', false))
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

function saveModel(model: NnModel) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(outPath, JSON.stringify(model))
}

function loadModel(): NnModel {
  if (!existsSync(outPath)) return randomModel(48, 23)
  try {
    return hydrateModel(JSON.parse(readFileSync(outPath, 'utf8')) as NnModel)
  } catch {
    return randomModel(48, 23)
  }
}

setAiThoughtPower(POWER)
console.log(JSON.stringify({ TRAIN_GAMES, EVAL_GAMES, POWER, SKIP_TRAIN, mode: 'balanced-vs-balanced' }, null, 2))

const t0 = Date.now()
let model: NnModel

if (SKIP_TRAIN) {
  model = loadModel()
  replaceNnMemory(model)
  console.log(JSON.stringify({
    phase: 'skip-train',
    trainedGames: model.trainedGames,
    trainedSamples: model.trainedSamples,
    note: model.note,
  }))
} else {
  const fresh = randomModel(48, 23)
  fresh.note = 'fresh-before-balanced-train'
  replaceNnMemory(fresh)

  let samples = 0
  const seats = [
    { name: 'BalancedA', ai: true, strat: 'balanced' as const },
    { name: 'BalancedB', ai: true, strat: 'balanced' as const },
  ]

  for (let g = 0; g < TRAIN_GAMES; g += 1) {
    const { samples: n, game } = runMatchWithOptionalTrain(200_000 + g, seats, {
      train: true,
      policy: 'seat',
    })
    samples += n
    if ((g + 1) % 25 === 0 || g === 0 || g + 1 === TRAIN_GAMES) {
      const mem = getNnMemory()
      // Checkpoint so a mid-run stop can still eval.
      mem.note = `outcome-RL Balanced-vs-Balanced ckpt ${g + 1}/${TRAIN_GAMES}; ${new Date().toISOString()}`
      saveModel(mem)
      console.log(JSON.stringify({
        phase: 'train',
        game: g + 1,
        of: TRAIN_GAMES,
        samples,
        trainedGames: mem.trainedGames,
        trainedSamples: mem.trainedSamples,
        lastScores: game.over?.scores,
        sec: +((Date.now() - t0) / 1000).toFixed(1),
        checkpoint: outPath,
      }))
    }
  }

  model = getNnMemory()
  model.note = `outcome-RL Balanced-vs-Balanced; games=${TRAIN_GAMES}; ${new Date().toISOString()}`
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
let wins = 0
let losses = 0
let draws = 0
const turns: number[] = []
for (let g = 0; g < EVAL_GAMES; g += 1) {
  const neuralSeat = (g % 2) as 0 | 1
  const result = playDuel(900_000 + g, neuralSeat)
  turns.push(result.turns)
  if (result.winner === neuralSeat) wins += 1
  else if (result.winner === null) draws += 1
  else losses += 1
  if ((g + 1) % 10 === 0 || g + 1 === EVAL_GAMES) {
    const decided = wins + losses
    console.log(JSON.stringify({
      phase: 'eval',
      done: g + 1,
      wins,
      losses,
      draws,
      winRate: decided === 0 ? 0.5 : +(wins / decided).toFixed(3),
    }))
  }
}

const decided = wins + losses
const summary = {
  trainMode: 'Balanced vs Balanced (outcome RL on seat policy)',
  trainedGames: model.trainedGames,
  trainedSamples: model.trainedSamples,
  thoughtPower: POWER,
  evalGames: EVAL_GAMES,
  foe: 'balanced',
  wins,
  losses,
  draws,
  neuralWinRate: decided === 0 ? 0.5 : wins / decided,
  heuristicWinRate: decided === 0 ? 0.5 : losses / decided,
  avgTurns: turns.reduce((a, b) => a + b, 0) / Math.max(1, turns.length),
  trainSec: +((Date.now() - t0) / 1000).toFixed(1),
  evalSec: +((Date.now() - evalStart) / 1000).toFixed(1),
  weights: outPath,
  at: new Date().toISOString(),
}

writeFileSync(reportPath, JSON.stringify(summary, null, 2))
console.log('\n=== SUMMARY ===')
console.log(JSON.stringify(summary, null, 2))
