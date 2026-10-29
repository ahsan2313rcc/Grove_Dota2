import { display } from './catalog.ts'
import { apply, comboPlans, needsTeam, teamsFor } from './engine.ts'
import { scoreState } from './flow.ts'
import type { Action, Game, PlayerId } from './types.ts'

export function chooseAiAction(state: Game): Action {
  if (state.veil) return { type: 'ready' }
  if (state.pending || state.over) return { type: 'end' }
  const actor = state.active
  const rainbow = comboPlans(state).find((plan) => plan.detail.startsWith('5'))
  const trio = comboPlans(state).find((plan) => plan.detail.startsWith('3'))
  if (rainbow) return { type: 'combo', uids: rainbow.uids }
  if (trio) return { type: 'combo', uids: trio.uids }

  let best: Action = { type: 'end' }
  let bestScore = value(state, actor) - (state.players[actor].actions > 0 ? 0.8 : 0)
  const seen = new Set<string>()
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
      const score = value(next, actor)
      if (score > bestScore) {
        bestScore = score
        best = action
      }
    }
  }
  if (state.players[actor].actions > 0 && state.deck.length > 0 && state.players[actor].hand.length < state.players[actor].handLimit) {
    const score = value(apply({ ...state, autoAll: true }, { type: 'draw' }), actor) + 0.45
    if (score > bestScore) best = { type: 'draw' }
  }
  return best
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

function value(state: Game, actor: PlayerId): number {
  const others = state.players.map((player) => player.id).filter((id) => id !== actor)
  const bestFoe = (scores: number[]) => Math.max(0, ...others.map((id) => scores[id] ?? 0))
  if (state.over) return ((state.over.scores[actor] ?? 0) - bestFoe(state.over.scores)) * 5
  const mine = scoreState(state, actor).total
  const theirs = bestFoe(state.players.map((player) => scoreState(state, player.id).total))
  return mine - theirs + state.players[actor].hand.length * 0.12
}
