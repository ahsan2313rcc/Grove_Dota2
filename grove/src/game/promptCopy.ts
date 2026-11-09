import type { Pending } from './types.ts'

/** Short ask for the prompt title, with the ability text kept once beside it. */
export function promptCopy(pending: Pick<Pending, 'prompt' | 'mode' | 'min' | 'max' | 'about'>): {
  title: string
  rule: string | null
  count: string | null
} {
  const rule = pending.about?.text?.trim() || null
  let title = pending.prompt.trim()
  if (rule && title.includes(rule)) {
    title = title.replace(rule, ' ')
  }
  title = title.replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/([.!?])\s*\1+/g, '$1').trim()
  const grouped = pending.mode === 'split' || pending.mode === 'assign' || pending.mode === 'groups'
  const count = grouped
    ? 'Assign every card.'
    : pending.max === 1
      ? null
      : pending.min === pending.max
        ? `Pick ${pending.min}.`
        : `Pick ${pending.min}–${pending.max}.`
  return { title, rule: rule && rule !== title ? rule : null, count }
}
