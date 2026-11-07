import { describe, expect, it } from 'vitest'
import { buildLab, census, labCards, runLab } from './lab.ts'

describe('ability lab', () => {
  it('deals a board where every card is in exactly one place', () => {
    const { game, uid } = buildLab('lina')
    expect(uid).not.toBe('')
    expect([...census(game).values()].every((count) => count === 1)).toBe(true)
  })

  it('plants trap cards on your first team and hands you an entrant', () => {
    const { game, team } = buildLab('techies')
    expect(game.players[0].teams.find((entry) => entry.id === team)?.trap?.defId).toBe('techies')
  })

  for (const card of labCards()) {
    it(`${card.name} resolves without losing cards or stalling`, () => {
      const result = runLab(card.defId)
      expect(result.issues).toEqual([])
    })
  }
})
