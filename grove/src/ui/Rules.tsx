import { useState } from 'react'
import { DEFAULT_SCORE_RULES } from '../game/scoring.ts'

type Tab = 'basics' | 'mechanics' | 'scoring'
type ScoreSection = 'team' | 'combo' | 'trap' | 'special'

type Block = {
  id: string
  title: string
  badge: string
  badgeClass: string
  summary: string
  detail: string[]
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'mechanics', label: 'Mechanics' },
  { id: 'scoring', label: 'Scoring' },
]

const SCORE_SECTIONS: { id: ScoreSection; label: string }[] = [
  { id: 'team', label: 'Team' },
  { id: 'combo', label: 'Combo' },
  { id: 'trap', label: 'Trap' },
  { id: 'special', label: 'Special cases' },
]

const BASICS: Block[] = [
  {
    id: 'goal',
    title: 'Goal',
    badge: 'Win',
    badgeClass: 'timing-aura',
    summary: 'Build teams and terrain combos. Highest score when the match ends wins.',
    detail: [
      'Your score is the sum of every team you control plus every terrain combo you have scored.',
      `Whoever controls The Ancient when the match ends also gets +${DEFAULT_SCORE_RULES.ancientBonus} (tunable in Match options).`,
      'The match ends after Ancient Draw (or an empty deck) once each player has taken one last turn, or when someone wins early on the target score.',
    ],
  },
  {
    id: 'setup',
    title: 'Setup',
    badge: 'Deal',
    badgeClass: 'timing-cast',
    summary: 'Shared deck, shared grave, shared exile. Separate face-down piles for runes, neutrals, and towers.',
    detail: [
      'Everyone is dealt 3. Seat 0 starts.',
      'The Ancient is shuffled into the remaining deck by table size (about mid for 2–4, deeper for larger tables, ±5%).',
      'Reward piles: River → runes, Jungle → neutrals, Lane → towers. Three-of-a-kind terrain combos take the top of the matching pile.',
    ],
  },
  {
    id: 'turn',
    title: 'Your turn',
    badge: 'Basics',
    badgeClass: 'timing-cast',
    summary: 'Draw 2 at the start, then take two actions. Discard down to 7 when you end.',
    detail: [
      'Start of turn: draw 2 (hand may go over 7 until you end). You get 2 actions.',
      'Spend an action to play a hero, item, or reward — or to draw one more card from the deck.',
      'Instant cards and terrain combos are free (they do not spend an action).',
      'You may seat several heroes as a squad for one action: pick the active hero, click companions to bring them in silently, then choose a team. Only the active ability fires.',
      'End turn: if your hand is over 7, discard down to 7 first.',
    ],
  },
  {
    id: 'win',
    title: 'How the match ends',
    badge: 'End',
    badgeClass: 'timing-instant',
    summary: 'Ancient Draw, empty deck, or target score. Highest total wins.',
    detail: [
      `Ancient Draw: drawing The Ancient starts the final round — each player gets one more turn, then highest score wins (+${DEFAULT_SCORE_RULES.ancientBonus} to whoever controls the Ancient; set in Match options).`,
      'Emptying the shared deck starts the same final round.',
      'Target score (default on): end your turn on it and still hold it alone at the start of your next turn to win early.',
      'Ties are possible; the engine does not force a tiebreak.',
    ],
  },
  {
    id: 'zones',
    title: 'Zones',
    badge: 'Zones',
    badgeClass: 'timing-instant',
    summary: 'Discard, destroy, and exile mean different things.',
    detail: [
      'Discard: hand → grave. Destroy: board → grave. Exile: out of the game (used runes, neutrals, and towers are exiled).',
      'Exiled cards do not interact. Bounce returns a board hero to its owner’s hand.',
    ],
  },
]

const MECHANICS: Block[] = [
  {
    id: 'on-play',
    title: 'On play',
    badge: 'On play',
    badgeClass: 'timing-cast',
    summary: 'Costs one action. The ability fires when the card seats (or when an item resolves).',
    detail: [
      'Play a hero, item, or reward for one action. Instant cards and terrain combos are free instead.',
      'Squad play: only the active ability fires; if countered, only the active hero is countered.',
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

const CORE = DEFAULT_SCORE_RULES.coreBonus
const MIX = DEFAULT_SCORE_RULES.mixBonus
const ATK = DEFAULT_SCORE_RULES.attackBonus
const PAIR = DEFAULT_SCORE_RULES.pairCombo
const MIX_COMBO = DEFAULT_SCORE_RULES.mixCombo
const CORE_COMBO = DEFAULT_SCORE_RULES.coreCombo

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

function ScoreTable({
  caption,
  headers,
  rows,
  testId,
}: {
  caption: string
  headers: string[]
  rows: string[][]
  testId: string
}) {
  return (
    <div className="score-table-wrap" data-testid={testId}>
      <p className="score-table-caption">{caption}</p>
      <table className="score-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join('|')}>
              {row.map((cell, index) => (
                <td key={`${row[0]}-${index}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScoringPanel({ section }: { section: ScoreSection }) {
  if (section === 'team') {
    return (
      <div className="scoring-panel" data-testid="scoring-team">
        <p>
          Each team scores <strong>flat hero points</strong> plus shape bonuses. Labels like{' '}
          <code>STR x3, ATTR x3, MELEE x3</code> show <em>counts</em>, not the point values.
        </p>
        <ul className="rule-detail">
          <li>Flat: each scoring hero is worth {DEFAULT_SCORE_RULES.heroPoints} (neutrals are 0 flat but still fill shape and attack).</li>
          <li>Shape bonuses need at least 3 bodies on the team. Teams of 1–2 are Small — flat only (+ ATK when eligible).</li>
          <li>At most 12 teams per player. Up to 5 bodies per team.</li>
        </ul>

        <ScoreTable
          testId="scoring-core-table"
          caption="CORE — 3×+ same attribute (blocks ATK by default)"
          headers={['Stack', 'Shorthand', 'Bonus']}
          rows={[
            ['3 same attr', 'CORE ×3', `+${CORE[2]}`],
            ['4 same attr', 'CORE ×4', `+${CORE[3]}`],
            ['5 same attr', 'CORE ×5', `+${CORE[4]}`],
          ]}
        />

        <ScoreTable
          testId="scoring-attr-table"
          caption="ATTR / MIXED — 3+ different attributes (stacks with CORE)"
          headers={['Distinct attrs', 'Shorthand', 'Bonus']}
          rows={[
            ['3 attrs', 'ATTR ×3', `+${MIX[2]}`],
            ['4 attrs', 'ATTR ×4', `+${MIX[3]}`],
          ]}
        />

        <ScoreTable
          testId="scoring-atk-table"
          caption="ATK — 3+ Melee or 3+ Ranged (only when there is no CORE)"
          headers={['Same attack', 'Shorthand', 'Bonus']}
          rows={[
            ['3 Melee or Ranged', 'ATK ×3', `+${ATK[2]}`],
            ['4 Melee or Ranged', 'ATK ×4', `+${ATK[3]}`],
            ['5 Melee or Ranged', 'ATK ×5', `+${ATK[4]}`],
          ]}
        />

        <ScoreTable
          testId="scoring-team-examples"
          caption="Worked examples (default values)"
          headers={['Team', 'Breakdown', 'Total']}
          rows={[
            ['3 STR Melee', `3 flat + CORE ×3 (+${CORE[2]}) · no ATK`, `${3 + CORE[2]}`],
            ['5 STR Melee', `5 flat + CORE ×5 (+${CORE[4]}) · no ATK`, `${5 + CORE[4]}`],
            [
              '3 STR + AGI + INT Melee',
              `5 flat + CORE ×3 (+${CORE[2]}) + ATTR ×3 (+${MIX[2]}) · no ATK`,
              `${5 + CORE[2] + MIX[2]}`,
            ],
            [
              '5 heroes, 4 attrs, all Melee',
              `5 flat + ATTR ×4 (+${MIX[3]}) + ATK ×5 (+${ATK[4]})`,
              `${5 + MIX[3] + ATK[4]}`,
            ],
            ['2 heroes', '2 flat · Small team', '2'],
          ]}
        />
      </div>
    )
  }

  if (section === 'combo') {
    return (
      <div className="scoring-panel" data-testid="scoring-combo">
        <p>Terrains are never played alone. Select exactly three, then Play Combo — free, no action.</p>
        <ScoreTable
          testId="scoring-combo-table"
          caption="Terrain combo scores"
          headers={['Shape', 'Example', 'Points', 'Reward']}
          rows={[
            ['Pair', 'River, River, Jungle', String(PAIR), '—'],
            ['Mixed', 'River, Jungle, Lane', String(MIX_COMBO), '—'],
            ['Core', 'Lane, Lane, Lane', String(CORE_COMBO), 'Top of matching pile'],
          ]}
        />
        <ul className="rule-detail">
          <li>Core reward: three Rivers → rune, three Jungles → neutral, three Lanes → tower (none if that pile is empty).</li>
          <li>Combo points stay on your scored terrain piles for the rest of the match unless an effect destroys them.</li>
        </ul>
      </div>
    )
  }

  if (section === 'trap') {
    return (
      <div className="scoring-panel" data-testid="scoring-trap">
        <p>Traps change how a team scores while they sit face-down, then resolve when someone enters.</p>
        <ul className="rule-detail">
          <li>While a trap is face-down on a team, that team scores <strong>no attribute bonus</strong> (no CORE, no ATTR/MIXED). Flat hero points and ATK still count.</li>
          <li>One trap per team. Never on a full or closed team.</li>
          <li>When another hero enters, reveal and resolve the trap before that hero’s ability. Controller = who controls the team.</li>
          <li>After resolve, a non-sacrifice trap joins the team if there is room; otherwise it goes to the grave.</li>
          <li>Example: 3 STR Melee with a face-down trap scores 3 flat (and ATK ×3 if Melee qualifies) — not CORE ×3 — until the trap leaves or resolves.</li>
        </ul>
      </div>
    )
  }

  return (
    <div className="scoring-panel" data-testid="scoring-special">
      <section className="rule-block" data-testid="rule-special-et">
        <header className="rule-block-head">
          <span className="type-pill inline timing-aura">Aura</span>
          <h3>Elder Titan</h3>
        </header>
        <p>Enemy heroes lose their attribute for scoring. They still give 1 flat and keep their Melee/Ranged for ATK.</p>
      </section>
      <section className="rule-block" data-testid="rule-special-meepo">
        <header className="rule-block-head">
          <span className="type-pill inline timing-aura">Aura</span>
          <h3>Meepo</h3>
        </header>
        <p>
          +1 point for each terrain type you control (River / Jungle / Lane). Counts terrain types, not combo count —
          so three types is +3 regardless of how many combos you scored.
        </p>
      </section>
      <section className="rule-block" data-testid="rule-special-neutral">
        <header className="rule-block-head">
          <span className="type-pill inline timing-aura">Neutral</span>
          <h3>Neutrals</h3>
        </header>
        <p>
          0 flat points, but they still count for CORE / ATTR / ATK. One neutral per team. Attribute and Melee/Ranged
          are printed on the card. Taken from the Jungle pile (three Jungles); used neutrals exile after leaving play.
        </p>
      </section>
      <section className="rule-block" data-testid="rule-special-ancient">
        <header className="rule-block-head">
          <span className="type-pill inline timing-cast">Endgame</span>
          <h3>The Ancient</h3>
        </header>
        <p>
          Neutral body placed free when drawn. Counts as any one attribute (whichever scores best). +
          {DEFAULT_SCORE_RULES.ancientBonus} to whoever controls it when the match ends — not to whoever drew it
          (tunable in Match options → Win condition). Drawing it starts the final round.
        </p>
      </section>
      <section className="rule-block" data-testid="rule-special-brew">
        <header className="rule-block-head">
          <span className="type-pill inline timing-aura">Aura</span>
          <h3>Brewmaster</h3>
        </header>
        <p>Counts as exactly one of STR, AGI, or INT — whichever maximizes that team’s score.</p>
      </section>
    </div>
  )
}

export function Rules({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('basics')
  const [scoreSection, setScoreSection] = useState<ScoreSection>('team')

  return (
    <div className="scrim" onClick={onClose}>
      <article className="sheet rules" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">How Grove is played</p>
        <h2 id="rules-title">Rules</h2>
        <p className="quiet">Basics first. Mechanics for timings. Scoring for points, bonuses, and specials.</p>

        <div className="glossary-tabs" role="tablist" aria-label="Rules section">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? 'on' : ''}
              data-testid={`rules-tab-${entry.id}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === 'basics' ? (
          <div className="rule-grid" data-testid="rules-basics">
            {BASICS.map((block) => (
              <RuleBlock key={block.id} block={block} />
            ))}
          </div>
        ) : null}

        {tab === 'mechanics' ? (
          <div className="rule-grid" data-testid="rules-mechanics">
            {MECHANICS.map((block) => (
              <RuleBlock key={block.id} block={block} />
            ))}
          </div>
        ) : null}

        {tab === 'scoring' ? (
          <div data-testid="rules-scoring">
            <div className="glossary-tabs scoring-subtabs" role="tablist" aria-label="Scoring topic">
              {SCORE_SECTIONS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={scoreSection === entry.id}
                  className={scoreSection === entry.id ? 'on' : ''}
                  data-testid={`scoring-tab-${entry.id}`}
                  onClick={() => setScoreSection(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <ScoringPanel section={scoreSection} />
          </div>
        ) : null}

        <button type="button" className="primary" onClick={onClose}>Back to the table</button>
      </article>
    </div>
  )
}
