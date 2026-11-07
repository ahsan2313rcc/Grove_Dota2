import { describe, expect, it } from 'vitest'
import { apply } from './engine.ts'
import { buildLab, census, LAB_BROKEN, LAB_FLAGGED, labCards, runLab } from './lab.ts'

describe('ability lab', () => {
  it('explains broken vs flagged criteria', () => {
    expect(LAB_BROKEN).toMatch(/refused|prompt stayed open|vanished/i)
    expect(LAB_FLAGGED).toMatch(/suspicious|fizzle|Instant window/i)
  })

  it('deals a board where every card is in exactly one place', () => {
    const { game, uid } = buildLab('lina')
    expect(uid).not.toBe('')
    expect([...census(game).values()].every((count) => count === 1)).toBe(true)
  })

  it('includes neutrals in the lab list', () => {
    expect(labCards().some((card) => card.defId === 'roshan' && card.kind === 'neutral')).toBe(true)
    expect(buildLab('roshan').uid).not.toBe('')
  })

  it('attaches ability context to targeting prompts', () => {
    const { game, uid } = buildLab('lina')
    let next = apply(game, { type: 'play', uid, team: 'new' })
    let guard = 0
    while (next.pending && next.pending.resume.kind !== 'cast' && guard++ < 20) {
      const pick = next.pending.choices.find((choice) => choice.id === 'pass') ?? next.pending.choices[0]
      if (!pick) break
      next = apply(next, { type: 'choose', ids: [pick.id] })
    }
    expect(next.pending?.resume.kind).toBe('cast')
    expect(next.pending?.about?.defId).toBe('lina')
    expect(next.pending?.about?.spell).toMatch(/Laguna/i)
    expect(next.pending?.about?.text.length).toBeGreaterThan(8)
    expect(next.pending?.prompt).toMatch(/Laguna|Choose/i)
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
