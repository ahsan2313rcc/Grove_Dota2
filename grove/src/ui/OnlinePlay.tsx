import { useEffect, useRef, useState } from 'react'
import type { Action, Game } from '../game/types.ts'
import { loadOnlineAuth, saveOnlineAuth } from '../local/save.ts'
import { GroveSocket, type OnlinePlayer } from '../online/socket.ts'
import { Table } from './Table.tsx'

type Phase = 'connect' | 'auth' | 'lobby' | 'queued' | 'match' | 'over' | 'reconnect'

export function OnlinePlay({ onBack }: { onBack: () => void }) {
  const socket = useRef<GroveSocket | null>(null)
  const boardRef = useRef<{ game: Game; seat: number; seed: number; roomId: string } | null>(null)
  const playerRef = useRef<OnlinePlayer | null>(null)
  const authRef = useRef(loadOnlineAuth())
  const reconnectTimer = useRef<number | null>(null)
  const reconnectAttempt = useRef(0)
  const intentionalClose = useRef(false)

  const [phase, setPhase] = useState<Phase>('connect')
  const [status, setStatus] = useState('Connecting…')
  const [fault, setFault] = useState('')
  const [player, setPlayer] = useState<OnlinePlayer | null>(null)
  const [name, setName] = useState(authRef.current?.name ?? '')
  const [password, setPassword] = useState(authRef.current?.password ?? '')
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
    boardRef.current = board
  }, [board])
  useEffect(() => {
    playerRef.current = player
  }, [player])

  function clearReconnectTimer() {
    if (reconnectTimer.current !== null) {
      window.clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
  }

  function attach(client: GroveSocket) {
    client.connect({
      onHello: () => {
        const saved = authRef.current
        if (saved?.name && saved.password) {
          setStatus('Reconnected. Signing in…')
          client.login(saved.name, saved.password)
          return
        }
        setPhase('auth')
        setStatus('Connected. Register or log in.')
      },
      onAuth: (next) => {
        setPlayer(next)
        setFault('')
        setStatus(`Signed in as ${next.name}`)
        // Resume sends match/state right after auth — don't clobber that phase.
        setPhase((current) => (
          current === 'match' || current === 'over' || current === 'queued' ? current : 'lobby'
        ))
      },
      onAuthErr: (message) => {
        setFault(message)
        setPhase('auth')
        setStatus('Sign in failed.')
      },
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
        reconnectAttempt.current = 0
        setStatus(`Returned to match · seat ${info.seat + 1}`)
      },
      onState: (info) => {
        const next = { game: info.game, seat: info.seat, seed: info.seed, roomId: info.roomId }
        setBoard(next)
        boardRef.current = next
        setPhase(info.game.over ? 'over' : 'match')
        reconnectAttempt.current = 0
        if (!info.game.over) setStatus(`In match · seat ${info.seat + 1}`)
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
        if (intentionalClose.current) return
        const hadMatch = !!boardRef.current && !boardRef.current.game.over
        if (hadMatch || playerRef.current) {
          setPhase('reconnect')
          setStatus('Disconnected. Reconnecting…')
          scheduleReconnect()
          return
        }
        setPhase('connect')
        setStatus('Disconnected.')
        scheduleReconnect()
      },
    })
  }

  function scheduleReconnect() {
    clearReconnectTimer()
    const attempt = reconnectAttempt.current
    const delay = Math.min(12_000, 800 + attempt * 700)
    reconnectAttempt.current = attempt + 1
    reconnectTimer.current = window.setTimeout(() => {
      setStatus(attempt === 0 ? 'Reconnecting…' : `Reconnecting (try ${attempt + 1})…`)
      const client = new GroveSocket()
      socket.current = client
      attach(client)
    }, delay)
  }

  useEffect(() => {
    intentionalClose.current = false
    const client = new GroveSocket()
    socket.current = client
    attach(client)
    return () => {
      intentionalClose.current = true
      clearReconnectTimer()
      client.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, [])

  function sendAction(action: Action) {
    socket.current?.action(action)
  }

  function rememberAuth(nextName: string, nextPassword: string) {
    authRef.current = { name: nextName, password: nextPassword }
    saveOnlineAuth(nextName, nextPassword)
  }

  if ((phase === 'match' || phase === 'reconnect') && board && !board.game.over) {
    return (
      <>
        {phase === 'reconnect' ? (
          <div className="reconnect-banner" data-testid="online-reconnect-banner" role="status">
            <p>{status}</p>
            <button
              type="button"
              data-testid="online-reconnect-now"
              onClick={() => {
                reconnectAttempt.current = 0
                scheduleReconnect()
              }}
            >
              Retry now
            </button>
          </div>
        ) : null}
        <Table
          game={board.game}
          seed={board.seed}
          stuck={false}
          onlineSeat={board.seat}
          onAction={sendAction}
          onLobby={() => {
            socket.current?.leaveMatch()
            setBoard(null)
            boardRef.current = null
            setPhase('lobby')
            setStatus('Left match.')
          }}
        />
      </>
    )
  }

  return (
    <main className="lobby">
      <div className="lobby-copy">
        <p className="eyebrow">Ranked Grove</p>
        <h1>Online</h1>
        <p className="lede">Register, queue by MMR, and play live. The server runs the rules; opponents never see your hand. Dropped connections can return to the same match for a few minutes.</p>
        {player ? (
          <dl>
            <div><dt>You</dt><dd>{player.name}</dd></div>
            <div><dt>MMR</dt><dd>{player.mmr}</dd></div>
            <div><dt>Record</dt><dd>{player.wins}-{player.losses}-{player.draws}</dd></div>
          </dl>
        ) : null}
      </div>
      <form className="lobby-card" onSubmit={(event) => event.preventDefault()}>
        <h2>
          {phase === 'auth' || phase === 'connect' || phase === 'reconnect'
            ? 'Account'
            : 'Matchmaking'}
        </h2>
        <p className="quiet" data-testid="online-status">{status}</p>
        {fault ? <p className="warn">{fault}</p> : null}

        {(phase === 'auth' || phase === 'connect' || phase === 'reconnect') && (
          <>
            <label>
              Name
              <input data-testid="online-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={24} />
            </label>
            <label>
              Password
              <input data-testid="online-pass" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <button
              type="button"
              className="primary block"
              data-testid="online-register"
              onClick={() => {
                rememberAuth(name, password)
                socket.current?.register(name, password)
              }}
            >
              Register
            </button>
            <button
              type="button"
              className="block"
              data-testid="online-login"
              onClick={() => {
                rememberAuth(name, password)
                socket.current?.login(name, password)
              }}
            >
              Log in
            </button>
            {phase === 'reconnect' ? (
              <button
                type="button"
                className="block"
                data-testid="online-reconnect-now"
                onClick={() => {
                  reconnectAttempt.current = 0
                  scheduleReconnect()
                }}
              >
                Reconnect
              </button>
            ) : null}
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
                boardRef.current = null
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
