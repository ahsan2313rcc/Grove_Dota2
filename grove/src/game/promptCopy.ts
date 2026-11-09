import type { Pending } from './types.ts'

/** Action (what just happened) and the ask (what to choose) for a prompt dock. */
export function promptCopy(pending: Pick<Pending, 'prompt' | 'choices' | 'about' | 'resume'>): {
  action: string | null
  ask: string
  artId: string | null
  mark: string | null
} {
  if (pending.resume.kind === 'response') {
    const sentence = pending.prompt.split(/Instant now/i)[0]?.trim() ?? pending.prompt.trim()
    const action = /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
    return {
      action,
      ask: 'Choose an instant or pass.',
      artId: pending.about?.defId ?? null,
      mark: pending.about?.defId ? null : action.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || null,
    }
  }

  const named = pending.prompt.trim().match(/^Activate (.+?)'s ability \((.+)\)\??$/)
  if (named) {
    const detail = named[2]!.replace(/[.!?]+$/, '')
    return {
      action: `Activate ${named[1]}'s ability (${detail}).`,
      ask: 'Activate it, or leave it.',
      artId: pending.about?.defId ?? null,
      mark: null,
    }
  }

  if (pending.resume.kind === 'instant-window' && pending.about) {
    return {
      action: abilityLine(pending),
      ask: 'Choose an instant or pass.',
      artId: pending.about.defId,
      mark: null,
    }
  }

  if (pending.about) {
    return {
      action: abilityLine(pending),
      ask: chooseSentence(pending),
      artId: pending.about.defId,
      mark: null,
    }
  }

  return { action: null, ask: tidy(pending.prompt), artId: null, mark: null }
}

function abilityLine(pending: Pick<Pending, 'prompt' | 'about'>): string {
  const about = pending.about!
  const spell = about.spell ?? about.name
  const target = pending.prompt.match(/Target:\s*([^.]+)/i)
  const effect = about.text.trim().replace(/\.$/, '')
  const line = `${spell}: ${effect}`
  return target ? `${line}. Target: ${target[1]!.trim()}.` : `${line}.`
}

function chooseSentence(pending: Pick<Pending, 'prompt' | 'choices' | 'about'>): string {
  const prompt = pending.prompt
  const match = prompt.match(
    /(?:^|[.:—–-]\s*)(Choose\b[^.]*(?:\.|$)|Discard\b[^.]*(?:\.|$)|Pick\b[^.]*(?:\.|$)|Assign\b[^.]*(?:\.|$)|Split\b[^.]*(?:\.|$)|Give\b[^.]*(?:\.|$)|Place\b[^.]*(?:\.|$)|Interrupt,[^.]*(?:\.|$))/i,
  )
  if (match?.[1]) return tidy(match[1])
  const ids = pending.choices.map((choice) => choice.id)
  const teams = ids.some((id) => id.startsWith('team:'))
  const heroes = ids.some((id) => id.startsWith('hero:'))
  const enemy = /enemy/i.test(prompt)
  if (teams && !heroes) return enemy ? 'Choose an enemy team.' : 'Choose a team.'
  if (heroes && !teams) return enemy ? 'Choose an enemy hero.' : 'Choose a hero.'
  let rest = prompt
  const spell = pending.about?.spell ?? pending.about?.name
  if (spell) rest = rest.replace(new RegExp(escapeRe(spell), 'ig'), ' ')
  if (pending.about?.name) rest = rest.replace(new RegExp(escapeRe(pending.about.name), 'ig'), ' ')
  if (pending.about?.text) rest = rest.replace(pending.about.text, ' ')
  rest = rest.replace(/Target:\s*[^.]+/ig, ' ')
  return tidy(rest || prompt)
}

function tidy(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').replace(/^[:.\-—\s]+/, '').trim()
  if (!cleaned) return ''
  const capped = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  return /[.!?]$/.test(capped) ? capped : `${capped}.`
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
