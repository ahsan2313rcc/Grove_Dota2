import { useEffect, useRef, useState } from 'react'
import { chooseAiAction } from './game/ai.ts'
import { apply, createGame, type SeatSpec } from './game/engine.ts'
import { log } from './game/flow.ts'
import type { Action, Game } from './game/types.ts'
import { Glossary } from './ui/Glossary.tsx'
import { Table } from './ui/Table.tsx'

export type SeatCount = 2 | 3 | 4 | 5 | 6 | 7 | 8

const SEAT_OPTIONS: SeatCount[] = [2, 3, 4, 5, 6, 7, 8]

type LobbySeat = { name: string; kind: 'human' | 'ai' }

function defaultSeats(count: SeatCount): LobbySeat[] {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return { name: 'You', kind: 'human' as const }
    if (index === 1) return { name: 'The Grove', kind: 'ai' as const }
    return { name: `Player ${index + 1}`, kind: 'ai' as const }
  })
}

function readStart(): { game: Game; seed: number } | null {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')
  if (mode !== 'ai' && mode !== 'hotseat') return null
  const raw = Number(params.get('seed'))
  const seed = params.get('seed') && Number.isFinite(raw) ? Math.floor(raw) || 1 : Math.floor(Date.now() % 100000) || 1
  const seatRaw = Number(params.get('seats'))
  const count: SeatCount = SEAT_OPTIONS.includes(seatRaw as SeatCount) ? seatRaw as SeatCount : 2
  const seats: SeatSpec[] = mode === 'hotseat'
    ? Array.from({ length: count }, (_, index) => ({
      name: index === 0 ? 'Player 1' : `Player ${index + 1}`,
      ai: false,
    }))
    : defaultSeats(count).map((seat) => ({ name: seat.name, ai: seat.kind === 'ai' }))
  if (mode === 'ai' && seats.every((seat) => seat.ai)) seats[0] = { name: 'You', ai: false }
  return { game: createGame({ seed, seats }), seed }
}

export default function App() {
  const boot = useState(readStart)[0]
  const [game, setGame] = useState<Game | null>(boot?.game ?? null)
  const [seed, setSeed] = useState(boot?.seed ?? 1)
  const [match, setMatch] = useState(boot ? 1 : 0)
  const [stuck, setStuck] = useState(false)
  const repeats = useRef(0)

  useEffect(() => {
    if (!game || game.over || game.veil || game.pending || stuck) return
    if (!game.players[game.active]?.ai) return
    const timer = window.setTimeout(() => {
      let next: Game
      try {
        next = apply(game, chooseAiAction(game))
      } catch (error) {
        const text = error instanceof Error ? error.message : 'The Grove could not finish a play.'
        setGame(log(game, text))
        return
      }
      const same = next === game || (next.active === game.active && next.turn === game.turn && next.log.at(-1) === game.log.at(-1) && next.deck.length === game.deck.length && !next.pending)
      if (same) {
        repeats.current += 1
        if (repeats.current > 3) setStuck(true)
        else setGame(next)
        return
      }
      repeats.current = 0
      setGame(next)
    }, 420)
    return () => window.clearTimeout(timer)
  }, [game, stuck])

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

  function leave() {
    window.history.replaceState({}, '', window.location.pathname)
    setGame(null)
    setStuck(false)
  }

  if (!game) {
    return (
      <Lobby
        onStart={(next, nextSeed) => {
          setMatch((value) => value + 1)
          setSeed(nextSeed)
          setGame(next)
        }}
      />
    )
  }

  return <Table key={match} game={game} seed={seed} stuck={stuck} onAction={send} onLobby={leave} />
}

function Lobby({ onStart }: { onStart: (game: Game, seed: number) => void }) {
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
    const parsed = Number(seedText)
    const seed = seedText.trim() && Number.isFinite(parsed) ? Math.floor(parsed) || 1 : Math.floor(Date.now() % 100000) || 1
    const roster: SeatSpec[] = seats.map((seat, index) => ({
      name: seat.name.trim() || (seat.kind === 'ai' ? (index === 1 ? 'The Grove' : `Grove ${index + 1}`) : `Player ${index + 1}`),
      ai: seat.kind === 'ai',
    }))
    if (!roster.some((seat) => !seat.ai)) {
      setFault('Keep at least one human seat.')
      return
    }
    try {
      onStart(createGame({ seed, seats: roster }), seed)
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The deck could not be dealt.')
    }
  }

  const humans = seats.filter((seat) => seat.kind === 'human').length

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
          {humans >= 2
            ? 'Multiple humans pass the seat automatically.'
            : humans === 1
              ? 'You go first. AI seats take their turns on their own.'
              : 'Keep at least one human seat.'}
        </p>
        <button type="button" className="primary block" data-testid="play-solo" onClick={start}>Start match</button>
        <button type="button" className="block" data-testid="glossary-open" onClick={() => setGlossary(true)}>Glossary</button>
        <label>
          Seed
          <input data-testid="seed" inputMode="numeric" placeholder="Random" value={seedText} onChange={(event) => setSeedText(event.target.value)} />
        </label>
        {fault ? <p className="warn">{fault}</p> : null}
      </form>
      {glossary ? <Glossary onClose={() => setGlossary(false)} /> : null}
    </main>
  )
}
