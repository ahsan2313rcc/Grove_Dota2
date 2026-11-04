/**
 * Merge shard JSON from ev-baseline-sim into ancient-on / ancient-off summaries.
 *
 *   npx tsx scripts/ev-merge-shards.mts [--dir /path/to/ev-baselines]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EvCalibration } from '../src/game/evModel.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const DIR = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]!
  : process.env.EV_OUT ?? join(__dir, '../sim-results/ev-baselines')
const MIRROR = join(__dir, '../sim-results/ev-baselines')

type Shard = {
  meta: {
    matchesRun: number
    finished: number
    seats: number
    ancient: boolean
    elapsedMs: number
  }
  calibration: EvCalibration
  rates: Record<string, number>
  byStrat: { strat: string; wins: number; finishes: number; winRate: number; avgScore: number }[]
  topHeroes: Row[]
  topAbilities: Row[]
  topLoot: Row[]
}

type Row = {
  key: string
  defId: string
  name: string
  plays: number
  avgRel: number
  avgSelf: number
  avgPressure: number
  avgDestroy: number
  avgDiscard: number
  avgExile: number
  avgSteal: number
}

function mergeRows(rows: Row[][]): Row[] {
  const map = new Map<string, Row & { rel: number; self: number; pressure: number; destroy: number; discard: number; exile: number; steal: number }>()
  for (const list of rows) {
    for (const row of list) {
      const cur = map.get(row.key) ?? {
        ...row,
        plays: 0,
        rel: 0,
        self: 0,
        pressure: 0,
        destroy: 0,
        discard: 0,
        exile: 0,
        steal: 0,
        avgRel: 0,
        avgSelf: 0,
        avgPressure: 0,
        avgDestroy: 0,
        avgDiscard: 0,
        avgExile: 0,
        avgSteal: 0,
      }
      cur.plays += row.plays
      cur.rel += row.avgRel * row.plays
      cur.self += row.avgSelf * row.plays
      cur.pressure += row.avgPressure * row.plays
      cur.destroy += row.avgDestroy * row.plays
      cur.discard += row.avgDiscard * row.plays
      cur.exile += row.avgExile * row.plays
      cur.steal += row.avgSteal * row.plays
      map.set(row.key, cur)
    }
  }
  return [...map.values()]
    .map((row) => ({
      key: row.key,
      defId: row.defId,
      name: row.name,
      plays: row.plays,
      avgRel: round4(row.rel / row.plays),
      avgSelf: round4(row.self / row.plays),
      avgPressure: round4(row.pressure / row.plays),
      avgDestroy: round4(row.destroy / row.plays),
      avgDiscard: round4(row.discard / row.plays),
      avgExile: round4(row.exile / row.plays),
      avgSteal: round4(row.steal / row.plays),
    }))
    .sort((a, b) => b.avgRel - a.avgRel || b.plays - a.plays)
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function mergeSide(ancient: boolean) {
  const files = readdirSync(DIR).filter((name) =>
    name.startsWith(`shard-ancient-${ancient ? 'on' : 'off'}-`) && name.endsWith('.json'),
  )
  if (files.length === 0) throw new Error(`No shards for ancient=${ancient} in ${DIR}`)
  const shards: Shard[] = files.map((name) => JSON.parse(readFileSync(join(DIR, name), 'utf8')))
  const finished = shards.reduce((sum, s) => sum + s.meta.finished, 0)
  const matchesRun = shards.reduce((sum, s) => sum + s.meta.matchesRun, 0)
  const elapsedMs = Math.max(...shards.map((s) => s.meta.elapsedMs))

  const weightCal = (key: keyof EvCalibration) => {
    let num = 0
    let den = 0
    for (const s of shards) {
      const w = s.meta.finished
      num += Number(s.calibration[key]) * w
      den += w
    }
    return den ? round4(num / den) : 0
  }

  const ratesKeys = Object.keys(shards[0]!.rates)
  const rates: Record<string, number> = {}
  for (const key of ratesKeys) {
    if (key === 'actionsSpent' || key === 'destroy' || key === 'discard' || key === 'exile' || key === 'steal' || key === 'bounce') {
      rates[key] = shards.reduce((sum, s) => sum + Number(s.rates[key] ?? 0), 0)
    } else if (key === 'pointsScored') {
      rates[key] = round4(shards.reduce((sum, s) => sum + Number(s.rates[key] ?? 0), 0))
    } else {
      let num = 0
      let den = 0
      for (const s of shards) {
        num += Number(s.rates[key] ?? 0) * s.meta.finished
        den += s.meta.finished
      }
      rates[key] = den ? round4(num / den) : 0
    }
  }

  const stratMap = new Map<string, { wins: number; finishes: number; score: number }>()
  for (const s of shards) {
    for (const row of s.byStrat) {
      const cur = stratMap.get(row.strat) ?? { wins: 0, finishes: 0, score: 0 }
      cur.wins += row.wins
      cur.finishes += row.finishes
      cur.score += row.avgScore * row.finishes
      stratMap.set(row.strat, cur)
    }
  }

  const calibration: EvCalibration = {
    alpha: weightCal('alpha'),
    beta: weightCal('beta'),
    meanVBody: weightCal('meanVBody'),
    meanVAbility: weightCal('meanVAbility'),
    meanCombo: weightCal('meanCombo'),
    matches: finished,
    ancient,
    seats: shards[0]!.meta.seats,
    generatedAt: new Date().toISOString(),
  }

  return {
    meta: {
      matchesRun,
      finished,
      seats: shards[0]!.meta.seats,
      ancient,
      shards: files.length,
      elapsedMs,
      sourceFiles: files,
    },
    calibration,
    rates,
    byStrat: [...stratMap.entries()].map(([strat, row]) => ({
      strat,
      wins: row.wins,
      finishes: row.finishes,
      winRate: row.finishes ? round4(row.wins / row.finishes) : 0,
      avgScore: row.finishes ? round4(row.score / row.finishes) : 0,
    })),
    topHeroes: mergeRows(shards.map((s) => s.topHeroes)).slice(0, 40),
    topAbilities: mergeRows(shards.map((s) => s.topAbilities)).slice(0, 40),
    topLoot: mergeRows(shards.map((s) => s.topLoot)).slice(0, 40),
  }
}

const on = mergeSide(true)
const off = mergeSide(false)
const combined = {
  note: 'EV baselines from 4-seat AI sims (balanced/tempo/architect/spite). Calibration feeds evModel.ts multipliers.',
  ancientOn: on,
  ancientOff: off,
  comparison: {
    alphaDelta: round4(on.calibration.alpha - off.calibration.alpha),
    meanVBodyDelta: round4(on.calibration.meanVBody - off.calibration.meanVBody),
    meanVAbilityDelta: round4(on.calibration.meanVAbility - off.calibration.meanVAbility),
    avgTurnsDelta: round4(on.rates.avgTurns - off.rates.avgTurns),
    avgWinnerDelta: round4(on.rates.avgWinner - off.rates.avgWinner),
  },
}

mkdirSync(DIR, { recursive: true })
mkdirSync(MIRROR, { recursive: true })
const out = join(DIR, 'summary.json')
writeFileSync(out, JSON.stringify(combined, null, 2))
writeFileSync(join(DIR, 'calibration-ancient-on.json'), JSON.stringify(on.calibration, null, 2))
writeFileSync(join(DIR, 'calibration-ancient-off.json'), JSON.stringify(off.calibration, null, 2))
copyFileSync(out, join(MIRROR, 'summary.json'))
copyFileSync(join(DIR, 'calibration-ancient-on.json'), join(MIRROR, 'calibration-ancient-on.json'))
copyFileSync(join(DIR, 'calibration-ancient-off.json'), join(MIRROR, 'calibration-ancient-off.json'))
console.log('wrote', out)
console.log('ancient ON', on.calibration)
console.log('ancient OFF', off.calibration)
