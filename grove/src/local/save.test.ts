import { afterEach, describe, expect, it } from 'vitest'
import { createGame } from '../game/engine.ts'
import { DEFAULT_SCORE_RULES } from '../game/scoring.ts'
import {
  clearDebugSession,
  clearLocalMatch,
  clearOnlineAuth,
  describeDebugSession,
  describeLocalMatch,
  loadDebugSession,
  loadLocalMatch,
  loadOnlineAuth,
  saveDebugSession,
  saveLocalMatch,
  saveOnlineAuth,
} from './save.ts'

afterEach(() => {
  clearLocalMatch()
  clearDebugSession()
  clearOnlineAuth()
})

describe('local match save', () => {
  it('round-trips an unfinished solo game', () => {
    const game = createGame({
      seed: 42,
      seats: [
        { name: 'You', ai: false },
        { name: 'The Grove', ai: true },
      ],
    })
    saveLocalMatch(42, game, DEFAULT_SCORE_RULES, true)
    const loaded = loadLocalMatch()
    expect(loaded?.seed).toBe(42)
    expect(loaded?.game.players[0]?.name).toBe('You')
    expect(loaded?.game.over).toBeNull()
    expect(describeLocalMatch(loaded!)).toMatch(/Solo|turn/)
  })

  it('drops finished matches', () => {
    const game = createGame({
      seed: 3,
      seats: [
        { name: 'A', ai: false },
        { name: 'B', ai: false },
      ],
    })
    const finished = {
      ...game,
      over: {
        reason: 'done',
        scores: [1, 2],
        parts: [
          { teams: 0, terrains: 0, total: 1 },
          { teams: 0, terrains: 0, total: 2 },
        ],
      },
    }
    saveLocalMatch(3, finished, DEFAULT_SCORE_RULES, true)
    expect(loadLocalMatch()).toBeNull()
  })

  it('stores online auth for reconnect', () => {
    saveOnlineAuth('Radiant', 'secret')
    expect(loadOnlineAuth()).toEqual({ name: 'Radiant', password: 'secret' })
    clearOnlineAuth()
    expect(loadOnlineAuth()).toBeNull()
  })
})

describe('debug session save', () => {
  it('round-trips a previous debug session', () => {
    saveDebugSession({
      seed: 99,
      seats: 3,
      strats: ['balanced', 'aggro', 'control'],
      queueSize: 50,
      view: 'stats',
      trainNeural: true,
      thoughtPower: 8,
      reports: [],
      rules: DEFAULT_SCORE_RULES,
    })
    const loaded = loadDebugSession()
    expect(loaded?.seed).toBe(99)
    expect(loaded?.seats).toBe(3)
    expect(loaded?.trainNeural).toBe(true)
    expect(describeDebugSession(loaded!)).toMatch(/3 AI/)
  })
})
