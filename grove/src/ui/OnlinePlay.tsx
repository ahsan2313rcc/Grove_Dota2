import { useEffect, useRef, useState } from 'react'
import type { Action, Game } from '../game/types.ts'
import { GroveSocket, type OnlinePlayer } from '../online/socket.ts'
import { Table } from './Table.tsx'

type Phase = 'connect' | 'auth' | 'lobby' | 'queued' | 'match' | 'over'

export function OnlinePlay({ onBack }: { onBack: () => void }) {
  const socket = useRef<GroveSocket | null>(null)
  const [phase, setPhase] = useState<Phase>('connect')
  const [status, setStatus] = useState('Connecting…')
  const [fault, setFault] = useState('')
  const [player, setPlayer] = useState<OnlinePlayer | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [party, setParty] = useState<2 | 3 | 4>(2)
  const [waiting, setWaiting] = useState(0)
  const [board, setBoard] = useState<{ game: Game; seat: number; seed: number; roomId: string } | null>(null)
  const [over, setOver] = useState<{
    scores: number[]
    placement: number
    mmrDelta: number
    mmr: number
    players: { name: string; mmr: number; delta: number }[]
  } | null>(null)
  const [leaders, setLeaders] = useState<OnlinePlayer[]>([])

  useEffect(() => {
    const client = new GroveSocket()
    socket.current = client
    client.connect({
      onHello: () => {
        setPhase('auth')
        setStatus('Connected. Register or log in.')
      },
      onAuth: (next) => {
        setPlayer(next)
        setPhase('lobby')
        setStatus(`Signed in as ${next.name}`)
        setFault('')
      },
      onAuthErr: (message) => setFault(message),
      onQueued: (seats, count) => {
        setParty(seats as 2 | 3 | 4)
        setWaiting(count)
        setPhase('queued')
        setStatus(`In queue for ${seats}p · ${count} waiting`)
      },
      onQueueLeft: () => {
        setPhase('lobby')
        setStatus('Left queue.')
      },
      onMatch: (info) => {
        setPhase('match')
        setOver(null)
        setStatus(`Matched · seat ${info.seat + 1}`)
      },
      onState: (info) => {
        setBoard({ game: info.game, seat: info.seat, seed: info.seed, roomId: info.roomId })
        setPhase(info.game.over ? 'over' : 'match')
      },
      onMatchOver: (info) => {
        setOver(info)
        setPhase('over')
        setPlayer((current) => (current ? { ...current, mmr: info.mmr } : current))
        setStatus(`Match over · ${info.mmrDelta >= 0 ? '+' : ''}${info.mmrDelta} MMR`)
      },
      onLeaderboard: (rows) => setLeaders(rows),
      onError: (message) => setFault(message),
      onClose: () => {
        setPhase('connect')
        setStatus('Disconnected.')
      },
    })
    return () => client.close()
  }, [])

  function sendAction(action: Action) {
    socket.current?.action(action)
  }

  if (phase === 'match' && board) {
    return (
      <Table
        game={board.game}
        seed={board.seed}
        stuck={false}
        onlineSeat={board.seat}
        onAction={sendAction}
        onLobby={() => {
          socket.current?.leaveMatch()
          setBoard(null)
          setPhase('lobby')
        }}
      />
    )
  }

  return (
    <main className="lobby">
      <div className="lobby-copy">
        <p className="eyebrow">Ranked Grove</p>
        <h1>Online</h1>
        <p className="lede">Register, queue by MMR, and play live. The server runs the rules; opponents never see your hand.</p>
        {player ? (
          <dl>
            <div><dt>You</dt><dd>{player.name}</dd></div>
            <div><dt>MMR</dt><dd>{player.mmr}</dd></div>
            <div><dt>Record</dt><dd>{player.wins}-{player.losses}-{player.draws}</dd></div>
          </dl>
        ) : null}
      </div>
      <form className="lobby-card" onSubmit={(event) => event.preventDefault()}>
        <h2>{phase === 'auth' || phase === 'connect' ? 'Account' : 'Matchmaking'}</h2>
        <p className="quiet" data-testid="online-status">{status}</p>
        {fault ? <p className="warn">{fault}</p> : null}

        {(phase === 'auth' || phase === 'connect') && (
          <>
            <label>
              Name
              <input data-testid="online-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={24} />
            </label>
            <label>
              Password
              <input data-testid="online-pass" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <button type="button" className="primary block" data-testid="online-register" onClick={() => socket.current?.register(name, password)}>
              Register
            </button>
            <button type="button" className="block" data-testid="online-login" onClick={() => socket.current?.login(name, password)}>
              Log in
            </button>
          </>
        )}

        {phase === 'lobby' && (
          <>
            <fieldset className="player-count">
              <legend>Party size</legend>
              <div className="layout-picks" role="group" aria-label="Party size">
                {([2, 3, 4] as const).map((size) => (
                  <button key={size} type="button" className={party === size ? 'on' : ''} onClick={() => setParty(size)}>
                    {size}
                  </button>
                ))}
              </div>
            </fieldset>
            <button type="button" className="primary block" data-testid="online-queue" onClick={() => socket.current?.queue(party)}>
              Find match
            </button>
          </>
        )}

        {phase === 'queued' && (
          <button type="button" className="block" data-testid="online-cancel" onClick={() => socket.current?.cancelQueue()}>
            Cancel queue ({waiting} waiting)
          </button>
        )}

        {phase === 'over' && over && (
          <div className="online-over">
            <p>Place #{over.placement}</p>
            <p>MMR {over.mmrDelta >= 0 ? '+' : ''}{over.mmrDelta} → {over.mmr}</p>
            <ul>
              {over.players.map((entry) => (
                <li key={entry.name}>{entry.name}: {entry.mmr} ({entry.delta >= 0 ? '+' : ''}{entry.delta})</li>
              ))}
            </ul>
            <button
              type="button"
              className="primary block"
              onClick={() => {
                setOver(null)
                setBoard(null)
                setPhase('lobby')
              }}
            >
              Back to lobby
            </button>
          </div>
        )}

        {leaders.length > 0 && (
          <div className="online-leaders">
            <h3>Leaderboard</h3>
            <ol>
              {leaders.slice(0, 8).map((row) => (
                <li key={row.id}>{row.name} · {row.mmr}</li>
              ))}
            </ol>
          </div>
        )}

        <button type="button" className="block" onClick={onBack}>Local play</button>
      </form>
    </main>
  )
}
