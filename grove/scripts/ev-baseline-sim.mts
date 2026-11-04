/**
 * Batch AI sims → EV calibration baselines.
 *
 * Usage:
 *   npx tsx scripts/ev-baseline-sim.mts --matches 1024 --seats 4 --ancient true --shard 0 --shards 4
 *   npx tsx scripts/ev-baseline-sim.mts --matches 1024 --seats 4 --ancient false --shard 0 --shards 4
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AI_STRATS, chooseAiAction, chooseAiPending } from '../src/game/ai.ts'
import { BalanceTracker, summarizeReports, type MatchReport } from '../src/game/balance.ts'
import { apply, createGame } from '../src/game/engine.ts'
import { scoreState } from '../src/game/flow.ts'
import { getScoreRules, setScoreRules } from '../src/game/scoring.ts'
import type { AiStrat, Game } from '../src/game/types.ts'
import type { EvCalibration } from '../src/game/evModel.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = process.env.EV_OUT ?? join(__dir, '../sim-results/ev-baselines')

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!
  return fallback
}

const MATCHES = Math.max(1, Number(arg('matches', '1024')) || 1024)
const SEATS = Math.max(2, Math.min(8, Number(arg('seats', '4')) || 4))
const ANCIENT = arg('ancient', 'true') !== 'false'
const SHARD = Math.max(0, Number(arg('shard', '0')) || 0)
const SHARDS = Math.max(1, Number(arg('shards', '1')) || 1)
const STRATS: AiStrat[] = AI_STRATS.map((entry) => entry.id)

function roster(seed: number) {
  return Array.from({ length: SEATS }, (_, index) => {
    const strat = STRATS[index % STRATS.length]!
    return { name: `${strat} ${index + 1}`, ai: true as const, strat }
  })
}

function matchMark(game: Game): string {
  return [
    game.turn,
    game.active,
    game.deck.length,
    game.grave.length,
    game.pending?.resume.kind ?? '-',
    game.players.map((p) => `${p.actions}:${p.hand.length}:${p.teams.length}`).join('|'),
  ].join('/')
}

function pendingKey(pending: Game['pending']): string {
  if (!pending) return ''
  return `${pending.actor}|${pending.resume.kind}|${pending.prompt}|${pending.choices.length}`
}

function runOne(seed: number): MatchReport {
  let game = createGame({
    seed,
    seats: roster(seed),
    ancientEndgame: ANCIENT,
  })
  const tracker = new BalanceTracker(seed)
  tracker.start(game)
  let steps = 0
  let noProgress = 0
  let endsWithoutDeckDrop = 0
  let lastDeck = game.deck.length
  let lastMark = matchMark(game)
  const guard = 2500
  while (!game.over && steps < guard) {
    steps += 1
    try {
      if (game.veil) {
        const before = game
        game = apply(game, { type: 'ready' })
        tracker.observe(before, { type: 'ready' }, game)
      } else if (game.pending) {
        const before = game
        const ids = chooseAiPending(game)
        game = apply(game, { type: 'choose', ids })
        tracker.observe(before, { type: 'choose', ids }, game)
        if (game.pending && pendingKey(game.pending) === pendingKey(before.pending)) {
          game = { ...game, pending: null, log: [...game.log, 'Forced past a stuck choice.'] }
        }
      } else {
        const action = chooseAiAction(game)
        const before = game
        game = apply(game, action)
        tracker.observe(before, action, game)
        if (action.type === 'end') {
          if (game.deck.length === lastDeck) endsWithoutDeckDrop += 1
          else endsWithoutDeckDrop = 0
          if (endsWithoutDeckDrop >= 12) {
            const parts = game.players.map((player) => scoreState(game, player.id))
            game = {
              ...game,
              over: { reason: 'Stalemate escape.', scores: parts.map((p) => p.total), parts },
              pending: null,
              veil: false,
              queue: [],
            }
          }
        }
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : 'sim error'
      const parts = game.players.map((player) => scoreState(game, player.id))
      game = {
        ...game,
        over: { reason: text, scores: parts.map((p) => p.total), parts },
        pending: null,
      }
    }
    const mark = matchMark(game)
    if (mark === lastMark) noProgress += 1
    else noProgress = 0
    lastMark = mark
    lastDeck = game.deck.length
    if (noProgress >= 40) {
      const parts = game.players.map((player) => scoreState(game, player.id))
      game = {
        ...game,
        over: { reason: 'No-progress escape.', scores: parts.map((p) => p.total), parts },
        pending: null,
      }
    }
  }
  if (!game.over) {
    const parts = game.players.map((player) => scoreState(game, player.id))
    game = {
      ...game,
      over: { reason: 'Guard escape.', scores: parts.map((p) => p.total), parts },
      pending: null,
    }
  }
  return tracker.finish(game)
}

type ShardAgg = {
  matches: number
  finished: number
  actionsSpent: number
  pointsScored: number
  heroBodyRel: number
  heroBodyPlays: number
  abilityRel: number
  abilityPlays: number
  destroy: number
  discard: number
  exile: number
  steal: number
  bounce: number
  pressure: number
  pressurePlays: number
  comboPts: number
  comboCount: number
  winnerScores: number
  spreads: number
  turns: number
  byDef: Record<string, { name: string; kind: string; plays: number; rel: number; self: number; pressure: number; destroy: number; discard: number; exile: number; control: number }>
  byStrat: Record<string, { seats: number; wins: number; finishes: number; score: number }>
}

function emptyAgg(): ShardAgg {
  return {
    matches: 0,
    finished: 0,
    actionsSpent: 0,
    pointsScored: 0,
    heroBodyRel: 0,
    heroBodyPlays: 0,
    abilityRel: 0,
    abilityPlays: 0,
    destroy: 0,
    discard: 0,
    exile: 0,
    steal: 0,
    bounce: 0,
    pressure: 0,
    pressurePlays: 0,
    comboPts: 0,
    comboCount: 0,
    winnerScores: 0,
    spreads: 0,
    turns: 0,
    byDef: {},
    byStrat: {},
  }
}

function absorb(agg: ShardAgg, report: MatchReport) {
  agg.matches += 1
  if (!report.over) return
  agg.finished += 1
  agg.turns += report.turns
  const scores = report.finalScores
  agg.winnerScores += Math.max(...scores)
  agg.spreads += Math.max(...scores) - Math.min(...scores)

  for (let seat = 0; seat < report.seatStrats.length; seat += 1) {
    const strat = report.seatStrats[seat]!
    const row = agg.byStrat[strat] ?? { seats: 0, wins: 0, finishes: 0, score: 0 }
    row.seats += 1
    row.finishes += 1
    row.score += scores[seat] ?? 0
    if (report.winner === seat) row.wins += 1
    agg.byStrat[strat] = row
  }

  // Approx actions from drawAction + play events + ends via rounds cards / 2 fallback.
  const events = report.events
  const spent =
    events.playHero +
    events.playItem +
    events.playRune +
    events.playNeutral +
    events.playTower +
    events.playTrap +
    events.drawAction +
    events.playTerrain
  agg.actionsSpent += spent
  // Points scored ≈ sum of positive round deltas (proxy for seat scoring rate).
  for (const round of report.rounds) {
    if (round.pointsDelta > 0) agg.pointsScored += round.pointsDelta
  }

  for (const swing of report.swings) {
    if (swing.kind === 'hero') {
      agg.heroBodyPlays += 1
      agg.heroBodyRel += swing.relativeSwing
    }
    if (swing.kind === 'ability') {
      agg.abilityPlays += 1
      agg.abilityRel += swing.relativeSwing
    }
    if (swing.kind === 'combo') {
      agg.comboCount += 1
      agg.comboPts += Math.max(0, swing.actorSwing)
    }
    agg.destroy += swing.destroy
    agg.discard += swing.discard
    agg.exile += swing.exile
    agg.steal += swing.control
    agg.bounce += swing.bounce
    if (swing.pressure > 0 || swing.destroy || swing.discard || swing.exile || swing.control || swing.bounce) {
      agg.pressure += swing.pressure
      agg.pressurePlays += 1
    }
    const key = `${swing.kind}:${swing.defId}`
    const row = agg.byDef[key] ?? {
      name: swing.name,
      kind: swing.kind,
      plays: 0,
      rel: 0,
      self: 0,
      pressure: 0,
      destroy: 0,
      discard: 0,
      exile: 0,
      control: 0,
    }
    row.plays += 1
    row.rel += swing.relativeSwing
    row.self += swing.actorSwing
    row.pressure += swing.pressure
    row.destroy += swing.destroy
    row.discard += swing.discard
    row.exile += swing.exile
    row.control += swing.control
    agg.byDef[key] = row
  }
}

function calibration(agg: ShardAgg): EvCalibration {
  const alpha = agg.actionsSpent > 0 ? agg.pointsScored / agg.actionsSpent : 2.5
  const meanVBody = agg.heroBodyPlays > 0 ? Math.abs(agg.heroBodyRel) / agg.heroBodyPlays : 2.5
  // Prefer destroy-linked pressure as body removal proxy when available.
  const destroyV = agg.destroy > 0 ? agg.pressure / Math.max(1, agg.pressurePlays) : meanVBody
  const meanVAbility = agg.abilityPlays > 0 ? Math.abs(agg.abilityRel) / agg.abilityPlays : 1.5
  const meanCombo = agg.comboCount > 0 ? agg.comboPts / agg.comboCount : 5
  const beta = alpha > 0 ? meanVBody / alpha : 1
  return {
    alpha: round4(alpha),
    beta: round4(Math.min(2.5, Math.max(0.4, beta))),
    meanVBody: round4(Math.max(meanVBody, destroyV * 0.5)),
    meanVAbility: round4(meanVAbility),
    meanCombo: round4(meanCombo),
    matches: agg.finished,
    ancient: ANCIENT,
    seats: SEATS,
    generatedAt: new Date().toISOString(),
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function topRows(agg: ShardAgg, kind: string, n = 24) {
  return Object.entries(agg.byDef)
    .filter(([, row]) => row.kind === kind && row.plays >= 4)
    .map(([key, row]) => ({
      key,
      defId: key.slice(kind.length + 1),
      name: row.name,
      plays: row.plays,
      avgRel: round4(row.rel / row.plays),
      avgSelf: round4(row.self / row.plays),
      avgPressure: round4(row.pressure / row.plays),
      avgDestroy: round4(row.destroy / row.plays),
      avgDiscard: round4(row.discard / row.plays),
      avgExile: round4(row.exile / row.plays),
      avgSteal: round4(row.control / row.plays),
    }))
    .sort((a, b) => b.avgRel - a.avgRel || b.plays - a.plays)
    .slice(0, n)
}

async function main() {
  const rules = getScoreRules()
  setScoreRules({ ...rules, ancientEndgame: ANCIENT })

  const seeds: number[] = []
  for (let i = 0; i < MATCHES; i += 1) {
    if (i % SHARDS === SHARD) seeds.push(10_000_000 + i)
  }

  const agg = emptyAgg()
  const t0 = Date.now()
  for (let i = 0; i < seeds.length; i += 1) {
    const report = runOne(seeds[i]!)
    absorb(agg, report)
    if ((i + 1) % 32 === 0 || i + 1 === seeds.length) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(
        `[ancient=${ANCIENT} shard=${SHARD}/${SHARDS}] ${i + 1}/${seeds.length} done in ${elapsed}s`,
      )
    }
  }

  const cal = calibration(agg)
  const summary = summarizeReports(
    // lightweight: rebuild from nothing — we already have custom agg; keep summary stub via empty
    [],
  )
  void summary

  const payload = {
    meta: {
      matchesRequested: MATCHES,
      matchesRun: agg.matches,
      finished: agg.finished,
      seats: SEATS,
      ancient: ANCIENT,
      shard: SHARD,
      shards: SHARDS,
      strats: STRATS,
      elapsedMs: Date.now() - t0,
    },
    calibration: cal,
    rates: {
      avgTurns: agg.finished ? round4(agg.turns / agg.finished) : 0,
      avgWinner: agg.finished ? round4(agg.winnerScores / agg.finished) : 0,
      avgSpread: agg.finished ? round4(agg.spreads / agg.finished) : 0,
      actionsSpent: agg.actionsSpent,
      pointsScored: round4(agg.pointsScored),
      destroy: agg.destroy,
      discard: agg.discard,
      exile: agg.exile,
      steal: agg.steal,
      bounce: agg.bounce,
    },
    byStrat: Object.entries(agg.byStrat).map(([strat, row]) => ({
      strat,
      wins: row.wins,
      finishes: row.finishes,
      winRate: row.finishes ? round4(row.wins / row.finishes) : 0,
      avgScore: row.finishes ? round4(row.score / row.finishes) : 0,
    })),
    topHeroes: topRows(agg, 'hero', 30),
    topAbilities: topRows(agg, 'ability', 30),
    topLoot: topRows(agg, 'item', 20).concat(topRows(agg, 'rune', 10), topRows(agg, 'neutral', 10), topRows(agg, 'tower', 10)),
  }

  mkdirSync(OUT_ROOT, { recursive: true })
  const file = join(
    OUT_ROOT,
    `shard-ancient-${ANCIENT ? 'on' : 'off'}-${SHARD}-of-${SHARDS}.json`,
  )
  writeFileSync(file, JSON.stringify(payload, null, 2))
  console.log('wrote', file)
  console.log('calibration', cal)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
