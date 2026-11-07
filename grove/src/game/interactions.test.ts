import { describe, expect, it } from 'vitest'
import { apply, createGame, settle } from './engine.ts'
import { allLocs, bounce, makeHero, newTeam, putOnTeam } from './flow.ts'
import type { CardInst, Combo, Game, PlayerId } from './types.ts'

function ready(seed = 3, winScore: number | null = null): Game {
  return apply(createGame({ seed, mode: 'hotseat', names: ['Radiant', 'Dire'], winScore }), { type: 'ready' })
}

function pull(game: Game, defId: string): [Game, CardInst] {
  const card =
    game.deck.find((entry) => entry.defId === defId) ??
    game.players.flatMap((seat) => seat.hand).find((entry) => entry.defId === defId)
  if (!card) throw new Error(`missing ${defId}`)
  return [
    {
      ...game,
      deck: game.deck.filter((entry) => entry.uid !== card.uid),
      players: game.players.map((seat) => ({ ...seat, hand: seat.hand.filter((entry) => entry.uid !== card.uid) })),
    },
    card,
  ]
}

function toHand(game: Game, player: PlayerId, defIds: string[]): Game {
  let next: Game = {
    ...game,
    deck: [...game.deck, ...game.players[player].hand],
    players: game.players.map((seat) => (seat.id === player ? { ...seat, hand: [] } : seat)),
  }
  for (const defId of defIds) {
    const [pulled, card] = pull(next, defId)
    next = { ...pulled, players: pulled.players.map((seat) => (seat.id === player ? { ...seat, hand: [...seat.hand, card] } : seat)) }
  }
  return next
}

function team(game: Game, player: PlayerId, defIds: string[]): [Game, string] {
  const made = newTeam(game, player)
  if (!made) throw new Error('no team')
  let [next, teamId] = made
  for (const defId of defIds) {
    const [pulled, card] = pull(next, defId)
    next = putOnTeam(pulled, player, teamId, makeHero(card, player, player, pulled))
  }
  return [next, teamId]
}

function uidOf(game: Game, player: PlayerId, defId: string): string {
  return game.players[player].hand.find((card) => card.defId === defId)?.uid ?? ''
}

/** Answer prompts: `pick` may override; instant windows pass; otherwise the first legal choices. */
function drain(game: Game, pick: (game: Game) => string[] | null = () => null): Game {
  let next = game
  let guard = 0
  while (next.pending && guard++ < 30) {
    const pending = next.pending
    const custom = pick(next)
    if (custom) {
      next = apply(next, { type: 'choose', ids: custom })
      continue
    }
    if (pending.choices.some((choice) => choice.id === 'pass')) {
      next = apply(next, { type: 'choose', ids: ['pass'] })
      continue
    }
    next = apply(next, { type: 'choose', ids: pending.choices.slice(0, Math.max(1, pending.min)).map((choice) => choice.id) })
  }
  return next
}

function onBoard(game: Game, defId: string): boolean {
  return allLocs(game).some((loc) => loc.hero.defId === defId)
}

function points(game: Game, player: PlayerId, value: number): Game {
  const combo: Combo = { id: `pts-${player}`, owner: player, cards: [], points: value, kind: 'pair', protectedBy: null }
  return {
    ...game,
    players: game.players.map((seat) =>
      seat.id === player ? { ...seat, combos: [...seat.combos.filter((entry) => entry.id !== combo.id), combo] } : seat,
    ),
  }
}

function endTurn(game: Game): Game {
  return apply(apply(game, { type: 'end' }), { type: 'ready' })
}

describe('discards are chosen unless the card says random', () => {
  it('Ravage lets each opponent pick the 5 cards they discard', () => {
    let game = toHand(ready(), 0, ['tidehunter'])
    game = toHand(game, 1, ['axe', 'sven', 'lina', 'zeus', 'bkb', 'clarity', 'river'])
    ;[game] = team(game, 1, ['tiny'])
    game = apply(game, { type: 'play', uid: uidOf(game, 0, 'tidehunter'), team: 'new' })
    let seen: string[] = []
    const keep = ['axe', 'lina']
    game = drain(game, (g) => {
      if (g.pending?.resume.kind !== 'discard') return null
      seen = g.pending.choices.map((choice) => choice.defId ?? '')
      return g.pending.choices.filter((choice) => !keep.includes(choice.defId ?? '')).slice(0, 5).map((choice) => choice.id)
    })
    expect(seen).toContain('tiny')
    expect(game.players[1].hand.map((card) => card.defId)).toEqual(expect.arrayContaining(keep))
    expect(game.players[1].hand).toHaveLength(3)
  })

  it('Nether Ward offers each hand card as the payment', () => {
    let game = toHand(ready(), 0, ['lina', 'river', 'jungle'])
    ;[game] = team(game, 1, ['pugna'])
    ;[game] = team(game, 1, ['tiny'])
    game = apply(game, { type: 'play', uid: uidOf(game, 0, 'lina'), team: 'new' })
    let offered: string[] = []
    game = drain(game, (g) => {
      if (g.pending?.resume.kind !== 'pugna') return null
      offered = g.pending.choices.map((choice) => choice.id)
      const river = g.players[0].hand.find((card) => card.defId === 'river')!
      return [`card:${river.uid}`]
    })
    expect(offered.filter((id) => id.startsWith('card:'))).toHaveLength(2)
    expect(offered).toContain('fizzle')
    expect(game.players[0].hand.map((card) => card.defId)).toEqual(['jungle'])
    expect(game.grave.some((card) => card.defId === 'river')).toBe(true)
  })
})

describe('immunity blocks more than destroy', () => {
  it('Ravage cannot bounce an immune hero; its teammates still go', () => {
    let game = toHand(ready(), 0, ['tidehunter'])
    let teamId = ''
    ;[game, teamId] = team(game, 1, ['tiny', 'sven'])
    const tiny = allLocs(game).find((loc) => loc.hero.defId === 'tiny')!
    game = {
      ...game,
      players: game.players.map((seat) => ({
        ...seat,
        teams: seat.teams.map((entry) =>
          entry.id === teamId
            ? { ...entry, heroes: entry.heroes.map((hero) => (hero.uid === tiny.hero.uid ? { ...hero, bkb: { caster: 1, fromTurn: game.turn } } : hero)) }
            : entry,
        ),
      })),
    }
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'tidehunter'), team: 'new' }))
    expect(onBoard(game, 'tiny')).toBe(true)
    expect(onBoard(game, 'sven')).toBe(false)
  })

  it('Global Silence does not stop an immune hero from firing', () => {
    let game = toHand(ready(), 0, ['largo'])
    game = { ...game, silence: { caster: 1, fromTurn: game.turn } }
    let teamId = ''
    ;[game, teamId] = team(game, 0, ['tiny'])
    game = {
      ...game,
      players: game.players.map((seat) => ({
        ...seat,
        teams: seat.teams.map((entry) => (entry.id === teamId ? { ...entry, glyph: { caster: 0, fromTurn: game.turn } } : entry)),
      })),
    }
    const before = game.players[0].hand.length
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'largo'), team: teamId }))
    expect(game.log.join(' ')).not.toContain('Global Silence stops')
    expect(game.log.join(' ')).toContain('Catchy Lilt')
    expect(game.players[0].hand.length).toBeGreaterThan(before - 1)
  })
})

describe('target score', () => {
  it('ending a turn at the target wins at your next turn if nobody else holds it', () => {
    let game = points(ready(3, 50), 0, 55)
    game = endTurn(game)
    expect(game.holds?.map((hold) => hold.seat)).toEqual([0])
    expect(game.over).toBeNull()
    game = endTurn(game)
    expect(game.over?.reason).toContain('wins')
  })

  it('an opponent reaching the target resets the claim', () => {
    let game = points(ready(3, 50), 0, 55)
    game = endTurn(game)
    game = points(game, 1, 52)
    game = endTurn(game)
    expect(game.over).toBeNull()
    expect(game.log.join(' ')).toContain('matched at the target')
  })

  it('knocking the leader under the target resets the claim', () => {
    let game = points(ready(3, 50), 0, 55)
    game = endTurn(game)
    game = points(game, 0, 40)
    game = endTurn(game)
    expect(game.over).toBeNull()
    expect(game.log.join(' ')).toContain('drops to')
  })

  it('a Refresher turn right after the claim is not the next turn', () => {
    let game = points(ready(3, 50), 0, 55)
    game = endTurn({ ...game, extraTurn: 0 })
    expect(game.active).toBe(0)
    expect(game.over).toBeNull()
    game = endTurn(endTurn(game))
    expect(game.over?.reason).toContain('wins')
  })
})

describe('Response windows', () => {
  function setup(): Game {
    let game = ready(5)
    game = { ...game, active: 0 }
    ;[game] = team(game, 0, ['luna'])
    game = toHand(game, 1, ['dagon'])
    return { ...game, players: game.players.map((seat) => ({ ...seat, actions: seat.id === 0 ? 3 : seat.actions })) }
  }

  it('offers Dagon after an enemy action and lets it destroy', () => {
    let game = apply(setup(), { type: 'draw' })
    expect(game.pending?.actor).toBe(1)
    expect(game.pending?.resume.kind).toBe('response')
    const dagon = game.pending!.choices.find((choice) => choice.defId === 'dagon')
    expect(dagon).toBeTruthy()
    game = apply(game, { type: 'choose', ids: [dagon!.id] })
    game = drain(game, (state) => {
      const luna = state.pending?.choices.find((choice) => choice.label === 'Luna')
      return luna ? [luna.id] : null
    })
    expect(onBoard(game, 'luna')).toBe(false)
    expect(game.log.some((line) => line.includes('plays Instant Dagon'))).toBe(true)
  })

  it('skips the window when there is no target, and after pass-turn', () => {
    let game = setup()
    game = { ...game, players: game.players.map((seat) => (seat.id === 0 ? { ...seat, teams: [] } : seat)) }
    expect(apply(game, { type: 'draw' }).pending).toBeNull()
    game = apply(setup(), { type: 'draw' })
    game = apply(game, { type: 'choose', ids: ['pass-turn'] })
    expect(game.pending).toBeNull()
    expect(apply(game, { type: 'draw' }).pending).toBeNull()
  })
})


describe('Infest', () => {
  it('pulls Tidehunter into Lifestealer’s team and returns Lifestealer when the host leaves', () => {
    let game = ready(9)
    game = toHand(game, 0, ['lifestealer'])
    ;[game] = team(game, 1, ['tidehunter', 'zeus'])
    game = { ...game, active: 0, players: game.players.map((seat) => ({ ...seat, actions: seat.id === 0 ? 3 : seat.actions })) }
    const tide = allLocs(game).find((loc) => loc.hero.defId === 'tidehunter')!
    game = apply(game, { type: 'play', uid: uidOf(game, 0, 'lifestealer'), team: 'new' })
    game = drain(game, (state) => {
      if (state.pending?.resume.kind === 'response') return ['pass']
      if (state.pending?.choices.some((choice) => choice.id === `hero:${tide.hero.uid}`)) return [`hero:${tide.hero.uid}`]
      if (state.pending?.choices.some((choice) => choice.id === 'no')) return ['no']
      return null
    })
    expect(game.infests.some((entry) => entry.hostUid === tide.hero.uid)).toBe(true)
    expect(game.exile.some((card) => card.defId === 'lifestealer')).toBe(true)
    const host = allLocs(game).find((loc) => loc.hero.uid === tide.hero.uid)!
    expect(host.hero.controller).toBe(0)
    expect(onBoard(game, 'lifestealer')).toBe(false)
    const teamId = host.team.id
    game = settle(bounce(game, tide.hero.uid, 'Test', true, 0))
    expect(onBoard(game, 'tidehunter')).toBe(false)
    expect(onBoard(game, 'lifestealer')).toBe(true)
    expect(game.infests.length).toBe(0)
    const back = allLocs(game).find((loc) => loc.hero.defId === 'lifestealer')!
    expect(back.team.id).toBe(teamId)
    expect(game.log.some((line) => line.includes("returns in its host's place"))).toBe(true)
  })
})
