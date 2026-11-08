import { apply, createGame, settle } from './engine.ts'
import { blankTeam, canTargetHero, canTargetTeam, findHero, makeHero, setPlayer } from './flow.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

export interface DebugCheckResult {
  defId: string
  name: string
  ok: boolean
  detail: string
}

interface DebugCase {
  defIds: string[]
  name: string
  run: () => void
}

const CASES: DebugCase[] = [
  {
    defIds: ['puck'],
    name: 'Dream Coil blocks joining an existing enemy team',
    run: () => {
      let game = ready(11)
      game = seatDefs(game, 1, [['puck']])
      game = seatDefs(game, 0, [['sven']])
      game = {
        ...game,
        players: game.players.map((seat, index) =>
          index !== 0
            ? seat
            : {
                ...seat,
                teams: seat.teams.map((team) => ({
                  ...team,
                  heroes: team.heroes.map((hero) => ({ ...hero, enteredTurn: game.turn - 1 })),
                })),
              },
        ),
      }
      game = only(game, 0, ['axe'])
      const team = game.players[0].teams[0]!.id
      const axe = uid(game, 0, 'axe')
      game = apply(game, { type: 'play', uid: axe, team })
      assert(game.log.some((line) => /Dream Coil stops heroes from entering/i.test(line)), 'expected Dream Coil to stop the enter')
      assert(findHero(game, axe) === null, 'Axe should stay off the board')
    },
  },
  {
    defIds: ['puck'],
    name: 'Dream Coil still allows a new team',
    run: () => {
      let game = ready(12)
      game = seatDefs(game, 1, [['puck']])
      game = only(game, 0, ['axe'])
      game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team: 'new' })
      game = passInstants(game)
      assert(
        game.players[0].teams.some((team) => team.heroes.some((hero) => hero.defId === 'axe')),
        'Axe should open a new team',
      )
    },
  },
  {
    defIds: ['phoenix'],
    name: 'Supernova exiles Phoenix and sinks the enemy team',
    run: () => {
      let game = phoenixBoard()
      const before = game.players[1].teams[0]!.heroes.map((hero) => hero.uid)
      game = apply(game, { type: 'play', uid: uid(game, 0, 'phoenix'), team: 'new' })
      game = passUntilCast(game)
      assert(game.pending?.resume.kind === 'cast', 'expected a Supernova choice')
      game = apply(game, { type: 'choose', ids: ['exile:yes'] })
      game = passUntilCast(game)
      const foe = game.players[1].teams[0]!
      game = apply(game, { type: 'choose', ids: [`team:${foe.id}`] })
      game = passInstants(game)
      assert(game.exile.some((card) => card.defId === 'phoenix'), 'Phoenix should be exiled')
      assert(before.every((id) => game.deck.some((card) => card.uid === id)), 'enemy team should sit on the bottom of the deck')
    },
  },
  {
    defIds: ['phoenix'],
    name: 'Keeping Phoenix leaves the enemy team',
    run: () => {
      let game = phoenixBoard()
      const foeUid = game.players[1].teams[0]!.heroes[0]!.uid
      game = apply(game, { type: 'play', uid: uid(game, 0, 'phoenix'), team: 'new' })
      game = passUntilCast(game)
      game = apply(game, { type: 'choose', ids: ['exile:no'] })
      game = passInstants(game)
      assert(findHero(game, foeUid) !== null, 'enemy hero should stay')
      assert(
        game.players[0].teams.some((team) => team.heroes.some((hero) => hero.defId === 'phoenix')),
        'Phoenix should stay seated',
      )
    },
  },
  {
    defIds: ['tp_scroll'],
    name: 'Teleport moves a hero on the opponent turn without an action',
    run: () => {
      let game = apply(createGame({ seed: 4, mode: 'hotseat', names: ['You', 'Foe'] }), { type: 'ready' })
      game = only(game, 0, ['tp_scroll', 'sven'])
      const svenCard = game.players[0].hand.find((card) => card.defId === 'sven')!
      game = setPlayer(game, 0, (seat) => ({
        ...seat,
        hand: seat.hand.filter((card) => card.uid !== svenCard.uid),
        teams: [{ ...blankTeam('you-a'), heroes: [makeHero(svenCard, 0, 0, game)] }],
      }))
      game = apply(game, { type: 'end' })
      game = apply(game, { type: 'ready' })
      game = setPlayer(game, 0, (seat) => ({ ...seat, actions: 0 }))
      const sven = game.players[0].teams[0]!.heroes[0]!
      const from = game.players[0].teams[0]!.id
      game = apply(game, { type: 'play', uid: uid(game, 0, 'tp_scroll'), team: '' })
      assert(/hero you control/i.test(game.pending?.prompt ?? ''), 'expected a hero-you-control prompt')
      game = apply(game, { type: 'choose', ids: [`hero:${sven.uid}`] })
      const dest = game.pending?.choices.find(
        (choice) => choice.id.startsWith('new') || (choice.id.startsWith('team:') && choice.id !== `team:${from}`),
      )
      assert(!!dest, 'expected a destination team')
      game = apply(game, { type: 'choose', ids: [dest!.id] })
      const home = game.players[0].teams.find((team) => team.heroes.some((hero) => hero.uid === sven.uid))
      assert(home?.id !== from, 'Sven should leave the original team')
      assert(game.players[0].actions === 0, 'Teleport should not spend an action')
    },
  },
  {
    defIds: ['halberd'],
    name: "Heaven's Halberd lock blocks hero plays",
    run: () => {
      let game = apply(createGame({ seed: 4, mode: 'hotseat', names: ['You', 'Foe'] }), { type: 'ready' })
      game = only(game, 0, ['sven'])
      game = setPlayer(game, 0, (seat) => ({ ...seat, noHeroNow: true, actions: 3 }))
      const heroUid = uid(game, 0, 'sven')
      game = apply(game, { type: 'play', uid: heroUid, team: 'new' })
      assert(game.players[0].hand.some((card) => card.uid === heroUid), 'hero should stay in hand')
      assert(game.log.some((line) => /cannot play hero cards/i.test(line)), 'expected the Halberd lock log')
    },
  },
  {
    defIds: ['mars'],
    name: 'Bulwark protects allies, not Mars, and not the team',
    run: () => {
      let game = ready(17)
      game = only(game, 0, ['mars', 'axe'])
      game = apply(game, { type: 'play', uid: uid(game, 0, 'mars'), team: 'new' })
      game = passInstants(game)
      const team = game.players[0].teams[0]!
      game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team: team.id })
      game = passInstants(game)
      const mars = findHero(game, game.players[0].teams[0]!.heroes.find((hero) => hero.defId === 'mars')!.uid)!
      const axe = findHero(game, game.players[0].teams[0]!.heroes.find((hero) => hero.defId === 'axe')!.uid)!
      assert(canTargetHero(game, 1, axe.hero, 'ability') === false, 'Axe should be protected')
      assert(canTargetHero(game, 1, mars.hero, 'ability') === true, 'Mars should stay targetable')
      assert(canTargetTeam(game, 1, mars.team, 0, 'ability') === true, 'the team should stay targetable')
    },
  },
  {
    defIds: ['omniknight'],
    name: 'Guardian Angel seals the team against enemy ability targets',
    run: () => {
      let game = ready(17)
      game = only(game, 0, ['omniknight'])
      game = apply(game, { type: 'play', uid: uid(game, 0, 'omniknight'), team: 'new' })
      game = passInstants(game)
      const omni = game.players[0].teams[0]?.heroes.find((hero) => hero.defId === 'omniknight')
      assert(!!omni, 'Omniknight should be seated')
      assert(canTargetHero(game, 1, omni!, 'ability') === false, 'Omniknight should be immune')
    },
  },
  {
    defIds: ['crystal_maiden'],
    name: 'Arcane Aura draws when a hero you control activates',
    run: () => {
      let game = ready(17)
      game = only(game, 0, ['crystal_maiden', 'axe'])
      game = apply(game, { type: 'play', uid: uid(game, 0, 'crystal_maiden'), team: 'new' })
      game = passInstants(game)
      game = apply(game, { type: 'play', uid: uid(game, 0, 'axe'), team: 'new' })
      game = passInstants(game)
      let guard = 0
      while (game.pending && guard++ < 24) {
        if (game.pending.resume.kind === 'instant-window' || game.pending.resume.kind === 'response') {
          game = apply(game, { type: 'choose', ids: ['pass'] })
          continue
        }
        const pick = game.pending.choices.find((choice) => choice.id === 'pass') ?? game.pending.choices[0]
        if (!pick) break
        game = apply(game, { type: 'choose', ids: [pick.id] })
      }
      game = settle(game)
      assert(game.log.some((line) => /Arcane Aura/.test(line)), 'expected an Arcane Aura draw')
    },
  },
]

export function debugCasesFor(defId: string): DebugCase[] {
  return CASES.filter((entry) => entry.defIds.includes(defId))
}

export function runDebugChecks(defId?: string): DebugCheckResult[] {
  const cases = defId ? debugCasesFor(defId) : CASES
  return cases.flatMap((entry) => {
    try {
      entry.run()
      return entry.defIds
        .filter((id) => !defId || id === defId)
        .map((id) => ({ defId: id, name: entry.name, ok: true, detail: 'Pass' }))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Check failed'
      return entry.defIds
        .filter((id) => !defId || id === defId)
        .map((id) => ({ defId: id, name: entry.name, ok: false, detail }))
    }
  })
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message)
}

function ready(seed: number): Game {
  return apply(createGame({ seed, mode: 'hotseat', names: ['You', 'Foe'] }), { type: 'ready' })
}

function phoenixBoard(): Game {
  let game = ready(19)
  game = only(game, 0, ['phoenix'])
  game = only(game, 1, ['axe', 'sven'])
  const axe = game.players[1].hand.find((card) => card.defId === 'axe')!
  const sven = game.players[1].hand.find((card) => card.defId === 'sven')!
  return setPlayer(game, 1, (seat) => ({
    ...seat,
    hand: [],
    teams: [{
      ...blankTeam('foe-a'),
      heroes: [makeHero(axe, 1, 1, game), makeHero(sven, 1, 1, game)],
    }],
  }))
}

function seatDefs(game: Game, player: PlayerId, teams: string[][]): Game {
  const built = teams.map((defs, index) => ({
    ...blankTeam(`seat-${player}-${index}`),
    heroes: defs.map((defId) => {
      const card = take(game, defId)
      game = card.game
      return makeHero(card.card, player, player, game)
    }),
  }))
  return setPlayer(game, player, (seat) => ({ ...seat, teams: built }))
}

function take(game: Game, defId: string): { game: Game; card: CardInst } {
  const card =
    game.deck.find((entry) => entry.defId === defId)
    ?? game.players.flatMap((seat) => seat.hand).find((entry) => entry.defId === defId)
    ?? game.grave.find((entry) => entry.defId === defId)
  if (!card) throw new Error(`missing ${defId}`)
  return {
    card,
    game: {
      ...game,
      deck: game.deck.filter((entry) => entry.uid !== card.uid),
      grave: game.grave.filter((entry) => entry.uid !== card.uid),
      players: game.players.map((seat) => ({
        ...seat,
        hand: seat.hand.filter((entry) => entry.uid !== card.uid),
      })),
    },
  }
}

function only(game: Game, player: PlayerId, defIds: string[]): Game {
  const found: CardInst[] = []
  for (const defId of defIds) {
    const next = take(game, defId)
    game = next.game
    found.push(next.card)
  }
  return setPlayer(game, player, (seat) => ({ ...seat, hand: found, actions: Math.max(seat.actions, 3) }))
}

function uid(game: Game, player: PlayerId, defId: string): string {
  const card = game.players[player].hand.find((entry) => entry.defId === defId)
  if (!card) throw new Error(`missing ${defId}`)
  return card.uid
}

function passInstants(game: Game): Game {
  let next = game
  let guard = 0
  while ((next.pending?.resume.kind === 'instant-window' || next.pending?.resume.kind === 'response') && guard++ < 12) {
    next = apply(next, { type: 'choose', ids: ['pass'] })
  }
  return next
}

function passUntilCast(game: Game): Game {
  let next = passInstants(game)
  let guard = 0
  while (next.pending && next.pending.resume.kind !== 'cast' && guard++ < 20) {
    const pick = next.pending.choices.find((choice) => choice.id === 'pass') ?? next.pending.choices[0]
    if (!pick) break
    next = apply(next, { type: 'choose', ids: [pick.id] })
    next = passInstants(next)
  }
  return next
}
