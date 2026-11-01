import { chooseAiPending } from './ai.ts'
import { ANCIENT_ID, HEROES, ITEMS, REWARDS, TERRAINS, TURN_DRAW, display, firesAbility } from './catalog.ts'
import { cast, finishIo, finishKunkka } from './casts.ts'
import { getScoreRules } from './scoring.ts'
import {
  addHand,
  allLocs,
  arrived,
  ask,
  askCoupContinue,
  cardsLocked,
  clearEnd,
  discardUid,
  drawItemFromDeck,
  drawsLocked,
  enqueue,
  enterReason,
  resolveTeam,
  expireStart,
  findHand,
  findHero,
  finishTrapChoose,
  graveLocked,
  holderWith,
  nextSeat,
  heroWeight,
  instantsLocked,
  isTrapHero,
  itemsLocked,
  opponents,
  log,
  makeCard,
  makeHero,
  mint,
  plantTrap,
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
  for (const terrain of TERRAINS) {
    for (let copy = 0; copy < 12; copy += 1) {
      const made = makeCard(state, terrain.id, 'terrain')
      state = made[0]
      cards.push(made[1])
    }
  }
  const shuffled = shuffle(state, cards)
  state = { ...shuffled[0], deck: shuffled[1] }
  state = fillPile(state, 'runes')
  state = fillPile(state, 'neutrals')
  state = fillPile(state, 'towers')
  // Opening deal without The Ancient so the final round cannot fire before turn 1.
  for (let id = 0; id < seats.length; id += 1) state = takeDraw(state, id, 3)
  {
    const made = makeCard(state, ANCIENT_ID, 'ancient')
    state = made[0]
    const mixed = shuffle(state, [...state.deck, made[1]])
    state = { ...mixed[0], deck: mixed[1] }
  }
  const names = seats.map((seat) => seat.name)
  const listed = names.length === 2 ? `${names[0]} and ${names[1]}` : names.join(', ')
  state = {
    ...state,
    live: true,
    turn: 0,
    veil: false,
    log: [`${listed} draw 3.`],
  }
  // Seat 0 starts turn 1 with the usual turn draw + 2 actions.
  return startTurn(state, 0)
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
    turn: 0,
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
    frost: null,
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
    stolenCast: false,
    extraTurn: null,
    noDraw: null,
    attrBan: null,
    freeItems: 0,
    clinkzExile: [],
    darkSeer: null,
    primalItems: null,
    freePlay: [],
    lastPlayedHero: null,
    medusaHold: [],
    infests: [],
    ancient: null,
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
  if (action.type === 'play') return play(state, action.uid, action.team, action.extras ?? [])
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
        const stuck = state.pending
        const ids = chooseAiPending(state)
        state = satisfy(state, ids)
        // If auto-pick couldn't meet min/max (empty choices, bad assign), skip the prompt.
        if (state.pending === stuck) {
          state = log({ ...state, pending: null }, 'A choice is skipped.')
        }
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
    // Hand limit is enforced only when ending a turn — draws may go above 7 mid-turn.
    if (state.live && state.deck.length === 0) return finish(state, 'The deck is empty.')
    return state
  }
  return log(state, 'The chain of effects stops.')
}

function runAfter(state: Game, after: Resume): Game {
  if (after.kind === 'alive') {
    if (!findHero(state, after.uid)) return state
    if (state.silence || (state.frost && state.frost.caster !== after.cast.actor) || !castableHero(after.cast.defId)) {
      return state
    }
    return cast(state, after.cast)
  }
  return state
}

function castableHero(defId: string): boolean {
  return display(defId).kind === 'hero' && display(defId).text.length > 0 && firesAbility(defId)
}

function beginDraw(state: Game, player: PlayerId, count: number, asked: boolean): Game {
  if (count <= 0) return state
  if (drawsLocked(state, player)) return log(state, "Berserker's Call stops the draw.")
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
  if (drawsLocked(state, actor)) return log(state, "Berserker's Call stops draws.")
  if (state.players[actor].hand.length >= state.players[actor].handLimit) return log(state, 'Your hand is full.')
  if (state.deck.length === 0) return finish(state, 'The deck is empty.')
  state = setPlayer(state, actor, (player) => ({ ...player, actions: player.actions - 1 }))
  return beginDraw(state, actor, 1, false)
}

function endTurn(state: Game): Game {
  const actor = state.active
  if (state.players[actor].hand.length > state.players[actor].handLimit) return askLimit(state, actor, 'end')
  state = returnPhased(state, state.turn)
  const extra = state.extraTurn
  state = clearEnd({
    ...state,
    extraTurn: null,
    freeItems: 0,
    clinkzExile: [],
    darkSeer: null,
    stolenCast: false,
    freePlay: [],
  })
  if (state.ancient) {
    const endsLeft = state.ancient.endsLeft - 1
    state = { ...state, ancient: { ...state.ancient, endsLeft } }
    if (endsLeft <= 0) return finish(state, 'The Ancient ends the match.')
  }
  if (extra === actor) return startTurn(log(state, 'Refresher Orb grants another turn.'), actor)
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
    state = beginDraw(state, active, TURN_DRAW, false)
    const veil = state.mode === 'hotseat' && !state.autoAll && !state.players[active].ai
    return log(
      { ...state, veil },
      `${state.players[active].name}'s turn. Draws ${TURN_DRAW}. 2 actions.`,
    )
  }
  return state
}

function combo(state: Game, uids: string[]): Game {
  const actor = state.active
  if (cardsLocked(state, actor)) return log(state, 'Chronosphere stops you from playing cards.')
  if (uids.length !== 3) return state
  const cards = uids.map((uid) => state.players[actor].hand.find((card) => card.uid === uid))
  if (cards.some((card) => !card || card.kind !== 'terrain')) return state
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
  const jungles = picked.filter((card) => card.defId === 'jungle').length
  if (jungles > 0) {
    const lunaOwners = new Set(
      allLocs(next)
        .filter((loc) => loc.hero.defId === 'luna' && loc.hero.controller === actor)
        .map((loc) => loc.hero.controller),
    )
    for (const owner of lunaOwners) {
      for (let step = 0; step < jungles; step += 1) {
        next = drawItemFromDeck(next, owner)
      }
    }
  }
  return next
}

/** Spend an action to pitch a stuck hand card (Poison Nova / lone terrains) so the seat can dig. */
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

function play(state: Game, uid: string, team: string, extras: string[] = []): Game {
  // Peek hand owner first — Instant cards may be played off-turn by non-active seats.
  let held = findHand(state, uid)
  let actor = held?.player.id ?? state.active

  // Death Prophet: play the top card of the grave (your turn only).
  const graveTop = state.grave[state.grave.length - 1]
  const fromGrave =
    !held &&
    actor === state.active &&
    !!graveTop &&
    graveTop.uid === uid &&
    allLocs(state).some((loc) => loc.hero.defId === 'death_prophet' && loc.hero.controller === actor) &&
    !graveLocked(state, actor)
  // Clinkz: play an exiled item that was Skeleton-Walked this turn.
  const fromClinkz = state.clinkzExile.find((card) => card.uid === uid)
  if (fromClinkz && !held) {
    actor = state.active
    state = {
      ...state,
      exile: state.exile.filter((card) => card.uid !== uid),
      clinkzExile: state.clinkzExile.filter((card) => card.uid !== uid),
      freeItems: Math.max(0, state.freeItems - 1),
    }
    state = addHand(state, actor, [fromClinkz])
    held = findHand(state, uid)
  }
  if (fromGrave && graveTop) {
    state = { ...state, grave: state.grave.slice(0, -1) }
    state = addHand(state, actor, [graveTop])
    held = findHand(state, uid)
  }

  if (!held) return state
  actor = held.player.id
  if (held.card.kind === 'terrain') return log(state, 'Terrains are played three at a time.')
  const info = display(held.card.defId)
  const freeGrant = state.freePlay.includes(uid)
  const freeItem =
    held.card.kind === 'item' &&
    (state.freeItems > 0 || state.clinkzExile.some((card) => card.uid === held.card.uid) || freeGrant)
  const primalFree =
    held.card.kind === 'item' &&
    !!state.primalItems &&
    state.primalItems.caster === actor
  const instant = info.instant || freeItem || primalFree || freeGrant || fromGrave
  const offTurn = actor !== state.active
  if (offTurn && !instant) {
    return log(state, 'Only Instant cards can be played during an opponent\'s turn.')
  }
  // Off-turn instants: no multi-drop, no traps onto board as "plays" that need your turn structure.
  if (offTurn && (extras.length > 0 || isTrapHero(held.card.defId))) {
    return log(state, 'That Instant cannot be multi-dropped or planted off-turn.')
  }
  if (cardsLocked(state, actor)) return log(state, 'Chronosphere stops you from playing cards.')
  if (!instant && state.players[actor].actions < 1) return state
  if (held.card.kind === 'item' && itemsLocked(state, actor)) return log(state, 'Doom locks item cards.')
  if (instant && !freeItem && !primalFree && !freeGrant && !fromGrave && instantsLocked(state, actor)) {
    return log(state, 'Battle Trance stops Instant cards.')
  }
  if (held.card.kind === 'hero' && state.players[actor].noHeroNow && !offTurn) {
    return log(state, 'You cannot play hero cards this turn.')
  }
  // Instant heroes may still enter the board off-turn (e.g. Dazzle/Oracle onto a team).
  if (held.card.kind === 'hero' && state.attrBan && state.attrBan.caster !== actor) {
    const attr = HEROES.find((hero) => hero.id === held.card.defId)?.attr
    if (attr && attr === state.attrBan.attr) return log(state, "Reaper's Scythe bans that attribute.")
  }
  if (isTrapHero(held.card.defId)) {
    const found = teamById(state, team)
    if (!found) return log(state, 'Choose any team for the trap.')
    if (found.team.trap || found.team.mine) return log(state, 'That team already has a trap.')
    if (!instant) state = setPlayer(state, actor, (player) => ({ ...player, actions: player.actions - 1 }))
    return plantTrap(state, actor, held.card, found.team.id)
  }
  if (state.sdBan.some((ban) => ban.uid === uid && findHero(state, ban.sdUid)?.hero.controller === ban.caster)) {
    return log(state, 'Disruption stops that hero from being played.')
  }

  const companions = held.card.kind === 'hero'
    ? [...new Set(extras.filter((extra) => extra !== uid))]
    : []
  if (companions.length > 0 && held.card.kind !== 'hero') {
    return log(state, 'Only heroes can multi-drop.')
  }
  for (const extra of companions) {
    const other = findHand(state, extra)
    if (!other || other.player.id !== actor || other.card.kind !== 'hero') {
      return log(state, 'A companion hero is missing.')
    }
    if (state.sdBan.some((ban) => ban.uid === extra && findHero(state, ban.sdUid)?.hero.controller === ban.caster)) {
      return log(state, 'Disruption stops a companion hero.')
    }
  }

  if (needsTeam(held.card.defId, held.card.kind) || companions.length > 0) {
    const resolved = resolveTeam(state, actor, team)
    if (!resolved) return state
    const dest = teamById(resolved[0], resolved[1])
    if (!dest) return state
    let weight = held.card.kind === 'hero' || held.card.kind === 'neutral' ? 1 : 0
    for (const _extra of companions) weight += 1
    const token = held.card.kind === 'neutral'
    const reason = enterReason(resolved[0], dest.team, weight, token)
    if (reason) return log(state, reason)
  }
  if (!instant) state = setPlayer(state, actor, (player) => ({ ...player, actions: player.actions - 1 }))
  if (freeItem && !freeGrant) {
    state = {
      ...state,
      freeItems: Math.max(0, state.freeItems - 1),
      clinkzExile: state.clinkzExile.filter((card) => card.uid !== held!.card.uid),
    }
  }
  if (freeGrant) {
    state = { ...state, freePlay: state.freePlay.filter((id) => id !== uid) }
  }
  if (offTurn) {
    state = log(state, `${pname(state, actor)} plays Instant ${info.name}.`)
  }
  // Illusion counters on-turn hero/item plays; skip when reacting off-turn.
  if (!offTurn && (held.card.kind === 'hero' || held.card.kind === 'item')) {
    return offerIllusion(state, actor, uid, team, companions)
  }
  return resolvePlay(state, actor, uid, team, companions)
}

function offerIllusion(state: Game, actor: PlayerId, uid: string, team: string, extras: string[] = []): Game {
  const enemy = holderWith(state, actor, 'illusion')
  if (enemy === null) return resolvePlay(state, actor, uid, team, extras)
  const cards = state.players[enemy]!.hand.filter((card) => card.defId === 'illusion')
  const played = findHand(state, uid)
  const name = played ? display(played.card.defId).name : 'that card'
  const note = extras.length > 0 ? ` (companions still enter)` : ''
  return ask(state, {
    actor: enemy,
    prompt: `${pname(state, enemy)} may play Illusion Rune to counter ${name}${note}, or pass.`,
    mode: 'pick',
    min: 1,
    max: 1,
    choices: [
      { id: 'pass', label: 'Pass' },
      ...cards.map((card) => ({ id: `illu:${card.uid}`, label: 'Illusion Rune', defId: card.defId })),
    ],
    resume: { kind: 'counter', uid, team, actor, extras },
  })
}

function resolvePlay(state: Game, actor: PlayerId, uid: string, team: string, extras: string[] = []): Game {
  const held = findHand(state, uid)
  if (!held) {
    return landSquad(state, actor, null, extras, team, false)
  }
  if (held.card.kind === 'hero') return landSquad(state, actor, held.card, extras, team, true)
  if (held.card.kind === 'neutral') return playToken(state, actor, held.card, team)
  if (held.card.kind === 'item') return playItem(state, actor, held.card)
  return playReward(state, actor, held.card)
}

/** Place silent companions then the active hero onto one concrete team (resolve `new` once). */
function landSquad(
  state: Game,
  actor: PlayerId,
  active: CardInst | null,
  extras: string[],
  team: string,
  fireActive: boolean,
): Game {
  if (!active && extras.length === 0) return state
  const resolved = resolveTeam(state, actor, team)
  if (!resolved) return state
  let [next, teamId] = resolved
  for (const uid of extras) {
    const held = findHand(next, uid)
    if (!held || held.player.id !== actor || held.card.kind !== 'hero') continue
    next = playHeroOnto(next, actor, held.card, teamId, false)
  }
  if (active) next = playHeroOnto(next, actor, active, teamId, fireActive)
  return next
}

function landCompanions(state: Game, actor: PlayerId, extras: string[], team: string): Game {
  return landSquad(state, actor, null, extras, team, false)
}

function playHero(state: Game, actor: PlayerId, card: CardInst, team: string, fire: boolean): Game {
  const resolved = resolveTeam(state, actor, team)
  if (!resolved) return state
  return playHeroOnto(resolved[0], actor, card, resolved[1], fire)
}

function playHeroOnto(state: Game, actor: PlayerId, card: CardInst, teamId: string, fire: boolean): Game {
  const hero = makeHero(card, actor, actor, state)
  const dest = teamById(state, teamId)
  if (!dest) return state
  const reason = enterReason(state, dest.team, heroWeight(hero), false)
  if (reason) return log(state, reason)
  let next = putOnTeam(removeHand(state, actor, card.uid), actor, teamId, hero)
  const landed = arrived(next, card.uid)
  const verb = fire ? 'plays' : 'fields'
  next = log(landed.state, `${pname(next, actor)} ${verb} ${display(card.defId).name}${fire ? '' : ' (silent)'}.`)
  next = {
    ...next,
    lastPlayedHero: { uid: card.uid, defId: card.defId, player: actor, turn: next.turn },
  }
  if (!fire || card.defId === 'nyx_assassin' || card.defId === 'spirit_breaker') return next
  const fires = firesAbility(card.defId) && !next.silence
  if (!fires) return next
  const resume = { kind: 'cast' as const, actor, sourceUid: card.uid, defId: card.defId, picked: [], steps: 0 }
  if (landed.mined) return { ...next, after: { kind: 'alive', uid: card.uid, cast: resume } }
  // Opponents may interrupt with Instant cards before the ability resolves.
  return offerInstantWindow(next, card.uid, resume)
}

/** Let each opponent play an Instant (or pass) before a hero ability fires. */
function offerInstantWindow(
  state: Game,
  heroUid: string,
  resume: CastResumeLike,
  seats?: PlayerId[],
  index = 0,
): Game {
  const order = seats ?? opponents(state, resume.actor)
  if (index >= order.length) return gateAbility(state, heroUid, resume)
  const seat = order[index]!
  const playable = state.players[seat]!.hand.filter((card) => {
    const info = display(card.defId)
    if (!info.instant) return false
    if (card.kind === 'terrain') return false
    // Illusion counters plays, not abilities.
    if (card.defId === 'illusion') return false
    return true
  })
  if (instantsLocked(state, seat)) {
    if (playable.length > 0) {
      state = log(state, `Battle Trance stops ${pname(state, seat)} from playing Instant cards.`)
    }
    return offerInstantWindow(state, heroUid, resume, order, index + 1)
  }
  if (playable.length === 0) return offerInstantWindow(state, heroUid, resume, order, index + 1)
  return ask(state, {
    actor: seat,
    prompt: `${display(resume.defId).name} is about to fire — play an Instant to interrupt, or pass.`,
    mode: 'pick',
    min: 1,
    max: 1,
    choices: [
      { id: 'pass', label: 'Pass' },
      ...playable.map((card) => ({
        id: `instant:${card.uid}`,
        label: display(card.defId).name,
        defId: card.defId,
        hint: 'Instant',
      })),
    ],
    resume: { kind: 'instant-window', cast: resume, heroUid, seats: order, index },
  })
}

/** Pugna tax → cast. Nyx counters only via the Instant interrupt window. */
function gateAbility(state: Game, heroUid: string, resume: CastResumeLike): Game {
  const loc = findHero(state, heroUid)
  if (!loc) return log(state, 'The hero is gone — the ability fizzles.')
  if (loc.hero.muted || state.silence) return log(state, 'The ability is nullified.')
  if (allLocs(state).some((loc) => loc.hero.defId === 'pugna' && loc.hero.controller !== resume.actor && !aurasSuppressedSafe(state, loc.hero.controller))) {
    return ask(state, {
      actor: resume.actor,
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
  return cast(state, resume)
}

type CastResumeLike = Extract<Resume, { kind: 'cast' }>

function aurasSuppressedSafe(state: Game, controller: PlayerId): boolean {
  return allLocs(state).some((loc) => loc.hero.defId === 'viper' && loc.hero.controller !== controller)
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
  const stamp = { caster: actor, fromTurn: next.turn }
  next = allLocs(next).reduce((current, loc) => {
    if (loc.hero.defId !== 'ursa' || loc.hero.controller !== actor) return current
    return {
      ...current,
      players: current.players.map((player) => ({
        ...player,
        teams: player.teams.map((team) => ({
          ...team,
          heroes: team.heroes.map((hero) =>
            hero.uid === loc.hero.uid ? { ...hero, bkb: stamp } : hero,
          ),
        })),
      })) as Game['players'],
    }
  }, next)
  next = toGrave(next, card, { type: 'deck' })
  next = log(next, `${pname(next, actor)} plays ${display(card.defId).name}.`)
  const resume = { kind: 'cast' as const, actor, sourceUid: card.uid, defId: card.defId, picked: [], steps: 0 }
  if (
    allLocs(next).some(
      (loc) => loc.hero.defId === 'venomancer' && loc.hero.controller !== actor && !aurasSuppressedSafe(next, loc.hero.controller),
    )
  ) {
    return ask(next, {
      actor,
      prompt: 'Poison Nova: discard 1, or the item does nothing.',
      mode: 'pick',
      min: 1,
      max: 1,
      choices: [
        { id: 'discard', label: 'Discard 1' },
        { id: 'fizzle', label: 'Nullify the item' },
      ],
      resume: { kind: 'venomancer', cast: resume },
    })
  }
  return cast(next, resume)
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
  if (
    loc.hero.controller !== state.active ||
    loc.hero.castTurn === state.turn ||
    loc.hero.muted ||
    state.silence ||
    (state.frost && state.frost.caster !== state.active)
  ) {
    return state
  }
  const copied = held.card.defId
  if (!firesAbility(copied)) return log(state, 'That hero has no ability to cast.')
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
  const trapDone = finishTrapChoose(state, ids)
  if (trapDone) return trapDone
  let next: Game = { ...state, pending: null }
  const resume = pending.resume
  if (resume.kind === 'cast') {
    return cast(next, { ...resume, steps: (resume.steps ?? 0) + 1, picked: [...resume.picked, ...ids] })
  }
  if (resume.kind === 'counter') {
    const choice = ids[0]
    const extras = resume.extras ?? []
    if (!choice || choice === 'pass') return resolvePlay(next, resume.actor, resume.uid, resume.team, extras)
    const illuUid = choice.startsWith('illu:') ? choice.slice(5) : choice.slice(4)
    let dumped = next
    const rune = dumped.players[pending.actor]?.hand.find((entry) => entry.uid === illuUid)
    if (rune) dumped = toExile(removeHand(dumped, pending.actor, illuUid), rune)
    const card = dumped.players[resume.actor].hand.find((entry) => entry.uid === resume.uid)
    if (card) dumped = toGrave(removeHand(dumped, resume.actor, card.uid), card, { type: 'hand', player: resume.actor })
    dumped = landCompanions(dumped, resume.actor, extras, resume.team)
    return log(dumped, `Illusion Rune counters ${card ? display(card.defId).name : 'the card'}.`)
  }
  if (resume.kind === 'pugna') {
    if (ids[0] === 'discard') {
      const hand = next.players[resume.cast.actor].hand
      const card = hand[0]
      let dumped = next
      if (card) dumped = discardUid(dumped, resume.cast.actor, card.uid)
      return cast(dumped, resume.cast)
    }
    return log(next, 'The hero does not fire.')
  }
  if (resume.kind === 'venomancer') {
    if (ids[0] === 'discard') {
      const hand = next.players[resume.cast.actor].hand
      const card = hand[0]
      let dumped = next
      if (card) dumped = discardUid(dumped, resume.cast.actor, card.uid)
      return cast(dumped, resume.cast)
    }
    return log(next, 'Poison Nova nullifies the item.')
  }
  if (resume.kind === 'instant-window') {
    const choice = ids[0]
    if (!choice || choice === 'pass') {
      return offerInstantWindow(next, resume.heroUid, resume.cast, resume.seats, resume.index + 1)
    }
    const cardUid = choice.startsWith('instant:') ? choice.slice(8) : choice
    const card = next.players[pending.actor]?.hand.find((entry) => entry.uid === cardUid)
    if (!card) {
      return offerInstantWindow(next, resume.heroUid, resume.cast, resume.seats, resume.index + 1)
    }
    // Nyx from hand: counter this ability and destroy the hero (do not put Nyx on the board).
    if (card.defId === 'nyx_assassin') {
      let dumped = discardUid(next, pending.actor, cardUid)
      dumped = enqueue(dumped, resume.heroUid, 'Spiked Carapace', false, true, pending.actor)
      return log(dumped, 'Spiked Carapace counters the ability.')
    }
    const team = needsTeam(card.defId, card.kind)
      ? (next.players[pending.actor]!.teams[0]?.id ?? 'new')
      : ''
    let played = play(next, cardUid, team, [])
    // After the Instant resolves (including its own prompts), resume the ability if the hero remains.
    if (!played.after) {
      played = {
        ...played,
        after: { kind: 'alive', uid: resume.heroUid, cast: resume.cast },
      }
    }
    return played
  }
  if (resume.kind === 'free-play-offer') {
    if (ids[0] === 'yes') {
      const card = next.players[resume.actor]?.hand.find((entry) => entry.uid === resume.uid)
      if (!card) return next
      const withFree = { ...next, freePlay: [...next.freePlay, resume.uid] }
      const team = needsTeam(card.defId, card.kind) ? 'new' : 'new'
      return play(withFree, resume.uid, team, [])
    }
    return log(next, 'They keep the reward for later.')
  }
  if (resume.kind === 'torment') {
    // Legacy path removed — Tormentor is a board token now.
    return resume.cast ? cast(next, resume.cast) : next
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
  if (resume.kind === 'undying-save') {
    const choice = ids[0]
    if (!choice || choice === 'pass') {
      return performDestroy(next, {
        uid: resume.uid,
        cause: resume.cause,
        force: resume.force,
        window: false,
        by: resume.by,
      })
    }
    const cardUid = choice.startsWith('card:') ? choice.slice(5) : ''
    next = discardUid(next, pending.actor, cardUid)
    return log(next, 'Flesh Golem keeps Undying alive.')
  }
  if (resume.kind === 'bristle' || resume.kind === 'mail') {
    if (resume.kind === 'bristle' && ids[0]?.startsWith('team:')) {
      const teamId = ids[0].slice(5)
      const found = teamById(next, teamId)
      if (!found) return next
      return found.team.heroes.reduce(
        (current, hero) => enqueue(current, hero.uid, 'Bristleback', false, true, resume.actor),
        next,
      )
    }
    const uid = ids[0]?.startsWith('hero:') ? ids[0].slice(5) : ids[0]
    if (!uid) return next
    return enqueue(next, uid, resume.kind === 'mail' ? 'Blade Mail' : 'Bristleback', false, true, resume.actor)
  }
  if (resume.kind === 'pa') {
    const uid = ids[0]?.startsWith('hero:') ? ids[0].slice(5) : ids[0]
    let resolved = next
    if (uid) resolved = enqueue(resolved, uid, 'Coup de Grace', false, true, pending.actor)
    return askCoupContinue(resolved, resume.rest)
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

/** Top grave card playable via Death Prophet's Exorcism (controller's turn, not Muerta-locked). */
export function playableFromGrave(state: Game, actor: PlayerId): CardInst | null {
  if (actor !== state.active) return null
  if (graveLocked(state, actor)) return null
  if (!allLocs(state).some((loc) => loc.hero.defId === 'death_prophet' && loc.hero.controller === actor)) return null
  return state.grave[state.grave.length - 1] ?? null
}

function heldForPlay(state: Game, uid: string): { player: { id: PlayerId }; card: CardInst } | null {
  const hand = findHand(state, uid)
  if (hand) return hand
  const top = playableFromGrave(state, state.active)
  if (top && top.uid === uid) return { player: state.players[state.active]!, card: top }
  return null
}

export function teamsFor(
  state: Game,
  uid: string,
  extras: string[] = [],
): { id: string; label: string; ok: boolean; reason?: string }[] {
  const held = heldForPlay(state, uid)
  if (!held) return []
  const actor = held.player.id
  // Traps plant face-down on any existing team (ally or enemy).
  if (isTrapHero(held.card.defId)) {
    const options: { id: string; label: string; ok: boolean; reason?: string }[] = []
    for (const player of state.players) {
      for (const team of player.teams) {
        const scored = scoreTeam(state, team)
        const whose = player.id === actor ? 'Your' : `${player.name}'s`
        const blocked = team.trap || team.mine
        options.push({
          id: team.id,
          label: `${whose} team · ${scored.why} · ${scored.points}`,
          ok: !blocked,
          reason: blocked ? 'That team already has a trap.' : undefined,
        })
      }
    }
    return options
  }
  const token = held.card.kind === 'neutral'
  const companions = extras.filter((extra) => extra !== uid && findHand(state, extra)?.card.kind === 'hero')
  const weight = (held.card.kind === 'hero' || held.card.kind === 'neutral' ? 1 : 0) + companions.length
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
  const hand = state.players[state.active].hand.filter((card) => card.kind === 'terrain')
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
    .filter((loc) => firesAbility(loc.hero.held?.card.defId ?? ''))
    .map((loc) => ({ uid: loc.hero.uid, label: `Cast ${display(loc.hero.held?.card.defId ?? '').name}` }))
}

export function needsTeam(defId: string, kind: CardKind): boolean {
  if (kind === 'hero') return true
  if (kind === 'neutral' && defId !== 'tormentor') return true
  return false
}
