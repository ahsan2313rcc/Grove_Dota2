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

### Online ranked (matchmaking + MMR)

```bash
# terminal 1 — authoritative server (WS + optional static dist)
npm run start

# terminal 2 — Vite client (proxies /ws to :8787)
npm run dev
```

Lobby → **Play online (ranked)** → register → Find match. Starting MMR is 1000 (Elo). For production on Render, use a **Web Service** with:

- Build: `npm install && npm run build`
- Start: `npm start`
- Persistent disk optional for `.data/players.json` (set `GROVE_DATA`)

- **Play the Grove** — you go first against the Grove.
- **Pass and play** — two people, one screen. The seat is covered between turns.

Add `?mode=ai&seed=58` to deal a known game. Seed `d58` opens debug spectate with balance stats (card point swings, contested cards, avg points/cards per turn). AI seats pick a personality — Balanced, Tempo, Architect, or Spite — and debug stats can filter by strat or mixture. Use parallel games or background batch (up to 1024) from the lobby / debug rail. `?mode=debug&seed=58&batch=4` starts four live AI matches. `npm test` runs the rules engine.

## Rules

You have two actions. Draw one card, or play a hero, item, or reward. Instant cards are free. Three settings at once are free (a lone setting cannot be played): three of a kind score 5 and take the top of the matching face-down pile (River a rune, Jungle a neutral, Lane a tower). One River, one Jungle, and one Lane also score 5.

Heroes score in teams of up to five. A player can field at most 12 teams.

Each hero scores 1. A team earns either the same-attribute bonus or the attack bonus, not both. One attribute, Universal included, adds +0 / +0 / +3 / +6 / +10 for 1 / 2 / 3 / 4 / 5 heroes (max 15), with no attack bonus. Universal does not fill in for a missing attribute. A mixed team can also earn +0 / +0 / +2 / +4 for 1 / 2 / 3 / 4 different attributes, and that bonus stacks with attack. Three, four, or five heroes of the same attack type add +1 / +2 / +3 (mix max 12). Neutrals do not spoil that bonus. Meepo counts as two. Brewmaster alone is three attributes and scores 3. A hero with no attribute still scores 1.

The deck and the grave are shared. Discard goes from hand to grave. Destroy goes from the board to grave. Exile leaves the game. The hand limit is 7. The match ends when the deck is empty.
