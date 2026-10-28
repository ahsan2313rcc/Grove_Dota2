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
          <p>Play three settings at once. Three of a kind score 3 and you take the top of the matching pile: River takes a rune, Jungle a neutral, Lane a tower. One of each scores 5 and takes nothing. The piles are face down.</p>
        </section>
        <section>
          <h3>Teams</h3>
          <p>Heroes score in teams of up to five. Meepo counts as two. One neutral may sit in a team. Neutrals have no ability and no attack type.</p>
          <p>A team of one attribute scores 1, 3, 6, 10, 15 for one through five heroes. Universal counts toward every attribute. Three different attributes score 5. Four score 10. Only a mixed team adds +1 if every hero shares an attack type, or +2 when four attributes are present. Brewmaster alone is Strength, Agility, and Intelligence, and with Melee that is 6.</p>
        </section>
        <section>
          <h3>Zones</h3>
          <p>The deck and the grave are shared. Discard sends a card from hand to the grave. Destroy sends a hero from the board to the grave. Exile removes a card from the game. Used runes, neutrals, and towers are exiled. Exiled cards do not interact.</p>
        </section>
        <section>
          <h3>Answers</h3>
          <p>The hand limit is 7. Some heroes answer only when the game asks: Nyx from hand can counter an enemy ability, Tormentor can destroy a hero that just entered, and a save can stop a destroy. Instants are free on your own turn.</p>
        </section>
        <section>
          <h3>A few seats</h3>
          <ul>
            <li>Riki cannot be targeted by an enemy.</li>
            <li>Night Stalker steals two cards from the enemy.</li>
            <li>Lycan draws a card when an ally enters that team.</li>
            <li>Medusa’s gaze strips attributes from her team. Range stays.</li>
            <li>Elder Titan strips attributes from enemy heroes.</li>
            <li>Gate merges two teams you own. Overflow returns to hand and does not fire again.</li>
          </ul>
        </section>
        <button type="button" className="primary" onClick={onClose}>Back to the table</button>
      </article>
    </div>
  )
}
