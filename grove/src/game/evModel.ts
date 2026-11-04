/**
 * Grove full EV valuation — every mechanical family maps to expected points.
 *
 * Unit: expected points (same scale as scoreState totals).
 * Pressure in debug tables = sum of typed effect EVs (not provisional weights).
 *
 * Building blocks
 * ───────────────
 * V_body(h) = score(team) − score(team \ {h})   // marginal bracket value
 * α         = pts per action (sim calibration)
 * β·α       = hand-card opportunity
 * V_ability ≈ mean ability Rel (sim) · timing weight
 */

import { HERO_BY_ID } from './catalog.ts'
import { findHero, scoreTeam } from './flow.ts'
import type { Game } from './types.ts'

export type ExileKind = 'permanent' | 'hostage' | 'save' | 'tempo'

export type EffectKind =
  | 'destroy'
  | 'exilePermanent'
  | 'exileHostage'
  | 'exileSave'
  | 'exileTempo'
  | 'bounceHand'
  | 'toBottom'
  | 'toTopSelf'
  | 'toTopEnemy'
  | 'control'
  | 'discard'
  | 'draw'
  | 'dig'
  | 'search'
  | 'revealHand'
  | 'stealCard'
  | 'trapPlant'
  | 'immune'
  | 'denyActions'
  | 'combo'
  | 'silenceLock'

/** Multipliers vs destroy (destroy = 1.0 · V_body). */
export const REMOVAL_MULT = {
  destroy: 1.0,
  exilePermanent: 1.1,
  exileHostage: 0.7,
  /** WK / Abaddon-style: consequence is a save, not removal. */
  exileSave: 1.0,
  /** Euls-style: tempo deny ≈ α, not V_body. */
  exileTempo: 1.0,
  bounceHand: 1.0,
  toBottom: 0.8,
  toTopSelf: 1.0,
  toTopEnemy: 0.6,
} as const

export const DRAW_MULT = {
  draw: 1.0,
  dig: 1.25,
  search: 1.35,
  revealHand: 0.35,
  stealCard: 1.0,
  discard: 0.85, // forced opp discard ≈ deny hand opportunity
} as const

export const TEMPO = {
  actionsPerTurn: 2,
  terrainComboOption: 0.4,
  extraDrawOption: 0.5,
  trapBlock: 0.75, // · α — expected bracket deny from blocked entry
  trapTrigger: 1.1, // · meanVBody — typical trap pop
  immune: 0.55, // · α — denied targeting window
  silenceLock: 0.9, // · α — denied activate
  denyAction: 1.0, // · α per action stripped
} as const

export type EvCalibration = {
  alpha: number
  beta: number
  meanVBody: number
  meanVAbility: number
  meanCombo: number
  matches: number
  ancient: boolean
  seats: number
  generatedAt: string
}

/** Seeded from 1024×4-seat AI sims (Ancient ON). */
export const DEFAULT_CALIBRATION: EvCalibration = {
  alpha: 1.69,
  beta: 1.7,
  meanVBody: 2.88,
  meanVAbility: 1.5,
  meanCombo: 5.06,
  matches: 1024,
  ancient: true,
  seats: 4,
  generatedAt: '2026-11-04T15:52:39.700Z',
}

/** Typed effect bag accumulated per impact frame. */
export interface PlayEffects {
  destroy: number
  discard: number
  /** Sum of all exile kinds (column convenience). */
  exile: number
  exilePermanent: number
  exileHostage: number
  exileSave: number
  exileTempo: number
  control: number
  bounce: number
  toBottom: number
  toTop: number
  draw: number
  dig: number
  search: number
  revealHand: number
  stealCard: number
  trapPlant: number
  immune: number
  denyActions: number
  combo: number
  silenceLock: number
  /** Running full-EV total (source of truth for Press). */
  ev: number
}

export const EMPTY_EFFECTS = (): PlayEffects => ({
  destroy: 0,
  discard: 0,
  exile: 0,
  exilePermanent: 0,
  exileHostage: 0,
  exileSave: 0,
  exileTempo: 0,
  control: 0,
  bounce: 0,
  toBottom: 0,
  toTop: 0,
  draw: 0,
  dig: 0,
  search: 0,
  revealHand: 0,
  stealCard: 0,
  trapPlant: 0,
  immune: 0,
  denyActions: 0,
  combo: 0,
  silenceLock: 0,
  ev: 0,
})

export function addEffects(target: PlayEffects, source: PlayEffects) {
  for (const key of Object.keys(target) as (keyof PlayEffects)[]) {
    target[key] += source[key]
  }
}

export function bounceHandEv(args: {
  vBody: number
  vAbility: number
  isAura: boolean
  alpha: number
  abilityOppMult?: number
}): number {
  const gamma = args.abilityOppMult ?? 0.85
  const abilityTax = args.isAura ? 0 : gamma * args.vAbility
  return REMOVAL_MULT.bounceHand * args.vBody + abilityTax + args.alpha
}

export function controlEv(args: {
  vBodyGained: number
  vBodyDenied: number
  vAbilityGained: number
  vAbilityDenied: number
}): number {
  return args.vBodyGained + args.vBodyDenied + args.vAbilityGained + args.vAbilityDenied
}

export function trapEv(blockPts: number, triggerEv: number): number {
  return blockPts + triggerEv
}

export function effectEv(
  kind: EffectKind,
  cal: EvCalibration,
  vBody = cal.meanVBody,
  vAbility = cal.meanVAbility,
): number {
  const hand = cal.beta * cal.alpha
  switch (kind) {
    case 'destroy':
      return REMOVAL_MULT.destroy * vBody
    case 'exilePermanent':
      return REMOVAL_MULT.exilePermanent * vBody
    case 'exileHostage':
      return REMOVAL_MULT.exileHostage * vBody
    case 'exileSave':
      return REMOVAL_MULT.exileSave * vBody
    case 'exileTempo':
      return REMOVAL_MULT.exileTempo * cal.alpha
    case 'bounceHand':
      return bounceHandEv({ vBody, vAbility, isAura: false, alpha: cal.alpha })
    case 'toBottom':
      return REMOVAL_MULT.toBottom * vBody
    case 'toTopSelf':
      return REMOVAL_MULT.toTopSelf * vBody + 0.5 * vAbility
    case 'toTopEnemy':
      return REMOVAL_MULT.toTopEnemy * vBody
    case 'control':
      return controlEv({
        vBodyGained: vBody,
        vBodyDenied: vBody,
        vAbilityGained: 0.5 * vAbility,
        vAbilityDenied: 0.5 * vAbility,
      })
    case 'discard':
      return DRAW_MULT.discard * hand
    case 'draw':
      return DRAW_MULT.draw * hand
    case 'dig':
      return DRAW_MULT.dig * hand
    case 'search':
      return DRAW_MULT.search * hand
    case 'revealHand':
      return DRAW_MULT.revealHand * cal.alpha
    case 'stealCard':
      return DRAW_MULT.stealCard * 2 * hand
    case 'trapPlant':
      return trapEv(TEMPO.trapBlock * cal.alpha, TEMPO.trapTrigger * cal.meanVBody)
    case 'immune':
      return TEMPO.immune * cal.alpha
    case 'denyActions':
      return TEMPO.denyAction * cal.alpha
    case 'combo':
      return cal.meanCombo
    case 'silenceLock':
      return TEMPO.silenceLock * cal.alpha
    default:
      return 0
  }
}

/** Full EV for a typed effect bag (Press column). */
export function pressureOf(effects: PlayEffects, cal: EvCalibration = DEFAULT_CALIBRATION): number {
  if (effects.ev) return effects.ev
  // Fallback recompute from counts (legacy bags without running ev).
  let total = 0
  total += effects.destroy * effectEv('destroy', cal)
  total += effects.exilePermanent * effectEv('exilePermanent', cal)
  total += effects.exileHostage * effectEv('exileHostage', cal)
  total += effects.exileSave * effectEv('exileSave', cal)
  total += effects.exileTempo * effectEv('exileTempo', cal)
  // Untyped exile residue
  const typedExile =
    effects.exilePermanent + effects.exileHostage + effects.exileSave + effects.exileTempo
  const untypedExile = Math.max(0, effects.exile - typedExile)
  total += untypedExile * effectEv('exilePermanent', cal)
  total += effects.bounce * effectEv('bounceHand', cal)
  total += effects.toBottom * effectEv('toBottom', cal)
  total += effects.toTop * effectEv('toTopEnemy', cal)
  total += effects.control * effectEv('control', cal)
  total += effects.discard * effectEv('discard', cal)
  total += effects.draw * effectEv('draw', cal)
  total += effects.dig * effectEv('dig', cal)
  total += effects.search * effectEv('search', cal)
  total += effects.revealHand * effectEv('revealHand', cal)
  total += effects.stealCard * effectEv('stealCard', cal)
  total += effects.trapPlant * effectEv('trapPlant', cal)
  total += effects.immune * effectEv('immune', cal)
  total += effects.denyActions * effectEv('denyActions', cal)
  total += effects.combo * effectEv('combo', cal)
  total += effects.silenceLock * effectEv('silenceLock', cal)
  return total
}

function credit(
  effects: PlayEffects,
  kind: EffectKind,
  cal: EvCalibration,
  count = 1,
  vBody?: number,
  vAbility?: number,
) {
  if (count === 0) return
  const unit = effectEv(kind, cal, vBody, vAbility)
  effects.ev += unit * Math.abs(count) * Math.sign(count || 1)
  switch (kind) {
    case 'destroy':
      effects.destroy += count
      break
    case 'exilePermanent':
      effects.exilePermanent += count
      effects.exile += count
      break
    case 'exileHostage':
      effects.exileHostage += count
      effects.exile += count
      break
    case 'exileSave':
      effects.exileSave += count
      effects.exile += count
      break
    case 'exileTempo':
      effects.exileTempo += count
      effects.exile += count
      break
    case 'bounceHand':
      effects.bounce += count
      break
    case 'toBottom':
      effects.toBottom += count
      break
    case 'toTopSelf':
    case 'toTopEnemy':
      effects.toTop += count
      break
    case 'control':
      effects.control += count
      break
    case 'discard':
      effects.discard += count
      break
    case 'draw':
      effects.draw += count
      break
    case 'dig':
      effects.dig += count
      break
    case 'search':
      effects.search += count
      break
    case 'revealHand':
      effects.revealHand += count
      break
    case 'stealCard':
      effects.stealCard += count
      break
    case 'trapPlant':
      effects.trapPlant += count
      break
    case 'immune':
      effects.immune += count
      break
    case 'denyActions':
      effects.denyActions += count
      break
    case 'combo':
      effects.combo += count
      break
    case 'silenceLock':
      effects.silenceLock += count
      break
  }
}

/** Marginal team points contributed by a seated hero. */
export function marginalBodyValue(state: Game, uid: string, fallback: number): number {
  const loc = findHero(state, uid)
  if (!loc) return fallback
  const withPts = scoreTeam(state, loc.team).points
  const withoutHeroes = loc.team.heroes.filter((hero) => hero.uid !== uid)
  if (withoutHeroes.length === 0) return Math.max(fallback * 0.5, withPts)
  const ghost = { ...loc.team, heroes: withoutHeroes }
  const withoutPts = scoreTeam(state, ghost).points
  const delta = withPts - withoutPts
  return delta > 0 ? delta : fallback
}

function abilityValue(defId: string, cal: EvCalibration): number {
  const timing = HERO_BY_ID[defId]?.timing
  if (timing === 'aura') return cal.meanVAbility * 0.35
  if (timing === 'instant') return cal.meanVAbility * 1.15
  if (timing === 'cast') return cal.meanVAbility
  if (timing === 'trap') return cal.meanVAbility * 0.9
  return cal.meanVAbility * 0.5
}

function isAura(defId: string): boolean {
  return HERO_BY_ID[defId]?.timing === 'aura'
}

function newLogs(before: Game, after: Game): string {
  return after.log.slice(before.log.length).join('\n')
}

function classifyExile(
  before: Game,
  after: Game,
  uid: string,
  priorDefId: string,
  impactDefId: string | null,
  logs: string,
): ExileKind {
  if (priorDefId === 'wraith_king' || /Reincarnation/i.test(logs)) return 'save'
  if (impactDefId === 'euls' || /Eul'?s|Cyclone/i.test(logs)) return 'tempo'
  if (impactDefId === 'shadow_demon' || /Disruption/i.test(logs)) return 'hostage'
  if (impactDefId === 'medusa' || /Stone Gaze/i.test(logs)) return 'hostage'
  if (after.medusaHold.some((hold) => hold.cards.some((card) => card.uid === uid))) return 'hostage'
  if (after.infests.some((entry) => entry.ls.uid === uid)) return 'hostage'
  if (before.infests.some((entry) => entry.ls.uid === uid)) return 'hostage'
  // Abaddon-style top-deck instead of death is handled as toTop, not exile.
  if (/Borrowed Time|return.*top of the deck instead/i.test(logs)) return 'save'
  return 'permanent'
}

function deckPos(game: Game, uid: string): 'top' | 'bottom' | 'mid' | null {
  const index = game.deck.findIndex((card) => card.uid === uid)
  if (index < 0) return null
  if (index === 0) return 'top'
  if (index === game.deck.length - 1) return 'bottom'
  return 'mid'
}

function countImmune(game: Game): number {
  let n = 0
  for (const player of game.players) {
    if (player.bkb) n += 1
    for (const team of player.teams) {
      if (team.glyph) n += Math.max(1, team.heroes.length)
      const hasOmni = team.heroes.some((hero) => hero.defId === 'omniknight')
      for (const hero of team.heroes) {
        if (hero.bkb || hero.omni) n += 1
        else if (hasOmni) n += 1
      }
    }
  }
  return n
}

function boardHeroMap(game: Game): Map<string, { defId: string; controller: number }> {
  const map = new Map<string, { defId: string; controller: number }>()
  for (const player of game.players) {
    for (const team of player.teams) {
      for (const hero of team.heroes) {
        map.set(hero.uid, { defId: hero.defId, controller: hero.controller })
      }
    }
  }
  return map
}

function handMap(game: Game, seat: number): Map<string, string> {
  return new Map((game.players[seat]?.hand ?? []).map((card) => [card.uid, card.defId]))
}

function allHands(game: Game): Map<string, { defId: string; seat: number }> {
  const map = new Map<string, { defId: string; seat: number }>()
  for (const player of game.players) {
    for (const card of player.hand) map.set(card.uid, { defId: card.defId, seat: player.id })
  }
  return map
}

/**
 * Diff before→after into a full PlayEffects bag credited to `actor`.
 * `impactDefId` helps classify euls / SD / medusa / chronosphere sources.
 */
export function diffPlayEffects(
  before: Game,
  after: Game,
  actor: number,
  impactDefId: string | null = null,
  cal: EvCalibration = DEFAULT_CALIBRATION,
): PlayEffects {
  const effects = EMPTY_EFFECTS()
  const logs = newLogs(before, after)
  const beforeBoard = boardHeroMap(before)
  const afterBoard = boardHeroMap(after)
  const beforeExile = new Set(before.exile.map((card) => card.uid))
  const afterExile = new Set(after.exile.map((card) => card.uid))
  const beforeGrave = new Set(before.grave.map((card) => card.uid))
  const afterGrave = new Set(after.grave.map((card) => card.uid))
  const afterHands = allHands(after)
  const beforeHands = allHands(before)

  // --- Board removals / control ---
  for (const [uid, prior] of beforeBoard) {
    const next = afterBoard.get(uid)
    const vBody = marginalBodyValue(before, uid, cal.meanVBody)
    const vAbility = abilityValue(prior.defId, cal)

    if (!next) {
      if (afterGrave.has(uid)) {
        credit(effects, 'destroy', cal, 1, vBody, vAbility)
        continue
      }
      if (afterExile.has(uid) && !beforeExile.has(uid)) {
        const kind = classifyExile(before, after, uid, prior.defId, impactDefId, logs)
        if (kind === 'permanent') credit(effects, 'exilePermanent', cal, 1, vBody, vAbility)
        else if (kind === 'hostage') credit(effects, 'exileHostage', cal, 1, vBody, vAbility)
        else if (kind === 'save') credit(effects, 'exileSave', cal, 1, vBody, vAbility)
        else credit(effects, 'exileTempo', cal, 1, vBody, vAbility)
        continue
      }
      if (afterHands.has(uid)) {
        const aura = isAura(prior.defId)
        const unit = bounceHandEv({
          vBody,
          vAbility: aura ? 0 : vAbility,
          isAura: aura,
          alpha: cal.alpha,
        })
        effects.bounce += 1
        effects.ev += unit
        continue
      }
      const pos = deckPos(after, uid)
      if (pos === 'bottom' || pos === 'mid') {
        credit(effects, 'toBottom', cal, 1, vBody, vAbility)
        continue
      }
      if (pos === 'top') {
        // Actor drawing next → self; otherwise enemy may reclaim.
        const selfDraw = after.active === actor || after.players[actor]?.actions > 0
        credit(effects, selfDraw ? 'toTopSelf' : 'toTopEnemy', cal, 1, vBody, vAbility)
        continue
      }
      continue
    }

    if (prior.controller !== actor && next.controller === actor) {
      credit(effects, 'control', cal, 1, vBody, vAbility)
    } else if (prior.controller === actor && next.controller !== actor) {
      credit(effects, 'control', cal, -1, vBody, vAbility)
    }
  }

  // Grave→exile (AA ice blast conversion, etc.)
  for (const uid of afterExile) {
    if (beforeExile.has(uid)) continue
    if (beforeGrave.has(uid) && !afterGrave.has(uid) && !beforeBoard.has(uid)) {
      credit(effects, 'exilePermanent', cal, 1)
    }
  }

  // --- Hand / deck economy ---
  // Opponent discards
  for (const player of before.players) {
    if (player.id === actor) continue
    const prior = handMap(before, player.id)
    const next = handMap(after, player.id)
    for (const [uid] of prior) {
      if (next.has(uid)) continue
      if (afterGrave.has(uid)) credit(effects, 'discard', cal, 1)
      else if (afterExile.has(uid) && !beforeExile.has(uid)) credit(effects, 'exilePermanent', cal, 1)
      else if (afterHands.get(uid)?.seat === actor) credit(effects, 'stealCard', cal, 1)
    }
  }

  // Actor draws / digs / searches (hand gains from deck or grave)
  const actorBefore = handMap(before, actor)
  const actorAfter = handMap(after, actor)
  let handGains = 0
  for (const [uid] of actorAfter) {
    if (actorBefore.has(uid)) continue
    handGains += 1
    if (beforeHands.has(uid) && beforeHands.get(uid)!.seat !== actor) {
      // already counted stealCard above
      continue
    }
    if (beforeGrave.has(uid)) {
      credit(effects, 'dig', cal, 1) // grave dig / DP / reward
      continue
    }
    // from deck
    if (/search the deck|search .* deck/i.test(logs)) credit(effects, 'search', cal, 1)
    else if (/into the grave until|Pulse Nova|reveal an item/i.test(logs)) credit(effects, 'dig', cal, 1)
    else if (/Reveal the top|Hookshot|top \d+ cards/i.test(logs)) credit(effects, 'search', cal, 1)
    else credit(effects, 'draw', cal, 1)
  }
  void handGains

  // Reveal info
  if (/reveals? (their|his|her) hand|reveal.*hand/i.test(logs)) {
    credit(effects, 'revealHand', cal, 1)
  }

  // Trap plants
  const trapsBefore = before.players.reduce(
    (sum, player) => sum + player.teams.filter((team) => team.trap).length,
    0,
  )
  const trapsAfter = after.players.reduce(
    (sum, player) => sum + player.teams.filter((team) => team.trap).length,
    0,
  )
  if (trapsAfter > trapsBefore) credit(effects, 'trapPlant', cal, trapsAfter - trapsBefore)

  // Immunity grants
  const immuneDelta = countImmune(after) - countImmune(before)
  if (immuneDelta > 0) credit(effects, 'immune', cal, immuneDelta)

  // Action denial (Chronosphere / Jakiro / etc.)
  if (/loses? their remaining actions|lose an action|loses an action/i.test(logs)) {
    const denied = Math.max(1, (before.players.find((p) => p.id !== actor)?.actions ?? 1))
    credit(effects, 'denyActions', cal, Math.min(denied, TEMPO.actionsPerTurn))
  }

  // Silence / orchid / global silence locks
  if (/Global Silence|cannot activate|Orchid|silenced|Spell Steal.*[Nn]ullif/i.test(logs)) {
    credit(effects, 'silenceLock', cal, 1)
  }

  // Terrain combo resolves
  if (after.players[actor]?.combos.length > (before.players[actor]?.combos.length ?? 0)) {
    const gained =
      (after.players[actor]?.combos.length ?? 0) - (before.players[actor]?.combos.length ?? 0)
    credit(effects, 'combo', cal, gained)
  }

  // Steal enemy terrain combo (Windranger etc.) — combo count may move seats
  for (const player of before.players) {
    if (player.id === actor) continue
    const lost =
      (before.players[player.id]?.combos.length ?? 0) - (after.players[player.id]?.combos.length ?? 0)
    if (lost > 0 && (after.players[actor]?.combos.length ?? 0) > (before.players[actor]?.combos.length ?? 0)) {
      // already counted combo gain; add deny as extra half combo
      effects.ev += lost * cal.meanCombo * 0.5
    }
  }

  return effects
}
