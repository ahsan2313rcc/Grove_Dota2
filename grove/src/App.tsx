import { useEffect, useRef, useState } from 'react'
import { chooseAiAction } from './game/ai.ts'
import { apply, createGame } from './game/engine.ts'
import { log } from './game/flow.ts'
import type { Action, Game } from './game/types.ts'
import { Table } from './ui/Table.tsx'

function readStart(): { game: Game; seed: number } | null {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')
  if (mode !== 'ai' && mode !== 'hotseat') return null
  const raw = Number(params.get('seed'))
  const seed = params.get('seed') && Number.isFinite(raw) ? Math.floor(raw) || 1 : Math.floor(Date.now() % 100000) || 1
  return { game: createGame({ seed, mode }), seed }
}

export default function App() {
  const boot = useState(readStart)[0]
  const [game, setGame] = useState<Game | null>(boot?.game ?? null)
  const [seed, setSeed] = useState(boot?.seed ?? 1)
  const [match, setMatch] = useState(boot ? 1 : 0)
  const [stuck, setStuck] = useState(false)
  const repeats = useRef(0)

  useEffect(() => {
    if (!game || game.mode !== 'ai' || game.over || game.veil || game.pending || game.active !== 1 || stuck) return
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
    return <Lobby onStart={(next, nextSeed) => { setMatch((value) => value + 1); setSeed(nextSeed); setGame(next) }} />
  }

  return <Table key={match} game={game} seed={seed} stuck={stuck} onAction={send} onLobby={leave} />
}

function Lobby({ onStart }: { onStart: (game: Game, seed: number) => void }) {
  const [seedText, setSeedText] = useState('')
  const [radiant, setRadiant] = useState('Radiant')
  const [dire, setDire] = useState('Dire')
  const [fault, setFault] = useState('')

  function start(mode: 'ai' | 'hotseat') {
    const parsed = Number(seedText)
    const seed = seedText.trim() && Number.isFinite(parsed) ? Math.floor(parsed) || 1 : Math.floor(Date.now() % 100000) || 1
    const names: [string, string] = mode === 'ai'
      ? ['You', 'The Grove']
      : [radiant.trim() || 'Radiant', dire.trim() || 'Dire']
    try {
      onStart(createGame({ seed, mode, names }), seed)
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The deck could not be dealt.')
    }
  }

  return (
    <main className="lobby">
      <div className="lobby-copy">
        <p className="eyebrow">A shared deck of heroes</p>
        <h1>Grove</h1>
        <p className="lede">Two actions a turn. Draw a card, or play one. Three settings are free: three of a kind scores 3 and takes a hidden reward, a mixed path scores 5. Heroes score in teams by attribute, and a mixed team can add a melee or ranged bonus.</p>
        <dl>
          <div><dt>Deck</dt><dd>127 heroes, 36 items, 36 settings</dd></div>
          <div><dt>Hand</dt><dd>Five to open. Seven is the limit.</dd></div>
          <div><dt>End</dt><dd>The match ends when the deck is empty.</dd></div>
        </dl>
      </div>
      <form className="lobby-card" onSubmit={(event) => event.preventDefault()}>
        <h2>Sit down</h2>
        <button type="button" className="primary block" data-testid="play-solo" onClick={() => start('ai')}>Play the Grove</button>
        <p className="quiet">You go first against the Grove.</p>
        <label>
          Radiant
          <input value={radiant} onChange={(event) => setRadiant(event.target.value)} maxLength={24} />
        </label>
        <label>
          Dire
          <input value={dire} onChange={(event) => setDire(event.target.value)} maxLength={24} />
        </label>
        <button type="button" className="block" data-testid="play-hotseat" onClick={() => start('hotseat')}>Pass and play</button>
        <label>
          Seed
          <input data-testid="seed" inputMode="numeric" placeholder="Random" value={seedText} onChange={(event) => setSeedText(event.target.value)} />
        </label>
        {fault ? <p className="warn">{fault}</p> : null}
      </form>
    </main>
  )
}
