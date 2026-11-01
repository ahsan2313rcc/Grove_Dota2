# Grove — Complete Rules Reference

Authoritative rules for agents and implementers. Card text lives in `src/game/catalog.ts`. Engine: `src/game/engine.ts`, effects: `src/game/casts.ts`, board helpers: `src/game/flow.ts`, scoring: `src/game/scoring.ts`.

---

## 1. Overview

Grove is a competitive multiplayer card game (typically **2 seats**; engine supports more). Players build **teams of heroes** and play **setting combos** for points. One **shared deck**, shared **grave**, and shared **exile**. Separate face-down reward piles: **runes**, **neutrals**, **towers**.

**Win condition:** When the shared deck is empty, the game ends. Highest total score wins (teams + setting combo points). Ties are possible (no forced tiebreak in engine finish).

---

## 2. Card types

| Kind | Where | Notes |
|------|--------|------|
| **Hero** | Main deck | Has attribute (STR/AGI/INT/UNI), attack type (Melee/Ranged), ability timing |
| **Item** | Main deck | Played from hand; often targeted |
| **Setting** | Main deck (36 total: river/jungle/lane) | Never played alone — always as a **combo of exactly 3** |
| **Rune** | Rune pile | Reward from 3 Rivers |
| **Neutral** | Neutral pile | Reward from 3 Jungles; token body on a team (except Tormentor) |
| **Tower** | Tower pile | Reward from 3 Lanes |

**Hero timing** (`catalog` `timing`):

- **`cast`** — Ability fires when the hero is played as the **active** hero (unless silenced/blocked).
- **`aura`** — No on-play fire; passive while on the board.
- **`instant`** — Can be played as a free instant (no action) on your turn; some are also hand answers (Nyx, saves).
- **`trap`** — Played face down onto a team. Does **not** fire on play. Reveals and resolves when its trigger is met (see §7.1).

**Item / reward `instant: true`:** Does not cost an action.

### Anti-loop (stolen / copied abilities)

Effects that **steal control**, **swap control**, **copy**, or **reactivate** another hero’s ability may say you can fire it immediately. Global rule:

- A **stolen** or **copied** ability **cannot** steal, swap control, copy, or fire another stolen/copied ability.
- Reactivations from KotL / Rubick / Arcane / Blink / Satanic / Morphling / Lifestealer / Vengeful / Enchantress respect the same chain break.

Engine should track a `stolenCast` (or depth) flag for the duration of that nested fire.

---

## 3. Setup

1. Build and shuffle the main deck: all heroes (1 each) + item copies + 36 settings.
2. Fill and shuffle reward piles from `REWARDS` by kind.
3. Each player draws **5**.
4. Seat 0 is active, starts with **2 actions** (no turn-start draw on the very first partial turn — opening hand is the 5). Subsequent turns: draw 3 + 2 actions.

`handLimit` = **7**. `TEAM_CAP` = **12** teams per player.

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
7. **Draw 3** (via pending draws; may trigger Slark, hand-limit discard, empty-deck finish).

Hotseat: optional veil between seats.

### 4.2 During turn (active player)

Legal actions (when no `pending` prompt):

| Action | Cost | Effect |
|--------|------|--------|
| **Play** hero/item/reward | 1 action (0 if instant) | See §6–7 |
| **Combo** 3 settings | Free | See §5 |
| **Draw** | 1 action | Draw 1 if hand &lt; limit and deck nonempty |
| **Discard stuck** | 1 action | Pitch a hand card to grave (escape Poison Nova / lone settings) |
| **Move** Ember Spirit | Free | Aura move between own teams |
| **Morph cast** | — | Fire stolen Morph ability if eligible |
| **End** | — | End turn (must discard down to 7 first if over limit) |

While `pending` is set, only **choose** (answer the prompt) is legal. AI/`autoAll` auto-picks.

### 4.3 End of turn

1. If hand &gt; 7, must discard down to 7 (`limit` prompt with `then: 'end'`).
2. Return same-turn phased heroes; clear end-of-turn marks (graveThisTurn, enteredThisTurn, multicast, troll, maledict, bonds, soulbind, reveal, dawn flags, noHeroNow, mailTurn).
3. Next seat starts turn (§4.1).

### 4.4 Empty deck

Whenever the game is live and the deck is empty after settling effects/draws, **finish**: score all seats; set `over`.

---

## 5. Settings (combos)

- Settings **cannot** be played as a single card.
- Play **exactly three** setting cards from hand as one free combo.
- Can be countered by **Nyx Assassin** (like other plays).

**Three of a kind** (3 River / 3 Jungle / 3 Lane):

- Score **`coreCombo`** points (default **5**), stored on the player’s `combos` list.
- Take the **top card** of the matching pile into hand (rune / neutral / tower). If pile empty, no reward.

**Mixed** (one of each River + Jungle + Lane):

- Score **`mixCombo`** points (default **5**).
- **No** reward pile draw.

**Luna aura:** For each Jungle card in the combo, if you control Luna, draw an item from the main deck (first item found; cards above it stay).

Combos remain as scored setting piles; some effects destroy/protect them (Hoodwink, Windranger, Treant).

---

## 6. Playing cards

### 6.1 Cost and locks

- Non-instant plays cost 1 action (check before resolve).
- **Chronosphere / lockPlay:** Opponents of the lock caster cannot play cards or combo.
- **Venomancer:** Opponents cannot play items.
- **Doom / Halberd (`noHeroNow`):** Cannot play heroes this turn.
- **Shadow Demon ban:** Listed UIDs cannot be played while that SD is controlled by the banner.

### 6.2 Nyx counter window

Before a play (or combo) resolves, an opponent holding **Nyx Assassin** may discard it:

- Countered **card** → grave (companions in a multi-drop still enter silently).
- Countered **combo** → all three settings → grave; no score/reward.

### 6.3 Heroes — multi-drop

- One action can play **one active hero** plus any number of **companion** heroes into the **same** team.
- Only the **active** hero’s on-play ability fires; companions are silent (auras still apply).
- Destination: existing team you own, or `new` (create team if under TEAM_CAP).
- Team size weight: Meepo = 2, others = 1; max **5** weight per team.
- At most **one neutral token** per team.

**On enter (`arrived`):**

- Mark `enteredThisTurn`.
- If team has Techies **mine**, destroy the entering hero and grave the mine card.
- Each **Lycan** already on that team (same controller) → controller draws 1.

**On-play fire** (active hero only, timing ≠ aura, not Nyx, not global silence):

1. If mined, queue cast for if-still-alive.
2. Else if enemy **Pugna**: choose discard 1 or fizzle fire.
3. Else **Tormentor** window (enemy may exile Tormentor from hand to destroy the new hero; if hero dies, cast cancelled; if saved/alive, cast proceeds).
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

1. Play face down on **any** team (ally or enemy).
2. **At most one trap per team** (optional hard limit; recommended).
3. **Trigger (automatic):** when a hero **enters** that team, **or** when that team / a hero in it is **targeted by an effect**, the trap **reveals and resolves** — no owner choice to pass.
4. Resolve printed text (often sacrifice the trap hero, then the effect).
5. **Zeus** removes all face-down traps from the board.

Trap roster: Techies, Riki, Kez, Monkey King, Templar Assassin, Ogre Magi, Slark, Bounty Hunter, Shadow Shaman.


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

**Force** bypasses soft prevention and most substitutes (Lina, etc.).

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

Total = **sum of team scores** + **sum of setting combo points**.

### 9.1 Per team

Bodies: each hero contributes `count` slots (`Meepo` = 2). Neutrals: `scoresFlat: false` (0 flat points) but still count for attribute/attack.

**Flat:** `heroPoints` × flat bodies (default 1 each).

**Mono-attribute** (every body has attr, union size 1, including UNI-only):

- Core bonus by size 1..5: default `[0, 0, 3, 6, 10]`.
- Attack bonus **off** by default (`attackOnCore: false`).

**Otherwise (mixed / open):**

- Mix bonus by distinct attr count 1..4: default `[0, 0, 2, 4]`.
- Attack bonus **on** by default (`attackOnMix: true`): if all non-null ranges are the same Melee or Ranged, size 1..5 → `[0, 0, 1, 2, 3]`. Neutrals have `range: null` and do not spoil sameness of hero ranges.

**Brewmaster:** Counts as exactly one of STR/AGI/INT — engine picks the assignment that **maximizes that team’s score**.

**Elder Titan:** Enemy heroes have no attribute (still 1 flat; attack type can still score).

**No attribute** hero: still 1 flat; may block mono core.

Max illustrative mono team: 5 same attr → 5 + 10 = **15**. Mix + attack e.g. 5 heroes 4 attrs melee: 5 + 4 + 3 = **12**.

### 9.2 Settings

Each completed combo adds its stored `points` (default 5).

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
| **Traps** | Auto-reveal on enter/targeted; Zeus clears all |

---

## 11. Hand limit and draws

- Limit **7**. Over limit → must discard (prompt). Cannot voluntary draw-action if already at limit.
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

1. Settings are **only** via 3-card combo; never lone play.
2. Multi-hero drop = **one** action; **one** fire.
3. Nyx counters only the **active** hero; companions still land.
4. Neutrals are **0** flat points but count for bonuses; one per team.
5. Mono attr and attack bonus **do not stack** (default); mix + attack **do**.
6. UNI is its **own** mono color; it does not patch STR/AGI/INT holes.
7. Team cap **12**; team size weight cap **5**.
8. Instant ≠ always playable on opponent’s turn — play is still only on your active turn (unless a save/answer prompt gives you a choose).
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

For the full card text dump, read `HEROES`, `ITEMS`, `REWARDS`, and `SETTINGS` in `catalog.ts`.
