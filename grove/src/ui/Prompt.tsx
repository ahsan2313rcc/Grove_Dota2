import { useState } from 'react'
import type { Pending } from '../game/types.ts'
import { CardFace } from './CardFace.tsx'

export function Prompt({
  pending,
  names,
  onChoose,
}: {
  pending: Pending
  names: string[]
  onChoose: (ids: string[]) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [bucket, setBucket] = useState<Record<string, string>>({})
  const grouped = pending.mode === 'split' || pending.mode === 'assign' || pending.mode === 'groups'
  const exact = pending.min === pending.max
  const hint = exact ? `Choose ${pending.min}.` : `Choose ${pending.min} to ${pending.max}.`

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
    <div className="scrim">
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <p className="eyebrow">{names[pending.actor]} answers</p>
        <h2 id="prompt-title" data-testid="prompt">{pending.prompt}</h2>
        <p className="quiet">{grouped ? 'Assign every card.' : hint}</p>
        <div className="choices">
          {pending.choices.map((choice) => {
            const on = picked.includes(choice.id)
            const face = choice.defId ? <CardFace defId={choice.defId} compact /> : null
            if (!grouped && pending.max === 1) {
              return (
                <button key={choice.id} type="button" className={`choice${on ? ' on' : ''}`} onClick={() => toggle(choice.id)}>
                  {face}
                  <strong>{choice.label}</strong>
                  {choice.hint ? <small>{choice.hint}</small> : null}
                </button>
              )
            }
            return (
              <div key={choice.id} className={`choice${on ? ' on' : ''}`}>
                {face}
                <div className="choice-copy">
                  <strong>{choice.label}</strong>
                  {choice.hint ? <small>{choice.hint}</small> : null}
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

function segments(mode: Pending['mode'], names: string[]): { value: string; label: string }[] {
  if (mode === 'split') return [{ value: 'a', label: 'Pile A' }, { value: 'b', label: 'Pile B' }]
  if (mode === 'assign') return names.map((name, index) => ({ value: String(index), label: name }))
  return [
    { value: '0', label: 'Group 1' },
    { value: '1', label: 'Group 2' },
    { value: '2', label: 'Group 3' },
  ]
}
