/** Classic Elo for 2+ seats. Multiplayer uses score-rank outcomes. */

export const START_MMR = 1000
export const K_FACTOR = 32

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400))
}

/** Two-player Elo update. scoreA is 1 win, 0.5 draw, 0 loss. */
export function eloPair(a: number, b: number, scoreA: number): { a: number; b: number; deltaA: number; deltaB: number } {
  const expA = expectedScore(a, b)
  const expB = 1 - expA
  const deltaA = Math.round(K_FACTOR * (scoreA - expA))
  const deltaB = Math.round(K_FACTOR * (1 - scoreA - expB))
  return { a: a + deltaA, b: b + deltaB, deltaA, deltaB }
}

/**
 * Multiplayer Elo: each seat is scored against the field average.
 * Rank scores: best = 1, worst = 0, ties share.
 */
export function eloField(ratings: number[], finals: number[]): { next: number[]; deltas: number[] } {
  const n = ratings.length
  if (n === 0) return { next: [], deltas: [] }
  if (n === 2) {
    const tied = finals[0] === finals[1]
    const scoreA = tied ? 0.5 : finals[0]! > finals[1]! ? 1 : 0
    const pair = eloPair(ratings[0]!, ratings[1]!, scoreA)
    return { next: [pair.a, pair.b], deltas: [pair.deltaA, pair.deltaB] }
  }

  const order = finals.map((score, index) => ({ score, index }))
  order.sort((a, b) => b.score - a.score)
  const rankScore = Array.from({ length: n }, () => 0)
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && order[j + 1]!.score === order[i]!.score) j += 1
    const share = (n - 1 - i + (n - 1 - j)) / 2 / Math.max(1, n - 1)
    for (let k = i; k <= j; k += 1) rankScore[order[k]!.index] = share
    i = j + 1
  }

  const avg = ratings.reduce((sum, value) => sum + value, 0) / n
  const next = ratings.map((rating, index) => {
    const exp = expectedScore(rating, avg)
    const delta = Math.round(K_FACTOR * (rankScore[index]! - exp))
    return rating + delta
  })
  return { next, deltas: next.map((value, index) => value - ratings[index]!) }
}
