import { describe, expect, it } from 'vitest'
import { HERO_BY_ID, ITEM_BY_ID, TRAP_IDS } from './catalog.ts'
import { preferredFoe, scoreState } from './flow.ts'
import { createGame } from './engine.ts'

describe('card retunes', () => {
  it('locks sheet picks for Oracle, Puck, Jakiro, Meepo, KotL, Batrider, Zeus, Sniper', () => {
    expect(HERO_BY_ID.oracle?.timing).toBe('instant')
    expect(HERO_BY_ID.oracle?.text).toMatch(/Exile target allied hero/i)
    expect(HERO_BY_ID.puck?.timing).toBe('aura')
    expect(HERO_BY_ID.puck?.text).toMatch(/cannot enter or leave teams/i)
    expect(HERO_BY_ID.jakiro?.text).toMatch(/cannot play hero cards/i)
    expect(HERO_BY_ID.meepo?.text).toMatch(/\+1 point for each setting combo/i)
    expect(HERO_BY_ID.keeper_of_the_light?.text).toMatch(/Reactivate the ability/i)
    expect(HERO_BY_ID.batrider?.text).toMatch(/top of the deck/i)
    expect(HERO_BY_ID.zeus?.text).toMatch(/Remove all trap cards/i)
    expect(HERO_BY_ID.sniper?.text).toMatch(/Reveal each opponent's hand/i)
  })

  it('keeps Lich primary (adjacent destroys) pending alt decision', () => {
    expect(HERO_BY_ID.lich?.text).toMatch(/adjacent teams/i)
  })

  it('marks trap heroes and auto-trigger wording', () => {
    expect(TRAP_IDS.has('techies')).toBe(true)
    expect(TRAP_IDS.has('riki')).toBe(true)
    expect(TRAP_IDS.has('kez')).toBe(true)
    expect(TRAP_IDS.has('monkey_king')).toBe(true)
    expect(TRAP_IDS.has('templar_assassin')).toBe(true)
    expect(TRAP_IDS.has('ogre_magi')).toBe(true)
    expect(TRAP_IDS.has('slark')).toBe(true)
    expect(TRAP_IDS.has('bounty_hunter')).toBe(true)
    expect(TRAP_IDS.has('shadow_shaman')).toBe(true)
    expect(HERO_BY_ID.techies?.text).toMatch(/Play face down on any team/i)
    expect(HERO_BY_ID.techies?.text).toMatch(/enters that team or that team/i)
  })

  it('adds anti-loop reminder on steal / copy / reactivate cards', () => {
    expect(HERO_BY_ID.lifestealer?.text).toMatch(/Stolen and copied abilities cannot/i)
    expect(HERO_BY_ID.vengeful_spirit?.text).toMatch(/Stolen and copied abilities cannot/i)
    expect(HERO_BY_ID.enchantress?.text).toMatch(/Stolen and copied abilities cannot/i)
    expect(ITEM_BY_ID.satanic?.text).toMatch(/Stolen and copied abilities cannot/i)
    expect(ITEM_BY_ID.blink?.text).toMatch(/Stolen and copied abilities cannot/i)
  })

  it('updates Shadow Blade and Refresher to sheet text', () => {
    expect(ITEM_BY_ID.shadow_blade?.instant).toBe(true)
    expect(ITEM_BY_ID.shadow_blade?.text).toMatch(/cannot be targeted this turn/i)
    expect(ITEM_BY_ID.refresher?.text).toMatch(/extra turn/i)
  })

  it('retunes key board / hand / item lines from the sheet', () => {
    expect(HERO_BY_ID.dragon_knight?.text).toMatch(/Reveal the top 5/i)
    expect(HERO_BY_ID.dark_willow?.text).toMatch(/sacrifices a hero/i)
    expect(HERO_BY_ID.phantom_assassin?.timing).toBe('aura')
    expect(HERO_BY_ID.phantom_assassin?.text).toMatch(/exile it instead/i)
    expect(HERO_BY_ID.luna?.text).toMatch(/play a Jungle combo/i)
    expect(HERO_BY_ID.juggernaut?.text).toMatch(/immune/i)
    expect(HERO_BY_ID.storm_spirit?.text).toMatch(/up to 2/i)
    expect(HERO_BY_ID.visage?.timing).toBe('cast')
    expect(HERO_BY_ID.visage?.text).toMatch(/discard up to 2/i)
    expect(HERO_BY_ID.weaver?.text).toMatch(/Shuffle the grave into the deck/i)
    expect(ITEM_BY_ID.shivas?.instant).toBe(true)
    expect(ITEM_BY_ID.greaves?.text).toMatch(/draw 5/i)
    expect(ITEM_BY_ID.assault?.text).toMatch(/\+2 actions/i)
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
