/**
 * Browser / runtime memory for the Neural strat weights.
 * Debug training updates this in-session; Save / Clear persist or wipe it.
 */
import { hydrateModel, markWeightsChanged, randomModel, setActiveModel, type NnModel } from './nnValue.ts'
import baked from './data/nn-value.json'

const STORAGE_KEY = 'grove.nn-value.v2'
const LEGACY_KEYS = ['grove.nn-value.v1']

export type NnMemoryInfo = {
  trainedGames: number
  trainedSamples: number
  recentLoss: number
  note: string
  persisted: boolean
}

const fromBaked = () => hydrateModel(structuredClone(baked))

let memory: NnModel = fromBaked()
setActiveModel(memory)

export function getNnMemory(): NnModel {
  return memory
}

export function nnMemoryInfo(): NnMemoryInfo {
  return {
    trainedGames: memory.trainedGames,
    trainedSamples: memory.trainedSamples,
    recentLoss: memory.recentLoss,
    note: memory.note,
    persisted: typeof localStorage !== 'undefined' && !!localStorage.getItem(STORAGE_KEY),
  }
}

/** Load from localStorage if present, else the baked checkpoint. Activates weights for play. */
export function bootNnMemory(): NnMemoryInfo {
  if (typeof localStorage !== 'undefined') {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        memory = hydrateModel(JSON.parse(raw))
        setActiveModel(memory)
        return nnMemoryInfo()
      } catch {
        // fall through to baked
      }
    }
  }
  memory = fromBaked()
  setActiveModel(memory)
  return nnMemoryInfo()
}

export function replaceNnMemory(model: NnModel) {
  memory = model
  markWeightsChanged()
  setActiveModel(memory)
}

/** Persist current memory to localStorage. */
export function saveNnMemory(): NnMemoryInfo {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(roundModel(memory)))
    } catch {
      // Quota exceeded — keep training in memory; Export still works.
    }
  }
  setActiveModel(memory)
  return nnMemoryInfo()
}

/** Five significant decimals keep the JSON small without changing play. */
export function roundModel(model: NnModel): NnModel {
  const r = (x: number) => Math.round(x * 1e5) / 1e5
  return { ...model, w1: model.w1.map(r), b1: model.b1.map(r), w2: model.w2.map(r), wl: model.wl.map(r), b2: r(model.b2) }
}

/**
 * Download current weights as `nn-value.json` for committing to git.
 * Drop the file at `grove/src/game/data/nn-value.json` and commit.
 */
export function downloadNnMemoryForGit(): NnMemoryInfo {
  setActiveModel(memory)
  if (typeof document === 'undefined') return nnMemoryInfo()
  const blob = new Blob([JSON.stringify(roundModel(memory))], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'nn-value.json'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return nnMemoryInfo()
}

/** Wipe trained weights back to the baked checkpoint, or to a fresh heuristic-prior net. */
export function clearNnMemory(fresh = false): NnMemoryInfo {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  memory = fresh ? randomModel(48, Date.now() % 1_000_000) : fromBaked()
  memory.note = fresh ? 'cleared → fresh (heuristic prior)' : 'cleared → baked checkpoint'
  markWeightsChanged()
  setActiveModel(memory)
  return nnMemoryInfo()
}
