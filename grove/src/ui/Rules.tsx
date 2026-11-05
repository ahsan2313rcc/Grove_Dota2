export function Rules({ onClose }: { onClose: () => void }) {
  return (
    <div className="scrim" onClick={onClose}>
      <article className="sheet rules" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">How Grove is played</p>
        <h2 id="rules-title">Rules</h2>
        <section>
          <h3>The turn</h3>
          <p>Everyone is dealt 3 cards. The Ancient is then placed in the remaining deck by table size — around the middle for 2–4 players, deeper for 5–6, and last for 7–8. At the start of your turn you draw 2, then you have two actions — including the first seat on turn 1. Draw one more card for an action (even above 7), or play a hero, item, or reward for an action. Instant cards are free. A terrain combo is free and does not spend an action. If your hand is above 7, discard down to 7 when you end your turn.</p>
          <p>When The Ancient is revealed by drawing, that player scores +10 and each seat gets one final turn, then the match ends. If it is revealed from the grave or exile instead, there is no +10 — still one final turn each. The match also ends if the shared deck empties first.</p>
          <p>You may play several heroes into one team for a single action. Click the active hero, click companions to add them silently, then pick a team — only the active ability fires. If the play is countered, only the active hero is countered.</p>
        </section>
        <section>
          <h3>Terrains</h3>
          <p>Play three terrains at once — a single River, Jungle, or Lane cannot be played alone. Three of a kind score 5 and you take the top of the matching pile: River takes a rune, Jungle a neutral, Lane a tower. One of each also scores 5 and takes nothing. The piles are face down.</p>
        </section>
        <section>
          <h3>Teams</h3>
          <p>Heroes score in teams of up to five. A player can field at most 12 teams. One neutral may sit in a team. Neutrals have no ability, no attack type, and no flat points — they only help attribute and attack bonuses.</p>
          <p>Each hero scores 1. Neutrals score 0 flat but still help attribute and attack bonuses. Core and mixed bonuses need at least three heroes on the team — one or two heroes are just flat points. A core team is three or more heroes of the same attribute (Universal included) and does not take an attack bonus by default (+3 / +6 / +10, max 15). Universal is its own attribute and does not fill in for another. Any team with two or more attributes is mixed: it can take a mono-stack bonus when three or more share an attribute, or +2 / +4 for three or four distinct attributes, and it always stacks with attack when enabled. Three, four, or five heroes of the same attack type add +1, +2, or +3. Neutrals have no attack type and do not spoil that bonus. Meepo scores +1 for each terrain combo you control (player total, not a second body). Brewmaster counts as one of Strength, Agility, or Intelligence — whichever scores highest for that team. A hero with no attribute still scores 1.</p>
        </section>
        <section>
          <h3>Zones</h3>
          <p>The deck and the grave are shared. Discard sends a card from hand to the grave. Destroy sends a hero from the board to the grave. Exile removes a card from the game. Used runes, neutrals, and towers are exiled. Exiled cards do not interact.</p>
        </section>
        <section>
          <h3>Answers</h3>
          <p>The hand limit is 7. Instant cards are free and can be played on an opponent’s turn to interrupt — including before a hero ability fires. Nyx Assassin is an Instant that counters the ability and destroys that hero. Trap heroes plant face down on any team, including an enemy’s. Tormentor destroys a hero that just entered; saves stop a destroy. Troll Warlord’s Battle Trance stops opponents from playing Instant cards.</p>
        </section>
        <section>
          <h3>A few seats</h3>
          <ul>
            <li>Riki cannot be targeted by an enemy.</li>
            <li>Night Stalker steals two cards from the enemy.</li>
            <li>Lycan draws a card when an ally enters that team.</li>
            <li>Medusa’s Stone Gaze exiles a target enemy team.</li>
            <li>Elder Titan strips attributes from enemy heroes. They keep 1 point each, and a shared attack type still scores.</li>
            <li>Tidehunter returns every other hero to its owner’s hand. His own team stays.</li>
            <li>Magnus gathers up to 5 enemy heroes into a new team. The rest stay.</li>
            <li>Razor and Morphling exile a target on play; the exile ends when they leave the board. Morphling may also fire the taken ability.</li>
            <li>Gate merges two teams you own. Overflow returns to hand and does not fire again.</li>
          </ul>
        </section>
        <button type="button" className="primary" onClick={onClose}>Back to the table</button>
      </article>
    </div>
  )
}
