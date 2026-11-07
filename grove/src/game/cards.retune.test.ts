import { describe, expect, it } from 'vitest'
import { HERO_BY_ID, ITEM_BY_ID, REWARD_BY_ID, TRAP_IDS } from './catalog.ts'
import { preferredFoe, scoreState } from './flow.ts'
import { createGame } from './engine.ts'

describe('card retunes', () => {
  it('locks sheet picks for Oracle, Puck, Jakiro, Meepo, KotL, Batrider, Zeus, Sniper', () => {
    expect(HERO_BY_ID.oracle?.timing).toBe('instant')
    expect(HERO_BY_ID.oracle?.text).toMatch(/Exile target allied hero/i)
    expect(HERO_BY_ID.puck?.timing).toBe('aura')
    expect(HERO_BY_ID.puck?.text).toMatch(/cannot enter or leave teams/i)
    expect(HERO_BY_ID.jakiro?.text).toMatch(/all opponents lose an action/i)
    expect(HERO_BY_ID.meepo?.text).toMatch(/\+1 point for each terrain type/i)
    expect(HERO_BY_ID.keeper_of_the_light?.text).toMatch(/Reactivate the ability/i)
    expect(HERO_BY_ID.batrider?.text).toMatch(/Move a trap/i)
    expect(HERO_BY_ID.zeus?.text).toMatch(/Remove all trap cards/i)
    expect(HERO_BY_ID.sniper?.text).toMatch(/more heroes in its team than Sniper/i)
  })

  it('retunes Rubick Instant steal/nullify and CM global Arcane Aura', () => {
    expect(HERO_BY_ID.rubick?.timing).toBe('instant')
    expect(HERO_BY_ID.rubick?.text).toMatch(/Copy target enemy hero/i)
    expect(HERO_BY_ID.rubick?.text).toMatch(/Nullify that hero's ability this turn/i)
    expect(HERO_BY_ID.crystal_maiden?.timing).toBe('aura')
    expect(HERO_BY_ID.crystal_maiden?.text).toMatch(/hero you control activates an ability/i)
  })

  it('retunes Lich to sacrifice + draw', () => {
    expect(HERO_BY_ID.lich?.text).toMatch(/Sacrifice a hero/i)
    expect(HERO_BY_ID.lich?.text).toMatch(/Draw 5/i)
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
    expect(TRAP_IDS.has('broodmother')).toBe(true)
    expect(HERO_BY_ID.techies?.timing).toBe('trap')
    expect(HERO_BY_ID.techies?.text).toMatch(/Sacrifice this team/i)
    expect(HERO_BY_ID.techies?.text).not.toMatch(/Play face down/i)
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

  it('makes Haste Instant and neutrals Aura bodies', () => {
    expect(REWARD_BY_ID.haste?.instant).toBe(true)
    expect(REWARD_BY_ID.stone_golem?.instant).toBe(false)
    expect(REWARD_BY_ID.tormentor?.instant).toBe(false)
    expect(REWARD_BY_ID.roshan?.instant).toBe(false)
    expect(REWARD_BY_ID.stone_golem?.range).toBe('Melee')
    expect(REWARD_BY_ID.tormentor?.range).toBe('Melee')
    expect(REWARD_BY_ID.roshan?.range).toBe('Melee')
    expect(REWARD_BY_ID.thunderhide?.range).toBe('Ranged')
    expect(REWARD_BY_ID.ice_shaman?.range).toBe('Ranged')
    expect(REWARD_BY_ID.black_dragon?.range).toBe('Ranged')
    expect(REWARD_BY_ID.stone_golem?.text).toMatch(/Aura/i)
    expect(REWARD_BY_ID.tormentor?.text).toMatch(/Aura/i)
  })

  it('retunes key board / hand / item lines from the sheet', () => {
    expect(HERO_BY_ID.dragon_knight?.text).toMatch(/Reveal the top 5/i)
    expect(HERO_BY_ID.dark_willow?.text).toMatch(/sacrifices a hero/i)
    expect(HERO_BY_ID.phantom_assassin?.timing).toBe('aura')
    expect(HERO_BY_ID.phantom_assassin?.text).toMatch(/exile it instead/i)
    expect(HERO_BY_ID.luna?.text).toMatch(/for each Jungle/i)
    expect(HERO_BY_ID.juggernaut?.timing).toBe('cast')
    expect(HERO_BY_ID.juggernaut?.text).toMatch(/destroy an enemy hero/i)
    expect(HERO_BY_ID.huskar?.timing).toBe('instant')
    expect(HERO_BY_ID.huskar?.text).toMatch(/opponents cannot play hero cards/i)
    expect(HERO_BY_ID.bloodseeker?.timing).toBe('instant')
    expect(HERO_BY_ID.storm_spirit?.text).toMatch(/up to 2/i)
    expect(HERO_BY_ID.visage?.timing).toBe('cast')
    expect(HERO_BY_ID.visage?.text).toMatch(/discard up to 2/i)
    expect(HERO_BY_ID.weaver?.text).toMatch(/Shuffle the grave into the deck.*choose how deep it goes/i)
    expect(HERO_BY_ID.anti_mage?.text).toMatch(/target enemy team/i)
    expect(HERO_BY_ID.timbersaw?.text).toMatch(/target enemy team/i)
    expect(HERO_BY_ID.earthshaker?.text).toMatch(/4 or more/i)
    expect(HERO_BY_ID.undying?.text).toMatch(/discard 2 cards/i)
    expect(ITEM_BY_ID.shivas?.instant).toBe(true)
    expect(ITEM_BY_ID.greaves?.text).toMatch(/Remove all Trap cards/i)
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
