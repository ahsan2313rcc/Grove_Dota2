import { display } from '../game/catalog.ts'
import { attrsOf, enterReason, findHero, graveLocked, itemsLocked, rangeOf, scoreTeam, TEAM_CAP } from '../game/flow.ts'
import type { Attr, BoardHero, CardInst, Game, PlayerId, Range, Team } from '../game/types.ts'

export function opponentOf(game: Game, id: PlayerId): PlayerId {
  const next = (id + 1) % game.players.length
  return next
}

export function handRevealed(game: Game, viewer: PlayerId, target: PlayerId): boolean {
  if (viewer === target) return true
  return game.reveal.some((entry) => entry.viewer === viewer && entry.target === target && entry.turn === game.turn)
}

export function isCombo(cards: CardInst[]): boolean {
  if (cards.length !== 3 || cards.some((card) => card.kind !== 'setting')) return false
  const kinds = new Set(cards.map((card) => card.defId))
  if (kinds.size === 1) return true
  return kinds.size === 3
}

export function heroMarks(hero: BoardHero, team: Team): string[] {
  const marks: string[] = []
  if (hero.defId === 'meepo') marks.push('Counts as 2')
  if (hero.token) marks.push('Neutral')
  if (hero.roshan) marks.push('Roshan')
  if (hero.shield) marks.push('Shield')
  if (hero.ward) marks.push('Ward')
  if (hero.hidden) marks.push('Hidden')
  if (hero.bkb) marks.push('Black King Bar')
  if (hero.muted) marks.push('Orchid')
  if (hero.rupture) marks.push('Rupture')
  if (hero.dawn) marks.push('Dawn')
  if (hero.refract) marks.push('Refraction')
  if (hero.held) {
    const held = display(hero.held.card.defId).name
    marks.push(hero.held.mode === 'morph' ? `Holds ${held}` : `Static ${held}`)
  }
  if (team.glyph) marks.push('Glyph')
  if (team.gaze) marks.push('Gaze')
  if (team.noEnter) marks.push('No entry')
  if (team.noLeave) marks.push('No leaving')
  if (team.mine) marks.push('Mine')
  return marks
}

export function shownAttrs(game: Game, hero: BoardHero): Attr[] {
  return attrsOf(game, hero)
}

export function shownRange(hero: BoardHero): Range | null {
  return rangeOf(hero)
}

export function statusLines(game: Game, viewer: PlayerId): string[] {
  const lines: string[] = []
  const me = game.players[viewer]
  if (game.active === viewer && me.noHeroNow) lines.push('Doom: you cannot play heroes this turn.')
  if (me.skip) lines.push('You skip your next turn.')
  for (const player of game.players) {
    if (player.id !== viewer && player.skip) lines.push(`${player.name} skips their next turn.`)
  }
  if (game.lockPlay && game.lockPlay.caster !== viewer) lines.push('Chronosphere: you cannot play cards.')
  if (game.silence) lines.push('Global Silence: hero abilities do not fire.')
  if (game.naga) lines.push('Song of the Siren: heroes cannot be destroyed.')
  if (itemsLocked(game, viewer)) lines.push('Poison Nova: you cannot play items.')
  if (graveLocked(game, viewer)) lines.push('Muerta: you cannot take cards from the grave.')
  return lines
}

export function emberTargets(game: Game, uid: string): { id: string; label: string; ok: boolean; reason?: string }[] {
  const loc = findHero(game, uid)
  if (!loc) return []
  const actor = game.active
  const options = game.players[actor].teams
    .filter((team) => team.id !== loc.team.id)
    .map((team) => {
      const reason = enterReason(game, team, 1, false)
      const scored = scoreTeam(game, team)
      return { id: team.id, label: `${scored.why} · ${scored.points}`, ok: !reason, reason: reason ?? undefined }
    })
  const capped = game.players[actor].teams.length >= TEAM_CAP
  options.push({ id: 'new', label: 'New team', ok: !capped, reason: capped ? '12 teams is the limit.' : undefined })
  return options
}

export function playBlock(game: Game, viewer: PlayerId, card: CardInst): string | null {
  if (card.kind === 'setting') return 'Play three settings together.'
  if (game.lockPlay && game.lockPlay.caster !== viewer) return 'Chronosphere stops cards.'
  if (card.kind === 'hero' && game.players[viewer].noHeroNow) return 'Doom stops heroes.'
  if (card.kind === 'item' && itemsLocked(game, viewer)) return 'Poison Nova stops items.'
  if (!display(card.defId).instant && game.players[viewer].actions < 1) return 'No actions left.'
  return null
}
