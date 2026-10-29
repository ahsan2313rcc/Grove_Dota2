import type { Attr, CardKind, Range, SettingKind, Timing } from './types.ts'

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
  instant: boolean
  token: boolean
}

export interface SettingDef {
  id: SettingKind
  name: string
  text: string
}

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

export const HEROES: HeroDef[] = [
  hero('alchemist', 'Alchemist', 'STR', 'Melee', "Greevil's Greed", 'Whenever an item enters the grave, draw 1.', 'aura'),
  hero('axe', 'Axe', 'STR', 'Melee', "Berserker's Call", 'Each opponent discards 2 cards at random.', 'cast'),
  hero('bristleback', 'Bristleback', 'STR', 'Melee', 'Bristleback', 'When Bristleback is destroyed, destroy an enemy hero.', 'aura'),
  hero('centaur_warrunner', 'Centaur Warrunner', 'STR', 'Melee', 'Retaliate', 'Whenever an enemy ability targets this team, that player discards a card for each Strength hero in this team.', 'aura'),
  hero('chaos_knight', 'Chaos Knight', 'STR', 'Melee', 'Chaos Bolt', 'Destroy a random enemy hero.', 'cast'),
  hero('clockwerk', 'Clockwerk', 'STR', 'Melee', 'Hookshot', 'Steal target enemy hero into this team.', 'cast'),
  hero('dawnbreaker', 'Dawnbreaker', 'STR', 'Melee', 'Solar Guardian', 'If target allied hero in this team would be destroyed this turn, return it to your hand instead. Instant.', 'instant'),
  hero('doom', 'Doom', 'STR', 'Melee', 'Doom', 'Destroy target enemy hero. That player cannot play heroes on their next turn.', 'cast'),
  hero('dragon_knight', 'Dragon Knight', 'STR', 'Melee', 'Elder Dragon Form', 'Dragon Knight counts as Ranged.', 'aura'),
  hero('earth_spirit', 'Earth Spirit', 'STR', 'Melee', 'Boulder Smash', 'Put target enemy hero on the bottom of the deck.', 'cast'),
  hero('earthshaker', 'Earthshaker', 'STR', 'Melee', 'Echo Slam', 'Destroy target enemy team if it has 3 or more heroes.', 'cast'),
  hero('elder_titan', 'Elder Titan', 'STR', 'Melee', 'Natural Order', 'While you control Elder Titan, enemy heroes have no attribute.', 'aura'),
  hero('huskar', 'Huskar', 'STR', 'Ranged', "Berserker's Blood", 'While your hand has 3 or fewer cards, Huskar cannot be destroyed.', 'aura'),
  hero('kunkka', 'Kunkka', 'STR', 'Melee', 'Ghostship', 'Reveal the top 5 cards of the deck. An opponent splits them into two piles. You keep one pile, and the other enters the grave.', 'cast'),
  hero('largo', 'Largo', 'STR', 'Melee', 'Catchy Lilt', 'Each player draws 2.', 'cast'),
  hero('legion_commander', 'Legion Commander', 'STR', 'Melee', 'Duel', 'Destroy Legion Commander and target enemy hero.', 'cast'),
  hero('lifestealer', 'Lifestealer', 'STR', 'Melee', 'Infest', 'Destroy Lifestealer. Target enemy hero enters a team you own and does not fire.', 'cast'),
  hero('lycan', 'Lycan', 'STR', 'Melee', 'Shapeshift', 'Draw a card when an ally enters this team.', 'aura'),
  hero('mars', 'Mars', 'STR', 'Melee', 'Bulwark', 'While you control Mars, enemy abilities cannot target this team.', 'aura'),
  hero('night_stalker', 'Night Stalker', 'STR', 'Melee', 'Dark Ascension', 'Steal 2 cards from target opponent.', 'cast'),
  hero('ogre_magi', 'Ogre Magi', 'STR', 'Melee', 'Multicast', 'The next ability you play this turn resolves twice.', 'cast'),
  hero('omniknight', 'Omniknight', 'STR', 'Melee', 'Guardian Angel', 'The next time target hero you own would be destroyed, it stays.', 'cast'),
  hero('phoenix', 'Phoenix', 'STR', 'Ranged', 'Supernova', 'Exile Phoenix and target enemy hero.', 'cast'),
  hero('primal_beast', 'Primal Beast', 'STR', 'Melee', 'Pulverize', 'Destroy up to 2 heroes in target enemy team.', 'cast'),
  hero('pudge', 'Pudge', 'STR', 'Melee', 'Meat Hook', "A random hero from target opponent's hand enters this team and does not fire.", 'cast'),
  hero('slardar', 'Slardar', 'STR', 'Melee', 'Corrosive Haze', 'Target enemy hero loses its attribute.', 'cast'),
  hero('spirit_breaker', 'Spirit Breaker', 'STR', 'Melee', 'Charge of Darkness', 'Destroy the enemy hero that most recently entered a team.', 'cast'),
  hero('sven', 'Sven', 'STR', 'Melee', "God's Strength", 'If this team has 3 or more Strength heroes, destroy target enemy team.', 'cast'),
  hero('tidehunter', 'Tidehunter', 'STR', 'Melee', 'Ravage', "Return every hero to its owner's hand, except heroes in this team.", 'cast'),
  hero('timbersaw', 'Timbersaw', 'STR', 'Melee', 'Whirling Death', 'Destroy every Strength hero in target enemy team.', 'cast'),
  hero('tiny', 'Tiny', 'STR', 'Melee', 'Toss', 'Move target enemy hero to a team its owner controls.', 'cast'),
  hero('treant_protector', 'Treant Protector', 'STR', 'Melee', 'Living Armor', 'While you control Treant Protector, target setting combo cannot be targeted or destroyed.', 'cast'),
  hero('tusk', 'Tusk', 'STR', 'Melee', 'Snowball', 'Tusk and target hero you own cannot be destroyed until your next turn.', 'cast'),
  hero('underlord', 'Underlord', 'STR', 'Melee', 'Dark Rift', 'Move up to 5 heroes you own into one team.', 'cast'),
  hero('undying', 'Undying', 'STR', 'Melee', 'Tombstone', 'Put target hero from the grave into your hand.', 'cast'),
  hero('wraith_king', 'Wraith King', 'STR', 'Melee', 'Reincarnation', 'The first time Wraith King is destroyed, he returns to this team.', 'aura'),
  hero('anti_mage', 'Anti-Mage', 'AGI', 'Melee', 'Mana Void', 'Destroy every Intelligence hero on the board.', 'cast'),
  hero('bloodseeker', 'Bloodseeker', 'AGI', 'Melee', 'Rupture', 'Whenever target enemy hero leaves its team, destroy it.', 'cast'),
  hero('bounty_hunter', 'Bounty Hunter', 'AGI', 'Melee', 'Track', "Look at target opponent's hand.", 'cast'),
  hero('broodmother', 'Broodmother', 'AGI', 'Melee', 'Spin Web', 'Reveal from the deck until you reveal a setting. Put it into your hand and put the rest on the bottom.', 'cast'),
  hero('clinkz', 'Clinkz', 'AGI', 'Ranged', 'Death Pact', "Exile a hero from the grave. Clinkz's attribute becomes that hero's attribute.", 'cast'),
  hero('drow_ranger', 'Drow Ranger', 'AGI', 'Ranged', 'Marksmanship', 'If this team has 3 or more Ranged heroes, destroy target enemy hero.', 'cast'),
  hero('ember_spirit', 'Ember Spirit', 'AGI', 'Melee', 'Fire Remnant', 'You may move Ember Spirit to any team you own at any time.', 'aura'),
  hero('faceless_void', 'Faceless Void', 'AGI', 'Melee', 'Chronosphere', 'Enemies skip their next turn.', 'cast'),
  hero('gyrocopter', 'Gyrocopter', 'AGI', 'Ranged', 'Call Down', 'Choose an attribute. Destroy one hero of that attribute controlled by each opponent.', 'cast'),
  hero('hoodwink', 'Hoodwink', 'AGI', 'Ranged', 'Sharpshooter', 'Destroy target hero or setting combo.', 'cast'),
  hero('juggernaut', 'Juggernaut', 'AGI', 'Melee', 'Omnislash', 'Destroy up to X enemy heroes, where X is the number of heroes in this team.', 'cast'),
  hero('kez', 'Kez', 'AGI', 'Melee', 'Switch Discipline', 'While you control Kez, enemy heroes cannot target him.', 'aura'),
  hero('lone_druid', 'Lone Druid', 'AGI', 'Ranged', 'Summon Spirit Bear', 'Put the top card of the tower pile into your hand.', 'cast'),
  hero('luna', 'Luna', 'AGI', 'Ranged', 'Eclipse', 'Destroy one random enemy hero for each hero in target enemy team.', 'cast'),
  hero('medusa', 'Medusa', 'AGI', 'Ranged', 'Stone Gaze', 'Move Medusa into target enemy team. Heroes there lose their attributes and keep Melee or Ranged.', 'cast'),
  hero('meepo', 'Meepo', 'AGI', 'Melee', 'Divided We Stand', 'Meepo counts as 2 heroes.', 'aura'),
  hero('mirana', 'Mirana', 'AGI', 'Ranged', 'Sacred Arrow', 'Look at the top 4 cards of the deck. Put one into your hand and put the rest on the bottom.', 'cast'),
  hero('monkey_king', 'Monkey King', 'AGI', 'Melee', 'Boundless Strike', "Destroy every hero in target team that shares target hero's attribute.", 'cast'),
  hero('morphling', 'Morphling', 'AGI', 'Ranged', 'Morph', 'Exile target enemy hero under Morphling until you no longer control him. Morphling copies its attribute and may cast its ability this turn.', 'cast'),
  hero('naga_siren', 'Naga Siren', 'AGI', 'Melee', 'Song of the Siren', 'No hero can be destroyed until your next turn.', 'cast'),
  hero('phantom_assassin', 'Phantom Assassin', 'AGI', 'Melee', 'Coup de Grace', 'Destroy target enemy hero in a team of exactly 1 or exactly 5.', 'cast'),
  hero('phantom_lancer', 'Phantom Lancer', 'AGI', 'Melee', 'Juxtapose', 'If Phantom Lancer would be destroyed, return him to your hand instead.', 'aura'),
  hero('razor', 'Razor', 'AGI', 'Ranged', 'Static Link', 'Exile target enemy hero under Razor until you no longer control him.', 'cast'),
  hero('riki', 'Riki', 'AGI', 'Melee', 'Cloak and Dagger', 'Enemies cannot target Riki.', 'aura'),
  hero('shadow_fiend', 'Shadow Fiend', 'AGI', 'Ranged', 'Necromastery', 'Whenever a hero is destroyed, draw 1.', 'aura'),
  hero('slark', 'Slark', 'AGI', 'Melee', 'Shadow Dance', 'If you would draw while Slark is in the grave, you may put the top 3 cards of the deck into the grave and return Slark to your hand instead.', 'aura'),
  hero('sniper', 'Sniper', 'AGI', 'Ranged', 'Assassinate', 'Destroy target enemy hero in a team of 4 or 5.', 'cast'),
  hero('spectre', 'Spectre', 'AGI', 'Melee', 'Haunt', 'Choose an attribute. Destroy one hero of that attribute in each team an opponent controls.', 'cast'),
  hero('templar_assassin', 'Templar Assassin', 'AGI', 'Ranged', 'Refraction', 'Counter the next ability that targets Templar Assassin.', 'aura'),
  hero('terrorblade', 'Terrorblade', 'AGI', 'Melee', 'Sunder', 'Swap control of target team you control and target team an opponent controls.', 'cast'),
  hero('troll_warlord', 'Troll Warlord', 'AGI', 'Ranged', 'Battle Trance', 'Until end of turn, destroys you cause cannot be prevented.', 'cast'),
  hero('ursa', 'Ursa', 'AGI', 'Melee', 'Enrage', 'Whenever you play an item, Ursa cannot be destroyed until your next turn.', 'aura'),
  hero('vengeful_spirit', 'Vengeful Spirit', 'AGI', 'Ranged', 'Nether Swap', 'Swap control of Vengeful Spirit and target enemy hero.', 'cast'),
  hero('viper', 'Viper', 'AGI', 'Ranged', 'Viper Strike', "Destroy target enemy hero at the start of its owner's next turn.", 'cast'),
  hero('weaver', 'Weaver', 'AGI', 'Ranged', 'Time Lapse', 'Return the last card that entered the grave this turn to where it left.', 'cast'),
  hero('ancient_apparition', 'Ancient Apparition', 'INT', 'Ranged', 'Ice Blast', 'While you control Ancient Apparition, enemy heroes that would enter the grave are exiled instead.', 'aura'),
  hero('chen', 'Chen', 'INT', 'Ranged', 'Holy Persuasion', 'Put the top card of the neutral pile into your hand.', 'cast'),
  hero('crystal_maiden', 'Crystal Maiden', 'INT', 'Ranged', 'Arcane Aura', 'Draw until your hand limit.', 'cast'),
  hero('dark_seer', 'Dark Seer', 'INT', 'Melee', 'Surge', 'Gain 2 actions.', 'cast'),
  hero('dark_willow', 'Dark Willow', 'INT', 'Ranged', 'Terrorize', 'Each player discards 1 card for each team they control.', 'cast'),
  hero('disruptor', 'Disruptor', 'INT', 'Ranged', 'Glimpse', 'Put target enemy hero on top of the deck.', 'cast'),
  hero('enchantress', 'Enchantress', 'INT', 'Ranged', 'Enchant', 'Move target enemy hero into a team you own.', 'cast'),
  hero('grimstroke', 'Grimstroke', 'INT', 'Ranged', 'Soulbind', 'Until end of turn, if one of two target enemy heroes is destroyed, destroy the other.', 'cast'),
  hero('invoker', 'Invoker', 'INT', 'Ranged', 'Cataclysm', 'Each player discards their hand and draws 3.', 'cast'),
  hero('jakiro', 'Jakiro', 'INT', 'Ranged', 'Ice Path', 'Heroes cannot enter target team until your next turn.', 'cast'),
  hero('keeper_of_the_light', 'Keeper of the Light', 'INT', 'Ranged', 'Chakra Magic', 'Target hero you own casts its ability again.', 'cast'),
  hero('leshrac', 'Leshrac', 'INT', 'Ranged', 'Pulse Nova', 'Put cards from the deck into the grave until an item is revealed, and put that item into your hand.', 'cast'),
  hero('lich', 'Lich', 'INT', 'Ranged', 'Chain Frost', 'Destroy target enemy hero and one enemy hero in a different team that player controls.', 'cast'),
  hero('lina', 'Lina', 'INT', 'Ranged', 'Laguna Blade', 'Destroy target enemy hero. This cannot be prevented.', 'cast'),
  hero('lion', 'Lion', 'INT', 'Ranged', 'Finger of Death', "Exile a hero from target opponent's hand.", 'cast'),
  hero('muerta', 'Muerta', 'INT', 'Ranged', 'Pierce the Veil', 'While you control Muerta, enemies cannot take cards from the grave.', 'aura'),
  hero('necrophos', 'Necrophos', 'INT', 'Ranged', "Reaper's Scythe", 'Exile target enemy hero.', 'cast'),
  hero('oracle', 'Oracle', 'INT', 'Ranged', 'False Promise', 'Destroy target allied hero. It returns to your hand instead of entering the grave.', 'cast'),
  hero('outworld_destroyer', 'Outworld Destroyer', 'INT', 'Ranged', "Sanity's Eclipse", 'Target opponent chooses to discard 4 cards or to exile one of their heroes.', 'cast'),
  hero('puck', 'Puck', 'INT', 'Ranged', 'Dream Coil', 'Until your next turn, heroes cannot enter or leave target enemy team, though they can still be destroyed or exiled.', 'cast'),
  hero('pugna', 'Pugna', 'INT', 'Ranged', 'Nether Ward', 'Whenever an opponent plays a hero, they discard 1 or that hero does not fire.', 'aura'),
  hero('queen_of_pain', 'Queen of Pain', 'INT', 'Ranged', 'Sonic Wave', 'Target opponent discards their hand and draws 1.', 'cast'),
  hero('ringmaster', 'Ringmaster', 'INT', 'Ranged', 'Wheel of Wonder', 'Target opponent chooses to discard their hand or to let you destroy one of their teams.', 'cast'),
  hero('rubick', 'Rubick', 'INT', 'Ranged', 'Spell Steal', 'Copy an active ability of an enemy hero and cast it. You may choose new targets.', 'cast'),
  hero('shadow_demon', 'Shadow Demon', 'INT', 'Ranged', 'Disruption', "Return target hero to its owner's hand. That hero cannot be played while you control Shadow Demon. Instant.", 'instant'),
  hero('shadow_shaman', 'Shadow Shaman', 'INT', 'Ranged', 'Shackles', 'Exile Shadow Shaman and target enemy hero.', 'cast'),
  hero('silencer', 'Silencer', 'INT', 'Ranged', 'Global Silence', 'Hero abilities do not fire until your next turn.', 'cast'),
  hero('skywrath_mage', 'Skywrath Mage', 'INT', 'Ranged', 'Mystic Flare', 'Target opponent discards 1 card for each Intelligence hero in this team.', 'cast'),
  hero('storm_spirit', 'Storm Spirit', 'INT', 'Ranged', 'Ball Lightning', 'Discard any number of cards to gain that many actions.', 'cast'),
  hero('tinker', 'Tinker', 'INT', 'Ranged', 'Rearm', 'Return target item from the grave to your hand. You may cast it immediately.', 'cast'),
  hero('warlock', 'Warlock', 'INT', 'Ranged', 'Fatal Bonds', 'Until end of turn, if a hero in target enemy team is destroyed, destroy the rest of that team.', 'cast'),
  hero('winter_wyvern', 'Winter Wyvern', 'INT', 'Ranged', "Winter's Curse", 'Target opponent keeps one hero in target team and destroys the rest.', 'cast'),
  hero('witch_doctor', 'Witch Doctor', 'INT', 'Ranged', 'Maledict', 'Whenever target opponent discards a card this turn, destroy one of their heroes.', 'cast'),
  hero('zeus', 'Zeus', 'INT', 'Ranged', "Thundergod's Wrath", "Look at each opponent's hand and discard one card of your choice from each.", 'cast'),
  hero('abaddon', 'Abaddon', 'UNI', 'Melee', 'Borrowed Time', 'The next time a hero you own would be destroyed, Abaddon is destroyed instead.', 'aura'),
  hero('arc_warden', 'Arc Warden', 'UNI', 'Ranged', 'Magnetic Field', 'Put the top card of the rune pile into your hand.', 'cast'),
  hero('bane', 'Bane', 'UNI', 'Ranged', "Fiend's Grip", 'Target opponent skips their next turn.', 'cast'),
  hero('batrider', 'Batrider', 'UNI', 'Ranged', 'Flaming Lasso', "Move target enemy hero into this team. It returns to its owner's control at the start of your next turn.", 'cast'),
  hero('beastmaster', 'Beastmaster', 'UNI', 'Melee', 'Primal Roar', 'Split target enemy team into up to 3 teams. You choose which heroes go to each.', 'cast'),
  hero('brewmaster', 'Brewmaster', 'UNI', 'Melee', 'Primal Split', 'Brewmaster counts as Strength, Agility, and Intelligence.', 'aura'),
  hero('dazzle', 'Dazzle', 'UNI', 'Ranged', 'Shallow Grave', 'Target hero you own cannot be destroyed until your next turn. Instant.', 'instant'),
  hero('death_prophet', 'Death Prophet', 'UNI', 'Ranged', 'Exorcism', 'Whenever a hero you own is destroyed, draw 2.', 'aura'),
  hero('enigma', 'Enigma', 'UNI', 'Ranged', 'Black Hole', 'Destroy target enemy team.', 'cast'),
  hero('io', 'Io', 'UNI', 'Ranged', 'Tether', 'Draw cards from the top of the grave equal to the number of players, and give one to each player of your choice.', 'cast'),
  hero('magnus', 'Magnus', 'UNI', 'Melee', 'Reverse Polarity', 'Gather up to 5 heroes an opponent controls into a new team. The rest stay.', 'cast'),
  hero('marci', 'Marci', 'UNI', 'Melee', 'Dispose', 'Move an allied hero from this team to any team you own, or from any team you own into this team.', 'cast'),
  hero('natures_prophet', "Nature's Prophet", 'UNI', 'Ranged', 'Wrath of Nature', 'Destroy one random enemy hero for each setting type you control.', 'cast'),
  hero('nyx_assassin', 'Nyx Assassin', 'UNI', 'Melee', 'Spiked Carapace', 'Discard Nyx Assassin from your hand to counter a card. The countered card goes to the grave. Instant.', 'instant'),
  hero('pangolier', 'Pangolier', 'UNI', 'Melee', 'Lucky Shot', 'Name hero, item, or setting. If an opponent has a card of that type, they give it to you.', 'cast'),
  hero('sand_king', 'Sand King', 'UNI', 'Melee', 'Epicenter', 'Each opponent destroys one hero they control.', 'cast'),
  hero('snapfire', 'Snapfire', 'UNI', 'Ranged', 'Mortimer Kisses', 'Destroy up to 2 random heroes in target enemy team.', 'cast'),
  hero('techies', 'Techies', 'UNI', 'Ranged', 'Proximity Mines', 'Put the top card of the deck face down on an enemy team. The next hero to enter that team is destroyed, and that card enters the grave.', 'cast'),
  hero('venomancer', 'Venomancer', 'UNI', 'Ranged', 'Poison Nova', 'While you control Venomancer, enemies cannot play items.', 'aura'),
  hero('visage', 'Visage', 'UNI', 'Ranged', 'Soul Assumption', 'Draw 1 for each card that entered the grave this turn.', 'cast'),
  hero('void_spirit', 'Void Spirit', 'UNI', 'Melee', 'Dissimilate', 'Swap hands with target opponent.', 'cast'),
  hero('windranger', 'Windranger', 'UNI', 'Ranged', 'Focus Fire', 'Destroy a setting combo you control and target enemy team.', 'cast'),
]

export const ITEMS: ItemDef[] = [
  { id: 'tp_scroll', name: 'Town Portal Scroll', copies: 3, instant: false, text: 'Move a hero you control to another team.' },
  { id: 'ward', name: 'Ward', copies: 3, instant: false, text: "Reveal an opponent's hand until the end of this turn." },
  { id: 'clarity', name: 'Clarity', copies: 3, instant: false, text: 'Search the deck for a setting and put it into your hand. Shuffle.' },
  { id: 'gloves', name: 'Gloves of Haste', copies: 3, instant: false, text: "Steal a random card from an opponent's hand." },
  { id: 'blink', name: 'Blink Dagger', copies: 2, instant: true, text: 'Move a hero you own into another team you own. Instant.' },
  { id: 'force_staff', name: 'Force Staff', copies: 2, instant: true, text: 'Move an enemy hero into a different team that player owns. Instant.' },
  { id: 'euls', name: "Eul's Scepter", copies: 2, instant: true, text: 'Set a hero aside. It returns to its team at the end of the turn and does not fire. Instant.' },
  { id: 'gem', name: 'Gem of True Sight', copies: 2, instant: false, text: "Reveal an opponent's hand and take a card of your choice." },
  { id: 'shadow_blade', name: 'Shadow Blade', copies: 2, instant: true, text: 'Until your next turn, target hero cannot be chosen by opponents. Instant.' },
  { id: 'orchid', name: 'Orchid Malevolence', copies: 2, instant: true, text: 'Target enemy hero does not fire its ability. Instant.' },
  { id: 'bkb', name: 'Black King Bar', copies: 1, instant: true, text: 'Until your next turn, target hero is immune to effects. Instant.' },
  { id: 'scythe', name: 'Scythe of Vyse', copies: 1, instant: true, text: 'Exile target enemy hero. Instant.' },
  { id: 'refresher', name: 'Refresher Orb', copies: 1, instant: false, text: 'A hero you own fires its ability again.' },
  { id: 'abyssal', name: 'Abyssal Blade', copies: 1, instant: true, text: 'Put target enemy hero on the top or bottom of the deck, then draw 1. Instant.' },
  { id: 'dagon', name: 'Dagon', copies: 1, instant: true, text: 'Destroy target enemy hero. Instant.' },
  { id: 'halberd', name: "Heaven's Halberd", copies: 1, instant: false, text: 'Target opponent cannot play heroes on their next turn.' },
  { id: 'assault', name: 'Assault Cuirass', copies: 1, instant: false, text: 'Gain 3 actions.' },
  { id: 'shivas', name: "Shiva's Guard", copies: 1, instant: false, text: 'Each opponent discards 1 card.' },
  { id: 'heart', name: 'Heart of Tarrasque', copies: 1, instant: false, text: 'Put a hero from the grave into your hand.' },
  { id: 'rapier', name: 'Divine Rapier', copies: 1, instant: false, text: 'Destroy target enemy team.' },
  { id: 'greaves', name: 'Guardian Greaves', copies: 1, instant: false, text: 'Discard 2 cards, then draw 4.' },
  { id: 'satanic', name: 'Satanic', copies: 1, instant: false, text: 'Move target enemy hero into a team you control. You may fire its ability.' },
]

export const REWARDS: RewardDef[] = [
  { id: 'haste', name: 'Haste Rune', kind: 'rune', copies: 1, instant: true, token: false, text: 'Draw 1. Instant.' },
  { id: 'double_damage', name: 'Double Damage', kind: 'rune', copies: 1, instant: true, token: false, text: 'Gain 2 actions. This only works on your turn. Instant.' },
  { id: 'regen', name: 'Regen Rune', kind: 'rune', copies: 1, instant: true, token: false, text: 'Put the top card of the grave into your hand. Instant.' },
  { id: 'arcane', name: 'Arcane Rune', kind: 'rune', copies: 1, instant: true, token: false, text: 'A hero you own fires its ability again. Instant.' },
  { id: 'shield', name: 'Shield Rune', kind: 'rune', copies: 1, instant: true, token: false, text: 'Until your next turn, target hero ignores abilities, items, and rewards. Instant.' },
  { id: 'illusion', name: 'Illusion Rune', kind: 'rune', copies: 1, instant: true, token: false, text: "Return target hero to its owner's hand. That player discards a card. Instant." },
  { id: 'stone_golem', name: 'Stone Golem', kind: 'neutral', copies: 1, instant: true, token: true, attr: 'STR', text: 'A Strength body with no ability. One neutral to a team. Instant.' },
  { id: 'thunderhide', name: 'Thunderhide', kind: 'neutral', copies: 1, instant: true, token: true, attr: 'AGI', text: 'An Agility body with no ability. One neutral to a team. Instant.' },
  { id: 'ice_shaman', name: 'Ice Shaman', kind: 'neutral', copies: 1, instant: true, token: true, attr: 'INT', text: 'An Intelligence body with no ability. One neutral to a team. Instant.' },
  { id: 'black_dragon', name: 'Black Dragon', kind: 'neutral', copies: 1, instant: true, token: true, attr: 'UNI', text: 'A Universal body with no ability. One neutral to a team. Instant.' },
  { id: 'roshan', name: 'Roshan', kind: 'neutral', copies: 1, instant: true, token: true, attr: 'UNI', text: 'A Universal body. The first time another hero in this team would be destroyed, Roshan is destroyed instead. Instant.' },
  { id: 'tormentor', name: 'Tormentor', kind: 'neutral', copies: 1, instant: true, token: false, text: 'Destroy a hero that entered a team this turn. Instant.' },
  { id: 'glyph', name: 'Glyph', kind: 'tower', copies: 2, instant: true, token: false, text: 'Until your next turn, target team ignores abilities, items, and rewards. Instant.' },
  { id: 'lotus', name: 'Lotus', kind: 'tower', copies: 2, instant: true, token: false, text: 'Put any hero from the grave into your hand. Instant.' },
  { id: 'gate', name: 'Gate', kind: 'tower', copies: 2, instant: true, token: false, text: 'Merge two teams you own into one. The team cannot hold more than 5 heroes. Instant.' },
]

export const SETTINGS: SettingDef[] = [
  { id: 'river', name: 'River', text: 'A setting — cannot be played alone. Three Rivers score 5 and take the top rune. A River, a Jungle, and a Lane score 5.' },
  { id: 'jungle', name: 'Jungle', text: 'A setting — cannot be played alone. Three Jungles score 5 and take the top neutral. A River, a Jungle, and a Lane score 5.' },
  { id: 'lane', name: 'Lane', text: 'A setting — cannot be played alone. Three Lanes score 5 and take the top tower. A River, a Jungle, and a Lane score 5.' },
]

export const HERO_BY_ID = Object.fromEntries(HEROES.map((entry) => [entry.id, entry])) as Record<string, HeroDef>
export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((entry) => [entry.id, entry])) as Record<string, ItemDef>
export const REWARD_BY_ID = Object.fromEntries(REWARDS.map((entry) => [entry.id, entry])) as Record<string, RewardDef>

export const CAST_IDS = new Set(
  HEROES.filter((entry) => entry.timing === 'cast' || entry.timing === 'instant').map((entry) => entry.id),
)

export const SAVE_IDS = new Set([
  'dawnbreaker',
  'dazzle',
  'shadow_demon',
  'shield',
  'glyph',
  'bkb',
  'euls',
])

export function display(defId: string): { name: string; text: string; spell?: string; attr?: Attr; range?: Range; kind: CardKind; instant: boolean } {
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
    }
  }
  const item = ITEM_BY_ID[defId]
  if (item) return { name: item.name, text: item.text, kind: 'item', instant: item.instant }
  const reward = REWARD_BY_ID[defId]
  if (reward) {
    return {
      name: reward.name,
      text: reward.text,
      attr: reward.attr,
      kind: reward.kind,
      instant: reward.instant,
    }
  }
  const setting = SETTINGS.find((entry) => entry.id === defId)
  if (setting) return { name: setting.name, text: setting.text, kind: 'setting', instant: false }
  return { name: defId, text: '', kind: 'hero', instant: false }
}

export function cardKind(defId: string): CardKind {
  return display(defId).kind
}

export const MAIN_DECK_COUNT =
  HEROES.length +
  ITEMS.reduce((sum, item) => sum + item.copies, 0) +
  36
