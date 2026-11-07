import { chooseAiPending } from './ai.ts'
import { ANCIENT_ID, HEROES, ITEMS, REWARDS, TERRAINS, TURN_DRAW, display, firesAbility } from './catalog.ts'
import { cast, continueRestack, finishIo, finishKunkka, finishTimeLapse, offerInstantWindow } from './casts.ts'
import { forSeats, getScoreRules } from './scoring.ts'
import {
  addHand,
  allLocs,
  arrived,
  attrsOf,
  ask,
  askCoupContinue,
  beginDiscard,
  cardsLocked,
  clearEnd,
  discardUid,
  drawItemFromDeck,
  drawsLocked,
  editHero,
  enqueue,
  enterReason,
  resolveTeam,
  expireStart,
  findHand,
  findHero,
  finishTrapChoose,
  holdCast,
  graveLocked,
  holderWith,
  immuneFrom,
  silenced,
  nextSeat,
  heroWeight,
  instantsLocked,
  isTrapHero,
  trapBlock,
  itemsLocked,
  log,
  makeCard,
  makeHero,
  mint,
  plantTrap,
  seatTeam,
  performDestroy,
  seatAncient,
  pname,
  putOnTeam,
  queueDraw,
  randInt,
  removeHand,
  returnLassos,
  returnPhased,
  scoreState,
  scoreTeam,
  setPlayer,
  shuffle,
  takeDraw,
  teamById,
  TEAM_CAP,
  toExile,
  toGrave,
  viperDue,
} from './flow.ts'
import type { Action, AiStrat, CardInst, CardKind, CastResume, Game, Player, PlayerId, Resume } from './types.ts'

export type SeatSpec = { name: string; ai: boolean; strat?: AiStrat }

const DEFAULT_STRAT: AiStrat = 'balanced'

export function createGame(opts: {
  seed?: number
  mode?: 'hotseat' | 'ai' | 'online'
  names?: [string, string]
  seats?: SeatSpec[]
  /** Override The Ancient endgame; defaults to current score rules. */
  ancientEndgame?: boolean
  /** Target score (null = off); defaults to the score rules for this seat count. */
  winScore?: number | null
  /** The Ancient's depth in percent (±5); defaults to the score rules for this seat count. */
  ancientDepth?: number
}): Game {
  const seats = opts.seats ?? legacySeats(opts.mode ?? 'hotseat', opts.names)
  if (seats.length < 2 || seats.length > 8) throw new Error('Grove seats 2 to 8 players.')
  const humans = seats.filter((seat) => !seat.ai).length
  const mode: 'hotseat' | 'ai' | 'online' =
    opts.mode === 'online' ? 'online' : humans >= 2 ? 'hotseat' : 'ai'
  const rules = getScoreRules()
  const ancientEnabled = opts.ancientEndgame ?? rules.ancientEndgame
  const winScore = opts.winScore !== undefined ? opts.winScore : rules.scoreWin ? forSeats(rules.winScores, seats.length) : null
  const ancientDepth = opts.ancientDepth ?? forSeats(rules.ancientDepths, seats.length)
  let state = blank(opts.seed ?? (Date.now() % 100000), mode, seats, ancientEnabled)
  state = { ...state, winScore, holds: [] }
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
  if (ancientEnabled) {
    const made = makeCard(state, ANCIENT_ID, 'ancient')
    state = made[0]
    const placed = placeAncient(state, state.deck, made[1], ancientDepth)
    state = { ...placed[0], deck: placed[1] }
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

/**
 * Insert The Ancient into the remaining deck (deck[0] = next draw) at `depth` percent ±5;
 * 100 puts it last.
 */
export function placeAncient(
  state: Game,
  deck: CardInst[],
  ancient: CardInst,
  depth: number,
): [Game, CardInst[]] {
  const len = deck.length
  if (len === 0 || depth >= 100) return [state, [...deck, ancient]]
  const lo = Math.max(0, depth - 5) / 100
  const hi = Math.min(100, depth + 5) / 100
  const minIdx = Math.floor(lo * len)
  const maxIdx = Math.max(minIdx, Math.min(len, Math.floor(hi * len)))
  const [rolled, offset] = randInt(state, maxIdx - minIdx + 1)
  const index = minIdx + offset
  return [rolled, [...deck.slice(0, index), ancient, ...deck.slice(index)]]
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

function blank(seed: number, mode: 'hotseat' | 'ai' | 'online', seats: SeatSpec[], ancientEnabled = true): Game {
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
    orchid: null,
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
    rupture: null,
    taxAction: null,
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
    laterCasts: [],
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
    exorcismPulse: [],
    spellNullify: [],
    medusaHold: [],
    infests: [],
    ancient: null,
    ancientEnabled,
  }
}

export function apply(state: Game, action: Action): Game {
  if (state.over && action.type !== 'ready') return state
  const base = action.type === 'choose' ? state : { ...state, destroyDepth: 0 }
  let reduced = reduce(base, action)
  const about = responseAbout(state, action, reduced)
  if (about) {
    const count = state.players.length
    const seats = Array.from({ length: count - 1 }, (_, step) => (state.active + step + 1) % count)
    reduced = { ...reduced, respond: { about, seats, index: 0 } }
  }
  return settle(reduced)
}

/** Names the active player's main action when it changed the game, so opponents get a response window. */
function responseAbout(before: Game, action: Action, after: Game): string | null {
  if (before.pending || before.veil || before.over || after.over || after.turn !== before.turn) return null
  const actor = before.active
  const was = before.players[actor]!
  const now = after.players[actor]!
  const changed = was.actions !== now.actions || was.hand.length !== now.hand.length || before.deck.length !== after.deck.length
  if (!changed) return null
  const who = pname(before, actor)
  if (action.type === 'draw') return `${who} draws`
  if (action.type === 'combo') return `${who} places a terrain combo`
  if (action.type === 'morph') return `${who} uses Morphling`
  if (action.type === 'undying') return `${who} revives Undying`
  if (action.type === 'play') {
    const held = findHand(before, action.uid)
    if (held && held.player.id !== actor) return null
    const card = held?.card ?? before.grave[before.grave.length - 1]
    if (card && isTrapHero(card.defId)) return `${who} sets a trap`
    // Hero abilities already open an Instant window after targeting (Illusion has its
    // own pre-play counter). Skipping the second post-play response avoids a double ask.
    if (card && card.kind === 'hero' && firesAbility(card.defId)) return null
    return `${who} plays ${card ? display(card.defId).name : 'a card'}`
  }
  return null
}

/** Instants that only work inside their own windows (counters and redirects). */
const RESPONSE_SKIP = new Set(['illusion', 'nyx_assassin', 'spirit_breaker'])
const ENEMY_HERO_TARGET = new Set(['dagon', 'scythe', 'abyssal', 'earth_spirit', 'disruptor', 'rubick'])
const ANY_HERO_TARGET = new Set(['tusk', 'force_staff', 'euls', 'shadow_demon', 'shadow_blade'])
const ALLY_HERO_TARGET = new Set(['dawnbreaker', 'dazzle', 'oracle', 'io', 'shield', 'bkb', 'glyph'])

function instantHasTarget(state: Game, seat: PlayerId, card: CardInst): boolean {
  const heroes = allLocs(state)
  if (ENEMY_HERO_TARGET.has(card.defId)) return heroes.some((loc) => loc.hero.controller !== seat)
  if (ANY_HERO_TARGET.has(card.defId)) return heroes.length > 0
  if (ALLY_HERO_TARGET.has(card.defId)) return heroes.some((loc) => loc.hero.controller === seat)
  if (card.defId === 'tp_scroll') {
    const mine = heroes.filter((loc) => loc.hero.controller === seat)
    const teams = state.players[seat]!.teams
    const canNew = teams.length < TEAM_CAP
    return mine.some((loc) => canNew || teams.some((team) => team.id !== loc.team.id))
  }
  if (card.defId === 'arcane') return heroes.some((loc) => loc.hero.owner === seat && firesAbility(loc.hero.defId))
  if (card.defId === 'blink') return state.players[seat]!.hand.some((entry) => entry.kind === 'hero' && entry.uid !== card.uid)
  return true
}

export function responseCards(state: Game, seat: PlayerId): CardInst[] {
  if (instantsLocked(state, seat) || cardsLocked(state, seat)) return []
  return state.players[seat]!.hand.filter((card) => {
    if (card.kind === 'terrain' || RESPONSE_SKIP.has(card.defId) || isTrapHero(card.defId)) return false
    if (!display(card.defId).instant) return false
    if (card.kind === 'item' && itemsLocked(state, seat)) return false
    if (card.kind === 'hero' && state.attrBan && state.attrBan.caster !== seat) {
      const attr = HEROES.find((hero) => hero.id === card.defId)?.attr
      if (attr === state.attrBan.attr) return false
    }
    if (needsTeam(card.defId, card.kind) && !teamsFor(state, card.uid).some((option) => option.ok)) return false
    return instantHasTarget(state, seat, card)
  })
}

function offerResponse(state: Game): Game {
  const window = state.respond
  if (!window) return state
  for (let index = window.index; index < window.seats.length; index += 1) {
    const seat = window.seats[index]!
    if (seat === state.active || state.passTurn?.includes(seat)) continue
    const cards = responseCards(state, seat)
    if (cards.length === 0) continue
    return ask({ ...state, respond: { ...window, index: index + 1 } }, {
      actor: seat,
      prompt: `${window.about}. Play an Instant now, pass this action, or pass the rest of this turn.`,
      mode: 'pick',
      min: 1,
      max: 1,
      choices: [
        { id: 'pass', label: 'Pass this action' },
        { id: 'pass-turn', label: 'Pass this turn' },
        ...cards.map((card) => ({
          id: `instant:${card.uid}`,
          label: `Interrupt · ${display(card.defId).name}`,
          defId: card.defId,
          hint: display(card.defId).text,
        })),
      ],
      resume: { kind: 'response' },
    })
  }
  return { ...state, respond: null }
}

function reduce(state: Game, action: Action): Game {
  if (action.type === 'ready') return { ...state, veil: false }
  if (state.veil || state.over) return state
  if (action.type === 'choose') return satisfy(state, action.ids)
  if (state.pending) return state
  if (action.type === 'draw') return drawAction(state)
  if (action.type === 'end') return endTurn(state)
  if (action.type === 'combo') return combo(state, action.uids)
  if (action.type === 'morph') return morphCast(state, action.uid)
  if (action.type === 'undying') return reviveUndying(state, action.team, action.discards)
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
        // Nested cascade always uses the heuristic pending picker (no apply inside).
        // Top-level Watch/sim routes Neural via chooseAiPendingForSeat in App/balance.
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
    if (state.discardsDue && state.discardsDue.length > 0) {
      const [due, ...rest] = state.discardsDue
      state = beginDiscard({ ...state, discardsDue: rest }, due!)
      continue
    }
    if (state.exorcismPulse.length > 0) {
      state = { ...state, exorcismPulse: [] }
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
      state = beginDraw(state, draw!.player, draw!.n)
      continue
    }
    if (state.laterCasts.length > 0) {
      const held = state.laterCasts[state.laterCasts.length - 1]!
      state = { ...state, laterCasts: state.laterCasts.slice(0, -1) }
      state = runAfter(state, { kind: 'alive', uid: held.uid, cast: held.cast })
      continue
    }
    if (state.respond) {
      state = offerResponse(state)
      if (state.pending) continue
    }
    // Empty deck starts the same final round as The Ancient (highest score wins).
    if (state.live && state.deck.length === 0) return beginFinalRound(state, 'The deck is empty.')
    return state
  }
  return log(state, 'The chain of effects stops.')
}

function runAfter(state: Game, after: Resume): Game {
  if (after.kind === 'alive') {
    if (!findHero(state, after.uid)) return state
    if (!castableHero(after.cast.defId)) return state
    // cast() applies silence / Shiva / Orchid, letting immune heroes through.
    return cast(state, after.cast)
  }
  return state
}

function castableHero(defId: string): boolean {
  return display(defId).kind === 'hero' && display(defId).text.length > 0 && firesAbility(defId)
}

function beginDraw(state: Game, player: PlayerId, count: number, how: 'turn' | 'action' | null = null): Game {
  if (count <= 0) return state
  if (drawsLocked(state, player)) return log(state, "Berserker's Call stops the draw.")
  return takeDraw(state, player, count, how)
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
  // Hand limit is enforced at end of turn (discard down to 7), not on action-draws.
  if (state.deck.length === 0) return beginFinalRound(state, 'The deck is empty.')
  state = setPlayer(state, actor, (player) => ({ ...player, actions: player.actions - 1 }))
  return beginDraw(state, actor, 1, 'action')
}

/** Ancient reveal or an empty deck: one more turn each, then highest score wins. */
function beginFinalRound(state: Game, why: string): Game {
  if (state.ancient || state.over) {
    if (state.deck.length === 0 && !state.ancient) return finish(state, 'The deck is empty.')
    return state
  }
  return log(
    { ...state, ancient: { bonusSeat: null, endsLeft: state.players.length } },
    `${why} Final round — each player gets one more turn. Highest score wins.`,
  )
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
  state = claimTarget(state, actor)
  if (state.ancient) {
    const endsLeft = state.ancient.endsLeft - 1
    state = { ...state, ancient: { ...state.ancient, endsLeft } }
    if (endsLeft <= 0) {
      const hasAncient = allLocs(state).some((loc) => loc.hero.defId === 'ancient')
      return finish(state, hasAncient ? 'The Ancient ends the match.' : 'The final round ends the match.')
    }
  }
  if (extra === actor) return startTurn(log(state, 'Refresher Orb grants another turn.'), actor)
  return startTurn(state, nextSeat(state, actor))
}

function startTurn(state: Game, id: PlayerId): Game {
  let guard = 0
  let active = id
  while (guard < state.players.length + 1) {
    guard += 1
    state = { ...state, active, turn: state.turn + 1, respond: null, passTurn: [] }
    state = expireStart(state)
    state = returnPhased(state)
    state = returnLassos(state)
    state = viperDue(state)
    const player = state.players[active]
    if (!player) break
    const held = holdCheck(state, active)
    if (held.over) return held
    state = held
    if (player.skip) {
      state = setPlayer(log(state, `${player.name} skips the turn.`), active, (current) => ({ ...current, skip: false }))
      active = nextSeat(state, active)
      continue
    }
    if (player.noHeroNext) {
      state = setPlayer(state, active, (current) => ({ ...current, noHeroNext: false, noHeroNow: true }))
    }
    const tax =
      state.taxAction && state.taxAction.caster !== active && state.taxAction.fromTurn < state.turn
        ? 1
        : 0
    state = setPlayer(state, active, (current) => ({ ...current, actions: Math.max(0, 2 - tax) }))
    const round = Math.floor((state.turn - 1) / state.players.length) + 1
    const actions = state.players[active].actions
    state = log(
      state,
      `${state.players[active].name}'s turn. Round ${round} · ${scoreState(state, active).total} pts · ${actions} action${actions === 1 ? '' : 's'}${tax ? ' (Ice Path)' : ''}.`,
    )
    state = beginDraw(state, active, TURN_DRAW, 'turn')
    const veil = state.mode === 'hotseat' && !state.autoAll && !state.players[active].ai
    return { ...state, veil }
  }
  return state
}

/** Ending your turn at the target score claims it; opponents get a round to match you or knock you under. */
function claimTarget(state: Game, actor: PlayerId): Game {
  const target = state.winScore
  if (!target) return state
  const holds = (state.holds ?? []).filter((hold) => hold.seat !== actor)
  const score = scoreState(state, actor).total
  if (score < target) return holds.length === (state.holds ?? []).length ? state : { ...state, holds }
  const fresh = !(state.holds ?? []).some((hold) => hold.seat === actor)
  state = { ...state, holds: [...holds, { seat: actor, turn: state.turn }] }
  if (!fresh) return state
  return log(state, `${pname(state, actor)} ends the turn on ${score} — the target is ${target}. Final round: they win at their next turn if they still hold ${target}+ and nobody else does.`)
}

function holdCheck(state: Game, seat: PlayerId): Game {
  const target = state.winScore
  const hold = (state.holds ?? []).find((entry) => entry.seat === seat)
  if (!target || !hold) return state
  // A Refresher turn right after the claim is not "the next turn": opponents must get a chance.
  if (hold.turn >= state.turn - 1) return state
  const holds = (state.holds ?? []).filter((entry) => entry !== hold)
  const scores = state.players.map((player) => scoreState(state, player.id).total)
  const rivals = scores.filter((score, id) => id !== seat && score >= target).length
  if (scores[seat]! >= target && rivals === 0) {
    return finish({ ...state, holds }, `${pname(state, seat)} holds ${scores[seat]} (target ${target}) and wins.`)
  }
  const why = scores[seat]! < target ? `drops to ${scores[seat]}` : 'is matched at the target'
  return log({ ...state, holds }, `${pname(state, seat)} ${why} — the target claim resets.`)
}

function resolveComboCard(state: Game, actor: PlayerId, uid: string): CardInst | null {
  const hand = state.players[actor]?.hand.find((card) => card.uid === uid)
  if (hand) return hand
  const top = playableFromGrave(state, actor)
  if (top && top.uid === uid && top.kind === 'terrain') return top
  return null
}

export function comboShape(cards: { defId: string }[]): 'core' | 'mixed' | 'pair' {
  const kinds = new Set(cards.map((card) => card.defId))
  if (kinds.size === 1) return 'core'
  if (kinds.size === 3) return 'mixed'
  return 'pair'
}

function combo(state: Game, uids: string[]): Game {
  const actor = state.active
  if (cardsLocked(state, actor)) return log(state, 'Chronosphere stops you from playing cards.')
  if (uids.length !== 3) return state
  const cards = uids.map((uid) => resolveComboCard(state, actor, uid))
  if (cards.some((card) => !card || card.kind !== 'terrain')) return state
  const picked = cards as CardInst[]
  const shape = comboShape(picked)
  const same = shape === 'core'
  const rules = getScoreRules()
  const points = same ? rules.coreCombo : shape === 'mixed' ? rules.mixCombo : rules.pairCombo
  const kind = same ? (picked[0]?.defId as 'river' | 'jungle' | 'lane') : shape
  const graveTop = playableFromGrave(state, actor)
  const fromGraveUid = graveTop && uids.includes(graveTop.uid) ? graveTop.uid : null
  let next = state
  if (fromGraveUid) {
    next = { ...next, grave: next.grave.filter((card) => card.uid !== fromGraveUid) }
  }
  for (const uid of uids) {
    if (uid === fromGraveUid) continue
    next = removeHand(next, actor, uid)
  }
  let comboId = ''
  ;[next, comboId] = mint(next)
  next = setPlayer(next, actor, (player) => ({
    ...player,
    combos: [...player.combos, { id: comboId, owner: actor, cards: picked, points, kind, protectedBy: null }],
  }))
  const setName = same ? `three ${picked[0]?.defId}s` : shape === 'mixed' ? 'a mixed path' : 'a split path'
  next = log(next, `${pname(next, actor)} sets ${setName} for ${points}.`)
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
  // Rejections after pulling a card out of the grave / Clinkz exile must not leave it in hand.
  const origin = state

  // Death Prophet: play the top card of the grave (your turn only). Terrains must combo — do not pull them here.
  const graveTop = state.grave[state.grave.length - 1]
  const fromGrave =
    !held &&
    actor === state.active &&
    !!graveTop &&
    graveTop.uid === uid &&
    allLocs(state).some((loc) => loc.hero.defId === 'death_prophet' && loc.hero.controller === actor) &&
    !graveLocked(state, actor)
  // Clinkz: play an exiled item from Death Pact this turn for free.
  const fromClinkz = state.clinkzExile.find((card) => card.uid === uid)
  let clinkzFree = false
  if (fromClinkz && !held) {
    clinkzFree = true
    actor = state.active
    if (cardsLocked(state, actor)) return log(state, 'Chronosphere stops you from playing cards.')
    if (itemsLocked(state, actor)) return log(state, 'Doom locks item cards.')
    state = {
      ...state,
      exile: state.exile.filter((card) => card.uid !== uid),
      clinkzExile: state.clinkzExile.filter((card) => card.uid !== uid),
    }
    state = addHand(state, actor, [fromClinkz])
    held = findHand(state, uid)
  }
  if (fromGrave && graveTop) {
    if (graveTop.kind === 'terrain') {
      return log(state, 'Terrains are played three at a time — include the grave terrain in a combo.')
    }
    // Exorcism spends a normal action — gate before mutating the grave.
    if (cardsLocked(state, actor)) return log(state, 'Chronosphere stops you from playing cards.')
    if (state.players[actor].actions < 1) return state
    state = { ...state, grave: state.grave.slice(0, -1) }
    state = addHand(state, actor, [graveTop])
    held = findHand(state, uid)
  }

  if (!held) return origin
  actor = held.player.id
  if (held.card.kind === 'terrain') return log(origin, 'Terrains are played three at a time.')
  const info = display(held.card.defId)
  const freeGrant = state.freePlay.includes(uid)
  const freeItem =
    held.card.kind === 'item' &&
    (state.freeItems > 0 || clinkzFree || freeGrant)
  const primalFree =
    held.card.kind === 'item' &&
    !!state.primalItems &&
    state.primalItems.caster === actor
  // Exorcism (fromGrave) spends a normal action — it is not a free Instant.
  const handInstant = info.instant && !fromGrave
  const instant = handInstant || freeItem || primalFree || freeGrant
  const offTurn = actor !== state.active
  if (offTurn && !instant) {
    return log(origin, 'Only Instant cards can be played during an opponent\'s turn.')
  }
  // Off-turn instants: no multi-drop, no traps onto board as "plays" that need your turn structure.
  if (offTurn && (extras.length > 0 || isTrapHero(held.card.defId))) {
    return log(origin, 'That Instant cannot be multi-dropped or planted off-turn.')
  }
  if (cardsLocked(state, actor)) return log(origin, 'Chronosphere stops you from playing cards.')
  if (!instant && state.players[actor].actions < 1) return origin
  if (held.card.kind === 'item' && itemsLocked(state, actor)) return log(origin, 'Doom locks item cards.')
  if (handInstant && instantsLocked(state, actor)) {
    return log(origin, 'Battle Trance stops Instant cards.')
  }
  if (held.card.kind === 'hero' && state.players[actor].noHeroNow) {
    return log(origin, 'You cannot play hero cards this turn.')
  }
  // Instant heroes may still enter the board off-turn (e.g. Dazzle/Oracle onto a team).
  if (held.card.kind === 'hero' && state.attrBan && state.attrBan.caster !== actor) {
    const attr = HEROES.find((hero) => hero.id === held.card.defId)?.attr
    if (attr && attr === state.attrBan.attr) return log(origin, "Reaper's Scythe bans that attribute.")
  }
  if (isTrapHero(held.card.defId)) {
    const found = teamById(state, team)
    if (!found) return log(origin, 'Choose any team for the trap.')
    if (found.team.trap || found.team.mine) return log(origin, 'That team already has a trap.')
    const closed = trapBlock(state, found.team)
    if (closed) return log(origin, closed)
    if (!instant) state = setPlayer(state, actor, (player) => ({ ...player, actions: player.actions - 1 }))
    return plantTrap(state, actor, held.card, found.team.id)
  }
  if (state.sdBan.some((ban) => ban.uid === uid && findHero(state, ban.sdUid)?.hero.controller === ban.caster)) {
    return log(origin, 'Disruption stops that hero from being played.')
  }

  const companions = held.card.kind === 'hero'
    ? [...new Set(extras.filter((extra) => extra !== uid))]
    : []
  if (companions.length > 0 && held.card.kind !== 'hero') {
    return log(origin, 'Only heroes can multi-drop.')
  }
  for (const extra of companions) {
    const other = findHand(state, extra)
    if (!other || other.player.id !== actor || other.card.kind !== 'hero') {
      return log(origin, 'A companion hero is missing.')
    }
    if (state.sdBan.some((ban) => ban.uid === extra && findHero(state, ban.sdUid)?.hero.controller === ban.caster)) {
      return log(origin, 'Disruption stops a companion hero.')
    }
  }

  if (needsTeam(held.card.defId, held.card.kind) || companions.length > 0) {
    const resolved = resolveTeam(state, actor, team)
    if (!resolved) return origin
    const dest = teamById(resolved[0], resolved[1])
    if (!dest) return origin
    let weight = held.card.kind === 'hero' || held.card.kind === 'neutral' ? 1 : 0
    for (const _extra of companions) weight += 1
    const token = held.card.kind === 'neutral'
    const reason = enterReason(resolved[0], dest.team, weight, token)
    if (reason) return log(origin, reason)
  }
  if (!instant) state = setPlayer(state, actor, (player) => ({ ...player, actions: player.actions - 1 }))
  if (freeItem && !freeGrant && !clinkzFree) {
    state = { ...state, freeItems: Math.max(0, state.freeItems - 1) }
  }
  if (freeGrant) {
    state = { ...state, freePlay: state.freePlay.filter((id) => id !== uid) }
  }
  // Illusion counters on-turn hero/item plays; skip when reacting off-turn.
  if (!offTurn && (held.card.kind === 'hero' || held.card.kind === 'item')) {
    return offerIllusion(state, actor, uid, team, companions, fromGrave)
  }
  return resolvePlay(state, actor, uid, team, companions, fromGrave)
}

function offerIllusion(
  state: Game,
  actor: PlayerId,
  uid: string,
  team: string,
  extras: string[] = [],
  fromGrave = false,
): Game {
  const enemy = holderWith(state, actor, 'illusion')
  if (enemy === null) return resolvePlay(state, actor, uid, team, extras, fromGrave)
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
    resume: { kind: 'counter', uid, team, actor, extras, fromGrave },
  })
}

function resolvePlay(
  state: Game,
  actor: PlayerId,
  uid: string,
  team: string,
  extras: string[] = [],
  fromGrave = false,
): Game {
  const held = findHand(state, uid)
  if (!held) {
    return landSquad(state, actor, null, extras, team, false)
  }
  if (held.card.kind === 'hero') return landSquad(state, actor, held.card, extras, team, true)
  if (held.card.kind === 'neutral') return playToken(state, actor, held.card, team)
  if (held.card.kind === 'item') return playItem(state, actor, held.card, fromGrave)
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
  const trapped = !!dest.team.trap
  let next = putOnTeam(removeHand(state, actor, card.uid), actor, teamId, hero)
  const landed = arrived(next, card.uid)
  const verb = fire ? (actor === state.active ? 'plays' : 'plays Instant') : 'fields'
  next = log(landed.state, `${pname(next, actor)} ${verb} ${display(card.defId).name}${fire ? '' : ' (silent)'}.`)
  next = {
    ...next,
    lastPlayedHero: { uid: card.uid, defId: card.defId, player: actor, turn: next.turn },
  }
  if (!fire || card.defId === 'nyx_assassin' || card.defId === 'spirit_breaker') return next
  const fires = firesAbility(card.defId) && !silenced(next, card.uid)
  if (!fires) return next
  const resume = { kind: 'cast' as const, actor, sourceUid: card.uid, defId: card.defId, picked: [], steps: 0 }
  if (landed.mined) return { ...next, after: { kind: 'alive', uid: card.uid, cast: resume } }
  // The trap resolves first (including its prompts); the entrant's ability waits its turn.
  if (trapped) return holdCast(next, resume)
  // Targets first, then Instant interrupt (see cast → offerInstantWindow).
  return cast(next, resume)
}

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

function playItem(state: Game, actor: PlayerId, card: CardInst, fromGrave = false): Game {
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
  // Alchemist: draw whenever you play an item.
  for (const loc of allLocs(next)) {
    if (loc.hero.defId === 'alchemist' && loc.hero.controller === actor && !aurasSuppressedSafe(next, actor)) {
      next = queueDraw(next, actor, 1)
    }
  }
  // Exorcism: items played from the grave exile after use (runes/towers already exile).
  next = fromGrave ? toExile(next, card) : toGrave(next, card, { type: 'deck' })
  next = log(next, `${pname(next, actor)} ${playVerb(next, actor)} ${display(card.defId).name}.`)
  const resume = { kind: 'cast' as const, actor, sourceUid: card.uid, defId: card.defId, picked: [], steps: 0 }
  if (
    allLocs(next).some(
      (loc) => loc.hero.defId === 'venomancer' && loc.hero.controller !== actor && !aurasSuppressedSafe(next, loc.hero.controller),
    )
  ) {
    return ask(next, {
      actor,
      prompt: 'Poison Nova: discard a card, or the item does nothing.',
      mode: 'pick',
      min: 1,
      max: 1,
      choices: [
        ...next.players[actor].hand.map((entry) => ({
          id: `card:${entry.uid}`,
          label: `Discard ${display(entry.defId).name}`,
          defId: entry.defId,
        })),
        { id: 'fizzle', label: 'Nullify the item' },
      ],
      resume: { kind: 'venomancer', cast: resume },
    })
  }
  return cast(next, resume)
}

function playVerb(state: Game, actor: PlayerId): string {
  return actor === state.active ? 'plays' : 'plays Instant'
}

function playReward(state: Game, actor: PlayerId, card: CardInst): Game {
  const exiled = toExile(removeHand(state, actor, card.uid), card, null)
  return cast(log(exiled, `${pname(state, actor)} ${playVerb(state, actor)} ${display(card.defId).name}.`), {
    kind: 'cast',
    actor,
    sourceUid: card.uid,
    defId: card.defId,
    picked: [],
    steps: 0,
  })
}

function reviveUndying(state: Game, team: string, discards: string[]): Game {
  const actor = state.active
  if (state.pending || discards.length < 2) return state
  const card = state.grave.find((entry) => entry.defId === 'undying')
  if (!card) return log(state, 'Undying is not in the grave.')
  const hand = state.players[actor]?.hand ?? []
  if (!discards.every((uid) => hand.some((entry) => entry.uid === uid))) {
    return log(state, 'Flesh Golem needs two cards from your hand.')
  }
  const resolved = resolveTeam(state, actor, team)
  if (!resolved) return state
  const [based, teamId] = resolved
  const dest = teamById(based, teamId)
  if (!dest) return state
  const reason = enterReason(based, dest.team, 1, false)
  if (reason) return log(based, reason)
  let next = based
  for (const uid of discards.slice(0, 2)) next = discardUid(next, actor, uid)
  next = { ...next, grave: next.grave.filter((entry) => entry.uid !== card.uid) }
  const hero = makeHero(card, actor, actor, next)
  next = putOnTeam(next, actor, teamId, hero)
  return log(arrived(next, hero.uid).state, 'Flesh Golem: Undying returns.')
}

function morphCast(state: Game, uid: string): Game {
  const loc = findHero(state, uid)
  const held = loc?.hero.held
  if (!loc || !held || held.mode !== 'morph' || held.takenTurn !== state.turn) return state
  if (
    loc.hero.controller !== state.active ||
    loc.hero.castTurn === state.turn ||
    loc.hero.muted ||
    silenced(state, uid) ||
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
    if (!choice || choice === 'pass') {
      return resolvePlay(next, resume.actor, resume.uid, resume.team, extras, !!resume.fromGrave)
    }
    const illuUid = choice.startsWith('illu:') ? choice.slice(5) : choice.slice(4)
    let dumped = next
    const rune = dumped.players[pending.actor]?.hand.find((entry) => entry.uid === illuUid)
    if (rune) dumped = toExile(removeHand(dumped, pending.actor, illuUid), rune)
    const card = dumped.players[resume.actor].hand.find((entry) => entry.uid === resume.uid)
    // Exorcism items that get Illusion-countered still exile (already left the grave).
    if (card) {
      dumped = resume.fromGrave
        ? toExile(removeHand(dumped, resume.actor, card.uid), card)
        : toGrave(removeHand(dumped, resume.actor, card.uid), card, { type: 'hand', player: resume.actor })
    }
    dumped = landCompanions(dumped, resume.actor, extras, resume.team)
    return log(dumped, `Illusion Rune counters ${card ? display(card.defId).name : 'the card'}.`)
  }
  if (resume.kind === 'pugna') {
    const pick = ids[0] ?? ''
    if (pick.startsWith('card:') || pick === 'discard') {
      const hand = next.players[resume.cast.actor].hand
      const card = hand.find((entry) => `card:${entry.uid}` === pick) ?? (pick === 'discard' ? hand[0] : undefined)
      let dumped = next
      if (card) dumped = log(discardUid(dumped, resume.cast.actor, card.uid), `${pname(dumped, resume.cast.actor)} discards ${display(card.defId).name}.`)
      return cast(dumped, resume.cast)
    }
    return log(next, 'The hero does not fire.')
  }
  if (resume.kind === 'venomancer') {
    const pick = ids[0] ?? ''
    if (pick.startsWith('card:') || pick === 'discard') {
      const hand = next.players[resume.cast.actor].hand
      const card = hand.find((entry) => `card:${entry.uid}` === pick) ?? (pick === 'discard' ? hand[0] : undefined)
      let dumped = next
      if (card) dumped = log(discardUid(dumped, resume.cast.actor, card.uid), `${pname(dumped, resume.cast.actor)} discards ${display(card.defId).name}.`)
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
    // Nyx: seat onto your team, then counter (destroy Intelligence casters).
    if (card.defId === 'nyx_assassin') {
      const options = teamsFor(next, cardUid).filter((option) => option.ok)
      if (options.length === 0) {
        return offerInstantWindow(next, resume.heroUid, resume.cast, resume.seats, resume.index + 1)
      }
      if (options.length === 1) return spikeCarapace(play(next, cardUid, options[0]!.id, []), resume.heroUid, pending.actor)
      return ask(next, {
        actor: pending.actor,
        prompt: 'Play Nyx Assassin — choose a team.',
        mode: 'pick',
        min: 1,
        max: 1,
        choices: options.map((option) => ({
          id: `seat:${option.id}`,
          label: option.label,
          defId: card.defId,
          hint: option.reason,
        })),
        resume: { kind: 'nyx-place', cast: resume.cast, heroUid: resume.heroUid, cardUid },
      })
    }
    // Spirit Breaker: seat onto your team, then redirect the ability onto it.
    if (card.defId === 'spirit_breaker' && redirectable(resume.cast)) {
      const options = teamsFor(next, cardUid).filter((option) => option.ok)
      if (options.length === 0) {
        return offerInstantWindow(next, resume.heroUid, resume.cast, resume.seats, resume.index + 1)
      }
      if (options.length === 1) return charge(next, pending.actor, card, resume.heroUid, resume.cast, options[0]!.id)
      return ask(next, {
        actor: pending.actor,
        prompt: 'Play Spirit Breaker — choose a team.',
        mode: 'pick',
        min: 1,
        max: 1,
        choices: options.map((option) => ({
          id: `seat:${option.id}`,
          label: option.label,
          defId: card.defId,
          hint: option.reason,
        })),
        resume: { kind: 'spirit-place', cast: resume.cast, heroUid: resume.heroUid, cardUid },
      })
    }
    // Orchid from interrupt: nullify the ability about to fire (target = that opponent).
    if (card.defId === 'orchid') {
      const stamp = { caster: pending.actor, fromTurn: next.turn }
      let dumped = removeHand(next, pending.actor, cardUid)
      dumped = toGrave(dumped, card, { type: 'hand', player: pending.actor })
      dumped = setPlayer(dumped, resume.cast.actor, (player) => ({ ...player, orchid: stamp }))
      if (immuneFrom(dumped, resume.heroUid, pending.actor)) {
        dumped = log(dumped, `${display(resume.cast.defId).name} is immune — Orchid only locks later abilities.`)
      } else {
        dumped = editHero(dumped, resume.heroUid, (hero) => ({ ...hero, muted: stamp }))
        dumped = log(dumped, `Orchid nullifies ${display(resume.cast.defId).name}.`)
      }
      if (!dumped.after) dumped = { ...dumped, after: { kind: 'alive', uid: resume.heroUid, cast: resume.cast } }
      return dumped
    }
    // Instant heroes that need a team: ask where to place (never auto-pick team 0).
    if (needsTeam(card.defId, card.kind)) {
      const options = teamsFor(next, cardUid).filter((option) => option.ok)
      if (options.length === 0) {
        return offerInstantWindow(next, resume.heroUid, resume.cast, resume.seats, resume.index + 1)
      }
      if (options.length === 1) {
        let played = play(next, cardUid, options[0]!.id, [])
        if (!played.after) {
          played = { ...played, after: { kind: 'alive', uid: resume.heroUid, cast: resume.cast } }
        }
        return played
      }
      return ask(next, {
        actor: pending.actor,
        prompt: `Play Instant ${display(card.defId).name} — choose a team.`,
        mode: 'pick',
        min: 1,
        max: 1,
        choices: options.map((option) => ({
          id: `seat:${cardUid}:${option.id}`,
          label: option.label,
          defId: card.defId,
          hint: option.reason,
        })),
        resume: { kind: 'instant-place', cast: resume.cast, heroUid: resume.heroUid, seats: resume.seats, index: resume.index, cardUid },
      })
    }
    let played = play(next, cardUid, '', [])
    // After the Instant resolves (including its own prompts), resume the ability if the hero remains.
    if (!played.after) {
      played = {
        ...played,
        after: { kind: 'alive', uid: resume.heroUid, cast: resume.cast },
      }
    }
    return played
  }
  if (resume.kind === 'response') {
    const choice = ids[0] ?? 'pass'
    if (choice === 'pass-turn') return { ...next, passTurn: [...(next.passTurn ?? []), pending.actor] }
    const cardUid = choice.startsWith('instant:') ? choice.slice(8) : ''
    const card = next.players[pending.actor]?.hand.find((entry) => entry.uid === cardUid)
    if (!card) return next
    if (!needsTeam(card.defId, card.kind)) return play(next, cardUid, '', [])
    const options = teamsFor(next, cardUid).filter((option) => option.ok)
    if (options.length === 0) return next
    if (options.length === 1) return play(next, cardUid, options[0]!.id, [])
    return ask(next, {
      actor: pending.actor,
      prompt: `Play Instant ${display(card.defId).name} — choose a team.`,
      mode: 'pick',
      min: 1,
      max: 1,
      choices: options.map((option) => ({
        id: `seat:${option.id}`,
        label: option.label,
        defId: card.defId,
        hint: option.reason,
      })),
      resume: { kind: 'response-place', cardUid },
    })
  }
  if (resume.kind === 'response-place') {
    const raw = ids[0] ?? ''
    return play(next, resume.cardUid, raw.startsWith('seat:') ? raw.slice(5) : 'new', [])
  }
  if (resume.kind === 'instant-place') {
    const raw = ids[0] ?? ''
    const parts = raw.startsWith('seat:') ? raw.slice(5).split(':') : []
    const cardUid = parts[0] || resume.cardUid
    const team = parts.slice(1).join(':') || 'new'
    let played = play(next, cardUid, team, [])
    if (!played.after) {
      played = { ...played, after: { kind: 'alive', uid: resume.heroUid, cast: resume.cast } }
    }
    return played
  }
  if (resume.kind === 'nyx-place') {
    const raw = ids[0] ?? ''
    const team = raw.startsWith('seat:') ? raw.slice(5) : 'new'
    return spikeCarapace(play(next, resume.cardUid, team, []), resume.heroUid, pending.actor)
  }
  if (resume.kind === 'spirit-place') {
    const raw = ids[0] ?? ''
    const team = raw.startsWith('seat:') ? raw.slice(5) : 'new'
    const card = next.players[pending.actor]?.hand.find((entry) => entry.uid === resume.cardUid)
    if (!card) return next
    return charge(next, pending.actor, card, resume.heroUid, resume.cast, team)
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
  if (resume.kind === 'ancient-place') return seatAncient(next, resume.actor, resume.card, ids[0] ?? 'new')
  if (resume.kind === 'save') {
    const choice = ids[0]
    if (!choice || choice === 'pass') {
      return performDestroy(next, { uid: resume.uid, cause: resume.cause, force: resume.force, window: false, by: null })
    }
    return answerSave(next, choice.slice(5), resume.uid, resume.cause, resume.force)
  }
  if (resume.kind === 'weaver-ancient') return finishTimeLapse(next, resume.actor, resume.card, ids[0] ?? '')
  if (resume.kind === 'restack') return continueRestack(next, resume.actor, resume.cards, resume.placed, ids[0] ?? '')
  if (resume.kind === 'discard') {
    let dumped = next
    const names: string[] = []
    for (const id of ids) {
      const uid = id.startsWith('card:') ? id.slice(5) : id
      const card = dumped.players[resume.player]?.hand.find((entry) => entry.uid === uid)
      if (!card) continue
      names.push(display(card.defId).name)
      dumped = discardUid(dumped, resume.player, uid)
    }
    return log(dumped, `${resume.cause}: ${pname(dumped, resume.player)} discards ${names.join(', ') || 'nothing'}.`)
  }
  if (resume.kind === 'limit') {
    let dumped = next
    const names: string[] = []
    for (const id of ids) {
      const uid = id.startsWith('card:') ? id.slice(5) : id
      const card = dumped.players[resume.player].hand.find((entry) => entry.uid === uid)
      if (card) names.push(display(card.defId).name)
      dumped = discardUid(dumped, resume.player, uid)
    }
    if (names.length > 0) dumped = log(dumped, `${pname(dumped, resume.player)} discards to the hand limit: ${names.join(', ')}.`)
    if (resume.then === 'end') return endTurn(dumped)
    return dumped
  }
  if (resume.kind === 'jugg-kill') {
    const uid = ids[0]?.startsWith('hero:') ? ids[0].slice(5) : ids[0]
    if (uid) next = enqueue(next, uid, 'Blade Fury', false, true, resume.actor)
    return cast(next, resume.after)
  }
  if (resume.kind === 'bristle' || resume.kind === 'mail') {
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

function redirectable(resume: CastResume): boolean {
  return resume.picked.some((id) => id.startsWith('hero:') || id.startsWith('team:'))
}

/** Nyx seats first (via play), then counters — do not resume the cancelled ability. */
function spikeCarapace(state: Game, heroUid: string, by: PlayerId): Game {
  let next: Game = { ...state, after: null }
  const caster = findHero(next, heroUid)
  if (caster && attrsOf(next, caster.hero).includes('INT')) {
    next = enqueue(next, heroUid, 'Spiked Carapace', false, true, by)
  }
  return log(next, 'Spiked Carapace counters the ability.')
}

/** Spirit Breaker enters the chosen team, then every hero / team the ability targets becomes it. */
function charge(
  state: Game,
  seat: PlayerId,
  card: CardInst,
  heroUid: string,
  resume: CastResume,
  team: string,
): Game {
  let next = play(state, card.uid, team, [])
  next = { ...next, after: null }
  const home = findHero(next, card.uid)
  if (!home) return log(next, 'Charge of Darkness falls short.')
  const picked = resume.picked.map((id) => {
    if (id.startsWith('hero:')) return `hero:${card.uid}`
    if (id.startsWith('team:')) return `team:${home.team.id}`
    return id
  })
  next = log(next, `Charge of Darkness pulls ${display(resume.defId).name} onto Spirit Breaker.`)
  return { ...next, after: { kind: 'alive', uid: heroUid, cast: { ...resume, picked: [...new Set(picked)] } } }
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
  const clinkz = state.clinkzExile.find((card) => card.uid === uid)
  if (clinkz) return { player: state.players[state.active]!, card: clinkz }
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
  // Traps plant face-down on any team that could still take a hero (ally or enemy).
  if (isTrapHero(held.card.defId)) {
    const options: { id: string; label: string; ok: boolean; reason?: string }[] = []
    for (const player of state.players) {
      for (const [index, team] of player.teams.entries()) {
        const scored = scoreTeam(state, team)
        const whose = player.id === actor ? 'Your' : `${player.name}'s`
        const letter = String.fromCharCode(65 + (index % 26))
        const blocked = team.trap || team.mine ? 'That team already has a trap.' : trapBlock(state, team)
        options.push({
          id: team.id,
          label: `${whose} ${letter} ${scored.why} · ${scored.points}`,
          ok: !blocked,
          reason: blocked ?? undefined,
        })
      }
    }
    return options
  }
  const token = held.card.kind === 'neutral'
  const companions = extras.filter((extra) => extra !== uid && findHand(state, extra)?.card.kind === 'hero')
  const weight = (held.card.kind === 'hero' || held.card.kind === 'neutral' ? 1 : 0) + companions.length
  const options: { id: string; label: string; ok: boolean; reason?: string }[] = []
  for (const [index, team] of state.players[actor].teams.entries()) {
    const reason = enterReason(state, team, weight, token)
    const scored = scoreTeam(state, team)
    const letter = String.fromCharCode(65 + (index % 26))
    options.push({
      id: team.id,
      label: `${letter} ${scored.why} · ${scored.points}`,
      ok: !reason,
      reason: reason ?? undefined,
    })
  }
  const capped = state.players[actor].teams.length >= TEAM_CAP
  options.push({ id: 'new', label: 'New team', ok: !capped, reason: capped ? '12 teams is the limit.' : undefined })
  return options
}

export function comboPlans(state: Game): { uids: string[]; label: string; detail: string }[] {
  const actor = state.active
  const hand = state.players[actor].hand.filter((card) => card.kind === 'terrain')
  const graveTop = playableFromGrave(state, actor)
  const pool = graveTop?.kind === 'terrain' ? [...hand, graveTop] : hand
  const plans: { uids: string[]; label: string; detail: string }[] = []
  const rules = getScoreRules()
  const seen = new Set<string>()
  const push = (uids: string[], label: string, detail: string) => {
    const key = [...uids].sort().join('|')
    if (seen.has(key)) return
    seen.add(key)
    plans.push({ uids, label, detail })
  }
  for (const kind of ['river', 'jungle', 'lane'] as const) {
    const matches = pool.filter((card) => card.defId === kind)
    if (matches.length >= 3) {
      push(
        matches.slice(0, 3).map((card) => card.uid),
        `Three ${kind}s`,
        `core · ${rules.coreCombo} and a reward`,
      )
    }
  }
  const river = pool.find((card) => card.defId === 'river')
  const jungle = pool.find((card) => card.defId === 'jungle')
  const lane = pool.find((card) => card.defId === 'lane')
  if (river && jungle && lane) {
    push([river.uid, jungle.uid, lane.uid], 'River, Jungle, Lane', `mixed · ${rules.mixCombo}`)
  }
  for (const kind of ['river', 'jungle', 'lane'] as const) {
    const twins = pool.filter((card) => card.defId === kind).slice(0, 2)
    const odd = pool.find((card) => card.defId !== kind)
    if (twins.length === 2 && odd) {
      push([...twins.map((card) => card.uid), odd.uid], `Two ${kind}s + ${odd.defId}`, `pair · ${rules.pairCombo}`)
    }
  }
  return plans
}

/** Best terrain set the AI should cash now: core / mixed always, a pair only when holding out stops paying. */
export function aiComboPick(state: Game): string[] | null {
  const plans = comboPlans(state)
  const full = plans.find((plan) => plan.detail.startsWith('core')) ?? plans.find((plan) => plan.detail.startsWith('mixed'))
  if (full) return full.uids
  const pair = plans.find((plan) => plan.detail.startsWith('pair'))
  if (!pair) return null
  const seat = state.players[state.active]
  const late = !!state.ancient || state.deck.length <= 12
  const crowded = seat.hand.length >= seat.handLimit
  return late || crowded ? pair.uids : null
}

/** Undying in grave + 2 cards in hand → can discard 2 to seat him. */
export function undyingRevive(state: Game): { ok: boolean; card: CardInst | null } {
  const actor = state.active
  if (state.pending) return { ok: false, card: null }
  const card = state.grave.find((entry) => entry.defId === 'undying') ?? null
  if (!card) return { ok: false, card: null }
  if ((state.players[actor]?.hand.length ?? 0) < 2) return { ok: false, card: null }
  return { ok: true, card }
}

/** Morphling no longer grants a free held-ability cast — attribute switch only. */
export function morphCasts(_state: Game): { uid: string; label: string }[] {
  return []
}

export function needsTeam(defId: string, kind: CardKind): boolean {
  if (kind === 'hero') return true
  if (kind === 'neutral' && defId !== 'tormentor') return true
  return false
}
