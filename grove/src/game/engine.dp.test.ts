import { describe, expect, it } from 'vitest'
import { apply, comboPlans, createGame, playableFromGrave, settle } from './engine.ts'
import { enqueue, findHero } from './flow.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

describe('Death Prophet Exorcism', () => {
  it('exposes and plays the top grave card while Death Prophet is controlled', () => {
    let game = ready()
    game = only(game, 0, ['death_prophet', 'sven'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'death_prophet'), team: 'new' })
    const sven = game.players[0].hand.find((card) => card.defId === 'sven')!
    game = bury(game, 0, sven)
    const top = playableFromGrave(game, 0)
    expect(top?.defId).toBe('sven')
    game = apply(game, { type: 'play', uid: top!.uid, team: 'new' })
    game = passInstants(game)
    expect(game.players[0].teams.some((team) => team.heroes.some((hero) => hero.defId === 'sven'))).toBe(true)
    expect(game.grave.some((card) => card.uid === sven.uid)).toBe(false)
  })

  it('spends 1 action when Exorcism plays the top grave card', () => {
    let game = ready()
    game = only(game, 0, ['death_prophet', 'sven'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'death_prophet'), team: 'new' })
    game = passInstants(game)
    const sven = game.players[0].hand.find((card) => card.defId === 'sven')!
    game = bury(game, 0, sven)
    game = {
      ...game,
      players: [{ ...game.players[0], actions: 2 }, game.players[1]] as Game['players'],
    }
    const top = playableFromGrave(game, 0)!
    expect(top.defId).toBe('sven')
    game = apply(game, { type: 'play', uid: top.uid, team: 'new' })
    game = passInstants(game)
    expect(game.players[0].actions).toBe(1)
    expect(game.players[0].teams.some((team) => team.heroes.some((hero) => hero.defId === 'sven'))).toBe(true)
  })

  it('blocks Exorcism plays when you have no actions left', () => {
    let game = ready()
    game = only(game, 0, ['death_prophet', 'sven'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'death_prophet'), team: 'new' })
    game = passInstants(game)
    const sven = game.players[0].hand.find((card) => card.defId === 'sven')!
    game = bury(game, 0, sven)
    game = {
      ...game,
      players: [{ ...game.players[0], actions: 0 }, game.players[1]] as Game['players'],
    }
    const top = playableFromGrave(game, 0)!
    game = apply(game, { type: 'play', uid: top.uid, team: 'new' })
    expect(game.grave.some((card) => card.uid === sven.uid)).toBe(true)
    expect(game.players[0].teams.some((team) => team.heroes.some((hero) => hero.defId === 'sven'))).toBe(false)
  })

  it('lets a grave terrain finish a combo with two hand terrains', () => {
    let game = ready()
    game = only(game, 0, ['death_prophet', 'river', 'river'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'death_prophet'), team: 'new' })
    game = passInstants(game)
    const handRivers = game.players[0].hand.filter((card) => card.defId === 'river')
    expect(handRivers.length).toBeGreaterThanOrEqual(2)
    const graveRiver: CardInst = { uid: 'grave-river', defId: 'river', kind: 'terrain' }
    game = { ...game, grave: [...game.grave, graveRiver] }
    expect(playableFromGrave(game, 0)?.uid).toBe(graveRiver.uid)
    const plan = comboPlans(game).find((entry) => entry.uids.includes(graveRiver.uid))
    expect(plan).toBeTruthy()
    game = apply(game, { type: 'combo', uids: plan!.uids })
    expect(game.grave.some((card) => card.uid === graveRiver.uid)).toBe(false)
    expect(game.players[0].combos.length).toBe(1)
  })

  it('does not pull a terrain out of the grave on a lone play attempt', () => {
    let game = ready()
    game = only(game, 0, ['death_prophet'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'death_prophet'), team: 'new' })
    game = passInstants(game)
    const graveRiver: CardInst = { uid: 'grave-river-2', defId: 'river', kind: 'terrain' }
    game = { ...game, grave: [...game.grave, graveRiver] }
    game = apply(game, { type: 'play', uid: graveRiver.uid, team: '' })
    expect(game.grave.some((card) => card.uid === graveRiver.uid)).toBe(true)
    expect(game.players[0].hand.some((card) => card.uid === graveRiver.uid)).toBe(false)
    expect(game.log.at(-1)).toMatch(/terrain/i)
  })

  it('exiles items played from the grave via Exorcism', () => {
    let game = ready()
    game = only(game, 0, ['death_prophet'])
    game = apply(game, { type: 'play', uid: uid(game, 0, 'death_prophet'), team: 'new' })
    game = passInstants(game)
    const item: CardInst = { uid: 'grave-item', defId: 'clarity', kind: 'item' }
    game = { ...game, grave: [...game.grave, item] }
    expect(playableFromGrave(game, 0)?.uid).toBe(item.uid)
    game = apply(game, { type: 'play', uid: item.uid, team: '' })
    let guard = 0
    while (game.pending && guard++ < 16) {
      const pick = game.pending.choices.find((choice) => choice.id === 'pass') ?? game.pending.choices[0]
      game = apply(game, { type: 'choose', ids: [pick!.id] })
    }
    expect(game.exile.some((card) => card.uid === item.uid)).toBe(true)
    expect(game.grave.some((card) => card.uid === item.uid)).toBe(false)
  })

  it('exiles controlled heroes that would die while Death Prophet is out', () => {
    let game = ready()
    game = only(game, 0, ['anti_mage'])
    game = only(game, 1, ['death_prophet', 'crystal_maiden'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'death_prophet'), team: 'new' })
    game = passInstants(game)
    const team = game.players[1].teams[0]!.id
    game = apply(game, { type: 'play', uid: uid(game, 1, 'crystal_maiden'), team })
    game = passInstants(game)
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'anti_mage'), team: 'new' })
    game = passInstants(game)
    expect(game.pending?.prompt.toLowerCase()).toMatch(/enemy team/)
    game = apply(game, { type: 'choose', ids: [`team:${team}`] })
    game = passInstants(game)
    while (game.pending?.prompt.includes('would be destroyed')) {
      game = apply(game, { type: 'choose', ids: ['pass'] })
    }
    expect(game.exile.some((card) => card.defId === 'crystal_maiden')).toBe(true)
    expect(game.grave.some((card) => card.defId === 'crystal_maiden')).toBe(false)
    expect(game.exile.some((card) => card.defId === 'death_prophet')).toBe(true)
  })
})

describe('return to owner', () => {
  it('bounces Solar Guardian saves to the hero owner hand', () => {
    let game = ready()
    game = only(game, 0, ['dawnbreaker'])
    game = only(game, 1, ['sven'])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 1, 'sven'), team: 'new' })
    game = passInstants(game)
    const sven = game.players[1].teams[0]!.heroes[0]!
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = apply(game, { type: 'play', uid: uid(game, 0, 'dawnbreaker'), team: 'new' })
    game = passInstants(game)
    if (game.pending?.resume.kind === 'cast') {
      game = apply(game, { type: 'choose', ids: [`hero:${sven.uid}`] })
    }
    game = passInstants(game)
    expect(findHero(game, sven.uid)?.hero.dawn).toBeTruthy()
    game = settle(enqueue(game, sven.uid, 'Test kill', false, false, 0))
    expect(findHero(game, sven.uid)).toBeNull()
    expect(game.players[1].hand.some((card) => card.uid === sven.uid)).toBe(true)
    expect(game.players[0].hand.some((card) => card.uid === sven.uid)).toBe(false)
    expect(game.log.some((line) => /Solar Guardian/.test(line))).toBe(true)
  })
})

function ready(): Game {
  const game = createGame({ seed: 9, mode: 'hotseat', names: ['Radiant', 'Dire'] })
  return apply(game, { type: 'ready' })
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
      })) as Game['players'],
    }
  }
  return {
    ...next,
    players: next.players.map((seat) => (seat.id === player ? { ...seat, hand: found } : seat)) as Game['players'],
  }
}

function uid(game: Game, player: PlayerId, defId: string): string {
  const card = game.players[player].hand.find((entry) => entry.defId === defId)
  if (!card) throw new Error(`missing ${defId}`)
  return card.uid
}

function bury(game: Game, player: PlayerId, card: CardInst): Game {
  return {
    ...game,
    grave: [...game.grave, card],
    players: game.players.map((seat) =>
      seat.id === player ? { ...seat, hand: seat.hand.filter((entry) => entry.uid !== card.uid) } : seat,
    ) as Game['players'],
  }
}

function passInstants(game: Game): Game {
  let next = game
  let guard = 0
  while ((next.pending?.resume.kind === 'instant-window' || next.pending?.resume.kind === 'response') && guard++ < 12) {
    next = apply(next, { type: 'choose', ids: ['pass'] })
  }
  return next
}
