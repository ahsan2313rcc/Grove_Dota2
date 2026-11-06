import { display, HERO_BY_ID } from './catalog.ts'
import { apply, comboPlans, emberMoves, morphCasts, needsTeam, playableFromGrave, teamsFor, undyingRevive } from './engine.ts'
import {
  allLocs,
  drawsLocked,
  findHero,
  isTrapHero,
  preferredFoe,
  preferredFoeFromScores,
  scoreState,
  scoreTeam,
  teamById,
} from './flow.ts'
import type { Action, AiStrat, CardInst, Game, PlayerId } from './types.ts'

export const AI_STRATS: { id: AiStrat; label: string; blurb: string }[] = [
  { id: 'balanced', label: 'Balanced', blurb: 'Scores first, holds answers, interrupts threats, and banks denial auras.' },
  { id: 'tempo', label: 'Tempo', blurb: 'Floods heroes, spends actions, and gates Chronosphere / Silence on real board threats.' },
  { id: 'architect', label: 'Architect', blurb: 'Builds cores and terrain paths, still removes filled enemy teams, ends only with empty denial.' },
  { id: 'spite', label: 'Spite', blurb: 'Pressure-first: hunts the highest threat seat with traps, steals, and removal without breaking own cores.' },
]

export const DEFAULT_STRAT: AiStrat = 'balanced'

/** Instant / counter cards worth firing into an interrupt window. */
const INTERRUPT_VALUE: Record<string, number> = {
  nyx_assassin: 12,
  rubick: 11,
  spirit_breaker: 10,
  faceless_void: 9,
  silencer: 8,
  orchid: 7.5,
  earth_spirit: 7,
  dagon: 7,
  scythe: 7,
  abyssal: 6.5,
  euls: 5.5,
  force_staff: 4,
  shadow_blade: 3.5,
  bkb: 3,
  shivas: 5,
  disruptor: 5,
  dazzle: 2,
  oracle: 2.5,
  dawnbreaker: 2,
  tusk: 2,
  ringmaster: 3,
  shadow_demon: 4,
  marci: 1.5,
  illusion: 6,
}

export function isAiStrat(value: string): value is AiStrat {
  return AI_STRATS.some((entry) => entry.id === value)
}

export function stratLabel(id: AiStrat): string {
  return AI_STRATS.find((entry) => entry.id === id)?.label ?? id
}

export function cycleStrat(index: number): AiStrat {
  return AI_STRATS[index % AI_STRATS.length]!.id
}

/**
 * `full` — watch / human-vs-AI quality (wide 1-ply tree).
 * `fast` — batch sims: pre-rank hand, search only top candidates (target ~20 games/sec).
 */
export type AiSearchMode = 'full' | 'fast'

export function chooseAiAction(state: Game, mode: AiSearchMode = 'full'): Action {
  if (state.veil) return { type: 'ready' }
  if (state.over) return { type: 'end' }
  if (state.pending) return { type: 'choose', ids: chooseAiPending(state) }

  const fast = mode === 'fast'
  const actor = state.active
  const strat = state.players[actor]?.strat ?? DEFAULT_STRAT
  const plans = comboPlans(state)
  const core = plans.find((plan) => plan.detail.startsWith('core'))
  const mixed = plans.find((plan) => plan.detail.startsWith('mixed'))

  // Free terrain combos first. Prefer core (reward + same points). Never play a lone terrain.
  if (core) return { type: 'combo', uids: core.uids }
  if (mixed) return { type: 'combo', uids: mixed.uids }

  if (fast) return chooseAiActionFast(state, actor, strat)

  let best: Action = { type: 'end' }
  let bestScore = evaluate(state, actor, strat) + endBias(state, actor, strat)

  // Morph stolen casts while they are still live this turn.
  for (const cast of morphCasts(state)) {
    const action: Action = { type: 'morph', uid: cast.uid }
    const next = apply({ ...state, autoAll: true }, action)
    if (!moved(state, next)) continue
    const score = evaluate(next, actor, strat) + 1.2
    if (score > bestScore) {
      bestScore = score
      best = action
    }
  }

  const undying = undyingRevive(state)
  if (undying.ok) {
    const discards = pickUndyingDiscards(state, actor)
    if (discards.length >= 2) {
      const action: Action = { type: 'undying', team: 'new', discards }
      const next = apply({ ...state, autoAll: true }, action)
      if (moved(state, next)) {
        const score = evaluate(next, actor, strat) + 1.5
        if (score > bestScore) {
          bestScore = score
          best = action
        }
      }
    }
  }

  for (const ember of emberMoves(state)) {
    for (const team of emberTargets(state, ember.uid)) {
      if (!team.ok) continue
      const action: Action = { type: 'move', uid: ember.uid, team: team.id }
      const next = apply({ ...state, autoAll: true }, action)
      if (!moved(state, next)) continue
      const score = evaluate(next, actor, strat) + 0.4
      if (score > bestScore) {
        bestScore = score
        best = action
      }
    }
  }

  const hand = state.players[actor].hand
  const heroUids = hand.filter((card) => card.kind === 'hero' && !isTrapHero(card.defId)).map((card) => card.uid)
  const seen = new Set<string>()

  // Death Prophet: play the top of the grave (costs 1 action), including terrain combo plans.
  const graveTop = playableFromGrave(state, actor)
  if (graveTop && graveTop.kind !== 'terrain') {
    const teams = pickTeamOptions(state, graveTop.uid, graveTop.defId, graveTop.kind, false)
    for (const team of teams) {
      const action: Action = { type: 'play', uid: graveTop.uid, team: team.id }
      const next = apply({ ...state, autoAll: true }, action)
      if (!moved(state, next)) continue
      let score = evaluate(next, actor, strat)
      score += playBias(state, next, actor, strat, graveTop, team.id, 0) + 2.4
      if (score > bestScore) {
        bestScore = score
        best = action
      }
    }
  } else if (graveTop?.kind === 'terrain') {
    for (const plan of comboPlans(state)) {
      if (!plan.uids.includes(graveTop.uid)) continue
      const action: Action = { type: 'combo', uids: plan.uids }
      const next = apply({ ...state, autoAll: true }, action)
      if (!moved(state, next)) continue
      const score = evaluate(next, actor, strat) + 2.6
      if (score > bestScore) {
        bestScore = score
        best = action
      }
    }
  }

  for (const card of hand) {
    if (card.kind === 'terrain') continue
    if (seen.has(card.defId)) continue
    seen.add(card.defId)
    const instant = display(card.defId).instant
    if (!instant && state.players[actor].actions < 1) continue
    const teams = pickTeamOptions(state, card.uid, card.defId, card.kind, false)
    for (const team of teams) {
      const packs: (string[] | undefined)[] = [undefined]
      if (card.kind === 'hero' && !isTrapHero(card.defId)) {
        const mates = rankMates(state, actor, card.uid, team.id, heroUids)
        if (mates.length >= 2) packs.push(mates.slice(0, 2))
        for (const mate of mates.slice(0, 3)) packs.push([mate])
      }
      for (const extras of packs) {
        const action: Action = extras
          ? { type: 'play', uid: card.uid, team: team.id, extras }
          : { type: 'play', uid: card.uid, team: team.id }
        const next = apply({ ...state, autoAll: true }, action)
        if (!moved(state, next)) continue
        let score = evaluate(next, actor, strat)
        score += playBias(state, next, actor, strat, card, team.id, extras?.length ?? 0)
        if (extras && extras.length > 0) score += 0.35 * extras.length
        if (score > bestScore) {
          bestScore = score
          best = action
        }
      }
    }
  }

  // Drawing above handLimit is legal mid-turn; discard happens only at end of turn.
  if (state.players[actor].actions > 0 && state.deck.length > 0) {
    const next = apply({ ...state, autoAll: true }, { type: 'draw' })
    if (moved(state, next)) {
      const score = evaluate(next, actor, strat) + drawBias(state, actor, strat)
      if (score > bestScore) {
        bestScore = score
        best = { type: 'draw' }
      }
    }
  }

  // Softlock escape: hand full of lone terrains / locked items — pitch one and dig.
  if (best.type === 'end' && state.players[actor].actions > 0) {
    const uid = stuckDiscardUid(state, actor)
    if (uid) return { type: 'discard', uid }
  }

  return best
}

/**
 * Batch-sim policy: zero speculative apply/evaluate.
 * Static hand rank + one destination — engine apply happens only for the chosen action.
 * (1-ply search was ~80% of sim time; this targets ~20 games/sec.)
 */
function chooseAiActionFast(state: Game, actor: PlayerId, strat: AiStrat): Action {
  void strat
  const undying = undyingRevive(state)
  if (undying.ok) {
    const discards = pickUndyingDiscards(state, actor)
    if (discards.length >= 2) return { type: 'undying', team: 'new', discards }
  }

  const graveTop = playableFromGrave(state, actor)
  if (graveTop?.kind === 'terrain') {
    for (const plan of comboPlans(state)) {
      if (!plan.uids.includes(graveTop.uid)) continue
      return { type: 'combo', uids: plan.uids }
    }
  } else if (graveTop && graveTop.kind !== 'terrain' && state.players[actor].actions > 0) {
    const team = pickTeamOptions(state, graveTop.uid, graveTop.defId, graveTop.kind, true)[0]
    if (team) return { type: 'play', uid: graveTop.uid, team: team.id }
  }

  const morph = morphCasts(state)[0]
  if (morph) return { type: 'morph', uid: morph.uid }

  const hand = state.players[actor].hand
  const ranked = rankHandForFast(state, actor, hand)
  const top = ranked[0]
  if (top) {
    const team = pickTeamOptions(state, top.uid, top.defId, top.kind, true)[0]
    if (!needsTeam(top.defId, top.kind) || team) {
      return { type: 'play', uid: top.uid, team: team?.id ?? '' }
    }
  }

  // Dig only when the hand has nothing playable (don't burn actions drawing forever).
  const playable = ranked.length > 0
  if (!playable && state.players[actor].actions > 0 && state.deck.length > 0) {
    return { type: 'draw' }
  }

  const stuck = stuckDiscardUid(state, actor)
  if (stuck && state.players[actor].actions > 0 && !playable) return { type: 'discard', uid: stuck }
  return { type: 'end' }
}

function rankHandForFast(state: Game, actor: PlayerId, hand: CardInst[]): CardInst[] {
  const threat = threatScore(state, actor)
  const actions = state.players[actor].actions
  const seen = new Set<string>()
  const ranked: { card: CardInst; rank: number }[] = []
  for (const card of hand) {
    if (card.kind === 'terrain') continue
    if (seen.has(card.defId)) continue
    seen.add(card.defId)
    const instant = display(card.defId).instant
    if (!instant && actions < 1) continue
    let rank = 0
    const denial = INTERRUPT_VALUE[card.defId] ?? 0
    if (isTrapHero(card.defId)) rank += 2.5
    else if (card.kind === 'hero') rank += 4 + (HERO_BY_ID[card.defId]?.timing === 'cast' ? 1.2 : 0.4)
    else if (card.kind === 'item') rank += 3
    else rank += 2.2
    // Hold premium answers unless the board already looks hot.
    if (denial >= 7) rank += threat >= 5 ? 3 : -2
    else if (denial >= 5) rank += threat >= 4 ? 1.2 : -0.4
    if (instant && denial < 5) rank += 0.3
    ranked.push({ card, rank })
  }
  ranked.sort((a, b) => b.rank - a.rank)
  return ranked.map((entry) => entry.card)
}

/** Smart answers for pending prompts (also used by engine settle for AI / autoAll). */
export function chooseAiPending(state: Game): string[] {
  const pending = state.pending
  if (!pending) return []
  const actor = pending.actor
  const strat = state.players[actor]?.strat ?? DEFAULT_STRAT
  const focus = threatFocus(state, actor, strat)
  const scores = state.players.map((player) => scoreState(state, player.id).total)

  if (pending.mode === 'split') {
    return smartSplit(pending.choices.map((choice) => choice.id))
  }
  if (pending.mode === 'assign') {
    return smartAssign(state, pending.choices.map((choice) => choice.id), actor, focus, scores)
  }
  if (pending.mode === 'groups') {
    return smartGroups(pending.choices.map((choice) => choice.id))
  }

  // Ability / card counters — take them.
  const torment = pending.choices.find((choice) => choice.id.startsWith('torment:'))
  if (torment) return [torment.id]

  // Save window: protect high-value allies.
  const save = pending.choices.find((choice) => choice.id.startsWith('play:'))
  if (save && /destroyed|destroy/i.test(pending.prompt)) {
    return [save.id]
  }

  // Instant interrupt window — fire a strong Instant instead of passing.
  if (pending.resume.kind === 'instant-window') {
    const pick = bestInterrupt(state, pending.choices.map((choice) => choice.id), actor, strat)
    if (pick) return [pick]
    return ['pass']
  }
  // Instant hero team pick during interrupt — prefer a new team when available.
  if (pending.resume.kind === 'instant-place') {
    const neu = pending.choices.find((choice) => choice.id.endsWith(':new') || choice.id.includes(':new'))
    if (neu) return [neu.id]
    return pending.choices[0] ? [pending.choices[0].id] : ['pass']
  }

  // Illusion rune — counter threatening enters.
  const illu = pending.choices.find((choice) => choice.id.startsWith('illu:'))
  if (illu) {
    if (/Axe|Enigma|Tidehunter|Medusa|Magnus|Anti-Mage|Sven|Earthshaker|Razor|Morphling/i.test(pending.prompt)) {
      return [illu.id]
    }
    if (strat === 'spite' || strat === 'tempo') return [illu.id]
    // Default: counter if we are behind.
    if ((scores[actor] ?? 0) + 2 < (scores[focus] ?? 0)) return [illu.id]
  }

  const hasYes = pending.choices.some((choice) => choice.id === 'yes')
  const hasNo = pending.choices.some((choice) => choice.id === 'no')
  if (hasYes && hasNo) {
    if (/fire that ability|destroy shadow shaman|play it|for free|take the|reactivate|cast /i.test(pending.prompt)) return ['yes']
    if (/discard 1|Nether Ward/i.test(pending.prompt)) {
      return state.players[actor].hand.length > 1 ? ['discard'] : ['fizzle']
    }
    if (/Infest leaves|leave the stolen|Shackles passes|quiet/i.test(pending.prompt)) return ['no']
    return strat === 'architect' ? ['no'] : ['yes']
  }
  if (pending.choices.some((choice) => choice.id === 'discard') && pending.choices.some((choice) => choice.id === 'fizzle')) {
    return state.players[actor].hand.length > 1 ? ['discard'] : ['fizzle']
  }
  if (pending.choices.some((choice) => choice.id === 'exile:yes')) {
    return strat === 'spite' ? ['exile:yes'] : ['exile:no']
  }

  if (pending.choices.some((choice) => choice.id === 'pass') && pending.choices.length === 1) {
    return ['pass']
  }

  // Prefer targeting the seat ahead; avoid self.
  if (pending.min === 0 && pending.choices.length === 0) return []

  const ranked = pending.choices
    .filter((choice) => choice.id !== 'pass' || pending.choices.length === 1)
    .map((choice, index) => ({
      id: choice.id,
      weight: pendingChoiceWeight(state, choice.id, actor, focus, scores, strat) - index * 0.001,
    }))
    .sort((a, b) => b.weight - a.weight)

  if (ranked.length === 0 && pending.choices.some((choice) => choice.id === 'pass')) return ['pass']
  const take = Math.max(pending.min, Math.min(pending.max, ranked.length))
  const picked = ranked.slice(0, take).map((entry) => entry.id)
  if (picked.length < pending.min && pending.choices.some((choice) => choice.id === 'pass')) return ['pass']
  return picked
}

function bestInterrupt(
  state: Game,
  choiceIds: string[],
  actor: PlayerId,
  strat: AiStrat,
): string | null {
  let best: string | null = null
  let bestValue = interruptBar(state, actor, strat)
  const focus = threatFocus(state, actor, strat)
  const scores = state.players.map((player) => scoreState(state, player.id).total)
  const behind = (scores[actor] ?? 0) + 2 < (scores[focus] ?? 0)
  const threat = threatScore(state, actor)
  const castValue = pendingCastThreat(state)
  for (const id of choiceIds) {
    if (id === 'pass') continue
    const uid = id.startsWith('instant:') ? id.slice(8) : id
    const card = state.players[actor]?.hand.find((entry) => entry.uid === uid)
    if (!card) continue
    let value = INTERRUPT_VALUE[card.defId] ?? (display(card.defId).instant ? 3 : 0)
    value += castValue * 0.35
    if (strat === 'spite') value += 1.8
    if (strat === 'tempo' && (card.defId === 'faceless_void' || card.defId === 'silencer')) {
      value += castValue >= 3 || threat >= 5 ? 2.6 : -1.2
    }
    if (strat === 'balanced' && !behind && threat < 4 && value >= 9) value -= 1.4
    if (behind) value += 1.1
    if (threat >= 7) value += 0.9
    if (value > bestValue) {
      bestValue = value
      best = id
    }
  }
  return best
}

function interruptBar(state: Game, actor: PlayerId, strat: AiStrat): number {
  const threat = threatScore(state, actor)
  const mine = scoreState(state, actor).total
  const foe = rivalPts(state, actor)
  const ahead = mine >= foe + 4
  if (strat === 'architect') return ahead ? 5.4 : threat >= 6 ? 3.6 : 4.4
  if (strat === 'tempo') return threat >= 5 || pendingCastThreat(state) >= 4 ? 3.4 : 4.8
  if (strat === 'spite') return 3.2
  // balanced: raise the bar when ahead so answers stay in hand
  return ahead ? 5.2 : threat >= 6 ? 3.5 : 4.0
}

/** Board + pending cast heat used to hold Instant answers. */
export function threatScore(state: Game, actor: PlayerId): number {
  let threat = 0
  for (const player of state.players) {
    if (player.id === actor) continue
    for (const team of player.teams) {
      const pts = scoreTeam(state, team).points
      if (team.heroes.length >= 3) threat += 1.6 + pts * 0.12
      else if (team.heroes.length === 2) threat += 0.45
      for (const hero of team.heroes) {
        const timing = HERO_BY_ID[hero.defId]?.timing
        if (timing === 'cast') threat += 2.1
        if (timing === 'instant') threat += 1.3
        if (HIGH_THREAT_HEROES.has(hero.defId)) threat += 2.2
      }
    }
    threat += Math.min(3, player.hand.filter((card) => display(card.defId).instant).length) * 0.35
  }
  threat += pendingCastThreat(state)
  return threat
}

const HIGH_THREAT_HEROES = new Set([
  'enigma',
  'tidehunter',
  'medusa',
  'axe',
  'troll_warlord',
  'doom',
  'razor',
  'morphling',
  'puck',
  'magnus',
  'earthshaker',
  'sven',
  'anti_mage',
  'death_prophet',
  'outworld_destroyer',
  'sand_king',
])

function pendingCastThreat(state: Game): number {
  const resume = state.pending?.resume
  if (!resume) return 0
  const defId =
    resume.kind === 'instant-window'
      ? resume.cast.defId
      : resume.kind === 'cast'
        ? resume.defId
        : resume.kind === 'pugna'
          ? resume.cast.defId
          : null
  if (!defId) return 0
  if (HIGH_THREAT_HEROES.has(defId)) return 6
  const timing = HERO_BY_ID[defId]?.timing
  if (timing === 'cast') return 4
  if (timing === 'instant') return 3
  return 2
}

/** Spite hunts the hottest board; others still climb the score ladder. */
function threatFocus(state: Game, actor: PlayerId, strat: AiStrat): PlayerId {
  if (strat !== 'spite') return preferredFoe(state, actor)
  let best = preferredFoe(state, actor)
  let bestHeat = -Infinity
  for (const player of state.players) {
    if (player.id === actor) continue
    let heat = scoreState(state, player.id).total
    for (const team of player.teams) {
      if (team.heroes.length >= 3) heat += 4 + scoreTeam(state, team).points * 0.2
      for (const hero of team.heroes) {
        if (HIGH_THREAT_HEROES.has(hero.defId)) heat += 5
        if (HERO_BY_ID[hero.defId]?.timing === 'cast') heat += 2
      }
    }
    if (heat > bestHeat) {
      bestHeat = heat
      best = player.id
    }
  }
  return best
}

function smartSplit(ids: string[]): string[] {
  // Keep teams as even as possible rather than a/b striping blindly.
  return ids.map((id, index) => `${index < Math.ceil(ids.length / 2) ? 'a' : 'b'}:${id}`)
}

function smartAssign(
  state: Game,
  ids: string[],
  actor: PlayerId,
  focus: PlayerId,
  scores: number[],
): string[] {
  const seats = Math.max(2, state.players.length)
  // Dump the densest piles onto the focus foe first, then other rivals.
  const order = [...Array(seats).keys()]
    .filter((seat) => seat !== actor)
    .sort((a, b) => (b === focus ? 1 : 0) - (a === focus ? 1 : 0) || (scores[b] ?? 0) - (scores[a] ?? 0))
  if (order.length === 0) return ids.map((id, index) => `${index % seats}:${id}`)
  return ids.map((id, index) => `${order[index % order.length]}:${id}`)
}

function smartGroups(ids: string[]): string[] {
  const size = Math.max(1, Math.ceil(ids.length / 3))
  return ids.map((id, index) => `${Math.min(2, Math.floor(index / size))}:${id}`)
}

/** Prefer pitching terrains / dead weight over Instant answers for Flesh Golem. */
function pickUndyingDiscards(state: Game, actor: PlayerId): string[] {
  const hand = state.players[actor]?.hand ?? []
  const ranked = [...hand].sort((a, b) => undyingCost(a) - undyingCost(b))
  return ranked.slice(0, 2).map((card) => card.uid)
}

function undyingCost(card: CardInst): number {
  if (card.kind === 'terrain') return 0
  if (isTrapHero(card.defId)) return 1
  if (card.kind === 'item' && !display(card.defId).instant) return 2
  if (card.kind === 'hero' && HERO_BY_ID[card.defId]?.timing === 'aura') return 3
  if (display(card.defId).instant || INTERRUPT_VALUE[card.defId]) return 9
  if (HERO_BY_ID[card.defId]?.timing === 'cast') return 7
  return 4
}

function pendingChoiceWeight(
  state: Game,
  choiceId: string,
  actor: PlayerId,
  focus: PlayerId,
  scores: number[],
  strat: AiStrat,
): number {
  if (choiceId === 'pass') return -20
  const prompt = state.pending?.prompt ?? ''
  const friendly = isFriendlyPrompt(prompt)
  const owner = choiceOwner(state, choiceId)
  const hunt = threatFocus(state, actor, strat)

  if (owner === actor) {
    if (!friendly) {
      // Spite / tempo still refuse to snip their own filled cores.
      if (choiceId.startsWith('team:') || choiceId.startsWith('hero:')) {
        const pts = ownChoicePoints(state, choiceId)
        if (pts >= 6) return -18
      }
      return -8
    }
    let weight = 55
    if (choiceId.startsWith('hero:')) {
      const loc = findHero(state, choiceId.slice(5))
      if (loc) weight += scoreTeam(state, loc.team).points * 0.4
    }
    if (choiceId.startsWith('team:')) {
      const found = teamById(state, choiceId.slice(5))
      if (found) weight += scoreTeam(state, found.team).points * 0.55
    }
    return weight
  }

  let weight = 0
  if (owner === hunt) weight += 130 + (scores[owner] ?? 0)
  else if (owner === focus) weight += 110 + (scores[owner] ?? 0)
  else if (owner !== null) weight += 40 + (scores[owner] ?? 0)

  if (choiceId.startsWith('hero:')) {
    const loc = findHero(state, choiceId.slice(5))
    if (loc) {
      const pts = scoreTeam(state, loc.team).points
      weight += pts * 0.5
      if (HIGH_THREAT_HEROES.has(loc.hero.defId)) weight += 12
      if (firesAbilityTarget(loc.hero.defId)) weight += 5
      if (loc.team.heroes.length >= 3) weight += 6
    }
  }
  if (choiceId.startsWith('team:')) {
    const found = teamById(state, choiceId.slice(5))
    if (found) {
      weight += scoreTeam(state, found.team).points * 0.6
      if (found.team.heroes.length >= 3) weight += 8
    }
  }
  if (choiceId.startsWith('attr:')) {
    const attr = choiceId.slice(5)
    let count = 0
    for (const loc of allLocs(state)) {
      if (loc.hero.controller === hunt && HERO_BY_ID[loc.hero.defId]?.attr === attr) count += 1
    }
    weight += count * 6
  }
  if (choiceId.startsWith('mode:immune') || choiceId === 'yes') {
    if (friendly || /immune|fire that ability|play it|for free/i.test(prompt)) weight += 80
  }
  if (strat === 'spite') weight *= 1.22
  if (strat === 'architect' && friendly) weight *= 1.12
  if (strat === 'architect' && !friendly) weight *= 1.1
  if (strat === 'tempo' && /lose their|discard|destroy|exile|control/i.test(prompt)) weight *= 1.15
  if (strat === 'balanced' && /destroy|exile|discard|control|steal/i.test(prompt)) weight *= 1.08
  return weight
}

function ownChoicePoints(state: Game, choiceId: string): number {
  if (choiceId.startsWith('hero:')) {
    const loc = findHero(state, choiceId.slice(5))
    return loc ? scoreTeam(state, loc.team).points : 0
  }
  if (choiceId.startsWith('team:')) {
    const found = teamById(state, choiceId.slice(5))
    return found ? scoreTeam(state, found.team).points : 0
  }
  return 0
}

function isFriendlyPrompt(prompt: string): boolean {
  return /allied|your hero|you own|immune|Snowball|Shallow Grave|False Promise|Glyph|Black King Bar|Shield|move an allied|target hero you|Oracle|Tusk|Dazzle|Dawnbreaker|Ringmaster|BKB/i.test(prompt)
}

function firesAbilityTarget(defId: string): boolean {
  const timing = HERO_BY_ID[defId]?.timing
  return timing === 'cast' || timing === 'instant'
}

function choiceOwner(state: Game, choiceId: string): PlayerId | null {
  if (choiceId.startsWith('player:')) return Number(choiceId.slice(7)) as PlayerId
  if (choiceId.startsWith('hero:')) return findHero(state, choiceId.slice(5))?.hero.controller ?? null
  if (choiceId.startsWith('team:')) return teamById(state, choiceId.slice(5))?.player.id ?? null
  if (choiceId.startsWith('new:')) {
    const seat = Number(choiceId.slice(4))
    return Number.isFinite(seat) ? (seat as PlayerId) : null
  }
  if (choiceId.startsWith('card:')) {
    const uid = choiceId.slice(5)
    for (const player of state.players) {
      if (player.hand.some((card) => card.uid === uid)) return player.id
    }
  }
  return null
}

function emberTargets(state: Game, uid: string): { id: string; ok: boolean }[] {
  const loc = findHero(state, uid)
  if (!loc) return []
  const actor = loc.hero.controller
  return state.players[actor].teams
    .filter((team) => team.id !== loc.team.id)
    .map((team) => ({ id: team.id, ok: true }))
    .concat([{ id: 'new', ok: state.players[actor].teams.length < 12 }])
}

function stuckDiscardUid(state: Game, actor: PlayerId): string | null {
  const hand = state.players[actor].hand
  if (hand.length === 0) return null
  const playable = hand.some((card) => {
    if (card.kind === 'terrain') return false
    const teams = needsTeam(card.defId, card.kind) ? teamsFor(state, card.uid).filter((team) => team.ok) : [{ id: '', ok: true }]
    return teams.some((team) => {
      const next = apply({ ...state, autoAll: true }, { type: 'play', uid: card.uid, team: team.id })
      return moved(state, next)
    })
  })
  if (playable) return null
  if (hand.length < state.players[actor].handLimit && state.deck.length > 0 && !drawsLocked(state, actor)) return null

  const terrain = hand.find((card) => card.kind === 'terrain')
  if (terrain) return terrain.uid
  const item = hand.find((card) => card.kind === 'item')
  if (item) return item.uid
  return hand[0]?.uid ?? null
}

function endBias(state: Game, actor: PlayerId, strat: AiStrat): number {
  const actions = state.players[actor].actions
  if (actions < 1) return 0
  const hand = state.players[actor].hand
  const denialHand = hand.filter((card) => (INTERRUPT_VALUE[card.defId] ?? 0) >= 6).length
  const threat = threatScore(state, actor)
  // Keep spending actions — ending with spare actions is how seats fall behind.
  let bias = -2.05
  if (strat === 'tempo') bias = -2.35
  if (strat === 'architect') bias = denialHand === 0 ? -2.15 : -1.55
  if (strat === 'spite') bias = -2.2
  // Holding a premium Instant while threat is low: slightly prefer to end rather than burn it.
  if (denialHand >= 1 && threat < 4) bias += strat === 'tempo' ? 0.55 : 0.35
  if (threat >= 7 && denialHand === 0) bias -= 0.35
  return bias
}

function drawBias(state: Game, actor: PlayerId, strat: AiStrat): number {
  const hand = state.players[actor].hand
  const playable = hand.filter((card) => card.kind !== 'terrain').length
  const terrains = hand.filter((card) => card.kind === 'terrain').length
  const denial = hand.filter((card) => (INTERRUPT_VALUE[card.defId] ?? 0) >= 7).length
  const base =
    0.5 +
    (playable <= 1 ? 0.65 : 0) +
    (terrains >= 2 ? 0.3 : 0) +
    (hand.length <= 3 ? 0.28 : 0) +
    (hand.length >= 6 && playable >= 2 ? -0.45 : 0) +
    (denial === 0 && threatScore(state, actor) >= 6 ? 0.35 : 0)
  if (strat === 'tempo') return playable === 0 ? 1.45 : base - (playable >= 3 ? 0.25 : 0)
  if (strat === 'architect') return base + (terrains >= 2 ? 0.28 : 0) - (playable >= 3 ? 0.12 : 0)
  if (strat === 'spite') return playable === 0 ? 1.25 : base + 0.08
  return base
}

function playBias(
  before: Game,
  after: Game,
  actor: PlayerId,
  strat: AiStrat,
  card: CardInst,
  teamId: string,
  extras: number,
): number {
  const beforeHeroes = before.players[actor].teams.reduce((sum, team) => sum + team.heroes.length, 0)
  const afterHeroes = after.players[actor].teams.reduce((sum, team) => sum + team.heroes.length, 0)
  const beforeFilled = before.players[actor].teams.filter((team) => team.heroes.length >= 3).length
  const afterFilled = after.players[actor].teams.filter((team) => team.heroes.length >= 3).length
  const beforePts = scoreState(before, actor).total
  const afterPts = scoreState(after, actor).total
  const ptsGain = afterPts - beforePts
  const kind = card.kind
  const trap = isTrapHero(card.defId)
  const trapOnEnemy = (() => {
    const found = teamById(after, teamId)
    return !!found && found.player.id !== actor && !!found.team.trap && found.team.trap.owner === actor
  })()
  const instant = display(card.defId).instant
  const denial = INTERRUPT_VALUE[card.defId] ?? 0
  const threat = threatScore(before, actor)
  const behind = beforePts + 3 < rivalPts(before, actor)
  const oppDelta = beforeOppDelta(before, after, actor)
  const pressure = pressureDelta(before, after, actor)

  let bonus = ptsGain * 0.82
  bonus += extras * 0.42
  bonus += oppDelta * 0.32
  bonus += pressure * 0.55

  const timing = HERO_BY_ID[card.defId]?.timing
  if ((timing === 'cast' || timing === 'instant') && !trap) {
    bonus += 0.55 + Math.max(0, ptsGain) * 0.22
  }

  if (trap && trapOnEnemy) {
    bonus += strat === 'spite' ? 2.25 : 1.7
  } else if (trap) {
    bonus += strat === 'spite' ? 0.35 : 0.25
  }

  // Hold premium Instant answers unless the board is hot or we are behind.
  if (instant && denial >= 7) {
    const burnOk = threat >= 5.5 || behind || oppDelta >= 2 || pressure >= 1
    if (card.defId === 'faceless_void' || card.defId === 'silencer') {
      bonus += burnOk ? (strat === 'tempo' ? 1.7 : 1.25) : strat === 'tempo' ? -1.6 : -1.9
    } else if (card.defId === 'nyx_assassin' || card.defId === 'rubick') {
      bonus += burnOk ? 0.4 : -2.1
    } else {
      bonus += burnOk ? 0.55 : -1.35
    }
  } else if (instant && denial >= 5) {
    bonus += threat >= 4 || behind ? 0.45 : -0.55
  }

  if (kind === 'hero' && !trap) {
    bonus += 0.78
    if (teamId !== 'new') bonus += 0.95
    else bonus -= 0.12
    if (afterHeroes > beforeHeroes) bonus += 0.4
    if (afterFilled > beforeFilled) bonus += 1.2
    // Tempo: multi-drop only when the destination is safe / filling.
    if (strat === 'tempo' && extras > 0) {
      const dest = teamId !== 'new' ? teamById(after, teamId)?.team : null
      bonus += dest && dest.heroes.length >= 3 ? 0.55 : -0.35
    }
  }
  if (kind === 'item') bonus += 0.45
  if (kind === 'rune' || kind === 'tower' || kind === 'neutral') bonus += 0.5

  if (strat === 'architect') {
    const beforeCombos = before.players[actor].combos.length
    const afterCombos = after.players[actor].combos.length
    if (afterCombos > beforeCombos) bonus += 0.85
    // Still remove when a foe has a filled team.
    if (enemyFilled(before, actor) >= 1 && (oppDelta > 0 || pressure > 0)) bonus += 0.9
  }
  if (strat === 'spite') {
    bonus += pressure * 0.45
    if (denial >= 5 && (threat >= 4 || behind)) bonus += 0.65
    // Don't spite-break own cores: punish plays that shrink our filled count.
    if (afterFilled < beforeFilled) bonus -= 2.4
  }
  if (strat === 'tempo' && kind === 'hero' && !trap) bonus += 0.22
  if (strat === 'balanced') {
    if (denial >= 7 && threat < 4 && !behind) bonus -= 0.4
    if (oppDelta >= 2 || pressure >= 1) bonus += 0.35
  }
  return bonus
}

function pressureDelta(before: Game, after: Game, actor: PlayerId): number {
  let delta = 0
  const beforeBoard = heroControllerMap(before)
  const afterBoard = heroControllerMap(after)
  const afterGrave = new Set(after.grave.map((card) => card.uid))
  const beforeGrave = new Set(before.grave.map((card) => card.uid))
  for (const [uid, controller] of beforeBoard) {
    if (!afterBoard.has(uid) && afterGrave.has(uid) && controller !== actor) delta += 1
    const next = afterBoard.get(uid)
    if (next != null && controller !== actor && next === actor) delta += 1.2
  }
  for (const player of before.players) {
    if (player.id === actor) continue
    for (const card of player.hand) {
      const still = after.players[player.id]?.hand.some((entry) => entry.uid === card.uid)
      if (!still && afterGrave.has(card.uid) && !beforeGrave.has(card.uid)) delta += 0.5
    }
  }
  return delta
}

function heroControllerMap(state: Game): Map<string, PlayerId> {
  const map = new Map<string, PlayerId>()
  for (const player of state.players) {
    for (const team of player.teams) {
      for (const hero of team.heroes) map.set(hero.uid, hero.controller)
    }
  }
  return map
}

function enemyFilled(state: Game, actor: PlayerId): number {
  let n = 0
  for (const player of state.players) {
    if (player.id === actor) continue
    n += player.teams.filter((team) => team.heroes.length >= 3).length
  }
  return n
}

function evaluate(state: Game, actor: PlayerId, strat: AiStrat): number {
  if (state.over) {
    const mine = state.over.scores[actor] ?? 0
    const foe = state.over.scores[preferredFoeFromScores(state.over.scores, actor)] ?? 0
    const win = mine > foe ? 80 : mine === foe ? 20 : -40
    return win + mine * 4.2 + (mine - foe) * 3
  }

  const mine = scoreState(state, actor).total
  const foeSeat = threatFocus(state, actor, strat)
  const foe = scoreState(state, foeSeat).total
  const hand = state.players[actor].hand
  const terrains = hand.filter((card) => card.kind === 'terrain').length
  const instants = hand.filter((card) => display(card.defId).instant).length
  const denial = hand.filter((card) => (INTERRUPT_VALUE[card.defId] ?? 0) >= 7).length
  const traps = hand.filter((card) => isTrapHero(card.defId)).length
  const teams = state.players[actor].teams
  const heroes = teams.reduce((sum, team) => sum + team.heroes.length, 0)
  const filled = teams.filter((team) => team.heroes.length >= 3).length
  const nearly = teams.filter((team) => team.heroes.length === 2).length
  const comboPts = state.players[actor].combos.reduce((sum, combo) => sum + combo.points, 0)
  const boardShape = teams.reduce((sum, team) => sum + scoreTeam(state, team).points, 0)
  const enemyTraps = state.players.reduce((sum, player) => {
    if (player.id === actor) return sum
    return sum + player.teams.filter((team) => team.trap?.owner === actor).length
  }, 0)
  const foeFilled = enemyFilled(state, actor)
  const actions = state.players[actor].actions
  const behind = mine + 3 < foe
  const threat = threatScore(state, actor)

  // Shared chassis with clearer personality gaps so flavors stay competitive and distinct.
  let score =
    mine * 1.62 -
    foe * 1.15 +
    boardShape * 0.42 +
    filled * 1.15 +
    nearly * 0.5 +
    comboPts * 0.78 +
    terrains * 0.42 +
    instants * 0.38 +
    denial * 0.55 +
    traps * 0.4 +
    enemyTraps * 0.95 +
    hand.length * 0.12 +
    heroes * 0.36 +
    actions * 0.22 -
    foeFilled * 0.55

  if (strat === 'tempo') {
    score += heroes * 0.12 + actions * 0.1 + nearly * 0.15
    score -= denial * 0.15
    if (threat >= 6) score += denial * 0.35
  }
  if (strat === 'architect') {
    score += filled * 0.22 + terrains * 0.18 + comboPts * 0.2 + nearly * 0.12
    if (foeFilled >= 1) score += 0.8
  }
  if (strat === 'spite') {
    score += traps * 0.28 + enemyTraps * 0.35 + (behind ? 1.1 : 0) - foe * 0.12
    score += foeFilled * 0.4 + threat * 0.08
  }
  if (strat === 'balanced') {
    score += denial * 0.25 + (behind ? 0.4 : 0)
    if (!behind) score += denial * 0.2
  }
  return score
}

/** Legal team destinations; fast sims keep at most two (fill-first, then new). */
function pickTeamOptions(
  state: Game,
  uid: string,
  defId: string,
  kind: CardInst['kind'],
  fast: boolean,
): { id: string; ok: boolean; label: string; reason: string | undefined }[] {
  if (!needsTeam(defId, kind)) return [{ id: '', ok: true, label: '', reason: undefined }]
  const all = teamsFor(state, uid).filter((team) => team.ok)
  if (!fast || all.length <= 2) return all
  const ranked = [...all].sort((a, b) => {
    const teamA = a.id !== 'new' ? teamById(state, a.id)?.team : null
    const teamB = b.id !== 'new' ? teamById(state, b.id)?.team : null
    const fillA = teamA ? teamA.heroes.length : -1
    const fillB = teamB ? teamB.heroes.length : -1
    // Prefer nearly-full / existing teams over brand new seats.
    return fillB - fillA
  })
  return ranked.slice(0, 2)
}

/** Rank silent companions by how well they fit the destination team. */
function rankMates(state: Game, actor: PlayerId, activeUid: string, teamId: string, heroUids: string[]): string[] {
  const active = state.players[actor]?.hand.find((card) => card.uid === activeUid)
  const activeAttr = active ? HERO_BY_ID[active.defId]?.attr : undefined
  const team = teamId !== 'new' && teamId !== '' ? teamById(state, teamId)?.team : null
  const scored = heroUids
    .filter((uid) => uid !== activeUid)
    .map((uid) => {
      const card = state.players[actor]?.hand.find((entry) => entry.uid === uid)
      if (!card) return { uid, fit: -1 }
      const attr = HERO_BY_ID[card.defId]?.attr
      let fit = 0
      if (attr && activeAttr && attr === activeAttr) fit += 3
      if (team && attr) {
        const same = team.heroes.filter((hero) => HERO_BY_ID[hero.defId]?.attr === attr).length
        fit += same * 2
      }
      if (team && team.heroes.length >= 2 && team.heroes.length < 5) fit += 1.5
      if (isTrapHero(card.defId)) fit -= 4
      return { uid, fit }
    })
    .sort((a, b) => b.fit - a.fit)
  return scored.map((entry) => entry.uid)
}

function rivalPts(state: Game, actor: PlayerId): number {
  return scoreState(state, preferredFoe(state, actor)).total
}

function beforeOppDelta(before: Game, after: Game, actor: PlayerId): number {
  return rivalPts(before, actor) - rivalPts(after, actor)
}

function moved(before: Game, after: Game): boolean {
  if (after.over || after.active !== before.active) return true
  if (after.deck.length !== before.deck.length) return true
  if (after.turn !== before.turn) return true
  if (!!after.pending !== !!before.pending) return true
  return before.players.some((player, index) => {
    const next = after.players[index]
    return (
      !next ||
      next.actions !== player.actions ||
      next.hand.length !== player.hand.length ||
      next.teams.length !== player.teams.length ||
      next.combos.length !== player.combos.length ||
      next.teams.some((team, teamIndex) => team.trap?.uid !== player.teams[teamIndex]?.trap?.uid)
    )
  })
}
