import { CAST_IDS, HERO_BY_ID, REWARD_BY_ID, SAVE_IDS, display } from './catalog.ts'
import { scoreBodies, type ScoreBody } from './scoring.ts'
import type {
  Attr,
  BoardHero,
  CardInst,
  CardKind,
  Choice,
  Game,
  GraveMark,
  Pending,
  Player,
  PlayerId,
  Range,
  StackDestroy,
  Team,
  Timed,
} from './types.ts'

export type SourceKind = 'ability' | 'item' | 'reward'

export function opponents(state: Game, id: PlayerId): PlayerId[] {
  return state.players.map((player) => player.id).filter((player) => player !== id)
}

export function nextSeat(state: Game, id: PlayerId): PlayerId {
  const count = state.players.length
  if (count === 0) return id
  return (id + 1) % count
}

/** Next opponent clockwise. Prefer a picked `player:` id when an effect already chose one. */
export function foe(state: Game, id: PlayerId): PlayerId {
  return nextSeat(state, id)
}

export function holderWith(state: Game, actor: PlayerId, defId: string): PlayerId | null {
  const count = state.players.length
  for (let step = 1; step < count; step += 1) {
    const id = (actor + step) % count
    if (state.players[id]?.hand.some((card) => card.defId === defId)) return id
  }
  return null
}

export function pname(state: Game, id: PlayerId): string {
  return state.players[id].name
}

export function log(state: Game, text: string): Game {
  return { ...state, log: [...state.log, text].slice(-140) }
}

export function rand(state: Game): [Game, number] {
  let seed = state.rng | 0
  seed = (seed + 0x6d2b79f5) | 0
  let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
  const roll = ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  return [{ ...state, rng: seed >>> 0 }, roll]
}

export function randInt(state: Game, count: number): [Game, number] {
  const [next, roll] = rand(state)
  return [next, Math.floor(roll * count)]
}

export function shuffle<T>(state: Game, cards: T[]): [Game, T[]] {
  const next = cards.slice()
  let current = state
  for (let index = next.length - 1; index > 0; index -= 1) {
    let pick = 0
    ;[current, pick] = randInt(current, index + 1)
    const swap = next[index] as T
    next[index] = next[pick] as T
    next[pick] = swap
  }
  return [current, next]
}

export function setPlayer(state: Game, id: PlayerId, fn: (player: Player) => Player): Game {
  return {
    ...state,
    players: state.players.map((player) => (player.id === id ? fn(player) : player)),
  }
}

export interface Loc {
  hero: BoardHero
  team: Team
  player: Player
}

export function allLocs(state: Game): Loc[] {
  const found: Loc[] = []
  for (const player of state.players) {
    for (const team of player.teams) {
      for (const hero of team.heroes) found.push({ hero, team, player })
    }
  }
  return found
}

export function findHero(state: Game, uid: string): Loc | null {
  return allLocs(state).find((loc) => loc.hero.uid === uid) ?? null
}

export function findHand(state: Game, uid: string): { player: Player; card: CardInst } | null {
  for (const player of state.players) {
    const card = player.hand.find((entry) => entry.uid === uid)
    if (card) return { player, card }
  }
  return null
}

export function editHero(state: Game, uid: string, fn: (hero: BoardHero) => BoardHero | null): Game {
  const players = state.players.map((player) => ({
    ...player,
    teams: player.teams.map((team) => ({
      ...team,
      heroes: team.heroes.flatMap((hero) => {
        if (hero.uid !== uid) return [hero]
        const next = fn(hero)
        return next ? [next] : []
      }),
    })),
  }))
  return strip({ ...state, players })
}

export function updateTeam(state: Game, teamId: string, fn: (team: Team) => Team): Game {
  const players = state.players.map((player) => ({
    ...player,
    teams: player.teams.map((team) => (team.id === teamId ? fn(team) : team)),
  }))
  return strip({ ...state, players })
}

export function strip(state: Game): Game {
  const players = state.players.map((player) => ({
    ...player,
    teams: player.teams
      .map((team) => ({
        ...team,
        gaze: team.heroes.some((hero) => hero.defId === 'medusa'),
      }))
      .filter((team) => team.heroes.length > 0 || team.mine),
  }))
  return { ...state, players }
}

export function heroWeight(hero: BoardHero): number {
  return hero.defId === 'meepo' ? 2 : 1
}

export function teamSize(team: Team): number {
  return team.heroes.reduce((sum, hero) => sum + heroWeight(hero), 0)
}

export function attrsOf(state: Game, hero: BoardHero): Attr[] {
  const loc = findHero(state, hero.uid)
  if (!hero.bkb && loc?.team.gaze) return []
  if (!hero.bkb && elderOrder(state, hero.controller)) return []
  if (hero.attrMode === 'none') return []
  if (hero.attrMode === 'set') return hero.attrSet
  if (hero.defId === 'brewmaster') return ['STR', 'AGI', 'INT']
  const reward = REWARD_BY_ID[hero.defId]
  if (reward?.attr) return [reward.attr]
  const base = HERO_BY_ID[hero.defId]?.attr
  if (!base) return []
  if (hero.gained && hero.gained !== base) return [base, hero.gained]
  return [base]
}

export function rangeOf(hero: BoardHero): Range | null {
  if (hero.token) return null
  if (hero.defId === 'dragon_knight') return 'Ranged'
  return HERO_BY_ID[hero.defId]?.range ?? null
}

function elderOrder(state: Game, controller: PlayerId): boolean {
  return allLocs(state).some(
    (loc) => loc.hero.defId === 'elder_titan' && loc.hero.controller !== controller,
  )
}

export function bodiesOf(state: Game, team: Team): ScoreBody[] {
  return team.heroes.map((hero) => ({
    attrs: attrsOf(state, hero),
    range: rangeOf(hero),
    count: heroWeight(hero),
  }))
}

export function scoreTeam(state: Game, team: Team): { points: number; why: string } {
  return scoreBodies(bodiesOf(state, team))
}

export function scoreState(state: Game, id: PlayerId): { teams: number; settings: number; total: number } {
  const player = state.players[id]
  const teams = player.teams.reduce((sum, team) => sum + scoreTeam(state, team).points, 0)
  const settings = player.combos.reduce((sum, combo) => sum + combo.points, 0)
  return { teams, settings, total: teams + settings }
}

export function controls(state: Game, id: PlayerId, defId: string): boolean {
  return allLocs(state).some((loc) => loc.hero.defId === defId && loc.hero.controller === id)
}

export function graveLocked(state: Game, actor: PlayerId): boolean {
  return allLocs(state).some(
    (loc) => loc.hero.defId === 'muerta' && loc.hero.controller !== actor,
  )
}

export function cardsLocked(state: Game, id: PlayerId): boolean {
  return !!state.lockPlay && state.lockPlay.caster !== id
}

export function itemsLocked(state: Game, id: PlayerId): boolean {
  return allLocs(state).some(
    (loc) => loc.hero.defId === 'venomancer' && loc.hero.controller !== id,
  )
}

export function teamById(state: Game, teamId: string): { team: Team; player: Player } | null {
  for (const player of state.players) {
    const team = player.teams.find((entry) => entry.id === teamId)
    if (team) return { team, player }
  }
  return null
}

export function blankTeam(id: string): Team {
  return { id, heroes: [], gaze: false, noEnter: null, noLeave: null, glyph: null, mine: null }
}

export function addTeam(state: Game, id: PlayerId, team: Team): Game {
  return setPlayer(state, id, (player) => ({ ...player, teams: [...player.teams, team] }))
}

export function mint(state: Game): [Game, string] {
  return [{ ...state, nextId: state.nextId + 1 }, `c${state.nextId}`]
}

export function makeCard(state: Game, defId: string, kind: CardKind): [Game, CardInst] {
  const [next, uid] = mint(state)
  return [next, { uid, defId, kind }]
}

export function makeHero(card: CardInst, owner: PlayerId, controller: PlayerId, state: Game): BoardHero {
  return {
    uid: card.uid,
    defId: card.defId,
    owner,
    controller,
    enteredTurn: state.turn,
    enteredSeq: state.seq,
    attrMode: 'base',
    attrSet: [],
    gained: null,
    token: card.kind === 'neutral',
    roshan: card.defId === 'roshan',
    rupture: false,
    omni: false,
    abaddon: card.defId === 'abaddon',
    shield: null,
    ward: null,
    hidden: null,
    bkb: null,
    muted: false,
    dawn: null,
    wk: card.defId === 'wraith_king',
    refract: card.defId === 'templar_assassin',
    held: null,
    castTurn: -1,
  }
}

function wardBlocks(hero: BoardHero, team: Team, source: SourceKind): boolean {
  if (hero.shield) return true
  if (team.glyph) return true
  return source === 'ability' && false
}

export function canTargetHero(state: Game, actor: PlayerId, hero: BoardHero, source: SourceKind): boolean {
  const loc = findHero(state, hero.uid)
  if (!loc) return false
  if (wardBlocks(hero, loc.team, source)) return false
  if (hero.bkb && hero.controller !== actor) return false
  if (hero.controller === actor) return true
  if (hero.defId === 'riki' || hero.hidden) return false
  if (source === 'ability' && hero.defId === 'kez') return false
  if (source === 'ability' && loc.team.heroes.some((mate) => mate.defId === 'mars' && mate.controller === hero.controller)) {
    return false
  }
  return true
}

export function canTargetTeam(_state: Game, actor: PlayerId, team: Team, owner: PlayerId, source: SourceKind): boolean {
  if (team.glyph && source !== 'ability') return false
  if (team.glyph) return false
  if (owner !== actor && source === 'ability' && team.heroes.some((hero) => hero.defId === 'mars' && hero.controller === owner)) {
    return false
  }
  return true
}

export function comboLocked(state: Game, comboId: string): boolean {
  for (const player of state.players) {
    const combo = player.combos.find((entry) => entry.id === comboId)
    if (combo?.protectedBy && findHero(state, combo.protectedBy)) return true
  }
  return false
}

export function ask(state: Game, pending: Pending): Game {
  if (pending.mode === 'pick' && pending.min > 0 && pending.choices.length === 0) {
    return log(state, 'There is no legal choice.')
  }
  return { ...state, pending }
}

export function queueDraw(state: Game, player: PlayerId, count: number): Game {
  if (count <= 0) return state
  return { ...state, pendingDraws: [...state.pendingDraws, { player, n: count }] }
}

export function enqueue(
  state: Game,
  uid: string,
  cause: string,
  force: boolean,
  window: boolean,
  by: PlayerId | null,
): Game {
  const item: StackDestroy = { uid, cause, force, window, by }
  return { ...state, queue: [...state.queue, item] }
}

export function removeHand(state: Game, id: PlayerId, uid: string): Game {
  return setPlayer(state, id, (player) => ({
    ...player,
    hand: player.hand.filter((card) => card.uid !== uid),
  }))
}

export function addHand(state: Game, id: PlayerId, cards: CardInst[]): Game {
  if (cards.length === 0) return state
  return setPlayer(state, id, (player) => ({ ...player, hand: [...player.hand, ...cards] }))
}

function iceBlast(state: Game, controller: PlayerId): boolean {
  return allLocs(state).some(
    (loc) => loc.hero.defId === 'ancient_apparition' && loc.hero.controller !== controller,
  )
}

export function toExile(state: Game, card: CardInst): Game {
  return log(
    { ...state, exile: [...state.exile, card] },
    `${display(card.defId).name} is exiled.`,
  )
}

export function toGrave(state: Game, card: CardInst, origin: GraveMark['origin']): Game {
  if (card.kind === 'rune' || card.kind === 'neutral' || card.kind === 'tower') return toExile(state, card)
  const owner = origin.type === 'board' ? origin.hero.controller : origin.type === 'hand' ? origin.player : null
  if (card.kind === 'hero' && owner !== null && iceBlast(state, owner)) {
    return toExile(state, card)
  }
  let next: Game = {
    ...state,
    grave: [...state.grave, card],
    graveThisTurn: state.graveThisTurn + 1,
    lastGrave: { card, turn: state.turn, origin },
  }
  if (card.kind === 'item') {
    for (const loc of allLocs(next)) {
      if (loc.hero.defId === 'alchemist') next = queueDraw(next, loc.hero.controller, 1)
    }
  }
  if (origin.type === 'hand') {
    next = punishDiscard(next, origin.player)
  }
  return next
}

function punishDiscard(state: Game, player: PlayerId): Game {
  if (!state.maledict.some((mark) => mark.player === player && mark.turn === state.turn)) return state
  const heroes = allLocs(state).filter((loc) => loc.hero.controller === player)
  if (heroes.length === 0) return state
  const [next, index] = randInt(state, heroes.length)
  const hit = heroes[index]
  if (!hit) return next
  return enqueue(next, hit.hero.uid, 'Maledict', false, true, null)
}

export function discardUid(state: Game, id: PlayerId, uid: string): Game {
  const card = state.players[id].hand.find((entry) => entry.uid === uid)
  if (!card) return state
  return toGrave(removeHand(state, id, uid), card, { type: 'hand', player: id })
}

export function discardRandom(state: Game, id: PlayerId, count: number): Game {
  let next = state
  for (let step = 0; step < count; step += 1) {
    const hand = next.players[id].hand
    if (hand.length === 0) break
    let index = 0
    ;[next, index] = randInt(next, hand.length)
    const card = hand[index]
    if (!card) break
    next = discardUid(next, id, card.uid)
    next = log(next, `${pname(next, id)} discards ${display(card.defId).name}.`)
  }
  return next
}

export function takeDraw(state: Game, id: PlayerId, count: number): Game {
  const cards = state.deck.slice(0, count)
  if (cards.length === 0) return log(state, `${pname(state, id)} cannot draw. The deck is empty.`)
  const next = addHand({ ...state, deck: state.deck.slice(cards.length) }, id, cards)
  return log(next, `${pname(next, id)} draws ${cards.length}.`)
}

export function pullTop(state: Game, count: number): [Game, CardInst[]] {
  return [{ ...state, deck: state.deck.slice(count) }, state.deck.slice(0, count)]
}

export function heroChoices(
  state: Game,
  actor: PlayerId,
  source: SourceKind,
  pred: (loc: Loc) => boolean,
): Choice[] {
  return allLocs(state)
    .filter((loc) => pred(loc) && canTargetHero(state, actor, loc.hero, source))
    .map((loc) => ({
      id: `hero:${loc.hero.uid}`,
      label: display(loc.hero.defId).name,
      hint: `${pname(state, loc.hero.controller)} · ${scoreTeam(state, loc.team).why}`,
      defId: loc.hero.defId,
    }))
}

export function teamChoices(
  state: Game,
  actor: PlayerId,
  source: SourceKind,
  pred: (team: Team, player: Player) => boolean,
): Choice[] {
  const choices: Choice[] = []
  for (const player of state.players) {
    for (const team of player.teams) {
      if (!pred(team, player)) continue
      if (!canTargetTeam(state, actor, team, player.id, source)) continue
      const scored = scoreTeam(state, team)
      choices.push({
        id: `team:${team.id}`,
        label: `${pname(state, player.id)}'s team`,
        hint: `${scored.why} · ${scored.points}`,
        defId: team.heroes[0]?.defId,
      })
    }
  }
  return choices
}

export function enterReason(_state: Game, team: Team, weight: number, token: boolean): string | null {
  if (team.noEnter) return 'Heroes cannot enter that team.'
  if (teamSize(team) + weight > 5) return 'That team would hold more than 5 heroes.'
  if (token && team.heroes.some((hero) => hero.token)) return 'That team already has a neutral.'
  return null
}

export function putOnTeam(state: Game, playerId: PlayerId, teamId: string, hero: BoardHero): Game {
  return updateTeam(state, teamId, (team) => ({
    ...team,
    heroes: [...team.heroes, { ...hero, controller: playerId }],
  }))
}

export function touchEnter(state: Game, uid: string): Game {
  const seq = state.seq + 1
  return editHero(
    { ...state, seq, enteredThisTurn: [...state.enteredThisTurn, uid] },
    uid,
    (hero) => ({ ...hero, enteredSeq: seq, enteredTurn: state.turn }),
  )
}

export function arrived(state: Game, uid: string): { state: Game; mined: boolean } {
  const loc = findHero(state, uid)
  if (!loc) return { state, mined: false }
  state = touchEnter(state, uid)
  const current = findHero(state, uid)
  if (!current) return { state, mined: false }
  if (current.team.mine) {
    const mine = current.team.mine
    state = updateTeam(state, current.team.id, (team) => ({ ...team, mine: null }))
    state = toGrave(state, mine, { type: 'deck' })
    state = enqueue(state, uid, 'Proximity Mines', false, false, null)
    return { state, mined: true }
  }
  const allies = current.team.heroes.filter(
    (hero) => hero.defId === 'lycan' && hero.uid !== uid && hero.controller === current.hero.controller,
  )
  for (let index = 0; index < allies.length; index += 1) {
    state = queueDraw(state, current.hero.controller, 1)
  }
  return { state, mined: false }
}

export function releaseHeld(state: Game, hero: BoardHero): Game {
  if (!hero.held) return state
  const held = hero.held
  state = editHero(state, hero.uid, (current) => ({ ...current, held: null, gained: null }))
  let cardState = state
  const made = makeHero(held.card, held.owner, held.owner, cardState)
  let teamId = ''
  ;[cardState, teamId] = seatTeam(cardState, held.owner)
  cardState = putOnTeam(cardState, held.owner, teamId, made)
  const landed = arrived(cardState, made.uid)
  return log(landed.state, `${display(held.card.defId).name} returns from under ${display(hero.defId).name}.`)
}

export function extract(state: Game, uid: string): { state: Game; hero: BoardHero | null } {
  const loc = findHero(state, uid)
  if (!loc) return { state, hero: null }
  return { state: editHero(state, uid, () => null), hero: loc.hero }
}

export function removeHero(state: Game, uid: string): { state: Game; hero: BoardHero | null } {
  const loc = findHero(state, uid)
  if (!loc) return { state, hero: null }
  state = releaseHeld(state, loc.hero)
  const fresh = findHero(state, uid)
  state = editHero(state, uid, () => null)
  return { state, hero: fresh?.hero ?? loc.hero }
}

export function bounce(state: Game, uid: string, cause: string, ignoreRupture = false): Game {
  const loc = findHero(state, uid)
  if (!loc) return state
  if (loc.hero.bkb || loc.player.bkb) return log(state, `${display(loc.hero.defId).name} cannot be returned to a hand.`)
  if (loc.team.noLeave) return log(state, `Dream Coil holds ${display(loc.hero.defId).name} in place.`)
  if (loc.hero.rupture && !ignoreRupture) return enqueue(state, uid, 'Rupture', false, true, null)
  const owner = loc.hero.owner
  const removed = removeHero(state, uid)
  if (!removed.hero) return state
  const card: CardInst = {
    uid: removed.hero.uid,
    defId: removed.hero.defId,
    kind: removed.hero.token ? 'neutral' : 'hero',
  }
  return log(
    addHand(removed.state, owner, [card]),
    `${cause}: ${display(card.defId).name} returns to ${pname(state, owner)}'s hand.`,
  )
}

function prevented(state: Game, loc: Loc, force: boolean, by: PlayerId | null): string | null {
  if (force || (state.troll && by !== null && state.troll.player === by && state.troll.turn === state.turn)) {
    return null
  }
  const name = display(loc.hero.defId).name
  if (state.naga) return `${name} cannot be destroyed.`
  if (loc.hero.bkb || loc.player.bkb) return `${name} is protected by Black King Bar.`
  if (loc.team.glyph) return `Glyph protects ${name}.`
  if (loc.hero.shield) return `Shield protects ${name}.`
  if (loc.hero.ward) return `${name} cannot be destroyed.`
  if (loc.hero.defId === 'huskar' && loc.player.hand.length <= 3) return "Berserker's Blood holds Huskar."
  return null
}

export function performDestroy(state: Game, item: StackDestroy): Game {
  if (state.destroyDepth > 10) return log(state, 'The chain of destruction ends.')
  state = { ...state, destroyDepth: state.destroyDepth + 1 }
  const loc = findHero(state, item.uid)
  if (!loc) return state
  const name = display(loc.hero.defId).name
  const soft = prevented(state, loc, item.force, item.by)
  if (soft) return log(state, soft)
  const forced = item.force || (!!state.troll && item.by !== null && state.troll.player === item.by && state.troll.turn === state.turn)

  if (!forced && loc.hero.omni) {
    return log(
      editHero(state, loc.hero.uid, (hero) => ({ ...hero, omni: false })),
      `Guardian Angel saves ${name}.`,
    )
  }
  if (!forced && loc.player.mailTurn === state.turn) {
    const enemies = allLocs(state).filter((other) => other.hero.controller !== loc.hero.controller)
    if (enemies.length === 0) return log(state, `Blade Mail saves ${name}.`)
    return ask(state, {
      actor: loc.hero.controller,
      prompt: `Blade Mail saves ${name}. Destroy an enemy hero instead.`,
      mode: 'pick',
      min: 1,
      max: 1,
      choices: enemies.map((other) => ({
        id: `hero:${other.hero.uid}`,
        label: display(other.hero.defId).name,
        defId: other.hero.defId,
      })),
      resume: { kind: 'mail', actor: loc.hero.controller },
    })
  }
  if (!forced && loc.hero.abaddon === false) {
    const saver = allLocs(state).find(
      (other) =>
        other.hero.abaddon &&
        other.hero.uid !== loc.hero.uid &&
        other.hero.controller === loc.hero.controller,
    )
    if (saver) {
      state = editHero(state, saver.hero.uid, (hero) => ({ ...hero, abaddon: false }))
      state = log(state, `Borrowed Time destroys Abaddon instead of ${name}.`)
      return enqueue(state, saver.hero.uid, 'Borrowed Time', false, item.window, item.by)
    }
  }
  if (!forced && !loc.hero.roshan) {
    const roshan = loc.team.heroes.find((hero) => hero.roshan && hero.uid !== loc.hero.uid)
    if (roshan) {
      state = log(state, `Roshan is destroyed instead of ${name}.`)
      return enqueue(state, roshan.uid, 'Roshan', false, item.window, item.by)
    }
  }
  if (!forced && loc.hero.dawn && loc.hero.dawn.turn === state.turn) {
    const caster = loc.hero.dawn.caster
    const removed = removeHero(state, loc.hero.uid)
    if (!removed.hero) return state
    const card: CardInst = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' }
    return log(addHand(removed.state, caster, [card]), `Solar Guardian returns ${name} to hand.`)
  }
  if (!forced && loc.hero.defId === 'phantom_lancer') {
    return bounce(state, loc.hero.uid, 'Juxtapose', true)
  }
  if (!forced && loc.hero.wk) {
    return log(
      editHero(state, loc.hero.uid, (hero) => ({ ...hero, wk: false })),
      'Reincarnation returns Wraith King to the team.',
    )
  }
  if (!forced && item.window && hasSave(state, loc.hero.controller)) {
    return ask(state, {
      actor: loc.hero.controller,
      prompt: `${name} would be destroyed. Play a save, or pass.`,
      mode: 'pick',
      min: 1,
      max: 1,
      choices: [
        { id: 'pass', label: 'Pass' },
        ...saveChoices(state, loc.hero.controller),
      ],
      resume: { kind: 'save', uid: item.uid, cause: item.cause, force: item.force },
    })
  }

  const teamId = loc.team.id
  const snapshot = loc.hero
  const removed = removeHero(state, snapshot.uid)
  state = removed.state
  if (!removed.hero) return state
  const card: CardInst = {
    uid: removed.hero.uid,
    defId: removed.hero.defId,
    kind: removed.hero.token ? 'neutral' : 'hero',
  }
  if (removed.hero.token) state = toExile(state, card)
  else state = toGrave(state, card, { type: 'board', hero: snapshot, teamId })
  state = log(state, `${item.cause} destroys ${name}.`)
  state = onDestroyed(state, snapshot, teamId)
  return state
}

function hasSave(state: Game, id: PlayerId): boolean {
  return state.players[id].hand.some((card) => SAVE_IDS.has(card.defId))
}

function saveChoices(state: Game, id: PlayerId): Choice[] {
  return state.players[id].hand
    .filter((card) => SAVE_IDS.has(card.defId))
    .map((card) => ({ id: `play:${card.uid}`, label: display(card.defId).name, defId: card.defId }))
}

function onDestroyed(state: Game, hero: BoardHero, teamId: string): Game {
  for (const loc of allLocs(state)) {
    if (loc.hero.defId === 'shadow_fiend') state = queueDraw(state, loc.hero.controller, 1)
    if (loc.hero.defId === 'death_prophet' && loc.hero.controller === hero.owner) {
      state = queueDraw(state, loc.hero.controller, 2)
    }
  }
  for (const bond of state.soulbind) {
    if (bond.a !== hero.uid && bond.b !== hero.uid) continue
    const other = bond.a === hero.uid ? bond.b : bond.a
    if (findHero(state, other)) state = enqueue(state, other, 'Soulbind', false, true, null)
  }
  if (state.bonds.some((bond) => bond.teamId === teamId && bond.turn === state.turn)) {
    state = stampBonds(state, teamId, hero.uid)
  }
  if (hero.defId === 'bristleback') {
    const enemies = allLocs(state).filter((loc) => loc.hero.controller !== hero.controller)
    if (enemies.length > 0) {
      return ask(state, {
        actor: hero.controller,
        prompt: 'Bristleback: destroy an enemy hero.',
        mode: 'pick',
        min: 1,
        max: 1,
        choices: enemies.map((loc) => ({
          id: `hero:${loc.hero.uid}`,
          label: display(loc.hero.defId).name,
          defId: loc.hero.defId,
        })),
        resume: { kind: 'bristle', actor: hero.controller },
      })
    }
  }
  return state
}

export function stampBonds(state: Game, teamId: string, deadUid: string): Game {
  if (!state.bonds.some((bond) => bond.teamId === teamId && bond.turn === state.turn)) return state
  const team = teamById(state, teamId)
  if (!team) return state
  let next = { ...state, bonds: state.bonds.filter((bond) => bond.teamId !== teamId) }
  for (const hero of team.team.heroes) {
    if (hero.uid !== deadUid) next = enqueue(next, hero.uid, 'Fatal Bonds', false, true, null)
  }
  return next
}

export function noteTargets(state: Game, actor: PlayerId, uids: string[], teamIds: string[]): Game {
  const teams = new Set<string>()
  for (const uid of uids) {
    const loc = findHero(state, uid)
    if (loc) teams.add(loc.team.id)
  }
  for (const teamId of teamIds) teams.add(teamId)
  let next = state
  for (const teamId of teams) {
    const found = teamById(next, teamId)
    if (!found || found.player.id === actor) continue
    const centaurs = found.team.heroes.filter((hero) => hero.defId === 'centaur_warrunner')
    if (centaurs.length === 0) continue
    const strength = found.team.heroes.reduce((sum, hero) => {
      const attrs = attrsOf(next, hero)
      const weight = heroWeight(hero)
      return attrs.includes('STR') ? sum + weight : sum
    }, 0)
    if (strength > 0) {
      next = log(next, `Retaliate: ${pname(next, actor)} discards ${strength}.`)
      next = discardRandom(next, actor, strength * centaurs.length)
    }
  }
  return next
}

export function refracts(state: Game, actor: PlayerId, uids: string[]): { state: Game; stopped: boolean } {
  for (const uid of uids) {
    const loc = findHero(state, uid)
    if (!loc?.hero.refract || loc.hero.controller === actor) continue
    state = editHero(state, uid, (hero) => ({ ...hero, refract: false }))
    return { state: log(state, 'Refraction counters the ability.'), stopped: true }
  }
  return { state, stopped: false }
}

export function silenced(state: Game): boolean {
  return !!state.silence
}

export function castable(defId: string): boolean {
  return CAST_IDS.has(defId)
}

export const TEAM_CAP = 12

export function newTeam(state: Game, id: PlayerId): [Game, string] | null {
  if (state.players[id].teams.length >= TEAM_CAP) return null
  const [next, teamId] = mint(state)
  return [addTeam(next, id, blankTeam(teamId)), teamId]
}

export function seatTeam(state: Game, id: PlayerId): [Game, string] {
  const made = newTeam(state, id)
  if (made) return made
  const existing = state.players[id].teams[0]
  if (existing) return [state, existing.id]
  const [next, teamId] = mint(state)
  return [addTeam(next, id, blankTeam(teamId)), teamId]
}

export function resolveTeam(state: Game, owner: PlayerId, teamId: string): [Game, string] | null {
  if (teamId === 'new' || teamId === `new:${owner}`) return newTeam(state, owner)
  const found = teamById(state, teamId)
  if (!found || found.player.id !== owner) return null
  return [state, teamId]
}

export function settingKinds(state: Game, id: PlayerId): Set<string> {
  const kinds = new Set<string>()
  for (const combo of state.players[id].combos) {
    for (const card of combo.cards) kinds.add(card.defId)
  }
  return kinds
}

export function topReward(state: Game, pile: 'runes' | 'neutrals' | 'towers'): Game {
  const stack = state[pile]
  const card = stack[0]
  if (!card) return log(state, 'That reward pile is empty.')
  const next = { ...state, [pile]: stack.slice(1) } as Game
  return log(addHand(next, next.active, [card]), `${pname(next, next.active)} takes ${display(card.defId).name}.`)
}

export function expireStart(state: Game): Game {
  const active = state.active
  const turn = state.turn
  const drop = (timed: Timed | null) => (timed && timed.caster === active && timed.fromTurn < turn ? null : timed)
  let next = state
  next = setPlayer(next, active, (player) => ({ ...player, bkb: drop(player.bkb) }))
  next = {
    ...next,
    silence: drop(next.silence),
    naga: drop(next.naga),
    lockPlay: drop(next.lockPlay),
  }
  next = {
    ...next,
    players: next.players.map((player) => ({
      ...player,
      teams: player.teams.map((team) => ({
        ...team,
        noEnter: drop(team.noEnter),
        noLeave: drop(team.noLeave),
        glyph: drop(team.glyph),
        heroes: team.heroes.map((hero) => ({
          ...hero,
          shield: drop(hero.shield),
          ward: drop(hero.ward),
          hidden: drop(hero.hidden),
          bkb: drop(hero.bkb),
        })),
      })),
    })),
  }
  return next
}

export function clearEnd(state: Game): Game {
  return {
    ...expireBoards(state),
    graveThisTurn: 0,
    enteredThisTurn: [],
    multicast: null,
    troll: null,
    maledict: [],
    bonds: [],
    soulbind: [],
    reveal: [],
  }
}

function expireBoards(state: Game): Game {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      noHeroNow: false,
      mailTurn: null,
      teams: player.teams.map((team) => ({
        ...team,
        heroes: team.heroes.map((hero) => ({ ...hero, dawn: null })),
      })),
    })),
  }
}

export function returnPhased(state: Game, dueTurn?: number): Game {
  const due = state.phased.filter((entry) => (dueTurn === undefined ? entry.fromTurn < state.turn : entry.fromTurn === dueTurn))
  if (due.length === 0) return state
  const dueIds = new Set(due)
  let next = { ...state, phased: state.phased.filter((entry) => !dueIds.has(entry)) }
  for (const entry of due) {
    const hero = { ...entry.hero, controller: entry.owner }
    let teamId = entry.teamId
    if (!teamById(next, teamId) || teamById(next, teamId)?.player.id !== entry.owner) {
      ;[next, teamId] = seatTeam(next, entry.owner)
    }
    const team = teamById(next, teamId)
    if (!team || enterReason(next, team.team, heroWeight(hero), hero.token)) {
      ;[next, teamId] = seatTeam(next, entry.owner)
    }
    next = putOnTeam(next, entry.owner, teamId, hero)
    next = log(next, `${display(hero.defId).name} returns from Eul's Scepter.`)
  }
  return next
}

export function returnLassos(state: Game): Game {
  const due = state.lassos.filter((entry) => entry.caster === state.active && entry.fromTurn < state.turn)
  if (due.length === 0) return state
  let next = { ...state, lassos: state.lassos.filter((entry) => !due.includes(entry)) }
  for (const entry of due) {
    const loc = findHero(next, entry.uid)
    if (!loc) continue
    let moved = next
    let teamId = ''
    ;[moved, teamId] = seatTeam(moved, entry.owner)
    const removed = removeHero(moved, entry.uid)
    if (!removed.hero) continue
    moved = putOnTeam(removed.state, entry.owner, teamId, { ...removed.hero, controller: entry.owner })
    next = log(moved, `${display(removed.hero.defId).name} slips the lasso.`)
  }
  return next
}

export function viperDue(state: Game): Game {
  const due = state.viper.filter((entry) => entry.owner === state.active && entry.fromTurn < state.turn)
  if (due.length === 0) return state
  let next = { ...state, viper: state.viper.filter((entry) => !due.includes(entry)) }
  for (const entry of due) {
    if (findHero(next, entry.uid)) next = enqueue(next, entry.uid, 'Viper Strike', false, true, null)
  }
  return next
}

export function strengthCount(state: Game, team: Team): number {
  return team.heroes.reduce((sum, hero) => {
    return attrsOf(state, hero).includes('STR') ? sum + heroWeight(hero) : sum
  }, 0)
}

export function intelCount(state: Game, team: Team): number {
  return team.heroes.reduce((sum, hero) => {
    return attrsOf(state, hero).includes('INT') ? sum + heroWeight(hero) : sum
  }, 0)
}

export function rangedCount(_state: Game, team: Team): number {
  return team.heroes.reduce((sum, hero) => {
    return rangeOf(hero) === 'Ranged' ? sum + heroWeight(hero) : sum
  }, 0)
}

export function mostRecentEnemy(state: Game, actor: PlayerId): BoardHero | null {
  let best: BoardHero | null = null
  for (const loc of allLocs(state)) {
    if (loc.hero.controller === actor) continue
    if (!best || loc.hero.enteredSeq > best.enteredSeq) best = loc.hero
  }
  return best
}

export function randomFrom<T>(state: Game, items: T[]): [Game, T | null] {
  if (items.length === 0) return [state, null]
  const [next, index] = randInt(state, items.length)
  return [next, items[index] ?? null]
}
