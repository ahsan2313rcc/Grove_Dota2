import type { Attr, CardKind, Range, TerrainKind, Timing } from './types.ts'

export interface HeroDef {
  id: string
  name: string
  attr: Attr
  range: Range
  spell: string
  text: string
  timing: Timing
}

export interface ItemDef {
  id: string
  name: string
  text: string
  copies: number
  instant: boolean
}

export interface RewardDef {
  id: string
  name: string
  kind: 'rune' | 'neutral' | 'tower'
  text: string
  copies: number
  attr?: Attr
  /** Attack type for neutral bodies (Melee/Ranged). */
  range?: Range
  instant: boolean
  token: boolean
  /** Neutral bodies with on-play / Instant abilities use the same timing kinds as heroes. */
  timing?: Timing
  spell?: string
}

export interface TerrainDef {
  id: TerrainKind
  name: string
  text: string
}

/** Shared endgame card — one copy in the main deck. */
export const ANCIENT_ID = 'ancient'
export const ANCIENT_BONUS = 10
export const ANCIENT = {
  id: ANCIENT_ID,
  name: 'The Ancient',
  text: `Neutral. When you draw The Ancient, play it for free into a team you control or a new team; it counts as any one attribute. Ancient Draw: Drawing the Ancient card starts the final round: each player gets one more turn, then the highest score wins — +${ANCIENT_BONUS} to whoever controls the Ancient (Match options can change the bonus). Revealed from the grave or exile, it only starts the final round.`,
  kind: 'ancient' as const,
}

/** Cards drawn at the start of each turn (and seat 0's turn-1 draw after the opening deal). */
export const TURN_DRAW = 2

function hero(
  id: string,
  name: string,
  attr: Attr,
  range: Range,
  spell: string,
  text: string,
  timing: Timing,
): HeroDef {
  return { id, name, attr, range, spell, text, timing }
}

/** Shared trap rules — action sequence shown via the Trap rules hover hint. */
export const TRAP_RULE_STEPS = [
  'Play face-down on any team with room for another hero (yours or an enemy’s).',
  'One trap per team — never on a full or closed team.',
  'While face down, that team scores no attribute bonus.',
  'Trigger: another hero enters that team.',
  'Reveal and resolve this before that hero’s ability (the controller is whoever controls the team).',
  'Afterwards, a trap that does not sacrifice itself joins the team if there is room; otherwise it goes to the grave.',
  'Snares hurt the controller; wards help them.',
] as const

/** Anti-loop reminder — shown via the Recast rule hint in the UI, not pasted onto every card. */
export const RECAST_RULE =
  'Stolen and copied abilities cannot steal, swap control, copy, or fire another stolen ability.'
export const RECAST_IDS = new Set([
  'lifestealer',
  'vengeful_spirit',
  'enchantress',
  'keeper_of_the_light',
  'rubick',
  'blink',
  'satanic',
  'arcane',
])

/** Shared neutral body rules — shown via the Neutral rules hover hint. */
export const NEUTRAL_RULE_STEPS = [
  'Neutral bodies score 0 flat points, but still count for attribute and attack bonuses.',
  'One neutral per team.',
  'Each neutral has an attribute and Melee or Ranged as printed on the card.',
  'Taken from the Jungle pile (three Jungles). Used neutrals exile after leaving play.',
] as const

export const HEROES: HeroDef[] = [
  // —— Strength ——
  hero('alchemist', 'Alchemist', 'STR', 'Melee', "Greevil's Greed", 'Whenever you play an item card, draw a card.', 'aura'),
  hero('axe', 'Axe', 'STR', 'Melee', "Berserker's Call", 'Opponents cannot draw cards from the deck until your next turn.', 'cast'),
  hero('bristleback', 'Bristleback', 'STR', 'Melee', 'Bristleback', 'Whenever Bristleback is destroyed, destroy a target enemy hero.', 'aura'),
  hero('centaur_warrunner', 'Centaur Warrunner', 'STR', 'Melee', 'Retaliate', 'Whenever an ally in this team is targeted by an opponent, that player discards a card for each Strength hero in this team.', 'aura'),
  hero('chaos_knight', 'Chaos Knight', 'STR', 'Melee', 'Chaos Bolt', 'Each player discards a card at random.', 'cast'),
  hero('clockwerk', 'Clockwerk', 'STR', 'Melee', 'Hookshot', 'Reveal the top 3 cards of the deck. Put one into your hand, one on top of the deck, and one into the grave.', 'cast'),
  hero('dawnbreaker', 'Dawnbreaker', 'STR', 'Melee', 'Solar Guardian', 'If target hero would be destroyed this turn, return it to your hand instead. Instant.', 'instant'),
  hero('doom', 'Doom', 'STR', 'Melee', 'Doom', 'Opponents cannot play item cards.', 'aura'),
  hero('dragon_knight', 'Dragon Knight', 'STR', 'Melee', 'Elder Dragon Form', 'Reveal the top 5 cards of the deck. Put all terrain cards into your hand and the rest into the grave.', 'cast'),
  hero('earth_spirit', 'Earth Spirit', 'STR', 'Melee', 'Boulder Smash', 'Move target enemy hero to another team its controller has, then destroy a hero in that team. Instant.', 'instant'),
  hero('earthshaker', 'Earthshaker', 'STR', 'Melee', 'Echo Slam', 'Destroy target enemy team with 4 or more heroes.', 'cast'),
  hero('elder_titan', 'Elder Titan', 'STR', 'Melee', 'Natural Order', 'All enemy heroes lose their attribute bonus.', 'aura'),
  hero('huskar', 'Huskar', 'STR', 'Ranged', "Berserker's Blood", 'Until your next turn, opponents cannot play hero cards. Instant.', 'instant'),
  hero('kunkka', 'Kunkka', 'STR', 'Melee', 'Ghostship', 'Reveal the top 5 cards of the deck. An opponent splits them into two piles. You take one pile; the other enters the grave.', 'cast'),
  hero('largo', 'Largo', 'STR', 'Melee', 'Catchy Lilt', 'Draw a card for each team you control.', 'cast'),
  hero('legion_commander', 'Legion Commander', 'STR', 'Melee', 'Duel', 'If this team has more heroes than target enemy team, take a hero from that team into your hand.', 'cast'),
  hero(
    'lifestealer',
    'Lifestealer',
    'STR',
    'Melee',
    'Infest',
    'Exile Lifestealer and take control of target enemy hero into this team. You may activate its ability immediately. Lifestealer stays exiled while that hero is on the board; when it leaves, Lifestealer returns in its place.',
    'cast',
  ),
  hero('lycan', 'Lycan', 'STR', 'Melee', 'Shapeshift', 'Whenever an ally enters this team, draw 1.', 'aura'),
  hero(
    'mars',
    'Mars',
    'STR',
    'Melee',
    'Bulwark',
    'Other allies in this team cannot be targeted by enemy abilities. Mars himself can still be targeted, and opponents may still target this team.',
    'aura',
  ),
  hero('night_stalker', 'Night Stalker', 'STR', 'Melee', 'Dark Ascension', 'Steal 2 cards at random from target opponent.', 'cast'),
  hero('ogre_magi', 'Ogre Magi', 'STR', 'Melee', 'Multicast', 'Place face-down. When triggered, the entering hero activates its ability twice.', 'trap'),
  hero('omniknight', 'Omniknight', 'STR', 'Melee', 'Guardian Angel', 'You cannot add more heroes into this team. All allied heroes in this team are immune to all effects.', 'aura'),
  hero('phoenix', 'Phoenix', 'STR', 'Ranged', 'Supernova', 'You may exile Phoenix. If you do, return target enemy team to the bottom of the deck.', 'cast'),
  hero('primal_beast', 'Primal Beast', 'STR', 'Melee', 'Uproar', 'Until your next turn, you cannot play hero cards, but you may play item cards as if they were instants.', 'cast'),
  hero('pudge', 'Pudge', 'STR', 'Melee', 'Meat Hook', 'Take control of target enemy hero. That opponent discards a card.', 'cast'),
  hero('slardar', 'Slardar', 'STR', 'Melee', 'Corrosive Haze', 'Draw a card for each River terrain you control.', 'cast'),
  hero('spirit_breaker', 'Spirit Breaker', 'STR', 'Melee', 'Charge of Darkness', "Enter a team you control and redirect the ability about to fire onto Spirit Breaker or its team. Instant.", 'instant'),
  hero('sven', 'Sven', 'STR', 'Melee', "God's Strength", 'If this team has 3 or more Strength heroes, destroy target enemy team.', 'cast'),
  hero('tidehunter', 'Tidehunter', 'STR', 'Melee', 'Ravage', 'Return a team from each enemy to their hand. They each discard 5 cards.', 'cast'),
  hero('timbersaw', 'Timbersaw', 'STR', 'Melee', 'Whirling Death', 'Destroy all Strength heroes in target enemy team.', 'cast'),
  hero('tiny', 'Tiny', 'STR', 'Melee', 'Toss', 'Move a hero in this team to target enemy team and destroy 2 other heroes in that team.', 'cast'),
  hero('treant_protector', 'Treant Protector', 'STR', 'Melee', 'Living Armor', 'Your terrain combos cannot be stolen or destroyed.', 'aura'),
  hero('tusk', 'Tusk', 'STR', 'Melee', 'Walrus Kick', 'Move target hero to another team its controller owns. Instant.', 'instant'),
  hero('underlord', 'Underlord', 'UNI', 'Melee', 'Dark Rift', 'Move all heroes in this team to another team you control.', 'cast'),
  hero('undying', 'Undying', 'STR', 'Melee', 'Flesh Golem', 'During your turn, if Undying is in the grave, you may discard 2 cards to bring Undying into a team you control.', 'aura'),
  hero('wraith_king', 'Wraith King', 'STR', 'Melee', 'Reincarnation', 'If Wraith King would be destroyed, exile him instead, then return him on your next turn.', 'aura'),
  hero('abaddon', 'Abaddon', 'STR', 'Melee', 'Borrowed Time', 'Allied heroes in this team return to the top of the deck instead of being destroyed.', 'aura'),
  hero('beastmaster', 'Beastmaster', 'STR', 'Melee', 'Primal Roar', 'Redistribute heroes in an enemy team into three new teams that player controls.', 'cast'),
  hero('sand_king', 'Sand King', 'STR', 'Melee', 'Epicenter', 'Each opponent must discard a hero card. If they cannot, destroy a hero they control.', 'cast'),

  // —— Agility ——
  hero('anti_mage', 'Anti-Mage', 'AGI', 'Melee', 'Mana Void', 'Destroy all Intelligence heroes in target enemy team.', 'cast'),
  hero('bloodseeker', 'Bloodseeker', 'AGI', 'Melee', 'Rupture', 'Until your next turn, enemy heroes that would leave a team are destroyed instead. Instant.', 'instant'),
  hero(
    'bounty_hunter',
    'Bounty Hunter',
    'AGI',
    'Melee',
    'Track',
    'Place face-down. When triggered, the controller reveals target opponent\'s hand and takes a hero card from it.',
    'trap',
  ),
  hero(
    'broodmother',
    'Broodmother',
    'AGI',
    'Melee',
    'Spin Web',
    'Place face-down. When triggered, exile the entering hero.',
    'trap',
  ),
  hero('clinkz', 'Clinkz', 'AGI', 'Ranged', 'Death Pact', 'Exile the top 5 cards of the deck. You may play any number of those exiled item cards for free this turn.', 'cast'),
  hero('drow_ranger', 'Drow Ranger', 'AGI', 'Ranged', 'Marksmanship', 'If this team has 3 or more Ranged heroes, destroy target enemy hero.', 'cast'),
  hero('ember_spirit', 'Ember Spirit', 'AGI', 'Melee', 'Fire Remnant', 'Move up to X heroes you own to another team you control, where X is the number of terrain types you control.', 'cast'),
  hero('faceless_void', 'Faceless Void', 'AGI', 'Melee', 'Chronosphere', 'Target opponent loses their remaining actions. Instant.', 'instant'),
  hero('gyrocopter', 'Gyrocopter', 'AGI', 'Ranged', 'Call Down', 'Choose an attribute (STR / AGI / INT / UNI). Destroy one hero of that attribute from each opponent.', 'cast'),
  hero('hoodwink', 'Hoodwink', 'AGI', 'Ranged', 'Sharpshooter', 'If you control a Jungle terrain, destroy any enemy terrain combo or enemy hero.', 'cast'),
  hero('juggernaut', 'Juggernaut', 'AGI', 'Melee', 'Blade Fury', 'Until your next turn, whenever a hero in this team activates an ability, destroy an enemy hero.', 'cast'),
  hero(
    'kez',
    'Kez',
    'AGI',
    'Melee',
    'Switch Discipline',
    'Place face-down. When triggered, the controller may play a hero from their hand into this team for free. Its ability resolves, then the entering hero\'s.',
    'trap',
  ),
  hero('lone_druid', 'Lone Druid', 'AGI', 'Ranged', 'Summon Spirit Bear', 'Take the top Tower card into your hand. You may play it immediately for free.', 'cast'),
  hero('luna', 'Luna', 'AGI', 'Ranged', 'Moon Glaives', 'Whenever you play a terrain combo, search the deck for an item card for each Jungle in it.', 'aura'),
  hero('medusa', 'Medusa', 'AGI', 'Ranged', 'Stone Gaze', 'Exile target enemy team. Return it to its owner whenever Medusa leaves the board.', 'cast'),
  hero('meepo', 'Meepo', 'AGI', 'Melee', 'Divided We Stand', 'Gain +1 point for each terrain type you control.', 'aura'),
  hero('mirana', 'Mirana', 'AGI', 'Ranged', 'Sacred Arrow', 'Reveal the top card of the deck. If it is a hero, you may play it immediately for free; otherwise put it into the grave.', 'cast'),
  hero('monkey_king', 'Monkey King', 'AGI', 'Melee', 'Wukong\'s Command', 'Place face-down. When triggered, the controller loses their next turn.', 'trap'),
  hero(
    'morphling',
    'Morphling',
    'AGI',
    'Ranged',
    'Morph',
    'Exile target hero until Morphling leaves the board. You may switch Morphling\'s attribute to match the exiled hero.',
    'cast',
  ),
  hero('naga_siren', 'Naga Siren', 'AGI', 'Melee', 'Song of the Siren', 'Heroes cannot be destroyed until your next turn.', 'cast'),
  hero('nyx_assassin', 'Nyx Assassin', 'AGI', 'Melee', 'Spiked Carapace', "Enter a team you control and counter the ability about to fire. If that hero is Intelligence, destroy it. Instant.", 'instant'),
  hero('phantom_assassin', 'Phantom Assassin', 'AGI', 'Melee', 'Coup de Grace', "Whenever an enemy hero returns to its owner's hand, exile it instead.", 'aura'),
  hero('phantom_lancer', 'Phantom Lancer', 'AGI', 'Melee', 'Juxtapose', 'Whenever Phantom Lancer would be destroyed, return him to your hand instead.', 'aura'),
  hero('razor', 'Razor', 'AGI', 'Ranged', 'Static Link', 'Exile target hero. You gain +1 action.', 'cast'),
  hero(
    'riki',
    'Riki',
    'AGI',
    'Melee',
    'Cloak and Dagger',
    'Place face-down. When triggered, the controller cannot activate abilities until their next turn.',
    'trap',
  ),
  hero('shadow_fiend', 'Shadow Fiend', 'AGI', 'Ranged', 'Necromastery', 'Whenever an enemy hero is destroyed, draw 1.', 'aura'),
  hero(
    'slark',
    'Slark',
    'AGI',
    'Melee',
    'Shadow Dance',
    'Place face-down. When triggered, the controller discards 3 cards, then every other player draws 1.',
    'trap',
  ),
  hero('sniper', 'Sniper', 'AGI', 'Ranged', 'Assassinate', 'Destroy a hero an opponent controls that has more heroes in its team than Sniper.', 'cast'),
  hero('spectre', 'Spectre', 'AGI', 'Melee', 'Haunt', 'Destroy a target hero from each opponent.', 'cast'),
  hero(
    'templar_assassin',
    'Templar Assassin',
    'AGI',
    'Ranged',
    'Refraction',
    'Place face-down. When triggered, until the controller\'s next turn, heroes in this team cannot be destroyed.',
    'trap',
  ),
  hero('terrorblade', 'Terrorblade', 'AGI', 'Melee', 'Sunder', 'Swap control of target team you control with a team an opponent controls.', 'cast'),
  hero('troll_warlord', 'Troll Warlord', 'AGI', 'Ranged', 'Battle Trance', 'Opponents cannot play instant cards during your turn.', 'aura'),
  hero('ursa', 'Ursa', 'AGI', 'Melee', 'Enrage', 'Whenever you play an item card, Ursa becomes immune to all effects.', 'aura'),
  hero(
    'vengeful_spirit',
    'Vengeful Spirit',
    'AGI',
    'Ranged',
    'Nether Swap',
    'Swap control of Vengeful Spirit and target enemy hero. You may activate that hero\'s ability immediately.',
    'cast',
  ),
  hero('viper', 'Viper', 'AGI', 'Ranged', 'Nethertoxin', "Nullify all enemy heroes' Aura abilities.", 'aura'),
  hero('weaver', 'Weaver', 'AGI', 'Ranged', 'Time Lapse', 'Shuffle the grave into the deck. If The Ancient is in the deck, you choose how deep it goes.', 'cast'),

  // —— Intelligence ——
  hero('ancient_apparition', 'Ancient Apparition', 'INT', 'Ranged', 'Ice Blast', 'Cards that would enter the grave are exiled instead.', 'aura'),
  hero('chen', 'Chen', 'INT', 'Ranged', 'Holy Persuasion', 'Take the top Neutral card into your hand. You may play it immediately for free.', 'cast'),
  hero(
    'crystal_maiden',
    'Crystal Maiden',
    'INT',
    'Ranged',
    'Arcane Aura',
    'Whenever a hero you control activates an ability, draw a card.',
    'aura',
  ),
  hero('dark_seer', 'Dark Seer', 'INT', 'Melee', 'Vacuum', 'Until the end of turn, if an enemy hero would be destroyed, you take control of it instead.', 'cast'),
  hero('dark_willow', 'Dark Willow', 'INT', 'Ranged', 'Terrorize', 'Each opponent sacrifices a hero they control.', 'cast'),
  hero('dazzle', 'Dazzle', 'INT', 'Ranged', 'Shallow Grave', 'Target allied hero cannot be destroyed until your next turn. Instant.', 'instant'),
  hero(
    'death_prophet',
    'Death Prophet',
    'INT',
    'Ranged',
    'Exorcism',
    'On your turn, spend 1 action to play the top grave card (may finish a terrain combo). Exorcised items, runes, and towers exile after use. Heroes and neutrals you control exile instead of dying.',
    'aura',
  ),
  hero('disruptor', 'Disruptor', 'INT', 'Ranged', 'Glimpse', 'Put target enemy card on the top or bottom of the deck. Instant.', 'instant'),
  hero(
    'enchantress',
    'Enchantress',
    'INT',
    'Ranged',
    'Enchant',
    'Take control of target Strength hero. You may reactivate its ability immediately.',
    'cast',
  ),
  hero('grimstroke', 'Grimstroke', 'INT', 'Ranged', 'Soulbind', 'Sacrifice a terrain combo to take control of target enemy team.', 'cast'),
  hero('invoker', 'Invoker', 'INT', 'Ranged', 'Cataclysm', 'All players discard their hands and draw 3 cards from the deck.', 'cast'),
  hero('jakiro', 'Jakiro', 'INT', 'Ranged', 'Ice Path', 'Until your next turn, all opponents lose an action.', 'cast'),
  hero(
    'keeper_of_the_light',
    'Keeper of the Light',
    'INT',
    'Ranged',
    'Chakra Magic',
    'Reactivate the ability effect of a hero you own.',
    'cast',
  ),
  hero('leshrac', 'Leshrac', 'INT', 'Ranged', 'Pulse Nova', 'Put cards from the top of the deck into the grave until you reveal an item. Put that item into your hand.', 'cast'),
  hero('lich', 'Lich', 'INT', 'Ranged', 'Chain Frost', 'Sacrifice a hero. Draw 5 cards.', 'cast'),
  hero('lina', 'Lina', 'INT', 'Ranged', 'Laguna Blade', 'Destroy target enemy hero. This cannot be avoided.', 'cast'),
  hero('lion', 'Lion', 'INT', 'Ranged', 'Finger of Death', "Reveal target opponent's hand. Exile a hero card from it.", 'cast'),
  hero('muerta', 'Muerta', 'INT', 'Ranged', 'Pierce the Veil', 'Opponents cannot take or play cards from the grave.', 'aura'),
  hero('necrophos', 'Necrophos', 'INT', 'Ranged', "Reaper's Scythe", 'Exile target enemy hero. While this Necrophos remains on the board, opponents cannot play hero cards with the same attribute.', 'cast'),
  hero('oracle', 'Oracle', 'INT', 'Ranged', 'False Promise', 'Exile target allied hero. Return it to the board at the end of this turn. Instant.', 'instant'),
  hero('outworld_destroyer', 'Outworld Destroyer', 'INT', 'Ranged', "Sanity's Eclipse", 'Target opponent discards 4 cards. If they cannot, they exile a team they control.', 'cast'),
  hero('puck', 'Puck', 'INT', 'Ranged', 'Dream Coil', 'Enemy heroes cannot enter or leave teams. New teams can still be formed.', 'aura'),
  hero('pugna', 'Pugna', 'INT', 'Ranged', 'Nether Ward', 'Whenever an opponent activates a hero ability, they must discard a card or nullify the ability effect.', 'aura'),
  hero('queen_of_pain', 'Queen of Pain', 'INT', 'Ranged', 'Sonic Wave', 'Target opponent discards their hand.', 'cast'),
  hero('ringmaster', 'Ringmaster', 'INT', 'Ranged', 'Wheel of Wonder', 'Choose one: target allied hero becomes immune, or target opponent reveals their hand. Instant.', 'instant'),
  hero(
    'rubick',
    'Rubick',
    'INT',
    'Ranged',
    'Spell Steal',
    'Copy target enemy hero\'s ability and cast it. Nullify that hero\'s ability this turn. Instant.',
    'instant',
  ),
  hero('shadow_demon', 'Shadow Demon', 'INT', 'Ranged', 'Disruption', 'Exile target hero. Return it to your hand when Shadow Demon is removed from the board. Instant.', 'instant'),
  hero(
    'shadow_shaman',
    'Shadow Shaman',
    'INT',
    'Ranged',
    'Shackles',
    'Place face-down. When triggered, sacrifice Shadow Shaman. The controller sacrifices a hero from another team they control.',
    'trap',
  ),
  hero('silencer', 'Silencer', 'INT', 'Ranged', 'Global Silence', 'Until your next turn, opponents cannot activate ability effects. Instant.', 'instant'),
  hero('skywrath_mage', 'Skywrath Mage', 'INT', 'Ranged', 'Mystic Flare', 'Target opponent discards a card for each Intelligence hero in this team.', 'cast'),
  hero('storm_spirit', 'Storm Spirit', 'INT', 'Ranged', 'Ball Lightning', 'Discard up to 2 cards from your hand. Gain +1 action for each discarded card this turn.', 'cast'),
  hero('techies', 'Techies', 'INT', 'Ranged', 'Proximity Mines', 'Place face-down. When triggered, sacrifice this team, including Techies.', 'trap'),
  hero('tinker', 'Tinker', 'INT', 'Ranged', 'Rearm', 'Search the grave for an item card and put it into your hand. You may play it immediately.', 'cast'),
  hero('visage', 'Visage', 'INT', 'Ranged', 'Soul Assumption', 'You may discard up to 2 cards. Destroy an enemy hero for each discarded card.', 'cast'),
  hero('warlock', 'Warlock', 'INT', 'Ranged', 'Fatal Bonds', 'Target an enemy team. Until your next turn, whenever an enemy hero is destroyed, destroy another hero in that team (if any).', 'cast'),
  hero('winter_wyvern', 'Winter Wyvern', 'INT', 'Ranged', "Winter's Curse", 'Target opponent sacrifices all heroes but one from a target team they own.', 'cast'),
  hero('witch_doctor', 'Witch Doctor', 'INT', 'Ranged', 'Maledict', 'Until the end of this turn, whenever target opponent discards a card, destroy a hero they control.', 'cast'),
  hero('zeus', 'Zeus', 'INT', 'Ranged', "Thundergod's Wrath", 'Remove all trap cards from the board.', 'cast'),

  // —— Universal ——
  hero('arc_warden', 'Arc Warden', 'UNI', 'Ranged', 'Magnetic Field', 'Take the top Rune card into your hand. You may play it immediately for free.', 'cast'),
  hero('bane', 'Bane', 'UNI', 'Ranged', "Fiend's Grip", 'Target opponent loses their next turn.', 'cast'),
  hero('batrider', 'Batrider', 'UNI', 'Ranged', 'Flaming Lasso', "Move a trap from target player's team to another player's team with room, without revealing it.", 'cast'),
  hero('brewmaster', 'Brewmaster', 'UNI', 'Melee', 'Primal Split', 'Brewmaster counts as any one attribute (the one that results in the highest score).', 'aura'),
  hero('enigma', 'Enigma', 'UNI', 'Ranged', 'Black Hole', 'Destroy a target team from each player.', 'cast'),
  hero('io', 'Io', 'UNI', 'Ranged', 'Tether', 'Move target allied hero to this team. It cannot be destroyed this turn. Instant.', 'instant'),
  hero('magnus', 'Magnus', 'UNI', 'Melee', 'Reverse Polarity', 'Redistribute up to 5 heroes target opponent controls to form a new team they control.', 'cast'),
  hero('marci', 'Marci', 'UNI', 'Melee', 'Sidekick', 'Draw cards equal to the number of players from the deck. Give a card of your choosing to each player.', 'cast'),
  hero('natures_prophet', "Nature's Prophet", 'UNI', 'Ranged', 'Wrath of Nature', 'Destroy an enemy hero for each terrain combo each opponent controls.', 'cast'),
  hero('pangolier', 'Pangolier', 'UNI', 'Melee', 'Lucky Shot', 'Target an opponent, then name a terrain. That opponent loses their next turn unless they discard the named terrain card.', 'cast'),
  hero('snapfire', 'Snapfire', 'UNI', 'Ranged', 'Mortimer Kisses', 'Exile 3 cards from your hand. Take any 2 cards from the grave into your hand.', 'cast'),
  hero('venomancer', 'Venomancer', 'UNI', 'Ranged', 'Poison Nova', 'Whenever an opponent plays an item card, they must discard a card from their hand or nullify its effect.', 'aura'),
  hero('void_spirit', 'Void Spirit', 'UNI', 'Melee', 'Dissimilate', 'Swap hands with target opponent.', 'cast'),
  hero('windranger', 'Windranger', 'UNI', 'Ranged', 'Focus Fire', 'Take control of target enemy terrain combo.', 'cast'),
]

export const ITEMS: ItemDef[] = [
  { id: 'clarity', name: 'Clarity', copies: 3, instant: false, text: 'Reveal cards from the top of the deck until you reveal a terrain. Put it in your hand and the rest back on top in any order.' },
  { id: 'tp_scroll', name: 'Teleportation Scroll', copies: 3, instant: true, text: 'Move target hero you own to another team you control. Instant.' },
  { id: 'ward', name: 'Observer Ward', copies: 3, instant: false, text: "Remove target trap, or reveal target opponent's hand." },
  { id: 'gloves', name: 'Gloves of Haste', copies: 3, instant: false, text: "Steal a random card from an opponent's hand." },
  {
    id: 'blink',
    name: 'Blink Dagger',
    copies: 2,
    instant: true,
    text: 'Play a hero card from your hand into a team you control. You may activate its ability immediately. Instant.',
  },
  { id: 'orchid', name: 'Orchid Malevolence', copies: 2, instant: true, text: 'Target opponent cannot activate ability effects until your next turn (including the ability being interrupted). Instant.' },
  { id: 'euls', name: "Eul's Scepter", copies: 2, instant: true, text: 'Exile target hero, then return it at the end of this turn. Instant.' },
  { id: 'gem', name: 'Gem of True Sight', copies: 2, instant: false, text: 'Name a card. All opponents reveal their hands and give you that card if they have it.' },
  { id: 'force_staff', name: 'Force Staff', copies: 2, instant: true, text: 'Move target hero to another team that player controls. Instant.' },
  { id: 'shadow_blade', name: 'Shadow Blade', copies: 2, instant: true, text: 'Target hero cannot be targeted this turn. Instant.' },
  { id: 'scythe', name: 'Scythe of Vyse', copies: 1, instant: true, text: 'Exile a target enemy hero. Instant.' },
  { id: 'abyssal', name: 'Abyssal Blade', copies: 1, instant: true, text: 'Put target enemy hero on the top or bottom of the deck, then draw 1. Instant.' },
  { id: 'halberd', name: "Heaven's Halberd", copies: 1, instant: false, text: 'Target opponent cannot play hero cards until your next turn.' },
  { id: 'assault', name: 'Assault Cuirass', copies: 1, instant: false, text: 'Gain +2 actions this turn.' },
  { id: 'heart', name: 'Heart of Tarrasque', copies: 1, instant: false, text: 'Return target hero from the grave to your hand. You may play it for free this turn.' },
  { id: 'bkb', name: 'Black King Bar', copies: 1, instant: true, text: 'Target allied team becomes immune to all effects until your next turn. Instant.' },
  {
    id: 'satanic',
    name: 'Satanic',
    copies: 1,
    instant: false,
    text: 'Until the end of this turn, take control of target enemy hero and reactivate its ability effect.',
  },
  { id: 'greaves', name: 'Guardian Greaves', copies: 1, instant: false, text: "Remove all Trap cards from a player's teams." },
  { id: 'shivas', name: "Shiva's Guard", copies: 1, instant: true, text: 'Until your next turn, opponents cannot reactivate abilities or add new heroes to their current teams. Instant.' },
  { id: 'rapier', name: 'Divine Rapier', copies: 1, instant: false, text: 'Destroy target enemy team. Return this card to the bottom of the deck.' },
  { id: 'dagon', name: 'Dagon', copies: 1, instant: true, text: 'Destroy target enemy hero, then draw 1. Instant.' },
  { id: 'refresher', name: 'Refresher Orb', copies: 1, instant: false, text: 'Take an extra turn after this one.' },
]

export const REWARDS: RewardDef[] = [
  { id: 'arcane', name: 'Arcane Rune', kind: 'rune', copies: 1, instant: true, token: false, text: 'Reactivate the ability of a hero you own. Instant.' },
  { id: 'haste', name: 'Haste Rune', kind: 'rune', copies: 1, instant: true, token: false, text: "Steal a card from each opponent's hand at random. Instant." },
  { id: 'shield', name: 'Shield Rune', kind: 'rune', copies: 1, instant: true, token: false, text: 'Until your next turn, target hero becomes immune to all effects. Instant.' },
  { id: 'illusion', name: 'Illusion Rune', kind: 'rune', copies: 1, instant: true, token: false, text: 'Counter target hero or item card (it goes to the grave without activating). Instant.' },
  { id: 'regen', name: 'Regeneration Rune', kind: 'rune', copies: 1, instant: false, token: false, text: 'Take any card from the grave into your hand.' },
  { id: 'double_damage', name: 'Amplify Rune', kind: 'rune', copies: 1, instant: false, token: false, text: 'You may play up to 2 item cards from your hand for free this turn.' },
  {
    id: 'stone_golem',
    name: 'Stone Golem',
    kind: 'neutral',
    copies: 1,
    instant: false,
    token: true,
    attr: 'STR',
    range: 'Melee',
    timing: 'aura',
    spell: 'Granite Form',
    text: 'Immune to all ability effects.',
  },
  {
    id: 'thunderhide',
    name: 'Thunderhide',
    kind: 'neutral',
    copies: 1,
    instant: true,
    token: true,
    attr: 'AGI',
    range: 'Ranged',
    timing: 'instant',
    spell: 'Static Charge',
    text: 'Draw 1.',
  },
  {
    id: 'ice_shaman',
    name: 'Ice Shaman',
    kind: 'neutral',
    copies: 1,
    instant: true,
    token: true,
    attr: 'INT',
    range: 'Ranged',
    timing: 'instant',
    spell: 'Frost Bind',
    text: 'Return target hero to its owner\'s hand (without activating its ability).',
  },
  {
    id: 'black_dragon',
    name: 'Black Dragon',
    kind: 'neutral',
    copies: 1,
    instant: true,
    token: true,
    attr: 'UNI',
    range: 'Ranged',
    timing: 'instant',
    spell: 'Fireball',
    text: 'Target opponent discards 1 card from hand.',
  },
  {
    id: 'tormentor',
    name: 'Tormentor',
    kind: 'neutral',
    copies: 1,
    instant: false,
    token: true,
    attr: 'UNI',
    range: 'Melee',
    timing: 'aura',
    spell: 'Retaliate',
    text: 'Whenever Tormentor is destroyed, destroy the source hero.',
  },
  {
    id: 'roshan',
    name: 'Roshan',
    kind: 'neutral',
    copies: 1,
    instant: false,
    token: true,
    attr: 'UNI',
    range: 'Melee',
    timing: 'cast',
    spell: 'Bash',
    text: 'Whenever another hero in this team is destroyed, destroy Roshan instead. On play: until your next turn, opponents cannot activate ability effects.',
  },
  { id: 'lotus', name: 'Lotus of Purification', kind: 'tower', copies: 2, instant: false, token: false, text: 'Draw cards from the deck until your hand has 7 cards.' },
  { id: 'glyph', name: 'Glyph of Fortification', kind: 'tower', copies: 2, instant: true, token: false, text: 'Until your next turn, all heroes in target allied team become immune to all effects. Instant.' },
  { id: 'gate', name: "Fiend's Gate", kind: 'tower', copies: 2, instant: false, token: false, text: 'Move up to 5 heroes you own to form a new team you control.' },
]

export const TERRAINS: TerrainDef[] = [
  { id: 'river', name: 'River', text: 'A terrain — played three at a time as a combo. Two of a kind + one: 3. River, Jungle, Lane: 5. Three Rivers: 8 and take the top rune.' },
  { id: 'jungle', name: 'Jungle', text: 'A terrain — played three at a time as a combo. Two of a kind + one: 3. River, Jungle, Lane: 5. Three Jungles: 8 and take the top neutral.' },
  { id: 'lane', name: 'Lane', text: 'A terrain — played three at a time as a combo. Two of a kind + one: 3. River, Jungle, Lane: 5. Three Lanes: 8 and take the top tower.' },
]

export const HERO_BY_ID = Object.fromEntries(HEROES.map((entry) => [entry.id, entry])) as Record<string, HeroDef>
export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((entry) => [entry.id, entry])) as Record<string, ItemDef>
export const REWARD_BY_ID = Object.fromEntries(REWARDS.map((entry) => [entry.id, entry])) as Record<string, RewardDef>

export const CAST_IDS = new Set(
  HEROES.filter((entry) => entry.timing === 'cast' || entry.timing === 'instant').map((entry) => entry.id),
)

export const TRAP_IDS = new Set(HEROES.filter((entry) => entry.timing === 'trap').map((entry) => entry.id))

/** Traps that reward the team's controller; the rest punish them. */
export const WARD_IDS = new Set(['kez', 'ogre_magi', 'bounty_hunter', 'templar_assassin'])

/** True when the hero or neutral's ability can fire on play / via reactivate (not aura or trap). */
export function firesAbility(defId: string): boolean {
  const timing = HERO_BY_ID[defId]?.timing ?? REWARD_BY_ID[defId]?.timing
  return timing === 'cast' || timing === 'instant'
}

export const SAVE_IDS = new Set([
  'dawnbreaker',
  'dazzle',
  'shadow_demon',
  'shield',
  'glyph',
  'bkb',
  'euls',
  'oracle',
  'io',
])

export function display(defId: string): {
  name: string
  text: string
  spell?: string
  attr?: Attr
  range?: Range
  kind: CardKind
  instant: boolean
  timing?: Timing
} {
  const heroDef = HERO_BY_ID[defId]
  if (heroDef) {
    return {
      name: heroDef.name,
      text: heroDef.text,
      spell: heroDef.spell,
      attr: heroDef.attr,
      range: heroDef.range,
      kind: 'hero',
      instant: heroDef.timing === 'instant',
      timing: heroDef.timing,
    }
  }
  const item = ITEM_BY_ID[defId]
  if (item) return { name: item.name, text: item.text, kind: 'item', instant: item.instant, timing: item.instant ? 'instant' : undefined }
  const reward = REWARD_BY_ID[defId]
  if (reward) {
    const timing = reward.timing ?? (reward.instant ? 'instant' : undefined)
    return {
      name: reward.name,
      text: reward.text,
      spell: reward.spell,
      attr: reward.attr,
      range: reward.range,
      kind: reward.kind,
      instant: reward.instant || timing === 'instant',
      timing,
    }
  }
  const terrain = TERRAINS.find((entry) => entry.id === defId)
  if (terrain) return { name: terrain.name, text: terrain.text, kind: 'terrain', instant: false }
  if (defId === ANCIENT_ID) {
    return { name: ANCIENT.name, text: ANCIENT.text, kind: 'ancient', instant: false }
  }
  return { name: defId, text: '', kind: 'hero', instant: false }
}

export function cardKind(defId: string): CardKind {
  return display(defId).kind
}

export const MAIN_DECK_COUNT =
  HEROES.length +
  ITEMS.reduce((sum, item) => sum + item.copies, 0) +
  36 +
  1
