export function Rules({ onClose }: { onClose: () => void }) {
  return (
    <div className="scrim" onClick={onClose}>
      <article className="sheet rules" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">How Grove is played</p>
        <h2 id="rules-title">Rules</h2>
        <section>
          <h3>The turn</h3>
          <p>You have two actions. Draw one card for an action, or play a hero, item, or reward for an action. Instant cards are free. A setting combo is free and does not spend an action. There is no draw at the end of the turn. The match ends when the shared deck is empty.</p>
        </section>
        <section>
          <h3>Settings</h3>
          <p>Play three settings at once — a single River, Jungle, or Lane cannot be played alone. Three of a kind score 5 and you take the top of the matching pile: River takes a rune, Jungle a neutral, Lane a tower. One of each also scores 5 and takes nothing. The piles are face down.</p>
        </section>
        <section>
          <h3>Teams</h3>
          <p>Heroes score in teams of up to five. A player can field at most 12 teams. Meepo counts as two. One neutral may sit in a team. Neutrals have no ability and no attack type.</p>
          <p>Each hero scores 1. A team earns either the same-attribute bonus or the attack bonus, not both. One attribute, Universal included, adds +0, +0, +3, +6, or +10 for one through five heroes, and that team does not take an attack bonus (max 15). Universal is its own attribute and does not fill in for another. A mixed team can also earn the different-attribute bonus: +0, +0, +2, or +4 for one through four different attributes. That bonus stacks with attack. Three, four, or five heroes of the same attack type add +1, +2, or +3 (mix max 12). Neutrals have no attack type and do not spoil that bonus. Meepo counts as two. Brewmaster is Strength, Agility, and Intelligence, so alone he scores 3. A hero with no attribute still scores 1.</p>
        </section>
        <section>
          <h3>Zones</h3>
          <p>The deck and the grave are shared. Discard sends a card from hand to the grave. Destroy sends a hero from the board to the grave. Exile removes a card from the game. Used runes, neutrals, and towers are exiled. Exiled cards do not interact.</p>
        </section>
        <section>
          <h3>Answers</h3>
          <p>The hand limit is 7. Nyx Assassin can be discarded from hand to counter any card, and the countered card goes to the grave. Tormentor can destroy a hero that just entered, and a save can stop a destroy. Instants are free on your own turn.</p>
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
            <li>Razor exiles an enemy hero while you control him. Morphling does the same, copies the attribute, and may cast the ability on the turn he takes it.</li>
            <li>Gate merges two teams you own. Overflow returns to hand and does not fire again.</li>
          </ul>
        </section>
        <button type="button" className="primary" onClick={onClose}>Back to the table</button>
      </article>
    </div>
  )
}
