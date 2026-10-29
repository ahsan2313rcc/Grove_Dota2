import type { Action, Game } from '../game/types.ts'
import type { ClientMsg, PublicPlayer, ServerMsg } from '../shared/protocol.ts'

export type OnlinePlayer = PublicPlayer

export type OnlineHandlers = {
  onHello?: () => void
  onAuth?: (player: OnlinePlayer) => void
  onAuthErr?: (message: string) => void
  onQueued?: (seats: number, waiting: number) => void
  onQueueLeft?: () => void
  onMatch?: (info: { roomId: string; seat: number; seats: number; players: { name: string; mmr: number }[] }) => void
  onState?: (info: { roomId: string; seat: number; seed: number; game: Game }) => void
  onMatchOver?: (info: Extract<ServerMsg, { type: 'match_over' }>) => void
  onLeaderboard?: (rows: OnlinePlayer[]) => void
  onError?: (message: string) => void
  onClose?: () => void
}

function wsUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined
  if (configured) return configured
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  if (import.meta.env.DEV) return `${protocol}//${window.location.hostname}:8787/ws`
  return `${protocol}//${window.location.host}/ws`
}

export class GroveSocket {
  private ws: WebSocket | null = null
  private handlers: OnlineHandlers = {}

  connect(handlers: OnlineHandlers) {
    this.handlers = handlers
    this.ws = new WebSocket(wsUrl())
    this.ws.onclose = () => this.handlers.onClose?.()
    this.ws.onerror = () => this.handlers.onError?.('Could not reach the online server.')
    this.ws.onmessage = (event) => this.handle(String(event.data))
  }

  private handle(raw: string) {
    let msg: ServerMsg
    try {
      msg = JSON.parse(raw) as ServerMsg
    } catch {
      return
    }
    switch (msg.type) {
      case 'hello':
        this.handlers.onHello?.()
        break
      case 'auth_ok':
        this.handlers.onAuth?.(msg.player)
        break
      case 'auth_err':
        this.handlers.onAuthErr?.(msg.message)
        break
      case 'queued':
        this.handlers.onQueued?.(msg.seats, msg.waiting)
        break
      case 'queue_left':
        this.handlers.onQueueLeft?.()
        break
      case 'match':
        this.handlers.onMatch?.(msg)
        break
      case 'state':
        this.handlers.onState?.(msg)
        break
      case 'match_over':
        this.handlers.onMatchOver?.(msg)
        break
      case 'leaderboard':
        this.handlers.onLeaderboard?.(msg.rows)
        break
      case 'error':
        this.handlers.onError?.(msg.message)
        break
      default:
        break
    }
  }

  private send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  register(name: string, password: string) {
    this.send({ type: 'register', name, password })
  }

  login(name: string, password: string) {
    this.send({ type: 'login', name, password })
  }

  queue(seats: 2 | 3 | 4 = 2) {
    this.send({ type: 'queue', seats })
  }

  cancelQueue() {
    this.send({ type: 'cancel_queue' })
  }

  action(action: Action) {
    this.send({ type: 'action', action })
  }

  leaveMatch() {
    this.send({ type: 'leave_match' })
  }

  close() {
    this.ws?.close()
    this.ws = null
  }
}
