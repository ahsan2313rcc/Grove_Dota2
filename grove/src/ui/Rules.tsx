export function Rules({ onClose }: { onClose: () => void }) {
  return (
    <div className="scrim" onClick={onClose}>
      <article className="sheet rules" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">How Grove is played</p>
        <h2 id="rules-title">Rules</h2>
        <section>
          <h3>The turn</h3>
          <p>Everyone is dealt 3 cards. The Ancient is then placed in the remaining deck by table size — about halfway down for 2 players, 60% for 3–4, 80% for 5–6 and 90% for 7–8 (each ±5%). At the start of your turn you draw 2, then you have two actions — including the first seat on turn 1. Draw one more card for an action (even above 7), or play a hero, item, or reward for an action. Instant cards are free. A terrain combo is free and does not spend an action. If your hand is above 7, discard down to 7 when you end your turn.</p>
          <p>The Ancient is a neutral. When you draw it, play it for free into a team you control or a new team. It counts as any one attribute, can be targeted and moved like a hero, and whoever controls it when the match ends scores +10. Drawing it starts the final round: finish your turn, then each opponent takes one more turn. If it is revealed from the grave or exile instead, it only starts the final round. The match also ends if the shared deck empties first. Weaver's Time Lapse shuffles the grave into the deck and lets the Weaver player choose how deep The Ancient goes.</p>
          <p>Target score (on by default, 50 / 40 / 35 / 30 for 2 / 3 / 4 / 5+ players): end your turn at the target and you win at the start of your next turn if you still hold it and nobody else does. Opponents stop you by reaching the target too or by knocking you below it.</p>
          <p>Discards are your choice unless the card says at random. Immune heroes (Black King Bar, Glyph, Enrage, Wheel of Wonder, Shield Rune, Guardian Angel) ignore every opponent effect: destroy, exile, bounce, tuck, move, steal and silence.</p>
          <p>You may play several heroes into one team for a single action. Click the active hero, click companions to add them silently, then pick a team — only the active ability fires. If the play is countered, only the active hero is countered.</p>
        </section>
        <section>
          <h3>Terrains</h3>
          <p>Terrains are always played three at a time as a combo, for free. Two of a kind plus one other scores 3. One River, one Jungle, and one Lane scores 5. Three of a kind scores 8 and you take the top of the matching pile: River takes a rune, Jungle a neutral, Lane a tower. The piles are face down.</p>
          <p>Terrain heroes count the cards in your combos: Meepo scores +1 for each terrain type you control, Ember Spirit counts terrain types, Slardar counts River cards, Luna finds an item for each Jungle in a combo you play, and Hoodwink needs any Jungle.</p>
        </section>
        <section>
          <h3>Teams</h3>
          <p>Heroes score in teams of up to five. A player can field at most 12 teams. One neutral may sit in a team. Neutrals have no ability and no flat points, but they do have Melee or Ranged and still help attribute and attack bonuses (Golem / Tormentor / Roshan are Melee; Thunderhide / Ice Shaman / Black Dragon are Ranged).</p>
          <p>Each hero scores 1. Neutrals score 0 flat but still count for attribute and attack. Labels look like STR x3, ATTR x3, MELEE x3 — the numbers are counts. CORE needs three or more of the same attribute (+3 / +6 / +10) and blocks the attack bonus by default (MELEE/RANGE still shows). MIXED needs three or more different attributes (+2 / +4) and stacks with CORE when both apply. ATK needs three or more Melee or three or more Ranged (+1 / +2 / +3), counted separately — mixed range still scores (e.g. 3 Ranged + 2 Melee → RANGE x3) — and only when there is no CORE. Universal is its own attribute. Brewmaster counts as one of Strength, Agility, or Intelligence — whichever scores highest for that team.</p>
        </section>
        <section>
          <h3>Zones</h3>
          <p>The deck and the grave are shared. Discard sends a card from hand to the grave. Destroy sends a hero from the board to the grave. Exile removes a card from the game. Used runes, neutrals, and towers are exiled. Exiled cards do not interact.</p>
        </section>
        <section>
          <h3>Answers</h3>
          <p>The hand limit is 7. Instant cards are free. After an opponent draws, plays, or sets a combo, you may play one Instant in response, and you may also interrupt before a hero ability fires. Nyx Assassin counters an ability and destroys the caster only if it is Intelligence. Spirit Breaker redirects an ability to itself, even one aimed at a whole team. Tormentor destroys a hero that just entered; saves stop a destroy. Troll Warlord’s Battle Trance stops opponents from playing Instant cards.</p>
        </section>
        <section>
          <h3>Traps</h3>
          <p>Trap heroes are played face down on any team with room for another hero — yours or an enemy’s — but never on a team of five or a closed team, and only one trap per team. While face down, that team scores no attribute bonus. The trap fires once, when the next hero enters that team: it is revealed and resolves before the entering hero’s ability. Afterwards a trap that does not sacrifice itself joins the team if there is room, otherwise it goes to the grave.</p>
          <p>Snares (Techies, Broodmother, Monkey King, Slark, Riki, Shadow Shaman) hurt whoever controls the team. Wards (Kez, Ogre Magi, Bounty Hunter, Templar Assassin) help them. Batrider moves a trap, Zeus clears every trap, Guardian Greaves clears one player’s traps, and Observer Ward removes a trap or reveals a hand.</p>
        </section>
        <section>
          <h3>A few seats</h3>
          <ul>
            <li>Night Stalker steals two cards from the enemy.</li>
            <li>Lycan draws a card when an ally enters that team.</li>
            <li>Medusa’s Stone Gaze exiles a target enemy team.</li>
            <li>Elder Titan strips attributes from enemy heroes. They keep 1 point each, and a shared attack type still scores.</li>
            <li>Tidehunter returns every other hero to its owner’s hand. His own team stays.</li>
            <li>Magnus gathers up to 5 enemy heroes into a new team. The rest stay.</li>
            <li>Razor exiles a target hero and gives you +1 action.</li>
            <li>Morphling exiles a target on play; the exile ends when Morphling leaves the board, and it may fire the taken ability.</li>
            <li>Io pulls an allied hero into its team; that hero cannot be destroyed this turn.</li>
            <li>Tusk moves a hero to another team its controller owns. Earth Spirit does the same to an enemy, then destroys a hero there.</li>
            <li>Gate merges two teams you own. Overflow returns to hand and does not fire again.</li>
          </ul>
        </section>
        <button type="button" className="primary" onClick={onClose}>Back to the table</button>
      </article>
    </div>
  )
}
