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
    const trapped = game.players[0].teams.find((entry) => entry.id === team)
    expect(trapped?.trap?.defId).toBe('techies')
    expect(trapped?.heroes).toHaveLength(2)
  })

  it('reports heroes moving between your own teams', () => {
    expect(runLab('tp_scroll').changes.some((line) => line.startsWith('You teams:'))).toBe(true)
  })

  for (const card of labCards()) {
    it(`${card.name} resolves without losing cards or stalling`, () => {
      const result = runLab(card.defId)
      expect(result.issues).toEqual([])
    })
  }
})
