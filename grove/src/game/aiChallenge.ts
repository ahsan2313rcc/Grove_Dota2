/**
 * Challenge AI — strongest heuristic brain.
 *
 * Plans a short turn line with beam search (not single greedy clicks),
 * uses a sharper eval (answers, board shape, threat), and searches
 * important pending picks instead of keyword heuristics alone.
 */
import { display, HERO_BY_ID } from './catalog.ts'
import { apply, comboPlans, emberMoves, morphCasts, needsTeam, playableFromGrave, teamsFor, undyingRevive } from './engine.ts'
import {
  findHero,
  isTrapHero,
  preferredFoe,
  preferredFoeFromScores,
  scoreState,
  scoreTeam,
  teamById,
} from './flow.ts'
import { aiSearchBudget } from './aiPower.ts'
import type { Action, AiStrat, CardInst, Game, PlayerId } from './types.ts'

const DEFAULT_STRAT: AiStrat = 'balanced'

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

type BeamNode = {
  state: Game
  first: Action | null
  score: number
  steps: number
}

export function chooseAiActionChallenge(state: Game, actor: PlayerId, strat: AiStrat): Action {
  const budget = aiSearchBudget()
  const plans = comboPlans(state)
  const core = plans.find((plan) => plan.detail.startsWith('core'))
  const mixed = plans.find((plan) => plan.detail.startsWith('mixed'))
  if (core) return { type: 'combo', uids: core.uids }
  if (mixed) return { type: 'combo', uids: mixed.uids }

  const rootScore = evaluateChallenge(state, actor, strat)
  let beam: BeamNode[] = [{ state, first: null, score: rootScore, steps: 0 }]
  let bestFirst: Action = { type: 'end' }
  let bestScore = rootScore + endBiasChallenge(state, actor, strat)

  for (let depth = 0; depth < budget.depth; depth += 1) {
    const nextBeam: BeamNode[] = []
    for (const node of beam) {
      if (node.state.over || node.state.active !== actor || node.state.veil) {
        nextBeam.push(node)
        continue
      }
      // Settle pending with deep picker before expanding.
      let cursor = node.state
      let guard = 0
      while (cursor.pending && guard < 6) {
        guard += 1
        const ids = chooseAiPendingChallenge(cursor)
        const settled = apply({ ...cursor, autoAll: true }, { type: 'choose', ids })
        if (settled === cursor) break
        cursor = settled
      }
      if (cursor.over || cursor.active !== actor || cursor.veil) {
        const leaf = evaluateChallenge(cursor, actor, strat)
        nextBeam.push({ ...node, state: cursor, score: leaf })
        if (leaf > bestScore && node.first) {
          bestScore = leaf
          bestFirst = node.first
        }
        continue
      }

      const actions = challengeCandidates(cursor, actor, strat)
      for (const action of actions) {
        const after = apply({ ...cursor, autoAll: true }, action)
        if (!moved(cursor, after) && action.type !== 'end') continue
        const score = evaluateChallenge(after, actor, strat) + lineBonus(cursor, after, actor, strat, action)
        const first = node.first ?? action
        const done =
          action.type === 'end'
          || after.over
          || after.active !== actor
          || after.veil
          || node.steps + 1 >= budget.depth
        const child: BeamNode = { state: after, first, score, steps: node.steps + 1 }
        nextBeam.push(child)
        if (score > bestScore) {
          bestScore = score
          bestFirst = first
        }
        if (done && score > bestScore) {
          bestScore = score
          bestFirst = first
        }
      }
    }
    nextBeam.sort((a, b) => b.score - a.score)
    beam = nextBeam.slice(0, budget.beam)
    if (beam.length === 0) break
  }

  if (bestFirst.type === 'end' && state.players[actor].actions > 0) {
    const uid = stuckDiscard(state, actor)
    if (uid) return { type: 'discard', uid }
  }
  return bestFirst
}

/** Pending picker with light 1-ply search over top-weighted choices. */
export function chooseAiPendingChallenge(state: Game): string[] {
  const pending = state.pending
  if (!pending) return []
  const actor = pending.actor
  const strat = state.players[actor]?.strat ?? DEFAULT_STRAT

  if (pending.choices.length <= 1) {
    return pending.choices[0] ? [pending.choices[0].id] : []
  }

  const ids = pending.choices.map((choice) => choice.id)
  const tryIds = ids.slice(0, aiSearchBudget().pendingTry)
  let best: string[] = ids.slice(0, Math.max(pending.min, 1))
  let bestScore = -Infinity
  for (const id of tryIds) {
    if (id === 'pass' && pending.min > 0) continue
    const pick = [id]
    const next = apply({ ...state, autoAll: true }, { type: 'choose', ids: pick })
    const score = evaluateChallenge(next, actor, strat)
    if (score > bestScore) {
      bestScore = score
      best = pick
    }
  }
  if (pending.choices.some((choice) => choice.id === 'pass') && pending.min === 0) {
    const next = apply({ ...state, autoAll: true }, { type: 'choose', ids: ['pass'] })
    const score = evaluateChallenge(next, actor, strat)
    if (score > bestScore) return ['pass']
  }
  return best.length >= pending.min ? best : ids.slice(0, pending.min)
}

function challengeCandidates(state: Game, actor: PlayerId, strat: AiStrat): Action[] {
  const out: Action[] = []
  const hand = state.players[actor].hand
  const heroUids = hand.filter((card) => card.kind === 'hero' && !isTrapHero(card.defId)).map((card) => card.uid)

  for (const cast of morphCasts(state).slice(0, 2)) {
    out.push({ type: 'morph', uid: cast.uid })
  }

  const undying = undyingRevive(state)
  if (undying.ok) {
    const discards = pickDiscards(state, actor)
    if (discards.length >= 2) out.push({ type: 'undying', team: 'new', discards })
  }

  for (const ember of emberMoves(state).slice(0, 2)) {
    const dest = emberTargets(state, ember.uid)[0]
    if (dest) out.push({ type: 'move', uid: ember.uid, team: dest })
  }

  const graveTop = playableFromGrave(state, actor)
  if (graveTop?.kind === 'terrain') {
    for (const plan of comboPlans(state)) {
      if (plan.uids.includes(graveTop.uid)) out.push({ type: 'combo', uids: plan.uids })
    }
  } else if (graveTop && graveTop.kind !== 'terrain') {
    for (const team of pickTeams(state, graveTop.uid, graveTop.defId, graveTop.kind).slice(0, 2)) {
      out.push({ type: 'play', uid: graveTop.uid, team: team.id })
    }
  }

  const budget = aiSearchBudget()
  const ranked = rankHand(state, actor, hand, strat)
  for (const card of ranked.slice(0, budget.handPly)) {
    const teams = pickTeams(state, card.uid, card.defId, card.kind).slice(0, budget.teamOpts)
    for (const team of teams) {
      out.push({ type: 'play', uid: card.uid, team: team.id })
      if (card.kind === 'hero' && !isTrapHero(card.defId)) {
        const mate = rankMates(state, actor, card.uid, team.id, heroUids)[0]
        if (mate) out.push({ type: 'play', uid: card.uid, team: team.id, extras: [mate] })
      }
    }
    if (!needsTeam(card.defId, card.kind)) {
      out.push({ type: 'play', uid: card.uid, team: '' })
    }
  }

  if (state.players[actor].actions > 0 && state.deck.length > 0) out.push({ type: 'draw' })
  out.push({ type: 'end' })
  return out
}

function lineBonus(before: Game, after: Game, actor: PlayerId, strat: AiStrat, action: Action): number {
  if (action.type === 'end') return endBiasChallenge(before, actor, strat)
  if (action.type === 'draw') return drawBiasChallenge(before, actor, strat)
  if (action.type !== 'play') return 0.15
  const card = before.players[actor]?.hand.find((entry) => entry.uid === action.uid)
  if (!card) return 0
  return playBiasChallenge(before, after, actor, strat, card, action.team, action.extras?.length ?? 0)
}

export function evaluateChallenge(state: Game, actor: PlayerId, strat: AiStrat): number {
  if (state.over) {
    const mine = state.over.scores[actor] ?? 0
    const foe = state.over.scores[preferredFoeFromScores(state.over.scores, actor)] ?? 0
    const win = mine > foe ? 120 : mine === foe ? 25 : -80
    return win + (mine - foe) * 4.5 + mine * 2.2
  }

  const mine = scoreState(state, actor).total
  const foeSeat = preferredFoe(state, actor)
  const foe = scoreState(state, foeSeat).total
  const lead = mine - foe
  const hand = state.players[actor].hand
  const teams = state.players[actor].teams
  const heroes = teams.reduce((sum, team) => sum + team.heroes.length, 0)
  const filled = teams.filter((team) => team.heroes.length >= 3).length
  const nearly = teams.filter((team) => team.heroes.length === 2).length
  const open = teams.filter((team) => team.heroes.length === 1).length
  const comboPts = state.players[actor].combos.reduce((sum, combo) => sum + combo.points, 0)
  const boardShape = teams.reduce((sum, team) => sum + scoreTeam(state, team).points, 0)
  const denial = hand.filter((card) => (INTERRUPT_VALUE[card.defId] ?? 0) >= 7).length
  const softDenial = hand.filter((card) => {
    const v = INTERRUPT_VALUE[card.defId] ?? 0
    return v >= 5 && v < 7
  }).length
  const traps = hand.filter((card) => isTrapHero(card.defId)).length
  const terrains = hand.filter((card) => card.kind === 'terrain').length
  const foeFilled = enemyFilled(state, actor)
  const foeHeroes = enemyHeroes(state, actor)
  const enemyTraps = state.players.reduce((sum, player) => {
    if (player.id === actor) return sum
    return sum + player.teams.filter((team) => team.trap?.owner === actor).length
  }, 0)
  const threat = threatScoreChallenge(state, actor)
  const actions = state.players[actor].actions
  const behind = lead <= -3

  let score =
    mine * 1.35 -
    foe * 1.25 +
    lead * 0.85 +
    boardShape * 0.55 +
    filled * 1.55 +
    nearly * 0.85 +
    open * 0.15 +
    comboPts * 0.9 +
    heroes * 0.28 +
    terrains * 0.35 +
    traps * 0.45 +
    enemyTraps * 1.15 +
    softDenial * 0.25 +
    hand.length * 0.08 +
    actions * 0.18 -
    foeFilled * 1.1 -
    foeHeroes * 0.08

  const foeNearly = enemyNearly(state, actor)

  // Answer retention: premium denial is latent value unless board is on fire.
  if (state.ancient) score += denial * 0.15
  else if (threat < 5 && foeNearly === 0) score += denial * 1.6
  else if (threat < 7) score += denial * 0.7
  else score += denial * 0.25
  // Prefer keeping the match competitive — punish huge leads less than collapses.
  if (lead < -12) score -= 2.5
  if (lead > 25) score -= 0.8

  // Don't love empty-handed boards when behind.
  if (behind) score += heroes * 0.2 + traps * 0.35 + (denial > 0 ? 0.4 : -0.3)

  if (strat === 'tempo') {
    score += heroes * 0.2 + nearly * 0.2 + actions * 0.12
    if (threat < 5 && foeNearly === 0) score -= denial * 0.15
    if (foeNearly >= 1) score += 0.7
  }
  if (strat === 'architect') {
    score += filled * 0.35 + comboPts * 0.25 + terrains * 0.15 + nearly * 0.2
    if (foeFilled >= 1) score += 1.7
    if (foeNearly >= 1) score += 1.0
    if (behind) score += 0.8
  }
  if (strat === 'spite') {
    score += traps * 0.45 + enemyTraps * 0.5 + foeFilled * 0.7 + foeNearly * 0.4 + threat * 0.12
    score -= foe * 0.15
    if (behind) score += 1.4
  }
  if (strat === 'balanced') {
    score += denial * 0.3
    if (behind) score += 0.75
    if (!behind && threat < 4 && foeNearly === 0) score += denial * 0.2
    if (foeNearly >= 1 || foeFilled >= 1) score += 1.0
  }
  if (state.ancient) {
    score += lead * 1.6 + mine * 0.4
    score -= denial * 0.5
  }
  return score
}

function playBiasChallenge(
  before: Game,
  after: Game,
  actor: PlayerId,
  strat: AiStrat,
  card: CardInst,
  teamId: string,
  extras: number,
): number {
  const beforePts = scoreState(before, actor).total
  const afterPts = scoreState(after, actor).total
  const ptsGain = afterPts - beforePts
  const beforeFilled = before.players[actor].teams.filter((team) => team.heroes.length >= 3).length
  const afterFilled = after.players[actor].teams.filter((team) => team.heroes.length >= 3).length
  const denial = INTERRUPT_VALUE[card.defId] ?? 0
  const threat = threatScoreChallenge(before, actor)
  const behind = beforePts + 3 < scoreState(before, preferredFoe(before, actor)).total
  const trap = isTrapHero(card.defId)
  const foeLoss =
    scoreState(before, preferredFoe(before, actor)).total - scoreState(after, preferredFoe(after, actor)).total

  let bonus = ptsGain * 1.05 + foeLoss * 0.7 + extras * 0.4

  if (trap) {
    const dest = teamId !== 'new' && teamId !== '' ? teamById(after, teamId) : null
    bonus += dest && dest.player.id !== actor ? (strat === 'spite' ? 2.4 : 1.8) : 0.2
  }

  if (card.kind === 'hero' && !trap) {
    bonus += 0.85
    if (teamId !== 'new') bonus += 1.05
    if (afterFilled > beforeFilled) bonus += 1.4
  }

  const hotBoard =
    threat >= 5.5 || behind || foeLoss >= 2 || ptsGain >= 4 || enemyNearly(before, actor) >= 1 || !!before.ancient

  // Strong hold on premium answers — loosen when foe is about to fill or Ancient is live.
  if (display(card.defId).instant && denial >= 7) {
    bonus += hotBoard ? 0.95 : -2.4
  } else if (display(card.defId).instant && denial >= 5) {
    bonus += hotBoard || threat >= 4.5 ? 0.45 : -0.85
  }

  if (strat === 'architect' && after.players[actor].combos.length > before.players[actor].combos.length) {
    bonus += 1
  }
  if (strat === 'architect' && foeLoss > 0) bonus += 0.55
  if (strat === 'spite' && afterFilled < beforeFilled) bonus -= 2.8
  if (strat === 'tempo' && card.kind === 'hero' && !trap) bonus += 0.3
  if (before.ancient) bonus += ptsGain * 0.6 + foeLoss * 0.4
  return bonus
}

function endBiasChallenge(state: Game, actor: PlayerId, strat: AiStrat): number {
  const actions = state.players[actor].actions
  if (actions < 1) return 0.4
  const denial = state.players[actor].hand.filter((card) => (INTERRUPT_VALUE[card.defId] ?? 0) >= 6).length
  const threat = threatScoreChallenge(state, actor)
  let bias = -1.8
  if (denial >= 1 && threat < 4.5 && !state.ancient && enemyNearly(state, actor) === 0) bias += 0.9
  if (threat >= 7 && denial === 0) bias -= 0.5
  if (strat === 'tempo') bias -= 0.25
  // Architect: spend more, bank less — was the softest vs Neural.
  if (strat === 'architect') bias -= 0.35
  if (state.ancient) bias -= 0.9
  return bias
}

function drawBiasChallenge(state: Game, actor: PlayerId, strat: AiStrat): number {
  const hand = state.players[actor].hand
  const playable = hand.filter((card) => card.kind !== 'terrain').length
  const terrains = hand.filter((card) => card.kind === 'terrain').length
  let bias = playable === 0 ? 1.5 : playable <= 1 ? 0.7 : -0.15
  if (terrains >= 2) bias += 0.25
  if (hand.length >= 6) bias -= 0.45
  if (strat === 'architect' && terrains >= 2) bias += 0.2
  return bias
}

function rankHand(state: Game, actor: PlayerId, hand: CardInst[], strat: AiStrat): CardInst[] {
  const threat = threatScoreChallenge(state, actor)
  const behind = scoreState(state, actor).total + 3 < scoreState(state, preferredFoe(state, actor)).total
  const actions = state.players[actor].actions
  const seen = new Set<string>()
  const ranked: { card: CardInst; rank: number }[] = []
  for (const card of hand) {
    if (card.kind === 'terrain') continue
    if (seen.has(card.defId)) continue
    seen.add(card.defId)
    const instant = display(card.defId).instant
    if (!instant && actions < 1) continue
    const denial = INTERRUPT_VALUE[card.defId] ?? 0
    let rank = 0
    if (isTrapHero(card.defId)) rank += strat === 'spite' ? 3.2 : 2.4
    else if (card.kind === 'hero') rank += 4.2 + (HERO_BY_ID[card.defId]?.timing === 'cast' ? 1.4 : 0.5)
    else if (card.kind === 'item') rank += 3.1
    else rank += 2.3
    if (denial >= 7) rank += threat >= 5.5 || behind ? 3.2 : -3.5
    else if (denial >= 5) rank += threat >= 4 || behind ? 1.1 : -0.8
    ranked.push({ card, rank })
  }
  ranked.sort((a, b) => b.rank - a.rank)
  return ranked.map((entry) => entry.card)
}

function pickTeams(state: Game, uid: string, defId: string, kind: CardInst['kind']) {
  if (!needsTeam(defId, kind)) return [{ id: '', ok: true }]
  const all = teamsFor(state, uid).filter((team) => team.ok)
  return [...all].sort((a, b) => {
    const teamA = a.id !== 'new' ? teamById(state, a.id)?.team : null
    const teamB = b.id !== 'new' ? teamById(state, b.id)?.team : null
    return (teamB?.heroes.length ?? -1) - (teamA?.heroes.length ?? -1)
  })
}

function rankMates(state: Game, actor: PlayerId, activeUid: string, teamId: string, heroUids: string[]): string[] {
  const active = state.players[actor]?.hand.find((card) => card.uid === activeUid)
  const activeAttr = active ? HERO_BY_ID[active.defId]?.attr : undefined
  const team = teamId !== 'new' && teamId !== '' ? teamById(state, teamId)?.team : null
  return heroUids
    .filter((uid) => uid !== activeUid)
    .map((uid) => {
      const card = state.players[actor]?.hand.find((entry) => entry.uid === uid)
      if (!card) return { uid, fit: -1 }
      const attr = HERO_BY_ID[card.defId]?.attr
      let fit = 0
      if (attr && activeAttr && attr === activeAttr) fit += 3
      if (team && attr) fit += team.heroes.filter((hero) => HERO_BY_ID[hero.defId]?.attr === attr).length * 2
      if (team && team.heroes.length >= 2 && team.heroes.length < 5) fit += 1.5
      if (isTrapHero(card.defId)) fit -= 4
      return { uid, fit }
    })
    .sort((a, b) => b.fit - a.fit)
    .map((entry) => entry.uid)
}

function pickDiscards(state: Game, actor: PlayerId): string[] {
  return state.players[actor].hand
    .filter((card) => card.kind === 'terrain' || (INTERRUPT_VALUE[card.defId] ?? 0) < 5)
    .slice(0, 2)
    .map((card) => card.uid)
}

function emberTargets(state: Game, uid: string): string[] {
  const loc = findHero(state, uid)
  if (!loc) return []
  const actor = loc.hero.controller
  return state.players[actor].teams
    .filter((team) => team.id !== loc.team.id)
    .map((team) => team.id)
    .concat(state.players[actor].teams.length < 12 ? ['new'] : [])
}

function stuckDiscard(state: Game, actor: PlayerId): string | null {
  const hand = state.players[actor].hand
  const terrain = hand.find((card) => card.kind === 'terrain')
  if (terrain) return terrain.uid
  return hand[0]?.uid ?? null
}

function enemyFilled(state: Game, actor: PlayerId): number {
  let n = 0
  for (const player of state.players) {
    if (player.id === actor) continue
    n += player.teams.filter((team) => team.heroes.length >= 3).length
  }
  return n
}

function enemyNearly(state: Game, actor: PlayerId): number {
  let n = 0
  for (const player of state.players) {
    if (player.id === actor) continue
    n += player.teams.filter((team) => team.heroes.length === 2).length
  }
  return n
}

function enemyHeroes(state: Game, actor: PlayerId): number {
  let n = 0
  for (const player of state.players) {
    if (player.id === actor) continue
    n += player.teams.reduce((sum, team) => sum + team.heroes.length, 0)
  }
  return n
}

function threatScoreChallenge(state: Game, actor: PlayerId): number {
  let threat = 0
  for (const player of state.players) {
    if (player.id === actor) continue
    for (const team of player.teams) {
      const pts = scoreTeam(state, team).points
      if (team.heroes.length >= 3) threat += 2.2 + pts * 0.15
      else if (team.heroes.length === 2) threat += 0.9
      for (const hero of team.heroes) {
        const timing = HERO_BY_ID[hero.defId]?.timing
        if (timing === 'cast' || timing === 'instant') threat += 0.55
      }
    }
  }
  return threat
}

function moved(before: Game, after: Game): boolean {
  if (after.over || after.active !== before.active) return true
  if (after.deck.length !== before.deck.length) return true
  if (after.turn !== before.turn) return true
  if (!!after.pending !== !!before.pending) return true
  return before.players.some((player, index) => {
    const next = after.players[index]
    return (
      !next
      || next.actions !== player.actions
      || next.hand.length !== player.hand.length
      || next.teams.length !== player.teams.length
      || next.combos.length !== player.combos.length
    )
  })
}
