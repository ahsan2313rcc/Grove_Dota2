/**
 * Win-condition sims: how long games run, when The Ancient shows up, and how a target score behaves.
 *
 *   npx tsx scripts/win-sim.mts --seats 4 --games 40 --mode target     # proposed target + depths
 *   npx tsx scripts/win-sim.mts --seats 4 --games 40 --mode none       # no target, proposed depths
 *   npx tsx scripts/win-sim.mts --seats 4 --games 40 --mode old        # no target, old depths (40-60 / 70-80 / last)
 *
 * Fast heuristic brains on every seat, strats rotated. Prints one JSON line.
 */
import { chooseAiAction, chooseAiPendingForSeat, searchModeForStrat } from '../src/game/ai.ts'
import { apply, createGame, type SeatSpec } from '../src/game/engine.ts'
import { scoreState } from '../src/game/flow.ts'
import { DEFAULT_SCORE_RULES, forSeats } from '../src/game/scoring.ts'
import type { AiStrat, Game } from '../src/game/types.ts'

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(name)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback
}

const SEATS = Number(arg('--seats', '2'))
const GAMES = Number(arg('--games', '30'))
const MODE = arg('--mode', 'target') as 'target' | 'none' | 'old'
const SEED0 = Number(arg('--seed', '50000'))
const STRATS: AiStrat[] = ['balanced', 'tempo', 'architect', 'spite']
const MILESTONES = [25, 30, 35, 40, 45, 50, 55, 60]

const oldDepth = SEATS >= 7 ? 100 : SEATS >= 5 ? 75 : 50
const depth = MODE === 'old' ? oldDepth : forSeats(DEFAULT_SCORE_RULES.ancientDepths, SEATS)
const target = MODE === 'target' ? forSeats(DEFAULT_SCORE_RULES.winScores, SEATS) : null

type Row = {
  rounds: number
  reason: 'target' | 'ancient' | 'deck' | 'halt'
  ancientRound: number | null
  winnerScore: number
  secondScore: number
  winnerSeat: number
  claims: number
  resets: number
  /** first round any seat ended a turn at >= milestone, and whether that seat won */
  first: Record<number, { round: number; won: boolean } | null>
  leaderAtRound: number[]
}

const totals = (game: Game) => game.players.map((player) => scoreState(game, player.id).total)

function play(seed: number): Row {
  const seats: SeatSpec[] = Array.from({ length: SEATS }, (_, index) => ({
    name: `s${index}`,
    ai: true,
    strat: STRATS[(index + seed) % STRATS.length]!,
  }))
  let game = createGame({ seed, seats, winScore: target, ancientDepth: depth })
  const first: Row['first'] = Object.fromEntries(MILESTONES.map((m) => [m, null]))
  const firstSeat: Record<number, number> = {}
  let ancientRound: number | null = null
  let lastTurn = game.turn
  let lastActive = game.active
  let guard = 0
  let stall = 0
  let mark = ''
  const leaderAtRound: number[] = []
  while (!game.over && guard < 20000) {
    guard += 1
    if (game.veil) {
      game = apply(game, { type: 'ready' })
      continue
    }
    if (game.pending) {
      game = apply(game, { type: 'choose', ids: chooseAiPendingForSeat(game) })
    } else {
      const strat = game.players[game.active]!.strat
      let action = chooseAiAction(game, searchModeForStrat(strat, true))
      if (stall > 4) action = { type: 'end' }
      game = apply(game, action)
    }
    const now = `${game.turn}|${game.active}|${game.log.length}|${game.pending?.prompt ?? ''}`
    stall = now === mark ? stall + 1 : 0
    mark = now
    if (game.turn !== lastTurn) {
      const round = Math.ceil(lastTurn / SEATS)
      const scores = totals(game)
      const ended = scores[lastActive] ?? 0
      for (const m of MILESTONES) {
        if (first[m] === null && ended >= m) {
          first[m] = { round, won: false }
          firstSeat[m] = lastActive
        }
      }
      if (lastTurn % SEATS === 0) leaderAtRound.push(scores.indexOf(Math.max(...scores)))
      lastTurn = game.turn
      lastActive = game.active
    }
    if (game.ancient && ancientRound === null) ancientRound = Math.ceil(game.turn / SEATS)
  }
  const scores = game.over?.scores ?? totals(game)
  const sorted = [...scores].sort((a, b) => b - a)
  const winnerSeat = scores.indexOf(sorted[0]!)
  for (const m of MILESTONES) if (first[m]) first[m]!.won = firstSeat[m] === winnerSeat
  const reasonText = game.over?.reason ?? ''
  const reason: Row['reason'] = /wins\.$/.test(reasonText) ? 'target' : /Ancient/.test(reasonText) ? 'ancient' : /deck is empty/.test(reasonText) ? 'deck' : 'halt'
  return {
    rounds: Math.ceil(game.turn / SEATS),
    reason,
    ancientRound,
    winnerScore: sorted[0] ?? 0,
    secondScore: sorted[1] ?? 0,
    winnerSeat,
    claims: game.log.filter((line) => line.includes('ends the turn on')).length,
    resets: game.log.filter((line) => line.includes('target claim resets')).length,
    first,
    leaderAtRound,
  }
}

const rows: Row[] = []
const started = Date.now()
for (let g = 0; g < GAMES; g += 1) rows.push(play(SEED0 + g * 13))
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const pct = (n: number) => Math.round((n / Math.max(1, rows.length)) * 100)
const milestones = Object.fromEntries(
  MILESTONES.map((m) => {
    const hit = rows.filter((row) => row.first[m])
    return [m, {
      reached: pct(hit.length),
      firstWins: hit.length ? Math.round((hit.filter((row) => row.first[m]!.won).length / hit.length) * 100) : null,
      round: +avg(hit.map((row) => row.first[m]!.round)).toFixed(1),
      roundsLeft: +avg(hit.map((row) => row.rounds - row.first[m]!.round)).toFixed(1),
    }]
  }),
)
console.log(JSON.stringify({
  seats: SEATS,
  mode: MODE,
  target,
  depth,
  games: rows.length,
  secPerGame: +((Date.now() - started) / 1000 / rows.length).toFixed(2),
  rounds: +avg(rows.map((row) => row.rounds)).toFixed(1),
  ancientRound: +avg(rows.filter((row) => row.ancientRound).map((row) => row.ancientRound!)).toFixed(1),
  ancientSeen: pct(rows.filter((row) => row.ancientRound).length),
  reasons: Object.fromEntries(['target', 'ancient', 'deck', 'halt'].map((r) => [r, pct(rows.filter((row) => row.reason === r).length)])),
  winnerScore: +avg(rows.map((row) => row.winnerScore)).toFixed(1),
  secondScore: +avg(rows.map((row) => row.secondScore)).toFixed(1),
  margin: +avg(rows.map((row) => row.winnerScore - row.secondScore)).toFixed(1),
  claimsPerGame: +avg(rows.map((row) => row.claims)).toFixed(2),
  resetsPerGame: +avg(rows.map((row) => row.resets)).toFixed(2),
  seat0Wins: pct(rows.filter((row) => row.winnerSeat === 0).length),
  milestones,
}))
