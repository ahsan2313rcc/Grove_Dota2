import { describe, expect, it } from 'vitest'
import { promptCopy } from './promptCopy.ts'

describe('prompt copy', () => {
  it('strips the ability text out of the title and keeps it as the rule', () => {
    const text = 'Destroy target enemy hero.'
    const copy = promptCopy({
      prompt: `Radiant's Laguna Blade is about to fire. Target: Lion. ${text} Interrupt, or pass.`,
      mode: 'pick',
      min: 1,
      max: 1,
      about: { defId: 'lina', name: 'Lina', spell: 'Laguna Blade', text },
    })
    expect(copy.title).not.toContain(text)
    expect(copy.title).toMatch(/Laguna Blade/)
    expect(copy.rule).toBe(text)
    expect(copy.count).toBeNull()
  })

  it('asks for a range only when more than one card is required', () => {
    const copy = promptCopy({ prompt: 'Discard down to 7.', mode: 'pick', min: 2, max: 4 })
    expect(copy.count).toBe('Pick 2–4.')
  })
})
