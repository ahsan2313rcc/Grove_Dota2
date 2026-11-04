import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { START_MMR } from './elo.ts'

export interface PlayerRow {
  id: string
  name: string
  passHash: string
  salt: string
  mmr: number
  wins: number
  losses: number
  draws: number
  createdAt: number
}

interface Store {
  players: PlayerRow[]
}

const root = dirname(fileURLToPath(import.meta.url))

function paths() {
  const dataDir = process.env.GROVE_DATA ?? join(root, '../.data')
  return { dataDir, dbPath: join(dataDir, 'players.json') }
}

function load(): Store {
  const { dbPath } = paths()
  if (!existsSync(dbPath)) return { players: [] }
  try {
    return JSON.parse(readFileSync(dbPath, 'utf8')) as Store
  } catch {
    return { players: [] }
  }
}

function save(store: Store) {
  const { dataDir, dbPath } = paths()
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(dbPath, JSON.stringify(store, null, 2))
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

export function registerPlayer(name: string, password: string): PlayerRow | { error: string } {
  const trimmed = name.trim().slice(0, 24)
  if (trimmed.length < 2) return { error: 'Name needs at least 2 characters.' }
  if (password.length < 4) return { error: 'Password needs at least 4 characters.' }
  const store = load()
  if (store.players.some((player) => player.name.toLowerCase() === trimmed.toLowerCase())) {
    return { error: 'That name is taken.' }
  }
  const salt = randomBytes(16).toString('hex')
  const row: PlayerRow = {
    id: createHash('sha1').update(`${trimmed}:${Date.now()}:${salt}`).digest('hex').slice(0, 16),
    name: trimmed,
    passHash: hashPassword(password, salt),
    salt,
    mmr: START_MMR,
    wins: 0,
    losses: 0,
    draws: 0,
    createdAt: Date.now(),
  }
  store.players.push(row)
  save(store)
  return row
}

export function loginPlayer(name: string, password: string): PlayerRow | { error: string } {
  const store = load()
  const row = store.players.find((player) => player.name.toLowerCase() === name.trim().toLowerCase())
  if (!row) return { error: 'Unknown player.' }
  const attempt = Buffer.from(hashPassword(password, row.salt), 'hex')
  const real = Buffer.from(row.passHash, 'hex')
  if (attempt.length !== real.length || !timingSafeEqual(attempt, real)) return { error: 'Wrong password.' }
  return row
}

export function getPlayer(id: string): PlayerRow | null {
  return load().players.find((player) => player.id === id) ?? null
}

export function publicPlayer(row: PlayerRow) {
  return {
    id: row.id,
    name: row.name,
    mmr: row.mmr,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
  }
}

export function applyMatchResult(
  seatIds: string[],
  finals: number[],
  nextMmrs: number[],
): PlayerRow[] {
  const store = load()
  const updated: PlayerRow[] = []
  const best = Math.max(...finals)
  const winners = finals.map((score, index) => (score === best ? index : -1)).filter((index) => index >= 0)
  const draw = winners.length > 1

  for (let index = 0; index < seatIds.length; index += 1) {
    const row = store.players.find((player) => player.id === seatIds[index])
    if (!row) continue
    row.mmr = nextMmrs[index] ?? row.mmr
    if (draw && winners.includes(index)) row.draws += 1
    else if (winners.length === 1 && winners[0] === index) row.wins += 1
    else row.losses += 1
    updated.push(row)
  }
  save(store)
  return updated
}

export function leaderboard(limit = 20) {
  return load()
    .players
    .slice()
    .sort((a, b) => b.mmr - a.mmr || b.wins - a.wins)
    .slice(0, limit)
    .map(publicPlayer)
}
