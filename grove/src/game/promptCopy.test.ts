import { describe, expect, it } from 'vitest'
import { promptCopy } from './promptCopy.ts'

describe('prompt copy', () => {
  it('splits a draw response into the action and the ask', () => {
    const copy = promptCopy({
      prompt: 'Balanced draws. Instant now — pass this action, or pass the turn.',
      choices: [{ id: 'pass', label: 'Pass' }],
      resume: { kind: 'response' },
    })
    expect(copy.action).toBe('Balanced draws.')
    expect(copy.ask).toBe('Choose an instant or pass.')
    expect(copy.artId).toBeNull()
    expect(copy.mark).toBe('B')
  })

  it('puts the ability text in the action and the target ask underneath', () => {
    const copy = promptCopy({
      prompt: 'Whirling Death: Choose an enemy team.',
      choices: [{ id: 'team:a', label: 'Foe', team: 'Team A', bonus: 'STR x3' }],
      about: {
        defId: 'timbersaw',
        name: 'Timbersaw',
        spell: 'Whirling Death',
        text: 'Destroy all STR heroes in target enemy team.',
      },
      resume: { kind: 'cast', actor: 0, sourceUid: 'h', defId: 'timbersaw', picked: [] },
    })
    expect(copy.action).toBe('Whirling Death: Destroy all STR heroes in target enemy team.')
    expect(copy.ask).toBe('Choose an enemy team.')
    expect(copy.artId).toBe('timbersaw')
  })

  it('names the hero and a short ability line when you may activate it', () => {
    const copy = promptCopy({
      prompt: "Activate Timbersaw's ability (Destroy all Strength heroes in target enemy team)?",
      choices: [
        { id: 'yes', label: 'Activate' },
        { id: 'no', label: 'Leave it' },
      ],
      about: {
        defId: 'timbersaw',
        name: 'Timbersaw',
        spell: 'Whirling Death',
        text: 'Destroy all Strength heroes in target enemy team.',
      },
      resume: { kind: 'cast', actor: 0, sourceUid: 'h', defId: 'blink', picked: [] },
    })
    expect(copy.action).toBe("Activate Timbersaw's ability (Destroy all Strength heroes in target enemy team).")
    expect(copy.ask).toBe('Activate it, or leave it.')
    expect(copy.artId).toBe('timbersaw')
  })

  it('puts a locked target on the action line', () => {
    const copy = promptCopy({
      prompt: "Ravage: Choose Dire's team. Target: Dire's team A.",
      choices: [{ id: 'team:a', label: 'Dire', team: 'Team A', bonus: 'STR x1' }],
      about: {
        defId: 'tidehunter',
        name: 'Tidehunter',
        spell: 'Ravage',
        text: 'Return a team from each enemy to their hand. They each discard 5 cards.',
      },
      resume: { kind: 'cast', actor: 0, sourceUid: 'h', defId: 'tidehunter', picked: ['team:a'] },
    })
    expect(copy.action).toBe(
      "Ravage: Return a team from each enemy to their hand. They each discard 5 cards. Target: Dire's team A.",
    )
    expect(copy.ask).toBe("Choose Dire's team.")
  })

  it('keeps a plain discard as the ask when there is no separate action', () => {
    const copy = promptCopy({
      prompt: 'Discard down to 7.',
      choices: [],
      resume: { kind: 'limit', player: 0, then: 'end' },
    })
    expect(copy.action).toBeNull()
    expect(copy.ask).toBe('Discard down to 7.')
  })
})