/**
 * Grove EV valuation model (design + constants).
 *
 * Goal: score card *impact* beyond board Rel — treat actions, hand, and
 * effect *kinds* as expected points, calibrated from AI batch sims.
 *
 * Unit: expected points (same scale as scoreState totals).
 *
 * ─────────────────────────────────────────────────────────────────────
 * Building blocks
 * ─────────────────────────────────────────────────────────────────────
 *
 * 1) Marginal board value of a hero body
 *    V_body(h | board) = score(board) − score(board \ {h})
 *    Prefer this over (after − before) play deltas: many cards enter at 0
 *    flat pts but still unlock core/mix/attack brackets.
 *
 * 2) Action yardstick (from sims)
 *    α = average points scored per spent action across finished seats.
 *    One "tempo beat" ≈ α; a full turn with 2 actions ≈ 2α plus draw /
 *    terrain-combo option value.
 *
 * 3) Hand opportunity
 *    A card in hand ≈ expected marginal of seating it as a squad mate
 *    (not its printed text alone). Empirically ≈ β · α, with β≈1 from
 *    "avg Rel of hero plays" / α once calibrated.
 *
 * 4) Ability opportunity cost
 *    Cast/Instant: paying the activate forgoes keeping the Instant as an
 *    answer, or forgoes seating another body this action.
 *    Aura: no activate opportunity cost (always "on").
 *
 * ─────────────────────────────────────────────────────────────────────
 * Effect multipliers (relative to V_body of the *target*, unless noted)
 * ─────────────────────────────────────────────────────────────────────
 */

export type ExileKind = 'permanent' | 'hostage' | 'save' | 'tempo'

/** Multipliers vs destroy (destroy = 1.0 · V_body). */
export const REMOVAL_MULT = {
  destroy: 1.0,
  /** Permanent exile off the board (gone for good). */
  exilePermanent: 1.1,
  /** Hostage / return-when-source-dies style exile. */
  exileHostage: 0.7,
  /**
   * WK / similar: exile that is effectively a save — score the
   * *consequence* (negated destroy), not removal.
   */
  exileSave: 1.0,
  /**
   * Euls-style tempo exile: deny activate / reposition for a beat —
   * worth ~one action of denial, not V_body.
   */
  exileTempo: 1.0, // · α (action), applied separately
  /** Bounce to owner's hand. */
  bounceHand: 1.0, // + ability opportunity + enemy action tax (see formula)
  /** Bottom of deck. */
  toBottom: 0.8,
  /** Top of deck — split by who can draw it. */
  toTopSelfDraw: 1.0, // you may cast their ability → + ability EV for you
  toTopEnemyDraw: 0.6, // leaves them a redraw later
} as const

/**
 * Bounce-to-hand EV:
 *   V_bounce = V_body(target)
 *            + opportunity_cost(enemy activating that ability again)
 *            + action_tax   // they spend an action to reseat
 * opportunity_cost ≈ γ · V_ability(target) when timing is cast/instant,
 * else 0 for pure auras (aura returns with the body).
 * action_tax ≈ α.
 */
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

/**
 * Control / steal EV:
 *   Gain V_body on your board shape (after insert) + deny V_body on theirs
 *   (after remove). Nonlinear cores mean these are NOT simply ± printed pts.
 *   With a live ability, add Δ ability EV (you gain activate rights, they lose).
 */
export function controlEv(args: {
  vBodyGained: number
  vBodyDenied: number
  vAbilityGained: number
  vAbilityDenied: number
}): number {
  return args.vBodyGained + args.vBodyDenied + args.vAbilityGained + args.vAbilityDenied
}

/**
 * Trap EV:
 *   block = expected extra pts a hero play would have gained entering that team
 *         (core/mix/attack bracket unlock)
 *   trigger = EV of the trap's fire effect when it pops
 */
export function trapEv(blockPts: number, triggerEv: number): number {
  return blockPts + triggerEv
}

/** Draw family — dig/search > blind draw. */
export const DRAW_MULT = {
  draw: 1.0, // · hand-opportunity β·α
  dig: 1.25,
  search: 1.35,
  /** Reveal opponent hand — info, not cards. */
  revealHand: 0.35, // · α (small but nonzero)
  /** Steal from hand/deck: deny their opportunity + gain yours. */
  stealCard: 1.0, // · (β·α_you + β·α_them)
} as const

/** Turn / tempo scaffolding used when rolling "play value". */
export const TEMPO = {
  /** Default actions per turn under Grove rules. */
  actionsPerTurn: 2,
  /** Extra option value for holding terrain toward a combo. */
  terrainComboOption: 0.4, // · coreCombo pts once calibrated
  /** Extra for each card drawn into hand this turn beyond the free upkeep. */
  extraDrawOption: 0.5, // · β·α
} as const

export type EvCalibration = {
  /** Mean pts scored per spent action (sim). */
  alpha: number
  /** Hand card ≈ β · α opportunity. */
  beta: number
  /** Mean V_body across hero destructions (sim). */
  meanVBody: number
  /** Mean ability Rel among ability swings (proxy until causal ablations). */
  meanVAbility: number
  /** Mean pts from a terrain combo resolve. */
  meanCombo: number
  matches: number
  ancient: boolean
  seats: number
  generatedAt: string
}

/** Seeded from 1024×4-seat AI sims (Ancient ON). Re-run scripts/ev-baseline-sim.mts to refresh. */
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

/**
 * Composite pressure used in debug tables once calibrated:
 * maps typed effect counts → EV points (not the provisional 1.0/0.7/… bag).
 */
export function effectEv(
  kind:
    | 'destroy'
    | 'exilePermanent'
    | 'exileHostage'
    | 'exileSave'
    | 'exileTempo'
    | 'bounceHand'
    | 'toBottom'
    | 'control'
    | 'draw'
    | 'dig'
    | 'search'
    | 'revealHand'
    | 'stealCard',
  cal: EvCalibration,
  vBody = cal.meanVBody,
  vAbility = cal.meanVAbility,
): number {
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
    case 'control':
      return controlEv({
        vBodyGained: vBody,
        vBodyDenied: vBody,
        vAbilityGained: 0.5 * vAbility,
        vAbilityDenied: 0.5 * vAbility,
      })
    case 'draw':
      return DRAW_MULT.draw * cal.beta * cal.alpha
    case 'dig':
      return DRAW_MULT.dig * cal.beta * cal.alpha
    case 'search':
      return DRAW_MULT.search * cal.beta * cal.alpha
    case 'revealHand':
      return DRAW_MULT.revealHand * cal.alpha
    case 'stealCard':
      return DRAW_MULT.stealCard * 2 * cal.beta * cal.alpha
    default:
      return 0
  }
}
