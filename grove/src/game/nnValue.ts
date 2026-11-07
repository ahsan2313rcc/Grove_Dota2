/**
 * Tiny offline action-ranking / value net for Grove.
 *
 * Train in-browser (Debug → Train Neural) via multi-horizon score outcomes,
 * or offline with `npx tsx scripts/train-nn.mts` / `scripts/hillclimb-nn.mts`
 * until the net beats the heuristic brains.
 *
 * `chooseAiActionNeural` uses 1-ply apply + value(after) — quality over speed.
 */
import { display, HERO_BY_ID } from './catalog.ts'
import { aiComboPick, apply, morphCasts, needsTeam, playableFromGrave, teamsFor, undyingRevive } from './engine.ts'
import { isTrapHero, preferredFoe, scoreState, teamById } from './flow.ts'
import type { Action, AiStrat, CardInst, Game, PlayerId } from './types.ts'
import baked from './data/nn-value.json'

export const NN_STATE_SIZE = 48
export const NN_ACTION_SIZE = 16
export const NN_INPUT_SIZE = NN_STATE_SIZE + NN_ACTION_SIZE

export type NnModel = {
  version: 1
  hidden: number
  w1: number[]
  b1: number[]
  w2: number[]
  b2: number[]
  trainedGames: number
  trainedSamples: number
  note: string
}

type LiveNet = {
  hidden: number
  w1: Float64Array
  b1: Float64Array
  w2: Float64Array
  b2: Float64Array
}

let cached: LiveNet | null = null
let cachedKey = ''
/** Live training / eval override — when set, play uses these weights. */
let activeModel: NnModel | null = null

const END_ACTION: Action = { type: 'end' }

export function setActiveModel(model: NnModel | null) {
  activeModel = model
  cached = null
  cachedKey = ''
}

export function getActiveModel(): NnModel | null {
  return activeModel
}

const KEY_CARDS = [
  'nyx_assassin', 'rubick', 'faceless_void', 'silencer', 'spirit_breaker',
  'medusa', 'tidehunter', 'axe', 'enigma', 'shadow_demon',
  'lifestealer', 'outworld_destroyer', 'techies', 'riki', 'clockwerk',
  'phoenix', 'visage', 'earthshaker', 'sven', 'invoker',
] as const

export function encodeStateFeatures(state: Game, actor: PlayerId): Float64Array {
  const feats = new Float64Array(NN_STATE_SIZE)
  const me = state.players[actor]
  const foe = preferredFoe(state, actor)
  const mine = scoreState(state, actor).total
  const foePts = scoreState(state, foe).total
  const teams = me.teams
  const hand = me.hand
  let i = 0
  feats[i++] = mine / 40
  feats[i++] = foePts / 40
  feats[i++] = (mine - foePts) / 20
  feats[i++] = me.actions / 2
  feats[i++] = hand.length / 7
  feats[i++] = state.deck.length / 200
  feats[i++] = state.turn / 40
  feats[i++] = teams.reduce((s, t) => s + t.heroes.length, 0) / 12
  feats[i++] = teams.filter((t) => t.heroes.length >= 3).length / 4
  feats[i++] = teams.filter((t) => t.heroes.length === 2).length / 4
  feats[i++] = me.combos.reduce((s, c) => s + c.points, 0) / 20
  feats[i++] = hand.filter((c) => c.kind === 'terrain').length / 5
  feats[i++] = hand.filter((c) => c.kind === 'hero').length / 5
  feats[i++] = hand.filter((c) => c.kind === 'item').length / 4
  feats[i++] = hand.filter((c) => isTrapHero(c.defId)).length / 3
  feats[i++] = hand.filter((c) => display(c.defId).instant).length / 4
  feats[i++] = enemyFilled(state, actor) / 4
  feats[i++] = enemyHeroes(state, actor) / 15
  feats[i++] = me.strat === 'tempo' ? 1 : 0
  feats[i++] = me.strat === 'architect' ? 1 : 0
  feats[i++] = me.strat === 'spite' ? 1 : 0
  feats[i++] = me.strat === 'balanced' ? 1 : 0
  for (const id of KEY_CARDS) {
    feats[i++] = hand.some((c) => c.defId === id) ? 1 : 0
  }
  while (i < NN_STATE_SIZE) feats[i++] = 0
  return feats
}

export function encodeActionFeatures(state: Game, actor: PlayerId, action: Action): Float64Array {
  const feats = new Float64Array(NN_ACTION_SIZE)
  const types = ['play', 'draw', 'end', 'combo', 'morph', 'move', 'undying', 'discard'] as const
  const typeIndex = types.indexOf(action.type as (typeof types)[number])
  if (typeIndex >= 0) feats[typeIndex] = 1
  if (action.type === 'play') {
    const card = state.players[actor]?.hand.find((c) => c.uid === action.uid)
    if (card) fillCardFeats(feats, 8, card, action.team, action.extras?.length ?? 0, state, actor)
  } else if (action.type === 'combo') {
    feats[8] = 1
    feats[9] = action.uids.length / 3
  } else if (action.type === 'draw') {
    feats[8] = 0.5
  } else if (action.type === 'end') {
    feats[8] = -0.2
  }
  return feats
}

function fillCardFeats(
  feats: Float64Array,
  offset: number,
  card: CardInst,
  teamId: string,
  extras: number,
  state: Game,
  actor: PlayerId,
) {
  feats[offset] = card.kind === 'hero' ? 1 : card.kind === 'item' ? 0.7 : 0.4
  feats[offset + 1] = display(card.defId).instant ? 1 : 0
  feats[offset + 2] = isTrapHero(card.defId) ? 1 : 0
  feats[offset + 3] = HERO_BY_ID[card.defId]?.timing === 'cast' ? 1 : 0
  feats[offset + 4] = extras / 2
  const found = teamId && teamId !== 'new' ? teamById(state, teamId) : null
  feats[offset + 5] = found ? found.team.heroes.length / 5 : teamId === 'new' ? 0.1 : 0
  feats[offset + 6] = found && found.player.id !== actor ? 1 : 0
  feats[offset + 7] = (KEY_CARDS as readonly string[]).includes(card.defId) ? 1 : 0
}

export function randomModel(hidden = 48, seed = 1): NnModel {
  let s = seed >>> 0
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return (s / 0xffffffff) * 2 - 1
  }
  const inSize = NN_INPUT_SIZE
  const scale = 1 / Math.sqrt(inSize)
  const w1 = Array.from({ length: inSize * hidden }, () => rnd() * scale)
  const b1 = Array.from({ length: hidden }, () => 0)
  const w2 = Array.from({ length: hidden }, () => rnd() / Math.sqrt(hidden))
  const b2 = [0]
  return {
    version: 1,
    hidden,
    w1,
    b1,
    w2,
    b2,
    trainedGames: 0,
    trainedSamples: 0,
    note: 'untrained',
  }
}

export function hydrateModel(raw: Partial<NnModel> | null | undefined): NnModel {
  if (raw && raw.w1 && raw.w1.length > 0 && raw.hidden) {
    return {
      version: 1,
      hidden: raw.hidden,
      w1: raw.w1,
      b1: raw.b1 ?? Array.from({ length: raw.hidden }, () => 0),
      w2: raw.w2 ?? Array.from({ length: raw.hidden }, () => 0),
      b2: raw.b2 ?? [0],
      trainedGames: raw.trainedGames ?? 0,
      trainedSamples: raw.trainedSamples ?? 0,
      note: raw.note ?? '',
    }
  }
  return randomModel(48, 7)
}

export function loadModel(model?: NnModel): LiveNet {
  const source = hydrateModel(model ?? activeModel ?? (baked as NnModel))
  const key = `${source.trainedGames}:${source.trainedSamples}:${source.hidden}:${source.w1[0]}:${source.w1[1]}`
  if (cached && cachedKey === key) return cached
  cached = {
    hidden: source.hidden,
    w1: Float64Array.from(source.w1),
    b1: Float64Array.from(source.b1),
    w2: Float64Array.from(source.w2),
    b2: Float64Array.from(source.b2),
  }
  cachedKey = key
  return cached
}

/** State value proxy: score of taking `end` from this seat's features. */
export function valueOfState(net: LiveNet, state: Game, actor: PlayerId): number {
  return scoreAction(net, encodeStateFeatures(state, actor), encodeActionFeatures(state, actor, END_ACTION))
}

export function scoreAction(net: LiveNet, stateFeats: Float64Array, actionFeats: Float64Array): number {
  const input = new Float64Array(NN_INPUT_SIZE)
  input.set(stateFeats, 0)
  input.set(actionFeats, NN_STATE_SIZE)
  const h = net.hidden
  const hidden = new Float64Array(h)
  for (let j = 0; j < h; j += 1) {
    let sum = net.b1[j]!
    for (let i = 0; i < NN_INPUT_SIZE; i += 1) sum += input[i]! * net.w1[i * h + j]!
    hidden[j] = sum > 0 ? sum : sum * 0.01
  }
  let out = net.b2[0]!
  for (let j = 0; j < h; j += 1) out += hidden[j]! * net.w2[j]!
  return out
}

/** Pairwise hinge train step — prefer teacher action over alternative. */
export function trainPair(
  model: NnModel,
  stateFeats: Float64Array,
  teacherAction: Float64Array,
  otherAction: Float64Array,
  lr = 0.002,
): number {
  const net = loadModel(model)
  const sTeacher = scoreAction(net, stateFeats, teacherAction)
  const sOther = scoreAction(net, stateFeats, otherAction)
  const loss = Math.max(0, 1 - (sTeacher - sOther))
  if (loss <= 0) return 0
  bump(model, stateFeats, teacherAction, lr)
  bump(model, stateFeats, otherAction, -lr)
  cached = null
  return loss
}

function bump(model: NnModel, stateFeats: Float64Array, actionFeats: Float64Array, lr: number) {
  const inSize = NN_INPUT_SIZE
  const h = model.hidden
  const input = new Float64Array(inSize)
  input.set(stateFeats, 0)
  input.set(actionFeats, NN_STATE_SIZE)
  const hidden = new Float64Array(h)
  const pre = new Float64Array(h)
  for (let j = 0; j < h; j += 1) {
    let sum = model.b1[j]!
    for (let i = 0; i < inSize; i += 1) sum += input[i]! * model.w1[i * h + j]!
    pre[j] = sum
    hidden[j] = sum > 0 ? sum : sum * 0.01
  }
  for (let j = 0; j < h; j += 1) model.w2[j] = model.w2[j]! + lr * hidden[j]!
  model.b2[0] = model.b2[0]! + lr
  for (let j = 0; j < h; j += 1) {
    const grad = model.w2[j]! * (pre[j]! > 0 ? 1 : 0.01) * lr
    model.b1[j] = model.b1[j]! + grad
    for (let i = 0; i < inSize; i += 1) {
      model.w1[i * h + j] = model.w1[i * h + j]! + grad * input[i]!
    }
  }
}

/**
 * Neural play: 1-ply apply + value(after). Optional explore for training.
 * Skips no-op candidates and falls back to discard/end so it cannot soft-lock.
 */
export function chooseAiActionNeural(
  state: Game,
  actor: PlayerId,
  _strat: AiStrat,
  opts: { explore?: number } = {},
): Action {
  void _strat
  const net = loadModel()
  const stateFeats = encodeStateFeatures(state, actor)
  const candidates = listNeuralCandidates(state, actor)
  const ranked = candidates
    .map((action) => {
      const after = apply(speculative(state), action)
      if (!neuralMoved(state, after) && action.type !== 'end') return null
      const prior = scoreAction(net, stateFeats, encodeActionFeatures(state, actor, action))
      const leaf = valueOfState(net, after, actor)
      return { action, score: leaf * 1.35 + prior * 0.35 }
    })
    .filter((row): row is { action: Action; score: number } => row != null)
    .sort((a, b) => b.score - a.score)

  let pick: Action =
    ranked.length === 0
      ? { type: 'end' }
      : (() => {
        const explore = opts.explore ?? 0
        if (explore > 0 && Math.random() < explore && ranked.length > 1) {
          const top = ranked.slice(0, Math.min(4, ranked.length))
          return top[Math.floor(Math.random() * top.length)]!.action
        }
        return ranked[0]!.action
      })()

  // Never leave actions on the table with a dead hand — pitch a card.
  if (pick.type === 'end' && (state.players[actor]?.actions ?? 0) > 0) {
    const uid = neuralDiscardUid(state, actor)
    if (uid) pick = { type: 'discard', uid }
  }
  return pick
}

/** Score pending choices with 1-ply value — targets, ability fire, instants, traps. */
export function chooseAiPendingNeural(state: Game, opts: { explore?: number } = {}): string[] {
  const pending = state.pending
  if (!pending) return []
  const actor = pending.actor
  if (pending.choices.length <= 1) return pending.choices[0] ? [pending.choices[0].id] : []
  // Multi-select / structured modes are handled by chooseAiPendingForSeat → heuristic.
  if (
    pending.min > 1
    || pending.mode === 'split'
    || pending.mode === 'assign'
    || pending.mode === 'groups'
  ) {
    return pending.choices.slice(0, Math.max(pending.min, 1)).map((c) => c.id)
  }

  const net = loadModel()
  const take = Math.max(pending.min, Math.min(pending.max, 1))
  const ids = pending.choices.map((c) => c.id)
  const ranked: { ids: string[]; score: number }[] = []
  for (const id of ids) {
    if (id === 'pass' && pending.min > 0) continue
    const pick = [id]
    const after = apply(speculative(state), { type: 'choose', ids: pick })
    // Prefer picks that actually resolve the prompt.
    if (after.pending && after.pending.prompt === pending.prompt && after.pending.actor === pending.actor) {
      continue
    }
    const score = valueOfState(net, after, actor)
    ranked.push({ ids: pick, score })
  }
  if (pending.choices.some((c) => c.id === 'pass') && pending.min === 0) {
    const after = apply(speculative(state), { type: 'choose', ids: ['pass'] })
    ranked.push({ ids: ['pass'], score: valueOfState(net, after, actor) })
  }
  ranked.sort((a, b) => b.score - a.score)
  if (ranked.length === 0) return ids.slice(0, take)
  const explore = opts.explore ?? 0
  if (explore > 0 && Math.random() < explore && ranked.length > 1) {
    const top = ranked.slice(0, Math.min(3, ranked.length))
    return top[Math.floor(Math.random() * top.length)]!.ids
  }
  return ranked[0]!.ids
}

/** Encode a pending choice id for trajectory learning. */
export function encodePendingChoiceFeatures(choiceId: string): Float64Array {
  const feats = new Float64Array(NN_ACTION_SIZE)
  // Slot 0–7 unused type one-hots; mark as "choose-like" in slot 5 (move-ish) + hash bits.
  feats[5] = 1
  let h = 0
  for (let i = 0; i < choiceId.length; i += 1) h = (h * 33 + choiceId.charCodeAt(i)) >>> 0
  feats[8] = (h & 255) / 255
  feats[9] = ((h >>> 8) & 255) / 255
  feats[10] = ((h >>> 16) & 255) / 255
  feats[11] = choiceId.startsWith('hero:') || choiceId.startsWith('team:') ? 1 : 0
  feats[12] = choiceId === 'pass' || choiceId === 'no' ? 1 : 0
  feats[13] = choiceId === 'yes' || choiceId.startsWith('mode:') ? 1 : 0
  feats[14] = /instant:|illu:|play:/.test(choiceId) ? 1 : 0
  feats[15] = /trap|techies|riki|clock|mine/i.test(choiceId) ? 1 : 0
  return feats
}

export function listNeuralCandidates(state: Game, actor: PlayerId): Action[] {
  const out: Action[] = []
  // Prefer free combos, but still offer fallbacks if the combo somehow no-ops.
  const cash = aiComboPick(state)
  if (cash) out.push({ type: 'combo', uids: cash })

  const morph = morphCasts(state)[0]
  if (morph) out.push({ type: 'morph', uid: morph.uid })
  const undying = undyingRevive(state)
  if (undying.ok) {
    const discards = state.players[actor].hand.filter((c) => c.kind === 'terrain').slice(0, 2).map((c) => c.uid)
    if (discards.length >= 2) out.push({ type: 'undying', team: 'new', discards })
  }

  const graveTop = playableFromGrave(state, actor)
  if (graveTop && graveTop.kind !== 'terrain') {
    const team = teamsFor(state, graveTop.uid).find((t) => t.ok)
    if (team) out.push({ type: 'play', uid: graveTop.uid, team: team.id })
  }

  const hand = state.players[actor].hand
  const seen = new Set<string>()
  for (const card of hand) {
    if (card.kind === 'terrain') continue
    if (seen.has(card.defId)) continue
    seen.add(card.defId)
    const instant = display(card.defId).instant
    if (!instant && state.players[actor].actions < 1) continue
    if (!needsTeam(card.defId, card.kind)) {
      out.push({ type: 'play', uid: card.uid, team: '' })
      continue
    }
    const teams = teamsFor(state, card.uid).filter((t) => t.ok).slice(0, 2)
    for (const team of teams) out.push({ type: 'play', uid: card.uid, team: team.id })
  }
  if (state.players[actor].actions > 0 && state.deck.length > 0) out.push({ type: 'draw' })
  const discardUid = neuralDiscardUid(state, actor)
  if (discardUid && state.players[actor].actions > 0) {
    out.push({ type: 'discard', uid: discardUid })
  }
  out.push({ type: 'end' })
  return out
}

/** Speculative apply must not re-enter settle's AI pending auto-picker (stack overflow). */
function speculative(state: Game): Game {
  return {
    ...state,
    autoAll: false,
    players: state.players.map((player) => ({ ...player, ai: false })),
  }
}

function neuralDiscardUid(state: Game, actor: PlayerId): string | null {
  const hand = state.players[actor]?.hand ?? []
  if (hand.length === 0) return null
  const terrain = hand.find((card) => card.kind === 'terrain')
  if (terrain) return terrain.uid
  const item = hand.find((card) => card.kind === 'item')
  if (item) return item.uid
  return hand[0]?.uid ?? null
}

function neuralMoved(before: Game, after: Game): boolean {
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

function enemyFilled(state: Game, actor: PlayerId): number {
  let n = 0
  for (const player of state.players) {
    if (player.id === actor) continue
    n += player.teams.filter((team) => team.heroes.length >= 3).length
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

export function modelHasTraining(model?: NnModel): boolean {
  return hydrateModel(model ?? (baked as NnModel)).trainedSamples > 0
}
