/**
 * Deck-weighted mechanic audit.
 * Denominator 199 = heroes (127) + item copies (36) + terrains (36), excluding Ancient.
 * A card may land in multiple rows. Heroes weigh 1; items weigh `copies`.
 */
import { HEROES, ITEMS } from '../src/game/catalog.ts'

const DENOM = 199

type Tag =
  | 'hero_destroy'
  | 'hero_destroy_cond'
  | 'team_destroy'
  | 'team_destroy_cond'
  | 'swap_hero'
  | 'swap_team'
  | 'terrain_destroy'
  | 'hero_exile'
  | 'hero_exile_cond'
  | 'team_exile'
  | 'team_exile_cond'
  | 'draw_1'
  | 'draw_1_cond'
  | 'draw_3plus'
  | 'draw_3plus_cond'
  | 'discard_1'
  | 'discard_1_cond'
  | 'discard_3plus'
  | 'discard_3plus_cond'
  | 'discard_hand'
  | 'discard_hand_cond'
  | 'steal_card'
  | 'reveal_hand'
  | 'force_discard'
  | 'trap'
  | 'hero_to_hand'
  | 'hero_to_deck'
  | 'search_deck'
  | 'grave_draw'
  | 'hero_immune'
  | 'hero_immune_cond'
  | 'team_immune'
  | 'untargetable'
  | 'silence'
  | 'block_instant'
  | 'block_ability'
  | 'block_item'
  | 'block_hero_play'
  | 'block_draw'

type Entry = { id: string; name: string; weight: number; tags: Tag[]; note?: string }

const heroes: Entry[] = [
  // —— destroy hero (free) ——
  { id: 'lina', name: 'Lina', weight: 1, tags: ['hero_destroy'], note: 'cannot be avoided' },
  { id: 'spectre', name: 'Spectre', weight: 1, tags: ['hero_destroy'], note: '1 per opponent' },
  { id: 'shadow_shaman', name: 'Shadow Shaman', weight: 1, tags: ['trap', 'hero_destroy'] },
  { id: 'anti_mage', name: 'Anti-Mage', weight: 1, tags: ['hero_destroy'], note: 'all INT on target' },
  { id: 'timbersaw', name: 'Timbersaw', weight: 1, tags: ['hero_destroy'], note: 'all STR on target' },
  { id: 'dark_willow', name: 'Dark Willow', weight: 1, tags: ['hero_destroy'], note: 'each opp sacrifices 1' },
  { id: 'tiny', name: 'Tiny', weight: 1, tags: ['hero_destroy'], note: 'toss into foe team; destroy 2 others' },
  { id: 'lich', name: 'Lich', weight: 1, tags: ['hero_destroy_cond'], note: '2 from adjacent teams' },
  { id: 'gyrocopter', name: 'Gyrocopter', weight: 1, tags: ['hero_destroy_cond'], note: 'named attr exists' },
  { id: 'drow_ranger', name: 'Drow Ranger', weight: 1, tags: ['hero_destroy_cond'], note: '3+ ranged' },
  { id: 'hoodwink', name: 'Hoodwink', weight: 1, tags: ['hero_destroy_cond', 'terrain_destroy'], note: 'need Jungle; hero OR terrain' },
  { id: 'visage', name: 'Visage', weight: 1, tags: ['hero_destroy_cond', 'discard_1_cond'], note: 'pay discards' },
  { id: 'natures_prophet', name: "Nature's Prophet", weight: 1, tags: ['hero_destroy_cond'], note: 'per opp terrain' },
  { id: 'sand_king', name: 'Sand King', weight: 1, tags: ['hero_destroy_cond', 'force_discard'], note: 'discard hero else destroy' },
  { id: 'witch_doctor', name: 'Witch Doctor', weight: 1, tags: ['hero_destroy_cond'], note: 'on their discard' },
  { id: 'nyx_assassin', name: 'Nyx Assassin', weight: 1, tags: ['hero_destroy_cond'], note: 'counter then destroy' },
  { id: 'spirit_breaker', name: 'Spirit Breaker', weight: 1, tags: ['hero_destroy_cond'], note: 'counter last played' },
  { id: 'winter_wyvern', name: 'Winter Wyvern', weight: 1, tags: ['hero_destroy_cond'], note: 'sacrifice all but 1 on a team' },
  { id: 'bloodseeker', name: 'Bloodseeker', weight: 1, tags: ['hero_destroy_cond'], note: 'leave → destroy' },
  { id: 'warlock', name: 'Warlock', weight: 1, tags: ['team_destroy_cond'], note: 'on destroy → wipe team' },

  // —— destroy team ——
  { id: 'enigma', name: 'Enigma', weight: 1, tags: ['team_destroy'], note: '1 team per player' },
  { id: 'techies', name: 'Techies', weight: 1, tags: ['trap', 'team_destroy', 'draw_1'], note: 'destroy trapped team' },
  { id: 'earthshaker', name: 'Earthshaker', weight: 1, tags: ['team_destroy_cond'], note: 'team size ≥3' },
  { id: 'sven', name: 'Sven', weight: 1, tags: ['team_destroy_cond'], note: '3+ STR on own team' },
  { id: 'bristleback', name: 'Bristleback', weight: 1, tags: ['team_destroy_cond'], note: 'when BB destroyed' },

  // —— swap ——
  { id: 'vengeful_spirit', name: 'Vengeful Spirit', weight: 1, tags: ['swap_hero'] },
  { id: 'terrorblade', name: 'Terrorblade', weight: 1, tags: ['swap_team'] },

  // —— exile hero ——
  { id: 'morphling', name: 'Morphling', weight: 1, tags: ['hero_exile'] },
  { id: 'razor', name: 'Razor', weight: 1, tags: ['hero_exile'] },
  { id: 'necrophos', name: 'Necrophos', weight: 1, tags: ['hero_exile', 'block_hero_play'], note: 'block same attr after' },
  { id: 'shadow_demon', name: 'Shadow Demon', weight: 1, tags: ['hero_exile'], note: 'also ally save' },
  { id: 'lion', name: 'Lion', weight: 1, tags: ['hero_exile_cond', 'reveal_hand'], note: 'exile from hand' },
  { id: 'oracle', name: 'Oracle', weight: 1, tags: ['hero_exile_cond', 'hero_immune_cond'], note: 'ally exile-save' },
  { id: 'phantom_assassin', name: 'Phantom Assassin', weight: 1, tags: ['hero_exile_cond'], note: 'hand-return → exile' },
  { id: 'ancient_apparition', name: 'Ancient Apparition', weight: 1, tags: ['hero_exile_cond'], note: 'gravebound → exile' },
  { id: 'lifestealer', name: 'Lifestealer', weight: 1, tags: ['hero_exile_cond', 'swap_hero'], note: 'self-exile + take control' },

  // —— exile team ——
  { id: 'medusa', name: 'Medusa', weight: 1, tags: ['team_exile'] },
  { id: 'outworld_destroyer', name: 'Outworld Destroyer', weight: 1, tags: ['discard_3plus', 'team_exile_cond'], note: 'discard 4 else exile team' },

  // —— bounce hero → hand / deck ——
  { id: 'tidehunter', name: 'Tidehunter', weight: 1, tags: ['hero_to_hand', 'discard_3plus'], note: 'team to hand + discard 5' },
  { id: 'legion_commander', name: 'Legion Commander', weight: 1, tags: ['hero_to_hand'], note: 'take hero to hand if larger team' },
  { id: 'earth_spirit', name: 'Earth Spirit', weight: 1, tags: ['hero_to_deck'] },
  { id: 'phoenix', name: 'Phoenix', weight: 1, tags: ['hero_to_deck', 'hero_exile_cond'], note: 'may self-exile; team to bottom' },
  { id: 'batrider', name: 'Batrider', weight: 1, tags: ['hero_to_deck'], note: 'team to top of deck' },
  { id: 'disruptor', name: 'Disruptor', weight: 1, tags: ['hero_to_deck'], note: 'card top/bottom — often hero from board via effect' },
  { id: 'abaddon', name: 'Abaddon', weight: 1, tags: ['hero_to_deck', 'hero_immune_cond'], note: 'destroy → top of deck' },
  { id: 'phantom_lancer', name: 'Phantom Lancer', weight: 1, tags: ['hero_to_hand', 'hero_immune_cond'], note: 'destroy → hand' },
  { id: 'dawnbreaker', name: 'Dawnbreaker', weight: 1, tags: ['hero_to_hand', 'hero_immune_cond'], note: 'save → hand' },
  { id: 'wraith_king', name: 'Wraith King', weight: 1, tags: ['hero_immune_cond'], note: 'reincarnate (save, not hostile exile)' },
  { id: 'undying', name: 'Undying', weight: 1, tags: ['hero_immune_cond', 'discard_1_cond'], note: 'discard to not die' },

  // —— draw ——
  { id: 'alchemist', name: 'Alchemist', weight: 1, tags: ['draw_1_cond'], note: 'on item to grave' },
  { id: 'lycan', name: 'Lycan', weight: 1, tags: ['draw_1_cond'], note: 'ally enters' },
  { id: 'shadow_fiend', name: 'Shadow Fiend', weight: 1, tags: ['draw_1_cond'], note: 'enemy destroyed' },
  { id: 'largo', name: 'Largo', weight: 1, tags: ['draw_1_cond'], note: '1 per team' },
  { id: 'slardar', name: 'Slardar', weight: 1, tags: ['draw_1_cond'], note: 'per River' },
  { id: 'skywrath_mage', name: 'Skywrath Mage', weight: 1, tags: ['force_discard', 'discard_1_cond'], note: 'discard per INT' },
  { id: 'crystal_maiden', name: 'Crystal Maiden', weight: 1, tags: ['draw_3plus'], note: 'fill to 7' },
  { id: 'io', name: 'Io', weight: 1, tags: ['draw_3plus_cond'], note: 'draw = player count' },
  { id: 'clockwerk', name: 'Clockwerk', weight: 1, tags: ['draw_1', 'search_deck'], note: 'top 3 split' },
  { id: 'dragon_knight', name: 'Dragon Knight', weight: 1, tags: ['search_deck', 'draw_1_cond'], note: 'terrains from top 5' },
  { id: 'kunkka', name: 'Kunkka', weight: 1, tags: ['draw_3plus_cond'], note: 'pile from top 5' },
  { id: 'broodmother', name: 'Broodmother', weight: 1, tags: ['search_deck'] },
  { id: 'luna', name: 'Luna', weight: 1, tags: ['search_deck'], note: 'on Jungle' },
  { id: 'mirana', name: 'Mirana', weight: 1, tags: ['draw_1_cond'] },
  { id: 'clinkz', name: 'Clinkz', weight: 1, tags: [], note: 'exile top 5 of deck (not board heroes)' },
  { id: 'lone_druid', name: 'Lone Druid', weight: 1, tags: ['draw_1'], note: 'top tower' },
  { id: 'chen', name: 'Chen', weight: 1, tags: ['draw_1'], note: 'top neutral' },
  { id: 'arc_warden', name: 'Arc Warden', weight: 1, tags: ['draw_1'], note: 'top rune' },
  { id: 'leshrac', name: 'Leshrac', weight: 1, tags: ['search_deck'] },
  { id: 'tinker', name: 'Tinker', weight: 1, tags: ['grave_draw'] },
  { id: 'death_prophet', name: 'Death Prophet', weight: 1, tags: ['grave_draw'] },
  { id: 'snapfire', name: 'Snapfire', weight: 1, tags: ['grave_draw'], note: 'exile 3 from hand; take 2 grave' },
  { id: 'storm_spirit', name: 'Storm Spirit', weight: 1, tags: ['discard_1_cond'], note: 'discard for actions' },

  // —— discard / hand ——
  { id: 'chaos_knight', name: 'Chaos Knight', weight: 1, tags: ['discard_1', 'force_discard'] },
  { id: 'centaur_warrunner', name: 'Centaur Warrunner', weight: 1, tags: ['discard_1_cond', 'force_discard'], note: 'on ally targeted' },
  { id: 'queen_of_pain', name: 'Queen of Pain', weight: 1, tags: ['discard_hand', 'force_discard'] },
  { id: 'slark', name: 'Slark', weight: 1, tags: ['trap', 'discard_hand', 'force_discard'] },
  { id: 'sniper', name: 'Sniper', weight: 1, tags: ['reveal_hand', 'force_discard', 'discard_1'] },
  { id: 'weaver', name: 'Weaver', weight: 1, tags: ['discard_hand', 'draw_3plus'], note: 'all discard; draw 3' },
  { id: 'invoker', name: 'Invoker', weight: 1, tags: ['discard_hand', 'draw_3plus'] },
  { id: 'pugna', name: 'Pugna', weight: 1, tags: ['force_discard', 'discard_1_cond'], note: 'tax on ability' },
  { id: 'venomancer', name: 'Venomancer', weight: 1, tags: ['force_discard', 'discard_1_cond'], note: 'tax on item' },
  { id: 'bounty_hunter', name: 'Bounty Hunter', weight: 1, tags: ['trap', 'reveal_hand', 'steal_card'] },
  { id: 'night_stalker', name: 'Night Stalker', weight: 1, tags: ['steal_card'] },
  { id: 'void_spirit', name: 'Void Spirit', weight: 1, tags: ['steal_card'], note: 'swap hands' },
  { id: 'ringmaster', name: 'Ringmaster', weight: 1, tags: ['hero_immune', 'reveal_hand'], note: 'choose immune OR reveal' },

  // —— traps (remaining) ——
  { id: 'riki', name: 'Riki', weight: 1, tags: ['trap', 'silence', 'block_ability'] },
  { id: 'monkey_king', name: 'Monkey King', weight: 1, tags: ['trap'], note: 'drain actions' },
  { id: 'ogre_magi', name: 'Ogre Magi', weight: 1, tags: ['trap'] },
  { id: 'kez', name: 'Kez', weight: 1, tags: ['trap'] },
  { id: 'templar_assassin', name: 'Templar Assassin', weight: 1, tags: ['trap'], note: 'nullify' },

  // —— immune / untargetable / silence / blocks ——
  { id: 'omniknight', name: 'Omniknight', weight: 1, tags: ['team_immune'], note: 'team immune; seals enter' },
  { id: 'tusk', name: 'Tusk', weight: 1, tags: ['hero_immune'] },
  { id: 'dazzle', name: 'Dazzle', weight: 1, tags: ['hero_immune'] },
  { id: 'naga_siren', name: 'Naga Siren', weight: 1, tags: ['hero_immune'], note: 'global cannot destroy' },
  { id: 'juggernaut', name: 'Juggernaut', weight: 1, tags: ['team_immune'], note: 'on ability in team' },
  { id: 'ursa', name: 'Ursa', weight: 1, tags: ['hero_immune_cond'], note: 'on item play' },
  { id: 'huskar', name: 'Huskar', weight: 1, tags: ['hero_immune_cond'], note: 'hand <4' },
  { id: 'mars', name: 'Mars', weight: 1, tags: ['untargetable'], note: 'allies untargetable by enemy heroes' },
  { id: 'silencer', name: 'Silencer', weight: 1, tags: ['silence', 'block_ability'] },
  { id: 'viper', name: 'Viper', weight: 1, tags: ['silence'], note: 'nullify enemy auras' },
  { id: 'troll_warlord', name: 'Troll Warlord', weight: 1, tags: ['block_instant'] },
  { id: 'doom', name: 'Doom', weight: 1, tags: ['block_item'] },
  { id: 'axe', name: 'Axe', weight: 1, tags: ['block_draw'] },
  { id: 'jakiro', name: 'Jakiro', weight: 1, tags: ['block_hero_play'] },
  { id: 'faceless_void', name: 'Faceless Void', weight: 1, tags: [], note: 'drain actions — tempo' },
  { id: 'bane', name: 'Bane', weight: 1, tags: [], note: 'lose next turn' },
  { id: 'zeus', name: 'Zeus', weight: 1, tags: [], note: 'clear traps' },
  { id: 'muerta', name: 'Muerta', weight: 1, tags: ['block_ability'], note: 'block grave take/play' },
  { id: 'puck', name: 'Puck', weight: 1, tags: [], note: 'lock enter/leave' },
  { id: 'treant_protector', name: 'Treant Protector', weight: 1, tags: [], note: 'terrain lock' },
  { id: 'windranger', name: 'Windranger', weight: 1, tags: ['steal_card'], note: 'steal terrain combo' },
  { id: 'ember_spirit', name: 'Ember Spirit', weight: 1, tags: [], note: 'move heroes' },
  { id: 'underlord', name: 'Underlord', weight: 1, tags: [], note: 'move team' },
  { id: 'marci', name: 'Marci', weight: 1, tags: [], note: 'move ally' },
  { id: 'beastmaster', name: 'Beastmaster', weight: 1, tags: [], note: 'redistribute' },
  { id: 'magnus', name: 'Magnus', weight: 1, tags: [], note: 'redistribute' },
  { id: 'pudge', name: 'Pudge', weight: 1, tags: ['swap_hero', 'force_discard', 'discard_1'] },
  { id: 'enchantress', name: 'Enchantress', weight: 1, tags: ['swap_hero'] },
  { id: 'grimstroke', name: 'Grimstroke', weight: 1, tags: ['swap_team'], note: 'control team for terrain sac' },
  { id: 'dark_seer', name: 'Dark Seer', weight: 1, tags: ['swap_hero'], note: 'destroy → you control' },
  { id: 'keeper_of_the_light', name: 'KotL', weight: 1, tags: [] },
  { id: 'rubick', name: 'Rubick', weight: 1, tags: [] },
  { id: 'primal_beast', name: 'Primal Beast', weight: 1, tags: ['block_hero_play'], note: 'items as instants' },
  { id: 'pangolier', name: 'Pangolier', weight: 1, tags: ['force_discard', 'discard_1_cond'] },
  { id: 'meepo', name: 'Meepo', weight: 1, tags: [] },
  { id: 'brewmaster', name: 'Brewmaster', weight: 1, tags: [] },
  { id: 'elder_titan', name: 'Elder Titan', weight: 1, tags: [] },
]

// Deduplicate hero list: build from tags map so every hero is covered exactly once from HEROES
const byId = new Map(heroes.map((h) => [h.id, h]))

// Fill any hero not manually listed with empty tags (still counted in denom via presence)
for (const h of HEROES) {
  if (!byId.has(h.id)) {
    byId.set(h.id, { id: h.id, name: h.name, weight: 1, tags: [], note: 'utility / other' })
  }
}

const items: Entry[] = [
  { id: 'dagon', name: 'Dagon', weight: 1, tags: ['hero_destroy', 'draw_1'] },
  { id: 'rapier', name: 'Divine Rapier', weight: 1, tags: ['team_destroy'] },
  { id: 'scythe', name: 'Scythe of Vyse', weight: 1, tags: ['hero_exile'] },
  { id: 'euls', name: "Eul's Scepter", weight: 2, tags: ['hero_exile_cond', 'hero_immune_cond'], note: 'temp exile' },
  { id: 'abyssal', name: 'Abyssal Blade', weight: 1, tags: ['hero_to_deck', 'draw_1'] },
  { id: 'orchid', name: 'Orchid', weight: 2, tags: ['silence', 'block_ability'] },
  { id: 'bkb', name: 'BKB', weight: 1, tags: ['team_immune'] },
  { id: 'shadow_blade', name: 'Shadow Blade', weight: 2, tags: ['untargetable', 'hero_immune_cond'] },
  { id: 'shivas', name: "Shiva's", weight: 1, tags: ['silence', 'block_ability', 'block_hero_play'] },
  { id: 'halberd', name: "Heaven's Halberd", weight: 1, tags: ['block_hero_play'] },
  { id: 'force_staff', name: 'Force Staff', weight: 2, tags: [] },
  { id: 'tp_scroll', name: 'TP Scroll', weight: 3, tags: [] },
  { id: 'blink', name: 'Blink', weight: 2, tags: [] },
  { id: 'clarity', name: 'Clarity', weight: 3, tags: ['search_deck'] },
  { id: 'gloves', name: 'Gloves', weight: 3, tags: ['steal_card'] },
  { id: 'ward', name: 'Ward', weight: 3, tags: ['reveal_hand'] },
  { id: 'gem', name: 'Gem', weight: 2, tags: ['reveal_hand', 'steal_card'] },
  { id: 'heart', name: 'Heart', weight: 1, tags: ['grave_draw'] },
  { id: 'greaves', name: 'Greaves', weight: 1, tags: ['discard_hand', 'draw_3plus'] },
  { id: 'satanic', name: 'Satanic', weight: 1, tags: ['swap_hero'] },
  { id: 'assault', name: 'Assault', weight: 1, tags: [] },
  { id: 'refresher', name: 'Refresher', weight: 1, tags: [] },
]

// Sync item weights from catalog
for (const item of ITEMS) {
  const entry = items.find((e) => e.id === item.id)
  if (entry) entry.weight = item.copies
  else items.push({ id: item.id, name: item.name, weight: item.copies, tags: [] })
}

const all = [...byId.values(), ...items]

const LABELS: { tag: Tag; label: string; group: string }[] = [
  { tag: 'hero_destroy', label: 'Hero destroy', group: 'Removal' },
  { tag: 'hero_destroy_cond', label: 'Hero destroy (condition)', group: 'Removal' },
  { tag: 'team_destroy', label: 'Team destroy', group: 'Removal' },
  { tag: 'team_destroy_cond', label: 'Team destroy (condition)', group: 'Removal' },
  { tag: 'swap_hero', label: 'Swap hero / take control', group: 'Removal' },
  { tag: 'swap_team', label: 'Swap / take team', group: 'Removal' },
  { tag: 'terrain_destroy', label: 'Terrain destroy', group: 'Removal' },
  { tag: 'hero_exile', label: 'Hero exile', group: 'Removal' },
  { tag: 'hero_exile_cond', label: 'Hero exile (condition)', group: 'Removal' },
  { tag: 'team_exile', label: 'Team exile', group: 'Removal' },
  { tag: 'team_exile_cond', label: 'Team exile (condition)', group: 'Removal' },
  { tag: 'hero_to_hand', label: 'Hero → hand', group: 'Removal' },
  { tag: 'hero_to_deck', label: 'Hero → deck', group: 'Removal' },
  { tag: 'draw_1', label: 'Draw 1 (free)', group: 'Card flow' },
  { tag: 'draw_1_cond', label: 'Draw 1 (condition)', group: 'Card flow' },
  { tag: 'draw_3plus', label: 'Draw 3+ (free)', group: 'Card flow' },
  { tag: 'draw_3plus_cond', label: 'Draw 3+ (condition)', group: 'Card flow' },
  { tag: 'discard_1', label: 'Discard 1 (free)', group: 'Card flow' },
  { tag: 'discard_1_cond', label: 'Discard 1 (condition)', group: 'Card flow' },
  { tag: 'discard_3plus', label: 'Discard 3+ (free)', group: 'Card flow' },
  { tag: 'discard_3plus_cond', label: 'Discard 3+ (condition)', group: 'Card flow' },
  { tag: 'discard_hand', label: 'Discard hand', group: 'Card flow' },
  { tag: 'discard_hand_cond', label: 'Discard hand (condition)', group: 'Card flow' },
  { tag: 'steal_card', label: 'Steal card', group: 'Card flow' },
  { tag: 'reveal_hand', label: 'Reveal hand', group: 'Card flow' },
  { tag: 'force_discard', label: 'Force discard (any)', group: 'Card flow' },
  { tag: 'search_deck', label: 'Search (deck → hand)', group: 'Card flow' },
  { tag: 'grave_draw', label: 'Grave draw / interact', group: 'Card flow' },
  { tag: 'trap', label: 'Trap', group: 'Timing' },
  { tag: 'hero_immune', label: 'Hero immune (free)', group: 'Protect' },
  { tag: 'hero_immune_cond', label: 'Hero immune (condition)', group: 'Protect' },
  { tag: 'team_immune', label: 'Team immune', group: 'Protect' },
  { tag: 'untargetable', label: 'Untargetable*', group: 'Protect' },
  { tag: 'silence', label: 'Silence / nullify aura', group: 'Lock' },
  { tag: 'block_instant', label: 'Block instant', group: 'Lock' },
  { tag: 'block_ability', label: 'Block / tax ability', group: 'Lock' },
  { tag: 'block_item', label: 'Block items', group: 'Lock' },
  { tag: 'block_hero_play', label: 'Block hero play', group: 'Lock' },
  { tag: 'block_draw', label: 'Block deck draw', group: 'Lock' },
]

const tallies = new Map<Tag, { weight: number; names: string[] }>()
for (const row of LABELS) tallies.set(row.tag, { weight: 0, names: [] })

for (const card of all) {
  const seen = new Set<Tag>()
  for (const tag of card.tags) {
    if (seen.has(tag)) continue
    seen.add(tag)
    const t = tallies.get(tag)
    if (!t) continue
    t.weight += card.weight
    t.names.push(card.name)
  }
}

const freeDestroy = (tallies.get('hero_destroy')?.weight ?? 0) + (tallies.get('team_destroy')?.weight ?? 0)
const condDestroy = (tallies.get('hero_destroy_cond')?.weight ?? 0) + (tallies.get('team_destroy_cond')?.weight ?? 0)
const freeExile = (tallies.get('hero_exile')?.weight ?? 0) + (tallies.get('team_exile')?.weight ?? 0)
const condExile = (tallies.get('hero_exile_cond')?.weight ?? 0) + (tallies.get('team_exile_cond')?.weight ?? 0)
const bounce = (tallies.get('hero_to_hand')?.weight ?? 0) + (tallies.get('hero_to_deck')?.weight ?? 0)
const protect =
  (tallies.get('hero_immune')?.weight ?? 0) +
  (tallies.get('hero_immune_cond')?.weight ?? 0) +
  (tallies.get('team_immune')?.weight ?? 0)

import { writeFileSync } from 'node:fs'

const payload = {
  denom: DENOM,
  summary: {
    freeDestroy,
    condDestroy,
    destroyAll: freeDestroy + condDestroy,
    freeExile,
    condExile,
    bounce,
    protect,
  },
  rows: LABELS.map((row) => {
    const t = tallies.get(row.tag)!
    return {
      group: row.group,
      label: row.label,
      tag: row.tag,
      n: t.weight,
      pct: (100 * t.weight) / DENOM,
      names: t.names,
    }
  }),
}

writeFileSync(new URL('./mech-audit.json', import.meta.url), JSON.stringify(payload, null, 2), 'utf8')
console.log('wrote mech-audit.json')
console.log(JSON.stringify(payload.summary))
for (const row of payload.rows) {
  if (row.n === 0) continue
  console.log(`${row.label}\t${row.n}/${DENOM}\t${row.pct.toFixed(1)}%\t${row.names.join(', ')}`)
}
