import { useState } from 'react'

type Block = {
  id: string
  title: string
  badge: string
  badgeClass: string
  summary: string
  detail: string[]
}

const MECHANICS: Block[] = [
  {
    id: 'on-play',
    title: 'On play',
    badge: 'On play',
    badgeClass: 'timing-cast',
    summary: 'Costs one action. The ability fires when the card seats (or when an item resolves).',
    detail: [
      'Play a hero, item, or reward for one action. Instant cards and terrain combos are free instead.',
      'You may seat several heroes as a squad for one action: pick the active hero, click companions to bring them in silently, then choose a team. Only the active ability fires; if countered, only the active hero is countered.',
      'Draw one more card for an action (even above the hand limit of 7). Discard down to 7 when you end your turn.',
    ],
  },
  {
    id: 'instant',
    title: 'Instant',
    badge: 'Instant',
    badgeClass: 'timing-instant',
    summary: 'Free. Play on your turn or as an interrupt after an opponent acts.',
    detail: [
      'Instant cards do not spend an action.',
      'After an opponent draws, plays, or sets a combo — and before a hero ability fires — you may interrupt with one Instant, pass this action, or pass this turn.',
      'Nyx Assassin seats onto your team and counters an ability (and destroys the caster if it is Intelligence). Spirit Breaker seats, then redirects the ability onto itself — so a destroy ability kills Spirit Breaker. Tormentor destroys a hero that just entered. Troll Warlord’s Battle Trance stops opponents from playing Instants.',
    ],
  },
  {
    id: 'trap',
    title: 'Trap',
    badge: 'Trap',
    badgeClass: 'timing-trap',
    summary: 'Place face-down. When triggered, resolve the trap effect before the entering hero’s ability.',
    detail: [
      'Play face-down on any team with room (yours or an enemy’s).',
      'One trap per team — never on a full or closed team.',
      'While face down, that team scores no attribute bonus.',
      'Trigger: another hero enters that team.',
      'Reveal and resolve before that hero’s ability (controller = who controls the team).',
      'Afterwards, a non-sacrifice trap joins the team if there is room; otherwise it goes to the grave.',
      'Snares hurt the controller; wards help them. Batrider moves a trap, Zeus clears every trap, Guardian Greaves clears one player’s traps, Observer Ward removes a trap or reveals a hand.',
    ],
  },
  {
    id: 'aura',
    title: 'Aura',
    badge: 'Aura',
    badgeClass: 'timing-aura',
    summary: 'Ongoing while the hero stays on the board — no separate play cost beyond seating the hero.',
    detail: [
      'Aura text stays active as long as the hero remains on its team.',
      'Moving, bouncing, or destroying the aura hero ends the effect. Immune heroes ignore opponent effects that would remove or move them.',
    ],
  },
  {
    id: 'combo',
    title: 'Terrain combo',
    badge: 'Combo',
    badgeClass: 'timing-combo',
    summary: 'Always three terrains at once, free. Scores points and may take a face-down pile card.',
    detail: [
      'Terrains cannot be played alone. Select three, then Play Combo.',
      'Two of a kind plus one other scores 3. One River, one Jungle, and one Lane scores 5. Three of a kind scores 8 and takes the top of the matching pile: River a rune, Jungle a neutral, Lane a tower.',
    ],
  },
]

const MORE: Block[] = [
  {
    id: 'turn',
    title: 'The turn',
    badge: 'Basics',
    badgeClass: 'timing-cast',
    summary: 'Draw 2 at turn start, then two actions. Ancient or empty deck starts the final round.',
    detail: [
      'Everyone is dealt 3. The Ancient is placed deeper by table size (about mid for 2, then 60% / 80% / 90% for larger tables, ±5%).',
      'Ancient Draw: Drawing the Ancient card starts the final round: each player gets one more turn, then the highest score wins — +10 to whoever controls the Ancient. Emptying the shared deck starts the same final round.',
      'Target score (default on): end your turn on it and still hold it alone at the start of your next turn to win early.',
      'Discards are your choice unless a card says at random. Immune heroes ignore every opponent effect.',
    ],
  },
  {
    id: 'teams',
    title: 'Teams & scoring',
    badge: 'Score',
    badgeClass: 'timing-aura',
    summary: 'Teams of up to five. Heroes score 1; neutrals 0 flat but help attribute and attack bonuses.',
    detail: [
      'At most 12 teams per player. One neutral per team. Neutrals have Melee or Ranged and help CORE / MIXED / ATK.',
      'CORE: three or more of the same attribute (+3 / +6 / +10) and blocks attack bonus. MIXED: three or more different attributes (+2 / +4), stacks with CORE. ATK: three or more Melee or Ranged (+1 / +2 / +3) only when there is no CORE.',
      'Universal is its own attribute. Brewmaster counts as STR, AGI, or INT — whichever scores highest for that team.',
    ],
  },
  {
    id: 'zones',
    title: 'Zones',
    badge: 'Zones',
    badgeClass: 'timing-instant',
    summary: 'Shared deck and grave. Exile removes cards from the game.',
    detail: [
      'Discard: hand → grave. Destroy: board → grave. Exile: out of the game (used runes, neutrals, and towers are exiled).',
      'Exiled cards do not interact.',
    ],
  },
]

function RuleBlock({ block }: { block: Block }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rule-block" data-testid={`rule-${block.id}`}>
      <header className="rule-block-head">
        <span className={`type-pill inline ${block.badgeClass}`}>{block.badge}</span>
        <h3>{block.title}</h3>
      </header>
      <p>{block.summary}</p>
      <button type="button" className="rule-more" data-testid={`rule-more-${block.id}`} onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide details' : 'Detailed instructions'}
      </button>
      {open ? (
        <ul className="rule-detail">
          {block.detail.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export function Rules({ onClose }: { onClose: () => void }) {
  return (
    <div className="scrim" onClick={onClose}>
      <article className="sheet rules" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">How Grove is played</p>
        <h2 id="rules-title">Rules</h2>
        <p className="quiet">Start with the mechanics. Open details only when you need the full wording.</p>

        <h3 className="rules-group">Mechanics</h3>
        <div className="rule-grid">
          {MECHANICS.map((block) => (
            <RuleBlock key={block.id} block={block} />
          ))}
        </div>

        <h3 className="rules-group">Also useful</h3>
        <div className="rule-grid">
          {MORE.map((block) => (
            <RuleBlock key={block.id} block={block} />
          ))}
        </div>

        <button type="button" className="primary" onClick={onClose}>Back to the table</button>
      </article>
    </div>
  )
}
