import { useState } from 'react'
import { isTrapHero } from '../game/flow.ts'
import { promptCopy } from '../game/promptCopy.ts'
import type { Choice, Pending } from '../game/types.ts'
import { CardArt } from './CardArt.tsx'
import { CardFace } from './CardFace.tsx'

export function Prompt({
  pending,
  names,
  onChoose,
  revealTraps = false,
}: {
  pending: Pending
  names: string[]
  onChoose: (ids: string[]) => void
  /** Ability Lab / debug may show trap card art; normal matches keep traps secret. */
  revealTraps?: boolean
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [bucket, setBucket] = useState<Record<string, string>>({})
  const grouped = pending.mode === 'split' || pending.mode === 'assign' || pending.mode === 'groups'
  const copy = promptCopy(pending)
  const hiddenTrap = !!copy.artId && isTrapHero(copy.artId) && !revealTraps
  const artId = hiddenTrap ? null : copy.artId
  const mark = artId ? null : copy.mark ?? (hiddenTrap ? 'T' : null)
  const count =
    grouped ? 'Assign every card.'
    : pending.max === 1 ? null
    : pending.min === pending.max ? `Pick ${pending.min}.`
    : `Pick ${pending.min}–${pending.max}.`

  function toggle(id: string) {
    if (pending.max === 1) {
      onChoose([id])
      return
    }
    setPicked((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id)
      if (current.length >= pending.max) return current
      return [...current, id]
    })
  }

  const groupReady = pending.choices.every((choice) => bucket[choice.id])
  const pickReady = picked.length >= pending.min && picked.length <= pending.max

  return (
    <div className="scrim prompt-dock">
      <section className="sheet" role="dialog" aria-labelledby="prompt-title">
        <div className="prompt-action">
          {copy.action ? (
            <>
              {artId ? (
                <CardArt defId={artId} size="icon" className="prompt-action-art" />
              ) : mark ? (
                <span className="prompt-mark" aria-hidden>{mark}</span>
              ) : null}
              <p className="prompt-action-text" data-testid="prompt-action">{copy.action}</p>
            </>
          ) : null}
          <h2 id="prompt-title" className="prompt-ask" data-testid="prompt">{copy.ask}</h2>
          {count ? <p className="quiet">{count}</p> : null}
        </div>
        <div className="choices">
          {pending.choices.map((choice) => {
            const on = picked.includes(choice.id)
            if (!grouped && pending.max === 1) {
              return (
                <button key={choice.id} type="button" className={`choice${choice.team ? ' choice-team' : ''}${on ? ' on' : ''}`} onClick={() => toggle(choice.id)}>
                  <ChoiceBody choice={choice} />
                </button>
              )
            }
            return (
              <div key={choice.id} className={`choice${choice.team ? ' choice-team' : ''}${on ? ' on' : ''}`}>
                <ChoiceBody choice={choice} />
                <div className="choice-copy">
                  {grouped ? (
                    <div className="segment">
                      {segments(pending.mode, names).map((segment) => (
                        <button
                          key={segment.value}
                          type="button"
                          className={bucket[choice.id] === segment.value ? 'on' : ''}
                          onClick={() => setBucket((current) => ({ ...current, [choice.id]: segment.value }))}
                        >
                          {segment.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button type="button" onClick={() => toggle(choice.id)}>
                      {on ? 'Selected' : 'Select'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {pending.choices.length === 0 ? <p className="quiet">Nothing can be chosen.</p> : null}
        {grouped ? (
          <button type="button" className="primary" disabled={!groupReady} onClick={() => onChoose(pending.choices.map((choice) => `${bucket[choice.id]}:${choice.id}`))}>
            Confirm
          </button>
        ) : pending.max === 1 ? null : (
          <button type="button" className="primary" disabled={!pickReady} onClick={() => onChoose(picked)} data-testid="confirm-choice">
            Confirm {picked.length}/{pending.max}
          </button>
        )}
      </section>
    </div>
  )
}

function ChoiceBody({ choice }: { choice: Choice }) {
  if (choice.team) {
    return (
      <span className="choice-grid">
        <strong>{choice.label}</strong>
        <span>{choice.hint}</span>
        <strong>{choice.team}</strong>
        <span>{choice.bonus || 'No bonus'}</span>
      </span>
    )
  }
  return (
    <>
      {choice.defId ? <CardFace defId={choice.defId} compact /> : null}
      <span className="choice-copy">
        <strong>{choice.label}</strong>
        {choice.hint ? <small>{choice.hint}</small> : null}
      </span>
    </>
  )
}

function segments(mode: Pending['mode'], names: string[]): { value: string; label: string }[] {
  if (mode === 'split') return [{ value: 'a', label: 'Pile A' }, { value: 'b', label: 'Pile B' }]
  if (mode === 'assign') return names.map((name, index) => ({ value: String(index), label: name }))
  return [
    { value: '0', label: 'Group 1' },
    { value: '1', label: 'Group 2' },
    { value: '2', label: 'Group 3' },
  ]
}
