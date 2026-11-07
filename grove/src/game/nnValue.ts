/**
 * Neural value net for Grove (v2).
 *
 * V(state, seat) predicts the seat's outcome in "rel points" (seat score minus the
 * best opponent), blended over horizons: now, +1, +3, +5, +10 turns, and the final
 * placement. It is trained by regression on AI-vs-AI games (`nnTrainOnline.ts`), so
 * auras, traps, engines and discard are valued by what they did to later scores,
 * not by hand-set numbers.
 *
 * Inputs are relative to the seat: dense board/hand/score scalars, the Challenge
 * heuristic's own evaluation (so a fresh net starts at heuristic strength), and
 * sparse per-card counts for own board, opponents' boards, own hand and own planted
 * traps. Face-down enemy traps are only counted, never identified.
 *
 * Play: the Neural seat runs the same turn beam search as Challenge, with V as the
 * leaf evaluation.
 */
import { ANCIENT_ID, display, HEROES, ITEMS, REWARDS, TERRAINS } from './catalog.ts'
import { aiComboPick, apply, comboPlans, morphCasts, needsTeam, playableFromGrave, teamsFor, undyingRevive } from './engine.ts'
import { chooseAiPendingChallenge, evaluateChallenge } from './aiChallenge.ts'
import { aiSearchBudget, type AiSearchBudget } from './aiPower.ts'
import { isTrapHero, scoreState, scoreTeam, teamById } from './flow.ts'
import type { Action, AiStrat, Game, PlayerId } from './types.ts'
import baked from './data/nn-value.json'

export const NN_VERSION = 2
export const NN_DENSE = 40
/** Index of the heuristic-eval input inside the dense block. */
export const NN_HEURISTIC_INPUT = 1
/** Rel points per unit of network output. */
export const NN_SCALE = 20
/** Fixed divisor for the heuristic-eval input (Challenge eval runs ~2–3× rel points). */
const HEURISTIC_DIV = 50
const BLOCKS = 4

export type NnModel = {
  version: 2
  hidden: number
  vocab: string[]
  /** (dense + blocks·vocab) × hidden, row-major by input. */
  w1: number[]
  b1: number[]
  w2: number[]
  /** Linear skip from every input straight to the output. */
  wl: number[]
  b2: number
  trainedGames: number
  trainedSamples: number
  /** Running mean squared error on recent training batches (output units). */
  recentLoss: number
  note: string
}

type LiveNet = {
  hidden: number
  inputs: number
  vocabIndex: Map<string, number>
  vocabSize: number
  w1: Float64Array
  b1: Float64Array
  w2: Float64Array
  wl: Float64Array
  b2: number
}

/** Sparse input: dense values plus (index, count) pairs for the card blocks. */
export type NnFeatures = {
  dense: Float64Array
  idx: number[]
  val: number[]
}

export function defaultVocab(): string[] {
  const ids = new Set<string>()
  for (const hero of HEROES) ids.add(hero.id)
  for (const item of ITEMS) ids.add(item.id)
  for (const reward of REWARDS) ids.add(reward.id)
  for (const terrain of TERRAINS) ids.add(terrain.id)
  ids.add(ANCIENT_ID)
  return [...ids].sort()
}

function inputCount(vocabSize: number): number {
  return NN_DENSE + BLOCKS * vocabSize
}

/**
 * Fresh net: hidden weights small and random, skip weight on the heuristic input set
 * so V ≈ heuristic eval at game 0. Training then corrects it from real outcomes.
 */
export function randomModel(hidden = 48, seed = 1): NnModel {
  let s = seed >>> 0 || 1
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return (s / 0xffffffff) * 2 - 1
  }
  const vocab = defaultVocab()
  const inputs = inputCount(vocab.length)
  const scale = 0.5 / Math.sqrt(NN_DENSE + 30)
  const w1 = Array.from({ length: inputs * hidden }, () => rnd() * scale)
  const wl = Array.from({ length: inputs }, () => 0)
  wl[NN_HEURISTIC_INPUT] = HEURISTIC_DIV / (2.5 * NN_SCALE)
  return {
    version: 2,
    hidden,
    vocab,
    w1,
    b1: Array.from({ length: hidden }, () => 0),
    w2: Array.from({ length: hidden }, () => rnd() * 0.01),
    wl,
    b2: 0,
    trainedGames: 0,
    trainedSamples: 0,
    recentLoss: 0,
    note: 'fresh (heuristic prior)',
  }
}

export function hydrateModel(raw: unknown): NnModel {
  const model = raw as Partial<NnModel> | null | undefined
  if (
    model
    && model.version === 2
    && Array.isArray(model.vocab)
    && model.hidden
    && Array.isArray(model.w1)
    && model.w1.length === inputCount(model.vocab.length) * model.hidden
    && Array.isArray(model.wl)
    && model.wl.length === inputCount(model.vocab.length)
  ) {
    return {
      version: 2,
      hidden: model.hidden,
      vocab: model.vocab,
      w1: model.w1,
      b1: model.b1 ?? Array.from({ length: model.hidden }, () => 0),
      w2: model.w2 ?? Array.from({ length: model.hidden }, () => 0),
      wl: model.wl,
      b2: model.b2 ?? 0,
      trainedGames: model.trainedGames ?? 0,
      trainedSamples: model.trainedSamples ?? 0,
      recentLoss: model.recentLoss ?? 0,
      note: model.note ?? '',
    }
  }
  // Old v1 checkpoints (pairwise hinge) are incompatible — start from the heuristic prior.
  return randomModel(48, 7)
}

let activeModel: NnModel | null = null
let cached: LiveNet | null = null
let cachedFor: NnModel | null = null
let cachedStamp = -1

export function setActiveModel(model: NnModel | null) {
  activeModel = model
  cached = null
  cachedFor = null
}

export function getActiveModel(): NnModel | null {
  return activeModel
}

let bakedModel: NnModel | null = null
function bakedCheckpoint(): NnModel {
  bakedModel ??= hydrateModel(baked)
  return bakedModel
}

/** Bump after in-place weight edits so the live net reloads. */
let weightStamp = 0
export function markWeightsChanged() {
  weightStamp += 1
}

export function loadModel(model?: NnModel): LiveNet {
  const source = model ?? activeModel ?? bakedCheckpoint()
  if (cached && cachedFor === source && cachedStamp === weightStamp) return cached
  const vocabIndex = new Map(source.vocab.map((id, index) => [id, index]))
  cached = {
    hidden: source.hidden,
    inputs: inputCount(source.vocab.length),
    vocabIndex,
    vocabSize: source.vocab.length,
    w1: Float64Array.from(source.w1),
    b1: Float64Array.from(source.b1),
    w2: Float64Array.from(source.w2),
    wl: Float64Array.from(source.wl),
    b2: source.b2,
  }
  cachedFor = source
  cachedStamp = weightStamp
  return cached
}

function maxOpp(scores: number[], seat: PlayerId): number {
  let best = -Infinity
  for (let id = 0; id < scores.length; id += 1) if (id !== seat && scores[id]! > best) best = scores[id]!
  return best === -Infinity ? 0 : best
}

/** Seat score minus the best opponent — the quantity V is trained to predict. */
export function relOf(scores: number[], seat: PlayerId): number {
  return (scores[seat] ?? 0) - maxOpp(scores, seat)
}

export function encodeFeatures(state: Game, seat: PlayerId, net: LiveNet = loadModel()): NnFeatures {
  const dense = new Float64Array(NN_DENSE)
  const me = state.players[seat]!
  const scores = state.players.map((player) => scoreState(state, player.id).total)
  const mine = scores[seat] ?? 0
  const best = maxOpp(scores, seat)
  const others = scores.filter((_, id) => id !== seat)
  const meanOpp = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0
  const heuristic = evaluateChallenge(state, seat, 'balanced')
  let i = 0
  dense[i++] = 1
  dense[i++] = clampUnit(heuristic / HEURISTIC_DIV)
  dense[i++] = mine / 40
  dense[i++] = best / 40
  dense[i++] = meanOpp / 40
  dense[i++] = (mine - best) / 20
  dense[i++] = me.actions / 2
  dense[i++] = me.hand.length / 7
  dense[i++] = state.deck.length / 150
  dense[i++] = state.turn / 60
  dense[i++] = state.players.length / 4
  dense[i++] = state.ancient ? 1 : 0
  dense[i++] = state.ancient ? state.ancient.endsLeft / Math.max(1, state.players.length) : 0
  dense[i++] = state.active === seat ? 1 : 0
  dense[i++] = state.pending?.actor === seat ? 1 : 0
  const mySizes = [0, 0, 0, 0, 0]
  const foeSizes = [0, 0, 0, 0, 0]
  let myTeamPts = 0
  let foeTeamPts = 0
  let trapsOnMine = 0
  let myTrapsOut = 0
  for (const player of state.players) {
    for (const team of player.teams) {
      const size = Math.min(5, team.heroes.length)
      const pts = scoreTeam(state, team).points
      if (player.id === seat) {
        if (size > 0) mySizes[size - 1]! += 1
        myTeamPts += pts
        if (team.trap && team.trap.owner !== seat) trapsOnMine += 1
      } else {
        if (size > 0) foeSizes[size - 1]! += 1
        foeTeamPts += pts
      }
      if (team.trap?.owner === seat) myTrapsOut += 1
    }
  }
  for (const n of mySizes) dense[i++] = n / 3
  for (const n of foeSizes) dense[i++] = n / (3 * Math.max(1, others.length))
  dense[i++] = myTeamPts / 30
  dense[i++] = foeTeamPts / (30 * Math.max(1, others.length))
  dense[i++] = me.combos.reduce((sum, combo) => sum + combo.points, 0) / 20
  dense[i++] = state.players.reduce((sum, player) => (player.id === seat ? sum : sum + player.combos.reduce((s, c) => s + c.points, 0)), 0) / (20 * Math.max(1, others.length))
  dense[i++] = trapsOnMine / 2
  dense[i++] = myTrapsOut / 2
  dense[i++] = state.players.reduce((sum, player) => (player.id === seat ? sum : sum + player.hand.length), 0) / (7 * Math.max(1, others.length))
  dense[i++] = state.grave.length / 40
  dense[i++] = me.hand.filter((card) => card.kind === 'terrain').length / 5
  dense[i++] = me.hand.filter((card) => display(card.defId).instant).length / 3
  dense[i++] = state.silence ? 1 : 0
  dense[i++] = me.orchid ? 1 : 0
  dense[i++] = state.noDraw && state.noDraw.caster !== seat ? 1 : 0
  dense[i++] = state.lockPlay && state.lockPlay.caster !== seat ? 1 : 0

  const counts = new Map<number, number>()
  const bump = (block: number, defId: string) => {
    const index = net.vocabIndex.get(defId)
    if (index == null) return
    const key = NN_DENSE + block * net.vocabSize + index
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const player of state.players) {
    for (const team of player.teams) {
      for (const hero of team.heroes) bump(hero.controller === seat ? 0 : 1, hero.defId)
      if (team.trap?.owner === seat) bump(3, team.trap.defId)
    }
  }
  for (const card of me.hand) bump(2, card.defId)
  return { dense, idx: [...counts.keys()], val: [...counts.values()] }
}

function clampUnit(x: number): number {
  return Math.max(-3, Math.min(3, x))
}

function hiddenPre(net: LiveNet, f: NnFeatures, out: Float64Array) {
  const h = net.hidden
  for (let j = 0; j < h; j += 1) out[j] = net.b1[j]!
  for (let i = 0; i < NN_DENSE; i += 1) {
    const x = f.dense[i]!
    if (x === 0) continue
    const row = i * h
    for (let j = 0; j < h; j += 1) out[j]! += x * net.w1[row + j]!
  }
  for (let k = 0; k < f.idx.length; k += 1) {
    const x = f.val[k]!
    const row = f.idx[k]! * h
    for (let j = 0; j < h; j += 1) out[j]! += x * net.w1[row + j]!
  }
}

function linearPart(net: LiveNet, f: NnFeatures): number {
  let out = net.b2
  for (let i = 0; i < NN_DENSE; i += 1) out += f.dense[i]! * net.wl[i]!
  for (let k = 0; k < f.idx.length; k += 1) out += f.val[k]! * net.wl[f.idx[k]!]!
  return out
}

/** Raw network output (rel points ÷ NN_SCALE). */
export function forward(net: LiveNet, f: NnFeatures): number {
  const pre = new Float64Array(net.hidden)
  hiddenPre(net, f, pre)
  let out = linearPart(net, f)
  for (let j = 0; j < net.hidden; j += 1) {
    const z = pre[j]!
    out += (z > 0 ? z : 0.01 * z) * net.w2[j]!
  }
  return out
}

/** Predicted outcome in rel points for `seat` at `state`. */
export function valueOf(state: Game, seat: PlayerId, net: LiveNet = loadModel()): number {
  if (state.over) {
    const scores = state.over.scores
    const rel = relOf(scores, seat)
    // Terminal states: the real result, with a clear win/loss step.
    return rel + (rel > 0 ? 12 : rel < 0 ? -12 : 0)
  }
  return forward(net, encodeFeatures(state, seat, net)) * NN_SCALE
}

/** Adam state lives beside the model (not persisted). */
type AdamState = { m: Float64Array; v: Float64Array; t: number; size: number }
const adamFor = new WeakMap<NnModel, AdamState>()

function paramCount(model: NnModel): number {
  return model.w1.length + model.b1.length + model.w2.length + model.wl.length + 1
}

/**
 * One minibatch of squared-error regression (Adam). Sparse inputs keep this cheap:
 * only touched w1 rows get gradient. Returns mean squared error before the update.
 */
export function trainBatch(
  model: NnModel,
  batch: { f: NnFeatures; y: number }[],
  lr = 0.001,
  l2 = 1e-5,
): number {
  if (batch.length === 0) return 0
  const net = loadModel(model)
  const h = model.hidden
  const size = paramCount(model)
  let adam = adamFor.get(model)
  if (!adam || adam.size !== size) {
    adam = { m: new Float64Array(size), v: new Float64Array(size), t: 0, size }
    adamFor.set(model, adam)
  }
  const oW1 = 0
  const oB1 = model.w1.length
  const oW2 = oB1 + h
  const oWl = oW2 + h
  const oB2 = oWl + model.wl.length
  const grad = new Map<number, number>()
  const add = (index: number, g: number) => grad.set(index, (grad.get(index) ?? 0) + g)
  const pre = new Float64Array(h)
  let loss = 0
  for (const { f, y } of batch) {
    hiddenPre(net, f, pre)
    let out = linearPart(net, f)
    for (let j = 0; j < h; j += 1) {
      const z = pre[j]!
      out += (z > 0 ? z : 0.01 * z) * net.w2[j]!
    }
    const err = out - y
    loss += err * err
    const d = (2 * err) / batch.length
    add(oB2, d)
    for (let i = 0; i < NN_DENSE; i += 1) if (f.dense[i]) add(oWl + i, d * f.dense[i]!)
    for (let k = 0; k < f.idx.length; k += 1) add(oWl + f.idx[k]!, d * f.val[k]!)
    for (let j = 0; j < h; j += 1) {
      const z = pre[j]!
      const act = z > 0 ? z : 0.01 * z
      add(oW2 + j, d * act)
      const dz = d * net.w2[j]! * (z > 0 ? 1 : 0.01)
      if (dz === 0) continue
      add(oB1 + j, dz)
      for (let i = 0; i < NN_DENSE; i += 1) {
        const x = f.dense[i]!
        if (x) add(oW1 + i * h + j, dz * x)
      }
      for (let k = 0; k < f.idx.length; k += 1) add(oW1 + f.idx[k]! * h + j, dz * f.val[k]!)
    }
  }
  adam.t += 1
  const b1c = 1 - 0.9 ** adam.t
  const b2c = 1 - 0.999 ** adam.t
  for (const [index, g0] of grad) {
    const param = readParam(model, index, oB1, oW2, oWl, oB2)
    const g = g0 + l2 * param
    const m = (adam.m[index] = 0.9 * adam.m[index]! + 0.1 * g)
    const v = (adam.v[index] = 0.999 * adam.v[index]! + 0.001 * g * g)
    const step = (lr * (m / b1c)) / (Math.sqrt(v / b2c) + 1e-8)
    writeParam(model, index, param - step, oB1, oW2, oWl, oB2)
  }
  model.trainedSamples += batch.length
  const mse = loss / batch.length
  model.recentLoss = model.recentLoss ? model.recentLoss * 0.98 + mse * 0.02 : mse
  markWeightsChanged()
  return mse
}

function readParam(model: NnModel, index: number, oB1: number, oW2: number, oWl: number, oB2: number): number {
  if (index < oB1) return model.w1[index]!
  if (index < oW2) return model.b1[index - oB1]!
  if (index < oWl) return model.w2[index - oW2]!
  if (index < oB2) return model.wl[index - oWl]!
  return model.b2
}

function writeParam(model: NnModel, index: number, value: number, oB1: number, oW2: number, oWl: number, oB2: number) {
  if (index < oB1) model.w1[index] = value
  else if (index < oW2) model.b1[index - oB1] = value
  else if (index < oWl) model.w2[index - oW2] = value
  else if (index < oB2) model.wl[index - oWl] = value
  else model.b2 = value
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

type BeamNode = { state: Game; first: Action | null; score: number; steps: number }

/** Batch sims use a lighter search so Stats runs stay quick. */
const FAST_BUDGET: AiSearchBudget = { beam: 3, depth: 2, handPly: 4, teamOpts: 1, pendingTry: 6 }

/**
 * Neural turn planner: Challenge-style beam over this turn's actions, V(state) at
 * every node. `explore` picks a random top-3 first action (training only).
 */
export function chooseAiActionNeural(
  state: Game,
  actor: PlayerId,
  _strat: AiStrat,
  opts: { explore?: number; fast?: boolean } = {},
): Action {
  void _strat
  const net = loadModel()
  const budget = opts.fast ? FAST_BUDGET : aiSearchBudget()
  const cash = aiComboPick(state)
  if (cash) return { type: 'combo', uids: cash }

  const rootScore = valueOf(state, actor, net)
  let beam: BeamNode[] = [{ state, first: null, score: rootScore, steps: 0 }]
  const firsts = new Map<string, { action: Action; score: number }>()
  const noteFirst = (action: Action, score: number) => {
    const key = JSON.stringify(action)
    const prior = firsts.get(key)
    if (!prior || score > prior.score) firsts.set(key, { action, score })
  }

  for (let depth = 0; depth < budget.depth; depth += 1) {
    const nextBeam: BeamNode[] = []
    for (const node of beam) {
      if (node.state.over || node.state.active !== actor || node.state.veil || node.state.pending) {
        continue
      }
      for (const action of neuralCandidates(node.state, actor, budget)) {
        const after = apply({ ...node.state, autoAll: true }, action)
        if (!moved(node.state, after) && action.type !== 'end') continue
        const score = valueOf(after, actor, net)
        const first = node.first ?? action
        noteFirst(first, score)
        const done = action.type === 'end' || after.over || after.active !== actor || after.veil
        if (!done) nextBeam.push({ state: after, first, score, steps: node.steps + 1 })
      }
    }
    nextBeam.sort((a, b) => b.score - a.score)
    beam = nextBeam.slice(0, budget.beam)
    if (beam.length === 0) break
  }

  const ranked = [...firsts.values()].sort((a, b) => b.score - a.score)
  let pick: Action = ranked[0]?.action ?? { type: 'end' }
  const explore = opts.explore ?? 0
  if (explore > 0 && ranked.length > 1 && Math.random() < explore) {
    pick = ranked[Math.floor(Math.random() * Math.min(3, ranked.length))]!.action
  }
  if (pick.type === 'end' && (state.players[actor]?.actions ?? 0) > 0 && ranked.length <= 1) {
    const uid = stuckDiscard(state, actor)
    if (uid) pick = { type: 'discard', uid }
  }
  return pick
}

/** Pending choices: 1-ply V(after) over the options; structured multi-picks use Challenge. */
export function chooseAiPendingNeural(state: Game, opts: { explore?: number } = {}): string[] {
  const pending = state.pending
  if (!pending) return []
  const actor = pending.actor
  if (pending.choices.length <= 1) return pending.choices[0] ? [pending.choices[0].id] : []
  if (['weaver-ancient', 'restack', 'discard', 'limit'].includes(pending.resume.kind)) return chooseAiPendingChallenge(state)
  if (pending.min > 1 || pending.mode === 'split' || pending.mode === 'assign' || pending.mode === 'groups' || pending.mode === 'keep') {
    return chooseAiPendingChallenge(state)
  }
  const net = loadModel()
  const quiet: Game = { ...state, autoAll: false, players: state.players.map((player) => ({ ...player, ai: false })) }
  const ranked: { ids: string[]; score: number }[] = []
  for (const choice of pending.choices) {
    if (choice.id === 'pass' && pending.min > 0) continue
    const after = apply(quiet, { type: 'choose', ids: [choice.id] })
    if (after === quiet) continue
    ranked.push({ ids: [choice.id], score: valueOf(after, actor, net) })
  }
  if (ranked.length === 0) return chooseAiPendingChallenge(state)
  ranked.sort((a, b) => b.score - a.score)
  const explore = opts.explore ?? 0
  if (explore > 0 && ranked.length > 1 && Math.random() < explore) {
    return ranked[Math.floor(Math.random() * Math.min(3, ranked.length))]!.ids
  }
  return ranked[0]!.ids
}

export function neuralCandidates(state: Game, actor: PlayerId, budget: AiSearchBudget = aiSearchBudget()): Action[] {
  const out: Action[] = []
  const me = state.players[actor]!
  for (const cast of morphCasts(state).slice(0, 2)) out.push({ type: 'morph', uid: cast.uid })
  const undying = undyingRevive(state)
  if (undying.ok) {
    const discards = me.hand.filter((card) => card.kind === 'terrain').slice(0, 2).map((card) => card.uid)
    if (discards.length >= 2) out.push({ type: 'undying', team: 'new', discards })
  }
  const graveTop = playableFromGrave(state, actor)
  if (graveTop?.kind === 'terrain') {
    for (const plan of comboPlans(state)) if (plan.uids.includes(graveTop.uid)) out.push({ type: 'combo', uids: plan.uids })
  } else if (graveTop) {
    for (const team of teamsFor(state, graveTop.uid).filter((t) => t.ok).slice(0, 2)) {
      out.push({ type: 'play', uid: graveTop.uid, team: team.id })
    }
  }
  for (const plan of comboPlans(state).slice(0, 2)) out.push({ type: 'combo', uids: plan.uids })
  for (const card of state.clinkzExile) {
    if (card.kind === 'item' && state.active === actor) out.push({ type: 'play', uid: card.uid, team: '' })
  }

  const heroUids = me.hand.filter((card) => card.kind === 'hero' && !isTrapHero(card.defId)).map((card) => card.uid)
  const seen = new Set<string>()
  let expanded = 0
  for (const card of me.hand) {
    if (card.kind === 'terrain' || seen.has(card.defId)) continue
    seen.add(card.defId)
    if (!display(card.defId).instant && me.actions < 1) continue
    if (expanded >= budget.handPly + 2) break
    expanded += 1
    if (!needsTeam(card.defId, card.kind)) {
      out.push({ type: 'play', uid: card.uid, team: '' })
      continue
    }
    const teams = teamsFor(state, card.uid)
      .filter((t) => t.ok)
      .sort((a, b) => teamSize(state, b.id) - teamSize(state, a.id))
      .slice(0, budget.teamOpts + 1)
    for (const team of teams) {
      out.push({ type: 'play', uid: card.uid, team: team.id })
      if (card.kind === 'hero' && !isTrapHero(card.defId)) {
        const mate = heroUids.find((uid) => uid !== card.uid)
        if (mate) out.push({ type: 'play', uid: card.uid, team: team.id, extras: [mate] })
      }
    }
  }
  if (me.actions > 0 && state.deck.length > 0) out.push({ type: 'draw' })
  out.push({ type: 'end' })
  return out
}

function teamSize(state: Game, teamId: string): number {
  if (!teamId || teamId === 'new') return -1
  return teamById(state, teamId)?.team.heroes.length ?? -1
}

function stuckDiscard(state: Game, actor: PlayerId): string | null {
  const hand = state.players[actor]?.hand ?? []
  return (hand.find((card) => card.kind === 'terrain') ?? hand[0])?.uid ?? null
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

export function modelHasTraining(model?: NnModel): boolean {
  return (model ?? bakedCheckpoint()).trainedGames > 0
}
