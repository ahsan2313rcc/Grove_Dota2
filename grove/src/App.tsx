import { useEffect, useMemo, useRef, useState } from 'react'
import { AI_STRATS, chooseAiAction, chooseAiPending, cycleStrat, DEFAULT_STRAT, isAiStrat, stratLabel } from './game/ai.ts'
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
  getScoreRules,
  resetScoreRules,
  setScoreRules,
  type ScoreRules,
} from './game/scoring.ts'
import type { Action, AiStrat, Game } from './game/types.ts'
import { Glossary } from './ui/Glossary.tsx'
import { type DebugSpeed, type DebugView } from './ui/DebugRail.tsx'
import { OnlinePlay } from './ui/OnlinePlay.tsx'
import { ScoreRulesPanel } from './ui/ScoreRulesPanel.tsx'
import { Table } from './ui/Table.tsx'

export type SeatCount = 2 | 3 | 4 | 5 | 6 | 7 | 8

const SEAT_OPTIONS: SeatCount[] = [2, 3, 4, 5, 6, 7, 8]
const BASE_TICK_MS = 420
/** Max background / sequential sims from lobby or debug rail. */
const MAX_QUEUE = 1024

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
}

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
        const ids = chooseAiPending(game)
        let next = apply(game, { type: 'choose', ids })
        run.tracker.observe(game, { type: 'choose', ids }, next)
        if (next.pending && pendingMark(next.pending) === pendingMark(game.pending)) {
          const stall = run.stall + 1
          if (stall >= 3) {
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

    // Escalating escapes when prior ticks made no progress.
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
    if (run.stall >= 3) {
      const hand = game.players[game.active]?.hand ?? []
      const pitch = hand.find((card) => card.kind === 'terrain') ?? hand[0]
      if (pitch && (game.players[game.active]?.actions ?? 0) > 0) {
        const next = apply(game, { type: 'discard', uid: pitch.uid })
        run.tracker.observe(game, { type: 'discard', uid: pitch.uid }, next)
        const progressed = next !== game && (next.log.at(-1) !== game.log.at(-1) || next.deck.length !== game.deck.length)
        return { ...run, game: next, stuck: !progressed, stall: progressed ? 0 : run.stall + 1 }
      }
    }

    const action = chooseAiAction(game)
    const next = apply(game, action)
    run.tracker.observe(game, action, next)
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
    return { debug: false, seed, seats: count, runs: [{ seed, game, tracker, stuck: false, stall: 0 }], view: 'watch' }
  }
  // Debug defaults to Stats (fast sim); open Watch from the rail to slow the board.
  return { debug: true, seed, seats: count, runs: [], view: 'stats' }
}

export default function App() {
  const boot = useState(readStart)[0]
  const [debug, setDebug] = useState(boot?.debug ?? false)
  const [seed, setSeed] = useState(boot?.seed ?? 1)
  const [seatCount, setSeatCount] = useState<SeatCount>(boot?.seats ?? 2)
  const [runs, setRuns] = useState<LiveRun[]>(boot?.runs ?? [])
  const [focus, setFocus] = useState(0)
  const [debugSpeed, setDebugSpeed] = useState<DebugSpeed>(1)
  const [debugView, setDebugView] = useState<DebugView>(boot?.view ?? 'stats')
  const [queueSize, setQueueSize] = useState(1)
  const [reports, setReports] = useState<MatchReport[]>([])
  const [match, setMatch] = useState(boot ? 1 : 0)
  const [queueLeft, setQueueLeft] = useState(0)
  const [runningFast, setRunningFast] = useState(false)
  const [stratFilter, setStratFilter] = useState<StratFilter>(ALL_STRAT_FILTER)
  const [debugStrats, setDebugStrats] = useState<AiStrat[]>(() => Array.from({ length: boot?.seats ?? 2 }, (_, index) => cycleStrat(index)))
  const queueToken = useRef(0)
  const watchRef = useRef(false)
  const watchAdvanceRef = useRef(0)
  const archivedWatchRef = useRef<number | null>(null)
  const seatCountRef = useRef(seatCount)
  const debugStratsRef = useRef(debugStrats)
  seatCountRef.current = seatCount
  debugStratsRef.current = debugStrats

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
    if (!game || game.over || stuck) return
    const pendingAi = !!game.pending && (!!game.players[game.pending.actor]?.ai || game.autoAll)
    const activeAi = !game.pending && (game.veil || !!game.players[game.active]?.ai)
    if (!pendingAi && !activeAi) return
    const timer = window.setTimeout(() => {
      setRuns((current) => {
        const run = current[0]
        if (!run) return current
        try {
          return [advanceTracked(run)]
        } catch (error) {
          const text = error instanceof Error ? error.message : 'The Grove could not finish a play.'
          return [{ ...run, game: log(run.game, text), stuck: true, stall: run.stall + 1 }]
        }
      })
    }, BASE_TICK_MS)
    return () => window.clearTimeout(timer)
  }, [debug, game, stuck])

  function send(action: Action) {
    if (!live || debug) return
    setRuns((current) => {
      const run = current[0]
      if (!run) return current
      try {
        const next = apply(run.game, action)
        run.tracker.observe(run.game, action, next)
        return [{ ...run, game: next, stuck: false, stall: 0 }]
      } catch (error) {
        const text = error instanceof Error ? error.message : 'That play could not resolve.'
        return [{ ...run, game: log(run.game, text) }]
      }
    })
  }

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

  function leave() {
    queueToken.current += 1
    watchAdvanceRef.current += 1
    watchRef.current = false
    archivedWatchRef.current = null
    window.history.replaceState({}, '', window.location.pathname)
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

  /** Run N matches in the background at full speed (one finished report at a time). */
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
    const flushEvery = 1
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
        chunk.push(runMatchFast(fromSeed + index, seats, strats))
      } catch (error) {
        // runMatchFast soft-finishes internally; this is a last-resort stub so the queue never stalls.
        const reason = error instanceof Error ? error.message : 'sim error'
        const stub = makeRun(fromSeed + index, seats, strats)
        const finished = softFinishLive(stub.game, `Match halted (${reason}).`)
        chunk.push(stub.tracker.finish(finished))
      }
      setQueueLeft(total - index - 1)
      if (chunk.length >= flushEvery || index === total - 1) {
        const batch = chunk.splice(0, chunk.length)
        setSeed(fromSeed + index)
        setReports((current) => [...current, ...batch])
      }
      // Yield so React can paint and cancel tokens stay responsive.
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0)
      })
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
    window.setTimeout(() => {
      void runFastQueue(nextSeed, total, seats, strats)
    }, 0)
  }

  const [online, setOnline] = useState(false)

  if (online) {
    return <OnlinePlay onBack={() => setOnline(false)} />
  }

  if (runs.length === 0 && !debug) {
    return (
      <Lobby
        onOnline={() => setOnline(true)}
        onStart={(next, nextSeed, nextDebug, seats, queue, strats, rules) => {
          if (nextDebug) {
            startDebugSession(nextSeed, seats, queue, strats, rules)
            return
          }
          setScoreRules(rules)
          setMatch((value) => value + 1)
          setSeed(nextSeed)
          setSeatCount(seats)
          setDebug(false)
          const tracker = new BalanceTracker(nextSeed)
          tracker.start(next)
          setRuns([{ seed: nextSeed, game: next, tracker, stuck: false, stall: 0 }])
          setFocus(0)
        }}
      />
    )
  }

  if (debug) {
    return (
      <Table
        key={match}
        game={game}
        seed={seed}
        stuck={stuck}
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
        onAction={send}
        onLobby={leave}
      />
    )
  }

  return (
    <Table
      key={match}
      game={game!}
      seed={seed}
      stuck={stuck}
      onAction={send}
      onLobby={leave}
    />
  )
}

function Lobby({
  onStart,
  onOnline,
}: {
  onOnline: () => void
  onStart: (
    game: Game,
    seed: number,
    debug: boolean,
    seats: SeatCount,
    queue: number,
    strats: AiStrat[],
    rules: ScoreRules,
  ) => void
}) {
  const [seedText, setSeedText] = useState('')
  const [debugMode, setDebugMode] = useState(false)
  const [count, setCount] = useState<SeatCount>(2)
  const [seats, setSeats] = useState<LobbySeat[]>(() => defaultSeats(2))
  const [queue, setQueue] = useState(1)
  const [fault, setFault] = useState('')
  const [glossary, setGlossary] = useState(false)
  const [scoreOpen, setScoreOpen] = useState(false)
  const [lobbyRules, setLobbyRules] = useState<ScoreRules>(() => cloneRules(getScoreRules()))

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
        : { ...DEFAULT_SCORE_RULES, ancientEndgame: lobbyRules.ancientEndgame }
      onStart(
        createGame({ seed, seats: roster, ancientEndgame: rules.ancientEndgame }),
        seed,
        debug,
        count,
        debug ? queue : 1,
        strats,
        rules,
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
        <p className="lede">Each player scores for themselves. Two actions a turn — draw a card, or play one. Three terrains are free (never a single River, Jungle, or Lane): three of a kind or a mixed path both score 5; three of a kind also takes a hidden reward. Heroes score in teams by attribute — core up to 15, mix up to 12 with an attack bonus.</p>
        <dl>
          <div><dt>Deck</dt><dd>127 heroes, 36 items, 36 terrains</dd></div>
          <div><dt>Hand</dt><dd>Five to open. Seven is the limit.</dd></div>
          <div><dt>End</dt><dd>Ancient final round, or when the deck is empty.</dd></div>
        </dl>
      </div>
      <form className="lobby-card" onSubmit={(event) => event.preventDefault()}>
        <h2>Sit down</h2>
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
        <fieldset className="debug-lobby">
          <legend>Match options</legend>
          <label className="check-row">
            <input
              data-testid="lobby-ancient-endgame"
              type="checkbox"
              checked={lobbyRules.ancientEndgame}
              onChange={(event) => setLobbyRules((current) => ({ ...current, ancientEndgame: event.target.checked }))}
            />
            Ancient endgame
          </label>
          <p className="quiet">
            {lobbyRules.ancientEndgame
              ? 'The Ancient is in the deck: draw reveal awards +10, then each seat gets one final turn.'
              : 'No Ancient — the match ends when the shared deck empties.'}
          </p>
          <label className="check-row">
            <input
              data-testid="lobby-debug"
              type="checkbox"
              checked={debugMode}
              onChange={(event) => setDebugMode(event.target.checked)}
            />
            Debug balance
          </label>
          <p className="quiet">
            {debugMode
              ? 'All seats run as AI. Sims run in the background at full speed; open Watch to slow the board.'
              : 'Tick to run AI balance sims with stats instead of a normal match.'}
          </p>
          {debugPreview ? (
            <>
              <label>
                Sequential games
                <input
                  data-testid="lobby-parallel"
                  type="number"
                  min={1}
                  max={MAX_QUEUE}
                  value={queue}
                  onChange={(event) => setQueue(Math.max(1, Math.min(MAX_QUEUE, Number(event.target.value) || 1)))}
                />
              </label>
              <p className="quiet">
                Sims one game at a time at full speed in Stats. Open Watch to slow the board. Queue up to {MAX_QUEUE}.
              </p>
              <button type="button" data-testid="lobby-scoring" onClick={() => setScoreOpen(true)}>
                Scoring…
              </button>
              <p className="quiet">
                Core combo {lobbyRules.coreCombo} · mix combo {lobbyRules.mixCombo}
                {lobbyRules.attackOnCore ? ' · atk on core' : ''}
                {lobbyRules.attackOnMix ? ' · atk on mix' : ''}
                {lobbyRules.ancientEndgame ? ' · Ancient on' : ' · Ancient off'}
              </p>
            </>
          ) : null}
        </fieldset>
        <p className="quiet">
          {debugPreview
            ? 'Seat strats apply to every simulated match. Blank seed rolls a random start.'
            : humans >= 2
              ? 'Multiple humans pass the seat automatically.'
              : humans === 1
                ? 'You go first. AI seats take their turns on their own.'
                : 'All AI is fine for spectating and debugging.'}
        </p>
        <button type="button" className="primary block" data-testid="play-solo" onClick={start}>
          {debugPreview ? `Sim ${queue} game${queue === 1 ? '' : 's'}` : 'Start match'}
        </button>
        <button type="button" className="block" data-testid="play-online" onClick={onOnline}>Play online (ranked)</button>
        <button type="button" className="block" data-testid="glossary-open" onClick={() => setGlossary(true)}>Glossary</button>
        <label>
          Seed
          <input
            data-testid="seed"
            placeholder="Random"
            value={seedText}
            onChange={(event) => setSeedText(event.target.value)}
          />
        </label>
        {fault ? <p className="warn">{fault}</p> : null}
      </form>
      {glossary ? <Glossary onClose={() => setGlossary(false)} /> : null}
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
            <p className="quiet">These rules apply when you start the debug match. Attack bonus can be enabled separately for core and mix teams.</p>
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
