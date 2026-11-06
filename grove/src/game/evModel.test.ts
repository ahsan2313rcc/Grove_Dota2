import { describe, expect, it } from 'vitest'
import {
  DRAW_MULT,
  REMOVAL_MULT,
  bounceHandEv,
  controlEv,
  effectEv,
  DEFAULT_CALIBRATION,
  diffPlayEffects,
  impactOf,
  pressureOf,
  trapEv,
  EMPTY_EFFECTS,
} from './evModel.ts'
import { apply, createGame } from './engine.ts'
import { blankTeam, makeCard, makeHero, setPlayer } from './flow.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

describe('evModel', () => {
  it('ranks permanent exile above destroy and hostage below', () => {
    expect(REMOVAL_MULT.exilePermanent).toBeGreaterThan(REMOVAL_MULT.destroy)
    expect(REMOVAL_MULT.exileHostage).toBeLessThan(REMOVAL_MULT.destroy)
    expect(REMOVAL_MULT.toBottom).toBeLessThan(REMOVAL_MULT.destroy)
  })

  it('values dig/search above blind draw', () => {
    expect(DRAW_MULT.dig).toBeGreaterThan(DRAW_MULT.draw)
    expect(DRAW_MULT.search).toBeGreaterThan(DRAW_MULT.dig)
  })

  it('bounce includes body + ability opportunity + action tax', () => {
    const ev = bounceHandEv({ vBody: 3, vAbility: 2, isAura: false, alpha: 2.5 })
    expect(ev).toBeCloseTo(3 + 0.85 * 2 + 2.5, 5)
    const aura = bounceHandEv({ vBody: 3, vAbility: 2, isAura: true, alpha: 2.5 })
    expect(aura).toBeCloseTo(3 + 2.5, 5)
  })

  it('control sums gained and denied body/ability', () => {
    expect(
      controlEv({
        vBodyGained: 2,
        vBodyDenied: 3,
        vAbilityGained: 1,
        vAbilityDenied: 1.5,
      }),
    ).toBeCloseTo(7.5, 5)
  })

  it('trap sums block bracket and trigger EV', () => {
    expect(trapEv(1.5, 4)).toBeCloseTo(5.5, 5)
  })

  it('effectEv uses calibration yardsticks', () => {
    const cal = { ...DEFAULT_CALIBRATION, alpha: 2, beta: 1, meanVBody: 3, meanVAbility: 1 }
    expect(effectEv('destroy', cal)).toBeCloseTo(3, 5)
    expect(effectEv('exilePermanent', cal)).toBeCloseTo(3.3, 5)
    expect(effectEv('exileHostage', cal)).toBeCloseTo(2.1, 5)
    expect(effectEv('exileTempo', cal)).toBeCloseTo(2, 5)
    expect(effectEv('dig', cal)).toBeGreaterThan(effectEv('draw', cal))
    expect(effectEv('search', cal)).toBeGreaterThan(effectEv('dig', cal))
    expect(effectEv('stealCard', cal)).toBeGreaterThan(effectEv('draw', cal))
  })

  it('pressureOf prefers running ev on the bag', () => {
    const bag = EMPTY_EFFECTS()
    bag.destroy = 2
    bag.ev = 12.5
    expect(pressureOf(bag)).toBe(12.5)
  })

  it('impactOf is the EV bag, not Rel', () => {
    const bag = EMPTY_EFFECTS()
    bag.ev = 11.5
    expect(impactOf(4.5, bag)).toBe(11.5)
    expect(impactOf(4.5, bag)).not.toBe(4.5)
  })

  it('deploy EV matches destroy scale (symmetric body value)', () => {
    const cal = { ...DEFAULT_CALIBRATION, meanVBody: 3, meanVAbility: 2 }
    expect(effectEv('deploy', cal, 3, 2)).toBeCloseTo(effectEv('destroy', cal, 3, 2), 5)
  })

  it('diffPlayEffects credits deploy when a hero seats onto the actor board', () => {
    let game = apply(createGame({ seed: 19, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    game = only(game, 0, ['mars'])
    const before = game
    game = apply(game, { type: 'play', uid: uid(game, 0, 'mars'), team: 'new' })
    game = passInstants(game)
    const effects = diffPlayEffects(before, game, 0, 'mars')
    expect(effects.deploy).toBeGreaterThanOrEqual(1)
    expect(effects.ev).toBeGreaterThan(0)
    expect(impactOf(0, effects)).toBeCloseTo(effects.ev, 5)
  })

  it('diffPlayEffects values Anti-Mage destroys with full EV pressure', () => {
    let game = apply(createGame({ seed: 17, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    game = seatDefs(game, 1, [['crystal_maiden', 'lion', 'lina']])
    game = only(game, 0, ['anti_mage'])
    const before = game
    game = apply(game, { type: 'play', uid: uid(game, 0, 'anti_mage'), team: 'new' })
    game = passInstants(game)
    let guard = 0
    while (game.pending && guard++ < 20) {
      const team = game.pending.choices.find((choice) => choice.id.startsWith('team:'))
      const hero = game.pending.choices.find((choice) => choice.id.startsWith('hero:'))
      const pick = team?.id ?? hero?.id ?? game.pending.choices.find((choice) => choice.id !== 'pass')?.id ?? 'pass'
      game = apply(game, { type: 'choose', ids: [pick] })
    }
    const effects = diffPlayEffects(before, game, 0, 'anti_mage')
    expect(effects.destroy).toBeGreaterThanOrEqual(1)
    expect(effects.ev).toBeGreaterThan(effects.destroy) // EV uses V_body ≥ mean, not count
    expect(pressureOf(effects)).toBeCloseTo(effects.ev, 5)
  })
})

function seatDefs(game: Game, player: PlayerId, teams: string[][]): Game {
  let next = game
  const built = []
  for (const [index, defs] of teams.entries()) {
    const heroes = []
    for (const defId of defs) {
      let card: CardInst
      ;[next, card] = makeCard(next, defId, 'hero')
      heroes.push(makeHero(card, player, player, next))
    }
    built.push({ ...blankTeam(`seat-${player}-${index}`), heroes })
  }
  return setPlayer(next, player, (seat) => ({ ...seat, teams: built }))
}

function only(game: Game, player: PlayerId, defIds: string[]): Game {
  let next = game
  const found: CardInst[] = []
  for (const defId of defIds) {
    const card =
      next.deck.find((entry) => entry.defId === defId) ??
      next.players.flatMap((seat) => seat.hand).find((entry) => entry.defId === defId)
    if (!card) throw new Error(`missing ${defId}`)
    found.push(card)
    next = {
      ...next,
      deck: next.deck.filter((entry) => entry.uid !== card.uid),
      players: next.players.map((seat) => ({
        ...seat,
        hand: seat.hand.filter((entry) => entry.uid !== card.uid),
      })),
    }
  }
  return {
    ...next,
    players: next.players.map((seat, index) => (index === player ? { ...seat, hand: found } : seat)),
  }
}

function uid(game: Game, player: PlayerId, defId: string): string {
  return game.players[player].hand.find((card) => card.defId === defId)?.uid ?? ''
}

function passInstants(game: Game): Game {
  let next = game
  let guard = 0
  while (next.pending?.resume.kind === 'instant-window' && guard++ < 12) {
    next = apply(next, { type: 'choose', ids: ['pass'] })
  }
  return next
}
