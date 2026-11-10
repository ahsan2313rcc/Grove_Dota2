import { display } from '../game/catalog.ts'
import { allLocs, attrsOf, graveLocked, instantsLocked, itemsLocked, rangeOf } from '../game/flow.ts'
import { getScoreRules } from '../game/scoring.ts'
import type { Attr, BoardHero, CardInst, Game, PlayerId, Range } from '../game/types.ts'

export function opponentOf(game: Game, id: PlayerId): PlayerId {
  const next = (id + 1) % game.players.length
  return next
}

export function handRevealed(game: Game, viewer: PlayerId, target: PlayerId): boolean {
  if (viewer === target) return true
  return game.reveal.some((entry) => entry.viewer === viewer && entry.target === target && entry.turn === game.turn)
}

export function isCombo(cards: CardInst[]): boolean {
  if (cards.length !== 3 || cards.some((card) => card.kind !== 'terrain')) return false
  const kinds = new Set(cards.map((card) => card.defId))
  if (kinds.size === 1) return true
  return kinds.size === 3
}

export function heroMarks(hero: BoardHero): string[] {
  const marks: string[] = []
  if (hero.defId === 'meepo') marks.push('+1 / terrain type')
  if (hero.token) marks.push('Neutral')
  if (hero.roshan) marks.push('Roshan')
  if (hero.shield) marks.push('Shield')
  if (hero.ward) marks.push('Cannot be destroyed')
  if (hero.hidden) marks.push('Hidden')
  if (hero.bkb) marks.push('Black King Bar')
  if (hero.tether !== null) marks.push('Tether')
  if (hero.muted) marks.push('Orchid')
  if (hero.rupture) marks.push('Rupture')
  if (hero.dawn) marks.push('Dawn')
  if (hero.held) {
    const held = display(hero.held.card.defId).name
    marks.push(hero.held.mode === 'morph' ? `Holds ${held}` : `Static ${held}`)
  }
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
  if (me.noHeroNow) lines.push('You cannot play hero cards this turn. Abilities already in play can still be reactivated.')
  if (me.skip) lines.push('You skip your next turn.')
  for (const player of game.players) {
    if (player.id !== viewer && player.skip) lines.push(`${player.name} skips their next turn.`)
  }
  if (game.lockPlay && game.lockPlay.caster !== viewer) lines.push('Chronosphere: you cannot play cards.')
  if (game.silence) lines.push('Global Silence: hero abilities do not fire.')
  if (me.orchid) lines.push('Orchid: you cannot activate abilities.')
  if (game.naga) lines.push('Song of the Siren: heroes cannot be destroyed.')
  if (itemsLocked(game, viewer)) lines.push('Doom: you cannot play items.')
  if (instantsLocked(game, viewer)) lines.push('Battle Trance: you cannot play Instant cards.')
  if (game.noDraw && game.noDraw.caster !== viewer) lines.push("Berserker's Call: you cannot draw.")
  if (game.attrBan && game.attrBan.caster !== viewer) {
    lines.push(`Reaper's Scythe: ${game.attrBan.attr} heroes are banned while Necrophos remains.`)
  }
  if (graveLocked(game, viewer)) lines.push('Muerta: you cannot take cards from the grave.')
  if (game.ancient) {
    const holder = allLocs(game).find((loc) => loc.hero.defId === 'ancient')?.hero.controller
    const pts = getScoreRules().ancientBonus
    const bonus =
      holder === undefined
        ? ' (not on the board)'
        : holder === viewer
          ? ` (+${pts} yours)`
          : ` (+${pts} ${game.players[holder]?.name ?? 'seat'})`
    lines.push(`Ancient revealed${bonus}. Final round: ${game.ancient.endsLeft} turn${game.ancient.endsLeft === 1 ? '' : 's'} left.`)
  }
  if (game.winScore) {
    for (const hold of game.holds ?? []) {
      const who = hold.seat === viewer ? 'You hold' : `${game.players[hold.seat]?.name ?? 'A seat'} holds`
      lines.push(`${who} the target ${game.winScore}: wins at their next turn unless someone reaches it or knocks them below.`)
    }
  }
  if (game.active !== viewer && !game.over && !instantsLocked(game, viewer)) {
    lines.push('You may play Instant cards to interrupt.')
  }
  return lines
}

export function playBlock(game: Game, viewer: PlayerId, card: CardInst): string | null {
  if (card.kind === 'terrain') return 'Play three terrains together.'
  if (card.kind === 'ancient' || card.defId === 'ancient') return 'The Ancient cannot be played.'
  if (game.lockPlay && game.lockPlay.caster !== viewer) return 'Chronosphere stops cards.'
  const catalogInstant = display(card.defId).instant
  const freeGrant = game.freePlay.includes(card.uid)
  const freeItem =
    card.kind === 'item' &&
    (game.freeItems > 0 || game.clinkzExile.some((entry) => entry.uid === card.uid) || freeGrant)
  const primalFree =
    card.kind === 'item' && !!game.primalItems && game.primalItems.caster === viewer
  const instant = catalogInstant || freeItem || primalFree || freeGrant
  const offTurn = game.active !== viewer
  if (offTurn && !instant) return "Only Instant cards play on an opponent's turn."
  if (catalogInstant && instantsLocked(game, viewer)) return 'Battle Trance stops Instant cards.'
  if (card.kind === 'hero' && game.players[viewer].noHeroNow) return 'You cannot play hero cards this turn.'
  if (card.kind === 'item' && itemsLocked(game, viewer)) return 'Doom stops items.'
  if (!instant && game.players[viewer].actions < 1) return 'No actions left.'
  return null
}

/** True when this card plays as Instant (catalog, Clinkz/Amplify free item, or Primal Beast). */
export function playsAsInstant(game: Game, viewer: PlayerId, card: CardInst): boolean {
  if (display(card.defId).instant) return true
  if (game.freePlay.includes(card.uid)) return true
  if (card.kind === 'item' && (game.freeItems > 0 || game.clinkzExile.some((entry) => entry.uid === card.uid))) return true
  if (card.kind === 'item' && game.primalItems?.caster === viewer) return true
  return false
}

/** Hand outline: instant or on-play rune, neutral, tower, and item cards, plus anything free this turn. */
export function handGlow(game: Game, viewer: PlayerId, card: CardInst): boolean {
  const info = display(card.defId)
  const pile = info.kind === 'rune' || info.kind === 'neutral' || info.kind === 'tower' || info.kind === 'item'
  if (pile && (info.instant || info.timing === 'cast' || info.timing === 'instant')) return true
  if (game.freePlay.includes(card.uid)) return true
  if (card.kind === 'item' && game.freeItems > 0) return true
  if (card.kind === 'item' && game.clinkzExile.some((entry) => entry.uid === card.uid)) return true
  if (card.kind === 'item' && game.primalItems?.caster === viewer) return true
  return false
}
