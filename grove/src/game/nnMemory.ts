/**
 * Browser / runtime memory for the Neural strat weights.
 * Debug "Train Neural" updates this in-session; Save / Clear persist or wipe it.
 */
import {
  hydrateModel,
  randomModel,
  setActiveModel,
  type NnModel,
} from './nnValue.ts'
import baked from './data/nn-value.json'

const STORAGE_KEY = 'grove.nn-value.v1'

export type NnMemoryInfo = {
  trainedGames: number
  trainedSamples: number
  note: string
  persisted: boolean
}

let memory: NnModel = hydrateModel(baked as NnModel)

export function getNnMemory(): NnModel {
  return memory
}

export function nnMemoryInfo(): NnMemoryInfo {
  return {
    trainedGames: memory.trainedGames,
    trainedSamples: memory.trainedSamples,
    note: memory.note,
    persisted: typeof localStorage !== 'undefined' && !!localStorage.getItem(STORAGE_KEY),
  }
}

/** Load from localStorage if present, else baked JSON. Activates weights for play. */
export function bootNnMemory(): NnMemoryInfo {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        memory = hydrateModel(JSON.parse(raw) as NnModel)
        setActiveModel(memory)
        return nnMemoryInfo()
      } catch {
        // fall through
      }
    }
  }
  memory = hydrateModel(baked as NnModel)
  if (!memory.w1.length) memory = randomModel(48, 7)
  setActiveModel(memory)
  return nnMemoryInfo()
}

export function replaceNnMemory(model: NnModel) {
  memory = hydrateModel(model)
  setActiveModel(memory)
}

/** Persist current memory to localStorage. */
export function saveNnMemory(): NnMemoryInfo {
  memory.note = `saved ${new Date().toISOString()}`
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  }
  setActiveModel(memory)
  return nnMemoryInfo()
}

/**
 * Download current weights as `nn-value.json` for committing to git.
 * Browser cannot push to git; drop the file at `grove/src/game/data/nn-value.json` and commit.
 */
export function downloadNnMemoryForGit(): NnMemoryInfo {
  memory.note = `export for git ${new Date().toISOString()}`
  setActiveModel(memory)
  if (typeof document === 'undefined') return nnMemoryInfo()
  const blob = new Blob([JSON.stringify(memory)], { type: 'application/json' })
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

/** Wipe trained weights back to baked / fresh random. */
export function clearNnMemory(fresh = false): NnMemoryInfo {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  memory = fresh ? randomModel(48, Date.now() % 1_000_000) : hydrateModel(baked as NnModel)
  if (!memory.w1.length) memory = randomModel(48, 7)
  memory.trainedGames = 0
  memory.trainedSamples = 0
  memory.note = fresh ? 'cleared → fresh random' : 'cleared → baked checkpoint'
  setActiveModel(memory)
  return nnMemoryInfo()
}
