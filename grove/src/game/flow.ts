import {
  ANCIENT_BONUS,
  ANCIENT_ID,
  CAST_IDS,
  HERO_BY_ID,
  REWARD_BY_ID,
  SAVE_IDS,
  WARD_IDS,
  TRAP_IDS,
  display,
  firesAbility,
} from './catalog.ts'
import { scoreBodies, type ScoreBody } from './scoring.ts'
import type {
  CastResume,
  Attr,
  BoardHero,
  CardInst,
  CardKind,
  Choice,
  DiscardDue,
  Game,
  GraveMark,
  Pending,
  Player,
  PlayerId,
  Range,
  StackDestroy,
  Team,
  TeamTrap,
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

/**
 * Sabotage focus: the opponent immediately above this seat in score,
 * or the strongest rival when already tied/leading.
 */
export function preferredFoe(state: Game, actor: PlayerId): PlayerId {
  const scores = state.players.map((player) => scoreState(state, player.id).total)
  return preferredFoeFromScores(scores, actor)
}

export function preferredFoeFromScores(scores: number[], actor: PlayerId): PlayerId {
  const mine = scores[actor] ?? 0
  const others = scores
    .map((score, id) => ({ score, id }))
    .filter((entry) => entry.id !== actor)
  if (others.length === 0) return actor
  const above = others
    .filter((entry) => entry.score > mine)
    .sort((a, b) => a.score - b.score || a.id - b.id)
  if (above[0]) return above[0].id
  return others.slice().sort((a, b) => b.score - a.score || a.id - b.id)[0]!.id
}

/** 1 = first place. Ties share the best available place. */
export function standingOf(scores: number[], seat: number): number {
  const mine = scores[seat] ?? 0
  return scores.filter((score) => score > mine).length + 1
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

export const LOG_CAP = 2000

export function log(state: Game, text: string): Game {
  return { ...state, log: state.log.length >= LOG_CAP ? [...state.log.slice(1 - LOG_CAP), text] : [...state.log, text] }
}

/** "Dire's Luna" — names a board hero with its controller so log lines say whose card moved. */
export function heroTag(state: Game, uid: string | undefined, fallback?: string): string {
  const loc = uid ? findHero(state, uid) : null
  if (!loc) return fallback ?? 'a hero'
  return `${pname(state, loc.hero.controller)}'s ${display(loc.hero.defId).name}`
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
        // Medusa is a cast exile, not a team-wide attr strip.
        gaze: false,
      }))
      .filter((team) => team.heroes.length > 0 || team.mine || team.trap),
  }))
  return { ...state, players }
}

/** Body weight for capacity / scoring. Meepo is a normal 1-body hero (+1 per terrain combo is player-level). */
export function heroWeight(_hero: BoardHero): number {
  return 1
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
  if (hero.defId === 'brewmaster' || hero.defId === ANCIENT_ID) return [brewAttr(state, hero)]
  const reward = REWARD_BY_ID[hero.defId]
  if (reward?.attr) return [reward.attr]
  const base = HERO_BY_ID[hero.defId]?.attr
  if (!base) return []
  if (hero.gained && hero.gained !== base) return [base, hero.gained]
  return [base]
}

export function rangeOf(hero: BoardHero): Range | null {
  if (hero.token) return REWARD_BY_ID[hero.defId]?.range ?? null
  return HERO_BY_ID[hero.defId]?.range ?? null
}

function elderOrder(state: Game, controller: PlayerId): boolean {
  return allLocs(state).some(
    (loc) => loc.hero.defId === 'elder_titan' && loc.hero.controller !== controller,
  )
}

const BREW_ATTRS: Attr[] = ['STR', 'AGI', 'INT']
const ANCIENT_ATTRS: Attr[] = ['STR', 'AGI', 'INT', 'UNI']

function flexAttrs(hero: BoardHero): Attr[] {
  return hero.defId === ANCIENT_ID ? ANCIENT_ATTRS : BREW_ATTRS
}

function isBrewFlex(state: Game, hero: BoardHero): boolean {
  if (hero.defId !== 'brewmaster' && hero.defId !== ANCIENT_ID) return false
  if (hero.attrMode === 'none' || hero.attrMode === 'set') return false
  if (hero.bkb) return true
  const loc = findHero(state, hero.uid)
  if (loc?.team.gaze) return false
  if (elderOrder(state, hero.controller)) return false
  return true
}

/** Fixed attrs for scoring — Brewmaster is assigned explicitly so we can try each color. */
function fixedAttrsOf(state: Game, hero: BoardHero): Attr[] {
  if (!hero.bkb) {
    const loc = findHero(state, hero.uid)
    if (loc?.team.gaze) return []
    if (elderOrder(state, hero.controller)) return []
  }
  if (hero.attrMode === 'none') return []
  if (hero.attrMode === 'set') return hero.attrSet
  if (hero.defId === 'brewmaster' || hero.defId === ANCIENT_ID) return []
  const reward = REWARD_BY_ID[hero.defId]
  if (reward?.attr) return [reward.attr]
  const base = HERO_BY_ID[hero.defId]?.attr
  if (!base) return []
  if (hero.gained && hero.gained !== base) return [base, hero.gained]
  return [base]
}

function bodyFor(hero: BoardHero, attrs: Attr[]): ScoreBody {
  return {
    attrs,
    range: rangeOf(hero),
    count: heroWeight(hero),
    scoresFlat: !hero.token,
  }
}

/** Brewmaster counts as one of STR/AGI/INT — whichever maximizes this team's score. */
function brewAttr(state: Game, hero: BoardHero): Attr {
  const loc = findHero(state, hero.uid)
  if (!loc || !isBrewFlex(state, hero)) return 'STR'
  return scoreTeam(state, loc.team).brew?.[hero.uid] ?? 'STR'
}

export function bodiesOf(state: Game, team: Team): ScoreBody[] {
  const scored = scoreTeam(state, team)
  return team.heroes.map((hero) => {
    if (isBrewFlex(state, hero)) {
      const pick = scored.brew?.[hero.uid] ?? 'STR'
      return bodyFor(hero, [pick])
    }
    return bodyFor(hero, fixedAttrsOf(state, hero))
  })
}

export function scoreTeam(
  state: Game,
  team: Team,
  rules?: import('./scoring.ts').ScoreRules,
): {
  points: number
  why: string
  attack: import('./scoring.ts').AttackScore
  brew?: Record<string, Attr>
} {
  if (team.trap) {
    const scored = scoreBodies(team.heroes.map((hero) => bodyFor(hero, [])), rules)
    return { ...scored, why: `Trapped · ${scored.why}` }
  }
  const flex = team.heroes.filter((hero) => isBrewFlex(state, hero))
  if (flex.length === 0) {
    return scoreBodies(team.heroes.map((hero) => bodyFor(hero, fixedAttrsOf(state, hero))), rules)
  }

  let best: {
    points: number
    why: string
    attack: import('./scoring.ts').AttackScore
    brew: Record<string, Attr>
  } = {
    points: -1,
    why: 'Empty',
    attack: { tag: 'M', count: 0, points: 0 },
    brew: {},
  }

  const total = flex.reduce((product, hero) => product * flexAttrs(hero).length, 1)
  for (let code = 0; code < total; code += 1) {
    let cursor = code
    const brew: Record<string, Attr> = {}
    for (const hero of flex) {
      const options = flexAttrs(hero)
      brew[hero.uid] = options[cursor % options.length]!
      cursor = Math.floor(cursor / options.length)
    }
    const bodies = team.heroes.map((hero) => {
      if (brew[hero.uid]) return bodyFor(hero, [brew[hero.uid]!])
      return bodyFor(hero, fixedAttrsOf(state, hero))
    })
    const scored = scoreBodies(bodies, rules)
    if (scored.points > best.points) best = { ...scored, brew }
  }
  return best
}

export function scoreState(state: Game, id: PlayerId): { teams: number; terrains: number; total: number } {
  const player = state.players[id]
  const teams = player.teams.reduce((sum, team) => sum + scoreTeam(state, team).points, 0)
  const terrains = player.combos.reduce((sum, combo) => sum + combo.points, 0)
  const meepoBonus = controls(state, id, 'meepo') ? terrainKinds(state, id).size : 0
  const ancientBonus = controls(state, id, ANCIENT_ID) ? ANCIENT_BONUS : 0
  return { teams, terrains, total: teams + terrains + meepoBonus + ancientBonus }
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

/** Shiva's Guard: opponents of the caster cannot fire or reactivate abilities. */
export function abilitiesLocked(state: Game, id: PlayerId): boolean {
  return !!state.frost && state.frost.caster !== id
}

/** Orchid: this seat cannot activate ability effects. */
export function orchidLocked(state: Game, id: PlayerId): boolean {
  return !!state.players[id]?.orchid
}

export function itemsLocked(state: Game, id: PlayerId): boolean {
  return allLocs(state).some((loc) => {
    if (loc.hero.controller === id) return false
    if (aurasSuppressed(state, loc.hero.controller)) return false
    return loc.hero.defId === 'doom' // Venomancer is discard-or-nullify, not hard lock
  })
}

/** Troll Warlord: opponents cannot play instant cards during Troll's turn. */
export function instantsLocked(state: Game, id: PlayerId): boolean {
  return allLocs(state).some((loc) => {
    if (loc.hero.controller === id) return false
    if (aurasSuppressed(state, loc.hero.controller)) return false
    if (loc.hero.defId !== 'troll_warlord') return false
    return state.active === loc.hero.controller
  })
}

/** Axe: opponents of the caster cannot draw from the deck. */
export function drawsLocked(state: Game, id: PlayerId): boolean {
  return !!state.noDraw && state.noDraw.caster !== id
}

export function teamById(state: Game, teamId: string): { team: Team; player: Player } | null {
  for (const player of state.players) {
    const team = player.teams.find((entry) => entry.id === teamId)
    if (team) return { team, player }
  }
  return null
}

export function blankTeam(id: string): Team {
  return { id, heroes: [], gaze: false, noEnter: null, noLeave: null, glyph: null, blade: null, mine: null, trap: null, guard: null }
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
    token: card.kind === 'neutral' || card.kind === 'ancient',
    roshan: card.defId === 'roshan',
    rupture: false,
    omni: false,
    abaddon: card.defId === 'abaddon',
    shield: null,
    ward: null,
    hidden: null,
    bkb: null,
    tether: null,
    muted: false,
    dawn: null,
    wk: card.defId === 'wraith_king',
    refract: false,
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
  if (hero.hidden) return false
  // Omniknight: allies in this team are immune.
  if (
    hero.controller !== actor &&
    loc.team.heroes.some((mate) => mate.defId === 'omniknight' && mate.controller === hero.controller) &&
    !aurasSuppressed(state, hero.controller)
  ) {
    return false
  }
  // Mars Bulwark: other allies on his team are untargetable; Mars himself stays targetable.
  // Unlike Omniknight, the team as a whole can still be targeted (see canTargetTeam).
  if (
    source === 'ability' &&
    hero.defId !== 'mars' &&
    loc.team.heroes.some(
      (mate) => mate.defId === 'mars' && mate.controller === hero.controller && mate.uid !== hero.uid,
    ) &&
    !aurasSuppressed(state, hero.controller)
  ) {
    return false
  }
  return true
}

/**
 * "Immune to all effects" (Black King Bar / Glyph team, Enrage, Wheel of Wonder, Shield Rune,
 * Guardian Angel): no opponent effect can destroy, exile, bounce, tuck, move, steal or silence it.
 * `by === null` is an unowned effect and is blocked too; the controller's own effects still work.
 */
export function immuneFrom(state: Game, uid: string, by: PlayerId | null): boolean {
  const loc = findHero(state, uid)
  if (!loc) return false
  if (by !== null && by === loc.hero.controller) return false
  if (loc.hero.bkb || loc.player.bkb || loc.hero.shield || loc.team.glyph) return true
  return (
    loc.team.heroes.some((mate) => mate.defId === 'omniknight' && mate.controller === loc.hero.controller) &&
    !aurasSuppressed(state, loc.hero.controller)
  )
}

export function immuneNote(state: Game, uid: string): string {
  const loc = findHero(state, uid)
  return `${loc ? display(loc.hero.defId).name : 'The hero'} is immune.`
}

export function canTargetTeam(_state: Game, _actor: PlayerId, team: Team, _owner: PlayerId, source: SourceKind): boolean {
  if (team.glyph && source !== 'ability') return false
  if (team.glyph) return false
  // Mars does not block team-wide targeting — only single-hero targeting of his allies.
  return true
}

export function comboLocked(state: Game, comboId: string): boolean {
  for (const player of state.players) {
    const combo = player.combos.find((entry) => entry.id === comboId)
    if (!combo) continue
    if (combo.protectedBy && findHero(state, combo.protectedBy)) return true
    // Treant Protector: your terrain combos cannot be stolen or destroyed.
    if (controls(state, player.id, 'treant_protector') && !aurasSuppressed(state, player.id)) return true
  }
  return false
}

/** Viper: enemy auras are nullified while you control Viper. */
export function aurasSuppressed(state: Game, controller: PlayerId): boolean {
  return allLocs(state).some(
    (loc) => loc.hero.defId === 'viper' && loc.hero.controller !== controller,
  )
}

export function ask(state: Game, pending: Pending): Game {
  if (pending.mode === 'pick' && pending.min > 0 && pending.choices.length === 0) {
    return log(state, 'There is no legal choice.')
  }
  return { ...state, pending: withPromptAbout(pending) }
}

/** Attach ability/item context from the resume so the Prompt UI can explain the ask. */
function withPromptAbout(pending: Pending): Pending {
  if (pending.about) return pending
  const defId = promptSourceDefId(pending.resume)
  if (!defId) return pending
  const info = display(defId)
  const about = {
    defId,
    name: info.name,
    spell: info.spell,
    text: info.text,
    kind: info.kind,
  }
  const label = about.spell ?? about.name
  const alreadyNamed =
    pending.prompt.toLowerCase().includes(about.name.toLowerCase())
    || (about.spell ? pending.prompt.toLowerCase().includes(about.spell.toLowerCase()) : false)
  return {
    ...pending,
    about,
    prompt: alreadyNamed ? pending.prompt : `${label}: ${pending.prompt}`,
  }
}

function promptSourceDefId(resume: Pending['resume']): string | null {
  if (resume.kind === 'cast') return resume.defId
  if ('cast' in resume && resume.cast) return resume.cast.defId
  if ('card' in resume && resume.card) return resume.card.defId
  if ('trap' in resume && resume.trap) return resume.trap.defId
  return null
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
  sourceUid: string | null = null,
): Game {
  const item: StackDestroy = { uid, cause, force, window, by, sourceUid }
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
    (loc) =>
      loc.hero.defId === 'ancient_apparition' &&
      loc.hero.controller !== controller &&
      !aurasSuppressed(state, loc.hero.controller),
  )
}

function iceBlastAny(state: Game): boolean {
  return allLocs(state).some(
    (loc) => loc.hero.defId === 'ancient_apparition' && !aurasSuppressed(state, loc.hero.controller),
  )
}

export function toExile(state: Game, card: CardInst, note: string | null = `${display(card.defId).name} is exiled.`): Game {
  if ((card.defId === ANCIENT_ID || card.kind === 'ancient') && !state.ancient) {
    return revealAncient(state, 'exile', null, card)
  }
  const next = { ...state, exile: [...state.exile, card] }
  return note ? log(next, note) : next
}

export function toGrave(state: Game, card: CardInst, origin: GraveMark['origin']): Game {
  if (card.defId === ANCIENT_ID || card.kind === 'ancient') {
    if (state.ancient) return toExile(state, card)
    return revealAncient(state, 'grave', null, card)
  }
  if (card.kind === 'rune' || card.kind === 'neutral' || card.kind === 'tower') return toExile(state, card)
  const owner = origin.type === 'board' ? origin.hero.controller : origin.type === 'hand' ? origin.player : null
  // Ancient Apparition: cards that would enter the grave are exiled instead.
  if (owner !== null && iceBlast(state, owner)) {
    return toExile(state, card)
  }
  if (owner === null && iceBlastAny(state)) {
    return toExile(state, card)
  }
  let next: Game = {
    ...state,
    grave: [...state.grave, card],
    graveThisTurn: state.graveThisTurn + 1,
    lastGrave: { card, turn: state.turn, origin },
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

/** Owe a discard of `n` chosen by that player; resolved by settle once the current effect finishes. */
export function queueDiscard(state: Game, player: PlayerId, n: number, cause: string): Game {
  if (n <= 0) return state
  return { ...state, discardsDue: [...(state.discardsDue ?? []), { player, n, cause }] }
}

export function beginDiscard(state: Game, due: DiscardDue): Game {
  const hand = state.players[due.player]?.hand ?? []
  if (hand.length === 0) return log(state, `${due.cause}: ${pname(state, due.player)} has no cards to discard.`)
  if (hand.length <= due.n) {
    let next = state
    for (const card of [...hand]) next = discardUid(next, due.player, card.uid)
    return log(next, `${due.cause}: ${pname(state, due.player)} discards their hand (${hand.length}).`)
  }
  return ask(state, {
    actor: due.player,
    prompt: `${due.cause}: discard ${due.n} card${due.n === 1 ? '' : 's'}.`,
    mode: 'pick',
    min: due.n,
    max: due.n,
    choices: hand.map((card) => ({ id: `card:${card.uid}`, label: display(card.defId).name, defId: card.defId })),
    resume: { kind: 'discard', player: due.player, n: due.n, cause: due.cause },
  })
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

export function takeDraw(state: Game, id: PlayerId, count: number, how: 'turn' | 'action' | null = null): Game {
  const cards = state.deck.slice(0, count)
  if (cards.length === 0) return log(state, `${pname(state, id)} cannot draw. The deck is empty.`)
  const ancient = cards.find((card) => card.defId === ANCIENT_ID || card.kind === 'ancient')
  const kept = ancient ? cards.filter((card) => card.uid !== ancient.uid) : cards
  let next = addHand({ ...state, deck: state.deck.slice(cards.length) }, id, kept)
  const why = how === 'turn' ? ' for the turn' : how === 'action' ? ' as an action' : ''
  next = log(next, `${pname(next, id)} draws ${cards.length}${why} (${next.players[id].hand.length} in hand).`)
  if (ancient) next = revealAncient(next, 'draw', id, ancient)
  return next
}

/** Strip The Ancient from every zone and start the final round. A drawer places it on the board for free. */
export function revealAncient(
  state: Game,
  source: 'draw' | 'grave' | 'exile',
  actor: PlayerId | null,
  card?: CardInst,
): Game {
  if (!state.ancientEnabled) {
    // Without endgame, treat a stray Ancient as an inert exile trophy.
    if (!card) return state
    return log(
      { ...state, exile: [...state.exile.filter((entry) => entry.uid !== card.uid), card] },
      `${display(card.defId).name} is set aside (Ancient endgame off).`,
    )
  }
  if (state.ancient) return state
  let next = stripAncientZones(state, card?.uid)
  next = { ...next, ancient: { bonusSeat: null, endsLeft: next.players.length } }
  if (source !== 'draw' || actor === null || !card) {
    return log(next, `The Ancient is revealed from the ${source}! It is only a marker. Final round — each player gets one more turn.`)
  }
  next = log(next, `${pname(next, actor)} draws The Ancient! Final round — this turn, then one more turn for each opponent.`)
  return askAncientPlace({ ...next, limbo: [...next.limbo, card] }, actor, card)
}

function askAncientPlace(state: Game, actor: PlayerId, card: CardInst): Game {
  const options: Choice[] = state.players[actor].teams
    .filter((team) => team.heroes.length > 0 && !enterReason(state, team, 1, true))
    .map((team) => ({ id: `team:${team.id}`, label: `${scoreTeam(state, team).why} · ${scoreTeam(state, team).points}` }))
  if (state.players[actor].teams.length < TEAM_CAP) options.push({ id: 'new', label: 'New team' })
  if (options.length === 0) {
    return log({ ...state, limbo: state.limbo.filter((entry) => entry.uid !== card.uid), exile: [...state.exile, card] }, 'The Ancient finds no room and is set aside.')
  }
  return ask(state, {
    actor,
    prompt: `Place The Ancient (+${ANCIENT_BONUS} to whoever controls it at the end) on a team you control.`,
    mode: 'pick',
    min: 1,
    max: 1,
    choices: options,
    resume: { kind: 'ancient-place', actor, card },
  })
}

export function seatAncient(state: Game, actor: PlayerId, card: CardInst, choice: string): Game {
  let next: Game = { ...state, limbo: state.limbo.filter((entry) => entry.uid !== card.uid) }
  let teamId = choice.startsWith('team:') ? choice.slice(5) : ''
  const dest = teamId ? teamById(next, teamId) : null
  if (!dest || dest.player.id !== actor || enterReason(next, dest.team, 1, true)) {
    const made = newTeam(next, actor)
    if (!made) return log({ ...next, exile: [...next.exile, card] }, 'The Ancient finds no room and is set aside.')
    ;[next, teamId] = made
  }
  next = putOnTeam(next, actor, teamId, makeHero(card, actor, actor, next))
  next = arrived(next, card.uid).state
  return log(next, `${pname(next, actor)} sets The Ancient on the board.`)
}

function stripAncientZones(state: Game, uid?: string): Game {
  const isAncient = (card: CardInst) =>
    card.defId === ANCIENT_ID || card.kind === 'ancient' || (uid !== undefined && card.uid === uid)
  return {
    ...state,
    deck: state.deck.filter((card) => !isAncient(card)),
    grave: state.grave.filter((card) => !isAncient(card)),
    exile: state.exile.filter((card) => !isAncient(card)),
    limbo: state.limbo.filter((card) => !isAncient(card)),
    players: state.players.map((player) => ({
      ...player,
      hand: player.hand.filter((card) => !isAncient(card)),
    })),
  }
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
    .map((loc) => {
      const info = display(loc.hero.defId)
      const body = HERO_BY_ID[loc.hero.defId]
      const tags = [body?.attr, body?.range].filter(Boolean).join(' · ')
      return {
        id: `hero:${loc.hero.uid}`,
        label: info.name,
        hint: [pname(state, loc.hero.controller), tags || null, scoreTeam(state, loc.team).why]
          .filter(Boolean)
          .join(' · '),
        defId: loc.hero.defId,
      }
    })
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
      const letter = String.fromCharCode(65 + (player.teams.indexOf(team) % 26))
      const roster = team.heroes
        .slice(0, 3)
        .map((hero) => display(hero.defId).name)
        .join(', ')
      const more = team.heroes.length > 3 ? ` +${team.heroes.length - 3}` : ''
      choices.push({
        id: `team:${team.id}`,
        label: `${pname(state, player.id)}'s Team ${letter}`,
        hint: [roster ? `${roster}${more}` : 'empty', scored.why, String(scored.points)]
          .filter(Boolean)
          .join(' · '),
        defId: team.heroes[0]?.defId,
      })
    }
  }
  return choices
}

export function enterReason(state: Game, team: Team, weight: number, token: boolean): string | null {
  if (team.noEnter) return 'Heroes cannot enter that team.'
  if (team.heroes.some((hero) => hero.defId === 'omniknight') && !aurasSuppressed(state, team.heroes[0]?.controller ?? -1)) {
    return 'Guardian Angel seals this team.'
  }
  // Puck: enemy heroes cannot enter teams (new teams still form via newTeam).
  if (team.heroes.length > 0) {
    const owner = team.heroes[0]!.controller
    if (
      allLocs(state).some((loc) => loc.hero.defId === 'puck' && loc.hero.controller !== owner && !aurasSuppressed(state, loc.hero.controller))
    ) {
      return 'Dream Coil stops heroes from entering teams.'
    }
  }
  if (teamSize(team) + weight > 5) return 'That team would hold more than 5 heroes.'
  if (token && team.heroes.some((hero) => hero.token)) return 'That team already has a neutral.'
  return null
}

export function putOnTeam(state: Game, playerId: PlayerId, teamId: string, hero: BoardHero): Game {
  // A freshly seated team is empty, and strip() drops empty teams on the next edit — recreate it.
  if (!teamById(state, teamId)) state = addTeam(state, playerId, blankTeam(teamId))
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
  if (current.team.trap) state = fireTeamTrap(state, current.team.id, uid)
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
  state = editHero(state, hero.uid, (current) => ({
    ...current,
    held: null,
    gained: null,
    attrMode: current.attrMode === 'set' ? 'base' : current.attrMode,
    attrSet: [],
  }))
  // Shadow Demon: return exiled hero to the caster's hand (held.owner is the SD controller).
  if (hero.defId === 'shadow_demon') {
    const next = addHand(state, held.owner, [held.card])
    return log(next, `${display(held.card.defId).name} returns to ${pname(state, held.owner)}'s hand.`)
  }
  // Razor / Morphling: reseat the held hero under its original owner.
  let cardState = state
  const owner = held.owner
  const made = makeHero(held.card, owner, owner, cardState)
  let teamId = ''
  ;[cardState, teamId] = seatTeam(cardState, owner)
  cardState = putOnTeam(cardState, owner, teamId, made)
  const landed = arrived(cardState, made.uid)
  return log(landed.state, `${display(held.card.defId).name} returns to ${pname(state, owner)}.`)
}

export function extract(state: Game, uid: string): { state: Game; hero: BoardHero | null } {
  const loc = findHero(state, uid)
  if (!loc) return { state, hero: null }
  return { state: editHero(state, uid, () => null), hero: loc.hero }
}

/** When an Infest host leaves the board, seat Lifestealer on that team in its place. */
export function returnInfest(state: Game, hostUid: string, teamId: string): Game {
  const hits = state.infests.filter((entry) => entry.hostUid === hostUid)
  if (hits.length === 0) return state
  state = {
    ...state,
    infests: state.infests.filter((entry) => entry.hostUid !== hostUid),
    exile: state.exile.filter((card) => !hits.some((entry) => entry.ls.uid === card.uid)),
  }
  for (const infest of hits) {
    const made = makeHero(infest.ls, infest.owner, infest.owner, state)
    // strip() may have dropped the host's empty team — rebuild that seat so LS returns in place.
    if (!teamById(state, teamId)) state = addTeam(state, infest.owner, blankTeam(teamId))
    const seat = teamById(state, teamId)
    if (seat && seat.player.id === infest.owner && !enterReason(state, seat.team, 1, false)) {
      state = putOnTeam(state, infest.owner, teamId, made)
      state = arrived(state, made.uid).state
      state = log(state, "Infest: Lifestealer returns in its host's place.")
    } else {
      const [seated, seatId] = seatTeam(state, infest.owner)
      state = putOnTeam(seated, infest.owner, seatId, made)
      state = arrived(state, made.uid).state
      state = log(state, 'Infest: Lifestealer returns to a new team.')
    }
  }
  return state
}

export function removeHero(state: Game, uid: string): { state: Game; hero: BoardHero | null } {
  const loc = findHero(state, uid)
  if (!loc) return { state, hero: null }
  const teamId = loc.team.id
  state = releaseHeld(state, loc.hero)
  // Necrophos leaves: lift Reaper's Scythe attribute ban.
  if (state.attrBan?.sourceUid === uid) {
    const attr = state.attrBan.attr
    state = { ...state, attrBan: null }
    state = log(state, `Reaper's Scythe ends — ${attr} heroes are playable again.`)
  }
  // Medusa leaves: restore gazed teams.
  if (loc.hero.defId === 'medusa') {
    const holds = state.medusaHold.filter((entry) => entry.medusaUid === uid)
    state = { ...state, medusaHold: state.medusaHold.filter((entry) => entry.medusaUid !== uid) }
    for (const hold of holds) {
      let [next, gazeTeam] = seatTeam(state, hold.owner)
      state = next
      for (const card of hold.cards) {
        state = {
          ...state,
          exile: state.exile.filter((entry) => entry.uid !== card.uid),
        }
        const made = makeHero(card, hold.owner, hold.owner, state)
        state = putOnTeam(state, hold.owner, gazeTeam, made)
        state = arrived(state, made.uid).state
      }
      state = log(state, 'Stone Gaze ends — the team returns.')
    }
  }
  const fresh = findHero(state, uid)
  state = editHero(state, uid, () => null)
  state = returnInfest(state, uid, teamId)
  return { state, hero: fresh?.hero ?? loc.hero }
}

export function bounce(state: Game, uid: string, cause: string, ignoreRupture = false, by: PlayerId | null = null): Game {
  const loc = findHero(state, uid)
  if (!loc) return state
  if (!ignoreRupture && immuneFrom(state, uid, by)) return log(state, `${display(loc.hero.defId).name} is immune and stays.`)
  if (loc.team.noLeave) return log(state, `Dream Coil holds ${display(loc.hero.defId).name} in place.`)
  // Puck aura: cannot leave teams.
  if (
    allLocs(state).some(
      (other) =>
        other.hero.defId === 'puck' &&
        other.hero.controller !== loc.hero.controller &&
        !aurasSuppressed(state, other.hero.controller),
    )
  ) {
    return log(state, `Dream Coil holds ${display(loc.hero.defId).name} in place.`)
  }
  // Bloodseeker Instant: enemy leaving → destroy until caster's next turn.
  if (
    !ignoreRupture &&
    state.rupture &&
    state.rupture.caster !== loc.hero.controller
  ) {
    return enqueue(state, uid, 'Rupture', false, true, state.rupture.caster)
  }
  if (loc.hero.rupture && !ignoreRupture) return enqueue(state, uid, 'Rupture', false, true, null)
  const owner = loc.hero.owner
  const removed = removeHero(state, uid)
  if (!removed.hero) return state
  const card: CardInst = {
    uid: removed.hero.uid,
    defId: removed.hero.defId,
    kind: removed.hero.token ? 'neutral' : 'hero',
  }
  // Phantom Assassin: enemy heroes that would return to hand are exiled instead.
  if (
    allLocs(removed.state).some(
      (other) =>
        other.hero.defId === 'phantom_assassin' &&
        other.hero.controller !== owner &&
        !aurasSuppressed(removed.state, other.hero.controller),
    )
  ) {
    return log(toExile(removed.state, card), `Coup de Grace exiles ${display(card.defId).name}.`)
  }
  return afterBoardToHand(
    log(
      addHand(removed.state, owner, [card]),
      `${cause}: ${display(card.defId).name} returns to ${pname(state, owner)}'s hand.`,
    ),
  )
}

/** Legacy hook kept for callers; PA now exiles in bounce. */
export function afterBoardToHand(state: Game): Game {
  return state
}

function askCoup(state: Game, rest: PlayerId[]): Game {
  if (rest.length === 0) return state
  const [actor, ...more] = rest
  if (actor === undefined) return state
  const enemies = allLocs(state).filter(
    (loc) => loc.hero.controller !== actor && canTargetHero(state, actor, loc.hero, 'ability'),
  )
  if (enemies.length === 0) return askCoup(state, more)
  return ask(state, {
    actor,
    prompt: 'Coup de Grace: destroy an enemy hero.',
    mode: 'pick',
    min: 1,
    max: 1,
    choices: enemies.map((loc) => ({
      id: `hero:${loc.hero.uid}`,
      label: display(loc.hero.defId).name,
      defId: loc.hero.defId,
    })),
    resume: { kind: 'pa', rest: more },
  })
}

export function askCoupContinue(state: Game, rest: PlayerId[]): Game {
  return askCoup(state, rest)
}

export function drawItemFromDeck(state: Game, player: PlayerId): Game {
  const found = state.deck.findIndex((card) => card.kind === 'item')
  if (found < 0) return log(state, 'No item left in the deck.')
  const item = state.deck[found]
  if (!item) return state
  const next: Game = {
    ...state,
    deck: [...state.deck.slice(0, found), ...state.deck.slice(found + 1)],
  }
  return log(addHand(next, player, [item]), `Moon Glaives draws ${display(item.defId).name}.`)
}

function prevented(state: Game, loc: Loc, force: boolean, by: PlayerId | null): string | null {
  if (force || (state.troll && by !== null && state.troll.player === by && state.troll.turn === state.turn)) {
    return null
  }
  const name = display(loc.hero.defId).name
  if (state.naga) return `${name} cannot be destroyed.`
  if (loc.hero.bkb || loc.player.bkb) return `${name} is protected by Black King Bar.`
  if (loc.team.glyph) return `Glyph protects ${name}.`
  if (loc.team.guard) return `Refraction protects ${name}.`
  if (loc.hero.shield) return `Shield protects ${name}.`
  if (loc.hero.ward) return `${name} cannot be destroyed.`
  if (loc.hero.tether === state.turn) return `Tether keeps ${name} safe this turn.`
  if (
    loc.team.heroes.some((mate) => mate.defId === 'omniknight' && mate.controller === loc.hero.controller) &&
    !aurasSuppressed(state, loc.hero.controller)
  ) {
    return `Guardian Angel protects ${name}.`
  }
  return null
}

export function performDestroy(state: Game, item: StackDestroy): Game {
  if (state.destroyDepth > 10) return log(state, 'The chain of destruction ends.')
  state = { ...state, destroyDepth: state.destroyDepth + 1 }
  const loc = findHero(state, item.uid)
  if (!loc) return state
  const name = display(loc.hero.defId).name
  if (immuneFrom(state, item.uid, item.by)) return log(state, `${name} is immune.`)
  const early = prevented(state, loc, item.force, item.by)
  if (early) return log(state, early)
  // Dark Seer: take control instead of destroy this turn (ownership switches to Seer).
  if (
    state.darkSeer &&
    state.darkSeer.turn === state.turn &&
    loc.hero.controller !== state.darkSeer.actor &&
    !item.force
  ) {
    const thief = state.darkSeer.actor
    const seer = allLocs(state).find((entry) => entry.hero.defId === 'dark_seer' && entry.hero.controller === thief)
    let next = state
    let teamId = ''
    if (seer && !enterReason(state, seer.team, heroWeight(loc.hero), loc.hero.token)) {
      teamId = seer.team.id
    } else {
      const seated = seatTeam(state, thief)
      next = seated[0]
      teamId = seated[1]
    }
    const moved = removeHero(next, loc.hero.uid)
    if (!moved.hero) return state
    next = putOnTeam(moved.state, thief, teamId, {
      ...moved.hero,
      controller: thief,
      owner: thief,
      rupture: false,
    })
    return log(arrived(next, moved.hero.uid).state, `Vacuum: ${name} joins ${pname(next, thief)}.`)
  }
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
  // Abaddon aura: allies on his team return to top of deck instead of destroy.
  if (
    !forced &&
    loc.team.heroes.some((hero) => hero.defId === 'abaddon' && hero.controller === loc.hero.controller) &&
    !aurasSuppressed(state, loc.hero.controller)
  ) {
    const removed = removeHero(state, loc.hero.uid)
    if (!removed.hero) return state
    const card: CardInst = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' }
    return log({ ...removed.state, deck: [card, ...removed.state.deck] }, `${item.cause} hits ${pname(state, loc.hero.controller)}'s ${name} — Borrowed Time puts it on top of the deck instead.`)
  }
  if (!forced && !loc.hero.roshan) {
    const roshan = loc.team.heroes.find((hero) => hero.roshan && hero.uid !== loc.hero.uid)
    if (roshan) {
      state = log(state, `Roshan is destroyed instead of ${name}.`)
      return enqueue(state, roshan.uid, 'Roshan', false, item.window, item.by)
    }
  }
  if (!forced && loc.hero.dawn && loc.hero.dawn.turn === state.turn) {
    // Bounce to the hero's owner (not the Dawnbreaker caster) so PA / owner-hand rules apply.
    return bounce(state, loc.hero.uid, 'Solar Guardian', true)
  }
  if (!forced && loc.hero.defId === 'phantom_lancer') {
    return bounce(state, loc.hero.uid, 'Juxtapose', true)
  }
  if (!forced && loc.hero.wk) {
    const removed = removeHero(state, loc.hero.uid)
    if (!removed.hero) return state
    const body = { ...removed.hero, wk: false }
    return log(
      {
        ...removed.state,
        phased: [
          ...removed.state.phased,
          { hero: body, teamId: loc.team.id, owner: loc.hero.owner, fromTurn: state.turn },
        ],
      },
      'Reincarnation: Wraith King is exiled and returns next turn.',
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
  // Death Prophet: heroes/neutrals you control exile instead of dying.
  // Pulse keeps the aura for the rest of this destroy cascade if DP dies mid-queue.
  const hasDpNow =
    !aurasSuppressed(state, snapshot.controller) &&
    (snapshot.defId === 'death_prophet' ||
      allLocs(state).some(
        (other) => other.hero.defId === 'death_prophet' && other.hero.controller === snapshot.controller,
      ) ||
      state.queue.some((queued) => {
        const other = findHero(state, queued.uid)
        return !!other && other.hero.defId === 'death_prophet' && other.hero.controller === snapshot.controller
      }))
  if (hasDpNow && !state.exorcismPulse.includes(snapshot.controller)) {
    state = { ...state, exorcismPulse: [...state.exorcismPulse, snapshot.controller] }
  }
  const exorcismExile = state.exorcismPulse.includes(snapshot.controller) || hasDpNow
  const removed = removeHero(state, snapshot.uid)
  state = removed.state
  if (!removed.hero) return state
  const card: CardInst = {
    uid: removed.hero.uid,
    defId: removed.hero.defId,
    kind: removed.hero.token ? 'neutral' : 'hero',
  }
  if (removed.hero.token || exorcismExile) state = toExile(state, card, null)
  else state = toGrave(state, card, { type: 'board', hero: snapshot, teamId })
  const tag = `${pname(state, snapshot.controller)}'s ${name}`
  state = log(
    state,
    exorcismExile && !removed.hero.token
      ? `${item.cause} kills ${tag} — Exorcism exiles it.`
      : `${item.cause} destroys ${tag}.`,
  )
  if (snapshot.defId === 'tormentor' && item.sourceUid && findHero(state, item.sourceUid)) {
    state = enqueue(state, item.sourceUid, 'Tormentor', false, true, snapshot.controller)
  }
  state = onDestroyed(state, snapshot, teamId, item.by)
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

function onDestroyed(state: Game, hero: BoardHero, teamId: string, by: PlayerId | null): Game {
  for (const loc of allLocs(state)) {
    if (
      loc.hero.defId === 'shadow_fiend' &&
      loc.hero.controller !== hero.controller &&
      !aurasSuppressed(state, loc.hero.controller)
    ) {
      state = queueDraw(state, loc.hero.controller, 1)
    }
  }
  for (const bond of state.soulbind) {
    if (bond.a !== hero.uid && bond.b !== hero.uid) continue
    const other = bond.a === hero.uid ? bond.b : bond.a
    if (findHero(state, other)) state = enqueue(state, other, 'Soulbind', false, true, null)
  }
  // Warlock: if an enemy hero is destroyed, destroy another hero on the bonded team.
  for (const bond of [...state.bonds]) {
    if (hero.controller === bond.caster) continue
    state = stampBonds(state, bond.teamId, hero.uid)
  }
  // Tormentor revenge is handled in performDestroy via sourceUid (passed through onDestroyed).
  // Infest return runs inside removeHero whenever the host leaves the board.
  void by
  if (hero.defId === 'bristleback' && !aurasSuppressed(state, hero.controller)) {
    const enemies = allLocs(state).filter((loc) => loc.hero.controller !== hero.controller)
    if (enemies.length > 0) {
      return ask(state, {
        actor: hero.controller,
        prompt: 'Bristleback: destroy a target enemy hero.',
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
  if (!state.bonds.some((bond) => bond.teamId === teamId)) return state
  const team = teamById(state, teamId)
  if (!team) return state
  const other = team.team.heroes.find((hero) => hero.uid !== deadUid)
  if (!other) return state
  return enqueue(state, other.uid, 'Fatal Bonds', false, true, null)
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
    if (!found) continue
    if (found.player.id === actor) continue
    const centaurs = found.team.heroes.filter((hero) => hero.defId === 'centaur_warrunner')
    if (centaurs.length === 0) continue
    const strength = found.team.heroes.reduce((sum, hero) => {
      const attrs = attrsOf(next, hero)
      const weight = heroWeight(hero)
      return attrs.includes('STR') ? sum + weight : sum
    }, 0)
    if (strength > 0) {
      next = queueDiscard(next, actor, strength * centaurs.length, 'Retaliate')
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

/** Global Silence, unless this board hero is immune to its caster. */
export function silenced(state: Game, uid?: string): boolean {
  if (!state.silence) return false
  return !uid || !immuneFrom(state, uid, state.silence.caster)
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

/** Terrain cards of one kind across every set the seat controls. */
export function terrainCount(state: Game, id: PlayerId, kind: string): number {
  return state.players[id].combos.reduce(
    (sum, combo) => sum + combo.cards.filter((card) => card.defId === kind).length,
    0,
  )
}

export function terrainKinds(state: Game, id: PlayerId): Set<string> {
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
    frost: drop(next.frost),
    noDraw: drop(next.noDraw),
    primalItems: drop(next.primalItems),
    rupture: drop(next.rupture),
    taxAction: drop(next.taxAction),
    bonds: next.bonds.filter((bond) => !(bond.caster === active && bond.fromTurn < turn)),
  }
  next = {
    ...next,
    players: next.players.map((player) => ({
      ...player,
      // Orchid expires on the caster's next turn start.
      orchid: drop(player.orchid),
      teams: player.teams.map((team) => ({
        ...team,
        noEnter: drop(team.noEnter),
        noLeave: drop(team.noLeave),
        glyph: drop(team.glyph),
        guard: drop(team.guard),
        blade: drop(team.blade),
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
    soulbind: [],
    reveal: [],
    spellNullify: [],
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
        heroes: team.heroes.map((hero) => ({ ...hero, dawn: null, tether: null })),
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
    next = log(next, `${pname(next, entry.owner)}'s ${display(hero.defId).name} returns from Eul's Scepter.`)
  }
  return next
}

export function returnLassos(state: Game): Game {
  // Satanic / temporary control lasts until end of the caster's turn — return as soon as the turn counter advances.
  const due = state.lassos.filter((entry) => entry.fromTurn < state.turn)
  if (due.length === 0) return state
  let next = { ...state, lassos: state.lassos.filter((entry) => !due.includes(entry)) }
  for (const entry of due) {
    const loc = findHero(next, entry.uid)
    if (!loc) continue
    let moved = next
    let teamId = entry.teamId
    const home = teamById(moved, teamId)
    if (!home || home.player.id !== entry.owner || enterReason(moved, home.team, heroWeight(loc.hero), loc.hero.token)) {
      ;[moved, teamId] = seatTeam(moved, entry.owner)
    }
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


/** +1 when a trap lands where it helps `actor` (wards at home, snares on rivals), −1 otherwise. */
export function trapAim(state: Game, actor: PlayerId, defId: string, teamId: string): number {
  const found = teamById(state, teamId)
  if (!found) return -1
  const home = found.player.id === actor
  return WARD_IDS.has(defId) === home ? 1 : -1
}

export function isTrapHero(defId: string): boolean {
  return TRAP_IDS.has(defId)
}

/**
 * True when trap text specifies the trap hero is destroyed on reveal (Sacrifice / Destroy this card).
 * Otherwise the revealed hero joins that team as a normal body.
 */
export function trapSacrifices(defId: string): boolean {
  const text = HERO_BY_ID[defId]?.text ?? ''
  const name = HERO_BY_ID[defId]?.name ?? ''
  if (/Sacrifice /i.test(text)) return true
  if (name && new RegExp(`Destroy ${name}\\b`, 'i').test(text)) return true
  if (/\b(this card|this hero) is destroyed\b/i.test(text)) return true
  return false
}

export function plantTrap(state: Game, actor: PlayerId, card: CardInst, teamId: string): Game {
  const found = teamById(state, teamId)
  if (!found) return log(state, 'That team is gone.')
  if (found.team.trap || found.team.mine) return log(state, 'That team already has a trap.')
  const closed = trapBlock(state, found.team)
  if (closed) return log(state, closed)
  if (!isTrapHero(card.defId)) return state
  const trap: TeamTrap = { uid: card.uid, defId: card.defId, owner: actor }
  let next = removeHand(state, actor, card.uid)
  next = updateTeam(next, teamId, (team) => ({ ...team, trap }))
  // Keep the trap identity secret until it reveals — lab/debug UI may still show it.
  return log(next, `${pname(next, actor)} sets a trap face down.`)
}

export function clearAllTraps(state: Game, cause = "Thundergod's Wrath"): Game {
  let next = state
  for (const player of state.players) {
    for (const team of player.teams) {
      if (!team.trap) continue
      const trap = team.trap
      const card: CardInst = { uid: trap.uid, defId: trap.defId, kind: 'hero' }
      next = updateTeam(next, team.id, (entry) => ({ ...entry, trap: null }))
      next = toGrave(log(next, `${cause} removes ${display(trap.defId).name}.`), card, { type: 'deck' })
    }
  }
  return log(next, `${cause}: all traps are removed.`)
}

/** Why a trap cannot be planted on this team (5 heroes, or the team cannot take another hero). */
export function trapBlock(state: Game, team: Team): string | null {
  if (team.heroes.length === 0) return 'Traps go on a team with heroes.'
  const reason = enterReason(state, team, 1, false)
  return reason ? `No trap there — ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : null
}

/** After reveal: sacrifices go to the grave; anything else joins the team if there is room, else the grave. */
function settleRevealedTrap(state: Game, teamId: string, trap: TeamTrap, card: CardInst): Game {
  if (trapSacrifices(trap.defId)) return toGrave(state, card, { type: 'deck' })
  const found = teamById(state, teamId)
  const name = display(card.defId).name
  if (!found) return log(toGrave(state, card, { type: 'deck' }), `${name} goes to the grave — that team is gone.`)
  const hero = makeHero(card, found.player.id, found.player.id, state)
  if (enterReason(state, found.team, heroWeight(hero), false)) {
    return log(toGrave(state, card, { type: 'deck' }), `${name} has no room and goes to the grave.`)
  }
  const next = putOnTeam(state, found.player.id, teamId, hero)
  return log(touchEnter(next, hero.uid), `${name} joins the team.`)
}

/** Reveal the face-down trap on a team because `enteringUid` was just added to it. */
export function fireTeamTrap(state: Game, teamId: string, enteringUid: string): Game {
  const found = teamById(state, teamId)
  if (!found?.team.trap) return state
  const trap = found.team.trap
  const controller = found.player.id
  const card: CardInst = { uid: trap.uid, defId: trap.defId, kind: 'hero' }
  const name = display(trap.defId).name
  state = updateTeam(state, teamId, (team) => ({ ...team, trap: null }))
  state = log(state, `${pname(state, controller)}'s team reveals ${name}!`)
  const stamp: Timed = { caster: controller, fromTurn: state.turn }

  switch (trap.defId) {
    case 'techies': {
      state = settleRevealedTrap(state, teamId, trap, card)
      for (const hero of [...(teamById(state, teamId)?.team.heroes ?? [])]) {
        state = enqueue(state, hero.uid, 'Proximity Mines', false, true, null)
      }
      return log(state, 'Proximity Mines sacrifice the team.')
    }
    case 'broodmother': {
      const removed = removeHero(state, enteringUid)
      if (removed.hero) {
        state = toExile(removed.state, {
          uid: removed.hero.uid,
          defId: removed.hero.defId,
          kind: removed.hero.token ? 'neutral' : 'hero',
        })
        state = log(state, `Spin Web exiles ${display(removed.hero.defId).name}.`)
      }
      return settleRevealedTrap(state, teamId, trap, card)
    }
    case 'monkey_king':
      state = setPlayer(state, controller, (player) => ({ ...player, skip: true }))
      return settleRevealedTrap(log(state, `Wukong's Command: ${pname(state, controller)} loses their next turn.`), teamId, trap, card)
    case 'riki':
      state = setPlayer(state, controller, (player) => ({ ...player, orchid: stamp }))
      return settleRevealedTrap(log(state, `Cloak and Dagger: ${pname(state, controller)} cannot activate abilities.`), teamId, trap, card)
    case 'slark': {
      state = settleRevealedTrap(state, teamId, trap, card)
      const hand = state.players[controller]!.hand
      if (hand.length <= 3) return slarkDone(state, controller, hand.map((entry) => entry.uid))
      return ask(state, {
        actor: controller,
        prompt: 'Shadow Dance: discard 3 cards.',
        mode: 'pick',
        min: 3,
        max: 3,
        choices: hand.map((entry) => ({ id: `card:${entry.uid}`, label: display(entry.defId).name, defId: entry.defId })),
        resume: { kind: 'slark-trap', owner: controller, card },
      })
    }
    case 'shadow_shaman': {
      state = settleRevealedTrap(state, teamId, trap, card)
      const others = allLocs(state).filter((loc) => loc.player.id === controller && loc.team.id !== teamId)
      if (others.length === 0) return log(state, 'Shackles finds no other team.')
      return ask(state, {
        actor: controller,
        prompt: 'Shackles: sacrifice a hero from another team you control.',
        mode: 'pick',
        min: 1,
        max: 1,
        choices: others.map((loc) => ({ id: `hero:${loc.hero.uid}`, label: display(loc.hero.defId).name, defId: loc.hero.defId })),
        resume: { kind: 'shaman-trap', teamId, trap, card },
      })
    }
    case 'kez': {
      const team = teamById(state, teamId)?.team
      const heroes = state.players[controller]!.hand.filter((entry) => entry.kind === 'hero' && !isTrapHero(entry.defId))
      if (!team || heroes.length === 0 || enterReason(state, team, 1, false)) {
        return settleRevealedTrap(log(state, 'Switch Discipline: no hero can join.'), teamId, trap, card)
      }
      return ask(state, {
        actor: controller,
        prompt: 'Switch Discipline: play a hero from your hand into this team for free.',
        mode: 'pick',
        min: 1,
        max: 1,
        choices: [
          ...heroes.map((entry) => ({ id: `card:${entry.uid}`, label: display(entry.defId).name, defId: entry.defId })),
          { id: 'pass', label: 'Keep your hand' },
        ],
        resume: { kind: 'kez-trap', teamId, trap, card },
      })
    }
    case 'ogre_magi': {
      const entrant = findHero(state, enteringUid)
      if (entrant && firesAbility(entrant.hero.defId)) state = { ...state, multicast: enteringUid }
      return settleRevealedTrap(log(state, 'Multicast: the entering hero activates twice.'), teamId, trap, card)
    }
    case 'bounty_hunter': {
      state = settleRevealedTrap(state, teamId, trap, card)
      const foes = opponents(state, controller)
      if (foes.length === 0) return state
      if (foes.length === 1) return askBounty(state, controller, foes[0]!)
      return ask(state, {
        actor: controller,
        prompt: "Track: choose an opponent's hand to reveal.",
        mode: 'pick',
        min: 1,
        max: 1,
        choices: foes.map((id) => ({ id: `player:${id}`, label: pname(state, id) })),
        resume: { kind: 'bounty-trap', controller, target: null },
      })
    }
    case 'templar_assassin':
      state = updateTeam(state, teamId, (team) => ({ ...team, guard: stamp }))
      return settleRevealedTrap(log(state, 'Refraction: heroes in this team cannot be destroyed.'), teamId, trap, card)
    default:
      return settleRevealedTrap(state, teamId, trap, card)
  }
}

function slarkDone(state: Game, controller: PlayerId, uids: string[]): Game {
  let next = state
  for (const uid of uids) next = discardUid(next, controller, uid)
  next = log(next, `Shadow Dance: ${pname(next, controller)} discards ${uids.length}; everyone else draws 1.`)
  for (const id of opponents(next, controller)) next = queueDraw(next, id, 1)
  return next
}

function askBounty(state: Game, controller: PlayerId, target: PlayerId): Game {
  state = { ...state, reveal: [...state.reveal, { viewer: controller, target, turn: state.turn }] }
  const heroes = state.players[target]!.hand.filter((entry) => entry.kind === 'hero')
  if (heroes.length === 0) return log(state, `Track: ${pname(state, target)} holds no hero card.`)
  return ask(state, {
    actor: controller,
    prompt: `Track: take a hero card from ${pname(state, target)}'s hand.`,
    mode: 'pick',
    min: 1,
    max: 1,
    choices: heroes.map((entry) => ({ id: `card:${entry.uid}`, label: display(entry.defId).name, defId: entry.defId })),
    resume: { kind: 'bounty-trap', controller, target },
  })
}

export function finishTrapChoose(state: Game, ids: string[]): Game | null {
  const pending = state.pending
  if (!pending) return null
  const picked = (id: string | undefined, prefix: string) => (id?.startsWith(prefix) ? id.slice(prefix.length) : '')
  if (pending.resume.kind === 'slark-trap') {
    const owner = pending.resume.owner
    const uids = ids.map((id) => picked(id, 'card:') || id)
    return slarkDone({ ...state, pending: null }, owner, uids)
  }
  if (pending.resume.kind === 'bounty-trap') {
    const { controller, target } = pending.resume
    const next: Game = { ...state, pending: null }
    if (target === null) {
      const raw = picked(ids[0], 'player:')
      return raw ? askBounty(next, controller, Number(raw) as PlayerId) : next
    }
    const uid = picked(ids[0], 'card:')
    const card = next.players[target]?.hand.find((entry) => entry.uid === uid)
    if (!card) return next
    const moved = addHand(removeHand(next, target, uid), controller, [card])
    return log(moved, `Track takes ${display(card.defId).name}.`)
  }
  if (pending.resume.kind === 'kez-trap') {
    const { teamId, trap, card } = pending.resume
    let next: Game = { ...state, pending: null }
    const found = teamById(next, teamId)
    const cardUid = picked(ids[0], 'card:')
    const hand = found ? next.players[found.player.id]!.hand.find((entry) => entry.uid === cardUid) : undefined
    if (found && hand && !enterReason(next, found.team, 1, false)) {
      const controller = found.player.id
      const hero = makeHero(hand, controller, controller, next)
      next = putOnTeam(removeHand(next, controller, hand.uid), controller, teamId, hero)
      next = log(touchEnter(next, hero.uid), `Switch Discipline brings in ${display(hand.defId).name}.`)
      if (firesAbility(hand.defId)) {
        next = holdCast(next, { kind: 'cast', actor: controller, sourceUid: hero.uid, defId: hand.defId, picked: [], steps: 0 })
      }
    }
    return settleRevealedTrap(next, teamId, trap, card)
  }
  if (pending.resume.kind === 'shaman-trap') {
    const uid = picked(ids[0], 'hero:')
    let next: Game = { ...state, pending: null }
    if (uid) next = enqueue(next, uid, 'Shackles', false, true, null)
    return log(next, 'Shackles.')
  }
  return null
}

/** Queue a hero ability to fire once the current trap / cascade finishes (last queued fires first). */
export function holdCast(state: Game, cast: CastResume): Game {
  return { ...state, laterCasts: [...state.laterCasts, { uid: cast.sourceUid, cast }] }
}
