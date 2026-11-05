/**
 * Steam CDN art for Grove cards.
 * Heroes/items use Valve's dota_react assets; Grove ids map to Steam file names.
 */

const HERO_CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes'
const HERO_ICON_CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons'
const ITEM_CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items'
const ABILITY_CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/abilities'

/** Grove defId → Steam hero file stem (underscored Valve name). */
const HERO_STEAM: Record<string, string> = {
  anti_mage: 'antimage',
  centaur_warrunner: 'centaur',
  clockwerk: 'rattletrap',
  doom: 'doom_bringer',
  lifestealer: 'life_stealer',
  shadow_fiend: 'nevermore',
  queen_of_pain: 'queenofpain',
  vengeful_spirit: 'vengefulspirit',
  natures_prophet: 'furion',
  outworld_destroyer: 'obsidian_destroyer',
  wraith_king: 'skeleton_king',
  necrophos: 'necrolyte',
  windranger: 'windrunner',
  treant_protector: 'treant',
  underlord: 'abyssal_underlord',
  zeus: 'zuus',
  magnus: 'magnataur',
  timbersaw: 'shredder',
  io: 'wisp',
}

/** Grove defId → Steam item/ability art. */
const LOOT_STEAM: Record<string, { kind: 'item' | 'ability'; stem: string }> = {
  clarity: { kind: 'item', stem: 'clarity' },
  tp_scroll: { kind: 'item', stem: 'tpscroll' },
  ward: { kind: 'item', stem: 'ward_observer' },
  gloves: { kind: 'item', stem: 'gloves_of_haste' },
  blink: { kind: 'item', stem: 'blink' },
  orchid: { kind: 'item', stem: 'orchid' },
  euls: { kind: 'item', stem: 'cyclone' },
  gem: { kind: 'item', stem: 'gem' },
  force_staff: { kind: 'item', stem: 'force_staff' },
  shadow_blade: { kind: 'item', stem: 'invis_sword' },
  scythe: { kind: 'item', stem: 'sheepstick' },
  abyssal: { kind: 'item', stem: 'abyssal_blade' },
  halberd: { kind: 'item', stem: 'heavens_halberd' },
  assault: { kind: 'item', stem: 'assault' },
  heart: { kind: 'item', stem: 'heart' },
  bkb: { kind: 'item', stem: 'black_king_bar' },
  satanic: { kind: 'item', stem: 'satanic' },
  greaves: { kind: 'item', stem: 'guardian_greaves' },
  shivas: { kind: 'item', stem: 'shivas_guard' },
  rapier: { kind: 'item', stem: 'rapier' },
  dagon: { kind: 'item', stem: 'dagon_5' },
  refresher: { kind: 'item', stem: 'refresher' },
  // Runes — bottle rune art (reliable Steam items)
  arcane: { kind: 'item', stem: 'bottle_arcane' },
  haste: { kind: 'item', stem: 'bottle_haste' },
  regen: { kind: 'item', stem: 'bottle_regeneration' },
  illusion: { kind: 'item', stem: 'bottle_illusion' },
  double_damage: { kind: 'item', stem: 'bottle_doubledamage' },
  shield: { kind: 'item', stem: 'bottle_water' },
  // Neutrals / towers — closest public Steam art
  stone_golem: { kind: 'ability', stem: 'tiny_toss' },
  thunderhide: { kind: 'ability', stem: 'centaur_hoof_stomp' },
  ice_shaman: { kind: 'ability', stem: 'ancient_apparition_chilling_touch' },
  black_dragon: { kind: 'ability', stem: 'dragon_knight_elder_dragon_form' },
  tormentor: { kind: 'ability', stem: 'abyssal_underlord_firestorm' },
  roshan: { kind: 'ability', stem: 'roshan_spell_block' },
  lotus: { kind: 'item', stem: 'lotus_orb' },
  glyph: { kind: 'item', stem: 'smoke_of_deceit' },
  gate: { kind: 'ability', stem: 'abyssal_underlord_dark_portal' },
  // Terrains
  river: { kind: 'ability', stem: 'kunkka_torrent' },
  jungle: { kind: 'ability', stem: 'treant_natures_guise' },
  lane: { kind: 'ability', stem: 'juggernaut_healing_ward' },
}

function heroStem(defId: string): string {
  return HERO_STEAM[defId] ?? defId
}

/** Full portrait (card art). */
export function heroPortraitUrl(defId: string): string {
  return `${HERO_CDN}/${heroStem(defId)}.png`
}

/** Small square icon (tables / peek). */
export function heroIconUrl(defId: string): string {
  return `${HERO_ICON_CDN}/${heroStem(defId)}.png`
}

export function lootArtUrl(defId: string): string | null {
  const entry = LOOT_STEAM[defId]
  if (!entry) return null
  if (entry.kind === 'item') return `${ITEM_CDN}/${entry.stem}.png`
  return `${ABILITY_CDN}/${entry.stem}.png`
}

export type ArtKind = 'hero' | 'item' | 'terrain' | 'rune' | 'neutral' | 'tower' | 'ancient' | 'other'

export function cardArtUrl(defId: string, kind: ArtKind, size: 'portrait' | 'icon' = 'portrait'): string | null {
  if (kind === 'hero') {
    return size === 'icon' ? heroIconUrl(defId) : heroPortraitUrl(defId)
  }
  if (kind === 'ancient') return `${ABILITY_CDN}/furion_sprout.png`
  return lootArtUrl(defId)
}
