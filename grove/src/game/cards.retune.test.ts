import { describe, expect, it } from 'vitest'
import { HERO_BY_ID } from './catalog.ts'
import { cast } from './casts.ts'
import { createGame } from './engine.ts'
import { allLocs, preferredFoe, rangeOf, scoreState } from './flow.ts'

describe('card retunes', () => {
  it('updates Medusa, Dragon Knight, Lifestealer, and Shadow Shaman catalog text', () => {
    expect(HERO_BY_ID.medusa?.text).toMatch(/Exile target enemy team/i)
    expect(HERO_BY_ID.dragon_knight?.timing).toBe('cast')
    expect(HERO_BY_ID.dragon_knight?.text).toMatch(/Search the deck for a setting/i)
    expect(HERO_BY_ID.lifestealer?.text).toMatch(/fire its ability immediately/i)
    expect(HERO_BY_ID.shadow_shaman?.text).toMatch(/You may destroy Shadow Shaman/i)
  })

  it('no longer forces Dragon Knight to Ranged via aura', () => {
    const game = createGame({
      seed: 3,
      seats: [
        { name: 'A', ai: false },
        { name: 'B', ai: false },
      ],
    })
    const hero = {
      uid: 'x',
      defId: 'dragon_knight',
      owner: 0 as const,
      controller: 0 as const,
      enteredTurn: 0,
      enteredSeq: 0,
      attrMode: 'base' as const,
      attrSet: [],
      gained: null,
      token: false,
      roshan: false,
      rupture: false,
      omni: false,
      abaddon: false,
      shield: null,
      ward: null,
      hidden: null,
      bkb: null,
      muted: false,
      dawn: null,
      wk: false,
      refract: false,
      held: null,
      castTurn: -1,
    }
    expect(rangeOf(hero)).toBe('Melee')
    expect(game.players.length).toBe(2)
  })

  it('Medusa Stone Gaze exiles an enemy team', () => {
    let game = createGame({
      seed: 21,
      seats: [
        { name: 'A', ai: true },
        { name: 'B', ai: true },
      ],
    })
    const enemyHero = game.players[1]!.hand.find((card) => card.kind === 'hero')
    expect(enemyHero).toBeTruthy()
    // Park a solo enemy team.
    game = {
      ...game,
      players: game.players.map((player, id) => {
        if (id !== 1) return player
        return {
          ...player,
          hand: player.hand.filter((card) => card.uid !== enemyHero!.uid),
          teams: [{
            id: 't-enemy',
            heroes: [{
              uid: enemyHero!.uid,
              defId: enemyHero!.defId,
              owner: 1,
              controller: 1,
              enteredTurn: game.turn,
              enteredSeq: game.seq,
              attrMode: 'base',
              attrSet: [],
              gained: null,
              token: false,
              roshan: false,
              rupture: false,
              omni: false,
              abaddon: false,
              shield: null,
              ward: null,
              hidden: null,
              bkb: null,
              muted: false,
              dawn: null,
              wk: false,
              refract: false,
              held: null,
              castTurn: -1,
            }],
            gaze: false,
            noEnter: null,
            noLeave: null,
            glyph: null,
            mine: null,
          }],
        }
      }),
    }
    const medusa = game.players[0]!.hand.find((card) => card.defId === 'medusa')
      ?? { uid: 'med', defId: 'medusa', kind: 'hero' as const }
    game = cast(game, {
      kind: 'cast',
      actor: 0,
      sourceUid: medusa.uid,
      defId: 'medusa',
      picked: ['team:t-enemy'],
      steps: 1,
      armed: true,
    })
    expect(allLocs(game).some((loc) => loc.hero.uid === enemyHero!.uid)).toBe(false)
    expect(game.exile.some((card) => card.uid === enemyHero!.uid)).toBe(true)
  })

  it('preferredFoe tracks the seat above in live scores', () => {
    const game = createGame({
      seed: 9,
      seats: [
        { name: 'A', ai: true },
        { name: 'B', ai: true },
        { name: 'C', ai: true },
      ],
    })
    const scores = game.players.map((player) => scoreState(game, player.id).total)
    expect(preferredFoe(game, 0)).toBe(preferredFoeFromScoresSafe(scores, 0))
  })
})

function preferredFoeFromScoresSafe(scores: number[], actor: number) {
  const mine = scores[actor] ?? 0
  const others = scores.map((score, id) => ({ score, id })).filter((entry) => entry.id !== actor)
  const above = others.filter((entry) => entry.score > mine).sort((a, b) => a.score - b.score || a.id - b.id)
  if (above[0]) return above[0].id
  return others.slice().sort((a, b) => b.score - a.score || a.id - b.id)[0]!.id
}
