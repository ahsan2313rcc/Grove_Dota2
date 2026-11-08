import { describe, expect, it } from 'vitest'
import { chooseAiAction } from './ai.ts'
import { chooseAiActionChallenge, evaluateChallenge } from './aiChallenge.ts'
import { apply, createGame } from './engine.ts'
import { blankTeam, makeCard, makeHero, setPlayer } from './flow.ts'
import type { CardInst, Game, PlayerId } from './types.ts'
import { setAiThoughtPower } from './aiPower.ts'

describe('challenge AI', () => {
  it('returns a legal action on an opening position', () => {
    const game = createGame({
      seed: 11,
      seats: [
        { name: 'A', ai: true, strat: 'balanced' },
        { name: 'B', ai: true, strat: 'spite' },
      ],
    })
    const action = chooseAiActionChallenge(game, 0, 'balanced')
    expect(['draw', 'play', 'combo', 'end', 'morph', 'move', 'discard', 'undying']).toContain(action.type)
    const next = apply(game, action)
    expect(next.log.length).toBeGreaterThan(0)
  })

  it('wires through chooseAiAction mode', () => {
    const game = createGame({
      seed: 12,
      seats: [
        { name: 'A', ai: true, strat: 'tempo' },
        { name: 'B', ai: true, strat: 'architect' },
      ],
    })
    const action = chooseAiAction(game, 'challenge')
    expect(action.type).toBeTruthy()
  })

  it('values a filled core and engine auras over a barren board', () => {
    let thin = apply(createGame({ seed: 21, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    let rich = thin
    rich = seatDefs(rich, 0, [['sven', 'axe', 'tidehunter'], ['puck']])
    thin = seatDefs(thin, 0, [['crystal_maiden']])
    expect(evaluateChallenge(rich, 0, 'architect')).toBeGreaterThan(evaluateChallenge(thin, 0, 'architect'))
  })

  it('prefers spending an action to fill a nearly-complete team over ending', () => {
    setAiThoughtPower(8)
    let game = apply(createGame({ seed: 22, mode: 'hotseat', names: ['A', 'B'] }), { type: 'ready' })
    game = seatDefs(game, 0, [['sven', 'axe']])
    game = only(game, 0, ['tidehunter', 'mars'])
    game = setPlayer(game, 0, (seat) => ({ ...seat, actions: 1 }))
    const action = chooseAiActionChallenge(game, 0, 'tempo')
    expect(action.type).not.toBe('end')
  })

  it('Spite prices pressure on the hottest foe board above the standing ladder', () => {
    let game = apply(createGame({ seed: 23, mode: 'hotseat', names: ['A', 'B', 'C'] }), { type: 'ready' })
    // B is hottest (filled cast threats); C is only slightly ahead on raw pts via standing.
    game = seatDefs(game, 1, [['enigma', 'medusa', 'axe']])
    game = seatDefs(game, 2, [['crystal_maiden']])
    const spite = evaluateChallenge(game, 0, 'spite')
    const balanced = evaluateChallenge(game, 0, 'balanced')
    // Spite should care more about B's board — eval differs from Balanced's ladder foe.
    expect(spite).not.toBe(balanced)
  })
})

function seatDefs(game: Game, player: PlayerId, teams: string[][]): Game {
  let next = game
  const built = []
  for (const [index, defs] of teams.entries()) {
    const heroes = []
    for (const defId of defs) {
      let card: CardInst
      ;[next, card] = makeCard(next, defId, 'hero')
      heroes.push(makeHero(card, player, player, next))
    }
    built.push({ ...blankTeam(`seat-${player}-${index}`), heroes })
  }
  return setPlayer(next, player, (seat) => ({ ...seat, teams: built }))
}

function only(game: Game, player: PlayerId, defIds: string[]): Game {
  let next = game
  const found: CardInst[] = []
  for (const defId of defIds) {
    const card =
      next.deck.find((entry) => entry.defId === defId)
      ?? next.players.flatMap((seat) => seat.hand).find((entry) => entry.defId === defId)
    if (!card) throw new Error(`missing ${defId}`)
    found.push(card)
    next = {
      ...next,
      deck: next.deck.filter((entry) => entry.uid !== card.uid),
      players: next.players.map((seat) => ({
        ...seat,
        hand: seat.hand.filter((entry) => entry.uid !== card.uid),
      })),
    }
  }
  return {
    ...next,
    players: next.players.map((seat, index) => (index === player ? { ...seat, hand: found } : seat)),
  }
}
