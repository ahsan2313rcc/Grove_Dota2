# Grove

A two-player card game of Dota heroes, items, and settings. One shared deck. Two actions a turn. A setting combo is free.

This app lives in `grove/` and is separate from the lane game at the repository root.

## Play

```bash
cd grove
npm install
npm run dev
```

Open http://127.0.0.1:43117

- **Play the Grove** — you go first against the Grove.
- **Pass and play** — two people, one screen. The seat is covered between turns.

Add `?mode=ai&seed=58` to deal a known game. `npm test` runs the rules engine.

## Rules

You have two actions. Draw one card, or play a hero, item, or reward. Instant cards are free. Three settings at once are free: three of a kind score 3 and take the top of the matching face-down pile (River a rune, Jungle a neutral, Lane a tower). One River, one Jungle, and one Lane score 5.

Heroes score in teams of up to five.

Each hero scores 1. One attribute, Universal included, adds +1 / +3 / +6 / +10 for 2 / 3 / 4 / 5 heroes, with no attack bonus. Universal does not fill in for a missing attribute. A mixed team adds +0 / +2 / +6 for 2 / 3 / 4 different attributes. Three, four, or five heroes of the same attack type add +1 / +2 / +3, except on a one-attribute team. Neutrals do not spoil that bonus. Meepo counts as two. Brewmaster alone is three attributes and scores 3. A hero with no attribute still scores 1.

The deck and the grave are shared. Discard goes from hand to grave. Destroy goes from the board to grave. Exile leaves the game. The hand limit is 7. The match ends when the deck is empty.
