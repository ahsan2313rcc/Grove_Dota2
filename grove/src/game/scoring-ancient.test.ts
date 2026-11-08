import { describe, expect, it } from 'vitest'
import { apply, createGame } from './engine.ts'
import { blankTeam, makeCard, makeHero, scoreState, setPlayer } from './flow.ts'
import { DEFAULT_SCORE_RULES, resetScoreRules, setScoreRules } from './scoring.ts'
import type { CardInst } from './types.ts'

describe('ancientBonus rules', () => {
  it('scores the configured Ancient controller bonus', () => {
    resetScoreRules()
    let game = apply(createGame({ seed: 9, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    let card: CardInst
    ;[game, card] = makeCard(game, 'ancient', 'ancient')
    game = setPlayer(game, 0, (seat) => ({
      ...seat,
      teams: [{ ...blankTeam('anc'), heroes: [makeHero(card, 0, 0, game)] }],
    }))
    const base = scoreState(game, 0).total
    setScoreRules({ ...DEFAULT_SCORE_RULES, ancientBonus: 25 })
    expect(scoreState(game, 0).total).toBe(base - DEFAULT_SCORE_RULES.ancientBonus + 25)
    resetScoreRules()
  })
})
