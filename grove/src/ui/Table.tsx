import { useEffect, useState } from 'react'
import { display } from '../game/catalog.ts'
import { comboPlans, morphCasts, needsTeam, teamsFor } from '../game/engine.ts'
import { findHero, scoreState, scoreTeam } from '../game/flow.ts'
import type { Action, CardInst, Game, PlayerId } from '../game/types.ts'
import { CardFace } from './CardFace.tsx'
import { Prompt } from './Prompt.tsx'
import { emberTargets, handRevealed, heroMarks, isCombo, opponentOf, playBlock, shownAttrs, shownRange, statusLines } from './present.ts'
import { Rules } from './Rules.tsx'

type Focus =
  | { kind: 'hand'; uid: string }
  | { kind: 'hero'; uid: string }
  | { kind: 'card'; defId: string }

type PileName = 'deck' | 'grave' | 'exile' | 'runes' | 'neutrals' | 'towers'

export function Table({
  game,
  seed,
  stuck,
  onAction,
  onLobby,
}: {
  game: Game
  seed: number
  stuck: boolean
  onAction: (action: Action) => void
  onLobby: () => void
}) {
  const [combo, setCombo] = useState<string[]>([])
  const [focus, setFocus] = useState<Focus | null>(null)
  const [placing, setPlacing] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [pile, setPile] = useState<PileName | null>(null)
  const [rules, setRules] = useState(false)
  const [acked, setAcked] = useState('')
  const [leaveArmed, setLeaveArmed] = useState(false)
  const names: [string, string] = [game.players[0].name, game.players[1].name]
  const promptKey = game.pending ? `${game.turn}:${game.pending.actor}:${game.pending.prompt}:${game.pending.choices.length}` : ''
  const response = game.mode === 'hotseat' && !!game.pending && game.pending.actor !== game.active
  const viewer: PlayerId = game.mode === 'ai' ? 0 : response && acked === promptKey ? game.pending!.actor : game.active
  const you = game.players[viewer]
  const foeId = opponentOf(viewer)
  const foe = game.players[foeId]
  const yourScore = scoreState(game, viewer)
  const foeScore = scoreState(game, foeId)
  const canAct = !game.over && !game.veil && !game.pending && game.active === viewer
  const handIds = new Set(you.hand.map((card) => card.uid))
  const liveCombo = combo.filter((uid) => handIds.has(uid))
  if (liveCombo.length !== combo.length) setCombo(liveCombo)
  if (placing && !handIds.has(placing)) setPlacing(null)
  if (focus?.kind === 'hand' && !handIds.has(focus.uid)) setFocus(null)
  if (focus?.kind === 'hero' && !findHero(game, focus.uid)) setFocus(null)
  const plans = canAct ? comboPlans(game) : []
  const lines = statusLines(game, viewer)
  const lastLog = game.log[game.log.length - 1] ?? ''

  useEffect(() => {
    document.querySelector('.side.mine')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [you.teams.length, you.combos.length])

  useEffect(() => {
    const logNode = document.querySelector('.log')
    if (logNode) logNode.scrollTop = logNode.scrollHeight
  }, [game.log.length])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setPile(null)
      setRules(false)
      setPlacing(null)
      setMoving(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (game.mode === 'hotseat' && game.veil) {
    return (
      <SeatCover
        title={game.players[game.active].name}
        body="Five cards are waiting. The other hand stays hidden until the seat passes back."
        action="Begin turn"
        testId="ready"
        names={names}
        scores={[scoreState(game, 0).total, scoreState(game, 1).total]}
        onAction={() => onAction({ type: 'ready' })}
      />
    )
  }

  if (response && game.pending && acked !== promptKey) {
    return (
      <SeatCover
        title={names[game.pending.actor]}
        body="A response is waiting. Sit down before the choice is shown."
        action={`I'm ${names[game.pending.actor]}`}
        testId="handoff"
        names={names}
        scores={[scoreState(game, 0).total, scoreState(game, 1).total]}
        onAction={() => setAcked(promptKey)}
      />
    )
  }

  const chosen = liveCombo.map((uid) => you.hand.find((card) => card.uid === uid)).filter((card): card is CardInst => !!card)
  const comboReady = isCombo(chosen)
  const drawReason = !canAct ? null : game.deck.length === 0 ? 'The deck is empty.' : you.actions < 1 ? 'No actions left.' : you.hand.length >= you.handLimit ? 'Your hand is full.' : null

  function clickHand(card: CardInst) {
    setMoving(null)
    if (card.kind === 'setting') {
      setPlacing(null)
      setCombo((current) => {
        if (current.includes(card.uid)) return current.filter((uid) => uid !== card.uid)
        if (current.length >= 3) return current
        return [...current, card.uid]
      })
      setFocus({ kind: 'hand', uid: card.uid })
      return
    }
    setCombo([])
    setPlacing(null)
    setFocus({ kind: 'hand', uid: card.uid })
  }

  function playFocused(uid: string) {
    const card = you.hand.find((entry) => entry.uid === uid)
    if (!card || !canAct || playBlock(game, viewer, card)) return
    if (needsTeam(card.defId, card.kind)) {
      setPlacing(uid)
      setMoving(null)
      return
    }
    onAction({ type: 'play', uid, team: '' })
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="leaf" aria-hidden="true" />
          <div>
            <p className="eyebrow">Dota, dealt as a card game</p>
            <h1>Grove</h1>
          </div>
        </div>
        <div className="top-meta">
          <span>Seed {seed}</span>
          <span>Turn {game.turn}</span>
          <span>Deck {game.deck.length}</span>
        </div>
        <div className="top-actions">
          <button type="button" onClick={() => setRules(true)}>Rules</button>
          {game.over ? (
            <button type="button" className="primary" onClick={onLobby}>New match</button>
          ) : (
            <button type="button" onClick={() => (leaveArmed ? onLobby() : setLeaveArmed(true))}>
              {leaveArmed ? 'Leave match?' : 'Leave'}
            </button>
          )}
        </div>
      </header>

      <div className="scoreboard">
        <Seat name={you.name} score={yourScore} active={game.active === viewer} testId="score-you" />
        <div className="turn-chip">
          {game.over ? 'Match over' : game.active === viewer ? 'Your turn' : `${foe.name}'s turn`}
          <strong data-testid="actions">{game.players[game.active].actions}</strong>
          <small>actions</small>
        </div>
        <Seat name={foe.name} score={foeScore} active={game.active === foeId} testId="score-foe" />
      </div>

      {lines.length > 0 ? (
        <ul className="banners">
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
      {stuck ? <p className="banner warn">The Grove paused. End its turn if it cannot move.</p> : null}

      <div className="felt">
        <div className="play">
          <PlayerBoard
            label={foe.name}
            handCount={foe.hand.length}
            cards={foe.hand}
            revealed={handRevealed(game, viewer, foeId)}
            teams={foe.teams}
            combos={foe.combos}
            game={game}
            mine={false}
            onInspect={(next) => { setFocus(next); setPlacing(null); setMoving(null) }}
          />
          <div className="piles">
            <PileButton label="Deck" count={game.deck.length} sealed testId="pile-deck" onClick={() => setPile('deck')} />
            <PileButton label="Grave" count={game.grave.length} testId="pile-grave" onClick={() => setPile('grave')} />
            <PileButton label="Exile" count={game.exile.length} testId="pile-exile" onClick={() => setPile('exile')} />
            <PileButton label="Runes" count={game.runes.length} sealed testId="pile-runes" onClick={() => setPile('runes')} />
            <PileButton label="Neutrals" count={game.neutrals.length} sealed testId="pile-neutrals" onClick={() => setPile('neutrals')} />
            <PileButton label="Towers" count={game.towers.length} sealed testId="pile-towers" onClick={() => setPile('towers')} />
          </div>
          <PlayerBoard
            label={you.name}
            handCount={you.hand.length}
            cards={[]}
            revealed={false}
            teams={you.teams}
            combos={you.combos}
            game={game}
            mine
            onInspect={(next) => { setFocus(next); setPlacing(null); setMoving(null) }}
            onEmber={canAct ? (uid) => { setMoving(uid); setPlacing(null); setFocus({ kind: 'hero', uid }) } : undefined}
          />
          {game.phased.length > 0 ? (
            <p className="aside-note">Set aside: {game.phased.map((entry) => display(entry.hero.defId).name).join(', ')}.</p>
          ) : null}
        </div>
        <aside className="log" aria-label="Match log">
          <h2>Log</h2>
          <ol>
            {game.log.slice(-16).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
          </ol>
          <p className="log-last" data-testid="log-last">{lastLog}</p>
        </aside>
      </div>

      <footer className="dock">
        <Detail
          game={game}
          viewer={viewer}
          canAct={canAct}
          focus={focus}
          placing={placing}
          moving={moving}
          comboReady={comboReady}
          chosen={chosen}
          onPlay={playFocused}
          onPlace={() => onAction({ type: 'combo', uids: chosen.map((card) => card.uid) })}
          onTeam={(team) => {
            if (placing) onAction({ type: 'play', uid: placing, team })
            setPlacing(null)
          }}
          onMove={(team) => {
            if (moving) onAction({ type: 'move', uid: moving, team })
            setMoving(null)
          }}
          onMorph={(uid) => onAction({ type: 'morph', uid })}
          onCancel={() => { setPlacing(null); setMoving(null) }}
        />
        <div className="hand" data-testid="hand">
          <div className="hand-label">
            <span>Your hand</span>
            <span>{you.hand.length}/{you.handLimit}</span>
          </div>
          {you.hand.length === 0 ? <p className="quiet">Your hand is empty. Draw, or end the turn.</p> : null}
          <div className="hand-row">
            {you.hand.map((card) => (
              <CardFace
                key={card.uid}
                defId={card.defId}
                selected={liveCombo.includes(card.uid) || (focus?.kind === 'hand' && focus.uid === card.uid)}
                onClick={() => clickHand(card)}
                testId={`hand-${card.defId}`}
              />
            ))}
          </div>
        </div>
        <div className="actions">
          <button type="button" className="primary" data-testid="draw" disabled={!canAct || !!drawReason} onClick={() => onAction({ type: 'draw' })}>
            Draw
          </button>
          <button type="button" data-testid="end" disabled={!canAct && !stuck} onClick={() => onAction({ type: 'end' })}>
            End turn
          </button>
          {drawReason ? <span className="quiet">{drawReason}</span> : <span className="quiet">Draw or play spends 1. A combo is free.</span>}
          {plans.map((plan) => (
            <button key={plan.label} type="button" className="combo" data-testid="combo" onClick={() => onAction({ type: 'combo', uids: plan.uids })}>
              {plan.label} · free
            </button>
          ))}
          {comboReady ? (
            <button type="button" className="combo" onClick={() => onAction({ type: 'combo', uids: chosen.map((card) => card.uid) })}>
              Place selected · free
            </button>
          ) : null}
          {canAct && morphCasts(game).map((cast) => (
            <button key={cast.uid} type="button" onClick={() => onAction({ type: 'morph', uid: cast.uid })}>{cast.label}</button>
          ))}
        </div>
      </footer>

      {game.pending ? <Prompt key={promptKey} pending={game.pending} names={names} onChoose={(ids) => onAction({ type: 'choose', ids })} /> : null}
      {rules ? <Rules onClose={() => setRules(false)} /> : null}
      {pile ? <PileDialog game={game} pile={pile} onClose={() => setPile(null)} onRead={(defId) => { setPile(null); setFocus({ kind: 'card', defId }) }} /> : null}
      {game.over ? <Over game={game} names={names} onLobby={onLobby} /> : null}
    </div>
  )
}

function Seat({
  name,
  score,
  active,
  testId,
}: {
  name: string
  score: { teams: number; settings: number; total: number }
  active: boolean
  testId: string
}) {
  return (
    <div className={`seat${active ? ' active' : ''}`}>
      <span>{name}</span>
      <strong data-testid={testId}>{score.total}</strong>
      <small>{score.teams} teams · {score.settings} settings</small>
    </div>
  )
}

function SeatCover({
  title,
  body,
  action,
  testId,
  names,
  scores,
  onAction,
}: {
  title: string
  body: string
  action: string
  testId: string
  names: [string, string]
  scores: [number, number]
  onAction: () => void
}) {
  return (
    <div className="cover">
      <p className="eyebrow">Pass the seat</p>
      <h1>{title}</h1>
      <p>{body}</p>
      <p className="cover-scores">{names[0]} {scores[0]} · {names[1]} {scores[1]}</p>
      <button type="button" className="primary" data-testid={testId} onClick={onAction}>{action}</button>
    </div>
  )
}

function PlayerBoard({
  label,
  handCount,
  cards,
  revealed,
  teams,
  combos,
  game,
  mine,
  onInspect,
  onEmber,
}: {
  label: string
  handCount: number
  cards: CardInst[]
  revealed: boolean
  teams: Game['players'][number]['teams']
  combos: Game['players'][number]['combos']
  game: Game
  mine: boolean
  onInspect: (focus: Focus) => void
  onEmber?: (uid: string) => void
}) {
  return (
    <section className={`side${mine ? ' mine' : ''}`}>
      <header>
        <h2>{label}</h2>
        {!mine ? <span>{revealed ? 'Hand revealed' : `${handCount} in hand`}</span> : <span>Your teams</span>}
      </header>
      {!mine ? (
        <div className="hand-row foe-hand">
          {cards.map((card) => (
            <CardFace
              key={card.uid}
              defId={revealed ? card.defId : ''}
              faceDown={!revealed}
              compact
              onClick={revealed ? () => onInspect({ kind: 'card', defId: card.defId }) : undefined}
            />
          ))}
        </div>
      ) : null}
      {teams.length === 0 ? <p className="quiet">{mine ? 'Play a hero to open a team.' : 'No teams yet.'}</p> : null}
      <div className="teams">
        {teams.map((team, index) => {
          const scored = scoreTeam(game, team)
          return (
            <article key={team.id} className="team" data-testid={mine ? `team-${index}` : undefined}>
              <header>
                <strong>{scored.points}</strong>
                <span>{scored.why}</span>
              </header>
              <div className="team-heroes">
                {team.heroes.map((hero) => (
                  <CardFace
                    key={hero.uid}
                    defId={hero.defId}
                    compact
                    attrs={shownAttrs(game, hero)}
                    range={shownRange(hero)}
                    marks={heroMarks(hero, team)}
                    onClick={() => {
                      onInspect({ kind: 'hero', uid: hero.uid })
                      if (onEmber && hero.defId === 'ember_spirit') onEmber(hero.uid)
                    }}
                  />
                ))}
              </div>
              <footer>
                {team.glyph ? <em>Glyph</em> : null}
                {team.gaze ? <em>Gaze</em> : null}
                {team.noEnter ? <em>Sealed</em> : null}
                {team.mine ? <em>Mine</em> : null}
                {team.heroes.length === 0 ? <em>Empty</em> : null}
              </footer>
            </article>
          )
        })}
      </div>
      {combos.length > 0 ? (
        <div className="combos">
          {combos.map((combo) => (
            <article key={combo.id} className="combo-chip">
              <strong>{combo.points}</strong>
              <span>{combo.kind === 'mixed' ? 'Mixed path' : `Three ${combo.kind}s`}</span>
              {combo.protectedBy ? <em>Protected</em> : null}
              <div className="combo-minis">
                {combo.cards.map((card) => (
                  <button key={card.uid} type="button" className={`mini kind-${card.defId}`} onClick={() => onInspect({ kind: 'card', defId: card.defId })}>
                    {display(card.defId).name}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function Detail({
  game,
  viewer,
  canAct,
  focus,
  placing,
  moving,
  comboReady,
  chosen,
  onPlay,
  onPlace,
  onTeam,
  onMove,
  onMorph,
  onCancel,
}: {
  game: Game
  viewer: PlayerId
  canAct: boolean
  focus: Focus | null
  placing: string | null
  moving: string | null
  comboReady: boolean
  chosen: CardInst[]
  onPlay: (uid: string) => void
  onPlace: () => void
  onTeam: (team: string) => void
  onMove: (team: string) => void
  onMorph: (uid: string) => void
  onCancel: () => void
}) {
  if (placing) {
    const card = game.players[viewer].hand.find((entry) => entry.uid === placing)
    const options = card ? teamsFor(game, placing) : []
    return (
      <div className="detail">
        <p>Play {card ? display(card.defId).name : 'this card'} onto</p>
        <div className="inline-choices">
          {options.map((option) => (
            <button key={option.id} type="button" disabled={!option.ok} data-testid={option.id === 'new' ? 'team-new' : `team-pick-${option.id}`} onClick={() => onTeam(option.id)}>
              {option.label}{option.reason ? ` · ${option.reason}` : ''}
            </button>
          ))}
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    )
  }
  if (moving) {
    const options = emberTargets(game, moving)
    return (
      <div className="detail">
        <p>Move Ember Spirit</p>
        <div className="inline-choices">
          {options.map((option) => (
            <button key={option.id} type="button" disabled={!option.ok} onClick={() => onMove(option.id)}>
              {option.label}{option.reason ? ` · ${option.reason}` : ''}
            </button>
          ))}
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    )
  }
  if (!focus) {
    return <div className="detail quiet">Choose a card to read it. Three settings place as a free combo.</div>
  }
  if (focus.kind === 'card') {
    const info = display(focus.defId)
    return (
      <div className="detail">
        <h3>{info.name}</h3>
        {info.spell ? <p className="spell">{info.spell}</p> : null}
        <p>{info.text}</p>
      </div>
    )
  }
  if (focus.kind === 'hero') {
    const loc = findHero(game, focus.uid)
    if (!loc) return <div className="detail quiet">That hero has left the board.</div>
    const info = display(loc.hero.defId)
    const scored = scoreTeam(game, loc.team)
    const morph = morphCasts(game).find((cast) => cast.uid === loc.hero.uid)
    return (
      <div className="detail">
        <h3>{info.name}</h3>
        <p className="spell">{loc.player.name} · {scored.why} · {scored.points}</p>
        {info.spell ? <p className="spell">{info.spell}</p> : null}
        <p>{info.text}</p>
        {heroMarks(loc.hero, loc.team).length > 0 ? <p className="quiet">{heroMarks(loc.hero, loc.team).join(' · ')}</p> : null}
        {canAct && morph ? <button type="button" onClick={() => onMorph(loc.hero.uid)}>{morph.label}</button> : null}
        {canAct && loc.hero.defId === 'ember_spirit' && loc.hero.controller === viewer ? <p className="quiet">Choose a team above, or click Ember again and pick a destination.</p> : null}
      </div>
    )
  }
  const card = game.players[viewer].hand.find((entry) => entry.uid === focus.uid)
  if (!card) return <div className="detail quiet">That card has left your hand.</div>
  const info = display(card.defId)
  const block = playBlock(game, viewer, card)
  return (
    <div className="detail">
      <h3>{info.name}</h3>
      {info.spell ? <p className="spell">{info.spell}</p> : null}
      <p>{info.text}</p>
      <div className="inline-choices">
        {card.kind === 'setting' ? (
          <button type="button" className="combo" disabled={!canAct || !comboReady} onClick={onPlace}>
            {comboReady ? 'Place these three · free' : `Selected ${chosen.length}/3`}
          </button>
        ) : (
          <button type="button" className="primary" data-testid="play-card" disabled={!canAct || !!block} onClick={() => onPlay(card.uid)}>
            {info.instant ? `Play ${info.name} · free` : `Play ${info.name} · 1 action`}
          </button>
        )}
        {block ? <span className="quiet">{block}</span> : null}
      </div>
    </div>
  )
}

function PileButton({
  label,
  count,
  sealed = false,
  testId,
  onClick,
}: {
  label: string
  count: number
  sealed?: boolean
  testId: string
  onClick: () => void
}) {
  return (
    <button type="button" className="pile" data-testid={testId} onClick={onClick}>
      <strong>{count}</strong>
      <span>{label}</span>
      <small>{sealed ? 'Face down' : 'Open'}</small>
    </button>
  )
}

function PileDialog({
  game,
  pile,
  onClose,
  onRead,
}: {
  game: Game
  pile: PileName
  onClose: () => void
  onRead: (defId: string) => void
}) {
  const sealed = pile === 'deck' || pile === 'runes' || pile === 'neutrals' || pile === 'towers'
  const cards = pile === 'grave' ? game.grave : pile === 'exile' ? game.exile : []
  const title = pile === 'deck' ? 'Shared deck' : pile === 'grave' ? 'Grave' : pile === 'exile' ? 'Exile' : pile === 'runes' ? 'Runes' : pile === 'neutrals' ? 'Neutrals' : 'Towers'
  const count = game[pile].length
  return (
    <div className="scrim" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">{count} cards</p>
        <h2>{title}</h2>
        {pile === 'deck' ? <p>The deck is shared and face down. The match ends when it is empty.</p> : null}
        {pile === 'runes' || pile === 'neutrals' || pile === 'towers' ? <p>This pile is shuffled face down. Three matching settings take the top card. You can read it once it reaches your hand.</p> : null}
        {pile === 'grave' ? <p>Discarded cards and destroyed heroes wait here. Anyone can take from the grave when an ability says so.</p> : null}
        {pile === 'exile' ? <p>Exiled cards are out of the game. They do not interact.</p> : null}
        {!sealed && cards.length === 0 ? <p className="quiet">Nothing here yet.</p> : null}
        {!sealed ? (
          <div className="hand-row dialog-cards">
            {cards.map((card) => (
              <CardFace key={card.uid} defId={card.defId} compact onClick={() => onRead(card.defId)} />
            ))}
          </div>
        ) : null}
        <button type="button" className="primary" onClick={onClose}>Close</button>
      </section>
    </div>
  )
}

function Over({ game, names, onLobby }: { game: Game; names: [string, string]; onLobby: () => void }) {
  const over = game.over
  if (!over) return null
  const [a, b] = over.scores
  const headline = a === b ? 'The match is tied.' : a > b ? `${names[0]} wins.` : `${names[1]} wins.`
  return (
    <div className="scrim">
      <section className="sheet over" role="dialog" aria-modal="true">
        <p className="eyebrow">{over.reason}</p>
        <h2>{headline}</h2>
        <div className="over-scores">
          {names.map((name, index) => (
            <div key={name}>
              <strong>{over.scores[index]}</strong>
              <span>{name}</span>
              <small>{over.parts[index].teams} from teams · {over.parts[index].settings} from settings</small>
            </div>
          ))}
        </div>
        <button type="button" className="primary" onClick={onLobby}>New match</button>
      </section>
    </div>
  )
}
