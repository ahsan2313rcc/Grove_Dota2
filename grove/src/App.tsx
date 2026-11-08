import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AI_STRATS,
  chooseAiAction,
  chooseAiPending,
  cycleStrat,
  DEFAULT_STRAT,
  isAiStrat,
  searchModeForStrat,
  stratLabel,
} from './game/ai.ts'
import {
  AI_POWER_MAX,
  AI_POWER_MIN,
  aiThoughtPowerLabel,
  bootAiThoughtPower,
  getAiThoughtPower,
  setAiThoughtPower,
} from './game/aiPower.ts'
import { chooseAiPendingChallenge } from './game/aiChallenge.ts'
import {
  bootNnMemory,
  clearNnMemory,
  nnMemoryInfo,
  downloadNnMemoryForGit,
  saveNnMemory,
  type NnMemoryInfo,
} from './game/nnMemory.ts'
import { NnGameRecorder, runMatchWithOptionalTrain } from './game/nnTrainOnline.ts'
import { chooseAiActionNeural, chooseAiPendingNeural } from './game/nnValue.ts'
import {
  ALL_STRAT_FILTER,
  aiRoster,
  BalanceTracker,
  runMatchFast,
  summarizeReports,
  type MatchReport,
  type StratFilter,
} from './game/balance.ts'
import { apply, createGame, type SeatSpec } from './game/engine.ts'
import { log, scoreState } from './game/flow.ts'
import {
  cloneRules,
  DEFAULT_SCORE_RULES,
  forSeats,
  getScoreRules,
  resetScoreRules,
  setScoreRules,
  type ScoreRules,
} from './game/scoring.ts'
import type { Action, AiStrat, Game } from './game/types.ts'
import {
  clearDebugSession,
  clearLocalMatch,
  describeDebugSession,
  describeLocalMatch,
  flushPendingLocalMatch,
  loadDebugSession,
  loadLocalMatch,
  markVoluntaryLeave,
  saveDebugSession,
  saveLocalMatch,
  takeVoluntaryLeave,
  type SavedDebugSession,
  type SavedLocalMatch,
} from './local/save.ts'
import { HEROES, ITEMS, TERRAINS } from './game/catalog.ts'
import { CardArt } from './ui/CardArt.tsx'
import { Glossary } from './ui/Glossary.tsx'
import { Lab } from './ui/Lab.tsx'
import { Rules } from './ui/Rules.tsx'
import { type DebugSpeed, type DebugView } from './ui/DebugRail.tsx'
import { OnlinePlay } from './ui/OnlinePlay.tsx'
import { ScoreRulesPanel } from './ui/ScoreRulesPanel.tsx'
import { WinConditionPanel } from './ui/WinConditionPanel.tsx'
import { Table } from './ui/Table.tsx'

export type SeatCount = 2 | 3 | 4 | 5 | 6 | 7 | 8

const SEAT_OPTIONS: SeatCount[] = [2, 3, 4, 5, 6, 7, 8]
const BASE_TICK_MS = 420
/** Max background / sequential sims from lobby or debug rail (incl. Train Neural). */
const MAX_QUEUE = 100_000

function randomSeed(): number {
  return (Math.floor(Math.random() * 1_000_000_000) || Math.floor(Date.now() % 1_000_000_000) || 1)
}

type LobbySeat = { name: string; kind: 'human' | 'ai'; strat: AiStrat }

type LiveRun = {
  seed: number
  game: Game
  tracker: BalanceTracker
  stuck: boolean
  /** Consecutive no-op advances — escalate escapes so Watch never freezes forever. */
  stall: number
  /** Neural training recorder for this Watch game (only while Train is on). */
  recorder?: NnGameRecorder
}

/** Module flag: Watch games feed every seat's decisions to the Neural net; Neural seats explore. */
let liveTrainNeural = false
const LIVE_TRAIN_EXPLORE = 0.12

function defaultSeats(count: SeatCount): LobbySeat[] {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return { name: 'You', kind: 'human' as const, strat: DEFAULT_STRAT }
    if (index === 1) return { name: 'The Grove', kind: 'ai' as const, strat: 'balanced' }
    return { name: `Player ${index + 1}`, kind: 'ai' as const, strat: cycleStrat(index) }
  })
}

function parseSeedInput(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  // Legacy d58 → 58 (debug is now a lobby checkbox).
  const legacy = /^d(\d+)$/i.exec(text)
  if (legacy) return Math.floor(Number(legacy[1])) || 1
  const parsed = Number(text)
  if (Number.isFinite(parsed)) return Math.floor(parsed) || 1
  return null
}

function makeRun(seed: number, seats: number, strats?: AiStrat[]): LiveRun {
  const game = createGame({
    seed,
    seats: aiRoster(seats, strats, seed),
    ancientEndgame: getScoreRules().ancientEndgame,
  })
  const tracker = new BalanceTracker(seed)
  tracker.start(game)
  return { seed, game, tracker, stuck: false, stall: 0 }
}

function modeForSeat(game: Game, seat: number) {
  return searchModeForStrat(game.players[seat]?.strat ?? DEFAULT_STRAT, false)
}

function pendingMark(pending: Game['pending']): string {
  if (!pending) return ''
  return `${pending.actor}|${pending.resume.kind}|${pending.prompt}|${pending.choices.length}|${pending.min}|${pending.max}`
}

function softFinishLive(game: Game, reason: string): Game {
  const parts = game.players.map((player) => scoreState(game, player.id))
  return {
    ...game,
    pending: null,
    veil: false,
    queue: [],
    echoes: [],
    after: null,
    pendingDraws: [],
    over: { reason, scores: parts.map((part) => part.total), parts },
    log: [...game.log, reason],
  }
}

function learnLive(run: LiveRun, next: Game, actor: number) {
  if (!liveTrainNeural) return
  run.recorder ??= new NnGameRecorder()
  run.recorder.observe(next, actor)
  if (next.over) run.recorder.finish(next)
}

function advanceTracked(run: LiveRun): LiveRun {
  const game = run.game
  if (game.over) return run
  try {
    if (game.veil) {
      const next = apply(game, { type: 'ready' })
      run.tracker.observe(game, { type: 'ready' }, next)
      return { ...run, game: next, stuck: false, stall: 0 }
    }
    if (game.pending) {
      if (game.players[game.pending.actor]?.ai || game.autoAll) {
        const mode = modeForSeat(game, game.pending.actor)
        const ids = mode === 'neural'
          ? chooseAiPendingNeural(game, liveTrainNeural ? { explore: LIVE_TRAIN_EXPLORE } : {})
          : mode === 'challenge'
            ? chooseAiPendingChallenge(game)
            : chooseAiPending(game)
        let next = apply(game, { type: 'choose', ids })
        run.tracker.observe(game, { type: 'choose', ids }, next)
        learnLive(run, next, game.pending.actor)
        if (next.pending && pendingMark(next.pending) === pendingMark(game.pending)) {
          const stall = run.stall + 1
          if (stall >= 2) {
            next = { ...next, pending: null, log: [...next.log, 'Forced past a stuck choice.'] }
            return { ...run, game: next, stuck: false, stall: 0 }
          }
          return { ...run, game: next, stuck: true, stall }
        }
        return { ...run, game: next, stuck: false, stall: 0 }
      }
      return run
    }
    if (!game.players[game.active]?.ai) return run

    // Escalating escapes when prior ticks made no progress (Neural soft-locks especially).
    if (run.stall >= 8) {
      const finished = softFinishLive(game, 'Match halted (soft-lock).')
      return { ...run, game: finished, stuck: false, stall: 0 }
    }
    if (run.stall >= 5) {
      const next = apply(game, { type: 'end' })
      run.tracker.observe(game, { type: 'end' }, next)
      const progressed = next.active !== game.active || next.turn !== game.turn || !!next.over
      return { ...run, game: next, stuck: !progressed, stall: progressed ? 0 : run.stall + 1 }
    }
    if (run.stall >= 2) {
      const hand = game.players[game.active]?.hand ?? []
      const pitch = hand.find((card) => card.kind === 'terrain') ?? hand[0]
      if (pitch && (game.players[game.active]?.actions ?? 0) > 0) {
        const next = apply(game, { type: 'discard', uid: pitch.uid })
        run.tracker.observe(game, { type: 'discard', uid: pitch.uid }, next)
        const progressed = next !== game && (next.log.at(-1) !== game.log.at(-1) || next.deck.length !== game.deck.length)
        return { ...run, game: next, stuck: !progressed, stall: progressed ? 0 : run.stall + 1 }
      }
    }

    const seatStrat = game.players[game.active]?.strat ?? DEFAULT_STRAT
    const mode = modeForSeat(game, game.active)
    const action = mode === 'neural'
      ? chooseAiActionNeural(game, game.active, seatStrat, liveTrainNeural ? { explore: LIVE_TRAIN_EXPLORE } : {})
      : chooseAiAction(game, mode)
    const next = apply(game, action)
    run.tracker.observe(game, action, next)
    learnLive(run, next, game.active)
    const same = next === game
      || (next.active === game.active
        && next.turn === game.turn
        && next.log.at(-1) === game.log.at(-1)
        && next.deck.length === game.deck.length
        && !next.pending
        && next.veil === game.veil
        && !next.over)
    return { ...run, game: next, stuck: same, stall: same ? run.stall + 1 : 0 }
  } catch (error) {
    const text = error instanceof Error ? error.message : 'The Grove could not finish a play.'
    return { ...run, game: log(game, text), stuck: true, stall: run.stall + 1 }
  }
}

function readStart(): { debug: boolean; seed: number; seats: SeatCount; runs: LiveRun[]; view: DebugView } | null {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')
  if (mode !== 'ai' && mode !== 'hotseat' && mode !== 'debug') return null
  const seedParam = params.get('seed') ?? ''
  const seed = parseSeedInput(seedParam) ?? randomSeed()
  const debug = mode === 'debug'
  const seatRaw = Number(params.get('seats'))
  const count: SeatCount = SEAT_OPTIONS.includes(seatRaw as SeatCount) ? seatRaw as SeatCount : 2
  const view: DebugView = params.get('view') === 'stats' ? 'stats' : 'watch'
  if (!debug) {
    const seats: SeatSpec[] = mode === 'hotseat'
      ? Array.from({ length: count }, (_, index) => ({ name: `Player ${index + 1}`, ai: false }))
      : Array.from({ length: count }, (_, index) => ({
        name: index === 0 ? 'You' : index === 1 ? 'The Grove' : `Player ${index + 1}`,
        ai: index !== 0,
      }))
    const game = createGame({ seed, seats })
    const tracker = new BalanceTracker(seed)
    tracker.start(game)
    return {
      debug: false,
      seed,
      seats: count,
      runs: [{ seed, game, tracker, stuck: false, stall: 0 }],
      view: 'watch',
    }
  }
  // Debug defaults to Stats (fast sim); open Watch from the rail to slow the board.
  return { debug: true, seed, seats: count, runs: [], view: 'stats' }
}

/** After a reload, return to the open match or debug session. Leave stays on the lobby. */
function restoredSession(): { debug: SavedDebugSession | null; match: SavedLocalMatch | null } {
  if (typeof window === 'undefined') return { debug: null, match: null }
  const mode = new URLSearchParams(window.location.search).get('mode')
  if (mode === 'ai' || mode === 'hotseat' || mode === 'debug') return { debug: null, match: null }
  if (takeVoluntaryLeave()) return { debug: null, match: null }
  const debug = loadDebugSession()
  if (debug?.active) return { debug, match: null }
  return { debug: null, match: loadLocalMatch() }
}

export default function App() {
  const boot = useState(readStart)[0]
  const restored = useState(() => (boot ? { debug: null, match: null } : restoredSession()))[0]
  const [debug, setDebug] = useState(boot?.debug ?? !!restored.debug)
  const [seed, setSeed] = useState(boot?.seed ?? restored.debug?.seed ?? restored.match?.seed ?? 1)
  const [seatCount, setSeatCount] = useState<SeatCount>(
    boot?.seats
    ?? (SEAT_OPTIONS.includes((restored.debug?.seats ?? restored.match?.game.players.length ?? 2) as SeatCount)
      ? (restored.debug?.seats ?? restored.match?.game.players.length ?? 2) as SeatCount
      : 2),
  )
  const [runs, setRuns] = useState<LiveRun[]>(() => {
    if (boot) return boot.runs
    if (!restored.match) return []
    const tracker = new BalanceTracker(restored.match.seed)
    tracker.start(restored.match.game)
    return [{ seed: restored.match.seed, game: restored.match.game, tracker, stuck: false, stall: 0 }]
  })
  const [focus, setFocus] = useState(0)
  const [debugSpeed, setDebugSpeed] = useState<DebugSpeed>(1)
  const [debugView, setDebugView] = useState<DebugView>(boot?.view ?? restored.debug?.view ?? 'stats')
  const [queueSize, setQueueSize] = useState(restored.debug?.queueSize ?? 100)
  const [reports, setReports] = useState<MatchReport[]>(restored.debug?.reports ?? [])
  const [match, setMatch] = useState(boot ? 1 : 0)
  const [queueLeft, setQueueLeft] = useState(0)
  const [runningFast, setRunningFast] = useState(false)
  const [stratFilter, setStratFilter] = useState<StratFilter>(ALL_STRAT_FILTER)
  const [debugStrats, setDebugStrats] = useState<AiStrat[]>(() =>
    restored.debug?.strats?.length
      ? restored.debug.strats
      : Array.from({ length: boot?.seats ?? 2 }, (_, index) => cycleStrat(index)),
  )
  const [trainNeural, setTrainNeural] = useState(restored.debug?.trainNeural ?? false)
  const [nnInfo, setNnInfo] = useState<NnMemoryInfo>(() => bootNnMemory())
  const [thoughtPower, setThoughtPower] = useState(restored.debug?.thoughtPower ?? bootAiThoughtPower())
  const [online, setOnline] = useState(false)
  const [labSession, setLabSession] = useState(false)
  const [returnToLab, setReturnToLab] = useState(false)
  const queueToken = useRef(0)
  const watchRef = useRef(false)
  const watchAdvanceRef = useRef(0)
  const archivedWatchRef = useRef<number | null>(null)
  const seatCountRef = useRef(seatCount)
  const debugStratsRef = useRef(debugStrats)
  const trainNeuralRef = useRef(trainNeural)
  seatCountRef.current = seatCount
  debugStratsRef.current = debugStrats
  trainNeuralRef.current = trainNeural
  liveTrainNeural = trainNeural

  useEffect(() => {
    if (restored.debug) setScoreRules(restored.debug.rules)
    else if (restored.match) setScoreRules(restored.match.rules)
    function flush() {
      flushPendingLocalMatch()
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [restored])

  const live = runs[0] ?? null
  const game = live?.game ?? null
  const stuck = live?.stuck ?? false

  const summary = useMemo(() => {
    const archived = new Set(reports.map((report) => report.seed))
    const liveReports = runs
      .filter((run) => !archived.has(run.seed))
      .map((run) => run.tracker.snapshot(run.game))
    return summarizeReports([...reports, ...liveReports], stratFilter)
  }, [reports, runs, stratFilter])

  const finishedCount = reports.filter((report) => report.over).length
  const runCount = (live && !live.game.over ? 1 : 0) + queueLeft + (runningFast ? 1 : 0)

  // Watch mode: tick the live board at the chosen speed (stats mode never ticks).
  useEffect(() => {
    if (!debug || debugView !== 'watch' || runningFast) return
    if (runs.length === 0) return
    if (debugSpeed === 0) return
    const run = runs[0]
    if (!run || run.game.over) return
    // Auto-unstick: keep ticking even if a prior noop marked stuck.
    const delay = Math.round(BASE_TICK_MS / Math.max(debugSpeed, 0.5))
    const timer = window.setTimeout(() => {
      setRuns((current) => {
        const liveRun = current[0]
        if (!liveRun || liveRun.game.over) return current
        try {
          return [advanceTracked(liveRun)]
        } catch (error) {
          const text = error instanceof Error ? error.message : 'The Grove could not finish a play.'
          return [{ ...liveRun, game: log(liveRun.game, text), stuck: true, stall: liveRun.stall + 1 }]
        }
      })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [debug, debugView, debugSpeed, runs, runningFast])

  // Archive a finished watch match; if still watching with queue left, start the next live seed.
  // Do not remount the table — bumping match as a React key was causing a full UI refresh.
  useEffect(() => {
    if (!debug || debugView !== 'watch' || runningFast || !live?.game.over) return
    const finished = live
    if (archivedWatchRef.current !== finished.seed) {
      archivedWatchRef.current = finished.seed
      setReports((current) => {
        if (current.some((report) => report.seed === finished.seed)) return current
        return [...current, finished.tracker.snapshot(finished.game)]
      })
    }
    if (queueLeft <= 0 || !watchRef.current) return
    const gen = ++watchAdvanceRef.current
    const nextSeed = finished.seed + 1
    const timer = window.setTimeout(() => {
      if (watchAdvanceRef.current !== gen || !watchRef.current) return
      setSeed(nextSeed)
      setQueueLeft((left) => Math.max(0, left - 1))
      setMatch((value) => value + 1)
      setRuns([makeRun(nextSeed, seatCountRef.current, debugStratsRef.current)])
    }, 120)
    return () => window.clearTimeout(timer)
  }, [debug, debugView, live, queueLeft, runningFast])

  useEffect(() => {
    if (debug) return
    if (!game || game.over) return
    // Keep ticking while stuck so discard → end → softFinish escapes can run
    // (Neural used to freeze vs humans on the first no-op).
    const pendingAi = !!game.pending && (!!game.players[game.pending.actor]?.ai || game.autoAll)
    const activeAi = !game.pending && (game.veil || !!game.players[game.active]?.ai)
    if (!pendingAi && !activeAi) return
    const timer = window.setTimeout(() => {
      setRuns((current) => {
        const run = current[0]
        if (!run) return current
        try {
          const advanced = advanceTracked(run)
          if (!labSession) saveLocalMatch(advanced.seed, advanced.game, getScoreRules())
          return [advanced]
        } catch (error) {
          const text = error instanceof Error ? error.message : 'The Grove could not finish a play.'
          return [{ ...run, game: log(run.game, text), stuck: true, stall: run.stall + 1 }]
        }
      })
    }, BASE_TICK_MS)
    return () => window.clearTimeout(timer)
  }, [debug, game, stuck, labSession])

  const send = useCallback((action: Action) => {
    if (debug) return
    setRuns((current) => {
      const run = current[0]
      if (!run) return current
      try {
        const next = apply(run.game, action)
        run.tracker.observe(run.game, action, next)
        if (!labSession) saveLocalMatch(run.seed, next, getScoreRules(), action.type !== 'ready')
        return [{ ...run, game: next, stuck: false, stall: 0 }]
      } catch (error) {
        const text = error instanceof Error ? error.message : 'That play could not resolve.'
        return [{ ...run, game: log(run.game, text) }]
      }
    })
  }, [debug, labSession])

  function stepDebug() {
    setRuns((current) => {
      const run = current[0]
      if (!run || run.game.over) return current
      try {
        return [advanceTracked(run)]
      } catch (error) {
        const text = error instanceof Error ? error.message : 'The Grove could not finish a play.'
        return [{ ...run, game: log(run.game, text), stuck: true, stall: run.stall + 1 }]
      }
    })
  }

  function persistDebugSession(extra?: Partial<SavedDebugSession>) {
    if (!debug) return
    saveDebugSession({
      seed,
      seats: seatCount,
      strats: debugStrats,
      queueSize,
      view: debugView,
      trainNeural,
      thoughtPower,
      reports,
      rules: getScoreRules(),
      active: true,
      ...extra,
    })
  }

  function leave() {
    markVoluntaryLeave()
    queueToken.current += 1
    watchAdvanceRef.current += 1
    watchRef.current = false
    archivedWatchRef.current = null
    window.history.replaceState({}, '', window.location.pathname)
    if (labSession) {
      // Scratch lab board: leave the saved match alone and reopen Ability Lab.
      setLabSession(false)
      setReturnToLab(true)
      setRuns([])
      setFocus(0)
      resetScoreRules()
      return
    }
    // Keep unfinished local matches so the lobby can offer Return to game.
    if (live && !debug) {
      if (live.game.over) clearLocalMatch()
      else saveLocalMatch(live.seed, live.game, getScoreRules(), true)
    } else if (debug) {
      clearLocalMatch()
      persistDebugSession({ active: false })
    }
    setLabSession(false)
    setReturnToLab(false)
    setRuns([])
    setReports([])
    setDebug(false)
    setDebugSpeed(1)
    setDebugView('stats')
    setFocus(0)
    setQueueLeft(0)
    setRunningFast(false)
    setStratFilter(ALL_STRAT_FILTER)
    setDebugStrats(Array.from({ length: 2 }, (_, index) => cycleStrat(index)))
    resetScoreRules()
  }

  function resumeDebug(saved: SavedDebugSession) {
    queueToken.current += 1
    watchAdvanceRef.current += 1
    archivedWatchRef.current = null
    setScoreRules(saved.rules)
    setMatch((value) => value + 1)
    setSeed(saved.seed)
    setSeatCount(
      SEAT_OPTIONS.includes(saved.seats as SeatCount) ? (saved.seats as SeatCount) : 2,
    )
    setDebug(true)
    setDebugSpeed(1)
    setFocus(0)
    setReports(saved.reports)
    setDebugStrats(saved.strats)
    setStratFilter(ALL_STRAT_FILTER)
    setQueueSize(saved.queueSize)
    setQueueLeft(0)
    setRunningFast(false)
    setRuns([])
    setDebugView(saved.view === 'watch' ? 'stats' : saved.view)
    setTrainNeural(saved.trainNeural)
    trainNeuralRef.current = saved.trainNeural
    liveTrainNeural = saved.trainNeural
    setThoughtPower(saved.thoughtPower)
    setAiThoughtPower(saved.thoughtPower)
    watchRef.current = false
  }

  function resumeLocal(saved: SavedLocalMatch) {
    setScoreRules(saved.rules)
    setMatch((value) => value + 1)
    setSeed(saved.seed)
    setSeatCount(
      SEAT_OPTIONS.includes(saved.game.players.length as SeatCount)
        ? (saved.game.players.length as SeatCount)
        : 2,
    )
    setDebug(false)
    const tracker = new BalanceTracker(saved.seed)
    tracker.start(saved.game)
    setRuns([{ seed: saved.seed, game: saved.game, tracker, stuck: false, stall: 0 }])
    setFocus(0)
  }

  function resetDebug() {
    queueToken.current += 1
    watchAdvanceRef.current += 1
    archivedWatchRef.current = null
    setRunningFast(false)
    setReports([])
    setQueueLeft(0)
    setFocus(0)
    setMatch((value) => value + 1)
    if (debugView === 'stats') {
      setRuns([])
      return
    }
    setRuns([makeRun(seed, seatCount, debugStrats)])
  }

  /** Run N matches in the background at full speed; paint stats in batches so the rail doesn't thrash. */
  async function runFastQueue(fromSeed: number, count: number, seats: SeatCount, strats: AiStrat[]) {
    const token = ++queueToken.current
    watchAdvanceRef.current += 1
    const total = Math.max(1, Math.min(MAX_QUEUE, count))
    setRunningFast(true)
    setDebugView('stats')
    watchRef.current = false
    setRuns([])
    setQueueLeft(total)
    const chunk: MatchReport[] = []
    const flushEvery = 12
    const PAINT_MS = 250
    let lastPaint = 0
    for (let index = 0; index < total; index += 1) {
      if (queueToken.current !== token) return
      if (watchRef.current) {
        if (chunk.length > 0) {
          const batch = chunk.splice(0, chunk.length)
          setReports((current) => [...current, ...batch])
        }
        const nextSeed = fromSeed + index
        setSeed(nextSeed)
        setQueueLeft(total - index)
        setMatch((value) => value + 1)
        setRuns([makeRun(nextSeed, seats, strats)])
        setRunningFast(false)
        return
      }
      try {
        if (trainNeuralRef.current) {
          const roster = aiRoster(seats, strats, fromSeed + index)
          const { report } = runMatchWithOptionalTrain(fromSeed + index, roster, { train: true, fast: true })
          chunk.push(report)
          setNnInfo(nnMemoryInfo())
        } else {
          chunk.push(runMatchFast(fromSeed + index, seats, strats))
        }
      } catch (error) {
        // runMatchFast soft-finishes internally; this is a last-resort stub so the queue never stalls.
        const reason = error instanceof Error ? error.message : 'sim error'
        const stub = makeRun(fromSeed + index, seats, strats)
        const finished = softFinishLive(stub.game, `Match halted (${reason}).`)
        chunk.push(stub.tracker.finish(finished))
      }
      const done = index + 1
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const shouldPaint = chunk.length >= flushEvery || done === total || now - lastPaint >= PAINT_MS
      if (shouldPaint) {
        const batch = chunk.splice(0, chunk.length)
        lastPaint = now
        setSeed(fromSeed + index)
        setQueueLeft(total - done)
        if (batch.length > 0) setReports((current) => [...current, ...batch])
      }
      // Yield so React can paint and cancel tokens stay responsive — but not every micro-sim.
      if (shouldPaint || done % 4 === 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0)
        })
      }
    }
    if (queueToken.current !== token) return
    setQueueLeft(0)
    setRunningFast(false)
  }

  function queueMore() {
    const extra = Math.max(1, Math.min(MAX_QUEUE, queueSize))
    if (debugView === 'watch') {
      if (!live || live.game.over) {
        const jump = live?.game.over ? live.seed + 1 : seed
        setSeed(jump)
        setMatch((value) => value + 1)
        setRuns([makeRun(jump, seatCount, debugStrats)])
        setQueueLeft((left) => Math.min(MAX_QUEUE, left + Math.max(0, extra - 1)))
      } else {
        setQueueLeft((left) => Math.min(MAX_QUEUE, left + extra))
      }
      if (debugSpeed === 0) setDebugSpeed(1)
      return
    }
    const fromSeed = (reports.at(-1)?.seed ?? seed - 1) + 1
    void runFastQueue(fromSeed, extra, seatCount, debugStrats)
  }

  function playNext() {
    queueToken.current += 1
    setRunningFast(false)
    watchRef.current = true
    if (live && !live.game.over) {
      setReports((current) => [...current, live.tracker.snapshot(live.game)])
    }
    const jump = (live?.seed ?? seed) + 1
    setSeed(jump)
    setMatch((value) => value + 1)
    setRuns([makeRun(jump, seatCount, debugStrats)])
    setDebugView('watch')
    if (debugSpeed === 0) setDebugSpeed(1)
  }

  function startWatchFromStats() {
    watchRef.current = true
    const created = [makeRun(seed, seatCount, debugStrats)]
    setRuns(created)
    setFocus(0)
    setDebugView('watch')
    setDebugSpeed(1)
    setMatch((value) => value + 1)
  }

  function onDebugView(view: DebugView) {
    if (view === 'watch') {
      watchRef.current = true
      // Mid-batch: let runFastQueue hand off the remaining queue — don't spawn a parallel live run.
      if (runningFast) {
        setDebugView('watch')
        return
      }
      if (runs.length === 0) {
        startWatchFromStats()
        return
      }
      setDebugView('watch')
      return
    }
    // Leaving Watch cancels the archive→next-seed timer without aborting a fast queue.
    watchAdvanceRef.current += 1
    watchRef.current = false
    setDebugView('stats')
  }

  function startDebugSession(nextSeed: number, seats: SeatCount, queue: number, strats: AiStrat[], rules: ScoreRules) {
    queueToken.current += 1
    setScoreRules(rules)
    setMatch((value) => value + 1)
    setSeed(nextSeed)
    setSeatCount(seats)
    setDebug(true)
    setDebugSpeed(1)
    setFocus(0)
    setReports([])
    setDebugStrats(strats)
    setStratFilter(ALL_STRAT_FILTER)
    const total = Math.max(1, Math.min(MAX_QUEUE, queue))
    setQueueSize(total)
    setQueueLeft(0)
    setRuns([])
    setDebugView('stats')
    watchRef.current = false
    saveDebugSession({
      seed: nextSeed,
      seats,
      strats,
      queueSize: total,
      view: 'stats',
      trainNeural,
      thoughtPower,
      reports: [],
      rules,
      active: true,
    })
    window.setTimeout(() => {
      void runFastQueue(nextSeed, total, seats, strats)
    }, 0)
  }

  // Keep debug stats recoverable after Leave / refresh.
  useEffect(() => {
    if (!debug) return
    persistDebugSession()
  }, [debug, seed, seatCount, debugStrats, queueSize, debugView, trainNeural, thoughtPower, reports])

  if (online) {
    return <OnlinePlay onBack={() => setOnline(false)} />
  }

  if (runs.length === 0 && !debug) {
    return (
      <Lobby
        startLab={returnToLab}
        onLabOpened={() => setReturnToLab(false)}
        onOnline={() => setOnline(true)}
        onResumeLocal={resumeLocal}
        onResumeDebug={resumeDebug}
        onLab={(next, nextSeed) => {
          // Lab boards are scratch sessions: do not overwrite a saved match.
          setLabSession(true)
          setReturnToLab(false)
          setScoreRules(DEFAULT_SCORE_RULES)
          setMatch((value) => value + 1)
          setSeed(nextSeed)
          setSeatCount(2)
          setDebug(false)
          const tracker = new BalanceTracker(nextSeed)
          tracker.start(next)
          setRuns([{ seed: nextSeed, game: next, tracker, stuck: false, stall: 0 }])
          setFocus(0)
        }}
        onStart={(next, nextSeed, nextDebug, seats, queue, strats, rules, train) => {
          setTrainNeural(train)
          trainNeuralRef.current = train
          liveTrainNeural = train
          setThoughtPower(getAiThoughtPower())
          if (nextDebug) {
            startDebugSession(nextSeed, seats, queue, strats, rules)
            return
          }
          setLabSession(false)
          setScoreRules(rules)
          setMatch((value) => value + 1)
          setSeed(nextSeed)
          setSeatCount(seats)
          setDebug(false)
          const tracker = new BalanceTracker(nextSeed)
          tracker.start(next)
          saveLocalMatch(nextSeed, next, rules, true)
          setRuns([{ seed: nextSeed, game: next, tracker, stuck: false, stall: 0 }])
          setFocus(0)
        }}
      />
    )
  }

  if (debug) {
    return (
      <Table
        game={game}
        seed={seed}
        stuck={stuck}
        tableGen={match}
        debug
        debugSpeed={debugSpeed}
        debugView={debugView}
        debugBatchSize={queueSize}
        debugFocus={0}
        debugRunCount={runCount}
        debugFinished={finishedCount}
        debugRunningBatch={runningFast || queueLeft > 0}
        debugQueueLeft={queueLeft}
        debugSummary={summary}
        debugReports={reports}
        debugStratFilter={stratFilter}
        onDebugSpeed={setDebugSpeed}
        onDebugStep={stepDebug}
        onDebugView={onDebugView}
        onDebugBatchSize={setQueueSize}
        onDebugFocus={setFocus}
        onDebugRunBatch={queueMore}
        onDebugPlayNext={playNext}
        onDebugStratFilter={setStratFilter}
        onDebugReset={resetDebug}
        debugTrainNeural={trainNeural}
        debugNnInfo={nnInfo}
        onDebugTrainNeural={setTrainNeural}
        onDebugNnSave={() => setNnInfo(saveNnMemory())}
        onDebugNnExportGit={() => setNnInfo(downloadNnMemoryForGit())}
        onDebugNnClear={() => setNnInfo(clearNnMemory(false))}
        debugThoughtPower={thoughtPower}
        onDebugThoughtPower={(value) => setThoughtPower(setAiThoughtPower(value))}
        onAction={send}
        onLobby={leave}
      />
    )
  }

  return (
    <Table
      game={game!}
      seed={seed}
      stuck={stuck}
      tableGen={match}
      labSession={labSession}
      onAction={send}
      onLobby={leave}
    />
  )
}

const LOBBY_FAN = ['crystal_maiden', 'juggernaut', 'axe', 'io', 'techies']
const ITEM_COUNT = ITEMS.reduce((sum, item) => sum + item.copies, 0)
const TERRAIN_COUNT = TERRAINS.length * 12

function Lobby({
  onStart,
  onOnline,
  onResumeLocal,
  onResumeDebug,
  onLab,
  startLab = false,
  onLabOpened,
}: {
  onOnline: () => void
  onLab: (game: Game, seed: number) => void
  onResumeLocal: (saved: SavedLocalMatch) => void
  onResumeDebug: (saved: SavedDebugSession) => void
  startLab?: boolean
  onLabOpened?: () => void
  onStart: (
    game: Game,
    seed: number,
    debug: boolean,
    seats: SeatCount,
    queue: number,
    strats: AiStrat[],
    rules: ScoreRules,
    trainNeural: boolean,
  ) => void
}) {
  const [seedText, setSeedText] = useState('')
  const [debugMode, setDebugMode] = useState(false)
  const [count, setCount] = useState<SeatCount>(2)
  const [seats, setSeats] = useState<LobbySeat[]>(() => defaultSeats(2))
  const [queue, setQueue] = useState(100)
  const [fault, setFault] = useState('')
  const [glossary, setGlossary] = useState(false)
  const [lab, setLab] = useState(startLab)

  useEffect(() => {
    if (!startLab) return
    setLab(true)
    onLabOpened?.()
  }, [startLab, onLabOpened])
  const [rules, setRules] = useState(false)
  const [scoreOpen, setScoreOpen] = useState(false)
  const [winOpen, setWinOpen] = useState(false)
  const [lobbyRules, setLobbyRules] = useState<ScoreRules>(() => cloneRules(getScoreRules()))
  const [savedLocal, setSavedLocal] = useState<SavedLocalMatch | null>(() => loadLocalMatch())
  const [savedDebug, setSavedDebug] = useState<SavedDebugSession | null>(() => loadDebugSession())
  const [trainNeural, setTrainNeural] = useState(false)
  const [thoughtPower, setThoughtPower] = useState(() => bootAiThoughtPower())

  function setPlayerCount(next: SeatCount) {
    setCount(next)
    setSeats((current) => {
      const defaults = defaultSeats(next)
      return defaults.map((seat, index) => current[index] ?? seat)
    })
  }

  function patchSeat(index: number, patch: Partial<LobbySeat>) {
    setSeats((current) => current.map((seat, i) => (i === index ? { ...seat, ...patch } : seat)))
  }

  function start() {
    const seed = parseSeedInput(seedText) ?? randomSeed()
    const debug = debugMode
    const strats = seats.map((seat, index) => (debug || seat.kind === 'ai' ? seat.strat : cycleStrat(index)))
    const roster: SeatSpec[] = seats.map((seat, index) => {
      const ai = debug ? true : seat.kind === 'ai'
      const strat = ai ? seat.strat : DEFAULT_STRAT
      return {
        name: ai
          ? stratLabel(strat)
          : (seat.name.trim() || `Player ${index + 1}`),
        ai,
        strat,
      }
    })
    try {
      const rules = debug
        ? lobbyRules
        : {
            ...DEFAULT_SCORE_RULES,
            ancientEndgame: lobbyRules.ancientEndgame,
            scoreWin: lobbyRules.scoreWin,
            winScores: lobbyRules.winScores,
            ancientDepths: lobbyRules.ancientDepths,
          }
      onStart(
        createGame({
          seed,
          seats: roster,
          ancientEndgame: rules.ancientEndgame,
          winScore: rules.scoreWin ? forSeats(rules.winScores, roster.length) : null,
          ancientDepth: forSeats(rules.ancientDepths, roster.length),
        }),
        seed,
        debug,
        count,
        debug ? queue : 1,
        strats,
        rules,
        debug && trainNeural,
      )
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The deck could not be dealt.')
    }
  }

  const humans = seats.filter((seat) => seat.kind === 'human').length
  const debugPreview = debugMode

  return (
    <main className="lobby">
      <div className="lobby-copy">
        <p className="eyebrow">A shared deck of heroes</p>
        <h1>Grove</h1>
        <p className="lede">Draft heroes into teams, lay terrain in sets of three, and race for the most points before The Ancient ends the game.</p>
        <div className="lobby-fan" aria-hidden>
          {LOBBY_FAN.map((id) => (
            <CardArt key={id} defId={id} className="lobby-fan-card" />
          ))}
        </div>
        <ol className="lobby-steps">
          <li>
            <strong>Draw two</strong>
            <span>Start each turn with two cards, then spend two actions: draw one more or play a card.</span>
          </li>
          <li>
            <strong>Build teams</strong>
            <span>Up to five heroes a team. Matching attributes score up to 15, mixed teams up to 12.</span>
          </li>
          <li>
            <strong>Lay terrain</strong>
            <span>Any three terrains, free: 3 for a pair, 5 for one of each, 8 and a reward for three alike.</span>
          </li>
        </ol>
        <dl className="lobby-facts">
          <div><dt>Heroes</dt><dd>{HEROES.length}</dd></div>
          <div><dt>Items</dt><dd>{ITEM_COUNT}</dd></div>
          <div><dt>Terrains</dt><dd>{TERRAIN_COUNT}</dd></div>
          <div><dt>Hand limit</dt><dd>7</dd></div>
        </dl>
      </div>
      <form className="lobby-card" onSubmit={(event) => event.preventDefault()}>
        <header className="lobby-card-head">
          <h2>Sit down</h2>
          <p className="quiet">Pick who plays, then start.</p>
        </header>
        <fieldset className="player-count">
          <legend>Players</legend>
          <div className="layout-picks" role="group" aria-label="How many players">
            {SEAT_OPTIONS.map((size) => (
              <button key={size} type="button" className={count === size ? 'on' : ''} data-testid={`lobby-seats-${size}`} onClick={() => setPlayerCount(size)}>
                {size}
              </button>
            ))}
          </div>
        </fieldset>
        <ul className="seat-list" data-count={count}>
          {seats.map((seat, index) => {
            const aiSeat = debugPreview || seat.kind === 'ai'
            return (
              <li key={index} className="seat-row">
                <span className="seat-num">Seat {index + 1}</span>
                <div className="kind-picks" role="group" aria-label={`Seat ${index + 1} type`}>
                  <button
                    type="button"
                    className={!aiSeat ? 'on' : ''}
                    data-testid={`kind-human-${index}`}
                    disabled={debugPreview}
                    onClick={() => patchSeat(index, { kind: 'human', name: index === 0 ? 'You' : `Player ${index + 1}` })}
                  >
                    Human
                  </button>
                  <button
                    type="button"
                    className={aiSeat ? 'on' : ''}
                    data-testid={`kind-ai-${index}`}
                    onClick={() => patchSeat(index, { kind: 'ai', name: stratLabel(seat.strat) })}
                  >
                    AI
                  </button>
                </div>
                {aiSeat ? (
                  <select
                    className="seat-name-field"
                    data-testid={`strat-${index}`}
                    aria-label={`Seat ${index + 1} strat`}
                    value={seat.strat}
                    onChange={(event) => {
                      const value = event.target.value
                      if (isAiStrat(value)) patchSeat(index, { strat: value, name: stratLabel(value), kind: 'ai' })
                    }}
                  >
                    {AI_STRATS.map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="seat-name-field"
                    value={seat.name}
                    onChange={(event) => patchSeat(index, { name: event.target.value })}
                    maxLength={24}
                    data-testid={`name-${index}`}
                    aria-label={`Seat ${index + 1} name`}
                    placeholder="Name"
                  />
                )}
              </li>
            )
          })}
        </ul>
        <button type="button" className="primary block lobby-start" data-testid="play-solo" onClick={start}>
          {debugPreview ? `Sim ${queue} game${queue === 1 ? '' : 's'}` : savedLocal ? 'New match' : 'Start match'}
        </button>
        <button type="button" className="block" data-testid="play-online" onClick={onOnline}>Play online (ranked)</button>
        <p className="quiet lobby-hint">
          {debugPreview
            ? 'Seat strats apply to every simulated match. Blank seed rolls a random start.'
            : humans >= 2
              ? 'Multiple humans pass the seat automatically.'
              : humans === 1
                ? 'You go first. AI seats take their turns on their own.'
                : 'All AI is fine for spectating and debugging.'}
        </p>
        {savedLocal && !debugPreview ? (
          <div className="resume-box" data-testid="resume-local-box">
            <p className="quiet">Unfinished local match found.</p>
            <p className="quiet">{describeLocalMatch(savedLocal)}</p>
            <button
              type="button"
              className="primary block"
              data-testid="resume-local"
              onClick={() => onResumeLocal(savedLocal)}
            >
              Return to game
            </button>
            <button
              type="button"
              className="block"
              data-testid="discard-local"
              onClick={() => {
                clearLocalMatch()
                setSavedLocal(null)
              }}
            >
              Discard saved match
            </button>
          </div>
        ) : null}
        {savedDebug ? (
          <div className="resume-box" data-testid="resume-debug-box">
            <p className="quiet">Previous debug session found.</p>
            <p className="quiet">{describeDebugSession(savedDebug)}</p>
            <button
              type="button"
              className="primary block"
              data-testid="resume-debug"
              onClick={() => {
                setDebugMode(true)
                onResumeDebug(savedDebug)
              }}
            >
              Load previous debug
            </button>
            <button
              type="button"
              className="block"
              data-testid="discard-debug"
              onClick={() => {
                clearDebugSession()
                setSavedDebug(null)
              }}
            >
              Discard debug session
            </button>
          </div>
        ) : null}
        <details className="lobby-options">
          <summary>
            <span>Match options</span>
            <span className="quiet">
              AI {thoughtPower}/10{debugMode ? ' · debug' : ''}
            </span>
          </summary>
          <div className="debug-lobby">
            <label className="thought-power">
              <span>
                AI thought power {thoughtPower}/10 ({aiThoughtPowerLabel(thoughtPower)})
              </span>
              <input
                data-testid="lobby-thought-power"
                type="range"
                min={AI_POWER_MIN}
                max={AI_POWER_MAX}
                step={1}
                value={thoughtPower}
                onChange={(event) => setThoughtPower(setAiThoughtPower(Number(event.target.value)))}
              />
            </label>
            <div className="lobby-opt-row">
              <label className="check-row">
                <input
                  data-testid="lobby-debug"
                  type="checkbox"
                  checked={debugMode}
                  onChange={(event) => setDebugMode(event.target.checked)}
                />
                Debug balance
              </label>
              {debugPreview ? (
                <label className="lobby-opt-inline">
                  Seq games
                  <input
                    data-testid="lobby-parallel"
                    type="number"
                    min={1}
                    max={MAX_QUEUE}
                    value={queue}
                    onChange={(event) => setQueue(Math.max(1, Math.min(MAX_QUEUE, Number(event.target.value) || 1)))}
                  />
                </label>
              ) : null}
            </div>
            {debugPreview ? (
              <label className="check-row">
                <input
                  data-testid="lobby-train-neural"
                  type="checkbox"
                  checked={trainNeural}
                  onChange={(event) => setTrainNeural(event.target.checked)}
                />
                Train Neural
              </label>
            ) : null}
            <div className="lobby-opt-row">
              {debugPreview ? (
                <button type="button" data-testid="lobby-scoring" onClick={() => setScoreOpen(true)}>
                  Scoring…
                </button>
              ) : null}
              <button type="button" data-testid="lobby-win" onClick={() => setWinOpen(true)}>
                Win condition…
              </button>
            </div>
            <label>
              Seed
              <input
                data-testid="seed"
                placeholder="Random"
                value={seedText}
                onChange={(event) => setSeedText(event.target.value)}
              />
            </label>
          </div>
        </details>
        <div className="lobby-links">
          <button type="button" data-testid="rules-open" onClick={() => setRules(true)}>Rules</button>
          <button type="button" data-testid="glossary-open" onClick={() => setGlossary(true)}>Glossary</button>
          <button type="button" data-testid="lab-open" onClick={() => setLab(true)}>Ability Lab</button>
        </div>
        {fault ? <p className="warn">{fault}</p> : null}
      </form>
      {glossary ? <Glossary onClose={() => setGlossary(false)} /> : null}
      {rules ? <Rules onClose={() => setRules(false)} /> : null}
      {lab ? <Lab onClose={() => setLab(false)} onPlay={onLab} /> : null}
      {winOpen ? (
        <div className="scrim" onClick={() => setWinOpen(false)}>
          <section
            className="sheet score-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="win-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Match options</p>
            <h2 id="win-title">Win condition</h2>
            <WinConditionPanel value={lobbyRules} onChange={setLobbyRules} />
            <button type="button" className="primary block" data-testid="win-done" onClick={() => setWinOpen(false)}>
              Done
            </button>
          </section>
        </div>
      ) : null}
      {scoreOpen ? (
        <div className="scrim" onClick={() => setScoreOpen(false)}>
          <section
            className="sheet score-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="score-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Debug balance</p>
            <h2 id="score-title">Scoring</h2>
            <ScoreRulesPanel value={lobbyRules} onChange={setLobbyRules} />
            <button type="button" className="primary block" data-testid="score-done" onClick={() => setScoreOpen(false)}>
              Done
            </button>
          </section>
        </div>
      ) : null}
    </main>
  )
}
