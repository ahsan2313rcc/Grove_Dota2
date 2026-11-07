import { HEROES, ITEMS, display, firesAbility } from './catalog.ts'
import { apply, createGame, needsTeam } from './engine.ts'
import { allLocs, makeHero, newTeam, putOnTeam, scoreState } from './flow.ts'
import type { CardInst, Game, PlayerId } from './types.ts'

/** One seat of a lab board. Card ids are catalog ids; teams list heroes in order. */
export interface LabSeat {
  hand?: string[]
  teams?: string[][]
  combos?: string[][]
  /** Face-down traps by team index. */
  traps?: { team: number; defId: string }[]
}

export interface LabSetup {
  seats: [LabSeat, LabSeat]
  grave?: string[]
  deckTop?: string[]
  /** Where the lab card goes: a new team, an existing team of a seat, or no team (items / instants). */
  target?: 'new' | 'none' | { seat: PlayerId; team: number }
  /** Trap cards demo by planting face down on your team A and playing this hero into it. */
  entrant?: string
  note?: string
}

export interface LabCard {
  defId: string
  name: string
  kind: 'hero' | 'item'
  timing: string
  text: string
}

export interface LabResult {
  defId: string
  issues: string[]
  warnings: string[]
  changes: string[]
  log: string[]
  before: Game
  after: Game
}

const BASE: LabSetup = {
  seats: [
    {
      hand: ['juggernaut', 'clarity'],
      teams: [['axe', 'sven'], ['lina', 'crystal_maiden']],
      combos: [['river', 'jungle', 'lane']],
    },
    {
      hand: ['river', 'lane', 'jungle'],
      teams: [['tiny', 'zeus', 'lion'], ['sniper', 'drow_ranger'], ['pudge']],
      combos: [['river', 'river', 'river']],
    },
  ],
  grave: ['phantom_lancer', 'clarity'],
}

/** Per-card board tweaks so each ability has something to bite on. */
export const LAB_OVERRIDES: Record<string, Partial<LabSetup>> = {
  drow_ranger: {
    seats: [{ teams: [['axe', 'sven'], ['lina', 'crystal_maiden', 'windranger']] }, {}],
    target: { seat: 0, team: 1 },
  },
  sven: { seats: [{ teams: [['axe', 'tidehunter', 'slardar'], ['lina', 'crystal_maiden']] }, {}], target: { seat: 0, team: 0 } },
  tiny: { target: { seat: 0, team: 0 } },
  earthshaker: { seats: [{}, { teams: [['tiny', 'zeus', 'lion', 'pudge'], ['sniper', 'drow_ranger']] }] },
  lion: { seats: [{}, { hand: ['river', 'lane', 'slardar'] }] },
  snapfire: { seats: [{ hand: ['juggernaut', 'clarity', 'lane'] }, {}] },
  batrider: { seats: [{}, { traps: [{ team: 0, defId: 'techies' }] }] },
  bounty_hunter: { seats: [{}, { hand: ['river', 'lane', 'slardar'] }] },
  rubick: { target: { seat: 0, team: 0 } },
  greaves: { seats: [{}, { traps: [{ team: 0, defId: 'techies' }] }] },
}

/** Cards that only answer another card's ability; played alone they have nothing to counter. */
const REACTIVE = new Set(['nyx_assassin', 'spirit_breaker'])

const FILLERS = HEROES.filter((hero) => hero.timing === 'cast').map((hero) => hero.id)

export function labCards(): LabCard[] {
  const heroes: LabCard[] = HEROES.map((hero) => ({
    defId: hero.id,
    name: hero.name,
    kind: 'hero',
    timing: hero.timing,
    text: hero.text,
  }))
  const items: LabCard[] = ITEMS.map((item) => ({
    defId: item.id,
    name: item.name,
    kind: 'item',
    timing: item.instant ? 'instant' : 'cast',
    text: item.text,
  }))
  return [...heroes, ...items].sort((a, b) => a.name.localeCompare(b.name))
}

export function labSetup(defId: string): LabSetup {
  const extra = LAB_OVERRIDES[defId] ?? {}
  return {
    ...BASE,
    ...extra,
    seats: [
      { ...BASE.seats[0], ...(extra.seats?.[0] ?? {}) },
      { ...BASE.seats[1], ...(extra.seats?.[1] ?? {}) },
    ],
  }
}

function isTrap(defId: string): boolean {
  return HEROES.find((hero) => hero.id === defId)?.timing === 'trap'
}

/** Deal a lab board: seat 0 (you) to act with the lab card in hand. */
export function buildLab(defId: string, seed = 7): { game: Game; uid: string; team: string; setup: LabSetup } {
  const setup = labSetup(defId)
  let game = createGame({ seed, mode: 'hotseat', names: ['You', 'Rival'] })
  game = { ...game, players: game.players.map((seat) => ({ ...seat, ai: false })) as Game['players'] }
  game = apply(game, { type: 'ready' })
  // Everything back into the deck so the board is exactly the setup.
  game = {
    ...game,
    deck: [...game.deck, ...game.players.flatMap((seat) => seat.hand)],
    players: game.players.map((seat) => ({ ...seat, hand: [], actions: 2 })) as Game['players'],
  }
  const trapCard = isTrap(defId)
  const entrant = trapCard ? setup.entrant ?? 'axe' : null
  const used = new Set<string>([defId, ...(entrant ? [entrant] : [])])
  const take = (want: string): [Game, CardInst] | null => {
    const card = game.deck.find((entry) => entry.defId === want)
    if (!card) return null
    used.add(want)
    return [{ ...game, deck: game.deck.filter((entry) => entry.uid !== card.uid) }, card]
  }
  const stand = (want: string): string => {
    if (want !== defId && want !== entrant) return want
    return (
      FILLERS.find(
        (id) =>
          !used.has(id) &&
          game.deck.some((card) => card.defId === id) &&
          !setup.seats.some((seat) => seat.teams?.flat().includes(id) || seat.hand?.includes(id)),
      ) ?? want
    )
  }
  const toHand = (seat: PlayerId, want: string) => {
    const got = take(want)
    if (!got) return
    game = { ...got[0], players: got[0].players.map((entry) => (entry.id === seat ? { ...entry, hand: [...entry.hand, got[1]] } : entry)) as Game['players'] }
  }

  toHand(0, entrant ?? defId)
  const teamIds: string[][] = [[], []]
  for (const seat of [0, 1] as PlayerId[]) {
    const spec = setup.seats[seat]
    for (const want of spec.hand ?? []) if (want !== defId) toHand(seat, stand(want))
    for (const heroes of spec.teams ?? []) {
      const made = newTeam(game, seat)
      if (!made) break
      let teamId = ''
      ;[game, teamId] = made
      for (const want of heroes) {
        const got = take(stand(want))
        if (!got) continue
        game = putOnTeam(got[0], seat, teamId, makeHero(got[1], seat, seat, got[0]))
      }
      teamIds[seat]!.push(teamId)
    }
    for (const set of spec.combos ?? []) {
      const cards: CardInst[] = []
      for (const want of set) {
        const got = take(want)
        if (!got) continue
        game = got[0]
        cards.push(got[1])
      }
      if (cards.length !== 3) continue
      const kinds = new Set(cards.map((card) => card.defId))
      const kind = kinds.size === 1 ? (cards[0]!.defId as 'river' | 'jungle' | 'lane') : kinds.size === 3 ? 'mixed' : 'pair'
      const points = kind === 'mixed' ? 5 : kind === 'pair' ? 3 : 8
      game = {
        ...game,
        nextId: game.nextId + 1,
        players: game.players.map((entry) =>
          entry.id === seat
            ? { ...entry, combos: [...entry.combos, { id: `c${game.nextId}`, owner: seat, cards, points, kind, protectedBy: null }] }
            : entry,
        ) as Game['players'],
      }
    }
    const traps = [...(spec.traps ?? []), ...(trapCard && seat === 0 ? [{ team: 0, defId }] : [])]
    for (const trap of traps) {
      const teamId = teamIds[seat]![trap.team]
      const got = take(trap.defId)
      if (!teamId || !got) continue
      game = {
        ...got[0],
        players: got[0].players.map((entry) => ({
          ...entry,
          teams: entry.teams.map((team) => (team.id === teamId ? { ...team, trap: { uid: got[1].uid, defId: trap.defId, owner: seat } } : team)),
        })) as Game['players'],
      }
    }
  }
  for (const want of setup.grave ?? []) {
    const got = take(stand(want))
    if (got) game = { ...got[0], grave: [...got[0].grave, got[1]] }
  }
  const top: CardInst[] = []
  for (const want of setup.deckTop ?? []) {
    const got = take(want)
    if (!got) continue
    game = got[0]
    top.push(got[1])
  }
  // Keep The Ancient out of reach so a lab run never starts the final round by accident.
  const ancient = game.deck.filter((card) => card.kind === 'ancient')
  game = { ...game, deck: [...top, ...game.deck.filter((card) => card.kind !== 'ancient'), ...ancient], log: [`Ability Lab: ${display(defId).name}.`] }

  const lead = entrant ?? defId
  const uid = game.players[0].hand.find((card) => card.defId === lead)?.uid ?? ''
  const target = trapCard ? { seat: 0 as PlayerId, team: 0 } : setup.target ?? (needsTeam(defId, display(defId).kind) ? 'new' : 'none')
  const team = target === 'new' ? 'new' : target === 'none' ? '' : teamIds[target.seat]?.[target.team] ?? 'new'
  return { game, uid, team, setup }
}

/** Every physical card uid on the table, with how many places hold it. */
export function census(game: Game): Map<string, number> {
  const seen = new Map<string, number>()
  const add = (card: { uid: string } | null | undefined) => {
    if (!card) return
    seen.set(card.uid, (seen.get(card.uid) ?? 0) + 1)
  }
  for (const card of [...game.deck, ...game.grave, ...game.exile, ...game.runes, ...game.neutrals, ...game.towers, ...game.limbo]) add(card)
  for (const seat of game.players) {
    for (const card of seat.hand) add(card)
    for (const combo of seat.combos) for (const card of combo.cards) add(card)
    for (const team of seat.teams) {
      if (team.trap) add(team.trap)
      if (team.mine) add(team.mine)
      for (const hero of team.heroes) {
        add(hero)
        if (hero.held) add(hero.held.card)
      }
    }
  }
  for (const entry of game.phased) add(entry.hero)
  return seen
}

export function conservation(before: Game, after: Game): string[] {
  const issues: string[] = []
  const was = census(before)
  const now = census(after)
  for (const [uid, count] of now) {
    if (count > 1) issues.push(`Card ${uid} is in ${count} places at once.`)
  }
  for (const uid of was.keys()) {
    if (!now.has(uid)) issues.push(`Card ${uid} vanished from every zone.`)
  }
  for (const uid of now.keys()) {
    if (!was.has(uid)) issues.push(`Card ${uid} appeared from nowhere.`)
  }
  return issues
}

/** A coarse board fingerprint that ignores the lab card itself; `spend` is the action a plain play costs. */
function fingerprint(game: Game, skip: string, spend = 0): string {
  return JSON.stringify({
    deck: game.deck.length,
    grave: game.grave.filter((card) => card.uid !== skip).map((card) => card.uid),
    exile: game.exile.filter((card) => card.uid !== skip).map((card) => card.uid),
    players: game.players.map((seat) => ({
      hand: seat.hand.filter((card) => card.uid !== skip).map((card) => card.uid).sort(),
      teams: seat.teams
        .map((team) => ({
          heroes: team.heroes.filter((hero) => hero.uid !== skip).map((hero) => ({ ...hero, enteredSeq: 0, enteredTurn: 0 })),
          trap: team.trap?.uid ?? null,
          flags: [team.gaze, team.noEnter, team.noLeave, team.glyph, team.blade, team.guard],
        }))
        .filter((team) => team.heroes.length > 0 || team.trap),
      combos: seat.combos.map((combo) => `${combo.id}:${combo.protectedBy ?? ''}`),
      flags: [seat.skip, seat.noHeroNext, seat.noHeroNow, seat.orchid, seat.bkb, seat.mailTurn, seat.handLimit],
      actions: seat.id === game.active ? seat.actions - spend : seat.actions,
    })),
    globals: [
      game.silence, game.naga, game.lockPlay, game.frost, game.noDraw, game.primalItems, game.rupture, game.taxAction,
      game.attrBan, game.darkSeer, game.troll, game.bonds, game.sdBan, game.maledict, game.soulbind, game.viper,
      game.reveal, game.freeItems, game.clinkzExile, game.freePlay, game.spellNullify, game.extraTurn, game.lassos,
      game.phased, game.medusaHold, game.infests, game.multicast,
    ],
  })
}

function summarize(before: Game, after: Game): string[] {
  const lines: string[] = []
  for (const seat of after.players) {
    const was = before.players[seat.id]!
    const scoreBefore = scoreState(before, seat.id).total
    const scoreAfter = scoreState(after, seat.id).total
    const heroesBefore = allLocs(before).filter((loc) => loc.player.id === seat.id).length
    const heroesAfter = allLocs(after).filter((loc) => loc.player.id === seat.id).length
    const parts = [
      scoreAfter !== scoreBefore ? `score ${scoreBefore} → ${scoreAfter}` : '',
      heroesAfter !== heroesBefore ? `heroes ${heroesBefore} → ${heroesAfter}` : '',
      seat.hand.length !== was.hand.length ? `hand ${was.hand.length} → ${seat.hand.length}` : '',
      seat.actions !== was.actions ? `actions ${was.actions} → ${seat.actions}` : '',
      seat.skip && !was.skip ? 'loses next turn' : '',
      seat.orchid && !was.orchid ? 'abilities locked' : '',
    ].filter(Boolean)
    if (parts.length > 0) lines.push(`${seat.name}: ${parts.join(', ')}`)
    const layout = (teams: Game['players'][number]['teams']) =>
      teams.map((team) => `[${team.heroes.map((hero) => display(hero.defId).name).join(', ')}${team.trap ? ' + trap' : ''}]`).join(' ')
    if (layout(was.teams) !== layout(seat.teams)) lines.push(`${seat.name} teams: ${layout(was.teams)} → ${layout(seat.teams)}`)
  }
  if (after.grave.length !== before.grave.length) lines.push(`Grave ${before.grave.length} → ${after.grave.length}`)
  if (after.exile.length !== before.exile.length) lines.push(`Exile ${before.exile.length} → ${after.exile.length}`)
  if (after.deck.length !== before.deck.length) lines.push(`Deck ${before.deck.length} → ${after.deck.length}`)
  return lines
}

/** Play the lab card on its board, let every prompt auto-resolve, then audit the result. */
export function runLab(defId: string, seed = 7): LabResult {
  const built = buildLab(defId, seed)
  const before = built.game
  const issues: string[] = []
  const warnings: string[] = []
  if (!built.uid) issues.push('The lab card never reached your hand.')
  let after = apply({ ...before, autoAll: true }, { type: 'play', uid: built.uid, team: built.team })
  let guard = 0
  while (after.pending && guard++ < 30) after = apply(after, { type: 'choose', ids: after.pending.choices.slice(0, Math.max(1, after.pending.min)).map((choice) => choice.id) })
  after = { ...after, autoAll: false }
  if (after.pending) issues.push(`A prompt is left open: ${after.pending.prompt}`)
  if (after.players[0].hand.some((card) => card.uid === built.uid) && !isTrap(defId)) {
    issues.push(`The play was refused: ${after.log.at(-1) ?? ''}`)
  }
  issues.push(...conservation(before, after))
  const log = after.log.slice(before.log.length)
  const timing = HEROES.find((hero) => hero.id === defId)?.timing
  const instant = timing === 'instant' || ITEMS.some((item) => item.id === defId && item.instant)
  const quiet = fingerprint(before, built.uid, instant ? 0 : 1) === fingerprint(after, built.uid)
  if (REACTIVE.has(defId)) {
    warnings.push('Reacts to another ability; test it from the instant window in a live game.')
  } else if (quiet && timing !== 'aura' && (firesAbility(defId) || display(defId).kind === 'item' || isTrap(defId))) {
    warnings.push('Nothing visible changed on this board.')
  }
  const fizzled = log.find((line) => /fizzle|finds no|needs \d|needs a|no enemy|nothing to|is gone|no legal|no other|no hero card|no hero in|no traps/i.test(line))
  if (fizzled) warnings.push(`Possible fizzle: ${fizzled}`)
  return { defId, issues, warnings, changes: summarize(before, after), log, before, after }
}
