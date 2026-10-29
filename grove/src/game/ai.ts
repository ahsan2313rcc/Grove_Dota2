import { display } from './catalog.ts'
import { apply, comboPlans, needsTeam, teamsFor } from './engine.ts'
import { scoreState, scoreTeam } from './flow.ts'
import type { Action, AiStrat, Game, PlayerId } from './types.ts'

export const AI_STRATS: { id: AiStrat; label: string; blurb: string }[] = [
  { id: 'balanced', label: 'Balanced', blurb: 'Banks free settings, joins teams, and finishes scoring boards.' },
  { id: 'tempo', label: 'Tempo', blurb: 'Banks free settings, then floods heroes onto the board; draws when stalled.' },
  { id: 'architect', label: 'Architect', blurb: 'Builds teams and setting paths before racing.' },
  { id: 'spite', label: 'Spite', blurb: 'Chases relative swings and denies the table.' },
]

export const DEFAULT_STRAT: AiStrat = 'balanced'

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
  if (state.pending || state.over) return { type: 'end' }
  const actor = state.active
  const strat = state.players[actor]?.strat ?? DEFAULT_STRAT
  const plans = comboPlans(state)
  const core = plans.find((plan) => plan.detail.startsWith('core'))
  const mixed = plans.find((plan) => plan.detail.startsWith('mixed'))

  // Free setting combos first for every personality. Never play a lone setting.
  if (mixed) return { type: 'combo', uids: mixed.uids }
  if (core) return { type: 'combo', uids: core.uids }

  let best: Action = { type: 'end' }
  let bestScore = evaluate(state, actor, strat) + endBias(state, actor, strat)
  const seen = new Set<string>()

  for (const card of state.players[actor].hand) {
    if (card.kind === 'setting') continue
    if (seen.has(card.defId)) continue
    seen.add(card.defId)
    const instant = display(card.defId).instant
    if (!instant && state.players[actor].actions < 1) continue
    const teams = needsTeam(card.defId, card.kind) ? teamsFor(state, card.uid).filter((team) => team.ok) : [{ id: 'new', ok: true }]
    for (const team of teams) {
      const action: Action = { type: 'play', uid: card.uid, team: team.id }
      const next = apply({ ...state, autoAll: true }, action)
      if (!moved(state, next)) continue
      let score = evaluate(next, actor, strat)
      score += playBias(state, next, actor, strat, card.kind, team.id)
      if (score > bestScore) {
        bestScore = score
        best = action
      }
    }
  }

  if (state.players[actor].actions > 0 && state.deck.length > 0 && state.players[actor].hand.length < state.players[actor].handLimit) {
    const next = apply({ ...state, autoAll: true }, { type: 'draw' })
    const score = evaluate(next, actor, strat) + drawBias(state, actor, strat)
    if (score > bestScore) best = { type: 'draw' }
  }

  // Softlock escape: hand full of lone settings / Poison-Nova-locked items — pitch one and dig.
  if (best.type === 'end' && state.players[actor].actions > 0) {
    const uid = stuckDiscardUid(state, actor)
    if (uid) return { type: 'discard', uid }
  }

  return best
}

function stuckDiscardUid(state: Game, actor: PlayerId): string | null {
  const hand = state.players[actor].hand
  if (hand.length === 0) return null
  const playable = hand.some((card) => {
    if (card.kind === 'setting') return false
    const teams = needsTeam(card.defId, card.kind) ? teamsFor(state, card.uid).filter((team) => team.ok) : [{ id: 'new', ok: true }]
    return teams.some((team) => {
      const next = apply({ ...state, autoAll: true }, { type: 'play', uid: card.uid, team: team.id })
      return moved(state, next)
    })
  })
  if (playable) return null
  // Only pitch when the hand is clogged (no room to draw) or the deck is empty.
  if (hand.length < state.players[actor].handLimit && state.deck.length > 0) return null

  // Combo plans already ran — leftover settings cannot be played alone.
  const setting = hand.find((card) => card.kind === 'setting')
  if (setting) return setting.uid
  const item = hand.find((card) => card.kind === 'item')
  if (item) return item.uid
  return hand[0]?.uid ?? null
}

function endBias(state: Game, actor: PlayerId, strat: AiStrat): number {
  const actions = state.players[actor].actions
  if (actions < 1) return 0
  // Stronger push to keep acting — balanced/tempo were ending too early and losing.
  if (strat === 'tempo') return -1.55
  if (strat === 'architect') return -0.35
  if (strat === 'spite') return -0.9
  return -1.45
}

function drawBias(state: Game, actor: PlayerId, strat: AiStrat): number {
  const hand = state.players[actor].hand
  const playable = hand.filter((card) => card.kind !== 'setting').length
  const settings = hand.filter((card) => card.kind === 'setting').length
  if (strat === 'tempo') {
    if (playable === 0) return 1.1
    if (hand.length <= 2) return 0.55
    if (hand.length >= 6 && playable >= 2) return -0.45
    if (playable >= 3) return -0.15
    return 0.2
  }
  if (strat === 'architect') return 0.85 + (hand.length < 5 ? 0.25 : 0)
  if (strat === 'spite') return 0.25
  // Balanced: dig when the hand is thin or settings are stacking toward a combo.
  return 0.7 + (playable <= 1 ? 0.45 : 0) + (settings >= 2 ? 0.25 : 0) + (hand.length <= 3 ? 0.2 : 0)
}

function playBias(before: Game, after: Game, actor: PlayerId, strat: AiStrat, kind: string, teamId: string): number {
  const beforeHeroes = before.players[actor].teams.reduce((sum, team) => sum + team.heroes.length, 0)
  const afterHeroes = after.players[actor].teams.reduce((sum, team) => sum + team.heroes.length, 0)
  const beforeFilled = before.players[actor].teams.filter((team) => team.heroes.length >= 3).length
  const afterFilled = after.players[actor].teams.filter((team) => team.heroes.length >= 3).length
  const beforePts = scoreState(before, actor).total
  const afterPts = scoreState(after, actor).total
  const ptsGain = afterPts - beforePts

  if (strat === 'tempo') {
    let bonus = ptsGain * 0.35
    if (kind === 'hero') {
      bonus += 0.95
      if (teamId !== 'new') bonus += 0.65
      if (afterHeroes > beforeHeroes) bonus += 0.45
      if (afterFilled > beforeFilled) bonus += 0.75
    }
    if (kind === 'item') bonus += 0.35
    return bonus
  }
  if (strat === 'architect') {
    const beforeTeams = before.players[actor].teams.length
    const afterTeams = after.players[actor].teams.length
    const beforeCombos = before.players[actor].combos.length
    const afterCombos = after.players[actor].combos.length
    let bonus = 0
    if (kind === 'hero') {
      bonus += 0.45
      if (teamId !== 'new') bonus += 0.55
      if (afterHeroes > beforeHeroes) bonus += 0.35
      if (afterTeams > beforeTeams) bonus += 0.15
    }
    if (afterCombos > beforeCombos) bonus += 1.1
    return bonus
  }
  if (strat === 'spite') {
    const beforeOpp = bestFoe(before, actor)
    const afterOpp = bestFoe(after, actor)
    return (beforeOpp - afterOpp) * 0.35 + ptsGain * 0.15
  }

  // Balanced: join and complete teams; reward real point swings.
  let bonus = ptsGain * 0.55
  if (kind === 'hero') {
    bonus += 0.55
    if (teamId !== 'new') bonus += 0.85
    if (afterFilled > beforeFilled) bonus += 0.95
    if (afterHeroes > beforeHeroes) bonus += 0.35
    if (teamId === 'new') bonus -= 0.25
  }
  if (kind === 'item') bonus += 0.3
  return bonus
}

function evaluate(state: Game, actor: PlayerId, strat: AiStrat): number {
  if (state.over) {
    const mine = state.over.scores[actor] ?? 0
    const foe = bestFoeScores(state.over.scores, actor)
    if (strat === 'spite') return (mine - foe) * 6
    if (strat === 'architect') return mine * 4 + (mine - foe) * 1.5
    if (strat === 'tempo') return mine * 4.2 + (mine - foe) * 2.4
    return mine * 4 + (mine - foe) * 2.8
  }

  const mine = scoreState(state, actor).total
  const foe = bestFoe(state, actor)
  const hand = state.players[actor].hand.length
  const settings = state.players[actor].hand.filter((card) => card.kind === 'setting').length
  const teams = state.players[actor].teams
  const heroes = teams.reduce((sum, team) => sum + team.heroes.length, 0)
  const filled = teams.filter((team) => team.heroes.length >= 3).length
  const nearly = teams.filter((team) => team.heroes.length === 2).length
  const comboPts = state.players[actor].combos.reduce((sum, combo) => sum + combo.points, 0)
  const boardShape = teams.reduce((sum, team) => sum + scoreTeam(state, team).points, 0)

  if (strat === 'tempo') {
    return (
      mine * 1.65 -
      foe * 0.7 +
      heroes * 0.55 +
      boardShape * 0.28 +
      filled * 0.85 +
      nearly * 0.35 +
      comboPts * 0.5 +
      hand * 0.05
    )
  }
  if (strat === 'architect') {
    return mine * 0.9 - foe * 0.45 + boardShape * 0.25 + filled * 0.8 + comboPts * 0.55 + settings * 0.4 + hand * 0.18 + heroes * 0.22
  }
  if (strat === 'spite') {
    return mine * 0.75 - foe * 1.55 + hand * 0.08
  }
  return (
    mine * 1.45 -
    foe * 0.85 +
    boardShape * 0.35 +
    filled * 0.85 +
    nearly * 0.4 +
    comboPts * 0.55 +
    settings * 0.35 +
    hand * 0.12 +
    heroes * 0.28
  )
}

function bestFoe(state: Game, actor: PlayerId): number {
  return bestFoeScores(state.players.map((player) => scoreState(state, player.id).total), actor)
}

function bestFoeScores(scores: number[], actor: PlayerId): number {
  return Math.max(0, ...scores.map((score, id) => (id === actor ? -Infinity : score)))
}

function moved(before: Game, after: Game): boolean {
  if (after.over || after.active !== before.active) return true
  if (after.deck.length !== before.deck.length) return true
  if (after.turn !== before.turn) return true
  return before.players.some((player, index) => {
    const next = after.players[index]
    return (
      !next ||
      next.actions !== player.actions ||
      next.hand.length !== player.hand.length ||
      next.teams.length !== player.teams.length ||
      next.combos.length !== player.combos.length
    )
  })
}
