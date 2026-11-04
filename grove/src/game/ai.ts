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
  { id: 'balanced', label: 'Balanced', blurb: 'Scores first: core combos, multi-drops, traps, and Instant interrupts.' },
  { id: 'tempo', label: 'Tempo', blurb: 'Floods heroes fast, spends every action, and cuts turns with Chronosphere / Silence.' },
  { id: 'architect', label: 'Architect', blurb: 'Fills teams and terrain paths before cashing denial — patient but still spends actions.' },
  { id: 'spite', label: 'Spite', blurb: 'Scores while hunting the seat ahead with traps, counters, and removal.' },
]

export const DEFAULT_STRAT: AiStrat = 'balanced'

/** Instant / counter cards worth firing into an interrupt window. */
const INTERRUPT_VALUE: Record<string, number> = {
  nyx_assassin: 12,
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

export function chooseAiAction(state: Game): Action {
  if (state.veil) return { type: 'ready' }
  if (state.over) return { type: 'end' }
  if (state.pending) return { type: 'choose', ids: chooseAiPending(state) }

  const actor = state.active
  const strat = state.players[actor]?.strat ?? DEFAULT_STRAT
  const plans = comboPlans(state)
  const core = plans.find((plan) => plan.detail.startsWith('core'))
  const mixed = plans.find((plan) => plan.detail.startsWith('mixed'))

  // Free terrain combos first. Prefer core (reward + same points). Never play a lone terrain.
  if (core) return { type: 'combo', uids: core.uids }
  if (mixed) return { type: 'combo', uids: mixed.uids }

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
    const hand = state.players[actor].hand
    const discards = hand.slice(0, 2).map((card) => card.uid)
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

  // Ember Spirit repositioning is free value.
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

  // Death Prophet: play the top of the grave (free Exorcism).
  const graveTop = playableFromGrave(state, actor)
  if (graveTop && graveTop.kind !== 'terrain') {
    const teams = needsTeam(graveTop.defId, graveTop.kind)
      ? teamsFor(state, graveTop.uid).filter((team) => team.ok)
      : [{ id: '', ok: true, label: '', reason: undefined }]
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
  }

  for (const card of hand) {
    if (card.kind === 'terrain') continue
    if (seen.has(card.defId)) continue
    seen.add(card.defId)
    const instant = display(card.defId).instant
    if (!instant && state.players[actor].actions < 1) continue
    const teams = needsTeam(card.defId, card.kind)
      ? teamsFor(state, card.uid).filter((team) => team.ok)
      : [{ id: '', ok: true, label: '', reason: undefined }]
    for (const team of teams) {
      const packs: (string[] | undefined)[] = [undefined]
      if (card.kind === 'hero' && !isTrapHero(card.defId)) {
        const mates = rankMates(state, actor, card.uid, team.id, heroUids)
        // Prefer stuffing the board without exploding the search tree.
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

/** Smart answers for pending prompts (also used by engine settle for AI / autoAll). */
export function chooseAiPending(state: Game): string[] {
  const pending = state.pending
  if (!pending) return []
  const actor = pending.actor
  const strat = state.players[actor]?.strat ?? DEFAULT_STRAT
  const focus = preferredFoe(state, actor)
  const scores = state.players.map((player) => scoreState(state, player.id).total)

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
  let bestValue = strat === 'architect' ? 4.2 : 4.0
  const focus = preferredFoe(state, actor)
  const scores = state.players.map((player) => scoreState(state, player.id).total)
  const behind = (scores[actor] ?? 0) + 2 < (scores[focus] ?? 0)
  for (const id of choiceIds) {
    if (id === 'pass') continue
    const uid = id.startsWith('instant:') ? id.slice(8) : id
    const card = state.players[actor]?.hand.find((entry) => entry.uid === uid)
    if (!card) continue
    let value = INTERRUPT_VALUE[card.defId] ?? (display(card.defId).instant ? 3 : 0)
    if (strat === 'spite') value += 1.6
    if (strat === 'tempo' && (card.defId === 'faceless_void' || card.defId === 'silencer')) value += 2.2
    if (behind) value += 0.8
    if (value > bestValue) {
      bestValue = value
      best = id
    }
  }
  return best
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

  if (owner === actor) {
    if (!friendly) return -8
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
  if (owner === focus) weight += 120 + (scores[owner] ?? 0)
  else if (owner !== null) weight += 40 + (scores[owner] ?? 0)

  if (choiceId.startsWith('hero:')) {
    const loc = findHero(state, choiceId.slice(5))
    if (loc) {
      const pts = scoreTeam(state, loc.team).points
      weight += pts * 0.45
      if (['enigma', 'tidehunter', 'medusa', 'axe', 'troll_warlord', 'doom', 'razor', 'morphling', 'puck'].includes(loc.hero.defId)) {
        weight += 10
      }
      if (firesAbilityTarget(loc.hero.defId)) weight += 4
    }
  }
  if (choiceId.startsWith('team:')) {
    const found = teamById(state, choiceId.slice(5))
    if (found) weight += scoreTeam(state, found.team).points * 0.55
  }
  if (choiceId.startsWith('attr:')) {
    const attr = choiceId.slice(5)
    let count = 0
    for (const loc of allLocs(state)) {
      if (loc.hero.controller === focus && HERO_BY_ID[loc.hero.defId]?.attr === attr) count += 1
    }
    weight += count * 6
  }
  if (choiceId.startsWith('mode:immune') || choiceId === 'yes') {
    if (friendly || /immune|fire that ability|play it|for free/i.test(prompt)) weight += 80
  }
  if (strat === 'spite') weight *= 1.18
  if (strat === 'architect' && friendly) weight *= 1.12
  if (strat === 'architect' && !friendly) weight *= 1.06
  if (strat === 'tempo' && /lose their|discard|destroy|exile/i.test(prompt)) weight *= 1.12
  return weight
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
  // Keep spending actions — ending with spare actions is how seats fall behind.
  if (strat === 'tempo') return -2.15
  if (strat === 'architect') return -1.9
  if (strat === 'spite') return -1.95
  return -2.0
}

function drawBias(state: Game, actor: PlayerId, strat: AiStrat): number {
  const hand = state.players[actor].hand
  const playable = hand.filter((card) => card.kind !== 'terrain').length
  const terrains = hand.filter((card) => card.kind === 'terrain').length
  const base =
    0.5 +
    (playable <= 1 ? 0.65 : 0) +
    (terrains >= 2 ? 0.3 : 0) +
    (hand.length <= 3 ? 0.28 : 0) +
    (hand.length >= 6 && playable >= 2 ? -0.45 : 0)
  if (strat === 'tempo') return playable === 0 ? 1.35 : base - (playable >= 3 ? 0.2 : 0)
  if (strat === 'architect') return base + (terrains >= 2 ? 0.2 : 0) - (playable >= 3 ? 0.15 : 0)
  if (strat === 'spite') return playable === 0 ? 1.15 : base
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

  let bonus = ptsGain * 0.78
  bonus += extras * 0.48
  bonus += beforeOppDelta(before, after, actor) * 0.24

  const timing = HERO_BY_ID[card.defId]?.timing
  if ((timing === 'cast' || timing === 'instant') && !trap) {
    bonus += 0.55 + Math.max(0, ptsGain) * 0.22
  }

  if (trap && trapOnEnemy) {
    bonus += strat === 'spite' ? 1.95 : 1.55
  } else if (trap) {
    bonus += strat === 'spite' ? 0.45 : 0.3
  }

  if (instant && denial >= 6) {
    if (card.defId === 'faceless_void' || card.defId === 'silencer') {
      bonus += strat === 'tempo' ? 1.4 : 1.15
    } else if (card.defId === 'nyx_assassin') {
      bonus -= 0.75 // keep for counters
    } else {
      bonus += 0.35
    }
  }

  if (kind === 'hero' && !trap) {
    bonus += 0.78
    if (teamId !== 'new') bonus += 0.92
    else bonus -= 0.12
    if (afterHeroes > beforeHeroes) bonus += 0.4
    if (afterFilled > beforeFilled) bonus += 1.12
  }
  if (kind === 'item') bonus += 0.45
  if (kind === 'rune' || kind === 'tower' || kind === 'neutral') bonus += 0.5

  if (strat === 'architect') {
    const beforeCombos = before.players[actor].combos.length
    const afterCombos = after.players[actor].combos.length
    if (afterCombos > beforeCombos) bonus += 0.65
  }
  if (strat === 'spite' && denial >= 5) bonus += 0.5
  if (strat === 'tempo' && kind === 'hero' && !trap) bonus += 0.18
  return bonus
}

function evaluate(state: Game, actor: PlayerId, strat: AiStrat): number {
  if (state.over) {
    const mine = state.over.scores[actor] ?? 0
    const foe = state.over.scores[preferredFoeFromScores(state.over.scores, actor)] ?? 0
    const win = mine > foe ? 80 : mine === foe ? 20 : -40
    return win + mine * 4.2 + (mine - foe) * 3
  }

  const mine = scoreState(state, actor).total
  const foe = rivalPts(state, actor)
  const hand = state.players[actor].hand
  const terrains = hand.filter((card) => card.kind === 'terrain').length
  const instants = hand.filter((card) => display(card.defId).instant).length
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
  const actions = state.players[actor].actions
  const behind = mine + 3 < foe

  // Shared chassis; tiny personality tilts so flavors stay distinct without runaway win rates.
  let score =
    mine * 1.55 -
    foe * 1.08 +
    boardShape * 0.4 +
    filled * 1.08 +
    nearly * 0.45 +
    comboPts * 0.72 +
    terrains * 0.4 +
    instants * 0.32 +
    traps * 0.35 +
    enemyTraps * 0.85 +
    hand.length * 0.12 +
    heroes * 0.34 +
    actions * 0.2
  if (strat === 'tempo') score += heroes * 0.05 + actions * 0.04
  if (strat === 'architect') score += filled * 0.04 + terrains * 0.03
  if (strat === 'spite') score += traps * 0.1 + enemyTraps * 0.12 + (behind ? 0.55 : 0) - foe * 0.05
  return score
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
