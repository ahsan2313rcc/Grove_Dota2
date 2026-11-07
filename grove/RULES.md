# Grove — Complete Rules Reference

Authoritative rules for agents and implementers. Card text lives in `src/game/catalog.ts`. Engine: `src/game/engine.ts`, effects: `src/game/casts.ts`, board helpers: `src/game/flow.ts`, scoring: `src/game/scoring.ts`.

---

## 1. Overview

Grove is a competitive multiplayer card game (typically **2 seats**; engine supports more). Players build **teams of heroes** and play **terrain combos** for points. One **shared deck**, shared **grave**, and shared **exile**. Separate face-down reward piles: **runes**, **neutrals**, **towers**.

**Win condition:** The match ends when **The Ancient** is revealed and each player has taken one final turn, when a player **holds the target score** alone (see 4.6), **or** when the shared deck is empty. Highest total score wins (teams + terrain combo points + 10 for whoever controls The Ancient). Ties are possible (no forced tiebreak in engine finish).

---

## 2. Card types

| Kind | Where | Notes |
|------|--------|------|
| **Hero** | Main deck | Has attribute (STR/AGI/INT/UNI), attack type (Melee/Ranged), ability timing |
| **Item** | Main deck | Played from hand; often targeted |
| **Terrain** | Main deck (36 total: river/jungle/lane) | Never played alone — always as a **combo of exactly 3** |
| **Ancient** | Main deck (1 copy) | Neutral body; placed free when drawn; +10 to its controller at the end; starts the final round |
| **Rune** | Rune pile | Reward from 3 Rivers |
| **Neutral** | Neutral pile | Reward from 3 Jungles; token body on a team (except Tormentor) |
| **Tower** | Tower pile | Reward from 3 Lanes |

**Hero timing** (`catalog` `timing`):

- **`cast`** — Ability fires when the hero is played as the **active** hero (unless silenced/blocked).
- **`aura`** — No on-play fire; passive while on the board.
- **`instant`** — Free (no action). Playable on **your turn** and on **opponents’ turns**. After the active player draws, plays, or sets a combo, each opponent may play one Instant in response (or pass for the rest of the turn). Before a hero ability fires, opponents also get an Instant window.
- **`trap`** — Played face down onto a team. Does **not** fire on play. Reveals and resolves when the next hero enters that team (see §7.1).

**Item / reward `instant: true`:** Does not cost an action.

### Anti-loop (stolen / copied abilities)

Effects that **steal control**, **swap control**, **copy**, or **reactivate** another hero’s ability may say you can fire it immediately. Global rule:

- A **stolen** or **copied** ability **cannot** steal, swap control, copy, or fire another stolen/copied ability.
- Reactivations from KotL / Rubick / Arcane / Blink / Satanic / Morphling / Lifestealer / Vengeful / Enchantress respect the same chain break.

Engine should track a `stolenCast` (or depth) flag for the duration of that nested fire.

---

## 3. Setup

1. Build and shuffle the main deck: all heroes (1 each) + item copies + 36 terrains (**without** The Ancient).
2. Fill and shuffle reward piles from `REWARDS` by kind.
3. Each seat is dealt **3** cards.
4. Insert **The Ancient** into the remaining deck by seat count (deck top = next draw):
   - Depth by seat count 2/3/4/5/6/7/8: **50 / 60 / 60 / 80 / 80 / 90 / 90%**, each **±5%** at random (editable in Match options → Win condition).
5. Seat 0 starts turn 1 as usual: **draw 2** + **2 actions**.

`handLimit` = **7**. `TEAM_CAP` = **12** teams per player. `TURN_DRAW` = **2**.

---

## 4. Turn structure

### 4.1 Start of turn

For the active seat (after previous player ends):

1. Increment turn counter.
2. **Expire** timed effects whose `caster === active` and `fromTurn < turn` (silence, naga, lockPlay, frost, team noEnter/noLeave/glyph, hero shield/ward/hidden/bkb, player bkb).
3. Return phased heroes / lassos due; resolve Viper Strike due on this owner.
4. If `skip`: clear skip, pass to next seat.
5. If `noHeroNext`: convert to `noHeroNow` for this turn (cannot play heroes).
6. Set **actions = 2**.
7. **Draw 2** (via pending draws; may trigger Slark, Ancient reveal, or empty-deck finish). Hand may exceed 7 until end of turn.

Hotseat: optional veil between seats.

### 4.2 During turn (active player)

Legal actions (when no `pending` prompt):

| Action | Cost | Effect |
|--------|------|--------|
| **Play** hero/item/reward | 1 action (0 if instant) | See §6–7 |
| **Combo** 3 terrains | Free | See §5 |
| **Draw** | 1 action | Draw 1 if hand &lt; limit and deck nonempty |
| **Discard stuck** | 1 action | Pitch a hand card to grave (escape Poison Nova / lone terrains) |
| **Morph cast** | — | Fire stolen Morph ability if eligible |
| **End** | — | End turn (must discard down to 7 first if over limit) |

While `pending` is set, only **choose** (answer the prompt) is legal. AI/`autoAll` auto-picks.

### 4.3 End of turn

1. If hand &gt; 7, must discard down to 7 (`limit` prompt with `then: 'end'`).
2. Return same-turn phased heroes; clear end-of-turn marks (graveThisTurn, enteredThisTurn, multicast, troll, maledict, bonds, soulbind, reveal, dawn flags, noHeroNow, mailTurn).
3. Next seat starts turn (§4.1).

### 4.4 The Ancient (endgame)

One copy of **The Ancient** sits in the main deck after the opening deal, placed by player count (see setup step 4).

- **Revealed by draw:** the drawer plays it **for free** into a team they control or a new team (`ancient-place` prompt). It is a neutral body: 0 flat points, counts as **any one attribute** (whichever scores best), can be targeted, moved, stolen, or destroyed like a hero.
- **+10** goes to whoever **controls** it when the match ends — not to whoever drew it.
- Drawing it starts the **final round**: finish the current turn, then each opponent takes one more turn.
- **Revealed from grave or exile** (milled / exiled into those zones): it is not placed; it only starts the final round.
- If the deck empties before or instead of The Ancient, that also starts the final round; highest score wins.
- **Weaver's Time Lapse** shuffles the grave into the deck. If The Ancient is still in the deck, the Weaver player picks its depth band (near the top / upper middle / middle / lower middle / near the bottom, ±5%), so the shuffle cannot move it by accident.
- **Clarity** reveals from the top until a terrain, takes it, and puts the other revealed cards back on top in any order the player picks. The Ancient can be revealed this way without being drawn.

### 4.6 Target score

Optional (on by default). Targets by seat count 2/3/4/5/6/7/8: **50 / 40 / 35 / 30 / 30 / 30 / 30**.

- End your turn at or above the target to claim it; that starts a final round for you.
- At the start of your next turn you win if you still have at least the target **and nobody else does**.
- Opponents answer by reaching the target themselves or by knocking you below it; either resets your claim (you can claim again at the end of a later turn).
- A Refresher extra turn straight after the claim does not count as your next turn.
- The Ancient's final round still runs in parallel; whichever ends the match first wins.

### 4.5 Empty deck

Whenever the game is live and the deck is empty after settling effects/draws, **finish**: score all seats; set `over`.

---

## 5. Terrains (combos)

- Terrains **cannot** be played as a single card.
- Play **exactly three** terrain cards from hand as one free combo.

Every combo is exactly three terrains, scored by shape:

| Shape | Example | Points | Reward |
|-------|---------|--------|--------|
| **Pair** (`pairCombo`) | River, River, Jungle | **3** | — |
| **Mixed** (`mixCombo`) | River, Jungle, Lane | **5** | — |
| **Core** (`coreCombo`) | Lane, Lane, Lane | **8** | Top card of the matching pile (River → rune, Jungle → neutral, Lane → tower); none if the pile is empty |

**Terrain heroes count cards inside your combos**, not combos:

- **Meepo:** +1 point per terrain type (River / Jungle / Lane) you control.
- **Ember Spirit:** X = number of terrain types you control.
- **Slardar:** draw 1 per River card you control.
- **Luna:** whenever you play a combo, search the deck for an item card for each Jungle in it.
- **Hoodwink:** needs any Jungle card.

Combos remain as scored terrain piles; some effects destroy/protect them (Hoodwink, Windranger, Treant).

---

## 6. Playing cards

### 6.1 Cost and locks

- Non-instant plays cost 1 action (check before resolve).
- **Instant** cards cost 0 and may be played on an opponent’s turn: once in response to each of their actions, and again before a hero ability fires.
- **Chronosphere / lockPlay:** Opponents of the lock caster cannot play cards or combo.
- **Doom (aura):** Opponents cannot play items.
- **Doom / Halberd (`noHeroNow`):** Cannot play heroes this turn.
- **Troll Warlord (Battle Trance):** Opponents cannot play Instant cards (logged when it blocks an interrupt).
- **Shadow Demon ban:** Listed UIDs cannot be played while that SD is controlled by the banner.

### 6.2 Counters (Instant)

**Nyx Assassin** is an Instant. Play it in the Instant window before an ability fires: seat it onto a team you control, then counter that ability. The firing hero is destroyed only if it is **Intelligence**.

**Spirit Breaker** is an Instant. Play it in the same window: seat it onto a team you control, then redirect the ability onto itself (a hero target becomes Spirit Breaker; a team target becomes Spirit Breaker’s team). Destroy abilities redirected this way kill Spirit Breaker.

### 6.3 Heroes — multi-drop

- One action can play **one active hero** plus any number of **companion** heroes into the **same** team.
- Only the **active** hero’s on-play ability fires; companions are silent (auras still apply).
- Destination: existing team you own, or `new` (create team if under TEAM_CAP).
- Team size weight: max **5** heroes per team (weight 1 each in current engine).
- At most **one neutral token** per team.

**On enter (`arrived`):**

- Mark `enteredThisTurn`.
- If the team has a face-down trap, it resolves first (§7.1).
- Each **Lycan** already on that team (same controller) → controller draws 1.

**On-play fire** (active hero only, timing ≠ aura, not Nyx/Spirit Breaker hand-counter, not global silence):

1. If mined, queue cast for if-still-alive.
2. Else **Instant interrupt window**: each opponent may play one Instant (or pass). Battle Trance skips a seat and logs if they held Instant cards. Nyx played here counters the ability (destroying an Intelligence caster); Spirit Breaker redirects it.
3. Else if enemy **Pugna**: choose a card to discard, or the ability fizzles.
4. Else `cast(...)` the ability.

### 6.4 Neutrals (tokens)

- Play onto a team like a hero body; **no ability fire**.
- `token: true`: 0 flat points; help attr/attack sizing; one per team.
- **Tormentor** is a hand reward that is **not** a body — it is played as an effect (destroy a hero that entered this turn).
- Used neutrals/runes/towers go to **exile** when leaving play (not grave), except as card text says.

### 6.5 Items and rewards

- Remove from hand → resolve effect (`cast` with item/reward defId).
- Items → grave after use (typical). Rewards often exile.
- **Ursa:** When you play an item, your Ursas get destroy-ward until your next turn.

---

## 7. Abilities (`cast`)

### 7.1 Traps

Trap heroes (`timing: 'trap'`):

1. Play face down on a team with room for another hero — yours or an enemy’s. **Not** on a team of five, **not** on a closed team (`noEnter`), and **at most one trap per team**. There is no bluffing: only trap heroes go face down.
2. While face down, that team scores **no attribute bonus** (CORE / MIXED); flat and attack points still count.
3. **Single trigger:** the next time a hero **enters** that team, the trap reveals and resolves **before** the entering hero’s ability (the entrant’s cast is held in `laterCasts` until the trap finishes). Being targeted does not trigger it. The “controller” in trap text is whoever controls that team.
4. Afterwards a trap that did not sacrifice itself **joins that team** if there is room; otherwise it goes to the grave.
5. Removal: **Zeus** clears every trap; **Guardian Greaves** clears one player’s traps; **Observer Ward** removes a target trap (or reveals a hand); **Batrider** moves a trap to another player’s team with room, still face down.

| Group | Heroes |
|-------|--------|
| **Snares** (hurt the controller) | Techies, Broodmother, Monkey King, Slark, Riki, Shadow Shaman |
| **Wards** (help the controller) | Kez, Ogre Magi, Bounty Hunter, Templar Assassin |


### 7.1 Pipeline

1. If hero ability: blocked by **Global Silence**, **Shiva frost** (opponents of frost caster), or **Orchid mute** on source.
2. If not `armed`: run **questions** → may set `pending` for targets; on ready, **noteTargets** (Centaur Retaliate), **Refraction** counters, arm, optional **Multicast** echo.
3. Run **effect**.
4. If a hero ability fired and source’s team has **Juggernaut**, apply **glyph** (team immune) until that controller’s next turn.

### 7.2 Targeting rules (summary)

- **Glyph** on team: cannot be targeted by abilities/items/rewards.
- **Mars:** Enemy abilities cannot target that team.
- **Riki / hidden / Shadow Blade:** Cannot be chosen by enemies.
- **Kez:** Enemy heroes cannot target him with abilities.
- **BKB** on hero: immune to opposing effects as implemented in `canTargetHero` / destroy prevention.
- Source kinds: `ability` | `item` | `reward` — some wards only block some kinds.

### 7.3 “Until your next turn”

Timed flags store `{ caster, fromTurn }`. They clear at the **start** of that caster’s later turn (`fromTurn < turn`).

---

## 8. Destroy, bounce, exile, discard

Discards are chosen by the discarding player unless the card says "at random" (Chaos Knight). Owed discards (Meat Hook, Ravage, Mystic Flare, Retaliate) resolve right after the effect; with that many cards or fewer, the whole hand goes.

### 8.1 Destroy stack

Effects **enqueue** destroys; `settle` drains the queue via `performDestroy`.

Order of protection (unless `force`, or Troll Warlord “your destroys cannot be prevented” this turn):

1. Soft prevent: Naga Siren, BKB, Glyph, Shield, Ward/Shallow Grave/Snowball-style ward, Huskar (hand ≤ 3).
2. Omniknight **omni** once.
3. Blade Mail redirect (ask destroy enemy instead).
4. **Abaddon** substitute destroy.
5. **Roshan** substitute on same team.
6. **Dawnbreaker** Solar Guardian → return to hand (triggers PA).
7. **Phantom Lancer** → bounce to hand instead.
8. **Wraith King** reincarnation once.
9. **Save window** (if `window`): controller may play an instant save from hand (Dawnbreaker, Dazzle, Shadow Demon, Shield, Glyph, BKB, Euls — see `SAVE_IDS`).
10. Else remove from board → **grave** (heroes) or **exile** (tokens); fire **onDestroyed** auras (Shadow Fiend, Death Prophet, Bristleback, Fatal Bonds, Soulbind, …).

**Force** bypasses soft prevention and most substitutes (Lina, etc.), but not immunity.

### 8.0 Immunity

"Immune to all effects" (Black King Bar and Glyph on a team, Ursa's Enrage, Ringmaster's Wheel of Wonder, Shield Rune, Omniknight's Guardian Angel) blocks every opponent effect on that hero: destroy (even forced), exile, bounce, tuck into the deck, move, steal, Dark Seer's Vacuum, and Global Silence / Shiva's Guard / Orchid on its own ability. The controller's own effects still work on it.

### 8.2 Bounce / return to hand

Hero leaves board → owner’s hand. Triggers **Phantom Assassin** aura: each PA controller may destroy an enemy hero (queued asks).

Also: Illusion, Tidehunter Ravage, Oracle False Promise path, Juxtapose, Dawn, etc.

### 8.3 Zones

| Verb | From → To |
|------|-----------|
| Discard | Hand → grave |
| Destroy | Board → grave (token → exile) |
| Exile | Anywhere → exile (out of game) |
| Bounce | Board → owner hand |

**Ancient Apparition:** Enemy heroes that would enter the grave are exiled instead.

**Muerta:** Enemies cannot take cards from the grave.

Grave is shared; `graveThisTurn` / `lastGrave` track for effects.

**Visage:** Whenever a card enters the grave, Visage’s controller draws 1.

**Alchemist:** Whenever an **item** enters the grave, draw 1.

---

## 9. Scoring

Total = **sum of team scores** + **sum of terrain combo points**.

### 9.1 Per team

Bodies: each hero contributes `count` slots (`Meepo` = 2). Neutrals: `scoresFlat: false` (0 flat points) but still count for attribute/attack.

**Flat:** `heroPoints` × flat bodies (default 1 each).

**Shape gate:** Core and mix bonuses (and shape classification) require **at least 3 bodies**. Teams of 1–2 are **Small** — flat points only (+ attack if `attackOnMix`).

Label format: `STR x3, ATTR x3, MELEE x3` / `RANGE x3` — all numbers are **counts** (neutrals included). Attack **points** are in the team total only, not spelled out in the label.

**CORE** — 3×+ bodies share one attr (including UNI-only):

- Bonus by stack size 1..5: default `[0, 0, 3, 6, 10]`.
- Stacks with MIXED when both qualify (e.g. 3 STR + AGI + INT → core +3 and mix +2).
- **Blocks ATK** by default (`attackOnCore: false`).

**MIXED** — 3+ distinct attrs:

- Bonus by attr count 1..4: default `[0, 0, 2, 4]`.
- Stacks with CORE.

**ATK** — 3+ **Melee** or 3+ **Ranged**, counted separately (`MELEE x3` / `RANGE x4` = that side’s **body count**, never the point value):

- Bonus by count 1..5: default `[0, 0, 1, 2, 3]`.
- Mixed range is fine: 3 Ranged + 2 Melee still scores **R3** (and the reverse for Melee).
- If both sides qualify, the larger count wins (tie → Melee).
- Applies only when there is **no CORE** (unless `attackOnCore`). Toggle `attackOnMix` gates ATK on non-core boards.
- Neutrals have a real attack type and fill attr stacks: **Melee** — Stone Golem, Tormentor, Roshan; **Ranged** — Thunderhide, Ice Shaman, Black Dragon.

**Open / small** — under 3 bodies, or 3+ with neither CORE nor MIXED: flat + ATK when eligible.

**Brewmaster:** Counts as exactly one of STR/AGI/INT — engine picks the assignment that **maximizes that team’s score**.

**Elder Titan:** Enemy heroes have no attribute (still 1 flat; attack type can still score).

**No attribute** hero: still 1 flat; does not pad a mono stack.

Max illustrative: 5 same attr → 5 + 10 = **15**. Mix + ATK e.g. 5 heroes 4 attrs melee: 5 + 4 + 3 = **12**. CORE+MIXED e.g. 3 STR + AGI + INT melee: 5 + 3 + 2 = **10** (no ATK).

### 9.2 Terrains

Each completed combo adds its stored `points` (pair 3, mixed 5, core 8).

---

## 10. Important global / lasting effects

| Effect | Behavior |
|--------|----------|
| **Silence** (Silencer) | Opponents cannot activate ability effects until your next turn |
| **Frost** (Shiva) | Opponents of caster cannot fire/reactivate abilities; their **current** teams get `noEnter` |
| **Naga** | No hero can be destroyed |
| **Faceless Void** | Target opponent loses remaining actions (instant) |
| **Troll Warlord** | Opponents cannot play instant cards (aura) |
| **Maledict** | When that player discards from hand this turn, destroy one of their heroes |
| **Fatal Bonds** | If an enemy is destroyed this turn, destroy the bonded team instead |
| **Pugna** | On opponent hero ability: discard or nullify |
| **Venomancer** | On opponent item play: discard or nullify |
| **Viper** | Enemy auras are nullified |
| **Skip** | Miss next turn (Bane, Pangolier conditional, …) |
| **Anti-loop** | Stolen/copied abilities cannot chain-steal or chain-fire |
| **Traps** | Reveal when a hero enters, before its ability; suppress that team’s attribute bonus while face down |

---

## 11. Hand limit and draws

- Limit **7**. Discard down to 7 happens **only at end of turn** (not after draws or mid-turn gains).
- Cannot take the voluntary draw action if already at 7.
- Draws may be queued (`pendingDraws`) and resolved in `settle`.
- **Crystal Maiden / Lotus:** Draw until hand has 7.

---

## 12. Seat model and ownership

- **`owner`**: Original owner of the hero card (bounce returns here).
- **`controller`**: Who currently controls the board hero (Sunder, Vengeful, Enchant, …).
- Scoring and “your teams” use controller’s seat teams.
- Preferred sabotage foe (AI): opponent immediately above you in score, else strongest rival (`preferredFoe`).

---

## 13. Modes

- **`ai`**: Human vs AI Grove.
- **`hotseat`**: Pass-and-play; veil between turns.
- **`online`**: Ranked via server/WS (same rules engine).

AI strats: `balanced` | `tempo` | `architect` | `spite`.

---

## 14. Rules agents often miss

1. Terrains are **only** via 3-card combo; never lone play. Any three terrains make a combo.
2. Multi-hero drop = **one** action; **one** fire.
3. Nyx counters only the **active** hero; companions still land.
4. Neutrals are **0** flat points but count for bonuses; one per team.
5. Mono attr and attack bonus **do not stack** (default); mix + attack **do**.
6. UNI is its **own** mono color; it does not patch STR/AGI/INT holes.
7. Team cap **12**; team size weight cap **5**.
8. Instant cards **are** playable in response to an opponent’s action and before abilities fire; Battle Trance is the lockout. Nyx and Spirit Breaker only work in the ability window; Illusion only counters a card being played.
9. Destroy is asynchronous via **queue**; protection order matters.
10. Card text in `catalog.ts` is the player-facing contract; if code and text disagree, treat text as design intent and code as current behavior — prefer aligning them.

---

## 15. Source map

| Concern | File |
|---------|------|
| Card list / text | `src/game/catalog.ts` |
| Apply actions / turns / play | `src/game/engine.ts` |
| Ability questions & effects | `src/game/casts.ts` |
| Board, zones, destroy, targeting | `src/game/flow.ts` |
| Point math | `src/game/scoring.ts` |
| Short human rules UI | `src/ui/Rules.tsx` |
| Card browser UI | `src/ui/Glossary.tsx` |
| Ability Lab (per-card preset boards + conservation audit) | `src/game/lab.ts`, `src/ui/Lab.tsx` |

For the full card text dump, read `HEROES`, `ITEMS`, `REWARDS`, and `TERRAINS` in `catalog.ts`.
