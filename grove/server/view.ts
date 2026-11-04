import type { CardInst, Game, PlayerId } from '../src/game/types.ts'

function hideCard(card: CardInst): CardInst {
  return { uid: card.uid, defId: 'hidden', kind: card.kind }
}

/** Per-seat view: hide opponents' hands and face-down piles. */
export function viewFor(game: Game, seat: PlayerId): Game {
  return {
    ...game,
    veil: false,
    deck: game.deck.map(hideCard),
    runes: game.runes.map(hideCard),
    neutrals: game.neutrals.map(hideCard),
    towers: game.towers.map(hideCard),
    players: game.players.map((player) => {
      if (player.id === seat) return player
      const revealed = game.reveal.some((entry) => entry.viewer === seat && entry.target === player.id && entry.turn === game.turn)
      return {
        ...player,
        hand: revealed ? player.hand : player.hand.map(hideCard),
      }
    }),
  }
}
