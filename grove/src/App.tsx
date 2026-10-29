import { useEffect, useMemo, useRef, useState } from 'react'
import { AI_STRATS, chooseAiAction, cycleStrat, DEFAULT_STRAT, isAiStrat, stratLabel } from './game/ai.ts'
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
import { log } from './game/flow.ts'
import { cloneRules, DEFAULT_SCORE_RULES, getScoreRules, resetScoreRules, setScoreRules, type ScoreRules } from './game/scoring.ts'
import type { Action, AiStrat, Game } from './game/types.ts'
import { Glossary } from './ui/Glossary.tsx'
import { type DebugSpeed, type DebugView } from './ui/DebugRail.tsx'
import { ScoreRulesPanel } from './ui/ScoreRulesPanel.tsx'
import { Table } from './ui/Table.tsx'

export type SeatCount = 2 | 3 | 4 | 5 | 6 | 7 | 8

const SEAT_OPTIONS: SeatCount[] = [2, 3, 4, 5, 6, 7, 8]
const BASE_TICK_MS = 420

type LobbySeat = { name: string; kind: 'human' | 'ai'; strat: AiStrat }

type LiveRun = {
  seed: number
  game: Game
  tracker: BalanceTracker
  stuck: boolean
}

function defaultSeats(count: SeatCount): LobbySeat[] {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return { name: 'You', kind: 'human' as const, strat: DEFAULT_STRAT }
    if (index === 1) return { name: 'The Grove', kind: 'ai' as const, strat: 'balanced' }
    return { name: `Player ${index + 1}`, kind: 'ai' as const, strat: cycleStrat(index) }
  })
}

function parseSeedInput(raw: string): { seed: number; debug: boolean } | null {
  const text = raw.trim()
  if (!text) return null
  const debug = /^d(\d+)$/i.exec(text)
  if (debug) return { seed: Math.floor(Number(debug[1])) || 1, debug: true }
  const parsed = Number(text)
  if (Number.isFinite(parsed)) return { seed: Math.floor(parsed) || 1, debug: false }
  return null
}

function makeRun(seed: number, seats: number, strats?: AiStrat[]): LiveRun {
  const game = createGame({ seed, seats: aiRoster(seats, strats, seed) })
  const tracker = new BalanceTracker(seed)
  tracker.start(game)
  return { seed, game, tracker, stuck: false }
}

function advanceTracked(run: LiveRun): LiveRun {
  const game = run.game
  if (game.over) return run
  if (game.veil) {
    const next = apply(game, { type: 'ready' })
    run.tracker.observe(game, { type: 'ready' }, next)
    return { ...run, game: next, stuck: false }
  }
  if (game.pending) {
    if (game.players[game.pending.actor]?.ai || game.autoAll) {
      const next = { ...game, pending: null, log: [...game.log, 'Forced past a stuck choice.'] }
      return { ...run, game: next, stuck: false }
    }
    return run
  }
  if (!game.players[game.active]?.ai) return run
  const action = chooseAiAction(game)
  let next = apply(game, action)
  if (next.pending && (next.players[next.pending.actor]?.ai || next.autoAll)) {
    next = { ...next, pending: null, log: [...next.log, 'Forced past a stuck choice.'] }
  }
  run.tracker.observe(game, action, next)
  const same = next === game
    || (next.active === game.active
      && next.turn === game.turn
      && next.log.at(-1) === game.log.at(-1)
      && next.deck.length === game.deck.length
      && !next.pending
      && next.veil === game.veil)
  return { ...run, game: next, stuck: same }
}

function readStart(): { debug: boolean; seed: number; seats: SeatCount; runs: LiveRun[]; view: DebugView } | null {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')
  if (mode !== 'ai' && mode !== 'hotseat' && mode !== 'debug') return null
  const seedParam = params.get('seed') ?? ''
  const parsed = parseSeedInput(/^d\d+$/i.test(seedParam) ? seedParam : seedParam ? String(Number(seedParam) || 1) : '')
  const seed = parsed?.seed ?? (Math.floor(Date.now() % 100000) || 1)
  const debug = mode === 'debug' || !!parsed?.debug
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
    return { debug: false, seed, seats: count, runs: [{ seed, game, tracker, stuck: false }], view: 'watch' }
  }
  const batch = Math.max(1, Math.min(8, Number(params.get('batch')) || 1))
  const runs = Array.from({ length: batch }, (_, index) => makeRun(seed + index, count))
  return { debug: true, seed, seats: count, runs, view }
}

export default function App() {
  const boot = useState(readStart)[0]
  const [debug, setDebug] = useState(boot?.debug ?? false)
  const [seed, setSeed] = useState(boot?.seed ?? 1)
  const [seatCount, setSeatCount] = useState<SeatCount>(boot?.seats ?? 2)
  const [runs, setRuns] = useState<LiveRun[]>(boot?.runs ?? [])
  const [focus, setFocus] = useState(0)
  const [debugSpeed, setDebugSpeed] = useState<DebugSpeed>(1)
  const [debugView, setDebugView] = useState<DebugView>(boot?.view ?? 'watch')
  const [batchSize, setBatchSize] = useState(4)
  const [reports, setReports] = useState<MatchReport[]>([])
  const [runningBatch, setRunningBatch] = useState(false)
  const [match, setMatch] = useState(boot ? 1 : 0)
  const [batchDone, setBatchDone] = useState(0)
  const [stratFilter, setStratFilter] = useState<StratFilter>(ALL_STRAT_FILTER)
  const [debugStrats, setDebugStrats] = useState<AiStrat[]>(() => Array.from({ length: boot?.seats ?? 2 }, (_, index) => cycleStrat(index)))
  const batchToken = useRef(0)

  const live = runs[Math.min(focus, Math.max(0, runs.length - 1))] ?? null
  const game = live?.game ?? null
  const stuck = live?.stuck ?? false

  const summary = useMemo(() => {
    const liveReports = runs.map((run) => run.tracker.snapshot(run.game))
    return summarizeReports([...reports, ...liveReports], stratFilter)
  }, [reports, runs, stratFilter])

  const finishedCount = reports.filter((report) => report.over).length + runs.filter((run) => run.game.over).length
  const runCount = runningBatch ? batchSize : Math.max(runs.length, 1)

  useEffect(() => {
    if (!debug || debugView === 'stats' || runningBatch) return
    if (runs.length === 0) return
    if (debugSpeed === 0) return
    const open = runs.some((run) => !run.game.over && !run.stuck)
    if (!open) return
    const delay = Math.round(BASE_TICK_MS / debugSpeed)
    const timer = window.setTimeout(() => {
      setRuns((current) => current.map((run) => {
        if (run.game.over || run.stuck) return run
        try {
          return advanceTracked(run)
        } catch (error) {
          const text = error instanceof Error ? error.message : 'The Grove could not finish a play.'
          return { ...run, game: log(run.game, text), stuck: true }
        }
      }))
    }, delay)
    return () => window.clearTimeout(timer)
  }, [debug, debugView, debugSpeed, runs, runningBatch])

  useEffect(() => {
    if (debug) return
    if (!game || game.over || game.veil || game.pending || stuck) return
    if (!game.players[game.active]?.ai) return
    const timer = window.setTimeout(() => {
      setRuns((current) => {
        const run = current[0]
        if (!run) return current
        try {
          return [advanceTracked(run)]
        } catch (error) {
          const text = error instanceof Error ? error.message : 'The Grove could not finish a play.'
          return [{ ...run, game: log(run.game, text), stuck: true }]
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
        return [{ ...run, game: next, stuck: false }]
      } catch (error) {
        const text = error instanceof Error ? error.message : 'That play could not resolve.'
        return [{ ...run, game: log(run.game, text) }]
      }
    })
  }

  function stepDebug() {
    setRuns((current) => current.map((run, index) => {
      if (index !== focus) return run
      if (run.game.over) return run
      try {
        return advanceTracked(run)
      } catch (error) {
        const text = error instanceof Error ? error.message : 'The Grove could not finish a play.'
        return { ...run, game: log(run.game, text), stuck: true }
      }
    }))
  }

  function leave() {
    batchToken.current += 1
    window.history.replaceState({}, '', window.location.pathname)
    setRuns([])
    setReports([])
    setDebug(false)
    setDebugSpeed(1)
    setDebugView('watch')
    setFocus(0)
    setRunningBatch(false)
    setBatchDone(0)
    setStratFilter(ALL_STRAT_FILTER)
    setDebugStrats(Array.from({ length: 2 }, (_, index) => cycleStrat(index)))
    resetScoreRules()
  }

  function resetDebug() {
    if (runningBatch) return
    batchToken.current += 1
    setReports([])
    setBatchDone(0)
    setFocus(0)
    setRunningBatch(false)
    setMatch((value) => value + 1)
    if (debugView === 'stats') {
      setRuns([])
      return
    }
    const count = Math.max(1, Math.min(8, runs.length || 1))
    setRuns(Array.from({ length: count }, (_, index) => makeRun(seed + index, seatCount, debugStrats)))
  }

  async function runBatch() {
    if (runningBatch) return
    const token = ++batchToken.current
    setRunningBatch(true)
    setDebugView('stats')
    setBatchDone(0)
    const baseSeed = seed
    const seats = seatCount
    const strats = debugStrats
    const total = Math.max(1, Math.min(1024, batchSize))
    const chunk: MatchReport[] = []
    const yieldEvery = total >= 64 ? 8 : 1
    for (let index = 0; index < total; index += 1) {
      if (batchToken.current !== token) return
      const report = runMatchFast(baseSeed + index, seats, strats)
      chunk.push(report)
      if (chunk.length >= yieldEvery || index === total - 1) {
        const batch = chunk.splice(0, chunk.length)
        setBatchDone(index + 1)
        setReports((current) => [...current, ...batch])
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
    }
    if (batchToken.current !== token) return
    setRuns([])
    setFocus(0)
    setRunningBatch(false)
  }

  function startWatchFromStats() {
    if (runningBatch) return
    const created = [makeRun(seed, seatCount, debugStrats)]
    setRuns(created)
    setFocus(0)
    setDebugView('watch')
    setDebugSpeed(1)
    setMatch((value) => value + 1)
  }

  function onDebugView(view: DebugView) {
    if (view === 'watch' && runs.length === 0 && !runningBatch) {
      startWatchFromStats()
      return
    }
    setDebugView(view)
  }

  function startDebugSession(nextSeed: number, seats: SeatCount, parallel: number, background: boolean, strats: AiStrat[], rules: ScoreRules) {
    setScoreRules(rules)
    setMatch((value) => value + 1)
    setSeed(nextSeed)
    setSeatCount(seats)
    setDebug(true)
    setDebugSpeed(1)
    setFocus(0)
    setReports([])
    setBatchDone(0)
    setDebugStrats(strats)
    setStratFilter(ALL_STRAT_FILTER)
    if (background) {
      const total = Math.max(1, Math.min(1024, parallel))
      setRuns([])
      setDebugView('stats')
      setBatchSize(total)
      window.setTimeout(() => {
        void (async () => {
          const token = ++batchToken.current
          setRunningBatch(true)
          const chunk: MatchReport[] = []
          const yieldEvery = total >= 64 ? 8 : 1
          for (let index = 0; index < total; index += 1) {
            if (batchToken.current !== token) return
            chunk.push(runMatchFast(nextSeed + index, seats, strats))
            if (chunk.length >= yieldEvery || index === total - 1) {
              const batch = chunk.splice(0, chunk.length)
              setBatchDone(index + 1)
              setReports((current) => [...current, ...batch])
              await new Promise((resolve) => window.setTimeout(resolve, 0))
            }
          }
          if (batchToken.current !== token) return
          setRunningBatch(false)
        })()
      }, 0)
      return
    }
    const count = Math.max(1, Math.min(8, parallel))
    setBatchSize(Math.max(count, 4))
    const created = Array.from({ length: count }, (_, index) => makeRun(nextSeed + index, seats, strats))
    setDebugView('watch')
    setRuns(created)
  }

  if (runs.length === 0 && !debug) {
    return (
      <Lobby
        onStart={(next, nextSeed, nextDebug, seats, parallel, background, strats, rules) => {
          if (nextDebug) {
            startDebugSession(nextSeed, seats, parallel, background, strats, rules)
            return
          }
          setScoreRules(rules)
          setMatch((value) => value + 1)
          setSeed(nextSeed)
          setSeatCount(seats)
          setDebug(false)
          const tracker = new BalanceTracker(nextSeed)
          tracker.start(next)
          setRuns([{ seed: nextSeed, game: next, tracker, stuck: false }])
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
        debugBatchSize={batchSize}
        debugFocus={focus}
        debugRunCount={runCount}
        debugFinished={runningBatch ? batchDone : finishedCount}
        debugRunningBatch={runningBatch}
        debugSummary={summary}
        debugReports={reports}
        debugStratFilter={stratFilter}
        onDebugSpeed={setDebugSpeed}
        onDebugStep={stepDebug}
        onDebugView={onDebugView}
        onDebugBatchSize={setBatchSize}
        onDebugFocus={setFocus}
        onDebugRunBatch={runBatch}
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
}: {
  onStart: (
    game: Game,
    seed: number,
    debug: boolean,
    seats: SeatCount,
    parallel: number,
    background: boolean,
    strats: AiStrat[],
    rules: ScoreRules,
  ) => void
}) {
  const [seedText, setSeedText] = useState('')
  const [count, setCount] = useState<SeatCount>(2)
  const [seats, setSeats] = useState<LobbySeat[]>(() => defaultSeats(2))
  const [parallel, setParallel] = useState(1)
  const [background, setBackground] = useState(false)
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
    const parsed = parseSeedInput(seedText)
    const seed = parsed?.seed ?? (Math.floor(Date.now() % 100000) || 1)
    const debug = !!parsed?.debug
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
      const rules = debug ? lobbyRules : DEFAULT_SCORE_RULES
      onStart(createGame({ seed, seats: roster }), seed, debug, count, debug ? parallel : 1, debug && background, strats, rules)
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The deck could not be dealt.')
    }
  }

  const humans = seats.filter((seat) => seat.kind === 'human').length
  const debugPreview = /^d\d+$/i.test(seedText.trim())

  return (
    <main className="lobby">
      <div className="lobby-copy">
        <p className="eyebrow">A shared deck of heroes</p>
        <h1>Grove</h1>
        <p className="lede">Each player scores for themselves. Two actions a turn — draw a card, or play one. Three settings are free (never a single River, Jungle, or Lane): three of a kind or a mixed path both score 5; three of a kind also takes a hidden reward. Heroes score in teams by attribute — core up to 15, mix up to 12 with an attack bonus.</p>
        <dl>
          <div><dt>Deck</dt><dd>127 heroes, 36 items, 36 settings</dd></div>
          <div><dt>Hand</dt><dd>Five to open. Seven is the limit.</dd></div>
          <div><dt>End</dt><dd>The match ends when the deck is empty.</dd></div>
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
        {debugPreview ? (
          <fieldset className="debug-lobby">
            <legend>Debug runs</legend>
            <label>
              {background ? 'Background games' : 'Live parallel games'}
              <input
                data-testid="lobby-parallel"
                type="number"
                min={1}
                max={background ? 1024 : 8}
                value={parallel}
                onChange={(event) => setParallel(Math.max(1, Math.min(background ? 1024 : 8, Number(event.target.value) || 1)))}
              />
            </label>
            <label className="check-row">
              <input
                data-testid="lobby-background"
                type="checkbox"
                checked={background}
                onChange={(event) => {
                  const next = event.target.checked
                  setBackground(next)
                  if (!next && parallel > 8) setParallel(8)
                }}
              />
              Run in background (stats only)
            </label>
            <p className="quiet">
              {background
                ? `Simulates up to ${parallel} AI matches (max 1024) using the seat strats above.`
                : parallel > 1
                  ? `Watches game 1 of ${parallel} (max 8 live). Switch focus in the debug rail.`
                  : 'AI seats auto-play with the strats chosen above.'}
            </p>
            <button type="button" data-testid="lobby-scoring" onClick={() => setScoreOpen(true)}>
              Scoring…
            </button>
            <p className="quiet">
              Core combo {lobbyRules.coreCombo} · mix combo {lobbyRules.mixCombo}
              {lobbyRules.attackOnCore ? ' · atk on core' : ''}
              {lobbyRules.attackOnMix ? ' · atk on mix' : ''}
            </p>
          </fieldset>
        ) : null}
        <p className="quiet">
          {debugPreview
            ? 'Debug seed detected. Seat strats apply to every simulated match.'
            : humans >= 2
              ? 'Multiple humans pass the seat automatically.'
              : humans === 1
                ? 'You go first. AI seats take their turns on their own.'
                : 'All AI is fine for spectating and debugging.'}
        </p>
        <button type="button" className="primary block" data-testid="play-solo" onClick={start}>Start match</button>
        <button type="button" className="block" data-testid="glossary-open" onClick={() => setGlossary(true)}>Glossary</button>
        <label>
          Seed
          <input
            data-testid="seed"
            placeholder="Random or d58"
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
