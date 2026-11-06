/**
 * Train the offline Grove action-ranker by imitating a heuristic teacher.
 *
 * Usage:
 *   npx tsx scripts/train-nn.mts [--games 2000] [--teacher full|challenge|fast]
 *
 * Writes src/game/data/nn-value.json
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chooseAiAction, chooseAiPending, type AiSearchMode } from '../src/game/ai.ts'
import { chooseAiPendingChallenge } from '../src/game/aiChallenge.ts'
import { aiRoster } from '../src/game/balance.ts'
import { apply, createGame } from '../src/game/engine.ts'
import {
  encodeActionFeatures,
  encodeStateFeatures,
  hydrateModel,
  randomModel,
  trainPair,
  type NnModel,
} from '../src/game/nnValue.ts'
import type { Action, Game } from '../src/game/types.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dir, '../src/game/data/nn-value.json')

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1]! : fallback
}

const games = Number(arg('--games', '1200'))
const teacher = arg('--teacher', 'full') as AiSearchMode
const epochs = Number(arg('--epochs', '3'))

function candidatesLikeNeural(state: Game, actor: number, teacherAction: Action): Action[] {
  // Re-query teacher alternatives by asking neural candidate space via replaying teacher mode options:
  // cheap approach — include teacher + draw/end + a few hand plays already considered by teacher path.
  const out: Action[] = [teacherAction]
  if (teacherAction.type !== 'draw') out.push({ type: 'draw' })
  if (teacherAction.type !== 'end') out.push({ type: 'end' })
  const hand = state.players[actor]?.hand ?? []
  for (const card of hand) {
    if (card.kind === 'terrain') continue
    if (teacherAction.type === 'play' && teacherAction.uid === card.uid) continue
    out.push({ type: 'play', uid: card.uid, team: 'new' })
    if (out.length >= 8) break
  }
  return out
}

function playGame(seed: number, model: NnModel): number {
  let game = createGame({ seed, seats: aiRoster(2, undefined, seed) })
  let samples = 0
  let steps = 0
  while (!game.over && steps < 700) {
    steps += 1
    try {
      if (game.veil) {
        game = apply(game, { type: 'ready' })
        continue
      }
      if (game.pending) {
        const ids = teacher === 'challenge' ? chooseAiPendingChallenge(game) : chooseAiPending(game)
        game = apply(game, { type: 'choose', ids })
        continue
      }
      const actor = game.active
      const before = game
      const action = chooseAiAction(game, teacher)
      // Imitation sample
      const stateFeats = encodeStateFeatures(before, actor)
      const teacherFeats = encodeActionFeatures(before, actor, action)
      for (const other of candidatesLikeNeural(before, actor, action)) {
        if (other === action) continue
        if (other.type === action.type && JSON.stringify(other) === JSON.stringify(action)) continue
        trainPair(model, stateFeats, teacherFeats, encodeActionFeatures(before, actor, other), 0.0015)
        samples += 1
      }
      game = apply(game, action)
    } catch {
      break
    }
  }
  return samples
}

console.log(`Training NN — games=${games} teacher=${teacher} epochs=${epochs}`)
let model = randomModel(48, 42)
let totalSamples = 0
for (let epoch = 0; epoch < epochs; epoch += 1) {
  let epochSamples = 0
  const t0 = Date.now()
  for (let g = 0; g < games; g += 1) {
    epochSamples += playGame(10_000 + epoch * games + g, model)
    if ((g + 1) % 100 === 0) {
      console.log(`  epoch ${epoch + 1} game ${g + 1}/${games} samples=${epochSamples}`)
    }
  }
  totalSamples += epochSamples
  console.log(`epoch ${epoch + 1} done in ${((Date.now() - t0) / 1000).toFixed(1)}s samples=${epochSamples}`)
}

model = hydrateModel(model)
model.trainedGames = games * epochs
model.trainedSamples = totalSamples
model.note = `imitate ${teacher}; ${games}×${epochs} games; ${new Date().toISOString()}`

writeFileSync(outPath, JSON.stringify(model))
console.log(`Wrote ${outPath}`)
console.log(`trainedGames=${model.trainedGames} trainedSamples=${model.trainedSamples}`)
