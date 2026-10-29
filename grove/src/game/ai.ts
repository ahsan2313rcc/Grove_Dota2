import { display } from './catalog.ts'
import { apply, comboPlans, needsTeam, teamsFor } from './engine.ts'
import { scoreState, scoreTeam } from './flow.ts'
import type { Action, AiStrat, Game, PlayerId } from './types.ts'

export const AI_STRATS: { id: AiStrat; label: string; blurb: string }[] = [
  { id: 'balanced', label: 'Balanced', blurb: 'Scores the lead and keeps a flexible hand.' },
  { id: 'tempo', label: 'Tempo', blurb: 'Plays out the board fast; draws only when stuck.' },
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
  const rainbow = plans.find((plan) => plan.detail.startsWith('5'))
  const trio = plans.find((plan) => plan.detail.startsWith('3'))

  if (strat === 'architect') {
    if (rainbow) return { type: 'combo', uids: rainbow.uids }
    if (trio) return { type: 'combo', uids: trio.uids }
  } else if (strat === 'tempo') {
    if (rainbow) return { type: 'combo', uids: rainbow.uids }
    // Tempo still takes free settings, but prefers immediate plays first when behind on actions.
  } else {
    if (rainbow) return { type: 'combo', uids: rainbow.uids }
    if (trio) return { type: 'combo', uids: trio.uids }
  }

  let best: Action = { type: 'end' }
  let bestScore = evaluate(state, actor, strat) + endBias(state, actor, strat)
  const seen = new Set<string>()

  if (strat !== 'tempo' && trio && !rainbow) {
    const next = apply({ ...state, autoAll: true }, { type: 'combo', uids: trio.uids })
    const score = evaluate(next, actor, strat) + 0.35
    if (score > bestScore) {
      bestScore = score
      best = { type: 'combo', uids: trio.uids }
    }
  } else if (strat === 'tempo' && trio) {
    const next = apply({ ...state, autoAll: true }, { type: 'combo', uids: trio.uids })
    const score = evaluate(next, actor, strat) + 0.15
    if (score > bestScore) {
      bestScore = score
      best = { type: 'combo', uids: trio.uids }
    }
  }

  for (const card of state.players[actor].hand) {
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

  return best
}

function endBias(state: Game, actor: PlayerId, strat: AiStrat): number {
  const actions = state.players[actor].actions
  if (strat === 'tempo') return actions > 0 ? -1.6 : 0
  if (strat === 'architect') return actions > 0 ? -0.35 : 0
  if (strat === 'spite') return actions > 0 ? -0.9 : 0
  return actions > 0 ? -0.8 : 0
}

function drawBias(state: Game, actor: PlayerId, strat: AiStrat): number {
  const hand = state.players[actor].hand.length
  if (strat === 'tempo') return hand >= 4 ? -0.35 : 0.15
  if (strat === 'architect') return 0.85 + (hand < 5 ? 0.25 : 0)
  if (strat === 'spite') return 0.25
  return 0.45
}

function playBias(before: Game, after: Game, actor: PlayerId, strat: AiStrat, kind: string, teamId: string): number {
  if (strat === 'tempo') {
    if (kind === 'hero' || kind === 'item') return 0.55
    if (kind === 'setting') return -0.1
    return 0.2
  }
  if (strat === 'architect') {
    const beforeTeams = before.players[actor].teams.length
    const afterTeams = after.players[actor].teams.length
    const beforeHeroes = before.players[actor].teams.reduce((sum, team) => sum + team.heroes.length, 0)
    const afterHeroes = after.players[actor].teams.reduce((sum, team) => sum + team.heroes.length, 0)
    const beforeCombos = before.players[actor].combos.length
    const afterCombos = after.players[actor].combos.length
    let bonus = 0
    if (kind === 'setting') bonus += 0.7
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
    return (beforeOpp - afterOpp) * 0.35
  }
  return 0
}

function evaluate(state: Game, actor: PlayerId, strat: AiStrat): number {
  if (state.over) {
    const mine = state.over.scores[actor] ?? 0
    const foe = bestFoeScores(state.over.scores, actor)
    if (strat === 'spite') return (mine - foe) * 6
    if (strat === 'architect') return mine * 4 + (mine - foe) * 1.5
    if (strat === 'tempo') return mine * 3.2 + (mine - foe) * 2
    return (mine - foe) * 5
  }

  const mine = scoreState(state, actor).total
  const foe = bestFoe(state, actor)
  const hand = state.players[actor].hand.length
  const settings = state.players[actor].hand.filter((card) => card.kind === 'setting').length
  const teams = state.players[actor].teams
  const heroes = teams.reduce((sum, team) => sum + team.heroes.length, 0)
  const filled = teams.filter((team) => team.heroes.length >= 3).length
  const comboPts = state.players[actor].combos.reduce((sum, combo) => sum + combo.points, 0)
  const boardShape = teams.reduce((sum, team) => sum + scoreTeam(state, team).points, 0)

  if (strat === 'tempo') {
    return mine * 1.35 - foe * 0.85 + heroes * 0.35 + hand * 0.04 - settings * 0.08
  }
  if (strat === 'architect') {
    return mine * 0.9 - foe * 0.45 + boardShape * 0.25 + filled * 0.8 + comboPts * 0.55 + settings * 0.4 + hand * 0.18 + heroes * 0.22
  }
  if (strat === 'spite') {
    return mine * 0.75 - foe * 1.55 + hand * 0.08
  }
  return mine - foe + hand * 0.12
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
