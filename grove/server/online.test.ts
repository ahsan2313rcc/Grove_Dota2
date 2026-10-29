import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { getPlayer, publicPlayer, registerPlayer } from './db.ts'
import { tryMatch, type QueueEntry } from './matchmaking.ts'
import { createRoom, pushAction, seatView } from './room.ts'
import { viewFor } from './view.ts'
import { createGame } from '../src/game/engine.ts'

const previousData = process.env.GROVE_DATA
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'grove-online-'))
  process.env.GROVE_DATA = dataDir
})

afterEach(() => {
  if (previousData === undefined) delete process.env.GROVE_DATA
  else process.env.GROVE_DATA = previousData
  rmSync(dataDir, { recursive: true, force: true })
})

describe('online pipeline', () => {
  it('registers players, matches them, and hides opponent hands', () => {
    const a = registerPlayer('Alpha', 'pass1')
    const b = registerPlayer('Beta', 'pass2')
    if ('error' in a || 'error' in b) throw new Error('register failed')

    const queue: QueueEntry[] = [
      { playerId: a.id, name: a.name, mmr: a.mmr, seats: 2, joinedAt: 1, socketId: 's1' },
      { playerId: b.id, name: b.name, mmr: b.mmr, seats: 2, joinedAt: 2, socketId: 's2' },
    ]
    const matched = tryMatch(queue, 2, 10_000)
    expect(matched).toHaveLength(2)

    const room = createRoom('test', matched!, 42)
    expect(room.game.mode).toBe('online')
    expect(room.game.veil).toBe(false)

    const view0 = seatView(room, 0)
    expect(view0.players[0]?.hand.every((card) => card.defId !== 'hidden')).toBe(true)
    expect(view0.players[1]?.hand.every((card) => card.defId === 'hidden')).toBe(true)
    expect(view0.deck[0]?.defId).toBe('hidden')

    const drawn = pushAction(room, 0, { type: 'draw' })
    expect(drawn.ok).toBe(true)
    expect(room.game.players[0]!.hand.length).toBe(6)
  })

  it('rejects actions out of turn', () => {
    const a = registerPlayer('Gamma', 'pass1')
    const b = registerPlayer('Delta', 'pass2')
    if ('error' in a || 'error' in b) throw new Error('register failed')
    const room = createRoom('turn', [
      { playerId: a.id, name: a.name, mmr: a.mmr },
      { playerId: b.id, name: b.name, mmr: b.mmr },
    ], 7)
    expect(pushAction(room, 1, { type: 'draw' }).ok).toBe(false)
    expect(pushAction(room, 0, { type: 'draw' }).ok).toBe(true)
  })

  it('updates public profile shape', () => {
    const row = registerPlayer('Echo', 'pass9')
    if ('error' in row) throw new Error('register failed')
    const pub = publicPlayer(row)
    expect(pub).toMatchObject({ name: 'Echo', mmr: 1000, wins: 0 })
    expect(getPlayer(row.id)?.name).toBe('Echo')
  })

  it('persists rated match results', async () => {
    const { applyMatchResult } = await import('./db.ts')
    const a = registerPlayer('Fox', 'pass1')
    const b = registerPlayer('Goose', 'pass2')
    if ('error' in a || 'error' in b) throw new Error('register failed')
    applyMatchResult([a.id, b.id], [18, 7], [1016, 984])
    expect(getPlayer(a.id)).toMatchObject({ mmr: 1016, wins: 1, losses: 0 })
    expect(getPlayer(b.id)).toMatchObject({ mmr: 984, wins: 0, losses: 1 })
  })

  it('online createGame never veils', () => {
    const game = createGame({
      seed: 1,
      mode: 'online',
      seats: [
        { name: 'A', ai: false },
        { name: 'B', ai: false },
      ],
    })
    expect(game.mode).toBe('online')
    const view = viewFor(game, 1)
    expect(view.veil).toBe(false)
  })
})

describe('websocket smoke', () => {
  it('accepts a socket handshake against a live server when available', async () => {
    const url = process.env.GROVE_SMOKE_WS
    if (!url) return
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('timeout'))
      }, 5000)
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string }
        if (msg.type === 'hello') {
          clearTimeout(timer)
          ws.close()
          resolve()
        }
      })
      ws.on('error', reject)
    })
  })
})
