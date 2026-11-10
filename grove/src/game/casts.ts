import { ANCIENT_ID, HERO_BY_ID, ITEM_BY_ID, display, firesAbility } from './catalog.ts'
import {
  abilitiesLocked,
  addHand,
  addTeam,
  blankTeam,
  afterBoardToHand,
  allLocs,
  arrived,
  ask,
  attrsOf,
  aurasSuppressed,
  bounce,
  canTargetHero,
  clearAllTraps,
  comboLocked,
  discardUid,
  enqueue,
  enterReason,
  extract,
  findHero,
  foe,
  opponents,
  graveLocked,
  heroPlayBanned,
  heroChoices,
  heroTag,
  heroWeight,
  immuneFrom,
  immuneNote,
  instantsLocked,
  intelCount,
  log,
  mostRecentEnemy,
  newTeam,
  seatTeam,
  TEAM_CAP,
  noteTargets,
  pname,
  pullTop,
  makeHero,
  putOnTeam,
  queueDiscard,
  queueDraw,
  randInt,
  randomFrom,
  rangedCount,
  refracts,
  releaseHeld,
  removeHand,
  removeHero,
  returnInfest,
  setPlayer,
  shuffle,
  silenced,
  strengthCount,
  teamById,
  terrainCount,
  terrainKinds,
  teamChoices,
  teamSize,
  toExile,
  toGrave,
  trapBlock,
  topReward,
  updateTeam,
} from './flow.ts'
import type { Attr, CardInst, Choice, Game, Pending, PlayerId } from './types.ts'
import type { CastResume } from './types.ts'

type Mode = Pending['mode']

interface Question {
  actor: PlayerId
  prompt: string
  choices: Choice[]
  min: number
  max: number
  mode: Mode
  about?: Pending['about']
}

type Ask = { type: 'ask'; q: Question } | { type: 'fizzle'; text: string } | { type: 'ready' }

function step(resume: CastResume): number {
  return resume.steps ?? 0
}

function heroIds(picked: string[]): string[] {
  return picked.filter((id) => id.startsWith('hero:')).map((id) => id.slice(5))
}

function teamIds(picked: string[]): string[] {
  return picked.filter((id) => id.startsWith('team:') || id.startsWith('new')).map((id) => id)
}

function rawTeams(picked: string[]): string[] {
  return picked.filter((id) => id.startsWith('team:')).map((id) => id.slice(5))
}

function cardIds(picked: string[]): string[] {
  return picked.filter((id) => id.startsWith('card:')).map((id) => id.slice(5))
}

function ready(): Ask {
  return { type: 'ready' }
}

function fizzle(text: string): Ask {
  return { type: 'fizzle', text }
}

function pose(
  actor: PlayerId,
  prompt: string,
  choices: Choice[],
  min = 1,
  max = 1,
  mode: Mode = 'pick',
  about?: Pending['about'],
): Ask {
  if (min > 0 && choices.length === 0) return fizzle('No legal target.')
  return { type: 'ask', q: { actor, prompt, choices, min, max, mode, ...(about ? { about } : {}) } }
}

function yesNo(): Choice[] {
  return [
    { id: 'yes', label: 'Activate' },
    { id: 'no', label: 'Leave it' },
  ]
}

/** Name the hero and the first line of its ability, for a fire-or-leave prompt. */
function activateAsk(defId: string | undefined): { prompt: string; about?: Pending['about'] } {
  if (!defId) return { prompt: 'Activate that ability, or leave it?' }
  const info = display(defId)
  const parts = (info.text || info.spell || info.name).match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? []
  let built = ''
  for (const part of parts) {
    const next = built ? `${built} ${part}` : part
    if (next.replace(/[.!?]+$/, '').length > 110) break
    built = next
  }
  const bare = (built || parts[0] || info.name).replace(/[.!?]+$/, '').trim()
  const short = bare.length > 110 ? `${bare.slice(0, 107).trim()}…` : bare
  return {
    prompt: `Activate ${info.name}'s ability (${short})?`,
    about: { defId, name: info.name, spell: info.spell, text: info.text, kind: info.kind },
  }
}

function enemyHeroes(state: Game, actor: PlayerId, source: 'ability' | 'item' | 'reward', pred?: (uid: string) => boolean): Choice[] {
  return heroChoices(state, actor, source, (loc) => loc.hero.controller !== actor && (!pred || pred(loc.hero.uid)))
}

function ownHeroes(state: Game, actor: PlayerId, source: 'ability' | 'item' | 'reward'): Choice[] {
  return heroChoices(state, actor, source, (loc) => loc.hero.controller === actor)
}

function here(state: Game, resume: CastResume) {
  return findHero(state, resume.sourceUid)
}

function sourceKind(defId: string): 'ability' | 'item' | 'reward' {
  if (HERO_BY_ID[defId]) return 'ability'
  if (ITEM_BY_ID[defId]) return 'item'
  return 'reward'
}

function handCards(state: Game, id: PlayerId, pred: (card: CardInst) => boolean = () => true): Choice[] {
  return state.players[id].hand.filter(pred).map((card) => ({
    id: `card:${card.uid}`,
    label: display(card.defId).name,
    defId: card.defId,
  }))
}

function graveHeroes(state: Game): Choice[] {
  return state.grave
    .filter((card) => card.kind === 'hero')
    .map((card) => ({ id: `card:${card.uid}`, label: display(card.defId).name, defId: card.defId }))
}

function opponentChoices(state: Game, actor: PlayerId): Choice[] {
  return opponents(state, actor).map((id) => ({ id: `player:${id}`, label: pname(state, id) }))
}

function pickedEnemy(state: Game, resume: CastResume, actor: PlayerId): PlayerId {
  const raw = resume.picked.find((id) => id.startsWith('player:'))
  if (raw) return Number(raw.slice(7))
  return foe(state, actor)
}

function ownTeams(state: Game, actor: PlayerId, withNew: boolean): Choice[] {
  const choices = teamChoices(state, actor, 'ability', (_team, player) => player.id === actor)
  if (withNew && state.players[actor].teams.length < TEAM_CAP) choices.push({ id: `new:${actor}`, label: 'New team' })
  return choices
}

export function cast(state: Game, resume: CastResume): Game {
  if (firesAbility(resume.defId) && findHero(state, resume.sourceUid)) {
    const shielded = (by: PlayerId) => immuneFrom(state, resume.sourceUid, by)
    const spell = `${heroTag(state, resume.sourceUid, display(resume.defId).name)}'s ability`
    if (state.silence && !shielded(state.silence.caster)) return log(state, `Global Silence stops ${spell}.`)
    if (abilitiesLocked(state, resume.actor) && !shielded(state.frost!.caster)) return log(state, `Shiva's Guard stops ${spell}.`)
    const orchid = state.players[resume.actor]?.orchid
    if (orchid && !shielded(orchid.caster)) return log(state, `Orchid stops ${spell}.`)
    const source = findHero(state, resume.sourceUid)
    if (source?.hero.muted) return log(state, `Orchid stops ${spell}.`)
    // Rubick Spell Steal: nullify that enemy hero's ability for the rest of the turn.
    if (state.spellNullify.some((entry) => entry.uid === resume.sourceUid)) {
      return log(state, `Spell Steal nullifies ${display(resume.defId).name}.`)
    }
  }
  if (!resume.armed) {
    const asked = questions(state, resume)
    if (asked.type === 'fizzle') {
      const about = display(resume.defId)
      return log(state, asked.text === 'No legal target.' ? `${about.spell ?? about.name} has no legal target.` : asked.text)
    }
    if (asked.type === 'ask') {
      return ask(state, { ...asked.q, prompt: withTargets(state, resume, asked.q.prompt), resume })
    }
    const pickedHeroes = heroIds(resume.picked)
    const pickedTeams = rawTeams(resume.picked)
    // Flaming Lasso moves traps without revealing — do not treat team picks as trap triggers.
    if (sourceKind(resume.defId) === 'ability' && resume.defId !== 'batrider') {
      state = noteTargets(state, resume.actor, pickedHeroes, pickedTeams)
    }
    const countered = refracts(state, resume.actor, pickedHeroes)
    if (countered.stopped) return countered.state
    let armed = { ...resume, armed: true }
    if (state.multicast === resume.sourceUid && !resume.echo) {
      state = {
        ...countered.state,
        multicast: null,
        echoes: [...countered.state.echoes, { ...armed, picked: [], steps: 0, armed: false, echo: true }],
      }
    } else {
      state = countered.state
    }
    resume = armed
    // Board abilities: choose targets first, then open Instant interrupt announcing those targets.
    if (firesAbility(resume.defId) && findHero(state, resume.sourceUid) && !resume.echo && !resume.windowed) {
      return offerInstantWindow(state, resume.sourceUid, { ...resume, windowed: true })
    }
  }
  const homeTeam = findHero(state, resume.sourceUid)
  if (
    !resume.juggPaid &&
    HERO_BY_ID[resume.defId] &&
    homeTeam?.team.blade &&
    homeTeam.team.blade.caster === homeTeam.hero.controller
  ) {
    const enemies = allLocs(state).filter((loc) => loc.hero.controller !== homeTeam.hero.controller)
    if (enemies.length > 0) {
      return ask(state, {
        actor: homeTeam.hero.controller,
        prompt: 'Blade Fury: destroy an enemy hero.',
        mode: 'pick',
        min: 1,
        max: 1,
        choices: enemies.map((loc) => ({
          id: `hero:${loc.hero.uid}`,
          label: display(loc.hero.defId).name,
          defId: loc.hero.defId,
        })),
        resume: { kind: 'jugg-kill', actor: homeTeam.hero.controller, after: { ...resume, juggPaid: true } },
      })
    }
  }
  // Crystal Maiden: draw when a hero on her team activates an ability.
  if (HERO_BY_ID[resume.defId] && !resume.echo) {
    state = arcaneAuraOnActivate(state, resume.sourceUid)
  }
  return announce(state, effect(state, resume), resume)
}

/**
 * Abilities log their bare title ("Epicenter."). Fold it into the play line right before it
 * ("Radiant plays Sand King — Epicenter.") or name the caster when it fires on its own.
 */
function announce(before: Game, after: Game, resume: CastResume): Game {
  const fresh = after.log.length - before.log.length
  if (fresh <= 0) return after
  const info = display(resume.defId)
  const titles = new Set([info.spell, info.name].filter((title): title is string => !!title).map((title) => `${title}.`))
  const start = before.log.length
  const at = after.log.findIndex((line, index) => index >= start && titles.has(line))
  if (at < 0) return after
  const lines = [...after.log]
  const title = lines[at]!.slice(0, -1)
  const playLine = new RegExp(`^.+ (plays|plays Instant) ${escapeRe(info.name)}\\.$`)
  let host = -1
  for (let index = at - 1; index >= Math.max(0, at - 4); index -= 1) {
    if (playLine.test(lines[index]!)) {
      host = index
      break
    }
  }
  if (host >= 0) {
    if (title !== info.name) lines[host] = `${lines[host]!.slice(0, -1)} — ${title}.`
    lines.splice(at, 1)
  } else if (HERO_BY_ID[resume.defId]) {
    lines[at] = `${heroTag(after, resume.sourceUid, info.name)}: ${title}.`
  } else {
    lines[at] = `${pname(after, resume.actor)}'s ${title}.`
  }
  return { ...after, log: lines }
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Arcane Aura — one draw per CM you control whenever any of your heroes activates. */
function arcaneAuraOnActivate(state: Game, sourceUid: string): Game {
  const source = findHero(state, sourceUid)
  if (!source) return state
  const controller = source.hero.controller
  if (aurasSuppressed(state, controller)) return state
  let next = state
  for (const loc of allLocs(state)) {
    if (loc.hero.defId !== 'crystal_maiden') continue
    if (loc.hero.controller !== controller) continue
    next = queueDraw(log(next, `Arcane Aura: ${pname(next, controller)} draws 1.`), controller, 1)
  }
  return next
}

const ATTR_CHOICES: { id: string; label: string }[] = [
  { id: 'attr:STR', label: 'Strength' },
  { id: 'attr:AGI', label: 'Agility' },
  { id: 'attr:INT', label: 'Intelligence' },
  { id: 'attr:UNI', label: 'Universal' },
]

function pickedAttr(picked: string[]): Attr | null {
  const raw = picked.find((id) => id.startsWith('attr:'))?.slice(5)
  if (raw === 'STR' || raw === 'AGI' || raw === 'INT' || raw === 'UNI') return raw
  return null
}

function askAttrHeroes(state: Game, resume: CastResume, controls: (id: PlayerId) => boolean): Ask {
  const actor = resume.actor
  const kind = sourceKind(resume.defId)
  const attr = pickedAttr(resume.picked)
  if (!attr) {
    const choices = ATTR_CHOICES.filter((choice) => {
      const wanted = pickedAttr([choice.id])
      return !!wanted && allLocs(state).some((loc) => controls(loc.hero.controller) && attrsOf(state, loc.hero).includes(wanted) && canTargetHero(state, actor, loc.hero, kind))
    })
    return pose(actor, 'Choose an attribute.', choices)
  }
  const taken = new Set(heroIds(resume.picked))
  for (const player of state.players) {
    if (!controls(player.id)) continue
    if ([...taken].some((uid) => findHero(state, uid)?.hero.controller === player.id)) continue
    const options = allLocs(state)
      .filter((loc) => loc.hero.controller === player.id && attrsOf(state, loc.hero).includes(attr) && canTargetHero(state, actor, loc.hero, kind))
      .map((loc) => ({ id: `hero:${loc.hero.uid}`, label: display(loc.hero.defId).name, defId: loc.hero.defId }))
    if (options.length === 0) continue
    return pose(actor, `Choose one ${ATTR_CHOICES.find((choice) => choice.id === `attr:${attr}`)?.label ?? attr} hero they control.`, options)
  }
  return ready()
}

function askAttrByTeam(state: Game, resume: CastResume, enemy: PlayerId): Ask {
  const actor = resume.actor
  const kind = sourceKind(resume.defId)
  const attr = pickedAttr(resume.picked)
  if (!attr) {
    const choices = ATTR_CHOICES.filter((choice) => {
      const wanted = pickedAttr([choice.id])
      return !!wanted && state.players[enemy].teams.some((team) => team.heroes.some((hero) => attrsOf(state, hero).includes(wanted) && canTargetHero(state, actor, hero, kind)))
    })
    return pose(actor, 'Choose an attribute.', choices)
  }
  const takenTeams = new Set(heroIds(resume.picked).map((uid) => findHero(state, uid)?.team.id).filter((id): id is string => !!id))
  for (const team of state.players[enemy].teams) {
    if (takenTeams.has(team.id)) continue
    const options = team.heroes
      .filter((hero) => attrsOf(state, hero).includes(attr) && canTargetHero(state, actor, hero, kind))
      .map((hero) => ({ id: `hero:${hero.uid}`, label: display(hero.defId).name, defId: hero.defId }))
    if (options.length === 0) continue
    return pose(actor, `Choose one ${ATTR_CHOICES.find((choice) => choice.id === `attr:${attr}`)?.label ?? attr} hero in this team.`, options)
  }
  return ready()
}

function questions(state: Game, resume: CastResume): Ask {
  const at = step(resume)
  const actor = resume.actor
  const kind = sourceKind(resume.defId)
  const enemy = foe(state, actor)
  const home = here(state, resume)

  switch (resume.defId) {
    case 'clockwerk':
      // Assignment is driven by limbo prompts inside clockwerkPeek / effect steps.
      if (state.limbo.length > 0 && at === 0) {
        return pose(actor, 'Put one card into your hand.', state.limbo.map((card) => ({
          id: `card:${card.uid}`,
          label: display(card.defId).name,
          defId: card.defId,
        })))
      }
      if (state.limbo.length > 0 && at === 1) {
        const left = state.limbo.filter((card) => !cardIds(resume.picked).includes(card.uid))
        return pose(actor, 'Put one on top of the deck (rest go to the grave).', left.map((card) => ({
          id: `top:${card.uid}`,
          label: display(card.defId).name,
          defId: card.defId,
        })))
      }
      return ready()
    case 'doom':
    case 'legion_commander':
    case 'night_stalker':
    case 'pudge':
    case 'slardar':
    case 'bloodseeker':
    case 'huskar':
    case 'jakiro':
    case 'juggernaut':
    case 'lina':
    case 'lion':
    case 'necrophos':
    case 'queen_of_pain':
    case 'vengeful_spirit':
    case 'viper':
    case 'bane':
    case 'dagon':
    case 'scythe':
    case 'gloves':
    case 'illusion':
    case 'faceless_void':
    case 'axe':
      if (
        resume.defId === 'axe' ||
        resume.defId === 'doom' ||
        resume.defId === 'bloodseeker' ||
        resume.defId === 'huskar' ||
        resume.defId === 'jakiro' ||
        resume.defId === 'juggernaut' ||
        resume.defId === 'viper' ||
        resume.defId === 'slardar' ||
        resume.defId === 'illusion'
      ) {
        return ready()
      }
      if (resume.defId === 'pudge' || resume.defId === 'lion') {
        if (at === 0) return pose(actor, 'Choose an opponent.', opponentChoices(state, actor))
        if (resume.defId === 'lion' && at === 1) {
          const target = pickedEnemy(state, resume, actor)
          const heroes = state.players[target]?.hand.filter((card) => card.kind === 'hero') ?? []
          if (heroes.length === 0) return fizzle('They have no hero in hand.')
          return pose(actor, "Exile a hero from the opponent's hand.", heroes.map((card) => ({
            id: `card:${card.uid}`,
            label: display(card.defId).name,
            defId: card.defId,
          })))
        }
        if (resume.defId === 'pudge' && at === 1) {
          const target = pickedEnemy(state, resume, actor)
          return pose(actor, 'Take control of an enemy hero.', enemyHeroes(state, actor, kind).filter((c) => findHero(state, c.id.slice(5))?.hero.controller === target))
        }
        return ready()
      }
      if (at > 0) return ready()
      if (
        resume.defId === 'night_stalker' ||
        resume.defId === 'queen_of_pain' ||
        resume.defId === 'bane' ||
        resume.defId === 'gloves' ||
        resume.defId === 'faceless_void'
      ) {
        return pose(actor, 'Choose an opponent.', opponentChoices(state, actor))
      }
      return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
    case 'anti_mage':
    case 'timbersaw':
      if (at > 0) return ready()
      return pose(actor, 'Choose an enemy team.', teamChoices(state, actor, kind, (_team, player) => player.id !== actor))
    case 'batrider': {
      if (at === 0) {
        const trapped = teamChoices(state, actor, kind, (team) => !!team.trap)
        if (trapped.length === 0) return fizzle('No traps on the board.')
        return pose(actor, 'Choose a team with a trap.', trapped)
      }
      if (at > 1) return ready()
      const fromId = rawTeams(resume.picked)[0]
      const from = fromId ? teamById(state, fromId) : null
      if (!from?.team.trap) return fizzle('That trap is gone.')
      // Cross-player only — never between two teams of the same seat.
      return pose(
        actor,
        'Move the trap onto another player\'s team.',
        teamChoices(state, actor, kind, (team, player) => {
          if (team.id === fromId || team.trap || team.mine) return false
          return player.id !== from.player.id && !trapBlock(state, team)
        }),
      )
    }
    case 'shadow_shaman':
    case 'broodmother':
      // Trap hero — on-play cast should not run; keep for reactivate edge cases.
      return ready()
    case 'sniper': {
      if (at > 0) return ready()
      const self = home ? teamSize(home.team) : 0
      const picks = enemyHeroes(state, actor, kind).filter((choice) => {
        const loc = findHero(state, choice.id.slice(5))
        return loc && teamSize(loc.team) > self
      })
      if (picks.length === 0) return fizzle('No enemy team is larger than Sniper\'s.')
      return pose(actor, 'Destroy a hero from a larger enemy team.', picks)
    }
    case 'greaves':
      if (at > 0) return ready()
      return pose(actor, 'Choose a player.', state.players.map((player) => ({
        id: `player:${player.id}`,
        label: player.name,
      })))
    case 'halberd':
      if (at > 0) return ready()
      return pose(actor, 'Choose an opponent.', opponentChoices(state, actor))
    case 'abyssal':
      if (at === 0) return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
      if (at > 1) return ready()
      return pose(actor, 'Put that hero on the top or the bottom of the deck.', [
        { id: 'deck:top', label: 'Top of the deck' },
        { id: 'deck:bottom', label: 'Bottom of the deck' },
      ])
    case 'orchid':
      if (at > 0) return ready()
      return pose(actor, 'Choose an opponent — they cannot activate abilities.', opponentChoices(state, actor))
    case 'shadow_blade':
      if (at > 0) return ready()
      return pose(actor, 'Choose a hero.', heroChoices(state, actor, kind, () => true))
    case 'bkb':
      if (at > 0) return ready()
      return pose(actor, 'Choose an allied team.', ownTeams(state, actor, false))
    case 'regen':
      if (graveLocked(state, actor)) return fizzle('Muerta keeps the grave shut.')
      if (at > 0) return ready()
      if (state.grave.length === 0) return fizzle('The grave is empty.')
      return pose(actor, 'Take a card from the grave.', state.grave.map((card) => ({
        id: `card:${card.uid}`,
        label: display(card.defId).name,
        defId: card.defId,
      })))
    case 'satanic':
      if (at === 0) return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
      if (at === 1) return pose(actor, 'Choose a team you control.', ownTeams(state, actor, true))
      if (at === 2) {
        const host = heroIds(resume.picked)[0]
        const asked = activateAsk(host ? findHero(state, host)?.hero.defId : undefined)
        return pose(actor, asked.prompt, yesNo(), 1, 1, 'pick', asked.about)
      }
      return ready()
    case 'tormentor':
    case 'stone_golem':
    case 'thunderhide':
    case 'roshan':
      return ready()
    case 'black_dragon':
      if (at > 0) return ready()
      return pose(actor, 'Choose an opponent to discard 1.', opponentChoices(state, actor))
    case 'ice_shaman':
      if (at > 0) return ready()
      return pose(actor, 'Return a hero to its owner\'s hand.', heroChoices(state, actor, kind, () => true))
    case 'earthshaker':
    case 'sven':
    case 'enigma':
    case 'rapier':
    case 'warlock':
    case 'winter_wyvern':
    case 'beastmaster':
    case 'puck':
    case 'medusa':
    case 'techies':
    case 'primal_beast':
      if (resume.defId === 'puck' || resume.defId === 'techies') return ready()
      if (resume.defId === 'primal_beast') return ready()
      if (at > 1 && (resume.defId === 'winter_wyvern' || resume.defId === 'beastmaster' || resume.defId === 'enigma')) return ready()
      if (at > 0 && resume.defId !== 'winter_wyvern' && resume.defId !== 'beastmaster' && resume.defId !== 'enigma') return ready()
      if (resume.defId === 'sven' && home && strengthCount(state, home.team) < 3) return fizzle("God's Strength needs 3 Strength heroes in this team.")
      if (resume.defId === 'winter_wyvern' || resume.defId === 'beastmaster') {
        if (at === 0) {
          return pose(actor, 'Choose an enemy team.', teamChoices(state, actor, kind, (_team, player) => player.id !== actor))
        }
        const teamId = rawTeams(resume.picked)[0]
        const found = teamId ? teamById(state, teamId) : null
        if (!found) return fizzle('That team is gone.')
        if (resume.defId === 'winter_wyvern') {
          if (found.team.heroes.length < 2) return fizzle("Winter's Curse needs two heroes.")
          return pose(found.player.id, 'Keep one hero. The rest are destroyed.', found.team.heroes.map((hero) => ({
            id: `hero:${hero.uid}`,
            label: display(hero.defId).name,
            defId: hero.defId,
          })))
        }
        return {
          type: 'ask',
          q: {
            actor,
            prompt: 'Assign each hero to group 1, 2, or 3.',
            mode: 'groups',
            min: found.team.heroes.length,
            max: found.team.heroes.length,
            choices: found.team.heroes.map((hero) => ({ id: hero.uid, label: display(hero.defId).name, defId: hero.defId })),
          },
        }
      }
      if (resume.defId === 'enigma') {
        // Collect one team per player that still has teams; ask only while picks remain needed.
        const needed = state.players.filter((player) => player.teams.length > 0).length
        if (at >= needed) return ready()
        const remaining = state.players.filter((player) => {
          if (player.teams.length === 0) return false
          return !rawTeams(resume.picked).some((id) => player.teams.some((team) => team.id === id))
        })
        const seat = remaining[0]
        if (!seat) return ready()
        return pose(
          actor,
          `Destroy a team controlled by ${pname(state, seat.id)}.`,
          teamChoices(state, actor, kind, (_team, player) => player.id === seat.id),
        )
      }
      if (resume.defId === 'earthshaker') {
        return pose(actor, 'Choose an enemy team of 4 or more.', teamChoices(state, actor, kind, (team, player) => player.id !== actor && teamSize(team) >= 4))
      }
      return pose(actor, 'Choose an enemy team.', teamChoices(state, actor, kind, (_team, player) => player.id !== actor))
    case 'snapfire': {
      if (at === 0) {
        const hand = handCards(state, actor)
        if (hand.length < 3) return fizzle('Mortimer Kisses needs 3 cards in hand.')
        return pose(actor, 'Exile 3 cards from your hand.', hand, 3, 3)
      }
      if (at > 1) return ready()
      if (graveLocked(state, actor)) return fizzle('Muerta keeps the grave shut.')
      const grave = state.grave.map((card) => ({
        id: `grave:${card.uid}`,
        label: display(card.defId).name,
        defId: card.defId,
      }))
      if (grave.length === 0) return fizzle('The grave is empty.')
      return pose(actor, 'Take up to 2 cards from the grave.', grave, 0, Math.min(2, grave.length))
    }
    case 'drow_ranger':
      if (at > 0) return ready()
      if (!home || rangedCount(state, home.team) < 3) return fizzle('Marksmanship needs 3 Ranged heroes in this team.')
      return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
    case 'gyrocopter':
      return askAttrHeroes(state, resume, (playerId) => playerId !== actor)
    case 'spectre': {
      if (at > 0) return ready()
      // One hero from each opponent
      const picks: Choice[] = []
      for (const id of opponents(state, actor)) {
        for (const choice of enemyHeroes(state, actor, kind).filter((c) => {
          const loc = findHero(state, c.id.slice(5))
          return loc?.hero.controller === id
        })) {
          picks.push({ ...choice, hint: pname(state, id) })
        }
      }
      const needed = opponents(state, actor).length
      if (needed === 0) return fizzle('No opponents.')
      return pose(actor, 'Destroy one hero from each opponent.', picks, needed, needed)
    }
    case 'tiny': {
      if (!home) return fizzle('Toss needs Tiny on a team.')
      if (at === 0) {
        const mates = home.team.heroes.filter((hero) => hero.uid !== resume.sourceUid)
        if (mates.length === 0) return fizzle('No other hero in this team to toss.')
        return pose(actor, 'Choose a hero in this team to toss.', mates.map((hero) => ({
          id: `hero:${hero.uid}`,
          label: display(hero.defId).name,
          defId: hero.defId,
        })))
      }
      if (at > 1) return ready()
      return pose(actor, 'Choose an enemy team.', teamChoices(state, actor, kind, (_team, player) => player.id !== actor))
    }
    case 'enchantress':
    case 'force_staff':
    case 'tusk':
      if (at === 0) {
        if (resume.defId === 'enchantress') {
          return pose(actor, 'Choose an enemy Strength hero.', enemyHeroes(state, actor, kind, (uid) => {
            const loc = findHero(state, uid)
            return !!loc && attrsOf(state, loc.hero).includes('STR')
          }))
        }
        return pose(actor, 'Choose a hero.', heroChoices(state, actor, kind, () => true))
      }
      if (at > 1) return ready()
      {
        const uid = heroIds(resume.picked)[0]
        const loc = uid ? findHero(state, uid) : null
        if (!loc) return fizzle('That hero is gone.')
        if (resume.defId === 'tusk') {
          const holder = loc.hero.controller
          const choices = teamChoices(state, actor, kind, (team, player) => player.id === holder && team.id !== loc.team.id)
          if (state.players[holder].teams.length < TEAM_CAP) {
            choices.push({ id: `new:${holder}`, label: `New team for ${pname(state, holder)}` })
          }
          return pose(actor, 'Choose another team its controller owns.', choices)
        }
        if (resume.defId === 'force_staff') {
          const choices = teamChoices(state, actor, kind, (team, player) => player.id === loc.hero.owner && team.id !== loc.team.id)
          if (state.players[loc.hero.owner].teams.length < TEAM_CAP) {
            choices.push({ id: `new:${loc.hero.owner}`, label: `New team for ${pname(state, loc.hero.owner)}` })
          }
          return pose(actor, 'Choose a team its owner controls.', choices)
        }
        const asked = activateAsk(loc.hero.defId)
        return pose(actor, asked.prompt, yesNo(), 1, 1, 'pick', asked.about)
      }
    case 'lifestealer':
      if (at === 0) return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
      if (at === 1) {
        const host = heroIds(resume.picked)[0]
        const asked = activateAsk(host ? findHero(state, host)?.hero.defId : undefined)
        return pose(actor, asked.prompt, yesNo(), 1, 1, 'pick', asked.about)
      }
      return ready()
    case 'blink': {
      if (heroPlayBanned(state, actor)) return fizzle("You cannot play hero cards (Heaven's Halberd).")
      if (at === 0) {
        const heroes = handCards(state, actor, (card) => card.kind === 'hero')
        if (heroes.length === 0) return fizzle('No hero in hand.')
        return pose(actor, 'Play a hero from your hand.', heroes)
      }
      if (at === 1) return pose(actor, 'Choose a team you control.', ownTeams(state, actor, true))
      if (at > 2) return ready()
      const played = cardIds(resume.picked)[0]
      const held = played ? state.players[actor]?.hand.find((card) => card.uid === played) : undefined
      const asked = activateAsk(held?.defId)
      return pose(actor, asked.prompt, yesNo(), 1, 1, 'pick', asked.about)
    }
    case 'tp_scroll':
      if (at === 0) return pose(actor, 'Choose a hero you control.', ownHeroes(state, actor, kind))
      if (at > 1) return ready()
      {
        const uid = heroIds(resume.picked)[0]
        const loc = uid ? findHero(state, uid) : null
        const choices = ownTeams(state, actor, true).filter((choice) => choice.id !== `team:${loc?.team.id}`)
        return pose(actor, 'Choose another team.', choices)
      }
    case 'io':
      if (at > 0) return ready()
      if (!home) return fizzle('Io is gone.')
      return pose(actor, 'Choose an allied hero to tether.', ownHeroes(state, actor, kind).filter((choice) => {
        const uid = choice.id.slice(5)
        return uid !== resume.sourceUid && findHero(state, uid)?.team.id !== home.team.id
      }))
    case 'hoodwink': {
      if (at > 0) return ready()
      if (terrainCount(state, actor, 'jungle') === 0) {
        return fizzle('Sharpshooter needs a Jungle terrain.')
      }
      const heroes = enemyHeroes(state, actor, kind)
      const combos: Choice[] = []
      for (const id of opponents(state, actor)) {
        for (const combo of state.players[id]!.combos) {
          if (comboLocked(state, combo.id)) continue
          combos.push({ id: `combo:${combo.id}`, label: `${pname(state, id)} · ${combo.kind} combo`, hint: `${combo.points} pts` })
        }
      }
      return pose(actor, 'Destroy an enemy hero or terrain combo.', [...heroes, ...combos])
    }
    case 'windranger': {
      if (at > 0) return ready()
      const combos: Choice[] = []
      for (const id of opponents(state, actor)) {
        for (const combo of state.players[id]!.combos) {
          if (comboLocked(state, combo.id)) continue
          combos.push({
            id: `combo:${combo.id}`,
            label: `${pname(state, id)} · ${combo.kind} combo`,
            hint: `${combo.points}`,
          })
        }
      }
      if (combos.length === 0) return fizzle('No enemy terrain combo to steal.')
      return pose(actor, 'Take control of an enemy terrain combo.', combos)
    }
    case 'treant_protector':
      return ready()
    case 'grimstroke': {
      if (at === 0) {
        const combos = state.players[actor].combos.filter((combo) => !comboLocked(state, combo.id))
        if (combos.length === 0) return fizzle('No terrain combo to sacrifice.')
        return pose(actor, 'Sacrifice a terrain combo.', combos.map((combo) => ({
          id: `combo:${combo.id}`,
          label: `${combo.kind} combo`,
          hint: `${combo.points}`,
        })))
      }
      if (at > 1) return ready()
      return pose(actor, 'Take control of an enemy team.', teamChoices(state, actor, kind, (_team, player) => player.id !== actor))
    }
    case 'earth_spirit': {
      if (at === 0) return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
      const uid = heroIds(resume.picked)[0]
      const loc = uid ? findHero(state, uid) : null
      if (!loc) return fizzle('That hero is gone.')
      if (at === 1) {
        const holder = loc.hero.controller
        const choices = teamChoices(state, actor, kind, (team, player) =>
          player.id === holder && team.id !== loc.team.id && !enterReason(state, team, heroWeight(loc.hero), loc.hero.token),
        )
        if (choices.length === 0) return fizzle(`${pname(state, holder)} has no other team to take it.`)
        return pose(actor, 'Send it to which of their teams?', choices)
      }
      if (at > 2) return ready()
      const dest = rawTeams(resume.picked)[0]
      const found = dest ? teamById(state, dest) : null
      if (!found) return fizzle('That team is gone.')
      const pool = [loc.hero, ...found.team.heroes]
      return pose(actor, 'Destroy a hero in that team.', pool.map((hero) => ({
        id: `kill:${hero.uid}`,
        label: display(hero.defId).name,
        defId: hero.defId,
      })))
    }
    case 'monkey_king':
    case 'disruptor':
    case 'shadow_demon':
    case 'oracle':
      if (resume.defId === 'disruptor') {
        if (at === 0) return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
        if (at > 1) return ready()
        return pose(actor, 'Top or bottom of the deck?', [
          { id: 'deck:top', label: 'Top of the deck' },
          { id: 'deck:bottom', label: 'Bottom of the deck' },
        ])
      }
      if (at > 0) return ready()
      if (resume.defId === 'oracle') return pose(actor, 'Choose an allied hero.', ownHeroes(state, actor, kind))
      if (resume.defId === 'monkey_king') return pose(actor, 'Choose a hero.', heroChoices(state, actor, kind, () => true))
      return pose(actor, 'Choose a hero.', resume.defId === 'shadow_demon'
        ? heroChoices(state, actor, kind, () => true)
        : enemyHeroes(state, actor, kind))
    case 'omniknight':
    case 'dazzle':
    case 'dawnbreaker':
    case 'shield':
      if (at > 0) return ready()
      if (resume.defId === 'dawnbreaker') {
        return pose(actor, 'Choose a hero to guard.', heroChoices(state, actor, kind, () => true))
      }
      return pose(actor, 'Choose a hero you own.', ownHeroes(state, actor, kind))
    case 'terrorblade':
      if (at === 0) return pose(actor, 'Choose a team you control.', ownTeams(state, actor, false))
      if (at > 1) return ready()
      return pose(actor, 'Choose an enemy team.', teamChoices(state, actor, kind, (_team, player) => player.id !== actor))
    case 'outworld_destroyer':
    case 'ringmaster':
    case 'zeus':
    case 'pangolier':
    case 'gem':
    case 'bounty_hunter':
    case 'ward':
      if (resume.defId === 'zeus') return ready()
      if (resume.defId === 'gem') {
        if (at === 0) {
          return pose(actor, 'Name a card.', [
            ...Object.keys(HERO_BY_ID).slice(0, 40).map((id) => ({ id: `name:${id}`, label: display(id).name, defId: id })),
            ...Object.keys(ITEM_BY_ID).map((id) => ({ id: `name:${id}`, label: display(id).name, defId: id })),
            { id: 'name:river', label: 'River' },
            { id: 'name:jungle', label: 'Jungle' },
            { id: 'name:lane', label: 'Lane' },
          ])
        }
        return ready()
      }
      if (resume.defId === 'ward') {
        const traps = teamChoices(state, actor, kind, (team) => !!team.trap)
        if (at === 0) {
          return pose(actor, 'Observer Ward: remove a trap or reveal a hand?', [
            ...(traps.length > 0 ? [{ id: 'mode:trap', label: 'Remove a trap' }] : []),
            { id: 'mode:hand', label: "Reveal an opponent's hand" },
          ])
        }
        if (at === 1) {
          if (resume.picked.includes('mode:trap')) return pose(actor, 'Remove the trap on which team?', traps)
          return pose(actor, 'Choose an opponent.', opponentChoices(state, actor))
        }
        if (at > 2 || resume.picked.includes('mode:trap')) return ready()
        const seen = pickedEnemy(state, resume, actor)
        return pose(actor, `${pname(state, seen)}'s hand.`, [...handCards(state, seen), { id: 'ok', label: 'Done' }], 1, 1, 'look')
      }
      if (resume.defId === 'bounty_hunter') {
        if (at > 0) return ready()
        return pose(actor, `${pname(state, enemy)}'s hand.`, [...handCards(state, enemy), { id: 'ok', label: 'Done' }], 1, 1, 'look')
      }
      if (resume.defId === 'pangolier') {
        if (at === 0) return pose(actor, 'Choose an opponent.', opponentChoices(state, actor))
        if (at === 1) {
          return pose(actor, 'Name a terrain.', [
            { id: 'set:river', label: 'River' },
            { id: 'set:jungle', label: 'Jungle' },
            { id: 'set:lane', label: 'Lane' },
          ])
        }
        if (at > 2) return ready()
        const target = pickedEnemy(state, resume, actor)
        const named = resume.picked.find((id) => id.startsWith('set:'))?.slice(4)
        const matches = handCards(state, target, (card) => card.defId === named)
        if (matches.length === 0) {
          return ready() // they lose next turn in effect
        }
        return pose(target, `Discard a ${named} terrain or lose your next turn.`, [
          ...matches,
          { id: 'skip', label: 'Lose next turn' },
        ])
      }
      if (resume.defId === 'outworld_destroyer') {
        const target = enemy
        const hand = state.players[target]?.hand ?? []
        if (hand.length >= 4) {
          if (at === 0) return pose(target, 'Discard 4 cards.', handCards(state, target), 4, 4)
          return ready()
        }
        if (at === 0) {
          return pose(actor, 'They cannot discard 4 — exile a team they control.', teamChoices(state, actor, kind, (_team, player) => player.id === target))
        }
        return ready()
      }
      if (resume.defId === 'ringmaster') {
        if (at === 0) {
          return pose(actor, 'Choose one.', [
            { id: 'mode:immune', label: 'Allied hero becomes immune' },
            { id: 'mode:reveal', label: 'Opponent reveals their hand' },
          ])
        }
        if (resume.picked.includes('mode:immune') && at === 1) {
          return pose(actor, 'Choose an allied hero.', ownHeroes(state, actor, kind))
        }
        if (resume.picked.includes('mode:reveal') && at === 1) {
          return pose(actor, 'Choose an opponent.', opponentChoices(state, actor))
        }
        if (resume.picked.includes('mode:reveal') && at === 2) {
          const target = pickedEnemy(state, resume, actor)
          return pose(actor, `${pname(state, target)}'s hand.`, [...handCards(state, target), { id: 'ok', label: 'Done' }], 1, 1, 'look')
        }
        return ready()
      }
      if (at > 0) return ready()
      return pose(actor, 'Choose an opponent.', opponentChoices(state, actor))
    case 'magnus_keep':
      return ready()
    case 'magnus': {
      if (at > 0) return ready()
      const pool = enemyHeroes(state, actor, kind)
      return pose(actor, 'Choose up to 5 heroes to gather into a new team.', pool, 1, Math.min(5, pool.length))
    }
    case 'rubick':
      if (at > 0) return ready()
      return pose(actor, 'Copy an enemy hero ability.', enemyHeroes(state, actor, kind, (uid) => {
        const loc = findHero(state, uid)
        return !!loc && loc.hero.defId !== 'rubick' && firesAbility(loc.hero.defId)
      }))
    case 'refresher':
      return ready()
    case 'keeper_of_the_light':
    case 'arcane':
      if (at > 0) return ready()
      return pose(actor, 'Choose a hero you own with an ability to cast.', ownHeroes(state, actor, kind).filter((choice) => {
        const loc = findHero(state, choice.id.slice(5))
        return !!loc && firesAbility(loc.hero.defId)
      }))
    case 'tinker':
      if (graveLocked(state, actor)) return fizzle('Muerta keeps the grave shut.')
      if (at === 0) return pose(actor, 'Choose an item in the grave.', state.grave.filter((card) => card.kind === 'item').map((card) => ({
        id: `card:${card.uid}`,
        label: display(card.defId).name,
        defId: card.defId,
      })))
      if (at > 1) return ready()
      return pose(actor, 'Cast that item now?', [{ id: 'yes', label: 'Cast it' }, { id: 'no', label: 'Keep it' }])
    case 'undying':
      return ready()
    case 'heart':
    case 'lotus':
      if (resume.defId === 'lotus') return ready()
      if (graveLocked(state, actor)) return fizzle('Muerta keeps the grave shut.')
      if (at > 0) return ready()
      return pose(actor, 'Choose a hero in the grave.', graveHeroes(state))
    case 'clinkz':
      return ready()
    case 'visage': {
      if (at === 0) {
        const hand = handCards(state, actor)
        return pose(actor, 'Discard up to 2 cards.', hand, 0, Math.min(2, hand.length))
      }
      if (at > 1) return ready()
      const n = cardIds(resume.picked).length
      if (n === 0) return ready()
      return pose(actor, `Destroy ${n} enemy hero(es).`, enemyHeroes(state, actor, kind), n, n)
    }
    case 'phoenix': {
      if (at === 0) {
        return pose(actor, 'Exile Phoenix to return an enemy team to the bottom of the deck?', [
          { id: 'exile:yes', label: 'Exile Phoenix' },
          { id: 'exile:no', label: 'Keep Phoenix' },
        ])
      }
      // Keep Phoenix — ability does nothing (no team bounce).
      if (resume.picked.includes('exile:no') || (resume.picked.includes('no') && !resume.picked.includes('exile:yes'))) {
        return ready()
      }
      if (at > 1) return ready()
      const foes = teamChoices(state, actor, kind, (_team, player) => player.id !== actor)
      if (foes.length === 0) return fizzle('No enemy team to return.')
      return pose(actor, 'Return an enemy team to the bottom of the deck.', foes)
    }
    case 'ember_spirit': {
      const lanes = terrainKinds(state, actor).size
      if (lanes === 0) return fizzle('Fire Remnant needs a terrain.')
      if (at === 0) {
        return pose(actor, `Move up to ${lanes} hero(es) you own.`, ownHeroes(state, actor, kind), 1, lanes)
      }
      if (at > 1) return ready()
      return pose(actor, 'Choose a destination team for each (same team).', ownTeams(state, actor, true))
    }
    case 'storm_spirit':
      if (at > 0) return ready()
      return pose(
        actor,
        'Discard up to 2 cards. Gain that many actions.',
        handCards(state, actor),
        0,
        Math.min(2, Math.max(0, state.players[actor].hand.length)),
      )
    case 'dragon_knight':
      return ready()
    case 'clarity':
      return ready()
    case 'euls':
      if (at > 0) return ready()
      return pose(actor, 'Set a hero aside.', heroChoices(state, actor, kind, () => true))
    case 'glyph':
      if (at > 0) return ready()
      return pose(actor, 'Choose an allied team.', ownTeams(state, actor, false))
    case 'gate':
      if (at > 0) return ready()
      return pose(actor, 'Move up to 5 heroes you own into a new team.', ownHeroes(state, actor, kind), 1, Math.min(5, ownHeroes(state, actor, kind).length))
    case 'underlord':
      if (at > 0) return ready()
      if (!home) return fizzle('Dark Rift needs Underlord on a team.')
      return pose(actor, 'Move this whole team to another team you control.', ownTeams(state, actor, true).filter((choice) => choice.id !== `team:${home.team.id}`))
    case 'lich': {
      if (at > 0) return ready()
      const pool = ownHeroes(state, actor, kind)
      if (pool.length === 0) return fizzle('Chain Frost needs a hero to sacrifice.')
      return pose(actor, 'Sacrifice a hero.', pool)
    }
    case 'dark_willow': {
      const foes = opponents(state, actor)
      if (at >= foes.length) return ready()
      const target = foes[at]!
      const pool = ownHeroes(state, target, kind)
      if (pool.length === 0) return ready()
      return pose(target, 'Sacrifice a hero.', pool)
    }
    case 'sand_king': {
      // Sequential per opponent: discard a hand hero, else destroy a board hero.
      const foes = opponents(state, actor)
      if (at >= foes.length) return ready()
      const target = foes[at]!
      const handHeroes = handCards(state, target, (card) => card.kind === 'hero')
      if (handHeroes.length > 0) {
        return pose(target, 'Discard a hero card.', handHeroes)
      }
      const board = ownHeroes(state, target, 'ability')
      if (board.length === 0) return ready()
      return pose(target, 'Destroy one hero you control.', board)
    }
    case 'tidehunter': {
      const taken = new Set(rawTeams(resume.picked))
      for (const id of opponents(state, actor)) {
        if (state.players[id]!.teams.some((team) => taken.has(team.id))) continue
        const choices = teamChoices(state, actor, kind, (_team, player) => player.id === id)
        if (choices.length === 0) continue
        let prompt = `Choose ${pname(state, id)}'s team.`
        if (choices.length === 1) {
          const note = announceTargets(state, { ...resume, picked: [...resume.picked, choices[0]!.id] })
          if (note) prompt = `${prompt} Target: ${note}.`
        }
        return pose(actor, prompt, choices)
      }
      return ready()
    }
    case 'razor':
      if (at > 0) return ready()
      return pose(actor, 'Exile an enemy hero.', enemyHeroes(state, actor, kind))
    case 'morphling':
      if (at > 0) return ready()
      return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
    default:
      return ready()
  }
}

function effect(state: Game, resume: CastResume): Game {
  const actor = resume.actor
  const enemy = pickedEnemy(state, resume, actor)
  const heroes = heroIds(resume.picked)
  const teams = rawTeams(resume.picked)
  const cards = cardIds(resume.picked)
  const home = here(state, resume)
  const stamp = { caster: actor, fromTurn: state.turn }

  const kill = (current: Game, uid: string, cause: string, force = false) =>
    enqueue(current, uid, cause, force, true, actor, resume.sourceUid)

  switch (resume.defId) {
    case 'axe':
      return log({ ...state, noDraw: stamp }, "Berserker's Call: opponents cannot draw.")
    case 'chaos_knight': {
      let next = log(state, 'Chaos Bolt.')
      for (const player of next.players) {
        next = queueDiscard(next, player.id, Math.floor(player.hand.length / 2), 'Chaos Bolt')
      }
      return next
    }
    case 'natures_prophet':
      return spray(state, resume)
    case 'snapfire':
      return snapfireEffect(state, resume)
    case 'gyrocopter':
    case 'spectre':
      return heroes.reduce((current, uid) => kill(current, uid, display(resume.defId).name), state)
    case 'clockwerk':
      return clockwerkPeek(state, actor, resume)
    case 'batrider': {
      const fromId = teams[0] ?? rawTeams(resume.picked)[0]
      const toId = teams[1] ?? rawTeams(resume.picked)[1]
      const from = fromId ? teamById(state, fromId) : null
      const to = toId ? teamById(state, toId) : null
      if (!from?.team.trap || !to || to.team.trap || to.team.mine || trapBlock(state, to.team)) return state
      const trap = from.team.trap
      let next = updateTeam(state, fromId!, (team) => ({ ...team, trap: null }))
      next = updateTeam(next, toId!, (team) => ({ ...team, trap }))
      return log(next, `Flaming Lasso moves ${display(trap.defId).name}.`)
    }
    case 'doom':
      return log(state, 'Doom is an aura.')
    case 'scythe':
      return exileBoard(state, heroes[0], actor)
    case 'earth_spirit': {
      const uid = heroes[0]
      const dest = teams[0]
      const victim = resume.picked.find((id) => id.startsWith('kill:'))?.slice(5)
      const loc = uid ? findHero(state, uid) : null
      if (!loc || !dest) return state
      let next = moveOnto(state, loc.hero.uid, loc.hero.controller, dest, { by: actor })
      if (victim && findHero(next, victim)) next = kill(next, victim, 'Boulder Smash')
      return log(next, 'Boulder Smash.')
    }
    case 'disruptor':
      return toDeck(state, heroes[0], resume.picked.includes('deck:bottom') ? 'bottom' : 'top', actor)
    case 'earthshaker':
    case 'sven':
      if (!teams[0]) return state
      return destroyTeam(state, teams[0], display(resume.defId).name, actor, false)
    case 'enigma':
      return teams.reduce((current, teamId) => destroyTeam(current, teamId, 'Black Hole', actor, false), state)
    case 'kunkka':
      return startKunkka(state, actor)
    case 'largo': {
      const teams = state.players[actor]?.teams.length ?? 0
      return queueDraw(log(state, `Catchy Lilt draws ${teams}.`), actor, teams)
    }
    case 'legion_commander': {
      const target = heroes[0]
      if (!target) return state
      const self = here(state, resume)
      const foeLoc = findHero(state, target)
      if (!self || !foeLoc) return state
      if (teamSize(self.team) <= teamSize(foeLoc.team)) {
        return log(state, 'Duel fails — Legion Commander needs the larger team.')
      }
      if (immuneFrom(state, target, actor)) return log(state, immuneNote(state, target))
      const removed = removeHero(state, target)
      if (!removed.hero) return state
      const card = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' as const }
      return log(addHand(removed.state, actor, [card]), 'Duel: take the hero into your hand.')
    }
    case 'lifestealer':
      return infestHost(state, resume, heroes[0])
    case 'night_stalker':
      return stealRandom(state, enemy, actor, 2)
    case 'ogre_magi':
      return log(state, 'Multicast waits face down.')
    case 'omniknight':
      return log(state, 'Guardian Angel is an aura.')
    case 'phoenix': {
      const exile =
        resume.picked.includes('exile:yes')
        || (resume.picked.includes('yes') && !resume.picked.includes('exile:no'))
      if (!exile) return log(state, 'Supernova passes — Phoenix stays.')
      state = exileBoard(state, resume.sourceUid, actor)
      const teamId = teams[0]
      if (!teamId) return log(state, 'Supernova — Phoenix is exiled.')
      const found = teamById(state, teamId)
      if (!found) return log(state, 'Supernova — Phoenix is exiled.')
      let next = log(state, 'Supernova.')
      for (const hero of [...found.team.heroes]) {
        next = toDeck(next, hero.uid, 'bottom', actor)
      }
      return next
    }
    case 'shadow_shaman':
      if (!resume.picked.includes('yes')) return log(state, 'Shackles passes.')
      if (heroes[0]) state = kill(state, heroes[0], 'Shackles')
      return kill(state, resume.sourceUid, 'Shackles')
    case 'dragon_knight':
      return dragonKnightReveal(state, actor)
    case 'primal_beast':
      state = setPlayer(state, actor, (player) => ({ ...player, noHeroNow: true, noHeroNext: true }))
      return log({ ...state, primalItems: stamp }, 'Uproar: items play as instants; no heroes until your next turn.')
    case 'pudge': {
      if (!heroes[0]) return state
      const loc = findHero(state, heroes[0])
      if (!loc || !home) return state
      state = moveOnto(state, heroes[0], actor, home.team.id)
      return queueDiscard(log(state, 'Meat Hook.'), loc.hero.controller, 1, 'Meat Hook')
    }
    case 'slardar': {
      const rivers = terrainCount(state, actor, 'river')
      return queueDraw(log(state, `Corrosive Haze draws ${rivers}.`), actor, rivers)
    }
    case 'spirit_breaker':
      return log(state, 'Charge of Darkness waits for an enemy ability.')
    case 'tidehunter': {
      const note = announceTargets(state, resume)
      let next = log(state, note ? `Ravage targets ${note}.` : 'Ravage.')
      // One team per enemy — prefer picked teams, else each opponent's first team.
      const picked = new Set(teams)
      for (const id of opponents(state, actor)) {
        const chosen =
          [...picked].map((teamId) => teamById(next, teamId)).find((found) => found?.player.id === id)?.team ??
          next.players[id]!.teams[0]
        if (chosen) {
          for (const hero of [...chosen.heroes]) next = bounce(next, hero.uid, 'Ravage', false, actor)
        }
        next = queueDiscard(next, id, 5, 'Ravage')
      }
      return next
    }
    case 'timbersaw': {
      const teamId = teams[0]
      if (!teamId) return state
      return allLocs(state)
        .filter((loc) => loc.team.id === teamId && attrsOf(state, loc.hero).includes('STR'))
        .reduce((current, loc) => kill(current, loc.hero.uid, 'Whirling Death'), log(state, 'Whirling Death.'))
    }
    case 'tiny':
      return tinyToss(state, resume)
    case 'blink':
      return blinkPlay(state, resume)
    case 'force_staff':
    case 'tp_scroll':
    case 'tusk':
      return relocate(state, resume)
    case 'io': {
      const uid = heroes[0]
      if (!uid || !home) return state
      let next = state
      if (findHero(next, uid)?.team.id !== home.team.id) next = moveOnto(next, uid, actor, home.team.id)
      if (findHero(next, uid)?.team.id !== home.team.id) return log(next, 'Tether cannot pull them in.')
      next = editFlag(next, uid, (hero) => ({ ...hero, tether: next.turn }))
      return log(next, 'Tether: they cannot be destroyed this turn.')
    }
    case 'underlord': {
      if (!home || !teams[0]) return state
      let next = state
      for (const hero of [...home.team.heroes]) next = moveOnto(next, hero.uid, actor, teams[0])
      return log(next, 'Dark Rift.')
    }
    case 'enchantress': {
      if (!heroes[0] || !home) return state
      const loc = findHero(state, heroes[0])
      if (!loc) return state
      const weight = heroWeight(loc.hero)
      const joinBlocked = enterReason(state, home.team, weight, loc.hero.token)
      const dest = joinBlocked ? 'new' : home.team.id
      let next = moveOnto(state, heroes[0], actor, dest, { takeControl: true })
      const landed = findHero(next, heroes[0])
      if (!landed || landed.hero.controller !== actor) {
        return log(next, joinBlocked ? `Enchant fails — ${joinBlocked}` : 'Enchant fails.')
      }
      next = log(next, `Enchant: ${display(loc.hero.defId).name} joins ${pname(next, actor)}.`)
      if (!resume.picked.includes('yes')) return next
      if (next.stolenCast) return log(next, 'Stolen abilities cannot chain.')
      if (!firesAbility(loc.hero.defId)) return next
      next = cast({ ...next, stolenCast: true }, {
        kind: 'cast',
        actor,
        sourceUid: heroes[0],
        defId: loc.hero.defId,
        picked: [],
        steps: 0,
      })
      return { ...next, stolenCast: false }
    }
    case 'ember_spirit': {
      const dest = teams[0]
      if (!dest) return state
      let next = log(state, 'Fire Remnant.')
      for (const uid of heroes) next = moveOnto(next, uid, actor, dest)
      return next
    }
    case 'treant_protector':
      return log(state, 'Living Armor is an aura.')
    case 'undying':
      return log(state, 'Flesh Golem is an aura.')
    case 'heart': {
      const uid = cards[0]
      state = fromGrave(state, actor, uid)
      if (uid) state = { ...state, freePlay: [...state.freePlay, uid] }
      return log(state, 'Heart of Tarrasque: play that hero free this turn.')
    }
    case 'lotus': {
      const room = state.players[actor].handLimit - state.players[actor].hand.length
      return queueDraw(log(state, 'Lotus of Purification.'), actor, Math.max(0, room))
    }
    case 'anti_mage': {
      const teamId = teams[0]
      if (!teamId) return state
      return allLocs(state)
        .filter((loc) => loc.team.id === teamId && attrsOf(state, loc.hero).includes('INT'))
        .reduce((current, loc) => kill(current, loc.hero.uid, 'Mana Void'), log(state, 'Mana Void.'))
    }
    case 'sniper':
      if (!heroes[0]) return state
      return kill(state, heroes[0], 'Assassinate')
    case 'drow_ranger':
    case 'dagon':
      if (!heroes[0]) return state
      state = kill(state, heroes[0], display(resume.defId).name)
      if (resume.defId === 'dagon') state = queueDraw(state, actor, 1)
      return state
    case 'tormentor':
      return log(state, 'Tormentor waits on the board.')
    case 'stone_golem':
      return log(state, 'Granite Form: Stone Golem is immune to ability effects.')
    case 'thunderhide':
      return queueDraw(log(state, 'Static Charge draws 1.'), actor, 1)
    case 'black_dragon': {
      const target = pickedEnemy(state, resume, actor)
      return queueDiscard(log(state, `Fireball: ${pname(state, target)} discards 1.`), target, 1, 'Fireball')
    }
    case 'ice_shaman': {
      const uid = heroes[0]
      if (!uid) return state
      return bounce(state, uid, 'Frost Bind', false, actor)
    }
    case 'roshan':
      return log({ ...state, silence: stamp }, 'Roshan silences opponents — they cannot activate abilities until your next turn.')

    case 'bloodseeker':
      return log({ ...state, rupture: stamp }, 'Rupture: leavers are destroyed until your next turn.')
    case 'huskar': {
      let next = log(state, "Berserker's Blood: opponents cannot play heroes.")
      for (const id of opponents(next, actor)) {
        next = setPlayer(next, id, (player) => ({ ...player, noHeroNow: true, noHeroNext: true }))
      }
      return next
    }
    case 'juggernaut': {
      if (!home) return state
      return log(updateTeamTimed(state, home.team.id, 'blade', stamp), 'Blade Fury.')
    }
    case 'ward':
      if (resume.picked.includes('mode:trap')) {
        const teamId = teams[0]
        const found = teamId ? teamById(state, teamId) : null
        if (!found?.team.trap) return state
        const trap = found.team.trap
        const next = updateTeam(state, found.team.id, (team) => ({ ...team, trap: null }))
        return log(toGrave(next, { uid: trap.uid, defId: trap.defId, kind: 'hero' }, { type: 'deck' }), 'Observer Ward removes a trap unrevealed.')
      }
      return log({ ...state, reveal: [...state.reveal, { viewer: actor, target: enemy, turn: state.turn }] }, `${pname(state, actor)} sees ${pname(state, enemy)}'s hand.`)
    case 'bounty_hunter':
      return log({ ...state, reveal: [...state.reveal, { viewer: actor, target: enemy, turn: state.turn }] }, `${pname(state, actor)} sees ${pname(state, enemy)}'s hand.`)
    case 'broodmother':
      return log(state, 'Spin Web waits face down.')
    case 'clinkz':
      return clinkzExile(state)
    case 'faceless_void':
      return log(setPlayer(state, enemy, (player) => ({ ...player, actions: 0 })), 'Chronosphere: they lose remaining actions.')
    case 'hoodwink':
      return shoot(state, resume)
    case 'lone_druid':
      return grantFreePlay(topReward({ ...state, active: actor }, 'towers'), actor)
    case 'chen':
      return grantFreePlay(topReward({ ...state, active: actor }, 'neutrals'), actor)
    case 'arc_warden':
      return grantFreePlay(topReward({ ...state, active: actor }, 'runes'), actor)
    case 'medusa': {
      const teamId = teams[0]
      if (!teamId) return state
      const found = teamById(state, teamId)
      if (!found) return state
      const pack: CardInst[] = []
      let next = state
      for (const hero of [...found.team.heroes]) {
        if (immuneFrom(next, hero.uid, actor)) {
          next = log(next, immuneNote(next, hero.uid))
          continue
        }
        const removed = removeHero(next, hero.uid)
        if (!removed.hero) continue
        const card = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' as const }
        pack.push(card)
        next = toExile(removed.state, card)
      }
      return log(
        {
          ...next,
          medusaHold: [...next.medusaHold, { medusaUid: resume.sourceUid, owner: found.player.id, cards: pack }],
        },
        'Stone Gaze exiles the team.',
      )
    }
    case 'mirana':
      return arrow(state, resume)
    case 'monkey_king':
      return strike(state, heroes[0], actor)
    case 'morphling':
      return imprison(state, resume, heroes[0])
    case 'razor':
      return staticLink(state, resume)
    case 'naga_siren':
      return log({ ...state, naga: stamp }, 'Song of the Siren. Heroes cannot be destroyed.')
    case 'shadow_fiend':
      return state
    case 'troll_warlord':
      return log(state, 'Battle Trance is an aura.')
    case 'terrorblade':
      return sunder(state, teams[0], teams[1], actor)
    case 'vengeful_spirit':
      return netherSwap(state, resume.sourceUid, heroes[0])
    case 'viper':
      return log(state, 'Nethertoxin is an aura.')
    case 'weaver':
      return timeLapse(log(state, 'Time Lapse.'), actor)
    case 'crystal_maiden':
      return log(state, 'Arcane Aura is an aura.')
    case 'dark_seer':
      return log({ ...state, darkSeer: { actor, turn: state.turn } }, 'Vacuum: take control of destroyed enemies this turn.')
    case 'dark_willow': {
      // heroes[] may contain one sacrifice per opponent from sequential asks.
      let next = log(state, 'Terrorize.')
      if (heroes.length > 0) {
        for (const uid of heroes) next = kill(next, uid, 'Terrorize')
        return next
      }
      for (const id of opponents(state, actor)) {
        const pool = allLocs(next).filter((loc) => loc.hero.controller === id)
        const [rolled, pick] = randomFrom(next, pool)
        next = rolled
        if (pick) next = kill(next, pick.hero.uid, 'Terrorize')
      }
      return next
    }
    case 'grimstroke': {
      const comboId = resume.picked.find((id) => id.startsWith('combo:'))?.slice(6)
      const teamId = teams[0]
      if (!comboId || !teamId) return state
      let next = removeCombo(state, comboId)
      const found = teamById(next, teamId)
      if (!found) return next
      // Take control: move all heroes to actor's new/existing control by flipping controllers onto actor's seat team.
      const [seated, dest] = seatTeam(next, actor)
      next = seated
      for (const hero of [...found.team.heroes]) next = moveOnto(next, hero.uid, actor, dest)
      return log(next, 'Soulbind steals the team.')
    }
    case 'invoker':
      state = state.players.reduce((current, player) => dump(current, player.id), log(state, 'Cataclysm.'))
      return state.players.reduce((current, player) => queueDraw(current, player.id, 3), state)
    case 'jakiro':
      return log({ ...state, taxAction: stamp }, 'Ice Path: opponents lose an action until your next turn.')
    case 'keeper_of_the_light':
    case 'arcane':
      return recast(state, actor, heroes[0])
    case 'refresher':
      return log({ ...state, extraTurn: actor }, 'Refresher Orb: take another turn after this.')
    case 'leshrac':
      return nova(state, actor)
    case 'lich': {
      if (heroes[0]) state = kill(state, heroes[0], 'Chain Frost')
      return queueDraw(log(state, 'Chain Frost draws 5.'), actor, 5)
    }
    case 'lina':
      if (!heroes[0]) return state
      return kill(state, heroes[0], 'Laguna Blade', true)
    case 'lion':
      return exileHand(state, enemy, cards[0])
    case 'necrophos': {
      if (!heroes[0]) return state
      const loc = findHero(state, heroes[0])
      const attrs = loc ? attrsOf(state, loc.hero) : []
      state = exileBoard(state, heroes[0], actor)
      if (attrs[0]) {
        state = {
          ...state,
          attrBan: { attr: attrs[0], caster: actor, sourceUid: resume.sourceUid },
        }
        state = log(state, `Reaper's Scythe bans ${attrs[0]} while Necrophos remains.`)
      }
      return state
    }
    case 'oracle': {
      if (!heroes[0]) return state
      if (immuneFrom(state, heroes[0], actor)) return log(state, immuneNote(state, heroes[0]))
      const loc = findHero(state, heroes[0])
      if (!loc) return state
      const removed = removeHero(state, heroes[0])
      if (!removed.hero) return state
      return log(
        {
          ...removed.state,
          phased: [
            ...removed.state.phased,
            { hero: removed.hero, teamId: loc.team.id, owner: loc.hero.owner, fromTurn: state.turn },
          ],
        },
        'False Promise: the hero is exiled until your next turn.',
      )
    }
    case 'outworld_destroyer': {
      if (cards.length >= 4) {
        let next = log(state, "Sanity's Eclipse.")
        for (const uid of cards.slice(0, 4)) next = discardUid(next, enemy, uid)
        return next
      }
      if (teams[0]) return exileTeam(state, teams[0], "Sanity's Eclipse", actor)
      return state
    }
    case 'puck':
      return log(state, 'Dream Coil is an aura.')
    case 'visage':
      return visageSoul(state, resume)
    case 'queen_of_pain':
      return dump(log(state, 'Sonic Wave.'), enemy)
    case 'ringmaster':
      if (resume.picked.includes('mode:immune') && heroes[0]) {
        return log(editFlag(state, heroes[0], (hero) => ({ ...hero, bkb: stamp })), 'Wheel of Wonder: immune.')
      }
      if (resume.picked.includes('mode:reveal')) {
        return log({ ...state, reveal: [...state.reveal, { viewer: actor, target: enemy, turn: state.turn }] }, 'Wheel of Wonder reveals a hand.')
      }
      return state
    case 'rubick':
      return stealSpell(state, actor, resume.sourceUid, heroes[0])
    case 'shadow_demon': {
      if (!heroes[0]) return state
      if (immuneFrom(state, heroes[0], actor)) return log(state, immuneNote(state, heroes[0]))
      const removed = removeHero(state, heroes[0])
      if (!removed.hero) return state
      const card = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' as const }
      return log(
        editFlag(removed.state, resume.sourceUid, (hero) => ({
          ...hero,
          held: { card, owner: actor, mode: 'razor', takenTurn: state.turn },
        })),
        'Disruption exiles the hero.',
      )
    }
    case 'silencer':
      return log({ ...state, silence: stamp }, 'Global Silence.')
    case 'skywrath_mage':
      return queueDiscard(log(state, 'Mystic Flare.'), enemy, home ? intelCount(state, home.team) : 1, 'Mystic Flare')
    case 'storm_spirit': {
      const discarded = Math.min(2, cards.length)
      let next = state
      for (const uid of cards.slice(0, discarded)) next = discardUid(next, actor, uid)
      return log(setPlayer(next, actor, (player) => ({ ...player, actions: player.actions + discarded })), `Ball Lightning grants ${discarded} actions.`)
    }
    case 'tinker':
      return rearm(state, resume, cards[0])
    case 'warlock':
      if (!teams[0]) return state
      return log(
        { ...state, bonds: [...state.bonds, { teamId: teams[0], fromTurn: state.turn, caster: actor }] },
        'Fatal Bonds.',
      )
    case 'winter_wyvern':
      return curse(state, teams[0], heroes[0], actor)
    case 'witch_doctor':
      return log({ ...state, maledict: [...state.maledict, { player: enemy, turn: state.turn }] }, 'Maledict.')
    case 'zeus':
      return clearAllTraps(state, "Thundergod's Wrath")
    case 'bane':
      return log(setPlayer(state, enemy, (player) => ({ ...player, skip: true })), `${pname(state, enemy)} will skip their next turn.`)
    case 'beastmaster':
      return splitTeam(state, resume)
    case 'dazzle':
    case 'shadow_blade':
    case 'shield':
      if (!heroes[0]) return state
      if (resume.defId === 'shield') return log(editFlag(state, heroes[0], (hero) => ({ ...hero, shield: stamp })), 'Shield.')
      if (resume.defId === 'shadow_blade') return log(editFlag(state, heroes[0], (hero) => ({ ...hero, hidden: stamp })), 'Shadow Blade.')
      return log(editFlag(state, heroes[0], (hero) => ({ ...hero, ward: stamp })), 'Shallow Grave.')
    case 'dawnbreaker':
      if (!heroes[0]) return state
      return log(editFlag(state, heroes[0], (hero) => ({ ...hero, dawn: { caster: actor, turn: state.turn } })), 'Solar Guardian.')
    case 'marci':
      return startIo(state, actor)
    case 'magnus':
      return polarity(state, enemy, heroes, actor)
    case 'sand_king': {
      // Picks may include card: (hand hero discards) and hero: (board destroys).
      let next = log(state, 'Epicenter.')
      for (const uid of cards) {
        const owner = next.players.find((player) => player.hand.some((card) => card.uid === uid))?.id
        if (owner === undefined) continue
        next = discardUid(next, owner, uid)
      }
      for (const uid of heroes) next = kill(next, uid, 'Epicenter')
      return next
    }
    case 'techies':
      return log(state, 'Techies is a trap — it does not fire on play.')
    case 'void_spirit':
      return swapHands(state, actor, enemy)
    case 'windranger':
      return stealCombo(state, resume, actor)
    case 'haste': {
      let next = log(state, 'Haste Rune.')
      for (const id of opponents(state, actor)) next = stealRandom(next, id, actor, 1)
      return next
    }
    case 'regen': {
      const uid = cards[0]
      if (!uid) return state
      const card = state.grave.find((entry) => entry.uid === uid)
      if (!card) return state
      return log(addHand({ ...state, grave: state.grave.filter((entry) => entry.uid !== uid) }, actor, [card]), 'Regeneration Rune.')
    }
    case 'double_damage':
      return log({ ...state, freeItems: Math.max(state.freeItems, 2) }, 'Amplify Rune: play up to 2 items for free.')
    case 'clarity':
      return clarityDig(state, actor)
    case 'gloves':
      return stealRandom(state, enemy, actor, 1)
    case 'pangolier': {
      const target = enemy
      const named = resume.picked.find((id) => id.startsWith('set:'))?.slice(4)
      if (resume.picked.includes('skip') || !named) {
        return log(setPlayer(state, target, (player) => ({ ...player, skip: true })), 'Swashbuckle: they lose their next turn.')
      }
      const uid = cards[0]
      if (uid) return discardUid(log(state, 'Swashbuckle: terrain discarded.'), target, uid)
      return log(setPlayer(state, target, (player) => ({ ...player, skip: true })), 'Swashbuckle: they lose their next turn.')
    }
    case 'abyssal': {
      const where = resume.picked.includes('deck:bottom') ? 'bottom' : 'top'
      state = toDeck(state, heroes[0], where, actor)
      return queueDraw(state, actor, 1)
    }
    case 'orchid': {
      const target = pickedEnemy(state, resume, actor)
      return log(
        setPlayer(state, target, (player) => ({ ...player, orchid: stamp })),
        `Orchid: ${pname(state, target)} cannot activate abilities.`,
      )
    }
    case 'bkb':
      if (!teams[0]) return state
      return log(updateTeamTimed(state, teams[0], 'glyph', stamp), 'Black King Bar.')
    case 'assault':
      return log(setPlayer(state, actor, (player) => ({ ...player, actions: player.actions + 2 })), 'Assault Cuirass grants 2 actions.')
    case 'shivas':
      return shivas(state, actor, stamp)
    case 'halberd':
      return log(setPlayer(state, enemy, (player) => ({ ...player, noHeroNext: true })), "Heaven's Halberd.")
    case 'greaves':
      return greaves(state, resume)
    case 'satanic':
      return satanic(state, resume)
    case 'euls':
      return eul(state, heroes[0], actor)
    case 'glyph':
      if (!teams[0]) return state
      return log(updateTeamTimed(state, teams[0], 'glyph', stamp), 'Glyph.')
    case 'gate':
      return gateNewTeam(state, resume)
    case 'rapier': {
      if (!teams[0]) return state
      let next = destroyTeam(state, teams[0], 'Divine Rapier', actor, false)
      // Pull the played Rapier out of the grave (if present) and tuck it under the deck.
      const idx = next.grave.findIndex((card) => card.defId === 'rapier')
      if (idx >= 0) {
        const card = next.grave[idx]!
        next = { ...next, grave: next.grave.filter((_, i) => i !== idx), deck: [...next.deck, card] }
      }
      return log(next, 'Divine Rapier returns to the bottom of the deck.')
    }
    case 'illusion':
      return log(state, 'Illusion Rune is used as a counter.')
    case 'gem': {
      const named = resume.picked.find((id) => id.startsWith('name:'))?.slice(5)
      if (!named) return state
      let next = log(state, `Gem of True Sight names ${display(named).name}.`)
      const reveals = [...next.reveal]
      for (const id of opponents(state, actor)) {
        reveals.push({ viewer: actor, target: id, turn: next.turn })
        const hits = next.players[id]!.hand.filter((card) => card.defId === named)
        for (const card of hits) next = give(next, id, actor, card.uid)
      }
      return { ...next, reveal: reveals }
    }
    default:
      return log(state, `${display(resume.defId).name} is already at work.`)
  }
}

function controllerOf(state: Game, uid: string): PlayerId | null {
  return findHero(state, uid)?.hero.controller ?? null
}

function editFlag(state: Game, uid: string, fn: (hero: NonNullable<ReturnType<typeof findHero>>['hero']) => NonNullable<ReturnType<typeof findHero>>['hero']): Game {
  const loc = findHero(state, uid)
  if (!loc) return state
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      teams: player.teams.map((team) => ({
        ...team,
        heroes: team.heroes.map((hero) => (hero.uid === uid ? fn(hero) : hero)),
      })),
    })) as Game['players'],
  }
}

function updateTeamTimed(
  state: Game,
  teamId: string,
  key: 'noEnter' | 'noLeave' | 'glyph' | 'blade',
  value: Game['silence'],
): Game {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      teams: player.teams.map((team) => (team.id === teamId ? { ...team, [key]: value } : team)),
    })) as Game['players'],
  }
}

function destroyTeam(state: Game, teamId: string, cause: string, by: PlayerId, force: boolean): Game {
  const found = teamById(state, teamId)
  if (!found) return state
  return found.team.heroes.reduce((current, hero) => enqueue(current, hero.uid, cause, force, true, by), state)
}

function exileBoard(state: Game, uid: string | undefined, by: PlayerId | null): Game {
  if (!uid) return state
  if (immuneFrom(state, uid, by)) return log(state, immuneNote(state, uid))
  const tag = heroTag(state, uid)
  const removed = removeHero(state, uid)
  if (!removed.hero) return state
  const card: CardInst = { uid: removed.hero.uid, defId: removed.hero.defId, kind: removed.hero.token ? 'neutral' : 'hero' }
  return toExile(removed.state, card, `${tag} is exiled.`)
}

function toDeck(state: Game, uid: string | undefined, where: 'top' | 'bottom', by: PlayerId | null): Game {
  if (!uid) return state
  if (immuneFrom(state, uid, by)) return log(state, immuneNote(state, uid))
  const tag = heroTag(state, uid)
  const removed = removeHero(state, uid)
  if (!removed.hero) return state
  const card: CardInst = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' }
  const deck = where === 'top' ? [card, ...removed.state.deck] : [...removed.state.deck, card]
  return log({ ...removed.state, deck }, `${tag} goes to the ${where} of the deck.`)
}

function toHand(state: Game, uid: string, player: PlayerId, cause: string): Game {
  const loc = findHero(state, uid)
  // Prefer bounce → owner hand (PA / owner rules) when the destination is the owner.
  if (loc && loc.hero.owner === player) return bounce(state, uid, cause, false, player)
  if (immuneFrom(state, uid, player)) return log(state, immuneNote(state, uid))
  const removed = removeHero(state, uid)
  if (!removed.hero) return state
  const card: CardInst = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' }
  // Non-owner destination (e.g. Gate overflow steal): still apply PA exile when relevant.
  if (
    allLocs(removed.state).some(
      (other) =>
        other.hero.defId === 'phantom_assassin' &&
        other.hero.controller !== removed.hero!.owner &&
        !aurasSuppressed(removed.state, other.hero.controller),
    )
  ) {
    return log(toExile(removed.state, card), `Coup de Grace exiles ${display(card.defId).name}.`)
  }
  return afterBoardToHand(
    log(addHand(removed.state, player, [card]), `${cause} returns ${display(card.defId).name} to hand.`),
  )
}

function dump(state: Game, id: PlayerId): Game {
  let next = state
  for (const card of [...state.players[id].hand]) next = discardUid(next, id, card.uid)
  return next
}

function give(state: Game, from: PlayerId, to: PlayerId, uid: string): Game {
  const card = state.players[from].hand.find((entry) => entry.uid === uid)
  if (!card) return state
  return log(addHand(removeHand(state, from, uid), to, [card]), `${pname(state, to)} takes a card from ${pname(state, from)}.`)
}

function stealRandom(state: Game, from: PlayerId, to: PlayerId, count: number): Game {
  let next = state
  for (let index = 0; index < count; index += 1) {
    const hand = next.players[from].hand
    if (hand.length === 0) break
    const [rolled, card] = randomFrom(next, hand)
    if (!card) break
    next = give(rolled, from, to, card.uid)
  }
  return next
}

function fromGrave(state: Game, actor: PlayerId, uid: string | undefined): Game {
  if (!uid) return state
  const card = state.grave.find((entry) => entry.uid === uid)
  if (!card) return state
  return log(
    addHand({ ...state, grave: state.grave.filter((entry) => entry.uid !== uid) }, actor, [card]),
    `${display(card.defId).name} leaves the grave.`,
  )
}

function exileHand(state: Game, id: PlayerId, uid: string | undefined): Game {
  if (!uid) return state
  const card = state.players[id].hand.find((entry) => entry.uid === uid)
  if (!card) return state
  return toExile(removeHand(state, id, uid), card)
}

function pullIn(state: Game, resume: CastResume, uid: string | undefined, lasso: boolean): Game {
  if (!uid) return state
  const home = here(state, resume)
  if (!home) return log(state, 'There is no team to pull into.')
  const before = findHero(state, uid)
  if (!before) return state
  const homeTeamId = before.team.id
  const owner = before.hero.owner
  const moved = moveOnto(state, uid, home.player.id, home.team.id)
  if (!lasso) return moved
  if (!findHero(moved, uid)) return moved
  return {
    ...moved,
    lassos: [...moved.lassos, { uid, caster: resume.actor, owner, teamId: homeTeamId, fromTurn: state.turn }],
  }
}

function moveOnto(
  state: Game,
  uid: string,
  destPlayer: PlayerId,
  destTeam: string,
  opts: { takeControl?: boolean; by?: PlayerId } = {},
): Game {
  const loc = findHero(state, uid)
  if (!loc) return state
  if (immuneFrom(state, uid, opts.by ?? destPlayer)) return log(state, immuneNote(state, uid))
  if (loc.team.noLeave) return log(state, 'Dream Coil holds them in place.')
  const thief = opts.takeControl ? destPlayer : null
  // Puck: cannot leave — but your own Puck must not block your take-control / toss transfers.
  if (
    allLocs(state).some(
      (other) =>
        other.hero.defId === 'puck' &&
        other.hero.controller !== loc.hero.controller &&
        other.hero.controller !== thief &&
        !aurasSuppressed(state, other.hero.controller),
    )
  ) {
    return log(state, 'Dream Coil holds them in place.')
  }
  const creating = destTeam === 'new' || destTeam === `new:${destPlayer}`
  if (!creating && loc.team.id === destTeam) return state
  // Bloodseeker: leavers die — skip when you control Rupture and are taking the hero.
  if (
    state.rupture &&
    state.rupture.caster !== loc.hero.controller &&
    state.rupture.caster !== thief
  ) {
    return enqueue(state, uid, 'Rupture', false, true, state.rupture.caster)
  }
  if (loc.hero.rupture && !loc.hero.bkb && loc.hero.enrage !== state.turn && thief === null) {
    return enqueue(state, uid, 'Rupture', false, true, null)
  }
  if (!creating) {
    const dest = teamById(state, destTeam)
    if (!dest || dest.player.id !== destPlayer) return state
    const reason = enterReason(state, dest.team, heroWeight(loc.hero), loc.hero.token)
    if (reason) return log(state, reason)
  }
  const pulled = extract(state, uid)
  if (!pulled.hero) return state
  let next = pulled.state
  let teamId = destTeam
  if (creating) {
    const created = newTeam(next, destPlayer)
    if (!created) {
      const home = teamById(next, loc.team.id)
      if (home) return log(putOnTeam(next, loc.hero.controller, loc.team.id, pulled.hero), '12 teams is the limit.')
      const parked = seatTeam(next, loc.hero.controller)
      return log(putOnTeam(parked[0], loc.hero.controller, parked[1], pulled.hero), '12 teams is the limit.')
    }
    next = created[0]
    teamId = created[1]
  }
  const body = {
    ...pulled.hero,
    controller: destPlayer,
    owner: opts.takeControl ? destPlayer : pulled.hero.owner,
    rupture: opts.takeControl ? false : pulled.hero.rupture,
  }
  const placed = putOnTeam(next, destPlayer, teamId, body)
  return arrived(placed, uid).state
}

function infest(state: Game, resume: CastResume, uid: string | undefined, dest: string): Game {
  state = enqueue(state, resume.sourceUid, 'Infest', false, true, resume.actor)
  if (!uid) return state
  state = moveOnto(state, uid, resume.actor, dest)
  const landed = findHero(state, uid)
  if (!landed || landed.hero.controller !== resume.actor) return state
  if (!resume.picked.includes('yes')) return log(state, 'Infest leaves the stolen ability quiet.')
  if (state.stolenCast) return log(state, 'Stolen abilities cannot chain.')
  if (silenced(state, uid) || landed.hero.muted) return log(state, 'The stolen ability does not fire.')
  if (!firesAbility(landed.hero.defId)) return log(state, 'That hero has no ability to fire.')
  state = cast(log({ ...state, stolenCast: true }, 'Infest fires the stolen ability this turn.'), {
    kind: 'cast',
    actor: resume.actor,
    sourceUid: uid,
    defId: landed.hero.defId,
    picked: [],
    steps: 0,
  })
  state = { ...state, stolenCast: false }
  if (findHero(state, uid)) state = editFlag(state, uid, (hero) => ({ ...hero, castTurn: state.turn }))
  return state
}

function relocate(state: Game, resume: CastResume): Game {
  const heroes = heroIds(resume.picked)
  const destinations = [...resume.picked.filter((id) => id.startsWith('team:') || id.startsWith('new'))]
  if (resume.defId === 'underlord' || resume.defId === 'tp_scroll') {
    const dest = destinations[0]
    if (!dest) return state
    const teamId = dest.startsWith('team:') ? dest.slice(5) : dest
    return heroes.reduce((current, uid) => moveOnto(current, uid, resume.actor, teamId), state)
  }
  const uid = heroes[0]
  const dest = destinations[0]
  if (!uid || !dest) return state
  const loc = findHero(state, uid)
  const owner =
    resume.defId === 'force_staff' ? loc?.hero.owner ?? resume.actor
      : resume.defId === 'tusk' ? loc?.hero.controller ?? resume.actor
        : resume.actor
  return moveOnto(state, uid, owner, dest.startsWith('team:') ? dest.slice(5) : dest, { by: resume.actor })
}

function protectCombo(state: Game, resume: CastResume): Game {
  const comboId = resume.picked.find((id) => id.startsWith('combo:'))?.slice(6)
  if (!comboId) return state
  return {
    ...log(state, 'Living Armor protects a terrain.'),
    players: state.players.map((player) => ({
      ...player,
      combos: player.combos.map((combo) => (combo.id === comboId ? { ...combo, protectedBy: resume.sourceUid } : combo)),
    })) as Game['players'],
  }
}

function shoot(state: Game, resume: CastResume): Game {
  const comboId = resume.picked.find((id) => id.startsWith('combo:'))?.slice(6)
  const hero = heroIds(resume.picked)[0]
  if (comboId) return removeCombo(state, comboId)
  if (hero) return enqueue(state, hero, 'Sharpshooter', false, true, resume.actor)
  return state
}

function removeCombo(state: Game, comboId: string): Game {
  if (comboLocked(state, comboId)) return log(state, 'Living Armor protects that combo.')
  let cards: CardInst[] = []
  const players = state.players.map((player) => {
    const combo = player.combos.find((entry) => entry.id === comboId)
    if (combo) cards = combo.cards
    return { ...player, combos: player.combos.filter((entry) => entry.id !== comboId) }
  }) as Game['players']
  let next: Game = { ...state, players }
  for (const card of cards) next = toGrave(next, card, { type: 'deck' })
  return log(next, 'A terrain combo is destroyed.')
}

function pact(state: Game, resume: CastResume, uid: string | undefined): Game {
  if (!uid) return state
  const card = state.grave.find((entry) => entry.uid === uid)
  const hero = HERO_BY_ID[card?.defId ?? '']
  if (!card || !hero) return state
  state = toExile({ ...state, grave: state.grave.filter((entry) => entry.uid !== uid) }, card)
  return log(
    editFlag(state, resume.sourceUid, (current) => ({ ...current, attrMode: 'set', attrSet: [hero.attr] })),
    `Death Pact. Clinkz becomes ${hero.attr}.`,
  )
}

function nova(state: Game, actor: PlayerId): Game {
  const found = state.deck.findIndex((card) => card.kind === 'item')
  if (found < 0) {
    let next = { ...state, deck: [] as CardInst[] }
    for (const card of state.deck) next = toGrave(next, card, { type: 'deck' })
    return next
  }
  const item = state.deck[found]
  if (!item) return state
  const milled = state.deck.slice(0, found)
  let next: Game = { ...state, deck: state.deck.slice(found + 1) }
  for (const card of milled) next = toGrave(next, card, { type: 'deck' })
  return log(addHand(next, actor, [item]), `Pulse Nova takes ${display(item.defId).name}.`)
}

function staticLink(state: Game, resume: CastResume): Game {
  const uid = heroIds(resume.picked)[0]
  if (!uid) return state
  const actor = resume.actor
  const holder = findHero(state, resume.sourceUid)
  if (!holder) return state
  if (holder.hero.held) state = releaseHeld(state, holder.hero)
  const loc = findHero(state, uid)
  if (!loc || loc.hero.controller === actor) return state
  if (immuneFrom(state, uid, actor)) return log(state, immuneNote(state, uid))
  const removed = removeHero(state, uid)
  if (!removed.hero) return state
  const card: CardInst = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' }
  let next = editFlag(removed.state, resume.sourceUid, (hero) => ({
    ...hero,
    held: { card, owner: loc.hero.owner, mode: 'razor', takenTurn: state.turn },
  }))
  next = setPlayer(next, actor, (player) => ({ ...player, actions: player.actions + 1 }))
  return log(next, `Static Link exiles ${display(card.defId).name} until Razor leaves. +1 action.`)
}

function spray(state: Game, resume: CastResume): Game {
  const actor = resume.actor
  if (resume.defId === 'snapfire') {
    const teamId = rawTeams(resume.picked)[0]
    const found = teamId ? teamById(state, teamId) : null
    if (!found) return state
    let next = state
    const pool = [...found.team.heroes]
    for (let count = 0; count < Math.min(2, pool.length); count += 1) {
      const [rolled, hit] = randomFrom(next, pool)
      if (!hit) break
      next = enqueue(rolled, hit.uid, 'Mortimer Kisses', false, true, actor)
      pool.splice(pool.findIndex((hero) => hero.uid === hit.uid), 1)
    }
    return next
  }
  // Nature's Prophet: for each opponent, destroy one of their heroes per terrain combo they control.
  let next = state
  const banned = new Set<string>()
  for (const id of opponents(state, actor)) {
    const kills = state.players[id]!.combos.length
    for (let count = 0; count < kills; count += 1) {
      const pool = allLocs(next).filter(
        (loc) => loc.hero.controller === id && !banned.has(loc.hero.uid),
      )
      const [rolled, hit] = randomFrom(next, pool)
      if (!hit) break
      banned.add(hit.hero.uid)
      next = enqueue(rolled, hit.hero.uid, 'Wrath of Nature', false, true, actor)
    }
  }
  return next
}

function exileTeam(state: Game, teamId: string | undefined, cause: string, by: PlayerId): Game {
  if (!teamId) return state
  const found = teamById(state, teamId)
  if (!found) return state
  return found.team.heroes.reduce(
    (current, hero) => exileBoard(current, hero.uid, by),
    log(state, `${cause} exiles the team.`),
  )
}

function imprison(state: Game, resume: CastResume, uid: string | undefined): Game {
  if (!uid) return state
  const holder = findHero(state, resume.sourceUid)
  if (holder?.hero.held) state = releaseHeld(state, holder.hero)
  const loc = findHero(state, uid)
  if (!loc) return state
  if (immuneFrom(state, uid, resume.actor)) return log(state, immuneNote(state, uid))
  const removed = removeHero(state, uid)
  if (!removed.hero) return state
  const card: CardInst = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' }
  const mode = 'morph' as const
  const copied = HERO_BY_ID[card.defId]?.attr ?? null
  return log(
    editFlag(removed.state, resume.sourceUid, (hero) => ({
      ...hero,
      held: { card, owner: loc.hero.owner, mode, takenTurn: state.turn },
      ...(mode === 'morph' && copied
        ? { attrMode: 'set' as const, attrSet: [copied], gained: null }
        : {}),
    })),
    `${display(resume.defId).name} holds ${display(card.defId).name}.`,
  )
}

function shivas(state: Game, actor: PlayerId, stamp: Game['silence']): Game {
  let next: Game = { ...state, frost: stamp }
  for (const player of state.players) {
    if (player.id === actor) continue
    for (const team of player.teams) {
      next = updateTeamTimed(next, team.id, 'noEnter', stamp)
    }
  }
  return log(next, "Shiva's Guard freezes opponents.")
}

function greaves(state: Game, resume: CastResume): Game {
  const raw = resume.picked.find((id) => id.startsWith('player:'))
  const target = raw ? Number(raw.slice(7)) : resume.actor
  let next = state
  const player = next.players[target]
  if (!player) return state
  for (const team of player.teams) {
    if (!team.trap) continue
    const trap = team.trap
    const card: CardInst = { uid: trap.uid, defId: trap.defId, kind: 'hero' }
    next = updateTeam(next, team.id, (entry) => ({ ...entry, trap: null }))
    next = toGrave(next, card, { type: 'deck' })
  }
  return log(next, `Guardian Greaves clears traps from ${pname(next, target)}.`)
}

function satanic(state: Game, resume: CastResume): Game {
  const uid = heroIds(resume.picked)[0]
  const dest = [...resume.picked].reverse().find((id) => id.startsWith('team:') || id.startsWith('new'))
  if (!uid || !dest) return state
  const teamId = dest.startsWith('team:') ? dest.slice(5) : dest
  const loc = findHero(state, uid)
  if (!loc) return state
  const homeTeamId = loc.team.id
  const owner = loc.hero.owner
  state = moveOnto(state, uid, resume.actor, teamId)
  // Temporary control until end of turn via lasso return to the original team.
  state = {
    ...state,
    lassos: [...state.lassos, { uid, caster: resume.actor, owner, teamId: homeTeamId, fromTurn: state.turn }],
  }
  const landed = findHero(state, uid)
  if (!landed || landed.hero.controller !== resume.actor) return state
  if (!resume.picked.includes('yes')) return log(state, 'Satanic takes control for the turn.')
  if (state.stolenCast) return log(state, 'Stolen abilities cannot chain.')
  if (silenced(state, uid) || landed.hero.muted) return log(state, 'The stolen ability does not fire.')
  if (!firesAbility(landed.hero.defId)) return log(state, 'That hero has no ability to fire.')
  state = cast(log({ ...state, stolenCast: true }, 'Satanic fires the stolen ability.'), {
    kind: 'cast',
    actor: resume.actor,
    sourceUid: uid,
    defId: landed.hero.defId,
    picked: [],
    steps: 0,
  })
  return { ...state, stolenCast: false }
}

function strike(state: Game, uid: string | undefined, actor: PlayerId): Game {
  const loc = uid ? findHero(state, uid) : null
  if (!loc) return state
  const wanted = new Set(attrsOf(state, loc.hero))
  return loc.team.heroes.reduce((current, hero) => {
    const shared = attrsOf(current, hero).some((attr) => wanted.has(attr)) || (wanted.size === 0 && attrsOf(current, hero).length === 0)
    return shared ? enqueue(current, hero.uid, 'Boundless Strike', false, true, actor) : current
  }, state)
}

function sunder(state: Game, yourTeam: string | undefined, theirTeam: string | undefined, actor: PlayerId): Game {
  if (!yourTeam || !theirTeam) return state
  const yours = teamById(state, yourTeam)
  const theirs = teamById(state, theirTeam)
  if (!yours || !theirs) return state
  const shielded = theirs.team.heroes.find((hero) => immuneFrom(state, hero.uid, actor))
  if (shielded) return log(state, `Sunder fails — ${immuneNote(state, shielded.uid)}`)
  const players = state.players.map((player) => {
    const teams = player.teams.filter((team) => team.id !== yourTeam && team.id !== theirTeam)
    if (player.id === yours.player.id) teams.push({ ...theirs.team, heroes: theirs.team.heroes.map((hero) => ({ ...hero, controller: player.id })) })
    if (player.id === theirs.player.id) teams.push({ ...yours.team, heroes: yours.team.heroes.map((hero) => ({ ...hero, controller: player.id })) })
    return { ...player, teams }
  }) as Game['players']
  return log({ ...state, players }, 'Sunder swaps the teams.')
}

function netherSwap(state: Game, selfUid: string, otherUid: string | undefined): Game {
  if (!otherUid) return state
  if (state.stolenCast) return log(state, 'Stolen abilities cannot chain.')
  const self = findHero(state, selfUid)
  const other = findHero(state, otherUid)
  if (!self || !other) return state
  const selfWeight = heroWeight(self.hero)
  const otherWeight = heroWeight(other.hero)
  if (teamSize(self.team) - selfWeight + otherWeight > 5) return log(state, 'Nether Swap would overfill the team.')
  if (teamSize(other.team) - otherWeight + selfWeight > 5) return log(state, 'Nether Swap would overfill the team.')
  if (immuneFrom(state, otherUid, self.hero.controller)) return log(state, immuneNote(state, otherUid))
  const first = moveOnto(state, selfUid, other.player.id, other.team.id, { by: self.hero.controller })
  let next = moveOnto(first, otherUid, self.player.id, self.team.id)
  const stolen = findHero(next, otherUid)
  if (stolen && firesAbility(stolen.hero.defId)) {
    next = cast(log({ ...next, stolenCast: true }, 'Nether Swap may fire the stolen ability.'), {
      kind: 'cast',
      actor: stolen.hero.controller,
      sourceUid: otherUid,
      defId: stolen.hero.defId,
      picked: [],
      steps: 0,
    })
    next = { ...next, stolenCast: false }
  }
  return next
}

/** Depth bands the Weaver player may choose for The Ancient (fraction of the deck above it). */
export const WEAVER_BANDS = [
  { id: 'top', label: 'Near the top', at: 0.1 },
  { id: 'upper', label: 'Upper middle', at: 0.3 },
  { id: 'middle', label: 'Middle', at: 0.5 },
  { id: 'lower', label: 'Lower middle', at: 0.7 },
  { id: 'bottom', label: 'Near the bottom', at: 0.9 },
] as const

/** Shuffle the deck and grave together; if The Ancient is still in the deck, its owner of the turn picks how deep it goes. */
function timeLapse(state: Game, actor: PlayerId): Game {
  const isAncient = (card: CardInst) => card.kind === 'ancient' || card.defId === ANCIENT_ID
  const ancient = state.deck.find(isAncient) ?? null
  const pool = [...state.deck.filter((card) => !isAncient(card)), ...state.grave]
  const [shuffled, deck] = shuffle(state, pool)
  let next: Game = log({ ...shuffled, grave: [], deck, lastGrave: null }, 'Time Lapse shuffles the grave into the deck.')
  if (!ancient) return next
  next = { ...next, limbo: [...next.limbo, ancient] }
  return ask(next, {
    actor,
    prompt: 'Time Lapse: where does The Ancient go?',
    mode: 'pick',
    min: 1,
    max: 1,
    choices: WEAVER_BANDS.map((band) => ({
      id: `depth:${band.id}`,
      label: band.label,
      hint: `about ${Math.round(band.at * deck.length)} of ${deck.length} cards down`,
    })),
    resume: { kind: 'weaver-ancient', actor, card: ancient },
  })
}

/** Put The Ancient back at the chosen band, ±5% so the exact card stays hidden. */
export function finishTimeLapse(state: Game, actor: PlayerId, card: CardInst, pick: string): Game {
  const band = WEAVER_BANDS.find((entry) => `depth:${entry.id}` === pick) ?? WEAVER_BANDS[2]
  const placed = insertAtDepth({ ...state, limbo: state.limbo.filter((entry) => entry.uid !== card.uid) }, card, band.at - 0.05, band.at + 0.05)
  return log(placed, `${pname(state, actor)} puts The Ancient ${band.label.toLowerCase()} of the deck.`)
}

export function insertAtDepth(state: Game, card: CardInst, lo: number, hi: number): Game {
  const len = state.deck.length
  const minIdx = Math.max(0, Math.min(len, Math.floor(lo * len)))
  const maxIdx = Math.max(minIdx, Math.min(len, Math.floor(hi * len)))
  const [rolled, offset] = randInt(state, maxIdx - minIdx + 1)
  const index = minIdx + offset
  return { ...rolled, deck: [...rolled.deck.slice(0, index), card, ...rolled.deck.slice(index)] }
}

function stealSpell(state: Game, actor: PlayerId, sourceUid: string, heroUid: string | undefined): Game {
  if (state.stolenCast) return log(state, 'Stolen abilities cannot chain.')
  const loc = heroUid ? findHero(state, heroUid) : null
  if (!loc) return state
  const copied = loc.hero.defId
  if (!firesAbility(copied)) return log(state, 'There is no ability to steal.')
  // Nullify that enemy hero's ability for the rest of this turn (cancels an interrupted cast if it was theirs).
  let next: Game = {
    ...state,
    spellNullify: [...state.spellNullify.filter((entry) => entry.uid !== loc.hero.uid), { uid: loc.hero.uid, fromTurn: state.turn }],
  }
  next = log(next, `Spell Steal nullifies ${display(copied).name} this turn.`)
  next = cast({ ...next, stolenCast: true }, { kind: 'cast', actor, sourceUid, defId: copied, picked: [], steps: 0 })
  return { ...next, stolenCast: false }
}

function recast(state: Game, actor: PlayerId, heroUid: string | undefined): Game {
  if (state.stolenCast) return log(state, 'Stolen abilities cannot chain.')
  const loc = heroUid ? findHero(state, heroUid) : null
  if (!loc) return state
  if (!firesAbility(loc.hero.defId)) return log(state, 'That hero has no ability to cast again.')
  const next = cast(log({ ...state, stolenCast: true }, `${display(loc.hero.defId).name} casts again.`), {
    kind: 'cast',
    actor,
    sourceUid: loc.hero.uid,
    defId: loc.hero.defId,
    picked: [],
    steps: 0,
  })
  return { ...next, stolenCast: false }
}

function rearm(state: Game, resume: CastResume, uid: string | undefined): Game {
  if (!uid) return state
  state = fromGrave(state, resume.actor, uid)
  if (!resume.picked.includes('yes')) return state
  const card = state.players[resume.actor].hand.find((entry) => entry.uid === uid)
  if (!card) return state
  return cast(removeHand(toGrave(state, card, { type: 'deck' }), resume.actor, uid), {
    kind: 'cast',
    actor: resume.actor,
    sourceUid: uid,
    defId: card.defId,
    picked: [],
    steps: 0,
  })
}

function curse(state: Game, teamId: string | undefined, keep: string | undefined, actor: PlayerId): Game {
  const found = teamId ? teamById(state, teamId) : null
  if (!found || !keep) return state
  return found.team.heroes.reduce((current, hero) => {
    return hero.uid === keep ? current : enqueue(current, hero.uid, "Winter's Curse", false, true, actor)
  }, state)
}

function splitTeam(state: Game, resume: CastResume): Game {
  const teamId = rawTeams(resume.picked)[0]
  const found = teamId ? teamById(state, teamId) : null
  if (!found) return state
  const groups = new Map<string, string[]>()
  for (const token of resume.picked) {
    const match = token.match(/^([012]):(.+)$/)
    if (!match) continue
    const list = groups.get(match[1]!) ?? []
    list.push(match[2]!)
    groups.set(match[1]!, list)
  }
  let next = state
  const owner = found.player.id
  let first = true
  for (const members of groups.values()) {
    if (members.length === 0) continue
    let dest = teamId
    if (!first) {
      ;[next, dest] = seatTeam(next, owner)
    }
    first = false
    for (const uid of members) {
      if (findHero(next, uid)?.team.id !== dest) next = moveOnto(next, uid, owner, dest, { by: resume.actor })
    }
  }
  return log(next, 'Primal Roar splits the team.')
}

function polarity(state: Game, enemy: PlayerId, uids: string[], actor: PlayerId): Game {
  const kept: string[] = []
  let weight = 0
  for (const uid of uids) {
    const loc = findHero(state, uid)
    if (!loc || loc.hero.controller !== enemy || immuneFrom(state, uid, actor)) continue
    const size = heroWeight(loc.hero)
    if (weight + size > 5) continue
    kept.push(uid)
    weight += size
  }
  const firstId = kept[0]
  if (!firstId) return log(state, 'Reverse Polarity finds no heroes.')
  const removed = extract(state, firstId)
  if (!removed.hero) return state
  const created = newTeam(removed.state, enemy)
  if (!created) {
    const home = findHero(state, firstId)?.team.id
    if (home && teamById(removed.state, home)) {
      return log(putOnTeam(removed.state, enemy, home, { ...removed.hero, controller: enemy }), '12 teams is the limit.')
    }
    const parked = seatTeam(removed.state, enemy)
    return log(putOnTeam(parked[0], enemy, parked[1], { ...removed.hero, controller: enemy }), '12 teams is the limit.')
  }
  let next = putOnTeam(created[0], enemy, created[1], { ...removed.hero, controller: enemy })
  next = arrived(next, firstId).state
  for (const uid of kept.slice(1)) next = moveOnto(next, uid, enemy, created[1], { by: actor })
  return log(next, 'Reverse Polarity gathers a team.')
}

function mine(state: Game, teamId: string | undefined): Game {
  if (!teamId || state.deck.length === 0) return log(state, 'Proximity Mines find nothing.')
  const [card] = state.deck
  if (!card) return state
  return log(
    {
      ...state,
      deck: state.deck.slice(1),
      players: state.players.map((player) => ({
        ...player,
        teams: player.teams.map((team) => (team.id === teamId ? { ...team, mine: card } : team)),
      })) as Game['players'],
    },
    'A mine is buried under the team.',
  )
}

function swapHands(state: Game, actor: PlayerId, enemy: PlayerId): Game {
  const yours = state.players[actor].hand
  const theirs = state.players[enemy].hand
  return log(
    setPlayer(setPlayer(state, actor, (player) => ({ ...player, hand: theirs })), enemy, (player) => ({ ...player, hand: yours })),
    'Dissimilate swaps hands.',
  )
}

function focus(state: Game, resume: CastResume, actor: PlayerId): Game {
  const comboId = resume.picked.find((id) => id.startsWith('combo:'))?.slice(6)
  const teamId = rawTeams(resume.picked)[0]
  if (comboId) state = removeCombo(state, comboId)
  if (teamId) state = destroyTeam(state, teamId, 'Focus Fire', actor, false)
  return state
}

function regen(state: Game, actor: PlayerId): Game {
  if (graveLocked(state, actor)) return log(state, 'Muerta keeps the grave shut.')
  const card = state.grave.at(-1)
  if (!card) return log(state, 'The grave is empty.')
  return log(addHand({ ...state, grave: state.grave.slice(0, -1) }, actor, [card]), `${display(card.defId).name} returns.`)
}

/**
 * Reveal from the top until a terrain and take it. The other revealed cards go back on top
 * in the order the player picks, so Clarity can also stack the next draws.
 */
function clarityDig(state: Game, actor: PlayerId): Game {
  const index = state.deck.findIndex((card) => card.kind === 'terrain')
  if (index < 0) return log(state, 'Clarity finds no terrain.')
  const terrain = state.deck[index]!
  const revealed = state.deck.slice(0, index)
  const rest = state.deck.slice(index + 1)
  const shown = revealed.length > 0 ? ` after ${revealed.map((card) => display(card.defId).name).join(', ')}` : ''
  let next = log(addHand({ ...state, deck: rest }, actor, [terrain]), `Clarity reveals ${display(terrain.defId).name}${shown}.`)
  if (revealed.length <= 1 || rest.length === 0) return { ...next, deck: [...revealed, ...rest] }
  next = { ...next, limbo: [...next.limbo, ...revealed] }
  return askRestack(next, actor, revealed.map((card) => card.uid), [])
}

function askRestack(state: Game, actor: PlayerId, cards: string[], placed: string[]): Game {
  const left = cards.filter((uid) => !placed.includes(uid))
  if (left.length <= 1) {
    const order = [...placed, ...left]
    const stack = order.map((uid) => state.limbo.find((card) => card.uid === uid)).filter((card): card is CardInst => !!card)
    return log(
      { ...state, limbo: state.limbo.filter((card) => !order.includes(card.uid)), deck: [...stack, ...state.deck] },
      `Clarity puts ${stack.length} card${stack.length === 1 ? '' : 's'} back on top.`,
    )
  }
  const position = placed.length === 0 ? 'on top' : `card ${placed.length + 1} from the top`
  return ask(state, {
    actor,
    prompt: `Clarity: choose the card to put ${position}.`,
    mode: 'pick',
    min: 1,
    max: 1,
    choices: left.map((uid) => {
      const card = state.limbo.find((entry) => entry.uid === uid)
      return { id: `card:${uid}`, label: card ? display(card.defId).name : uid, defId: card?.defId }
    }),
    resume: { kind: 'restack', actor, cards, placed },
  })
}

export function continueRestack(state: Game, actor: PlayerId, cards: string[], placed: string[], pick: string): Game {
  const uid = pick.startsWith('card:') ? pick.slice(5) : pick
  const next = cards.includes(uid) && !placed.includes(uid) ? [...placed, uid] : placed
  return askRestack(state, actor, cards, next)
}

function eul(state: Game, uid: string | undefined, by: PlayerId): Game {
  if (!uid) return state
  const loc = findHero(state, uid)
  if (!loc) return state
  if (immuneFrom(state, uid, by)) return log(state, immuneNote(state, uid))
  const pulled = extract(state, uid)
  if (!pulled.hero) return state
  let next = returnInfest(pulled.state, uid, loc.team.id)
  return log(
    {
      ...next,
      phased: [...next.phased, { hero: pulled.hero, teamId: loc.team.id, owner: pulled.hero.owner, fromTurn: state.turn }],
    },
    `${pname(state, loc.hero.controller)}'s ${display(pulled.hero.defId).name} is set aside until the end of the turn.`,
  )
}

function mergeTeams(state: Game, teamIds: string[], actor: PlayerId): Game {
  const [first, second] = teamIds
  if (!first || !second || first === second) return log(state, 'Gate needs two teams.')
  const alpha = teamById(state, first)
  const beta = teamById(state, second)
  if (!alpha || !beta) return state
  let next = state
  for (const hero of beta.team.heroes) next = moveOnto(next, hero.uid, actor, first)
  const merged = teamById(next, first)
  if (merged && teamSize(merged.team) > 5) {
    const overflow = [...merged.team.heroes]
    while (overflow.reduce((sum, hero) => sum + heroWeight(hero), 0) > 5) {
      const extra = overflow.pop()
      if (!extra) break
      next = toHand(next, extra.uid, actor, 'Gate')
    }
  }
  return log(next, 'Gate merges the teams.')
}

function startKunkka(state: Game, actor: PlayerId): Game {
  const [next, cards] = pullTop(state, 5)
  if (cards.length === 0) return log(next, 'The deck has nothing to reveal.')
  return ask(
    { ...next, limbo: cards },
    {
      actor: foe(state, actor),
      prompt: 'Split these cards into two piles.',
      mode: 'split',
      min: cards.length,
      max: cards.length,
      choices: cards.map((card) => ({ id: card.uid, label: display(card.defId).name, defId: card.defId })),
      resume: { kind: 'kunkka-split', cards: cards.map((card) => card.uid), picker: actor },
    },
  )
}

function startIo(state: Game, actor: PlayerId): Game {
  const n = state.players.length
  const cards: CardInst[] = []
  let next = state
  for (let i = 0; i < n; i += 1) {
    const [pulled, batch] = pullTop(next, 1)
    next = pulled
    if (batch[0]) cards.push(batch[0])
  }
  if (cards.length === 0) return log(next, 'The deck is empty.')
  return ask(
    { ...next, limbo: cards },
    {
      actor,
      prompt: 'Give one card to each player.',
      mode: 'assign',
      min: cards.length,
      max: cards.length,
      choices: cards.map((card) => ({ id: card.uid, label: display(card.defId).name, defId: card.defId })),
      resume: { kind: 'io', cards: cards.map((card) => card.uid), actor },
    },
  )
}

function arrow(state: Game, resume: CastResume): Game {
  // Reveal top 1: if hero, may play free; else grave.
  if ((resume.steps ?? 0) < 1) {
    const [next, batch] = pullTop(state, 1)
    const card = batch[0]
    if (!card) return log(next, 'The deck is empty.')
    if (card.kind !== 'hero') return log(toGrave(next, card, { type: 'deck' }), 'Sacred Arrow finds no hero.')
    return ask({ ...next, limbo: [card] }, {
      actor: resume.actor,
      prompt: `Play ${display(card.defId).name} for free?`,
      mode: 'pick',
      min: 1,
      max: 1,
      choices: [
        { id: 'yes', label: 'Play it' },
        { id: 'no', label: 'Put it in the grave' },
      ],
      resume: { ...resume, steps: 1, picked: [`card:${card.uid}`] },
    })
  }
  const card = state.limbo[0]
  let next: Game = { ...state, limbo: [] }
  if (!card) return next
  if (resume.picked.includes('yes')) {
    next = addHand(next, resume.actor, [card])
    // Free play via freeItems-style: hand them and bump a free flag isn't right for heroes.
    // Play immediately into a new team.
    const made = makeHero(card, resume.actor, resume.actor, next)
    const created = newTeam(removeHand(next, resume.actor, card.uid), resume.actor)
    if (!created) return log(addHand(next, resume.actor, [card]), '12 teams is the limit — Mirana keeps the hero.')
    next = putOnTeam(created[0], resume.actor, created[1], made)
    next = arrived(next, made.uid).state
    if (firesAbility(card.defId) && !next.stolenCast) {
      next = cast({ ...next, stolenCast: true }, {
        kind: 'cast',
        actor: resume.actor,
        sourceUid: made.uid,
        defId: card.defId,
        picked: [],
        steps: 0,
      })
      next = { ...next, stolenCast: false }
    }
    return log(next, `Sacred Arrow plays ${display(card.defId).name}.`)
  }
  return log(toGrave(next, card, { type: 'deck' }), 'Sacred Arrow passes.')
}

function hook(state: Game, resume: CastResume): Game {
  const home = here(state, resume)
  if (!home) return state
  const enemy = pickedEnemy(state, resume, resume.actor)
  const pool = state.players[enemy].hand.filter((card) => card.kind === 'hero')
  const [next, card] = randomFrom(state, pool)
  if (!card) return log(next, 'Meat Hook finds no hero.')
  const reason = enterReason(next, home.team, 1, false)
  if (reason) return log(next, reason)
  const hero = {
    uid: card.uid,
    defId: card.defId,
    owner: enemy,
    controller: resume.actor,
    enteredTurn: next.turn,
    enteredSeq: next.seq,
    attrMode: 'base' as const,
    attrSet: [],
    gained: null,
    token: false,
    roshan: false,
    rupture: false,
    omni: false,
    abaddon: false,
    shield: null,
    ward: null,
    hidden: null,
    bkb: null,
    enrage: null,
    tether: null,
    muted: null,
    dawn: null,
    wk: card.defId === 'wraith_king',
    refract: card.defId === 'templar_assassin',
    held: null,
    castTurn: -1,
  }
  const placed = putOnTeam(removeHand(next, enemy, card.uid), resume.actor, home.team.id, hero)
  return log(arrived(placed, card.uid).state, `Meat Hook drags in ${display(card.defId).name}.`)
}

export function finishKunkka(state: Game, pileA: string[], pileB: string[], picker: PlayerId, take: 'a' | 'b'): Game {
  const keptIds = new Set(take === 'a' ? pileA : pileB)
  const kept = state.limbo.filter((card) => keptIds.has(card.uid))
  const dumped = state.limbo.filter((card) => !keptIds.has(card.uid))
  let next: Game = addHand({ ...state, limbo: [] }, picker, kept)
  for (const card of dumped) next = toGrave(next, card, { type: 'deck' })
  return log(next, `${pname(next, picker)} keeps a pile.`)
}

export function finishIo(state: Game, assignments: { uid: string; player: PlayerId }[]): Game {
  let next: Game = { ...state, limbo: [] }
  for (const assignment of assignments) {
    const card = state.limbo.find((entry) => entry.uid === assignment.uid)
    if (card) next = addHand(next, assignment.player, [card])
  }
  return log(next, 'Tether deals the cards.')
}

function clockwerkPeek(state: Game, actor: PlayerId, resume: CastResume): Game {
  // Step 0 (armed, no limbo): reveal top 3 into limbo and re-ask via cast.
  if (state.limbo.length === 0 && (resume.steps ?? 0) === 0 && resume.picked.length === 0) {
    const [next, taken] = pullTop(state, 3)
    if (taken.length === 0) return log(next, 'Hookshot finds nothing.')
    return cast({ ...next, limbo: taken }, { ...resume, armed: false, steps: 0, picked: [] })
  }
  // Resolve assignments from picks.
  const handUid = cardIds(resume.picked)[0]
  const topUid = resume.picked.find((id) => id.startsWith('top:'))?.slice(4)
  const handCard = state.limbo.find((card) => card.uid === handUid)
  const topCard = state.limbo.find((card) => card.uid === topUid)
  const rest = state.limbo.filter((card) => card.uid !== handUid && card.uid !== topUid)
  let next: Game = { ...state, limbo: [] }
  if (handCard) next = addHand(next, actor, [handCard])
  if (topCard) next = { ...next, deck: [topCard, ...next.deck] }
  for (const card of rest) next = toGrave(next, card, { type: 'deck' })
  // If picks incomplete (AI skipped), dump remaining limbo to grave.
  for (const card of next.limbo) next = toGrave(next, card, { type: 'deck' })
  return log({ ...next, limbo: [] }, 'Hookshot digs three cards.')
}

function dragonKnightReveal(state: Game, actor: PlayerId): Game {
  const [pulled, taken] = pullTop(state, 5)
  let next = pulled
  const terrains = taken.filter((card) => card.kind === 'terrain')
  const rest = taken.filter((card) => card.kind !== 'terrain')
  if (terrains.length) next = addHand(next, actor, terrains)
  for (const card of rest) next = toGrave(next, card, { type: 'deck' })
  return log(next, `Elder Dragon Form finds ${terrains.length} terrain(s).`)
}

/** Tiny: transfer a hero from Tiny's team onto an enemy team (enemy ownership), then destroy 2 others there. */
function tinyToss(state: Game, resume: CastResume): Game {
  const actor = resume.actor
  const tossed = heroIds(resume.picked)[0]
  const teamId = rawTeams(resume.picked)[0]
  const home = here(state, resume)
  if (!tossed || !teamId || !home) return state
  const src = findHero(state, tossed)
  if (!src || src.team.id !== home.team.id) return log(state, 'Toss needs a hero in this team.')
  const destInfo = teamById(state, teamId)
  if (!destInfo || destInfo.player.id === actor) return log(state, 'Toss needs an enemy team.')
  let next = moveOnto(state, tossed, destInfo.player.id, teamId, { takeControl: true, by: actor })
  const dest = teamById(next, teamId)
  if (!dest || !dest.team.heroes.some((hero) => hero.uid === tossed)) {
    return log(next, 'Toss fails — that hero could not enter.')
  }
  const victims = dest.team.heroes.filter((hero) => hero.uid !== tossed).slice(0, 2)
  for (const hero of victims) next = enqueue(next, hero.uid, 'Toss', false, true, actor)
  return log(next, `Toss: ${display(src.hero.defId).name} joins the enemy team.`)
}

/** Blink: play a hero from hand into a team; optionally fire its ability (anti-loop). */
function blinkPlay(state: Game, resume: CastResume): Game {
  const actor = resume.actor
  if (heroPlayBanned(state, actor)) return log(state, "Blink is a hero play — Heaven's Halberd stops it.")
  const cardUid = cardIds(resume.picked)[0]
  const destRaw = resume.picked.find((id) => id.startsWith('team:') || id.startsWith('new:'))
  if (!cardUid || !destRaw) return state
  const held = state.players[actor]?.hand.find((card) => card.uid === cardUid)
  if (!held || held.kind !== 'hero') return log(state, 'Blink needs a hero in hand.')
  let next = removeHand(state, actor, cardUid)
  const made = makeHero(held, actor, actor, next)
  let teamId = destRaw.startsWith('team:') ? destRaw.slice(5) : ''
  if (!teamId || destRaw.startsWith('new')) {
    ;[next, teamId] = seatTeam(next, actor)
  }
  next = putOnTeam(next, actor, teamId, made)
  next = arrived(next, made.uid).state
  next = log(next, `Blink plays ${display(held.defId).name}.`)
  if (!resume.picked.includes('yes')) return next
  if (next.stolenCast) return log(next, 'Stolen abilities cannot chain.')
  if (!firesAbility(held.defId)) return next
  next = cast({ ...next, stolenCast: true }, {
    kind: 'cast',
    actor,
    sourceUid: made.uid,
    defId: held.defId,
    picked: [],
    steps: 0,
  })
  return { ...next, stolenCast: false }
}

/** Clinkz: exile top 5; those item cards may be played free from exile this turn. */
function clinkzExile(state: Game): Game {
  const [pulled, taken] = pullTop(state, 5)
  let next = pulled
  for (const card of taken) next = toExile(next, card)
  const items = taken.filter((card) => card.kind === 'item')
  return log(
    { ...next, clinkzExile: [...next.clinkzExile, ...items] },
    `Death Pact exiles ${taken.length}; ${items.length} item(s) free this turn.`,
  )
}

/** Mark the just-drawn reward as free to play this turn (optional — no blocking prompt). */
function grantFreePlay(state: Game, actor: PlayerId): Game {
  const card = state.players[actor]?.hand[state.players[actor].hand.length - 1]
  if (!card) return state
  return log(
    { ...state, freePlay: [...state.freePlay, card.uid] },
    `${display(card.defId).name} may be played for free this turn.`,
  )
}

/** Lifestealer: exile self, pull host into this team; return in the host's place when it leaves. */
function infestHost(state: Game, resume: CastResume, hostUid: string | undefined): Game {
  if (!hostUid) return state
  const home = here(state, resume)
  const ls = findHero(state, resume.sourceUid)
  if (!ls || !home) return state
  const homeTeamId = home.team.id
  const lsCard: CardInst = { uid: ls.hero.uid, defId: ls.hero.defId, kind: 'hero' }
  const removed = removeHero(state, resume.sourceUid)
  let next = toExile(removed.state, lsCard, null)
  // strip() drops empty teams when Lifestealer leaves — keep that seat so the host can join it.
  if (!teamById(next, homeTeamId)) next = addTeam(next, resume.actor, blankTeam(homeTeamId))
  next = {
    ...next,
    infests: [
      ...next.infests,
      { ls: lsCard, hostUid, homeTeamId, owner: resume.actor },
    ],
  }
  next = moveOnto(next, hostUid, resume.actor, homeTeamId, { takeControl: true, by: resume.actor })
  const landed = findHero(next, hostUid)
  next = log(
    next,
    landed
      ? `Infest: ${display(landed.hero.defId).name} joins ${pname(next, resume.actor)}; Lifestealer waits in exile.`
      : 'Infest.',
  )
  if (!resume.picked.includes('yes') || !landed) return next
  if (next.stolenCast) return log(next, 'Stolen abilities cannot chain.')
  if (!firesAbility(landed.hero.defId)) return next
  next = cast({ ...next, stolenCast: true }, {
    kind: 'cast',
    actor: resume.actor,
    sourceUid: hostUid,
    defId: landed.hero.defId,
    picked: [],
    steps: 0,
  })
  return { ...next, stolenCast: false }
}

/** Snapfire: exile 3 from hand, take 2 from grave. */
function snapfireEffect(state: Game, resume: CastResume): Game {
  const actor = resume.actor
  const pitched = cardIds(resume.picked).slice(0, 3)
  let next = state
  for (const uid of pitched) {
    const card = next.players[actor]?.hand.find((entry) => entry.uid === uid)
    if (!card) continue
    next = removeHand(next, actor, uid)
    next = toExile(next, card)
  }
  const taken = cardIds(resume.picked).slice(3, 5)
  // Picks after exile step are grave card:uids — questions put hand cards first then grave.
  const gravePicks = resume.picked.filter((id) => id.startsWith('grave:')).map((id) => id.slice(6))
  const fromGrave = gravePicks.length > 0 ? gravePicks : taken
  for (const uid of fromGrave.slice(0, 2)) {
    const card = next.grave.find((entry) => entry.uid === uid)
    if (!card) continue
    next = { ...next, grave: next.grave.filter((entry) => entry.uid !== uid) }
    next = addHand(next, actor, [card])
  }
  return log(next, 'Mortimer Kisses.')
}

/** Visage: discard up to 2, destroy that many enemy heroes. */
function visageSoul(state: Game, resume: CastResume): Game {
  const actor = resume.actor
  const discarded = cardIds(resume.picked)
  const kills = heroIds(resume.picked)
  let next = state
  for (const uid of discarded) next = discardUid(next, actor, uid)
  for (const uid of kills.slice(0, discarded.length)) {
    next = enqueue(next, uid, "Soul Assumption", false, true, actor)
  }
  return log(next, 'Soul Assumption.')
}

/** Windranger: take control of an enemy terrain combo. */
function stealCombo(state: Game, resume: CastResume, actor: PlayerId): Game {
  const comboId = resume.picked.find((id) => id.startsWith('combo:'))?.slice(6)
  if (!comboId) return state
  if (comboLocked(state, comboId)) return log(state, 'Living Armor protects that combo.')
  let stolen: Game['players'][0]['combos'][0] | null = null
  const players = state.players.map((player) => {
    const hit = player.combos.find((combo) => combo.id === comboId)
    if (!hit || player.id === actor) return player
    stolen = hit
    return { ...player, combos: player.combos.filter((combo) => combo.id !== comboId) }
  }) as Game['players']
  if (!stolen) return state
  const moved = { ...stolen, owner: actor, id: `combo-${state.nextId}` }
  const nextPlayers = players.map((player) =>
    player.id === actor ? { ...player, combos: [...player.combos, moved] } : player,
  ) as Game['players']
  return log({ ...state, nextId: state.nextId + 1, players: nextPlayers }, 'Focus Fire steals a terrain combo.')
}

/** Fiend's Gate: move up to 5 owned heroes into a brand-new team. */
function gateNewTeam(state: Game, resume: CastResume): Game {
  const actor = resume.actor
  const uids = heroIds(resume.picked).slice(0, 5)
  if (uids.length === 0) return state
  const created = newTeam(state, actor)
  if (!created) return log(state, '12 teams is the limit.')
  let [next, teamId] = created
  for (const uid of uids) next = moveOnto(next, uid, actor, teamId)
  return log(next, "Fiend's Gate forms a new team.")
}

/** Let each opponent play an Instant (or pass) after targets are chosen, before the ability resolves. */
export function offerInstantWindow(
  state: Game,
  heroUid: string,
  resume: CastResume,
  seats?: PlayerId[],
  index = 0,
): Game {
  const order = seats ?? opponents(state, resume.actor)
  if (index >= order.length) return gateAbility(state, heroUid, resume)
  const seat = order[index]!
  const playable = state.players[seat]!.hand.filter((card) => {
    const info = display(card.defId)
    if (!info.instant) return false
    if (card.kind === 'terrain') return false
    // Illusion counters plays, not abilities.
    if (card.defId === 'illusion') return false
    if (card.defId === 'spirit_breaker') {
      return resume.picked.some((id) => id.startsWith('hero:') || id.startsWith('team:'))
    }
    return true
  })
  if (instantsLocked(state, seat)) {
    if (playable.length > 0) {
      state = log(state, `Battle Trance stops ${pname(state, seat)} from playing Instant cards.`)
    }
    return offerInstantWindow(state, heroUid, resume, order, index + 1)
  }
  if (playable.length === 0) return offerInstantWindow(state, heroUid, resume, order, index + 1)
  const about = display(resume.defId)
  const caster = pname(state, resume.actor)
  const targetNote = announceTargets(state, resume)
  const spell = about.spell ?? about.name
  const targetLine = targetNote ? ` Target: ${targetNote}.` : ''
  return ask(state, {
    actor: seat,
    prompt: `${caster}: ${spell}.${targetLine} Interrupt, or pass.`,
    mode: 'pick',
    min: 1,
    max: 1,
    choices: [
      { id: 'pass', label: 'Pass' },
      ...playable.map((card) => ({
        id: `instant:${card.uid}`,
        label: display(card.defId).name,
        defId: card.defId,
        hint: display(card.defId).text,
      })),
    ],
    resume: { kind: 'instant-window', cast: resume, heroUid, seats: order, index },
    about: {
      defId: resume.defId,
      name: about.name,
      spell: about.spell,
      text: about.text,
      kind: about.kind,
    },
  })
}

/** Pugna tax → cast. Nyx counters only via the Instant interrupt window. */
function gateAbility(state: Game, heroUid: string, resume: CastResume): Game {
  const loc = findHero(state, heroUid)
  if (!loc) return log(state, 'The hero is gone — the ability fizzles.')
  const orchid = state.players[resume.actor]?.orchid
  if (
    loc.hero.muted ||
    (state.silence && !immuneFrom(state, heroUid, state.silence.caster)) ||
    (orchid && !immuneFrom(state, heroUid, orchid.caster))
  ) {
    return log(state, 'The ability is nullified.')
  }
  if (state.spellNullify.some((entry) => entry.uid === heroUid)) {
    return log(state, `Spell Steal nullifies ${display(resume.defId).name}.`)
  }
  if (
    allLocs(state).some(
      (entry) =>
        entry.hero.defId === 'pugna' &&
        entry.hero.controller !== resume.actor &&
        !aurasSuppressed(state, entry.hero.controller),
    )
  ) {
    return ask(state, {
      actor: resume.actor,
      prompt: 'Nether Ward: discard a card, or the hero does not fire.',
      mode: 'pick',
      min: 1,
      max: 1,
      choices: [
        ...handCards(state, resume.actor).map((choice) => ({ ...choice, label: `Discard ${choice.label}` })),
        { id: 'fizzle', label: 'The hero does not fire' },
      ],
      resume: { kind: 'pugna', cast: resume },
    })
  }
  return cast(state, { ...resume, armed: true, windowed: true })
}

/** Fold targets already chosen onto the prompt so the action line can name them. */
function withTargets(state: Game, resume: CastResume, prompt: string): string {
  if (/Target:/i.test(prompt)) return prompt
  const note = announceTargets(state, resume)
  if (!note) return prompt
  return `${prompt.replace(/[.\s]*$/, '')}. Target: ${note}.`
}

function announceTargets(state: Game, resume: CastResume): string {
  const parts: string[] = []
  for (const uid of heroIds(resume.picked)) {
    const loc = findHero(state, uid)
    if (loc) parts.push(display(loc.hero.defId).name)
  }
  for (const teamId of rawTeams(resume.picked)) {
    const found = teamById(state, teamId)
    if (!found) continue
    const idx = found.player.teams.findIndex((team) => team.id === teamId)
    const letter = idx >= 0 && idx < 26 ? String.fromCharCode(65 + idx) : '?'
    parts.push(`${found.player.name}'s team ${letter}`)
  }
  for (const raw of resume.picked) {
    if (!raw.startsWith('player:')) continue
    const id = Number(raw.slice(7))
    if (Number.isFinite(id) && state.players[id]) parts.push(state.players[id]!.name)
  }
  for (const raw of resume.picked) {
    if (!raw.startsWith('attr:')) continue
    parts.push(raw.slice(5))
  }
  return [...new Set(parts)].join(', ')
}
