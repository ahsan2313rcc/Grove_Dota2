import { describe, expect, it } from 'vitest'
import { apply, createGame } from '../game/engine.ts'
import type { CardInst } from '../game/types.ts'
import { handGlow } from './present.ts'

function card(partial: Partial<CardInst> & Pick<CardInst, 'defId' | 'kind'>): CardInst {
  return { uid: partial.uid ?? partial.defId, defId: partial.defId, kind: partial.kind }
}

describe('hand glow', () => {
  it('outlines instant and on-play rewards and items, plus cards that are free this turn', () => {
    const game = apply(createGame({ seed: 1, mode: 'hotseat', names: ['You', 'Foe'] }), { type: 'ready' })
    expect(handGlow(game, 0, card({ defId: 'bkb', kind: 'item' }))).toBe(true)
    expect(handGlow(game, 0, card({ defId: 'arcane', kind: 'rune' }))).toBe(true)
    expect(handGlow(game, 0, card({ defId: 'roshan', kind: 'neutral' }))).toBe(true)
    expect(handGlow(game, 0, card({ defId: 'glyph', kind: 'tower' }))).toBe(true)
    expect(handGlow(game, 0, card({ defId: 'lotus', kind: 'tower' }))).toBe(false)
    expect(handGlow(game, 0, card({ defId: 'clarity', kind: 'item' }))).toBe(false)
    const freeHero = card({ uid: 'free-hero', defId: 'axe', kind: 'hero' })
    expect(handGlow({ ...game, freePlay: ['free-hero'] }, 0, freeHero)).toBe(true)
    const clarity = card({ uid: 'free-item', defId: 'clarity', kind: 'item' })
    expect(handGlow({ ...game, freeItems: 1 }, 0, clarity)).toBe(true)
  })
})
