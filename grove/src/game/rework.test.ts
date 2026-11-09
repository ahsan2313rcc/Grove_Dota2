import { describe, expect, it } from 'vitest'
import { apply, createGame, teamsFor } from './engine.ts'
import { allLocs, attrsOf, makeHero, newTeam, putOnTeam, scoreState } from './flow.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

function ready(seed = 2): Game {
  const game = createGame({ seed, mode: 'hotseat', names: ['Radiant', 'Dire'] })
  return apply(game, { type: 'ready' })
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

/** Replace a seat's hand with exactly these cards; the old hand goes to the deck bottom. */
function toHand(game: Game, player: PlayerId, defIds: string[]): Game {
  const old = game.players[player].hand
  let next: Game = {
    ...game,
    deck: [...game.deck, ...old],
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

function drain(game: Game, pick: (game: Game) => string[] | null = () => null): Game {
  let next = game
  let guard = 0
  while (next.pending && guard++ < 20) {
    const pending = next.pending
    const custom = pick(next)
    if (custom) {
      next = apply(next, { type: 'choose', ids: custom })
      continue
    }
    if (pending.resume.kind === 'instant-window') {
      next = apply(next, { type: 'choose', ids: ['pass'] })
      continue
    }
    const ids = pending.choices.slice(0, Math.max(1, pending.min)).map((choice) => choice.id)
    next = apply(next, { type: 'choose', ids })
  }
  return next
}

function heroCount(game: Game, player: PlayerId): number {
  return allLocs(game).filter((loc) => loc.player.id === player).length
}

describe('Clinkz Death Pact', () => {
  it('does not make hand items free', () => {
    let game = toHand(ready(), 0, ['clinkz', 'assault'])
    const items = game.deck.filter((card) => card.kind === 'item' && card.defId !== 'assault').slice(0, 5)
    game = { ...game, deck: [...items, ...game.deck.filter((card) => !items.includes(card))] }
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'clinkz'), team: 'new' }))
    expect(game.clinkzExile.length).toBe(5)
    expect(game.freeItems).toBe(0)
    const before = game.players[0].actions
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'assault'), team: '' }))
    // Assault costs its action, then grants +2.
    expect(game.players[0].actions).toBe(before - 1 + 2)
  })

  it('keeps a refused exile item in exile instead of leaking it into hand', () => {
    let game = toHand(ready(), 0, ['clinkz'])
    const items = game.deck.filter((card) => card.kind === 'item').slice(0, 5)
    game = { ...game, deck: [...items, ...game.deck.filter((card) => !items.includes(card))] }
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'clinkz'), team: 'new' }))
    ;[game] = team(game, 1, ['doom'])
    const free = game.clinkzExile[0]!
    game = apply(game, { type: 'play', uid: free.uid, team: '' })
    expect(game.players[0].hand.some((card) => card.uid === free.uid)).toBe(false)
    expect(game.clinkzExile.some((card) => card.uid === free.uid)).toBe(true)
  })
})

describe('team movement', () => {
  it('Beastmaster keeps every hero when splitting a team', () => {
    let game = toHand(ready(3), 0, ['beastmaster'])
    ;[game] = team(game, 1, ['axe', 'sven', 'lina', 'zeus'])
    game = apply(game, { type: 'play', uid: uidOf(game, 0, 'beastmaster'), team: 'new' })
    game = drain(game, (current) =>
      current.pending?.mode === 'groups'
        ? current.pending.choices.map((choice, index) => `${index % 3}:${choice.id}`)
        : null,
    )
    expect(heroCount(game, 1)).toBe(4)
    expect(game.players[1].teams.map((entry) => entry.heroes.length).sort()).toEqual([1, 1, 2])
  })

  it('Grimstroke steals a whole team without losing heroes', () => {
    let game = toHand(ready(4), 0, ['grimstroke', 'river', 'jungle', 'lane'])
    const terrains = game.players[0].hand.filter((card) => card.kind === 'terrain').map((card) => card.uid)
    game = drain(apply(game, { type: 'combo', uids: terrains }))
    ;[game] = team(game, 1, ['axe', 'sven', 'tiny'])
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'grimstroke'), team: 'new' }))
    expect(heroCount(game, 1)).toBe(0)
    expect(heroCount(game, 0)).toBe(4)
    expect(scoreState(game, 0).teams).toBeGreaterThan(0)
  })
})

describe('terrain sets', () => {
  it('scores any three terrains: pair 3, mixed 5, core 8', () => {
    let game = toHand(ready(), 0, ['river', 'river', 'lane', 'jungle', 'jungle', 'jungle'])
    const hand = game.players[0].hand
    const pair = [hand[0]!.uid, hand[1]!.uid, hand[2]!.uid]
    game = apply(game, { type: 'combo', uids: pair })
    expect(game.players[0].combos.at(-1)).toMatchObject({ kind: 'pair', points: 3 })
    const jungles = game.players[0].hand.filter((card) => card.defId === 'jungle').map((card) => card.uid)
    game = apply(game, { type: 'combo', uids: jungles })
    expect(game.players[0].combos.at(-1)).toMatchObject({ kind: 'jungle', points: 8 })
    expect(scoreState(game, 0).terrains).toBe(11)
  })

  it('Meepo scores each terrain type and Slardar draws per River card', () => {
    let game = toHand(ready(), 0, ['river', 'river', 'lane', 'slardar'])
    const terrains = game.players[0].hand.filter((card) => card.kind === 'terrain').map((card) => card.uid)
    game = apply(game, { type: 'combo', uids: terrains })
    ;[game] = team(game, 0, ['meepo'])
    const meepo = scoreState(game, 0)
    expect(meepo.total - meepo.teams - meepo.terrains).toBe(2)
    const hand = game.players[0].hand.length
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'slardar'), team: 'new' }))
    expect(game.players[0].hand.length).toBe(hand - 1 + 2)
  })
})

function pick(prefix: string) {
  return (game: Game) => {
    const choice = game.pending?.choices.find((entry) => entry.id.startsWith(prefix))
    return choice ? [choice.id] : null
  }
}

describe('reworked heroes', () => {
  it('Io tethers an ally into its team and keeps it alive this turn', () => {
    let game = toHand(ready(), 0, ['io', 'lion'])
    let home = ''
    ;[game, home] = team(game, 0, ['axe'])
    ;[game] = team(game, 0, ['sven'])
    const sven = game.players[0].teams[1]!.heroes[0]!.uid
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'io'), team: home }), pick(`hero:${sven}`))
    expect(findTeamOf(game, sven)).toBe(home)
    const tethered = allLocs(game).find((loc) => loc.hero.uid === sven)!.hero
    expect(tethered.tether).toBe(game.turn)
  })

  it('Tusk moves an enemy hero to another team its controller owns', () => {
    let game = toHand(ready(), 0, ['tusk'])
    ;[game] = team(game, 1, ['axe', 'sven'])
    let other = ''
    ;[game, other] = team(game, 1, ['lina'])
    const axe = game.players[1].teams[0]!.heroes[0]!.uid
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'tusk'), team: 'new' }), (current) => {
      if (current.pending?.choices.some((choice) => choice.id === `hero:${axe}`)) return [`hero:${axe}`]
      return pick(`team:${other}`)(current)
    })
    expect(findTeamOf(game, axe)).toBe(other)
    expect(allLocs(game).find((loc) => loc.hero.uid === axe)?.player.id).toBe(1)
  })

  it('Earth Spirit pushes an enemy into another of their teams and destroys a hero there', () => {
    let game = toHand(ready(), 0, ['earth_spirit'])
    ;[game] = team(game, 1, ['axe'])
    let other = ''
    ;[game, other] = team(game, 1, ['lina', 'zeus'])
    const axe = game.players[1].teams[0]!.heroes[0]!.uid
    const zeus = game.players[1].teams[1]!.heroes[1]!.uid
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'earth_spirit'), team: 'new' }), (current) => {
      const ids = current.pending?.choices.map((choice) => choice.id) ?? []
      if (ids.includes(`hero:${axe}`)) return [`hero:${axe}`]
      if (ids.includes(`team:${other}`)) return [`team:${other}`]
      if (ids.includes(`kill:${zeus}`)) return [`kill:${zeus}`]
      return null
    })
    expect(findTeamOf(game, axe)).toBe(other)
    expect(allLocs(game).some((loc) => loc.hero.uid === zeus)).toBe(false)
  })

  it('Spirit Breaker can redirect Ravage, and the window names the team', () => {
    let game = toHand(ready(), 0, ['tidehunter'])
    game = toHand(game, 1, ['spirit_breaker'])
    let teamA = ''
    let teamB = ''
    ;[game, teamA] = team(game, 1, ['axe'])
    ;[game, teamB] = team(game, 1, ['lina'])
    game = apply(game, { type: 'play', uid: uidOf(game, 0, 'tidehunter'), team: 'new' })
    expect(game.pending?.choices.map((choice) => choice.id)).toEqual(
      expect.arrayContaining([`team:${teamA}`, `team:${teamB}`]),
    )
    game = apply(game, { type: 'choose', ids: [`team:${teamB}`] })
    expect(game.pending?.resume.kind).toBe('instant-window')
    expect(game.pending?.prompt).toMatch(/Target: Dire's team B/)
    expect(game.pending?.choices.some((choice) => choice.defId === 'spirit_breaker')).toBe(true)
    const breaker = game.pending!.choices.find((choice) => choice.defId === 'spirit_breaker')!
    game = apply(game, { type: 'choose', ids: [breaker.id] })
    expect(game.pending?.resume.kind).toBe('spirit-place')
    const seat = game.pending!.choices.find((choice) => choice.id === 'seat:new')?.id ?? game.pending!.choices[0]!.id
    game = drain(apply(game, { type: 'choose', ids: [seat] }))
    expect(allLocs(game).some((loc) => loc.hero.defId === 'lina')).toBe(true)
    expect(allLocs(game).some((loc) => loc.hero.defId === 'axe')).toBe(true)
    expect(allLocs(game).some((loc) => loc.hero.defId === 'spirit_breaker')).toBe(false)
  })

  it('Spirit Breaker seats, then redirects an enemy ability onto itself', () => {
    let game = toHand(ready(), 0, ['lina'])
    game = toHand(game, 1, ['spirit_breaker'])
    ;[game] = team(game, 1, ['axe'])
    const axe = game.players[1].teams[0]!.heroes[0]!.uid
    game = apply(game, { type: 'play', uid: uidOf(game, 0, 'lina'), team: 'new' })
    game = drain(game, (current) => {
      const pending = current.pending!
      if (pending.resume.kind === 'instant-window') {
        return [pending.choices.find((choice) => choice.defId === 'spirit_breaker')!.id]
      }
      if (pending.resume.kind === 'spirit-place') {
        return [pending.choices.find((choice) => choice.id === 'seat:new')?.id ?? pending.choices[0]!.id]
      }
      if (pending.choices.some((choice) => choice.id === `hero:${axe}`)) return [`hero:${axe}`]
      return null
    })
    // Laguna Blade is redirected onto Spirit Breaker, so Axe lives and SB dies tanking it.
    expect(allLocs(game).some((loc) => loc.hero.uid === axe)).toBe(true)
    expect(allLocs(game).some((loc) => loc.hero.defId === 'spirit_breaker')).toBe(false)
    expect(game.grave.some((card) => card.defId === 'spirit_breaker')).toBe(true)
  })

  it('Marci hands one card from the deck to each player', () => {
    let game = toHand(ready(), 0, ['marci'])
    game = toHand(game, 1, [])
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'marci'), team: 'new' }), (current) =>
      current.pending?.mode === 'assign' ? current.pending.choices.map((choice, index) => `${index}:${choice.id}`) : null,
    )
    expect(game.players[1].hand.length).toBe(1)
    expect(game.players[0].hand.length).toBe(1)
  })
})

function findTeamOf(game: Game, uid: string): string | undefined {
  return allLocs(game).find((loc) => loc.hero.uid === uid)?.team.id
}

function trapOn(game: Game, teamId: string, defId: string): Game {
  const [pulled, card] = pull(game, defId)
  return {
    ...pulled,
    players: pulled.players.map((seat) => ({
      ...seat,
      teams: seat.teams.map((entry) => (entry.id === teamId ? { ...entry, trap: { uid: card.uid, defId, owner: 1 } } : entry)),
    })),
  }
}

function teamOf(game: Game, teamId: string) {
  return game.players.flatMap((seat) => seat.teams).find((entry) => entry.id === teamId)
}

describe('traps', () => {
  it('a face-down trap switches off the attribute bonus', () => {
    let game = ready()
    let home = ''
    ;[game, home] = team(game, 0, ['axe', 'sven', 'tiny'])
    const open = scoreState(game, 0).teams
    game = trapOn(game, home, 'techies')
    expect(scoreState(game, 0).teams).toBeLessThan(open)
    expect(teamOf(game, home)?.trap).not.toBeNull()
  })

  it('cannot be planted on a 5-hero team', () => {
    let game = toHand(ready(), 0, ['riki'])
    let full = ''
    ;[game, full] = team(game, 1, ['axe', 'sven', 'tiny', 'lina', 'zeus'])
    const options = teamsForTrap(game, uidOf(game, 0, 'riki'))
    expect(options.find((option) => option.id === full)?.ok).toBe(false)
    game = apply(game, { type: 'play', uid: uidOf(game, 0, 'riki'), team: full })
    expect(teamOf(game, full)?.trap).toBeNull()
  })

  it('does not fire when the team is only targeted', () => {
    let game = toHand(ready(), 0, ['lina'])
    let foe = ''
    ;[game, foe] = team(game, 1, ['axe', 'sven'])
    game = trapOn(game, foe, 'techies')
    const axe = teamOf(game, foe)!.heroes[0]!.uid
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'lina'), team: 'new' }), pick(`hero:${axe}`))
    expect(teamOf(game, foe)?.trap?.defId).toBe('techies')
  })

  it('Techies sacrifices the whole team, entrant included', () => {
    let game = toHand(ready(), 0, ['lina'])
    let home = ''
    ;[game, home] = team(game, 0, ['axe', 'sven'])
    game = trapOn(game, home, 'techies')
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'lina'), team: home }))
    expect(teamOf(game, home)).toBeUndefined()
    expect(game.grave.map((card) => card.defId).sort()).toEqual(['axe', 'lina', 'sven', 'techies'])
  })

  it('Broodmother exiles the entrant, then joins', () => {
    let game = toHand(ready(), 0, ['lina'])
    let home = ''
    ;[game, home] = team(game, 0, ['axe'])
    game = trapOn(game, home, 'broodmother')
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'lina'), team: home }))
    expect(teamOf(game, home)?.heroes.map((hero) => hero.defId)).toEqual(['axe', 'broodmother'])
    expect(game.exile.some((card) => card.defId === 'lina')).toBe(true)
  })

  it('Monkey King costs the controller their next turn', () => {
    let game = toHand(ready(), 0, ['axe'])
    let home = ''
    ;[game, home] = team(game, 0, ['sven'])
    game = trapOn(game, home, 'monkey_king')
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'axe'), team: home }))
    expect(game.players[0].skip).toBe(true)
  })

  it('Riki resolves first and stops the entering ability', () => {
    let game = toHand(ready(), 0, ['lina'])
    let home = ''
    ;[game, home] = team(game, 0, ['sven'])
    ;[game] = team(game, 1, ['axe'])
    game = trapOn(game, home, 'riki')
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'lina'), team: home }))
    expect(game.players[0].orchid).not.toBeNull()
    expect(heroCount(game, 1)).toBe(1)
    expect(teamOf(game, home)?.heroes.map((hero) => hero.defId)).toEqual(['sven', 'lina', 'riki'])
  })

  it('Slark: the controller discards 3 and everyone else draws 1', () => {
    let game = toHand(ready(), 0, ['axe', 'river', 'river', 'lane', 'jungle'])
    game = toHand(game, 1, [])
    let home = ''
    ;[game, home] = team(game, 0, ['sven'])
    game = trapOn(game, home, 'slark')
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'axe'), team: home }))
    expect(game.players[0].hand.length).toBe(1)
    expect(game.players[1].hand.length).toBe(1)
  })

  it('Shadow Shaman: the controller sacrifices a hero from another team', () => {
    let game = toHand(ready(), 0, ['axe'])
    let home = ''
    ;[game, home] = team(game, 0, ['sven'])
    ;[game] = team(game, 0, ['tiny'])
    game = trapOn(game, home, 'shadow_shaman')
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'axe'), team: home }))
    expect(allLocs(game).some((loc) => loc.hero.defId === 'tiny')).toBe(false)
    expect(teamOf(game, home)?.heroes.map((hero) => hero.defId)).toEqual(['sven', 'axe'])
  })

  it('Kez plays a free hero whose ability resolves before the entrant', () => {
    let game = toHand(ready(), 0, ['spectre', 'lina'])
    let home = ''
    ;[game, home] = team(game, 0, ['sven'])
    ;[game] = team(game, 1, ['axe', 'tiny', 'zeus'])
    game = trapOn(game, home, 'kez')
    const order: string[] = []
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'spectre'), team: home }), (current) => {
      const pending = current.pending!
      if (pending.resume.kind === 'kez-trap') return [pending.choices.find((choice) => choice.defId === 'lina')!.id]
      if (pending.resume.kind === 'cast' && pending.choices[0]?.id.startsWith('hero:')) order.push(pending.resume.defId)
      return null
    })
    expect(order).toEqual(['lina', 'spectre'])
    expect(teamOf(game, home)?.heroes.map((hero) => hero.defId)).toEqual(['sven', 'spectre', 'lina', 'kez'])
    expect(heroCount(game, 1)).toBe(1)
  })

  it('Ogre Magi makes the entering hero activate twice', () => {
    let game = toHand(ready(), 0, ['lina'])
    let home = ''
    ;[game, home] = team(game, 0, ['sven'])
    ;[game] = team(game, 1, ['axe', 'tiny'])
    game = trapOn(game, home, 'ogre_magi')
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'lina'), team: home }))
    expect(heroCount(game, 1)).toBe(0)
  })

  it('Bounty Hunter steals a hero card from the opponent', () => {
    let game = toHand(ready(), 0, ['axe'])
    game = toHand(game, 1, ['lina', 'river'])
    let home = ''
    ;[game, home] = team(game, 0, ['sven'])
    game = trapOn(game, home, 'bounty_hunter')
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'axe'), team: home }))
    expect(game.players[0].hand.map((card) => card.defId)).toEqual(['lina'])
    expect(game.players[1].hand.map((card) => card.defId)).toEqual(['river'])
  })

  it('Templar Assassin keeps the team alive until the controller next turn', () => {
    let game = toHand(ready(), 0, ['axe'])
    let home = ''
    ;[game, home] = team(game, 0, ['sven'])
    game = trapOn(game, home, 'templar_assassin')
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'axe'), team: home }))
    expect(teamOf(game, home)?.guard).not.toBeNull()
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = toHand(game, 1, ['spectre'])
    const sven = teamOf(game, home)!.heroes[0]!.uid
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 1, 'spectre'), team: 'new' }), pick(`hero:${sven}`))
    expect(teamOf(game, home)?.heroes.length).toBe(3)
  })

  it('a revealed ward with no room goes to the grave', () => {
    let game = toHand(ready(), 0, ['axe'])
    let home = ''
    ;[game, home] = team(game, 0, ['sven', 'tiny', 'lina', 'zeus'])
    game = trapOn(game, home, 'templar_assassin')
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'axe'), team: home }))
    expect(teamOf(game, home)?.heroes.length).toBe(5)
    expect(game.grave.some((card) => card.defId === 'templar_assassin')).toBe(true)
  })

  it('Observer Ward removes a trap unrevealed', () => {
    let game = toHand(ready(), 0, ['ward'])
    let foe = ''
    ;[game, foe] = team(game, 1, ['axe'])
    game = trapOn(game, foe, 'techies')
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 0, 'ward'), team: '' }), (current) => {
      const ids = current.pending?.choices.map((choice) => choice.id) ?? []
      if (ids.includes('mode:trap')) return ['mode:trap']
      return null
    })
    expect(teamOf(game, foe)?.trap).toBeNull()
    expect(game.grave.some((card) => card.defId === 'techies')).toBe(true)
  })
})

function teamsForTrap(game: Game, uid: string) {
  return teamsFor(game, uid)
}

describe('The Ancient', () => {
  function drawAncient(game: Game): Game {
    const ancient = game.deck.find((card) => card.defId === 'ancient')!
    return apply({ ...game, deck: [ancient, ...game.deck.filter((card) => card.uid !== ancient.uid)] }, { type: 'draw' })
  }

  it('flexes to complete a core and can be destroyed or stolen', () => {
    let game = ready()
    let home = ''
    ;[game, home] = team(game, 0, ['axe', 'sven'])
    const before = scoreState(game, 0).total
    game = drawAncient(game)
    game = apply(game, { type: 'choose', ids: [`team:${home}`] })
    const after = scoreState(game, 0)
    // +10 marker, plus the STR core it completes (3 STR bodies).
    expect(after.total - before).toBeGreaterThanOrEqual(10 + 3)
    const ancient = allLocs(game).find((loc) => loc.hero.defId === 'ancient')!
    expect(attrsOfAncient(game, ancient.hero.uid)).toEqual(['STR'])
    game = toHand(game, 1, [])
    game = apply(game, { type: 'end' })
    game = apply(game, { type: 'ready' })
    game = toHand(game, 1, ['spectre'])
    game = drain(apply(game, { type: 'play', uid: uidOf(game, 1, 'spectre'), team: 'new' }), pick(`hero:${ancient.hero.uid}`))
    expect(allLocs(game).some((loc) => loc.hero.defId === 'ancient')).toBe(false)
    expect(scoreState(game, 0).total).toBeLessThan(10)
    expect(game.exile.some((card) => card.defId === 'ancient')).toBe(true)
  })

  it('triggers a trap on the team it joins', () => {
    let game = ready()
    let home = ''
    ;[game, home] = team(game, 0, ['axe'])
    game = trapOn(game, home, 'monkey_king')
    game = drawAncient(game)
    game = apply(game, { type: 'choose', ids: [`team:${home}`] })
    expect(game.players[0].skip).toBe(true)
  })
})

function attrsOfAncient(game: Game, uid: string) {
  const loc = allLocs(game).find((entry) => entry.hero.uid === uid)!
  return attrsOf(game, loc.hero)
}

describe('Time Lapse and Clarity', () => {
  it('Time Lapse shuffles grave and deck together and lets the Weaver player place The Ancient', () => {
    let game = toHand(ready(4), 0, ['weaver'])
    const graveCards = game.deck.slice(-4)
    game = { ...game, deck: game.deck.slice(0, -4), grave: graveCards }
    const total = game.deck.length + game.grave.length
    game = apply(game, { type: 'play', uid: uidOf(game, 0, 'weaver'), team: 'new' })
    game = drain(game, (g) => (g.pending?.resume.kind === 'weaver-ancient' ? ['depth:bottom'] : null))
    expect(game.grave).toHaveLength(0)
    expect(game.limbo).toHaveLength(0)
    expect(game.deck).toHaveLength(total)
    const depth = game.deck.findIndex((card) => card.kind === 'ancient') / game.deck.length
    expect(depth).toBeGreaterThanOrEqual(0.84)
    expect(depth).toBeLessThanOrEqual(0.96)
    expect(game.log.join(' ')).toContain('near the bottom')
  })

  it('Clarity takes the first terrain and restacks the rest in the chosen order', () => {
    let game = toHand(ready(5), 0, ['clarity'])
    const heroes = game.deck.filter((card) => card.kind === 'hero').slice(0, 3)
    const lane = game.deck.find((card) => card.defId === 'lane')!
    const rest = game.deck.filter((card) => !heroes.includes(card) && card.uid !== lane.uid)
    game = { ...game, deck: [...heroes, lane, ...rest] }
    game = apply(game, { type: 'play', uid: uidOf(game, 0, 'clarity'), team: '' })
    expect(game.pending?.resume.kind).toBe('restack')
    // Reverse the three revealed heroes.
    game = apply(game, { type: 'choose', ids: [`card:${heroes[2]!.uid}`] })
    game = apply(game, { type: 'choose', ids: [`card:${heroes[1]!.uid}`] })
    expect(game.pending).toBeNull()
    expect(game.players[0].hand.some((card) => card.uid === lane.uid)).toBe(true)
    expect(game.deck.slice(0, 3).map((card) => card.uid)).toEqual([heroes[2]!.uid, heroes[1]!.uid, heroes[0]!.uid])
    expect(game.deck.slice(3).map((card) => card.uid)).toEqual(rest.map((card) => card.uid))
    expect(game.limbo).toHaveLength(0)
  })
})
