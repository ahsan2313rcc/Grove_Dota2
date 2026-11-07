/**
 * Train the Neural value net on AI-vs-AI games, then measure it against the heuristic strats.
 *
 *   npx tsx scripts/nn-train.mts --games 2000 --eval 20 --power 5
 *   npx tsx scripts/nn-train.mts --eval-only --eval 30
 *   npx tsx scripts/nn-train.mts --fresh --games 500      # start from the heuristic prior
 *   npx tsx scripts/nn-train.mts --eval-only --foes tempo,spite --no-report
 *
 * Training games rotate rosters (Neural vs each heuristic, heuristic vs heuristic, 2–4 seats)
 * using the batch-fast brains; every seat's decisions are learned from. Evaluation is 2-player,
 * full search on both sides, seat order alternated. Writes src/game/data/nn-value.json and
 * src/game/data/nn-train-report.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setAiThoughtPower } from '../src/game/aiPower.ts'
import { getNnMemory, replaceNnMemory, roundModel } from '../src/game/nnMemory.ts'
import { runMatchWithOptionalTrain } from '../src/game/nnTrainOnline.ts'
import { hydrateModel, randomModel } from '../src/game/nnValue.ts'
import type { SeatSpec } from '../src/game/engine.ts'
import type { AiStrat } from '../src/game/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '../src/game/data')
const modelPath = join(dataDir, 'nn-value.json')
const reportPath = join(dataDir, 'nn-train-report.json')

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(name)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback
}
const flag = (name: string) => process.argv.includes(name)

const GAMES = Number(arg('--games', '1000'))
const EVAL = Number(arg('--eval', '20'))
const POWER = Number(arg('--power', '5'))
const EVAL_EVERY = Number(arg('--eval-every', '0'))
const SEED0 = Number(arg('--seed', '100000'))
const HEURISTICS: AiStrat[] = ['balanced', 'tempo', 'architect', 'spite']
const EVAL_FOES = arg('--foes', HEURISTICS.join(',')).split(',') as AiStrat[]

if (flag('--fresh')) replaceNnMemory(randomModel(48, 7))
else replaceNnMemory(hydrateModel(JSON.parse(readFileSync(modelPath, 'utf8'))))

function seat(strat: AiStrat, index: number): SeatSpec {
  return { name: `${strat}-${index}`, ai: true, strat }
}

function rosterFor(game: number): SeatSpec[] {
  const foe = HEURISTICS[game % HEURISTICS.length]!
  const other = HEURISTICS[(game >> 2) % HEURISTICS.length]!
  switch (game % 5) {
    case 0:
    case 1:
      return game % 2 ? [seat('neural', 0), seat(foe, 1)] : [seat(foe, 0), seat('neural', 1)]
    case 2:
      return [seat(foe, 0), seat(other, 1)]
    case 3:
      return [seat('neural', 0), seat(foe, 1), seat(other, 2)]
    default:
      return [seat(other, 0), seat('neural', 1), seat(foe, 2), seat('neural', 3)]
  }
}

type EvalRow = { foe: AiStrat; games: number; wins: number; losses: number; draws: number; winRate: number; avgMargin: number }

function evaluate(games: number): { rows: EvalRow[]; overall: number } {
  setAiThoughtPower(POWER)
  const rows: EvalRow[] = []
  let wins = 0
  let total = 0
  for (const foe of EVAL_FOES) {
    const row: EvalRow = { foe, games: 0, wins: 0, losses: 0, draws: 0, winRate: 0, avgMargin: 0 }
    for (let g = 0; g < games; g += 1) {
      const neuralSeat = g % 2
      const seats = neuralSeat === 0 ? [seat('neural', 0), seat(foe, 1)] : [seat(foe, 0), seat('neural', 1)]
      const { game } = runMatchWithOptionalTrain(9_000_000 + g * 7, seats, false)
      const scores = game.over?.scores ?? [0, 0]
      const margin = scores[neuralSeat]! - scores[1 - neuralSeat]!
      row.games += 1
      row.avgMargin += margin
      if (margin > 0) row.wins += 1
      else if (margin < 0) row.losses += 1
      else row.draws += 1
    }
    row.avgMargin /= Math.max(1, row.games)
    row.winRate = (row.wins + row.draws / 2) / Math.max(1, row.games)
    wins += row.wins + row.draws / 2
    total += row.games
    rows.push(row)
    console.log(`  vs ${foe.padEnd(9)} ${row.wins}-${row.losses}-${row.draws}  win ${(row.winRate * 100).toFixed(0)}%  margin ${row.avgMargin.toFixed(1)}`)
  }
  return { rows, overall: wins / Math.max(1, total) }
}

function save() {
  writeFileSync(modelPath, JSON.stringify(roundModel(getNnMemory())))
}

const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  power: POWER,
  evalGamesPerFoe: EVAL,
  startGames: getNnMemory().trainedGames,
  curve: [] as unknown[],
}
const curve = report.curve as unknown[]

if (!flag('--eval-only')) {
  const t0 = performance.now()
  for (let g = 0; g < GAMES; g += 1) {
    const { samples } = runMatchWithOptionalTrain(SEED0 + getNnMemory().trainedGames, rosterFor(getNnMemory().trainedGames), { train: true, fast: true })
    if ((g + 1) % 50 === 0) {
      const m = getNnMemory()
      console.log(`train ${g + 1}/${GAMES}  total ${m.trainedGames}  loss ${m.recentLoss.toFixed(4)}  last ${samples} samples  ${((performance.now() - t0) / (g + 1)).toFixed(0)} ms/game`)
      save()
    }
    if (EVAL_EVERY > 0 && (g + 1) % EVAL_EVERY === 0) {
      console.log(`eval @ ${getNnMemory().trainedGames} games`)
      const result = evaluate(Math.max(4, Math.floor(EVAL / 2)))
      curve.push({ games: getNnMemory().trainedGames, overall: result.overall, rows: result.rows })
    }
  }
  save()
}

console.log(`final eval @ ${getNnMemory().trainedGames} games, power ${POWER}, ${EVAL} games per foe`)
const final = evaluate(EVAL)
report.trainedGames = getNnMemory().trainedGames
report.trainedSamples = getNnMemory().trainedSamples
report.recentLoss = getNnMemory().recentLoss
report.final = final
report.finishedAt = new Date().toISOString()
console.log(`overall Neural win ${(final.overall * 100).toFixed(1)}%`)
if (!flag('--no-report')) writeFileSync(reportPath, JSON.stringify(report, null, 2))
