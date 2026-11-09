import { display } from '../game/catalog.ts'
import type { Game, PlayerId } from '../game/types.ts'

/** Short action-bar lines for the seat you are watching. Not part of the match log. */
export function opponentTurnFeed(game: Game, viewer: PlayerId): string[] {
  if (game.over) return []
  const actor = game.active
  if (actor === viewer) return []
  const name = game.players[actor]?.name
  if (!name) return []
  let start = -1
  for (let index = game.log.length - 1; index >= 0; index -= 1) {
    if (game.log[index]!.startsWith(`${name}'s turn.`)) {
      start = index
      break
    }
  }
  if (start < 0) return []
  const groups: string[][] = []
  for (const line of game.log.slice(start + 1)) {
    if (isPlayLine(line, name)) groups.push([line])
    else if (groups.length > 0) groups[groups.length - 1]!.push(line)
  }
  return groups.map((group) => blurb(group, game, actor, name)).filter((line): line is string => !!line)
}

function isPlayLine(line: string, name: string): boolean {
  return (
    line.startsWith(`${name} plays`)
    || line.startsWith(`${name} fields`)
    || line.startsWith(`${name} calls`)
    || line.startsWith(`${name} draws`)
    || line.startsWith(`${name} sets`)
    || line.startsWith(`${name} discards`)
  )
}

function blurb(lines: string[], game: Game, actor: PlayerId, name: string): string | null {
  const main = lines.find((line) => isPlayLine(line, name))
  if (!main) return null
  if (main.startsWith(`${name} draws`)) {
    const count = /draws (\d+)/.exec(main)
    return count ? `Opponent draws ${count[1]}.` : 'Opponent draws.'
  }
  if (main.startsWith(`${name} sets `)) {
    const what = main.slice(`${name} sets `.length).replace(/\.$/, '')
    return `Opponent sets ${what}.`
  }
  if (main.startsWith(`${name} discards`)) {
    const card = /discards (.+?)(?:\.|$)/.exec(main)?.[1] ?? 'a card'
    return `Opponent discards ${card}.`
  }
  const played = /(?:plays Instant|plays|fields|calls Instant|calls) ([^.—]+?)(?: — .+)?\.$/.exec(main)
  if (!played) return null
  const card = played[1]!.trim()
  const verb = /fields /.test(main) ? 'fields' : /calls /.test(main) ? 'calls' : 'plays'
  const team = teamLetter(game, actor, card)
  const effects = outcomes(lines)
  const where = team ? ` in Team ${team}` : ''
  const extra = effects.length > 0 ? ` (${effects.join(', ')})` : ''
  return `Opponent ${verb} ${card}${where}${extra}.`
}

function teamLetter(game: Game, actor: PlayerId, cardName: string): string | null {
  const teams = game.players[actor]?.teams ?? []
  const index = teams.findIndex((team) => team.heroes.some((hero) => display(hero.defId).name === cardName))
  if (index < 0 || index >= 26) return null
  return String.fromCharCode(65 + index)
}

function outcomes(lines: string[]): string[] {
  const found: string[] = []
  for (const line of lines) {
    const exiled = /^(?:.+?'s )?(.+?) is exiled\.$/.exec(line)
    if (exiled) {
      found.push(`exiles ${exiled[1]}`)
      continue
    }
    const exileVerb = /exiles (.+?)(?:\.|$)/.exec(line)
    if (exileVerb) {
      found.push(`exiles ${bareName(exileVerb[1]!)}`)
      continue
    }
    const destroyed = /destroys (.+)$/.exec(line)
    if (destroyed) {
      found.push(`destroys ${bareName(destroyed[1]!)}`)
      continue
    }
    const returned = /^(.+?) returns to /.exec(line)
    if (returned) found.push(`returns ${bareName(returned[1]!.replace(/^.+?: /, ''))}`)
  }
  return [...new Set(found)].slice(0, 3)
}

function bareName(text: string): string {
  return text.replace(/\.$/, '').replace(/^.+?'s /, '')
}
