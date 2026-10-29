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

const clients = new Map<string, Client>()
const rooms = new Map<string, Room>()
const queue: QueueEntry[] = []
let nextClient = 1
let nextRoom = 1

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function broadcastRoom(room: Room) {
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
  if (client.roomId) {
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

function leaveMatch(client: Client) {
  const roomId = client.roomId
  if (!roomId) {
    client.seat = null
    return
  }
  const room = rooms.get(roomId)
  if (!room || room.finished) {
    client.roomId = null
    client.seat = null
    if (room && [...clients.values()].every((entry) => entry.roomId !== roomId || entry.id === client.id)) {
      rooms.delete(roomId)
    }
    return
  }
  const seat = room.seats.findIndex((entry) => entry.playerId === client.playerId)
  if (seat < 0) {
    client.roomId = null
    client.seat = null
    return
  }
  const scores = room.game.players.map((_, index) => (
    index === seat ? -1 : (room.game.over?.scores[index] ?? scoreState(room.game, index).total)
  ))
  if (!room.finished) {
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
        reason: `${room.seats[seat]?.name ?? 'A player'} left.`,
        scores,
        parts: scores.map((total) => ({ teams: 0, settings: 0, total })),
      },
    }
  }
  broadcastRoom(room)
  client.roomId = null
  client.seat = null
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
      client.playerId = result.id
      send(ws, { type: 'auth_ok', player: publicPlayer(result) })
      send(ws, { type: 'leaderboard', rows: leaderboard(20) })
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
    if (client.roomId) leaveMatch(client)
    clients.delete(client.id)
  })
})

setInterval(() => matchmake(), 2000)

server.listen(PORT, () => {
  console.log(`Grove online listening on :${PORT} (ws /ws)`)
})
