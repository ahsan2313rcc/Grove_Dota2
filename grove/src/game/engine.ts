import { HEROES, ITEMS, REWARDS, SETTINGS, display } from './catalog.ts'
import { cast, finishIo, finishKunkka } from './casts.ts'
import { getScoreRules } from './scoring.ts'
import {
  addHand,
  allLocs,
  arrived,
  ask,
  cardsLocked,
  clearEnd,
  discardUid,
  enqueue,
  enterReason,
  resolveTeam,
  expireStart,
  findHand,
  findHero,
  holderWith,
  nextSeat,
  heroWeight,
  itemsLocked,
  log,
  makeCard,
  makeHero,
  mint,
  preferredFoe,
  seatTeam,
  performDestroy,
  pname,
  putOnTeam,
  queueDraw,
  removeHand,
  returnLassos,
  returnPhased,
  scoreState,
  scoreTeam,
  setPlayer,
  shuffle,
  strip,
  takeDraw,
  teamById,
  TEAM_CAP,
  toExile,
  toGrave,
  viperDue,
} from './flow.ts'
import type { Action, AiStrat, CardInst, CardKind, Game, Player, PlayerId, Resume } from './types.ts'

export type SeatSpec = { name: string; ai: boolean; strat?: AiStrat }

const DEFAULT_STRAT: AiStrat = 'balanced'

export function createGame(opts: {
  seed?: number
  mode?: 'hotseat' | 'ai' | 'online'
  names?: [string, string]
  seats?: SeatSpec[]
}): Game {
  const seats = opts.seats ?? legacySeats(opts.mode ?? 'hotseat', opts.names)
  if (seats.length < 2 || seats.length > 8) throw new Error('Grove seats 2 to 8 players.')
  const humans = seats.filter((seat) => !seat.ai).length
  const mode: 'hotseat' | 'ai' | 'online' =
    opts.mode === 'online' ? 'online' : humans >= 2 ? 'hotseat' : 'ai'
  let state = blank(opts.seed ?? (Date.now() % 100000), mode, seats)
  const cards: CardInst[] = []
  for (const hero of HEROES) {
    const made = makeCard(state, hero.id, 'hero')
    state = made[0]
    cards.push(made[1])
  }
  for (const item of ITEMS) {
    for (let copy = 0; copy < item.copies; copy += 1) {
      const made = makeCard(state, item.id, 'item')
      state = made[0]
      cards.push(made[1])
    }
  }
  for (const setting of SETTINGS) {
    for (let copy = 0; copy < 12; copy += 1) {
      const made = makeCard(state, setting.id, 'setting')
      state = made[0]
      cards.push(made[1])
    }
  }
  const shuffled = shuffle(state, cards)
  state = { ...shuffled[0], deck: shuffled[1] }
  state = fillPile(state, 'runes')
  state = fillPile(state, 'neutrals')
  state = fillPile(state, 'towers')
  for (let id = 0; id < seats.length; id += 1) state = takeDraw(state, id, 5)
  const names = seats.map((seat) => seat.name)
  const listed = names.length === 2 ? `${names[0]} and ${names[1]}` : names.join(', ')
  state = {
    ...state,
    live: true,
    veil: mode === 'hotseat' && !seats[0]!.ai,
    log: [`${listed} draw 5. ${names[0]} acts first.`],
  }
  state = setPlayer(state, 0, (player) => ({ ...player, actions: 2 }))
  return state
}

function legacySeats(mode: 'hotseat' | 'ai' | 'online', names?: [string, string]): SeatSpec[] {
  const labels = names ?? (mode === 'ai' ? ['You', 'The Grove'] : ['Player 1', 'Player 2'])
  return [
    { name: labels[0], ai: false },
    { name: labels[1], ai: mode === 'ai' },
  ]
}

function fillPile(state: Game, pile: 'runes' | 'neutrals' | 'towers'): Game {
  const cards: CardInst[] = []
  for (const reward of REWARDS.filter((entry) => entry.kind === (pile === 'runes' ? 'rune' : pile === 'neutrals' ? 'neutral' : 'tower'))) {
    for (let copy = 0; copy < reward.copies; copy += 1) {
      const made = makeCard(state, reward.id, reward.kind)
      state = made[0]
      cards.push(made[1])
    }
  }
  const shuffled = shuffle(state, cards)
  return { ...shuffled[0], [pile]: shuffled[1] }
}

function blank(seed: number, mode: 'hotseat' | 'ai' | 'online', seats: SeatSpec[]): Game {
  const player = (id: PlayerId, name: string, ai: boolean, strat: AiStrat): Player => ({
    id,
    name,
    ai,
    strat: ai ? strat : DEFAULT_STRAT,
    hand: [],
    teams: [],
    combos: [],
    actions: 0,
    skip: false,
    noHeroNext: false,
    noHeroNow: false,
    orchid: false,
    bkb: null,
    mailTurn: null,
    handLimit: 7,
  })
  return {
    rng: seed || 1,
    nextId: 1,
    mode,
    autoAll: false,
    deck: [],
    grave: [],
    exile: [],
    runes: [],
    neutrals: [],
    towers: [],
    players: seats.map((seat, id) => player(id, seat.name, seat.ai, seat.strat ?? DEFAULT_STRAT)),
    active: 0,
    turn: 1,
    log: [],
    pending: null,
    after: null,
    queue: [],
    over: null,
    veil: false,
    seq: 1,
    graveThisTurn: 0,
    enteredThisTurn: [],
    lastGrave: null,
    multicast: null,
    silence: null,
    naga: null,
    lockPlay: null,
    troll: null,
    viper: [],
    maledict: [],
    bonds: [],
    soulbind: [],
    sdBan: [],
    phased: [],
    lassos: [],
    reveal: [],
    destroyDepth: 0,
    live: false,
    pendingDraws: [],
    limbo: [],
    echoes: [],
  }
}

export function apply(state: Game, action: Action): Game {
  if (state.over && action.type !== 'ready') return state
  const base = action.type === 'choose' ? state : { ...state, destroyDepth: 0 }
  return settle(reduce(base, action))
}

function reduce(state: Game, action: Action): Game {
  if (action.type === 'ready') return { ...state, veil: false }
  if (state.veil || state.over) return state
  if (action.type === 'choose') return satisfy(state, action.ids)
  if (state.pending) return state
  if (action.type === 'draw') return drawAction(state)
  if (action.type === 'end') return endTurn(state)
  if (action.type === 'combo') return combo(state, action.uids)
  if (action.type === 'move') return moveEmber(state, action.uid, action.team)
  if (action.type === 'morph') return morphCast(state, action.uid)
  if (action.type === 'play') return play(state, action.uid, action.team)
  if (action.type === 'discard') return discardStuck(state, action.uid)
  return state
}

export function settle(state: Game): Game {
  let guard = 0
  while (guard < 80) {
    guard += 1
    if (state.over) return state
    if (state.pending) {
      if (state.autoAll || state.players[state.pending.actor].ai) {
        state = satisfy(state, autoIds(state))
        continue
      }
      return state
    }
    if (state.queue.length > 0) {
      const [item, ...rest] = state.queue
      state = performDestroy({ ...state, queue: rest }, item!)
      continue
    }
    if (state.echoes.length > 0) {
      const [echo, ...rest] = state.echoes
      state = cast({ ...state, echoes: rest }, echo!)
      continue
    }
    if (state.after) {
      const after = state.after
      state = { ...state, after: null }
      state = runAfter(state, after)
      continue
    }
    if (state.pendingDraws.length > 0) {
      const [draw, ...rest] = state.pendingDraws
      state = { ...state, pendingDraws: rest }
      state = beginDraw(state, draw!.player, draw!.n, false)
      continue
    }
    const limited = ([0, 1] as const).find((id) => state.players[id].hand.length > state.players[id].handLimit)
    if (limited !== undefined) {
      state = askLimit(state, limited, 'none')
      continue
    }
    if (state.live && state.deck.length === 0) return finish(state, 'The deck is empty.')
    return state
  }
  return log(state, 'The chain of effects stops.')
}

function runAfter(state: Game, after: Resume): Game {
  if (after.kind === 'alive') {
    if (!findHero(state, after.uid)) return state
    if (state.silence || !castableHero(after.cast.defId)) return state
    return cast(state, after.cast)
  }
  return state
}

function castableHero(defId: string): boolean {
  return display(defId).kind === 'hero' && display(defId).text.length > 0 && HEROES.some((hero) => hero.id === defId && hero.timing !== 'aura')
}

function beginDraw(state: Game, player: PlayerId, count: number, asked: boolean): Game {
  if (count <= 0) return state
  if (!asked && state.grave.some((card) => card.defId === 'slark')) {
    return ask(state, {
      actor: player,
      prompt: 'Shadow Dance can replace this draw. Mill 3 and return Slark, or draw.',
      mode: 'pick',
      min: 1,
      max: 1,
      choices: [
        { id: 'yes', label: 'Shadow Dance' },
        { id: 'no', label: 'Draw' },
      ],
      resume: { kind: 'slark', player, n: count },
    })
  }
  return takeDraw(state, player, count)
}

function askLimit(state: Game, player: PlayerId, then: 'end' | 'none'): Game {
  const overflow = state.players[player].hand.length - state.players[player].handLimit
  return ask(state, {
    actor: player,
    prompt: `Discard down to ${state.players[player].handLimit}.`,
    mode: 'pick',
    min: overflow,
    max: overflow,
    choices: state.players[player].hand.map((card) => ({
      id: `card:${card.uid}`,
      label: display(card.defId).name,
      defId: card.defId,
    })),
    resume: { kind: 'limit', player, then },
  })
}

function drawAction(state: Game): Game {
  const actor = state.active
  if (state.players[actor].actions < 1) return state
  if (state.players[actor].hand.length >= state.players[actor].handLimit) return log(state, 'Your hand is full.')
  if (state.deck.length === 0) return finish(state, 'The deck is empty.')
  state = setPlayer(state, actor, (player) => ({ ...player, actions: player.actions - 1 }))
  return beginDraw(state, actor, 1, false)
}

function endTurn(state: Game): Game {
  const actor = state.active
  if (state.players[actor].hand.length > state.players[actor].handLimit) return askLimit(state, actor, 'end')
  state = returnPhased(state, state.turn)
  state = clearEnd(state)
  return startTurn(state, nextSeat(state, actor))
}

function startTurn(state: Game, id: PlayerId): Game {
  let guard = 0
  let active = id
  while (guard < state.players.length + 1) {
    guard += 1
    state = { ...state, active, turn: state.turn + 1 }
    state = expireStart(state)
    state = returnPhased(state)
    state = returnLassos(state)
    state = viperDue(state)
    const player = state.players[active]
    if (!player) break
    if (player.skip) {
      state = setPlayer(log(state, `${player.name} skips the turn.`), active, (current) => ({ ...current, skip: false }))
      active = nextSeat(state, active)
      continue
    }
    if (player.noHeroNext) {
      state = setPlayer(state, active, (current) => ({ ...current, noHeroNext: false, noHeroNow: true }))
    }
    state = setPlayer(state, active, (current) => ({ ...current, actions: 2 }))
    const veil = state.mode === 'hotseat' && !state.autoAll && !state.players[active].ai
    return log({ ...state, veil }, `${state.players[active].name}'s turn. 2 actions.`)
  }
  return state
}

function combo(state: Game, uids: string[], forced = false): Game {
  const actor = state.active
  if (cardsLocked(state, actor)) return log(state, 'Chronosphere stops you from playing cards.')
  if (uids.length !== 3) return state
  const cards = uids.map((uid) => state.players[actor].hand.find((card) => card.uid === uid))
  if (cards.some((card) => !card || card.kind !== 'setting')) return state
  if (!forced) {
    const holder = holderWith(state, actor, 'nyx_assassin')
    if (holder !== null) {
      const nyx = state.players[holder]!.hand.filter((card) => card.defId === 'nyx_assassin')
      return ask(state, {
        actor: holder,
        prompt: `${pname(state, holder)} may discard Nyx Assassin to counter the setting combo, or pass.`,
        mode: 'pick',
        min: 1,
        max: 1,
        choices: [
          { id: 'pass', label: 'Pass' },
          ...nyx.map((card) => ({ id: `nyx:${card.uid}`, label: 'Spiked Carapace', defId: card.defId })),
        ],
        resume: { kind: 'counter-combo', uids, actor },
      })
    }
  }
  const picked = cards as CardInst[]
  const same = picked.every((card) => card.defId === picked[0]?.defId)
  const rules = getScoreRules()
  const points = same ? rules.coreCombo : rules.mixCombo
  const kind = same ? (picked[0]?.defId as 'river' | 'jungle' | 'lane') : 'mixed'
  let next = state
  for (const uid of uids) next = removeHand(next, actor, uid)
  let comboId = ''
  ;[next, comboId] = mint(next)
  next = setPlayer(next, actor, (player) => ({
    ...player,
    combos: [...player.combos, { id: comboId, owner: actor, cards: picked, points, kind, protectedBy: null }],
  }))
  next = log(next, `${pname(next, actor)} sets ${same ? `three ${picked[0]?.defId}s` : 'a mixed path'} for ${points}.`)
  if (same && picked[0]) {
    const pile = picked[0].defId === 'river' ? 'runes' : picked[0].defId === 'jungle' ? 'neutrals' : 'towers'
    const reward = next[pile][0]
    if (reward) {
      next = { ...next, [pile]: next[pile].slice(1) }
      next = log(addHand(next, actor, [reward]), `${pname(next, actor)} takes a reward.`)
    } else {
      next = log(next, 'The reward pile is empty.')
    }
  }
  return next
}

/** Spend an action to pitch a stuck hand card (Poison Nova / lone settings) so the seat can dig. */
function discardStuck(state: Game, uid: string): Game {
  const actor = state.active
  if (cardsLocked(state, actor)) return log(state, 'Chronosphere stops you from playing cards.')
  if (state.players[actor].actions < 1) return state
  const held = findHand(state, uid)
  if (!held || held.player.id !== actor) return state
  let next = discardUid(state, actor, uid)
  next = setPlayer(next, actor, (player) => ({ ...player, actions: player.actions - 1 }))
  return log(next, `${pname(next, actor)} discards ${display(held.card.defId).name} to dig.`)
}

function play(state: Game, uid: string, team: string): Game {
  const actor = state.active
  const held = findHand(state, uid)
  if (!held || held.player.id !== actor) return state
  if (held.card.kind === 'setting') return log(state, 'Settings are played three at a time.')
  const info = display(held.card.defId)
  const instant = info.instant
  if (cardsLocked(state, actor)) return log(state, 'Chronosphere stops you from playing cards.')
  if (!instant && state.players[actor].actions < 1) return state
  if (held.card.kind === 'item' && itemsLocked(state, actor)) return log(state, 'Poison Nova stops items.')
  if ((held.card.kind === 'hero' || held.card.kind === 'neutral') && state.players[actor].noHeroNow && held.card.kind === 'hero') {
    return log(state, 'Doom stops you from playing heroes.')
  }
  if (state.sdBan.some((ban) => ban.uid === uid && findHero(state, ban.sdUid)?.hero.controller === ban.caster)) {
    return log(state, 'Disruption stops that hero from being played.')
  }
  if (needsTeam(held.card.defId, held.card.kind)) {
    const resolved = resolveTeam(state, actor, team)
    if (!resolved) return state
    const dest = teamById(resolved[0], resolved[1])
    const weight = held.card.defId === 'meepo' ? 2 : 1
    const token = held.card.kind === 'neutral'
    if (!dest) return state
    const reason = enterReason(resolved[0], dest.team, weight, token)
    if (reason) return log(state, reason)
  }
  if (!instant) state = setPlayer(state, actor, (player) => ({ ...player, actions: player.actions - 1 }))
  return offerCounter(state, actor, uid, team)
}

function offerCounter(state: Game, actor: PlayerId, uid: string, team: string): Game {
  const enemy = holderWith(state, actor, 'nyx_assassin')
  if (enemy === null) return resolvePlay(state, uid, team)
  const cards = state.players[enemy]!.hand.filter((card) => card.defId === 'nyx_assassin')
  const played = findHand(state, uid)
  const name = played ? display(played.card.defId).name : 'that card'
  return ask(state, {
    actor: enemy,
    prompt: `${pname(state, enemy)} may discard Nyx Assassin to counter ${name}, or pass.`,
    mode: 'pick',
    min: 1,
    max: 1,
    choices: [
      { id: 'pass', label: 'Pass' },
      ...cards.map((card) => ({ id: `nyx:${card.uid}`, label: 'Spiked Carapace', defId: card.defId })),
    ],
    resume: { kind: 'counter', uid, team, actor },
  })
}

function resolvePlay(state: Game, uid: string, team: string): Game {
  const held = findHand(state, uid)
  if (!held) return state
  const actor = held.player.id
  if (held.card.kind === 'hero') return playHero(state, actor, held.card, team)
  if (held.card.kind === 'neutral' && held.card.defId !== 'tormentor') return playToken(state, actor, held.card, team)
  if (held.card.kind === 'item') return playItem(state, actor, held.card)
  return playReward(state, actor, held.card)
}

function playHero(state: Game, actor: PlayerId, card: CardInst, team: string): Game {
  const hero = makeHero(card, actor, actor, state)
  const resolved = resolveTeam(state, actor, team)
  if (!resolved) return state
  let [next, teamId] = resolved
  const dest = teamById(next, teamId)
  if (!dest) return state
  const reason = enterReason(next, dest.team, heroWeight(hero), false)
  if (reason) return log(next, reason)
  next = putOnTeam(removeHand(next, actor, card.uid), actor, teamId, hero)
  const landed = arrived(next, card.uid)
  next = log(landed.state, `${pname(next, actor)} plays ${display(card.defId).name}.`)
  if (card.defId === 'nyx_assassin') return next
  const fires = HEROES.some((entry) => entry.id === card.defId && entry.timing !== 'aura') && !next.silence
  if (!fires) return next
  const resume = { kind: 'cast' as const, actor, sourceUid: card.uid, defId: card.defId, picked: [], steps: 0 }
  if (landed.mined) return { ...next, after: { kind: 'alive', uid: card.uid, cast: resume } }
  if (allLocs(next).some((loc) => loc.hero.defId === 'pugna' && loc.hero.controller !== actor)) {
    return ask(next, {
      actor,
      prompt: 'Nether Ward: discard 1, or the hero does not fire.',
      mode: 'pick',
      min: 1,
      max: 1,
      choices: [
        { id: 'discard', label: 'Discard 1' },
        { id: 'fizzle', label: 'The hero does not fire' },
      ],
      resume: { kind: 'pugna', cast: resume },
    })
  }
  return offerTorment(next, card.uid, resume)
}

function offerTorment(state: Game, heroUid: string, resume: Resume & { kind: 'cast' }): Game {
  const enemy = holderWith(state, resume.actor, 'tormentor')
  if (enemy === null) return cast(state, resume)
  const cards = state.players[enemy]!.hand.filter((card) => card.defId === 'tormentor')
  return ask(state, {
    actor: enemy,
    prompt: 'Play Tormentor on the hero that just entered, or pass.',
    mode: 'pick',
    min: 1,
    max: 1,
    choices: [
      { id: 'pass', label: 'Pass' },
      ...cards.map((card) => ({ id: `torment:${card.uid}`, label: 'Tormentor', defId: card.defId })),
    ],
    resume: { kind: 'torment', heroUid, cast: resume },
  })
}

function playToken(state: Game, actor: PlayerId, card: CardInst, team: string): Game {
  const resolved = resolveTeam(state, actor, team)
  if (!resolved) return state
  const [based, teamId] = resolved
  const dest = teamById(based, teamId)
  if (!dest) return state
  const reason = enterReason(based, dest.team, 1, true)
  if (reason) return log(based, reason)
  const hero = makeHero(card, actor, actor, based)
  const placed = putOnTeam(removeHand(based, actor, card.uid), actor, teamId, hero)
  return log(arrived(placed, card.uid).state, `${pname(placed, actor)} calls ${display(card.defId).name}.`)
}

function playItem(state: Game, actor: PlayerId, card: CardInst): Game {
  let next = removeHand(state, actor, card.uid)
  next = allLocs(next).reduce((current, loc) => {
    if (loc.hero.defId !== 'ursa' || loc.hero.controller !== actor) return current
    return {
      ...current,
      players: current.players.map((player) => ({
        ...player,
        teams: player.teams.map((team) => ({
          ...team,
          heroes: team.heroes.map((hero) =>
            hero.uid === loc.hero.uid ? { ...hero, ward: { caster: actor, fromTurn: current.turn } } : hero,
          ),
        })),
      })) as Game['players'],
    }
  }, next)
  next = toGrave(next, card, { type: 'deck' })
  next = log(next, `${pname(next, actor)} plays ${display(card.defId).name}.`)
  return cast(next, { kind: 'cast', actor, sourceUid: card.uid, defId: card.defId, picked: [], steps: 0 })
}

function playReward(state: Game, actor: PlayerId, card: CardInst): Game {
  const exiled = toExile(removeHand(state, actor, card.uid), card)
  return cast(log(exiled, `${pname(state, actor)} plays ${display(card.defId).name}.`), {
    kind: 'cast',
    actor,
    sourceUid: card.uid,
    defId: card.defId,
    picked: [],
    steps: 0,
  })
}

function moveEmber(state: Game, uid: string, team: string): Game {
  const loc = findHero(state, uid)
  if (!loc || loc.hero.defId !== 'ember_spirit' || loc.hero.controller !== state.active) return state
  const resolved = resolveTeam(state, state.active, team)
  if (!resolved) return state
  const [based, teamId] = resolved
  if (teamId === loc.team.id) return state
  const dest = teamById(based, teamId)
  if (!dest) return state
  const reason = enterReason(based, dest.team, 1, false)
  if (reason) return log(based, reason)
  let next = based
  next = {
    ...next,
    players: next.players.map((player) => ({
      ...player,
      teams: player.teams.map((entry) => ({ ...entry, heroes: entry.heroes.filter((hero) => hero.uid !== uid) })),
    })) as Game['players'],
  }
  next = strip(next)
  next = putOnTeam(next, state.active, teamId, { ...loc.hero, controller: state.active })
  return log(arrived(next, uid).state, 'Fire Remnant.')
}

function morphCast(state: Game, uid: string): Game {
  const loc = findHero(state, uid)
  const held = loc?.hero.held
  if (!loc || !held || held.mode !== 'morph' || held.takenTurn !== state.turn) return state
  if (loc.hero.controller !== state.active || loc.hero.castTurn === state.turn || loc.hero.muted || state.silence) return state
  const copied = held.card.defId
  if (!HEROES.some((hero) => hero.id === copied && hero.timing !== 'aura')) return log(state, 'That hero has no ability to cast.')
  const marked = {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      teams: player.teams.map((team) => ({
        ...team,
        heroes: team.heroes.map((hero) => (hero.uid === uid ? { ...hero, castTurn: state.turn } : hero)),
      })),
    })) as Game['players'],
  }
  return cast(marked, { kind: 'cast', actor: state.active, sourceUid: uid, defId: copied, picked: [], steps: 0 })
}

function satisfy(state: Game, ids: string[]): Game {
  const pending = state.pending
  if (!pending) return state
  const legal = new Set(pending.choices.map((choice) => choice.id))
  if (pending.mode === 'pick' && ids.some((id) => !legal.has(id) && id !== 'pass')) return state
  if (ids.length < pending.min || ids.length > pending.max) return state
  const next: Game = { ...state, pending: null }
  const resume = pending.resume
  if (resume.kind === 'cast') {
    return cast(next, { ...resume, steps: (resume.steps ?? 0) + 1, picked: [...resume.picked, ...ids] })
  }
  if (resume.kind === 'counter') {
    const choice = ids[0]
    if (!choice || choice === 'pass') return resolvePlay(next, resume.uid, resume.team)
    const nyxUid = choice.slice(4)
    let dumped = discardUid(next, pending.actor, nyxUid)
    const card = dumped.players[resume.actor].hand.find((entry) => entry.uid === resume.uid)
    if (card) dumped = toGrave(removeHand(dumped, resume.actor, card.uid), card, { type: 'hand', player: resume.actor })
    return log(dumped, `Spiked Carapace counters ${card ? display(card.defId).name : 'the card'}.`)
  }
  if (resume.kind === 'counter-combo') {
    const choice = ids[0]
    if (!choice || choice === 'pass') return combo(next, resume.uids, true)
    const nyxUid = choice.slice(4)
    let dumped = discardUid(next, pending.actor, nyxUid)
    for (const uid of resume.uids) {
      const card = dumped.players[resume.actor].hand.find((entry) => entry.uid === uid)
      if (card) dumped = toGrave(removeHand(dumped, resume.actor, card.uid), card, { type: 'hand', player: resume.actor })
    }
    return log(dumped, 'Spiked Carapace counters the setting combo.')
  }
  if (resume.kind === 'pugna') {
    if (ids[0] === 'discard') {
      const hand = next.players[resume.cast.actor].hand
      const card = hand[0]
      let dumped = next
      if (card) dumped = discardUid(dumped, resume.cast.actor, card.uid)
      return offerTorment(dumped, resume.cast.sourceUid, resume.cast)
    }
    return log(next, 'The hero does not fire.')
  }
  if (resume.kind === 'torment') {
    const choice = ids[0]
    if (!choice || choice === 'pass' || !resume.cast) return resume.cast ? cast(next, resume.cast) : next
    const uid = choice.slice('torment:'.length)
    const owner = pending.actor
    const card = next.players[owner].hand.find((entry) => entry.uid === uid)
    let played = card ? toExile(removeHand(next, owner, uid), card) : next
    played = enqueue(played, resume.heroUid, 'Tormentor', false, true, owner)
    return { ...played, after: { kind: 'alive', uid: resume.heroUid, cast: resume.cast } }
  }
  if (resume.kind === 'save') {
    const choice = ids[0]
    if (!choice || choice === 'pass') {
      return performDestroy(next, { uid: resume.uid, cause: resume.cause, force: resume.force, window: false, by: null })
    }
    return answerSave(next, choice.slice(5), resume.uid, resume.cause, resume.force)
  }
  if (resume.kind === 'slark') {
    if (ids[0] === 'yes') return slark(next, resume.player, resume.n)
    return takeDraw(next, resume.player, resume.n)
  }
  if (resume.kind === 'limit') {
    let dumped = next
    for (const id of ids) {
      const uid = id.startsWith('card:') ? id.slice(5) : id
      dumped = discardUid(dumped, resume.player, uid)
    }
    if (resume.then === 'end') return endTurn(dumped)
    return dumped
  }
  if (resume.kind === 'bristle' || resume.kind === 'mail') {
    const uid = ids[0]?.startsWith('hero:') ? ids[0].slice(5) : ids[0]
    if (!uid) return next
    return enqueue(next, uid, resume.kind === 'mail' ? 'Blade Mail' : 'Bristleback', false, true, resume.actor)
  }
  if (resume.kind === 'kunkka-split') {
    const pileA = ids.filter((id) => id.startsWith('a:')).map((id) => id.slice(2))
    const pileB = ids.filter((id) => id.startsWith('b:')).map((id) => id.slice(2))
    return ask(next, {
      actor: resume.picker,
      prompt: 'Choose a pile to keep.',
      mode: 'pick',
      min: 1,
      max: 1,
      choices: [
        { id: 'pile:a', label: `Pile A (${pileA.length})` },
        { id: 'pile:b', label: `Pile B (${pileB.length})` },
      ],
      resume: { kind: 'kunkka-choose', pileA, pileB, picker: resume.picker },
    })
  }
  if (resume.kind === 'kunkka-choose') {
    const take = ids[0] === 'pile:b' ? 'b' : 'a'
    return finishKunkka(next, resume.pileA, resume.pileB, resume.picker, take)
  }
  if (resume.kind === 'io') {
    const assignments = ids.map((id) => {
      const [player, uid] = id.split(':')
      return { uid: uid ?? '', player: Number(player) as PlayerId }
    })
    return finishIo(next, assignments)
  }
  if (resume.kind === 'sand') {
    const uid = ids[0]?.startsWith('hero:') ? ids[0].slice(5) : ''
    if (uid) return enqueue(next, uid, 'Epicenter', false, true, null)
    return next
  }
  return next
}

function slark(state: Game, player: PlayerId, draws: number): Game {
  const milled = state.deck.slice(0, 3)
  let next: Game = { ...state, deck: state.deck.slice(milled.length) }
  for (const card of milled) next = toGrave(next, card, { type: 'deck' })
  const index = next.grave.findIndex((card) => card.defId === 'slark')
  if (index >= 0) {
    const card = next.grave[index]
    if (card) {
      next = addHand({ ...next, grave: next.grave.filter((entry) => entry.uid !== card.uid) }, player, [card])
    }
  }
  if (draws > 1) return queueDraw(log(next, 'Shadow Dance.'), player, draws - 1)
  return log(next, 'Shadow Dance.')
}

function answerSave(state: Game, uid: string, dying: string, cause: string, force: boolean): Game {
  const held = findHand(state, uid)
  if (!held) return performDestroy(state, { uid: dying, cause, force, window: false, by: null })
  const actor = held.player.id
  const info = display(held.card.defId)
  let next = removeHand(state, actor, uid)
  const picked = [`hero:${dying}`]
  const team = findHero(state, dying)?.team.id
  if (held.card.kind === 'hero') {
    const hero = makeHero(held.card, actor, actor, next)
    const destTeam = info.name === 'Dawnbreaker' && team ? team : ''
    let teamId = destTeam
    if (!teamId) {
      ;[next, teamId] = seatTeam(next, actor)
    } else {
      const dest = teamById(next, teamId)
      if (!dest || enterReason(next, dest.team, 1, false)) {
        ;[next, teamId] = seatTeam(next, actor)
      }
    }
    next = putOnTeam(next, actor, teamId, hero)
    next = arrived(next, hero.uid).state
  } else if (held.card.kind === 'item') {
    next = toGrave(next, held.card, { type: 'deck' })
  } else {
    next = toExile(next, held.card)
  }
  const targetPick = held.card.defId === 'glyph' && team ? [`team:${team}`] : picked
  next = cast(next, {
    kind: 'cast',
    actor,
    sourceUid: held.card.kind === 'hero' ? held.card.uid : held.card.uid,
    defId: held.card.defId,
    picked: targetPick,
    steps: 1,
    armed: true,
  })
  return performDestroy(next, { uid: dying, cause, force, window: false, by: null })
}

function finish(state: Game, reason: string): Game {
  state = returnPhased(state, state.turn)
  const parts = state.players.map((player) => scoreState(state, player.id))
  const scores = parts.map((part) => part.total)
  const summary = state.players.map((player, index) => `${player.name} ${scores[index]}`).join(', ')
  return {
    ...state,
    pending: null,
    veil: false,
    over: { reason, scores, parts },
    log: [...state.log, `${reason} ${summary}.`],
  }
}

export function teamsFor(state: Game, uid: string): { id: string; label: string; ok: boolean; reason?: string }[] {
  const held = findHand(state, uid)
  if (!held) return []
  const actor = held.player.id
  const token = held.card.kind === 'neutral' && held.card.defId !== 'tormentor'
  const weight = held.card.defId === 'meepo' ? 2 : 1
  const options: { id: string; label: string; ok: boolean; reason?: string }[] = []
  for (const team of state.players[actor].teams) {
    const reason = enterReason(state, team, weight, token)
    const scored = scoreTeam(state, team)
    options.push({ id: team.id, label: `${scored.why} · ${scored.points}`, ok: !reason, reason: reason ?? undefined })
  }
  const capped = state.players[actor].teams.length >= TEAM_CAP
  options.push({ id: 'new', label: 'New team', ok: !capped, reason: capped ? '12 teams is the limit.' : undefined })
  return options
}

export function comboPlans(state: Game): { uids: string[]; label: string; detail: string }[] {
  const hand = state.players[state.active].hand.filter((card) => card.kind === 'setting')
  const plans: { uids: string[]; label: string; detail: string }[] = []
  const rules = getScoreRules()
  for (const kind of ['river', 'jungle', 'lane'] as const) {
    const matches = hand.filter((card) => card.defId === kind)
    if (matches.length >= 3) {
      plans.push({
        uids: matches.slice(0, 3).map((card) => card.uid),
        label: `Three ${kind}s`,
        detail: `core · ${rules.coreCombo} and a reward`,
      })
    }
  }
  const river = hand.find((card) => card.defId === 'river')
  const jungle = hand.find((card) => card.defId === 'jungle')
  const lane = hand.find((card) => card.defId === 'lane')
  if (river && jungle && lane) {
    plans.push({ uids: [river.uid, jungle.uid, lane.uid], label: 'River, Jungle, Lane', detail: `mixed · ${rules.mixCombo}` })
  }
  return plans
}

export function emberMoves(state: Game): { uid: string; name: string }[] {
  return allLocs(state)
    .filter((loc) => loc.hero.defId === 'ember_spirit' && loc.hero.controller === state.active)
    .map((loc) => ({ uid: loc.hero.uid, name: 'Ember Spirit' }))
}

export function morphCasts(state: Game): { uid: string; label: string }[] {
  if (state.silence) return []
  return allLocs(state)
    .filter((loc) => loc.hero.controller === state.active && !loc.hero.muted && loc.hero.castTurn !== state.turn)
    .filter((loc) => loc.hero.held?.mode === 'morph' && loc.hero.held.takenTurn === state.turn)
    .filter((loc) => HEROES.some((hero) => hero.id === loc.hero.held?.card.defId && hero.timing !== 'aura'))
    .map((loc) => ({ uid: loc.hero.uid, label: `Cast ${display(loc.hero.held?.card.defId ?? '').name}` }))
}

function autoIds(state: Game): string[] {
  const pending = state.pending
  if (!pending) return []
  if (pending.mode === 'split') {
    return pending.choices.map((choice, index) => `${index % 2 === 0 ? 'a' : 'b'}:${choice.id}`)
  }
  if (pending.mode === 'assign') {
    const seats = Math.max(2, state.players.length)
    return pending.choices.map((choice, index) => `${index % seats}:${choice.id}`)
  }
  if (pending.mode === 'groups') {
    return pending.choices.map((choice, index) => `${index % 3}:${choice.id}`)
  }
  const nyx = pending.choices.find((choice) => choice.id.startsWith('nyx:'))
  if (nyx) return [nyx.id]
  const torment = pending.choices.find((choice) => choice.id.startsWith('torment:'))
  if (torment) return [torment.id]
  const save = pending.choices.find((choice) => choice.id.startsWith('play:'))
  if (save && pending.prompt.includes('destroyed')) return [save.id]
  if (pending.choices.some((choice) => choice.id === 'pass')) return ['pass']
  const hasYes = pending.choices.some((choice) => choice.id === 'yes')
  const hasNo = pending.choices.some((choice) => choice.id === 'no')
  if (hasYes && hasNo) {
    // Opt into sabotage / stolen casts that improve standing; otherwise soft-pass.
    if (/fire that ability|destroy shadow shaman/i.test(pending.prompt)) return ['yes']
    return ['no']
  }
  if (pending.min === 0) return []
  const focus = preferredFoe(state, pending.actor)
  const scores = state.players.map((player) => scoreState(state, player.id).total)
  const ranked = pending.choices
    .map((choice, index) => ({
      id: choice.id,
      weight: autoChoiceWeight(state, choice.id, pending.actor, focus, scores) - index * 0.001,
    }))
    .sort((a, b) => b.weight - a.weight)
  return ranked.slice(0, pending.max).map((entry) => entry.id)
}

function autoChoiceWeight(
  state: Game,
  choiceId: string,
  actor: PlayerId,
  focus: PlayerId,
  scores: number[],
): number {
  const owner = choiceOwner(state, choiceId)
  if (owner === null) return 0
  if (owner === actor) return -5
  if (owner === focus) return 100 + (scores[owner] ?? 0)
  return (scores[owner] ?? 0)
}

function choiceOwner(state: Game, choiceId: string): PlayerId | null {
  if (choiceId.startsWith('player:')) return Number(choiceId.slice(7))
  if (choiceId.startsWith('hero:')) {
    return findHero(state, choiceId.slice(5))?.hero.controller ?? null
  }
  if (choiceId.startsWith('team:')) {
    return teamById(state, choiceId.slice(5))?.player.id ?? null
  }
  if (choiceId.startsWith('new:')) {
    const seat = Number(choiceId.slice(4))
    return Number.isFinite(seat) ? seat : null
  }
  if (choiceId.startsWith('card:')) {
    const uid = choiceId.slice(5)
    for (const player of state.players) {
      if (player.hand.some((card) => card.uid === uid)) return player.id
    }
  }
  return null
}

export function needsTeam(defId: string, kind: CardKind): boolean {
  if (kind === 'hero') return true
  if (kind === 'neutral' && defId !== 'tormentor') return true
  return false
}
