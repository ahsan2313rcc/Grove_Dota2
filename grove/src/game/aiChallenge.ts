/**
 * Challenge AI — strongest heuristic brain.
 *
 * Plans a short turn line with beam search (not single greedy clicks),
 * uses a sharper eval (answers, board shape, threat, engines), and searches
 * important pending picks instead of keyword heuristics alone.
 *
 * Neural still wins on long horizons; this chassis closes the gap by valuing
 * latent board shape, removal pressure, and aura engines — not just raw pts.
 */
import { display, HERO_BY_ID } from './catalog.ts'
import { aiComboPick, apply, comboPlans, morphCasts, needsTeam, playableFromGrave, teamsFor, undyingRevive } from './engine.ts'
import {
  isTrapHero,
  trapAim,
  preferredFoe,
  preferredFoeFromScores,
  scoreState,
  scoreTeam,
  standingOf,
  teamById,
} from './flow.ts'
import { aiSearchBudget } from './aiPower.ts'
import { chooseAiPending } from './ai.ts'
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

/** Board engines / denial auras — Neural seats these; heuristics used to ignore them. */
const ENGINE_AURAS = new Set([
  'puck',
  'omniknight',
  'lycan',
  'viper',
  'crystal_maiden',
  'abaddon',
  'wraith_king',
  'tidehunter',
  'underlord',
  'beastmaster',
])

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

type BeamNode = {
  state: Game
  first: Action | null
  score: number
  steps: number
}

export function chooseAiActionChallenge(state: Game, actor: PlayerId, strat: AiStrat): Action {
  const budget = aiSearchBudget()
  const cash = aiComboPick(state)
  if (cash) return { type: 'combo', uids: cash }

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
  if (['limit', 'discard', 'weaver-ancient', 'restack', 'response', 'response-place'].includes(pending.resume.kind)) return chooseAiPending(state)

  const ids = pending.choices.map((choice) => choice.id)
  const tryIds = ids.slice(0, aiSearchBudget().pendingTry)
  let best: string[] = ids.slice(0, Math.max(pending.min, 1))
  let bestScore = -Infinity
  for (const id of tryIds) {
    if (id === 'pass' && pending.min > 0) continue
    const pick = [id]
    // Speculative: disable AI auto-pending so settle cannot re-enter this picker.
    const next = apply(
      {
        ...state,
        autoAll: false,
        players: state.players.map((player) => ({ ...player, ai: false })),
      },
      { type: 'choose', ids: pick },
    )
    const score = evaluateChallenge(next, actor, strat)
    if (score > bestScore) {
      bestScore = score
      best = pick
    }
  }
  if (pending.choices.some((choice) => choice.id === 'pass') && pending.min === 0) {
    const next = apply(
      {
        ...state,
        autoAll: false,
        players: state.players.map((player) => ({ ...player, ai: false })),
      },
      { type: 'choose', ids: ['pass'] },
    )
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

  for (const plan of comboPlans(state).slice(0, 3)) {
    out.push({ type: 'combo', uids: plan.uids })
  }
  for (const card of state.clinkzExile) {
    if (card.kind === 'item' && state.active === actor) out.push({ type: 'play', uid: card.uid, team: '' })
  }

  const budget = aiSearchBudget()
  const ranked = rankHand(state, actor, hand, strat)
  for (const card of ranked.slice(0, budget.handPly + 1)) {
    const teams = pickTeams(state, card.uid, card.defId, card.kind).slice(0, budget.teamOpts + 1)
    for (const team of teams) {
      out.push({ type: 'play', uid: card.uid, team: team.id })
      if (card.kind === 'hero' && !isTrapHero(card.defId)) {
        const mates = rankMates(state, actor, card.uid, team.id, heroUids).slice(0, 2)
        for (const mate of mates) {
          out.push({ type: 'play', uid: card.uid, team: team.id, extras: [mate] })
        }
        if (mates.length >= 2) {
          out.push({ type: 'play', uid: card.uid, team: team.id, extras: mates.slice(0, 2) })
        }
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
    const place = standingOf(state.over.scores, actor)
    // Placement-aware finish (Neural trains on this); 1st >> participation.
    const placeBonus = place === 1 ? 140 : place === 2 ? 35 : place === 3 ? -10 : -70
    const win = mine > foe ? 40 : mine === foe ? 10 : -30
    return placeBonus + win + (mine - foe) * 4.2 + mine * 2.0
  }

  const scores = state.players.map((player) => scoreState(state, player.id).total)
  const mine = scores[actor] ?? 0
  // Spite hunts the hottest board; others climb the seat above in standings.
  const foeSeat = huntFoe(state, actor, strat)
  const foe = scores[foeSeat] ?? 0
  const lead = mine - foe
  const place = standingOf(scores, actor)
  const hand = state.players[actor].hand
  const teams = state.players[actor].teams
  const heroes = teams.reduce((sum, team) => sum + team.heroes.length, 0)
  const filled = teams.filter((team) => team.heroes.length >= 3).length
  const nearly = teams.filter((team) => team.heroes.length === 2).length
  const open = teams.filter((team) => team.heroes.length === 1).length
  const comboPts = state.players[actor].combos.reduce((sum, combo) => sum + combo.points, 0)
  const boardShape = teams.reduce((sum, team) => sum + scoreTeam(state, team).points, 0)
  const coreSynergy = coreSynergyScore(state, actor)
  const engines = engineAuraScore(state, actor)
  const denial = hand.filter((card) => (INTERRUPT_VALUE[card.defId] ?? 0) >= 7).length
  const softDenial = hand.filter((card) => {
    const v = INTERRUPT_VALUE[card.defId] ?? 0
    return v >= 5 && v < 7
  }).length
  const traps = hand.filter((card) => isTrapHero(card.defId)).length
  const terrains = hand.filter((card) => card.kind === 'terrain').length
  const playable = hand.filter((card) => card.kind !== 'terrain' && !display(card.defId).instant).length
  const foeFilled = enemyFilled(state, actor)
  const foeHeroes = enemyHeroes(state, actor)
  const enemyTraps = state.players.reduce((sum, player) => {
    if (player.id === actor) return sum
    return sum + player.teams.filter((team) => team.trap?.owner === actor).length
  }, 0)
  const threat = threatScoreChallenge(state, actor)
  const actions = state.players[actor].actions
  const behind = lead <= -3
  const foeNearly = enemyNearly(state, actor)

  // Slightly less myopic on raw pts; more weight on shape / engines / placement.
  let score =
    mine * 1.15 -
    foe * 1.15 +
    lead * 0.95 +
    boardShape * 0.7 +
    coreSynergy * 0.85 +
    engines * 1.35 +
    filled * 1.75 +
    nearly * 1.15 +
    open * 0.05 +
    comboPts * 1.0 +
    heroes * 0.22 +
    terrains * 0.28 +
    traps * 0.5 +
    enemyTraps * 1.35 +
    softDenial * 0.2 +
    playable * 0.12 +
    hand.length * 0.05 +
    actions * 0.28 -
    foeFilled * 1.35 -
    foeHeroes * 0.1 -
    (place - 1) * 1.6

  // Answer retention: hold less hard than before — banking answers lost to Neural tempo.
  if (state.ancient) score += denial * 0.1
  else if (behind) score += denial * 0.35
  else if (threat < 4.5 && foeNearly === 0 && foeFilled === 0) score += denial * 1.15
  else if (threat < 7) score += denial * 0.55
  else score += denial * 0.2

  if (lead < -12) score -= 3.2
  if (lead > 25) score -= 0.6
  if (behind) score += heroes * 0.28 + traps * 0.4 + nearly * 0.25 + (playable > 0 ? 0.5 : -0.45)

  if (strat === 'tempo') {
    score += heroes * 0.28 + nearly * 0.28 + actions * 0.18 + playable * 0.15
    score -= denial * 0.25
    if (foeNearly >= 1) score += 0.9
    if (threat >= 6) score += denial * 0.35
  }
  if (strat === 'architect') {
    score += filled * 0.45 + comboPts * 0.35 + terrains * 0.2 + nearly * 0.3 + coreSynergy * 0.4
    if (foeFilled >= 1) score += 2.1
    if (foeNearly >= 1) score += 1.25
    if (behind) score += 1.0
    score += engines * 0.35
  }
  if (strat === 'spite') {
    score += traps * 0.55 + enemyTraps * 0.65 + foeFilled * 0.9 + foeNearly * 0.55 + threat * 0.18
    score -= foe * 0.2
    if (behind) score += 1.6
    score += engines * 0.2
  }
  if (strat === 'balanced') {
    score += denial * 0.2 + engines * 0.25 + coreSynergy * 0.2
    if (behind) score += 0.9
    if (!behind && threat < 4 && foeNearly === 0) score += denial * 0.15
    if (foeNearly >= 1 || foeFilled >= 1) score += 1.25
  }
  if (state.ancient) {
    score += lead * 1.8 + mine * 0.5 + boardShape * 0.25
    score -= denial * 0.55
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
  const beforeNearly = before.players[actor].teams.filter((team) => team.heroes.length === 2).length
  const afterNearly = after.players[actor].teams.filter((team) => team.heroes.length === 2).length
  const denial = INTERRUPT_VALUE[card.defId] ?? 0
  const threat = threatScoreChallenge(before, actor)
  const foeSeat = huntFoe(before, actor, strat)
  const behind = beforePts + 3 < scoreState(before, foeSeat).total
  const trap = isTrapHero(card.defId)
  const foeLoss = scoreState(before, foeSeat).total - scoreState(after, foeSeat).total
  const pressure = pressureDelta(before, after, actor)
  const timing = HERO_BY_ID[card.defId]?.timing

  let bonus = ptsGain * 0.95 + foeLoss * 0.85 + extras * 0.55 + pressure * 0.75

  if (trap) {
    const aim = trapAim(after, actor, card.defId, teamId)
    // Spite: prefer planting on the hunted seat's teams.
    const onHunt =
      teamId !== 'new' && teamId !== '' && teamById(after, teamId)?.player.id === foeSeat
    bonus += aim > 0
      ? (strat === 'spite' ? 2.8 + (onHunt ? 0.7 : 0) : 2.0)
      : -1.6
  }

  if (card.kind === 'hero' && !trap) {
    bonus += 0.95
    if (teamId !== 'new') bonus += 1.15
    else bonus -= 0.05
    if (afterFilled > beforeFilled) bonus += 1.7
    if (afterNearly > beforeNearly) bonus += 0.55
    if (timing === 'cast' || timing === 'instant') bonus += 0.65 + Math.max(0, ptsGain) * 0.2
    if (timing === 'aura' || ENGINE_AURAS.has(card.defId)) bonus += 1.15
    // Squad onto an attr-matched destination is how Neural builds cores cheaply.
    if (extras > 0) {
      const dest = teamId !== 'new' ? teamById(after, teamId)?.team : null
      if (dest && dest.heroes.length >= 3) bonus += 0.7
      else if (dest && dest.heroes.length === 2) bonus += 0.35
    }
  }

  if (card.kind === 'item') bonus += 0.5
  if (card.kind === 'rune' || card.kind === 'tower' || card.kind === 'neutral') bonus += 0.55

  const hotBoard =
    threat >= 5
    || behind
    || foeLoss >= 2
    || pressure >= 1
    || ptsGain >= 4
    || enemyNearly(before, actor) >= 1
    || enemyFilled(before, actor) >= 1
    || !!before.ancient

  // Hold answers, but not as rigidly — mid-game answers that stall foes are worth burning.
  if (display(card.defId).instant && denial >= 7) {
    bonus += hotBoard ? 1.15 : -1.65
  } else if (display(card.defId).instant && denial >= 5) {
    bonus += hotBoard || threat >= 4 ? 0.55 : -0.55
  }

  if (strat === 'architect' && after.players[actor].combos.length > before.players[actor].combos.length) {
    bonus += 1.15
  }
  if (strat === 'architect' && (foeLoss > 0 || pressure > 0)) bonus += 0.75
  if (strat === 'spite' && afterFilled < beforeFilled) bonus -= 2.8
  if (strat === 'spite') bonus += pressure * 0.45
  if (strat === 'tempo' && card.kind === 'hero' && !trap) bonus += 0.4 + extras * 0.15
  if (strat === 'balanced' && (pressure >= 1 || foeLoss >= 2)) bonus += 0.55
  if (before.ancient) bonus += ptsGain * 0.7 + foeLoss * 0.5 + pressure * 0.4
  return bonus
}

function endBiasChallenge(state: Game, actor: PlayerId, strat: AiStrat): number {
  const actions = state.players[actor].actions
  if (actions < 1) return 0.4
  const hand = state.players[actor].hand
  const denial = hand.filter((card) => (INTERRUPT_VALUE[card.defId] ?? 0) >= 6).length
  const spenders = hand.filter(
    (card) => card.kind !== 'terrain' && (INTERRUPT_VALUE[card.defId] ?? 0) < 6 && !display(card.defId).instant,
  ).length
  const threat = threatScoreChallenge(state, actor)
  // Ending with spare actions is how heuristics bled to Neural — punish harder.
  let bias = -2.35
  if (spenders >= 1) bias -= 0.55
  if (denial >= 1 && threat < 4 && !state.ancient && enemyNearly(state, actor) === 0 && enemyFilled(state, actor) === 0) {
    bias += 0.65
  }
  if (threat >= 7 && denial === 0) bias -= 0.55
  if (strat === 'tempo') bias -= 0.4
  if (strat === 'architect') bias -= 0.45
  if (strat === 'spite') bias -= 0.3
  if (state.ancient) bias -= 1.1
  return bias
}

function drawBiasChallenge(state: Game, actor: PlayerId, strat: AiStrat): number {
  const hand = state.players[actor].hand
  const playable = hand.filter((card) => card.kind !== 'terrain').length
  const terrains = hand.filter((card) => card.kind === 'terrain').length
  let bias = playable === 0 ? 1.65 : playable <= 1 ? 0.85 : -0.2
  if (terrains >= 2) bias += 0.3
  if (hand.length >= 6) bias -= 0.5
  if (strat === 'architect' && terrains >= 2) bias += 0.25
  if (strat === 'tempo' && playable >= 3) bias -= 0.2
  return bias
}

function rankHand(state: Game, actor: PlayerId, hand: CardInst[], strat: AiStrat): CardInst[] {
  const threat = threatScoreChallenge(state, actor)
  const behind = scoreState(state, actor).total + 3 < scoreState(state, huntFoe(state, actor, strat)).total
  const actions = state.players[actor].actions
  const nearly = state.players[actor].teams.some((team) => team.heroes.length === 2)
  const seen = new Set<string>()
  const ranked: { card: CardInst; rank: number }[] = []
  for (const card of hand) {
    if (card.kind === 'terrain') continue
    if (seen.has(card.defId)) continue
    seen.add(card.defId)
    const instant = display(card.defId).instant
    if (!instant && actions < 1) continue
    const denial = INTERRUPT_VALUE[card.defId] ?? 0
    const timing = HERO_BY_ID[card.defId]?.timing
    let rank = 0
    if (isTrapHero(card.defId)) rank += strat === 'spite' ? 3.4 : 2.5
    else if (card.kind === 'hero') {
      rank += 4.4
      if (timing === 'cast') rank += 1.55
      else if (timing === 'instant') rank += 1.1
      else if (timing === 'aura' || ENGINE_AURAS.has(card.defId)) rank += 1.65
      else rank += 0.55
      if (nearly) rank += 0.45
    } else if (card.kind === 'item') rank += 3.2
    else rank += 2.4
    if (denial >= 7) rank += threat >= 5 || behind || enemyNearly(state, actor) >= 1 ? 3.0 : -2.4
    else if (denial >= 5) rank += threat >= 4 || behind ? 1.2 : -0.55
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
  const basePts = team ? scoreTeam(state, team).points : 0
  return heroUids
    .filter((uid) => uid !== activeUid)
    .map((uid) => {
      const card = state.players[actor]?.hand.find((entry) => entry.uid === uid)
      if (!card) return { uid, fit: -1 }
      const attr = HERO_BY_ID[card.defId]?.attr
      const range = HERO_BY_ID[card.defId]?.range
      let fit = 0
      if (attr && activeAttr && attr === activeAttr) fit += 3
      if (team && attr) fit += team.heroes.filter((hero) => HERO_BY_ID[hero.defId]?.attr === attr).length * 2
      if (team && team.heroes.length >= 2 && team.heroes.length < 5) fit += 1.5
      // Prefer packing that grows the live team score (CORE / MIX / ATK), not attr equality alone.
      if (team && team.heroes[0]) {
        const projected = {
          ...team,
          heroes: [
            ...team.heroes,
            { ...team.heroes[0], uid: `proj-${uid}`, defId: card.defId },
          ],
        }
        fit += Math.max(0, scoreTeam(state, projected).points - basePts) * 0.35
        if (range === 'Ranged' && team.heroes.some((hero) => HERO_BY_ID[hero.defId]?.range === 'Melee')) fit += 0.4
        if (range === 'Melee' && team.heroes.some((hero) => HERO_BY_ID[hero.defId]?.range === 'Ranged')) fit += 0.4
      }
      if (isTrapHero(card.defId)) fit -= 4
      return { uid, fit }
    })
    .sort((a, b) => b.fit - a.fit)
    .map((entry) => entry.uid)
}

/** Spite: hottest board. Others: seat immediately above in standings. */
function huntFoe(state: Game, actor: PlayerId, strat: AiStrat): PlayerId {
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
        if (ENGINE_AURAS.has(hero.defId)) heat += 2.5
      }
    }
    if (heat > bestHeat) {
      bestHeat = heat
      best = player.id
    }
  }
  return best
}

function pickDiscards(state: Game, actor: PlayerId): string[] {
  return state.players[actor].hand
    .filter((card) => card.kind === 'terrain' || (INTERRUPT_VALUE[card.defId] ?? 0) < 5)
    .slice(0, 2)
    .map((card) => card.uid)
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
      else if (team.heroes.length === 2) threat += 0.95
      for (const hero of team.heroes) {
        const timing = HERO_BY_ID[hero.defId]?.timing
        if (timing === 'cast') threat += 1.1
        if (timing === 'instant') threat += 0.7
        if (HIGH_THREAT_HEROES.has(hero.defId)) threat += 1.8
        if (ENGINE_AURAS.has(hero.defId)) threat += 1.2
      }
    }
    threat += Math.min(3, player.hand.filter((card) => display(card.defId).instant).length) * 0.3
  }
  threat += pendingCastThreat(state)
  return threat
}

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

/** Same-attr stacks and dense teams are latent score Neural already prices in. */
function coreSynergyScore(state: Game, actor: PlayerId): number {
  let value = 0
  for (const team of state.players[actor]?.teams ?? []) {
    if (team.heroes.length < 2) continue
    const attrs = team.heroes.map((hero) => HERO_BY_ID[hero.defId]?.attr).filter(Boolean)
    const counts = new Map<string, number>()
    for (const attr of attrs) counts.set(attr!, (counts.get(attr!) ?? 0) + 1)
    let best = 0
    for (const n of counts.values()) best = Math.max(best, n)
    if (best >= 3) value += 2.4 + (best - 3) * 0.8
    else if (best === 2) value += 0.9
    value += Math.max(0, team.heroes.length - 1) * 0.15
  }
  return value
}

function engineAuraScore(state: Game, actor: PlayerId): number {
  let value = 0
  for (const player of state.players) {
    for (const team of player.teams) {
      for (const hero of team.heroes) {
        if (!ENGINE_AURAS.has(hero.defId) && HERO_BY_ID[hero.defId]?.timing !== 'aura') continue
        const mine = hero.controller === actor
        const weight = ENGINE_AURAS.has(hero.defId) ? 1.4 : 0.7
        value += mine ? weight : -weight * 0.85
      }
    }
  }
  return value
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
  // Shrinking foe filled cores is high-signal removal.
  delta += (enemyFilled(before, actor) - enemyFilled(after, actor)) * 1.1
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
