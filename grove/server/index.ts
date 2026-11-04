import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { scoreState } from '../src/game/flow.ts'
import { applyMatchResult, getPlayer, leaderboard, loginPlayer, publicPlayer, registerPlayer } from './db.ts'
import { eloField } from './elo.ts'
import { tryMatch, waitingCount, type QueueEntry } from './matchmaking.ts'
import { parseClient, type ServerMsg } from './protocol.ts'
import { createRoom, legalActor, placementOf, pushAction, seatView, type Room } from './room.ts'

const PORT = Number(process.env.PORT ?? 8787)
const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')

type Client = {
  id: string
  ws: WebSocket
  playerId: string | null
  roomId: string | null
  seat: number | null
}

/** Soft seat binding — survives socket drops so a player can reconnect. */
type SeatBind = {
  roomId: string
  seat: number
  disconnectedAt: number | null
}

/** Forfeit a disconnected seat after this many ms. */
const DISCONNECT_GRACE_MS = 5 * 60_000

const clients = new Map<string, Client>()
const rooms = new Map<string, Room>()
/** playerId → active match seat (even while socket is down). */
const binds = new Map<string, SeatBind>()
const queue: QueueEntry[] = []
let nextClient = 1
let nextRoom = 1

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function broadcastRoom(room: Room) {
  if (room.finished) {
    for (const seat of room.seats) clearBind(seat.playerId)
  }
  for (const client of clients.values()) {
    if (client.roomId !== room.id || client.seat === null) continue
    send(client.ws, {
      type: 'state',
      roomId: room.id,
      seat: client.seat,
      seed: room.seed,
      game: seatView(room, client.seat),
    })
    if (room.finished && room.result) {
      const delta = room.result.deltas[client.seat] ?? 0
      const mmr = room.result.nextMmrs[client.seat] ?? client.seat
      const row = getPlayer(room.seats[client.seat]!.playerId)
      send(client.ws, {
        type: 'match_over',
        roomId: room.id,
        scores: room.result.scores,
        placement: placementOf(room.result.scores, client.seat),
        mmrDelta: delta,
        mmr: row?.mmr ?? mmr,
        players: room.seats.map((seat, index) => ({
          name: seat.name,
          mmr: room.result!.nextMmrs[index] ?? seat.mmr,
          delta: room.result!.deltas[index] ?? 0,
        })),
      })
    }
  }
}

function enqueue(client: Client, seats: 2 | 3 | 4) {
  if (!client.playerId) {
    send(client.ws, { type: 'error', message: 'Log in first.' })
    return
  }
  const row = getPlayer(client.playerId)
  if (!row) {
    send(client.ws, { type: 'error', message: 'Unknown player.' })
    return
  }
  if (client.roomId || (client.playerId && binds.has(client.playerId))) {
    if (tryResumeMatch(client)) return
    send(client.ws, { type: 'error', message: 'Already in a match.' })
    return
  }
  if (queue.some((entry) => entry.socketId === client.id)) {
    send(client.ws, { type: 'queued', seats, waiting: waitingCount(queue, seats) })
    return
  }
  // One queue entry per player account
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index]!.playerId === row.id) queue.splice(index, 1)
  }
  queue.push({
    playerId: row.id,
    name: row.name,
    mmr: row.mmr,
    seats,
    joinedAt: Date.now(),
    socketId: client.id,
  })
  send(client.ws, { type: 'queued', seats, waiting: waitingCount(queue, seats) })
  matchmake()
}

function cancelQueue(client: Client) {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index]!.socketId === client.id) queue.splice(index, 1)
  }
  send(client.ws, { type: 'queue_left' })
}

function matchmake() {
  for (const seats of [2, 3, 4] as const) {
    for (;;) {
      const matched = tryMatch(queue, seats)
      if (!matched) break
      const roomId = `r${nextRoom++}`
      const room = createRoom(roomId, matched)
      rooms.set(roomId, room)
      for (let seat = 0; seat < matched.length; seat += 1) {
        const playerId = matched[seat]!.playerId
        const client = [...clients.values()].find((entry) => entry.playerId === playerId && !entry.roomId)
        bindSeat(playerId, roomId, seat)
        if (!client) continue
        client.roomId = roomId
        client.seat = seat
        send(client.ws, {
          type: 'match',
          roomId,
          seat,
          seats: matched.length,
          players: matched.map((entry) => ({ name: entry.name, mmr: entry.mmr })),
        })
      }
      broadcastRoom(room)
    }
  }
}

function bindSeat(playerId: string, roomId: string, seat: number) {
  binds.set(playerId, { roomId, seat, disconnectedAt: null })
}

function clearBind(playerId: string | null) {
  if (playerId) binds.delete(playerId)
}

function detachSocket(client: Client) {
  client.roomId = null
  client.seat = null
}

/** Soft drop: keep the room; mark the seat disconnected for grace reconnect. */
function softDisconnect(client: Client) {
  if (!client.playerId || client.roomId === null || client.seat === null) {
    detachSocket(client)
    return
  }
  const bind = binds.get(client.playerId)
  if (bind && bind.roomId === client.roomId) {
    binds.set(client.playerId, { ...bind, disconnectedAt: Date.now() })
  }
  detachSocket(client)
}

function forfeitSeat(room: Room, seat: number, reason: string) {
  if (room.finished) return
  const scores = room.game.players.map((_, index) => (
    index === seat ? -1 : (room.game.over?.scores[index] ?? scoreState(room.game, index).total)
  ))
  const ratings = room.seats.map((entry) => getPlayer(entry.playerId)?.mmr ?? entry.mmr)
  const field = eloField(ratings, scores)
  applyMatchResult(
    room.seats.map((entry) => entry.playerId),
    scores,
    field.next,
  )
  room.finished = true
  room.result = { scores, deltas: field.deltas, nextMmrs: field.next }
  room.game = {
    ...room.game,
    over: room.game.over ?? {
      reason,
      scores,
      parts: scores.map((total) => ({ teams: 0, terrains: 0, total })),
    },
  }
  for (const seatInfo of room.seats) clearBind(seatInfo.playerId)
  broadcastRoom(room)
  // Drop finished rooms once every client has left.
  if ([...clients.values()].every((entry) => entry.roomId !== room.id)) {
    rooms.delete(room.id)
  }
}

function leaveMatch(client: Client) {
  const roomId = client.roomId ?? (client.playerId ? binds.get(client.playerId)?.roomId ?? null : null)
  const seatFromBind = client.playerId ? binds.get(client.playerId)?.seat ?? null : null
  const seat = client.seat ?? seatFromBind
  clearBind(client.playerId)
  detachSocket(client)
  if (!roomId || seat === null) return
  const room = rooms.get(roomId)
  if (!room) return
  if (room.finished) {
    if ([...clients.values()].every((entry) => entry.roomId !== roomId)) rooms.delete(roomId)
    return
  }
  forfeitSeat(room, seat, `${room.seats[seat]?.name ?? 'A player'} left.`)
}

/** After login, rejoin an unfinished match if this account still owns a seat. */
function tryResumeMatch(client: Client) {
  if (!client.playerId) return false
  const bind = binds.get(client.playerId)
  if (!bind) return false
  const room = rooms.get(bind.roomId)
  if (!room || room.finished || room.game.over) {
    clearBind(client.playerId)
    return false
  }
  // Kick any stale socket still claiming this seat.
  for (const other of clients.values()) {
    if (other.id === client.id) continue
    if (other.playerId === client.playerId || (other.roomId === bind.roomId && other.seat === bind.seat)) {
      other.roomId = null
      other.seat = null
    }
  }
  client.roomId = bind.roomId
  client.seat = bind.seat
  binds.set(client.playerId, { ...bind, disconnectedAt: null })
  send(client.ws, {
    type: 'match',
    roomId: room.id,
    seat: bind.seat,
    seats: room.seats.length,
    players: room.seats.map((entry) => ({ name: entry.name, mmr: entry.mmr })),
  })
  send(client.ws, {
    type: 'state',
    roomId: room.id,
    seat: bind.seat,
    seed: room.seed,
    game: seatView(room, bind.seat),
  })
  return true
}

function sweepDisconnects() {
  const now = Date.now()
  for (const [playerId, bind] of [...binds.entries()]) {
    if (bind.disconnectedAt === null) continue
    if (now - bind.disconnectedAt < DISCONNECT_GRACE_MS) continue
    const room = rooms.get(bind.roomId)
    binds.delete(playerId)
    if (!room || room.finished) continue
    // Only forfeit if no live socket is attached to this seat.
    const live = [...clients.values()].some(
      (entry) => entry.roomId === bind.roomId && entry.seat === bind.seat,
    )
    if (live) continue
    forfeitSeat(room, bind.seat, `${room.seats[bind.seat]?.name ?? 'A player'} disconnected.`)
  }
}

function mime(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.json':
      return 'application/json'
    case '.png':
      return 'image/png'
    default:
      return 'application/octet-stream'
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, queue: queue.length, rooms: rooms.size }))
    return
  }
  if (url.pathname === '/api/leaderboard') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ rows: leaderboard(25) }))
    return
  }

  if (!existsSync(dist)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Grove online server is running. Build the client with npm run build, or use vite dev proxy.')
    return
  }

  let path = normalize(join(dist, decodeURIComponent(url.pathname)))
  if (!path.startsWith(dist)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html')
  if (!existsSync(path)) path = join(dist, 'index.html')
  try {
    const body = readFileSync(path)
    res.writeHead(200, { 'content-type': mime(path) })
    res.end(body)
  } catch {
    res.writeHead(404).end('Not found')
  }
})

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  const client: Client = {
    id: `c${nextClient++}`,
    ws,
    playerId: null,
    roomId: null,
    seat: null,
  }
  clients.set(client.id, client)
  send(ws, { type: 'hello', ok: true })

  ws.on('message', (data) => {
    const msg = parseClient(String(data))
    if (!msg) {
      send(ws, { type: 'error', message: 'Bad message.' })
      return
    }

    if (msg.type === 'ping') {
      send(ws, { type: 'pong' })
      return
    }

    if (msg.type === 'register' || msg.type === 'login') {
      const result = msg.type === 'register'
        ? registerPlayer(msg.name, msg.password)
        : loginPlayer(msg.name, msg.password)
      if ('error' in result) {
        send(ws, { type: 'auth_err', message: result.error })
        return
      }
      // One live socket per account — drop older connections for the same player.
      for (const other of clients.values()) {
        if (other.id !== client.id && other.playerId === result.id) {
          softDisconnect(other)
          other.playerId = null
        }
      }
      client.playerId = result.id
      send(ws, { type: 'auth_ok', player: publicPlayer(result) })
      send(ws, { type: 'leaderboard', rows: leaderboard(20) })
      tryResumeMatch(client)
      return
    }

    if (msg.type === 'queue') {
      const seats = msg.seats === 3 || msg.seats === 4 ? msg.seats : 2
      enqueue(client, seats)
      return
    }

    if (msg.type === 'cancel_queue') {
      cancelQueue(client)
      return
    }

    if (msg.type === 'leave_match') {
      leaveMatch(client)
      return
    }

    if (msg.type === 'action') {
      if (client.roomId === null || client.seat === null) {
        send(ws, { type: 'error', message: 'Not in a match.' })
        return
      }
      const room = rooms.get(client.roomId)
      if (!room) {
        send(ws, { type: 'error', message: 'Match gone.' })
        return
      }
      if (!legalActor(room, client.seat) && msg.action.type !== 'ready') {
        send(ws, { type: 'error', message: 'Wait for your turn.' })
        return
      }
      const result = pushAction(room, client.seat, msg.action)
      if (!result.ok) {
        send(ws, { type: 'error', message: result.message })
        return
      }
      broadcastRoom(room)
    }
  })

  ws.on('close', () => {
    cancelQueue(client)
    // Soft disconnect keeps the match alive for reconnect; explicit leave_match forfeits.
    if (client.roomId) softDisconnect(client)
    clients.delete(client.id)
  })
})

setInterval(() => matchmake(), 2000)
setInterval(() => sweepDisconnects(), 15_000)

server.listen(PORT, () => {
  console.log(`Grove online listening on :${PORT} (ws /ws)`)
})
