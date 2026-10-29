import { useEffect, useRef, useState } from 'react'
import { chooseAiAction } from './game/ai.ts'
import { apply, createGame, type SeatSpec } from './game/engine.ts'
import { log } from './game/flow.ts'
import type { Action, Game } from './game/types.ts'
import { Glossary } from './ui/Glossary.tsx'
import { type DebugSpeed } from './ui/DebugRail.tsx'
import { Table } from './ui/Table.tsx'

export type SeatCount = 2 | 3 | 4 | 5 | 6 | 7 | 8

const SEAT_OPTIONS: SeatCount[] = [2, 3, 4, 5, 6, 7, 8]
const BASE_TICK_MS = 420

type LobbySeat = { name: string; kind: 'human' | 'ai' }

function defaultSeats(count: SeatCount): LobbySeat[] {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return { name: 'You', kind: 'human' as const }
    if (index === 1) return { name: 'The Grove', kind: 'ai' as const }
    return { name: `Player ${index + 1}`, kind: 'ai' as const }
  })
}

function parseSeedInput(raw: string): { seed: number; debug: boolean } | null {
  const text = raw.trim()
  if (!text) return null
  const debug = /^ahsan-(\d+)$/i.exec(text)
  if (debug) return { seed: Math.floor(Number(debug[1])) || 1, debug: true }
  const parsed = Number(text)
  if (Number.isFinite(parsed)) return { seed: Math.floor(parsed) || 1, debug: false }
  return null
}

function readStart(): { game: Game; seed: number; debug: boolean } | null {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')
  if (mode !== 'ai' && mode !== 'hotseat' && mode !== 'debug') return null
  const seedParam = params.get('seed') ?? ''
  const parsed = parseSeedInput(seedParam.startsWith('ahsan-') ? seedParam : seedParam ? String(Number(seedParam) || 1) : '')
  const seed = parsed?.seed ?? (Math.floor(Date.now() % 100000) || 1)
  const debug = mode === 'debug' || !!parsed?.debug
  const seatRaw = Number(params.get('seats'))
  const count: SeatCount = SEAT_OPTIONS.includes(seatRaw as SeatCount) ? seatRaw as SeatCount : 2
  const seats: SeatSpec[] = debug || mode === 'ai'
    ? Array.from({ length: count }, (_, index) => ({
      name: index === 0 ? (debug ? 'AI 1' : 'You') : index === 1 ? 'The Grove' : `Player ${index + 1}`,
      ai: debug ? true : index !== 0,
    }))
    : Array.from({ length: count }, (_, index) => ({
      name: index === 0 ? 'Player 1' : `Player ${index + 1}`,
      ai: false,
    }))
  if (debug) {
    for (let index = 0; index < seats.length; index += 1) {
      seats[index] = { name: seats[index]?.name || `AI ${index + 1}`, ai: true }
    }
  }
  return { game: createGame({ seed, seats }), seed, debug }
}

function advanceAi(game: Game): Game {
  if (game.over) return game
  if (game.veil) return apply(game, { type: 'ready' })
  if (game.pending) return game
  if (!game.players[game.active]?.ai) return game
  return apply(game, chooseAiAction(game))
}

export default function App() {
  const boot = useState(readStart)[0]
  const [game, setGame] = useState<Game | null>(boot?.game ?? null)
  const [seed, setSeed] = useState(boot?.seed ?? 1)
  const [debug, setDebug] = useState(boot?.debug ?? false)
  const [debugSpeed, setDebugSpeed] = useState<DebugSpeed>(1)
  const [match, setMatch] = useState(boot ? 1 : 0)
  const [stuck, setStuck] = useState(false)
  const repeats = useRef(0)

  useEffect(() => {
    if (!game || game.over || stuck) return
    if (debug && debugSpeed === 0) return
    if (!game.players[game.active]?.ai && !game.veil) return
    if (game.pending && !game.players[game.pending.actor]?.ai) return
    const delay = debug ? Math.round(BASE_TICK_MS / debugSpeed) : BASE_TICK_MS
    const timer = window.setTimeout(() => {
      let next: Game
      try {
        next = advanceAi(game)
      } catch (error) {
        const text = error instanceof Error ? error.message : 'The Grove could not finish a play.'
        setGame(log(game, text))
        return
      }
      const same = next === game || (next.active === game.active && next.turn === game.turn && next.log.at(-1) === game.log.at(-1) && next.deck.length === game.deck.length && !next.pending && next.veil === game.veil)
      if (same) {
        repeats.current += 1
        if (repeats.current > 3) setStuck(true)
        else setGame(next)
        return
      }
      repeats.current = 0
      setGame(next)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [game, stuck, debug, debugSpeed])

  function send(action: Action) {
    setStuck(false)
    repeats.current = 0
    setGame((current) => {
      if (!current) return current
      try {
        return apply(current, action)
      } catch (error) {
        const text = error instanceof Error ? error.message : 'That play could not resolve.'
        return log(current, text)
      }
    })
  }

  function stepDebug() {
    if (!game || game.over) return
    setStuck(false)
    repeats.current = 0
    try {
      setGame(advanceAi(game))
    } catch (error) {
      const text = error instanceof Error ? error.message : 'The Grove could not finish a play.'
      setGame(log(game, text))
    }
  }

  function leave() {
    window.history.replaceState({}, '', window.location.pathname)
    setGame(null)
    setDebug(false)
    setDebugSpeed(1)
    setStuck(false)
  }

  if (!game) {
    return (
      <Lobby
        onStart={(next, nextSeed, nextDebug) => {
          setMatch((value) => value + 1)
          setSeed(nextSeed)
          setDebug(nextDebug)
          setDebugSpeed(1)
          setStuck(false)
          setGame(next)
        }}
      />
    )
  }

  return (
    <Table
      key={match}
      game={game}
      seed={seed}
      stuck={stuck}
      debug={debug}
      debugSpeed={debugSpeed}
      onDebugSpeed={setDebugSpeed}
      onDebugStep={stepDebug}
      onAction={send}
      onLobby={leave}
    />
  )
}

function Lobby({ onStart }: { onStart: (game: Game, seed: number, debug: boolean) => void }) {
  const [seedText, setSeedText] = useState('')
  const [count, setCount] = useState<SeatCount>(2)
  const [seats, setSeats] = useState<LobbySeat[]>(() => defaultSeats(2))
  const [fault, setFault] = useState('')
  const [glossary, setGlossary] = useState(false)

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
    const roster: SeatSpec[] = seats.map((seat, index) => ({
      name: seat.name.trim() || (debug || seat.kind === 'ai' ? (index === 1 ? 'The Grove' : `AI ${index + 1}`) : `Player ${index + 1}`),
      ai: debug ? true : seat.kind === 'ai',
    }))
    try {
      onStart(createGame({ seed, seats: roster }), seed, debug)
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The deck could not be dealt.')
    }
  }

  const humans = seats.filter((seat) => seat.kind === 'human').length
  const debugPreview = /^ahsan-\d+$/i.test(seedText.trim())

  return (
    <main className="lobby">
      <div className="lobby-copy">
        <p className="eyebrow">A shared deck of heroes</p>
        <h1>Grove</h1>
        <p className="lede">Each player scores for themselves. Two actions a turn — draw a card, or play one. Three settings are free: three of a kind scores 3 and takes a hidden reward, a mixed path scores 5. Heroes score in teams by attribute, and a mixed team can add a melee or ranged bonus.</p>
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
        <ul className="seat-list">
          {seats.map((seat, index) => (
            <li key={index} className="seat-row">
              <label>
                Seat {index + 1}
                <input
                  value={seat.name}
                  onChange={(event) => patchSeat(index, { name: event.target.value })}
                  maxLength={24}
                  data-testid={`name-${index}`}
                />
              </label>
              <div className="kind-picks" role="group" aria-label={`Seat ${index + 1} type`}>
                <button type="button" className={seat.kind === 'human' ? 'on' : ''} data-testid={`kind-human-${index}`} onClick={() => patchSeat(index, { kind: 'human' })}>
                  Human
                </button>
                <button type="button" className={seat.kind === 'ai' ? 'on' : ''} data-testid={`kind-ai-${index}`} onClick={() => patchSeat(index, { kind: 'ai' })}>
                  AI
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className="quiet">
          {debugPreview
            ? 'Debug seed detected. Every seat becomes AI and the match auto-plays.'
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
            placeholder="Random or ahsan-58"
            value={seedText}
            onChange={(event) => setSeedText(event.target.value)}
          />
        </label>
        {fault ? <p className="warn">{fault}</p> : null}
      </form>
      {glossary ? <Glossary onClose={() => setGlossary(false)} /> : null}
    </main>
  )
}
