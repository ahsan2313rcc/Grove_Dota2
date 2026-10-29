import { HERO_BY_ID, ITEM_BY_ID, display } from './catalog.ts'
import {
  addHand,
  allLocs,
  arrived,
  ask,
  attrsOf,
  bounce,
  canTargetHero,
  comboLocked,
  discardRandom,
  discardUid,
  enqueue,
  enterReason,
  extract,
  findHero,
  foe,
  opponents,
  graveLocked,
  heroChoices,
  heroWeight,
  intelCount,
  log,
  mostRecentEnemy,
  newTeam,
  seatTeam,
  TEAM_CAP,
  noteTargets,
  pname,
  pullTop,
  putOnTeam,
  queueDraw,
  randomFrom,
  rangedCount,
  refracts,
  releaseHeld,
  removeHand,
  removeHero,
  setPlayer,
  settingKinds,
  shuffle,
  strengthCount,
  teamById,
  teamChoices,
  teamSize,
  toExile,
  toGrave,
  topReward,
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
): Ask {
  if (min > 0 && choices.length === 0) return fizzle('No legal target.')
  return { type: 'ask', q: { actor, prompt, choices, min, max, mode } }
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
  if (HERO_BY_ID[resume.defId]) {
    if (state.silence) return log(state, 'Global Silence stops the ability.')
    const source = findHero(state, resume.sourceUid)
    if (source?.hero.muted) return log(state, 'Orchid stops the ability.')
  }
  if (!resume.armed) {
    const asked = questions(state, resume)
    if (asked.type === 'fizzle') return log(state, asked.text)
    if (asked.type === 'ask') {
      return ask(state, { ...asked.q, resume })
    }
    const pickedHeroes = heroIds(resume.picked)
    const pickedTeams = rawTeams(resume.picked)
    if (sourceKind(resume.defId) === 'ability') state = noteTargets(state, resume.actor, pickedHeroes, pickedTeams)
    const countered = refracts(state, resume.actor, pickedHeroes)
    if (countered.stopped) return countered.state
    let armed = { ...resume, armed: true }
    if (state.multicast === resume.actor && !resume.echo) {
      state = {
        ...countered.state,
        multicast: null,
        echoes: [...countered.state.echoes, { ...armed, picked: [], steps: 0, armed: false, echo: true }],
      }
    } else {
      state = countered.state
    }
    resume = armed
  }
  return effect(state, resume)
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
    case 'doom':
    case 'legion_commander':
    case 'night_stalker':
    case 'phoenix':
    case 'pudge':
    case 'slardar':
    case 'bloodseeker':
    case 'lina':
    case 'lion':
    case 'necrophos':
    case 'queen_of_pain':
    case 'vengeful_spirit':
    case 'viper':
    case 'bane':
    case 'batrider':
    case 'dagon':
    case 'scythe':
    case 'gloves':
    case 'illusion':
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
        return ready()
      }
      if (at > 0) return ready()
      if (resume.defId === 'night_stalker' || resume.defId === 'queen_of_pain' || resume.defId === 'bane' || resume.defId === 'gloves') {
        return pose(actor, 'Choose an opponent.', opponentChoices(state, actor))
      }
      return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
    case 'shadow_shaman':
      if (at === 0) {
        return pose(actor, 'Destroy Shadow Shaman to destroy an enemy?', [
          { id: 'yes', label: 'Destroy Shadow Shaman' },
          { id: 'no', label: 'Keep Shadow Shaman' },
        ])
      }
      if (resume.picked.includes('no')) return ready()
      if (at === 1) return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
      return ready()
    case 'phantom_assassin':
      if (at > 0) return ready()
      return pose(actor, 'Choose an enemy hero in a team of 1 or 5.', enemyHeroes(state, actor, kind, (uid) => {
        const loc = findHero(state, uid)
        return !!loc && (teamSize(loc.team) === 1 || teamSize(loc.team) === 5)
      }))
    case 'sniper':
      if (at > 0) return ready()
      return pose(actor, 'Choose an enemy hero in a team of 4 or 5.', enemyHeroes(state, actor, kind, (uid) => {
        const loc = findHero(state, uid)
        return !!loc && teamSize(loc.team) >= 4
      }))
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
      return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
    case 'bkb':
    case 'shadow_blade':
      if (at > 0) return ready()
      return pose(actor, 'Choose a hero.', heroChoices(state, actor, kind, () => true))
    case 'greaves': {
      if (at > 0) return ready()
      const hand = state.players[actor].hand
      const count = Math.min(2, hand.length)
      if (count === 0) return ready()
      return pose(actor, 'Discard 2 cards.', handCards(state, actor), count, count)
    }
    case 'satanic':
      if (at === 0) return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
      if (at === 1) return pose(actor, 'Choose a team you control.', ownTeams(state, actor, true))
      if (at === 2) return pose(actor, 'Fire that ability now?', [{ id: 'yes', label: 'Fire it' }, { id: 'no', label: 'Leave it' }])
      return ready()
    case 'tormentor':
      if (at > 0) return ready()
      return pose(actor, 'Choose a hero that entered a team this turn.', heroChoices(state, actor, 'reward', (loc) => state.enteredThisTurn.includes(loc.hero.uid)))
    case 'earthshaker':
    case 'sven':
    case 'enigma':
    case 'rapier':
    case 'luna':
    case 'warlock':
    case 'winter_wyvern':
    case 'beastmaster':
    case 'puck':
    case 'jakiro':
    case 'medusa':
    case 'techies':
    case 'primal_beast':
    case 'snapfire':
      if (at > 1 && (resume.defId === 'primal_beast' || resume.defId === 'winter_wyvern' || resume.defId === 'beastmaster')) return ready()
      if (at > 0 && resume.defId !== 'primal_beast' && resume.defId !== 'winter_wyvern' && resume.defId !== 'beastmaster') return ready()
      if (resume.defId === 'sven' && home && strengthCount(state, home.team) < 3) return fizzle("God's Strength needs 3 Strength heroes in this team.")
      if (resume.defId === 'primal_beast' || resume.defId === 'winter_wyvern' || resume.defId === 'beastmaster') {
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
        if (resume.defId === 'beastmaster') {
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
        return pose(actor, 'Choose up to 2 heroes in that team.', found.team.heroes.map((hero) => ({
          id: `hero:${hero.uid}`,
          label: display(hero.defId).name,
          defId: hero.defId,
        })), 1, Math.min(2, found.team.heroes.length))
      }
      if (resume.defId === 'earthshaker') {
        return pose(actor, 'Choose an enemy team of 3 or more.', teamChoices(state, actor, kind, (team, player) => player.id !== actor && teamSize(team) >= 3))
      }
      return pose(actor, 'Choose an enemy team.', teamChoices(state, actor, kind, (_team, player) => player.id !== actor))
    case 'drow_ranger':
      if (at > 0) return ready()
      if (!home || rangedCount(state, home.team) < 3) return fizzle('Marksmanship needs 3 Ranged heroes in this team.')
      return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
    case 'juggernaut': {
      if (at > 0) return ready()
      const max = home ? teamSize(home.team) : 1
      return pose(actor, `Destroy up to ${max} enemy heroes.`, enemyHeroes(state, actor, kind), 1, max)
    }
    case 'gyrocopter':
      return askAttrHeroes(state, resume, (playerId) => playerId !== actor)
    case 'spectre':
      return askAttrByTeam(state, resume, enemy)
    case 'tiny':
    case 'enchantress':
    case 'force_staff':
      if (at === 0) return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
      if (at > 1) return ready()
      {
        const uid = heroIds(resume.picked)[0]
        const loc = uid ? findHero(state, uid) : null
        if (!loc) return fizzle('That hero is gone.')
        if (resume.defId === 'tiny' || resume.defId === 'force_staff') {
          const choices = teamChoices(state, actor, kind, (team, player) => player.id === loc.hero.owner && team.id !== loc.team.id)
          if (state.players[loc.hero.owner].teams.length < TEAM_CAP) {
            choices.push({ id: `new:${loc.hero.owner}`, label: `New team for ${pname(state, loc.hero.owner)}` })
          }
          return pose(actor, 'Choose a team its owner controls.', choices)
        }
        return pose(actor, 'Choose a team you own.', ownTeams(state, actor, true).filter((choice) => choice.id !== `team:${home?.team.id}`))
      }
    case 'lifestealer':
      if (at === 0) return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
      if (at === 1) return pose(actor, 'Choose a team you own.', ownTeams(state, actor, true))
      if (at === 2) {
        return pose(actor, 'Fire that ability now?', [
          { id: 'yes', label: 'Fire it' },
          { id: 'no', label: 'Leave it' },
        ])
      }
      return ready()
    case 'blink':
      if (at === 0) return pose(actor, 'Choose a hero you own.', ownHeroes(state, actor, kind))
      if (at > 1) return ready()
      {
        const uid = heroIds(resume.picked)[0]
        const loc = uid ? findHero(state, uid) : null
        const choices = ownTeams(state, actor, true).filter((choice) => choice.id !== `team:${loc?.team.id}`)
        return pose(actor, 'Choose another team.', choices)
      }
    case 'underlord':
      if (at === 0) return pose(actor, 'Choose up to 5 heroes you own.', ownHeroes(state, actor, kind), 1, 5)
      if (at > 1) return ready()
      return pose(actor, 'Choose the team they enter.', ownTeams(state, actor, true))
    case 'tp_scroll':
      if (at === 0) return pose(actor, 'Choose a hero you control.', ownHeroes(state, actor, kind))
      if (at > 1) return ready()
      {
        const uid = heroIds(resume.picked)[0]
        const loc = uid ? findHero(state, uid) : null
        const choices = ownTeams(state, actor, true).filter((choice) => choice.id !== `team:${loc?.team.id}`)
        return pose(actor, 'Choose another team.', choices)
      }
    case 'marci':
      if (at === 0) {
        return pose(actor, 'Choose an allied hero.', ownHeroes(state, actor, kind).filter((choice) => {
          const uid = choice.id.slice(5)
          return uid !== resume.sourceUid
        }))
      }
      if (at > 1) return ready()
      {
        const uid = heroIds(resume.picked)[0]
        const loc = uid ? findHero(state, uid) : null
        if (!loc || !home) return fizzle('That hero is gone.')
        if (loc.team.id === home.team.id) return pose(actor, 'Choose a team to send them to.', ownTeams(state, actor, true).filter((choice) => choice.id !== `team:${home.team.id}`))
        return ready()
      }
    case 'hoodwink': {
      if (at > 0) return ready()
      const heroes = heroChoices(state, actor, kind, () => true)
      const combos: Choice[] = []
      for (const player of state.players) {
        for (const combo of player.combos) {
          if (comboLocked(state, combo.id)) continue
          combos.push({ id: `combo:${combo.id}`, label: `${combo.kind} combo`, hint: `${combo.points} pts` })
        }
      }
      return pose(actor, 'Choose a hero or a setting combo.', [...heroes, ...combos])
    }
    case 'windranger':
      if (at === 0) {
        const combos = state.players[actor].combos.filter((combo) => !comboLocked(state, combo.id))
        return pose(actor, 'Destroy one of your setting combos.', combos.map((combo) => ({ id: `combo:${combo.id}`, label: `${combo.kind} combo`, hint: `${combo.points}` })))
      }
      if (at > 1) return ready()
      return pose(actor, 'Choose an enemy team.', teamChoices(state, actor, kind, (_team, player) => player.id !== actor))
    case 'treant_protector': {
      if (at > 0) return ready()
      const combos: Choice[] = []
      for (const player of state.players) {
        for (const combo of player.combos) {
          combos.push({
            id: `combo:${combo.id}`,
            label: `${pname(state, player.id)} · ${combo.kind === 'mixed' ? 'mixed path' : `three ${combo.kind}s`}`,
            hint: `${combo.points} points`,
          })
        }
      }
      return pose(actor, 'Choose a setting combo to protect.', combos)
    }
    case 'grimstroke':
      if (at > 0) return ready()
      return pose(actor, 'Choose two enemy heroes.', enemyHeroes(state, actor, kind), 2, 2)
    case 'monkey_king':
    case 'disruptor':
    case 'earth_spirit':
    case 'shadow_demon':
    case 'oracle':
      if (at > 0) return ready()
      if (resume.defId === 'oracle') return pose(actor, 'Choose an allied hero.', ownHeroes(state, actor, kind))
      if (resume.defId === 'monkey_king') return pose(actor, 'Choose a hero.', heroChoices(state, actor, kind, () => true))
      return pose(actor, 'Choose a hero.', resume.defId === 'shadow_demon'
        ? heroChoices(state, actor, kind, () => true)
        : enemyHeroes(state, actor, kind))
    case 'omniknight':
    case 'tusk':
    case 'dazzle':
    case 'dawnbreaker':
    case 'shield':
      if (at > 0) return ready()
      if (resume.defId === 'dawnbreaker') {
        const allies = home ? home.team.heroes.filter((hero) => hero.uid !== resume.sourceUid && hero.controller === actor) : []
        return pose(actor, 'Choose an allied hero in this team.', allies.map((hero) => ({ id: `hero:${hero.uid}`, label: display(hero.defId).name, defId: hero.defId })))
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
      if (resume.defId === 'zeus' || resume.defId === 'gem') {
        if (at > 0) return ready()
        return pose(actor, resume.defId === 'gem' ? 'Steal a card you see.' : 'Discard a card you see.', handCards(state, enemy), 1, 1, 'pick')
      }
      if (resume.defId === 'ward' || resume.defId === 'bounty_hunter') {
        if (at > 0) return ready()
        return pose(actor, `${pname(state, enemy)}'s hand.`, [...handCards(state, enemy), { id: 'ok', label: 'Done' }], 1, 1, 'look')
      }
      if (resume.defId === 'pangolier') {
        if (at === 0) {
          return pose(actor, 'Name a card type.', [
            { id: 'type:hero', label: 'Hero' },
            { id: 'type:item', label: 'Item' },
            { id: 'type:setting', label: 'Setting' },
          ])
        }
        if (at > 1) return ready()
        const kindName = resume.picked.find((id) => id.startsWith('type:'))?.slice(5)
        return pose(actor, 'Take one.', handCards(state, enemy, (card) => card.kind === kindName))
      }
      if (resume.defId === 'outworld_destroyer') {
        if (at === 0) {
          return pose(enemy, 'Discard 4 cards, or exile one of your heroes.', [
            { id: 'mode:discard', label: 'Discard 4' },
            { id: 'mode:exile', label: 'Exile a hero' },
          ])
        }
        if (resume.picked.includes('mode:exile') && at === 1) {
          return pose(enemy, 'Exile one of your heroes.', ownHeroes(state, enemy, 'ability'))
        }
        return ready()
      }
      if (resume.defId === 'ringmaster') {
        if (at === 0) {
          return pose(enemy, 'Discard your hand, or let a team be destroyed.', [
            { id: 'mode:discard', label: 'Discard your hand' },
            { id: 'mode:team', label: 'Offer a team' },
          ])
        }
        if (resume.picked.includes('mode:team') && at === 1) {
          return pose(actor, 'Destroy an enemy team.', teamChoices(state, actor, kind, (_team, player) => player.id !== actor))
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
        return !!loc && loc.hero.defId !== 'rubick' && !!HERO_BY_ID[loc.hero.defId] && HERO_BY_ID[loc.hero.defId].timing !== 'aura'
      }))
    case 'keeper_of_the_light':
    case 'refresher':
    case 'arcane':
      if (at > 0) return ready()
      return pose(actor, 'Choose a hero you own with an ability to cast.', ownHeroes(state, actor, kind).filter((choice) => {
        const loc = findHero(state, choice.id.slice(5))
        return !!loc && HERO_BY_ID[loc.hero.defId]?.timing !== 'aura'
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
    case 'heart':
    case 'lotus':
    case 'clinkz':
      if (graveLocked(state, actor)) return fizzle('Muerta keeps the grave shut.')
      if (at > 0) return ready()
      return pose(actor, 'Choose a hero in the grave.', graveHeroes(state))
    case 'storm_spirit':
      if (at > 0) return ready()
      return pose(actor, 'Discard any number of cards. Gain that many actions.', handCards(state, actor), 0, Math.max(1, state.players[actor].hand.length))
    case 'clarity':
    case 'dragon_knight': {
      if (at > 0) return ready()
      const kinds = ['river', 'jungle', 'lane'].filter((id) => state.deck.some((card) => card.defId === id))
      return pose(actor, 'Search for a setting.', kinds.map((id) => ({ id: `type:${id}`, label: display(id).name, defId: id })))
    }
    case 'euls':
      if (at > 0) return ready()
      return pose(actor, 'Set a hero aside.', heroChoices(state, actor, kind, () => true))
    case 'glyph':
      if (at > 0) return ready()
      return pose(actor, 'Choose a team.', teamChoices(state, actor, 'reward', () => true))
    case 'gate':
      if (at > 0) return ready()
      return pose(actor, 'Choose two teams to merge.', ownTeams(state, actor, false), 2, 2)
    case 'lich':
      if (at === 0) return pose(actor, 'Choose an enemy hero.', enemyHeroes(state, actor, kind))
      if (at > 1) return ready()
      {
        const uid = heroIds(resume.picked)[0]
        const loc = uid ? findHero(state, uid) : null
        if (!loc) return fizzle('That hero is gone.')
        const more = allLocs(state).filter((other) => other.hero.controller === loc.hero.controller && other.team.id !== loc.team.id && other.hero.uid !== loc.hero.uid)
        if (more.length === 0) return ready()
        return pose(actor, 'Choose a hero in a different team.', more.map((other) => ({
          id: `hero:${other.hero.uid}`,
          label: display(other.hero.defId).name,
          defId: other.hero.defId,
        })))
      }
    case 'sand_king':
      if (at > 0) return ready()
      return pose(enemy, 'Destroy one hero you control.', ownHeroes(state, enemy, 'ability'))
    case 'morphling':
    case 'razor':
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
    enqueue(current, uid, cause, force, true, actor)

  switch (resume.defId) {
    case 'axe':
      return discardRandom(log(state, "Berserker's Call."), enemy, 2)
    case 'chaos_knight':
    case 'natures_prophet':
    case 'snapfire':
      return spray(state, resume)
    case 'gyrocopter':
    case 'spectre':
      return heroes.reduce((current, uid) => kill(current, uid, display(resume.defId).name), state)
    case 'clockwerk':
    case 'batrider':
      return pullIn(state, resume, heroes[0], resume.defId === 'batrider')
    case 'doom':
      if (!heroes[0]) return state
      state = setPlayer(state, controllerOf(state, heroes[0]) ?? enemy, (player) => ({ ...player, noHeroNext: true }))
      return kill(state, heroes[0], display(resume.defId).name)
    case 'scythe':
      return exileBoard(state, heroes[0])
    case 'earth_spirit':
      return toDeck(state, heroes[0], 'bottom')
    case 'disruptor':
      return toDeck(state, heroes[0], 'top')
    case 'earthshaker':
    case 'sven':
    case 'enigma':
    case 'rapier':
      if (!teams[0]) return state
      return destroyTeam(state, teams[0], display(resume.defId).name, actor, false)
    case 'kunkka':
      return startKunkka(state, actor)
    case 'largo':
      return state.players.reduce((current, player) => queueDraw(current, player.id, 2), log(state, 'Catchy Lilt.'))
    case 'legion_commander':
      state = kill(state, resume.sourceUid, 'Duel')
      if (heroes[0]) state = kill(state, heroes[0], 'Duel')
      return state
    case 'lifestealer':
      return infest(state, resume, heroes[0], teamIds(resume.picked).at(-1) ?? `new:${actor}`)
    case 'night_stalker':
      return stealRandom(state, enemy, actor, 2)
    case 'ogre_magi':
      return log({ ...state, multicast: actor }, 'Multicast is primed.')
    case 'omniknight':
      if (!heroes[0]) return state
      return log(editFlag(state, heroes[0], (hero) => ({ ...hero, omni: true })), 'Guardian Angel watches.')
    case 'phoenix':
      if (heroes[0]) state = exileBoard(state, heroes[0])
      return exileBoard(state, resume.sourceUid)
    case 'shadow_shaman':
      if (!resume.picked.includes('yes')) return log(state, 'Shackles passes.')
      if (heroes[0]) state = kill(state, heroes[0], 'Shackles')
      return kill(state, resume.sourceUid, 'Shackles')
    case 'dragon_knight':
      return searchSetting(state, actor, resume.picked.find((id) => id.startsWith('type:'))?.slice(5) ?? '', 'Elder Dragon Form')
    case 'primal_beast':
    case 'juggernaut':
      return heroes.reduce((current, uid) => kill(current, uid, display(resume.defId).name), state)
    case 'pudge':
      return hook(state, resume)
    case 'slardar':
      if (!heroes[0]) return state
      return log(editFlag(state, heroes[0], (hero) => ({ ...hero, attrMode: 'none' })), 'Corrosive Haze strips an attribute.')
    case 'spirit_breaker': {
      const recent = mostRecentEnemy(state, actor)
      if (!recent) return log(state, 'No enemy hero has entered a team.')
      return kill(state, recent.uid, 'Charge of Darkness')
    }
    case 'tidehunter': {
      const kept = home?.team.id
      return allLocs(state)
        .filter((loc) => loc.team.id !== kept && !loc.hero.token)
        .reduce((current, loc) => bounce(current, loc.hero.uid, 'Ravage'), log(state, 'Ravage.'))
    }
    case 'timbersaw': {
      const found = teams[0] ? teamById(state, teams[0]) : null
      if (!found) return state
      return found.team.heroes.reduce((current, hero) => {
        return attrsOf(current, hero).includes('STR') ? kill(current, hero.uid, 'Whirling Death') : current
      }, state)
    }
    case 'tiny':
    case 'force_staff':
    case 'blink':
    case 'underlord':
    case 'tp_scroll':
    case 'marci':
    case 'enchantress':
      return relocate(state, resume)
    case 'treant_protector':
      return protectCombo(state, resume)
    case 'tusk':
      state = editFlag(state, resume.sourceUid, (hero) => ({ ...hero, ward: stamp }))
      if (heroes[0]) state = editFlag(state, heroes[0], (hero) => ({ ...hero, ward: stamp }))
      return log(state, 'Snowball.')
    case 'undying':
    case 'heart':
    case 'lotus':
      return fromGrave(state, actor, cards[0])
    case 'anti_mage':
      return allLocs(state)
        .filter((loc) => attrsOf(state, loc.hero).includes('INT'))
        .reduce((current, loc) => kill(current, loc.hero.uid, 'Mana Void'), log(state, 'Mana Void.'))
    case 'phantom_assassin':
    case 'sniper':
    case 'drow_ranger':
    case 'tormentor':
    case 'dagon':
      if (!heroes[0]) return state
      return kill(state, heroes[0], display(resume.defId).name)
    case 'bloodseeker':
      if (!heroes[0]) return state
      return log(editFlag(state, heroes[0], (hero) => ({ ...hero, rupture: true })), 'Rupture.')
    case 'bounty_hunter':
    case 'ward':
      return log({ ...state, reveal: [...state.reveal, { viewer: actor, target: enemy, turn: state.turn }] }, `${pname(state, actor)} sees ${pname(state, enemy)}'s hand.`)
    case 'broodmother':
      return brood(state, actor)
    case 'clinkz':
      return pact(state, resume, cards[0])
    case 'faceless_void': {
      let next = state
      for (const player of state.players) {
        if (player.id === actor) continue
        next = setPlayer(next, player.id, (current) => ({ ...current, skip: true }))
      }
      return log(next, 'Chronosphere. Enemies skip their next turn.')
    }
    case 'hoodwink':
      return shoot(state, resume)
    case 'lone_druid':
      return topReward({ ...state, active: actor }, 'towers')
    case 'luna':
      return eclipse(state, actor, teams[0])
    case 'medusa':
      return exileTeam(state, teams[0], 'Stone Gaze')
    case 'mirana':
      return arrow(state, resume)
    case 'monkey_king':
      return strike(state, heroes[0], actor)
    case 'morphling':
    case 'razor':
      return imprison(state, resume, heroes[0])
    case 'naga_siren':
      return log({ ...state, naga: stamp }, 'Song of the Siren. Heroes cannot be destroyed.')
    case 'shadow_fiend':
      return state
    case 'troll_warlord':
      return log({ ...state, troll: { player: actor, turn: state.turn } }, 'Battle Trance.')
    case 'terrorblade':
      return sunder(state, teams[0], teams[1])
    case 'vengeful_spirit':
      return netherSwap(state, resume.sourceUid, heroes[0])
    case 'viper':
      if (!heroes[0]) return state
      {
        const loc = findHero(state, heroes[0])
        if (!loc) return state
        return log(
          { ...state, viper: [...state.viper, { uid: heroes[0], owner: loc.hero.owner, fromTurn: state.turn }] },
          'Viper Strike will land at the start of their next turn.',
        )
      }
    case 'weaver':
      return lapse(state)
    case 'chen':
      return topReward({ ...state, active: actor }, 'neutrals')
    case 'crystal_maiden': {
      const room = state.players[actor].handLimit - state.players[actor].hand.length
      return queueDraw(log(state, 'Arcane Aura.'), actor, Math.max(0, room))
    }
    case 'dark_seer':
    case 'double_damage':
      if (resume.defId === 'double_damage' && state.active !== actor) return log(state, 'Double Damage only works on your turn.')
      return log(setPlayer(state, actor, (player) => ({ ...player, actions: player.actions + 2 })), `${pname(state, actor)} gains 2 actions.`)
    case 'dark_willow': {
      let next = log(state, 'Terrorize.')
      for (const id of [actor, enemy] as const) {
        next = discardRandom(next, id, state.players[id].teams.length)
      }
      return next
    }
    case 'grimstroke':
      if (heroes.length < 2) return state
      return log(
        { ...state, soulbind: [...state.soulbind, { a: heroes[0]!, b: heroes[1]!, turn: state.turn }] },
        'Soulbind.',
      )
    case 'invoker':
      state = state.players.reduce((current, player) => dump(current, player.id), log(state, 'Cataclysm.'))
      return state.players.reduce((current, player) => queueDraw(current, player.id, 3), state)
    case 'jakiro':
      if (!teams[0]) return state
      return log(updateTeamTimed(state, teams[0], 'noEnter', stamp), 'Ice Path.')
    case 'keeper_of_the_light':
    case 'refresher':
    case 'arcane':
      return recast(state, actor, heroes[0])
    case 'leshrac':
      return nova(state, actor)
    case 'lich':
      return heroes.reduce((current, uid) => kill(current, uid, 'Chain Frost'), state)
    case 'lina':
      if (!heroes[0]) return state
      return kill(state, heroes[0], 'Laguna Blade', true)
    case 'lion':
      return exileHand(state, enemy, cards[0])
    case 'necrophos':
      if (!heroes[0]) return state
      return exileBoard(state, heroes[0])
    case 'oracle':
      if (!heroes[0]) return state
      return toHand(state, heroes[0], actor, 'False Promise')
    case 'outworld_destroyer':
      if (resume.picked.includes('mode:discard')) return discardRandom(log(state, "Sanity's Eclipse."), enemy, 4)
      if (heroes[0]) return exileBoard(state, heroes[0])
      return state
    case 'puck':
      if (!teams[0]) return state
      state = updateTeamTimed(state, teams[0], 'noEnter', stamp)
      return log(updateTeamTimed(state, teams[0], 'noLeave', stamp), 'Dream Coil.')
    case 'queen_of_pain':
      state = dump(log(state, 'Sonic Wave.'), enemy)
      return queueDraw(state, enemy, 1)
    case 'ringmaster':
      if (resume.picked.includes('mode:discard')) return dump(log(state, 'The wheel spins.'), enemy)
      if (teams[0]) return destroyTeam(state, teams[0], 'Wheel of Wonder', actor, false)
      return state
    case 'rubick':
      return stealSpell(state, actor, resume.sourceUid, heroes[0])
    case 'shadow_demon':
      if (!heroes[0]) return state
      state = bounce(state, heroes[0], 'Disruption')
      return {
        ...state,
        sdBan: [...state.sdBan, { uid: heroes[0], sdUid: resume.sourceUid, caster: actor }],
      }
    case 'silencer':
      return log({ ...state, silence: stamp }, 'Global Silence.')
    case 'skywrath_mage':
      return discardRandom(log(state, 'Mystic Flare.'), enemy, home ? intelCount(state, home.team) : 1)
    case 'storm_spirit': {
      const discarded = cards.length
      let next = state
      for (const uid of cards) next = discardUid(next, actor, uid)
      return log(setPlayer(next, actor, (player) => ({ ...player, actions: player.actions + discarded })), `Ball Lightning grants ${discarded} actions.`)
    }
    case 'tinker':
      return rearm(state, resume, cards[0])
    case 'warlock':
      if (!teams[0]) return state
      return log({ ...state, bonds: [...state.bonds, { teamId: teams[0], turn: state.turn }] }, 'Fatal Bonds.')
    case 'winter_wyvern':
      return curse(state, teams[0], heroes[0], actor)
    case 'witch_doctor':
      return log({ ...state, maledict: [...state.maledict, { player: enemy, turn: state.turn }] }, 'Maledict.')
    case 'zeus':
      if (!cards[0]) return state
      return discardUid(log(state, "Thundergod's Wrath."), enemy, cards[0])
    case 'arc_warden':
      return topReward({ ...state, active: actor }, 'runes')
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
    case 'io':
      return startIo(state, actor)
    case 'magnus':
      return polarity(state, enemy, heroes)
    case 'sand_king':
      if (!heroes[0]) return state
      return kill(state, heroes[0], 'Epicenter')
    case 'techies':
      return mine(state, teams[0])
    case 'visage':
      return queueDraw(log(state, 'Soul Assumption.'), actor, state.graveThisTurn)
    case 'void_spirit':
      return swapHands(state, actor, enemy)
    case 'windranger':
      return focus(state, resume, actor)
    case 'haste':
      return queueDraw(state, actor, 1)
    case 'regen':
      return regen(state, actor)
    case 'clarity':
      return searchSetting(state, actor, resume.picked.find((id) => id.startsWith('type:'))?.slice(5) ?? '')
    case 'gloves':
      return stealRandom(state, enemy, actor, 1)
    case 'abyssal': {
      const where = resume.picked.includes('deck:bottom') ? 'bottom' : 'top'
      state = toDeck(state, heroes[0], where)
      return queueDraw(state, actor, 1)
    }
    case 'gem':
      if (!cards[0]) return state
      state = { ...state, reveal: [...state.reveal, { viewer: actor, target: enemy, turn: state.turn }] }
      return give(state, enemy, actor, cards[0])
    case 'orchid':
      if (!heroes[0]) return state
      return log(editFlag(state, heroes[0], (hero) => ({ ...hero, muted: true })), 'Orchid stops that hero from firing.')
    case 'bkb':
      if (!heroes[0]) return state
      return log(editFlag(state, heroes[0], (hero) => ({ ...hero, bkb: stamp })), 'Black King Bar.')
    case 'assault':
      return log(setPlayer(state, actor, (player) => ({ ...player, actions: player.actions + 3 })), 'Assault Cuirass grants 3 actions.')
    case 'shivas':
      return state.players.reduce((current, player) => (player.id === actor ? current : discardRandom(current, player.id, 1)), log(state, "Shiva's Guard."))
    case 'halberd':
      return log(setPlayer(state, enemy, (player) => ({ ...player, noHeroNext: true })), "Heaven's Halberd.")
    case 'greaves':
      return greaves(state, actor, cards)
    case 'satanic':
      return satanic(state, resume)
    case 'euls':
      return eul(state, heroes[0])
    case 'glyph':
      if (!teams[0]) return state
      return log(updateTeamTimed(state, teams[0], 'glyph', stamp), 'Glyph.')
    case 'gate':
      return mergeTeams(state, rawTeams(resume.picked), actor)
    case 'illusion':
      if (!heroes[0]) return state
      {
        const loc = findHero(state, heroes[0])
        state = bounce(state, heroes[0], 'Illusion')
        if (!loc) return state
        return discardRandom(state, loc.hero.owner, 1)
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

function updateTeamTimed(state: Game, teamId: string, key: 'noEnter' | 'noLeave' | 'glyph', value: Game['silence']): Game {
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

function exileBoard(state: Game, uid: string | undefined): Game {
  if (!uid) return state
  const removed = removeHero(state, uid)
  if (!removed.hero) return state
  const card: CardInst = { uid: removed.hero.uid, defId: removed.hero.defId, kind: removed.hero.token ? 'neutral' : 'hero' }
  return toExile(removed.state, card)
}

function toDeck(state: Game, uid: string | undefined, where: 'top' | 'bottom'): Game {
  if (!uid) return state
  const removed = removeHero(state, uid)
  if (!removed.hero) return state
  const card: CardInst = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' }
  const deck = where === 'top' ? [card, ...removed.state.deck] : [...removed.state.deck, card]
  return log({ ...removed.state, deck }, `${display(card.defId).name} goes to the ${where} of the deck.`)
}

function toHand(state: Game, uid: string, player: PlayerId, cause: string): Game {
  const removed = removeHero(state, uid)
  if (!removed.hero) return state
  const card: CardInst = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' }
  return log(addHand(removed.state, player, [card]), `${cause} returns ${display(card.defId).name} to hand.`)
}

function dump(state: Game, id: PlayerId): Game {
  let next = state
  for (const card of [...state.players[id].hand]) next = discardUid(next, id, card.uid)
  return next
}

function give(state: Game, from: PlayerId, to: PlayerId, uid: string): Game {
  const card = state.players[from].hand.find((entry) => entry.uid === uid)
  if (!card) return state
  return log(addHand(removeHand(state, from, uid), to, [card]), `${pname(state, to)} takes a card.`)
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
  const moved = moveOnto(state, uid, home.player.id, home.team.id)
  if (!lasso) return moved
  const loc = findHero(moved, uid)
  if (!loc) return moved
  return {
    ...moved,
    lassos: [...moved.lassos, { uid, caster: resume.actor, owner: loc.hero.owner, fromTurn: state.turn }],
  }
}

function moveOnto(state: Game, uid: string, destPlayer: PlayerId, destTeam: string): Game {
  const loc = findHero(state, uid)
  if (!loc) return state
  if (loc.hero.controller !== destPlayer && (loc.hero.bkb || loc.player.bkb)) return log(state, 'Black King Bar prevents the theft.')
  if (loc.team.noLeave) return log(state, 'Dream Coil holds them in place.')
  const creating = destTeam === 'new' || destTeam === `new:${destPlayer}`
  if (!creating && loc.team.id === destTeam) return state
  if (loc.hero.rupture && !loc.hero.bkb) return enqueue(state, uid, 'Rupture', false, true, null)
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
  const placed = putOnTeam(next, destPlayer, teamId, { ...pulled.hero, controller: destPlayer })
  return arrived(placed, uid).state
}

function infest(state: Game, resume: CastResume, uid: string | undefined, dest: string): Game {
  state = enqueue(state, resume.sourceUid, 'Infest', false, true, resume.actor)
  if (!uid) return state
  state = moveOnto(state, uid, resume.actor, dest)
  const landed = findHero(state, uid)
  if (!landed || landed.hero.controller !== resume.actor) return state
  if (!resume.picked.includes('yes')) return log(state, 'Infest leaves the stolen ability quiet.')
  if (state.silence || landed.hero.muted) return log(state, 'The stolen ability does not fire.')
  if (HERO_BY_ID[landed.hero.defId]?.timing === 'aura') return log(state, 'That hero has no ability to fire.')
  state = cast(log(state, 'Infest fires the stolen ability this turn.'), {
    kind: 'cast',
    actor: resume.actor,
    sourceUid: uid,
    defId: landed.hero.defId,
    picked: [],
    steps: 0,
  })
  // Once-only this turn — no second voluntary cast after Infest's free fire.
  if (findHero(state, uid)) state = editFlag(state, uid, (hero) => ({ ...hero, castTurn: state.turn }))
  return state
}

function relocate(state: Game, resume: CastResume): Game {
  const heroes = heroIds(resume.picked)
  const destinations = [...resume.picked.filter((id) => id.startsWith('team:') || id.startsWith('new'))]
  if (resume.defId === 'underlord' || resume.defId === 'tp_scroll') {
    const dest = destinations[0]
    if (!dest) return state
    return heroes.reduce((current, uid) => moveOnto(current, uid, resume.actor, dest), state)
  }
  if (resume.defId === 'marci') {
    const uid = heroes[0]
    const home = here(state, resume)
    if (!uid || !home) return state
    const loc = findHero(state, uid)
    if (!loc) return state
    const dest = loc.team.id === home.team.id ? destinations[0] : `team:${home.team.id}`
    if (!dest) return state
    return moveOnto(state, uid, resume.actor, dest.startsWith('team:') ? dest.slice(5) : dest)
  }
  const uid = heroes[0]
  const dest = destinations[0]
  if (!uid || !dest) return state
  const owner = resume.defId === 'tiny' || resume.defId === 'force_staff' ? findHero(state, uid)?.hero.owner ?? resume.actor : resume.actor
  return moveOnto(state, uid, owner, dest.startsWith('team:') ? dest.slice(5) : dest)
}

function protectCombo(state: Game, resume: CastResume): Game {
  const comboId = resume.picked.find((id) => id.startsWith('combo:'))?.slice(6)
  if (!comboId) return state
  return {
    ...log(state, 'Living Armor protects a setting.'),
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
  return log(next, 'A setting combo is destroyed.')
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

function brood(state: Game, actor: PlayerId): Game {
  const found = state.deck.findIndex((card) => card.kind === 'setting')
  if (found < 0) return log(state, 'Spin Web finds no setting.')
  const taken = state.deck[found]
  if (!taken) return state
  const rest = state.deck.slice(0, found)
  const deck = [...state.deck.slice(found + 1), ...rest]
  return log(addHand({ ...state, deck }, actor, [taken]), `Spin Web takes ${display(taken.defId).name}.`)
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

function eclipse(state: Game, actor: PlayerId, teamId: string | undefined): Game {
  const found = teamId ? teamById(state, teamId) : null
  if (!found) return state
  let next = state
  const banned = new Set<string>()
  const hits = teamSize(found.team)
  for (let count = 0; count < hits; count += 1) {
    const pool = allLocs(next).filter((loc) => loc.hero.controller !== actor && !banned.has(loc.hero.uid))
    const [rolled, hit] = randomFrom(next, pool)
    if (!hit) break
    banned.add(hit.hero.uid)
    next = enqueue(rolled, hit.hero.uid, 'Eclipse', false, true, actor)
  }
  return next
}

function spray(state: Game, resume: CastResume): Game {
  const actor = resume.actor
  if (resume.defId === 'chaos_knight') {
    const pool = allLocs(state).filter((loc) => loc.hero.controller !== actor)
    const [next, hit] = randomFrom(state, pool)
    if (!hit) return log(next, 'Chaos Bolt finds no one.')
    return enqueue(next, hit.hero.uid, 'Chaos Bolt', false, true, actor)
  }
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
  const kinds = settingKinds(state, actor)
  let next = state
  const banned = new Set<string>()
  for (let count = 0; count < kinds.size; count += 1) {
    const pool = allLocs(next).filter((loc) => loc.hero.controller !== actor && !banned.has(loc.hero.uid))
    const [rolled, hit] = randomFrom(next, pool)
    if (!hit) break
    banned.add(hit.hero.uid)
    next = enqueue(rolled, hit.hero.uid, 'Wrath of Nature', false, true, actor)
  }
  return next
}

function exileTeam(state: Game, teamId: string | undefined, cause: string): Game {
  if (!teamId) return state
  const found = teamById(state, teamId)
  if (!found) return state
  return found.team.heroes.reduce(
    (current, hero) => exileBoard(current, hero.uid),
    log(state, `${cause} exiles the team.`),
  )
}

function imprison(state: Game, resume: CastResume, uid: string | undefined): Game {
  if (!uid) return state
  const holder = findHero(state, resume.sourceUid)
  if (holder?.hero.held) state = releaseHeld(state, holder.hero)
  const loc = findHero(state, uid)
  if (!loc) return state
  const removed = removeHero(state, uid)
  if (!removed.hero) return state
  const card: CardInst = { uid: removed.hero.uid, defId: removed.hero.defId, kind: 'hero' }
  const mode = resume.defId === 'razor' ? 'razor' : 'morph'
  const copied = HERO_BY_ID[card.defId]?.attr ?? null
  return log(
    editFlag(removed.state, resume.sourceUid, (hero) => ({
      ...hero,
      held: { card, owner: loc.hero.owner, mode, takenTurn: state.turn },
      gained: mode === 'morph' ? copied : hero.gained,
      castTurn: mode === 'morph' ? -1 : hero.castTurn,
    })),
    `${display(resume.defId).name} holds ${display(card.defId).name}.`,
  )
}

function greaves(state: Game, actor: PlayerId, uids: string[]): Game {
  let next = state
  for (const uid of uids) next = discardUid(next, actor, uid)
  return queueDraw(log(next, 'Guardian Greaves.'), actor, 4)
}

function satanic(state: Game, resume: CastResume): Game {
  const uid = heroIds(resume.picked)[0]
  const dest = [...resume.picked].reverse().find((id) => id.startsWith('team:') || id.startsWith('new'))
  if (!uid || !dest) return state
  const teamId = dest.startsWith('team:') ? dest.slice(5) : dest
  state = moveOnto(state, uid, resume.actor, teamId)
  const landed = findHero(state, uid)
  if (!landed || landed.hero.controller !== resume.actor) return state
  if (!resume.picked.includes('yes')) return log(state, 'Satanic moves the hero.')
  if (state.silence || landed.hero.muted) return log(state, 'The stolen ability does not fire.')
  if (HERO_BY_ID[landed.hero.defId]?.timing === 'aura') return log(state, 'That hero has no ability to fire.')
  return cast(log(state, 'Satanic fires the stolen ability.'), {
    kind: 'cast',
    actor: resume.actor,
    sourceUid: uid,
    defId: landed.hero.defId,
    picked: [],
    steps: 0,
  })
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

function sunder(state: Game, yourTeam: string | undefined, theirTeam: string | undefined): Game {
  if (!yourTeam || !theirTeam) return state
  const yours = teamById(state, yourTeam)
  const theirs = teamById(state, theirTeam)
  if (!yours || !theirs) return state
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
  const self = findHero(state, selfUid)
  const other = findHero(state, otherUid)
  if (!self || !other) return state
  const selfWeight = heroWeight(self.hero)
  const otherWeight = heroWeight(other.hero)
  if (teamSize(self.team) - selfWeight + otherWeight > 5) return log(state, 'Nether Swap would overfill the team.')
  if (teamSize(other.team) - otherWeight + selfWeight > 5) return log(state, 'Nether Swap would overfill the team.')
  const first = moveOnto(state, selfUid, other.player.id, other.team.id)
  return moveOnto(first, otherUid, self.player.id, self.team.id)
}

function lapse(state: Game): Game {
  const mark = state.lastGrave
  if (!mark || mark.turn !== state.turn) return log(state, 'Nothing entered the grave this turn.')
  if (!state.grave.some((card) => card.uid === mark.card.uid)) return log(state, 'That card has already left the grave.')
  let next: Game = { ...state, grave: state.grave.filter((card) => card.uid !== mark.card.uid) }
  if (mark.origin.type === 'hand') return addHand(next, mark.origin.player, [mark.card])
  if (mark.origin.type === 'board') {
    const hero = { ...mark.origin.hero, wk: mark.origin.hero.defId === 'wraith_king' }
    let teamId = mark.origin.teamId
    if (!teamById(next, teamId)) {
      ;[next, teamId] = seatTeam(next, hero.controller)
    }
    next = putOnTeam(next, hero.controller, teamId, hero)
    return log(next, `Time Lapse restores ${display(hero.defId).name}.`)
  }
  return { ...next, deck: [mark.card, ...next.deck] }
}

function stealSpell(state: Game, actor: PlayerId, sourceUid: string, heroUid: string | undefined): Game {
  const loc = heroUid ? findHero(state, heroUid) : null
  if (!loc) return state
  const copied = loc.hero.defId
  if (!HERO_BY_ID[copied] || HERO_BY_ID[copied].timing === 'aura') return log(state, 'There is no ability to steal.')
  return cast(state, { kind: 'cast', actor, sourceUid, defId: copied, picked: [], steps: 0 })
}

function recast(state: Game, actor: PlayerId, heroUid: string | undefined): Game {
  const loc = heroUid ? findHero(state, heroUid) : null
  if (!loc) return state
  if (HERO_BY_ID[loc.hero.defId]?.timing === 'aura') return log(state, 'That hero has no ability to cast again.')
  return cast(log(state, `${display(loc.hero.defId).name} casts again.`), {
    kind: 'cast',
    actor,
    sourceUid: loc.hero.uid,
    defId: loc.hero.defId,
    picked: [],
    steps: 0,
  })
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
      if (findHero(next, uid)?.team.id !== dest) next = moveOnto(next, uid, owner, dest)
    }
  }
  return log(next, 'Primal Roar splits the team.')
}

function polarity(state: Game, enemy: PlayerId, uids: string[]): Game {
  const kept: string[] = []
  let weight = 0
  for (const uid of uids) {
    const loc = findHero(state, uid)
    if (!loc || loc.hero.controller !== enemy) continue
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
  for (const uid of kept.slice(1)) next = moveOnto(next, uid, enemy, created[1])
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

function searchSetting(state: Game, actor: PlayerId, kind: string, label = 'Clarity'): Game {
  const card = state.deck.find((entry) => entry.defId === kind)
  if (!card) return log(state, `${label} finds nothing.`)
  const deck = state.deck.filter((entry) => entry.uid !== card.uid)
  const [shuffled, mixed] = shuffle(state, deck)
  return log(addHand({ ...shuffled, deck: mixed }, actor, [card]), `${label} takes ${display(card.defId).name}.`)
}

function eul(state: Game, uid: string | undefined): Game {
  if (!uid) return state
  const loc = findHero(state, uid)
  if (!loc) return state
  const pulled = extract(state, uid)
  if (!pulled.hero) return state
  return log(
    {
      ...pulled.state,
      phased: [...pulled.state.phased, { hero: pulled.hero, teamId: loc.team.id, owner: pulled.hero.owner, fromTurn: state.turn }],
    },
    `${display(pulled.hero.defId).name} is set aside.`,
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
  if (graveLocked(state, actor)) return log(state, 'Muerta keeps the grave shut.')
  const cards = state.grave.slice(-2)
  if (cards.length === 0) return log(state, 'The grave is empty.')
  return ask(
    { ...state, grave: state.grave.slice(0, -cards.length), limbo: cards },
    {
      actor,
      prompt: 'Give each card to a player.',
      mode: 'assign',
      min: cards.length,
      max: cards.length,
      choices: cards.map((card) => ({ id: card.uid, label: display(card.defId).name, defId: card.defId })),
      resume: { kind: 'io', cards: cards.map((card) => card.uid), actor },
    },
  )
}

function arrow(state: Game, resume: CastResume): Game {
  if ((resume.steps ?? 0) < 1 || state.limbo.length === 0) {
    const [next, cards] = pullTop(state, 4)
    if (cards.length === 0) return log(next, 'The deck is empty.')
    return ask({ ...next, limbo: cards }, {
      actor: resume.actor,
      prompt: 'Keep one card. The rest go to the bottom.',
      mode: 'pick',
      min: 1,
      max: 1,
      choices: cards.map((card) => ({ id: `card:${card.uid}`, label: display(card.defId).name, defId: card.defId })),
      resume: { ...resume, steps: 0 },
    })
  }
  const keep = cardIds(resume.picked)[0]
  const kept = state.limbo.find((card) => card.uid === keep)
  const rest = state.limbo.filter((card) => card.uid !== keep)
  let next: Game = { ...state, limbo: [], deck: [...state.deck, ...rest] }
  if (kept) next = addHand(next, resume.actor, [kept])
  return log(next, 'Sacred Arrow.')
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
    muted: false,
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
