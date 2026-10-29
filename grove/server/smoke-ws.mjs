/**
 * Live two-client matchmaking smoke against a running Grove server.
 * Usage: node server/smoke-ws.mjs [wsUrl]
 */
import { WebSocket } from 'ws'

const url = process.argv[2] ?? 'ws://127.0.0.1:8787/ws'
const tag = Date.now().toString(36)

function once(ws, type, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs)
    const onMessage = (raw) => {
      const msg = JSON.parse(String(raw))
      if (msg.type === type) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        resolve(msg)
      }
    }
    ws.on('message', onMessage)
  })
}

async function connect() {
  const ws = new WebSocket(url)
  const hello = once(ws, 'hello')
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  await hello
  return ws
}

async function auth(ws, name, password) {
  ws.send(JSON.stringify({ type: 'register', name, password }))
  const ok = await Promise.race([
    once(ws, 'auth_ok'),
    once(ws, 'auth_err').then((err) => {
      throw new Error(err.message)
    }),
  ])
  return ok.player
}

async function main() {
  const a = await connect()
  const b = await connect()
  const pa = await auth(a, `SmokeA_${tag}`, 'pass1234')
  const pb = await auth(b, `SmokeB_${tag}`, 'pass1234')
  console.log('authed', pa.name, pa.mmr, pb.name, pb.mmr)

  const matched = Promise.all([once(a, 'match'), once(b, 'match')])
  a.send(JSON.stringify({ type: 'queue', seats: 2 }))
  b.send(JSON.stringify({ type: 'queue', seats: 2 }))
  const [ma, mb] = await matched
  console.log('matched', ma.roomId, 'seats', ma.seat, mb.seat)

  const states = Promise.all([once(a, 'state'), once(b, 'state')])
  const [sa, sb] = await states
  const handA = sa.game.players[sa.seat].hand
  const oppFromA = sa.game.players[1 - sa.seat].hand
  if (!handA.every((c) => c.defId !== 'hidden')) throw new Error('own hand hidden')
  if (!oppFromA.every((c) => c.defId === 'hidden')) throw new Error('opp hand visible')
  console.log('sanitized state ok; active', sa.game.active, 'veil', sa.game.veil)

  const actor = sa.game.active === sa.seat ? a : b
  const actorSeat = sa.game.active === sa.seat ? sa.seat : sb.seat
  actor.send(JSON.stringify({ type: 'action', action: { type: 'draw' } }))
  const after = await once(actor, 'state')
  if (after.game.players[actorSeat].hand.length !== 6) {
    throw new Error(`expected 6 cards after draw, got ${after.game.players[actorSeat].hand.length}`)
  }
  console.log('draw applied')

  a.send(JSON.stringify({ type: 'leave_match' }))
  const over = await Promise.race([once(a, 'match_over'), once(b, 'match_over')])
  console.log('rated leave', over.mmrDelta, '→', over.mmr)
  a.close()
  b.close()
  console.log('SMOKE_OK')
}

main().catch((error) => {
  console.error('SMOKE_FAIL', error)
  process.exit(1)
})
