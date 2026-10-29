import { useEffect, useState } from 'react'
import { display } from '../game/catalog.ts'
import { comboPlans, morphCasts, needsTeam, teamsFor } from '../game/engine.ts'
import { findHero, scoreState, scoreTeam } from '../game/flow.ts'
import { teamShape } from '../game/scoring.ts'
import type { Action, CardInst, Game, PlayerId } from '../game/types.ts'
import { CardFace } from './CardFace.tsx'
import { Prompt } from './Prompt.tsx'
import { emberTargets, handRevealed, heroMarks, isCombo, playBlock, shownAttrs, shownRange, statusLines } from './present.ts'
import { ALL_STRAT_FILTER, type BalanceSummary, type MatchReport, type StratFilter } from '../game/balance.ts'
import { DebugRail, type DebugSpeed, type DebugView } from './DebugRail.tsx'
import { Glossary } from './Glossary.tsx'
import { Rules } from './Rules.tsx'

type Focus =
  | { kind: 'hand'; uid: string }
  | { kind: 'hero'; uid: string }
  | { kind: 'card'; defId: string }

type PileName = 'deck' | 'grave' | 'exile' | 'runes' | 'neutrals' | 'towers'

const PAGE_SIZE = 4

export function Table({
  game,
  seed,
  stuck,
  debug = false,
  debugSpeed = 1,
  debugView = 'watch',
  debugBatchSize = 4,
  debugFocus = 0,
  debugRunCount = 1,
  debugFinished = 0,
  debugRunningBatch = false,
  debugSummary,
  debugReports = [],
  debugStratFilter = ALL_STRAT_FILTER,
  onDebugSpeed,
  onDebugStep,
  onDebugView,
  onDebugBatchSize,
  onDebugFocus,
  onDebugRunBatch,
  onDebugStratFilter,
  onDebugReset,
  onAction,
  onLobby,
}: {
  game: Game | null
  seed: number
  stuck: boolean
  debug?: boolean
  debugSpeed?: DebugSpeed
  debugView?: DebugView
  debugBatchSize?: number
  debugFocus?: number
  debugRunCount?: number
  debugFinished?: number
  debugRunningBatch?: boolean
  debugSummary?: BalanceSummary
  debugReports?: MatchReport[]
  debugStratFilter?: StratFilter
  onDebugSpeed?: (speed: DebugSpeed) => void
  onDebugStep?: () => void
  onDebugView?: (view: DebugView) => void
  onDebugBatchSize?: (size: number) => void
  onDebugFocus?: (index: number) => void
  onDebugRunBatch?: () => void
  onDebugStratFilter?: (filter: StratFilter) => void
  onDebugReset?: () => void
  onAction: (action: Action) => void
  onLobby: () => void
}) {
  const [combo, setCombo] = useState<string[]>([])
  const [focus, setFocus] = useState<Focus | null>(null)
  const [placing, setPlacing] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [pile, setPile] = useState<PileName | null>(null)
  const [rules, setRules] = useState(false)
  const [glossary, setGlossary] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [handOpen, setHandOpen] = useState<PlayerId | null>(null)
  const [page, setPage] = useState(0)
  const [acked, setAcked] = useState('')
  const [leaveArmed, setLeaveArmed] = useState(false)
  const statsOnly = debug && debugView === 'stats'
  const emptySummary: BalanceSummary = debugSummary ?? {
    matches: 0,
    finished: 0,
    seats: 0,
    filter: ALL_STRAT_FILTER,
    avgTurns: 0,
    avgFinalSpread: 0,
    avgWinnerScore: 0,
    cards: [],
    cardsLow: [],
    heroHigh: [],
    heroLow: [],
    settingHigh: [],
    settingLow: [],
    lootHigh: [],
    lootLow: [],
    contested: [],
    avgPtsByTurn: [],
    avgCardsByTurn: [],
    turnLabels: [],
    kindSwing: [],
    byStrat: [],
    shapeCompare: [],
    eventStats: [],
    byAttr: [],
  }

  const teamCount = game?.players[game.active]?.teams.length ?? 0
  const comboCount = game?.players[game.active]?.combos.length ?? 0

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setPile(null)
      setRules(false)
      setGlossary(false)
      setLogOpen(false)
      setHandOpen(null)
      setPlacing(null)
      setMoving(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!game || statsOnly) return
    document.querySelector('.lane.mine')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [game, statsOnly, teamCount, comboCount])

  const debugReady = !!(
    debug
    && onDebugSpeed
    && onDebugStep
    && onDebugView
    && onDebugBatchSize
    && onDebugFocus
    && onDebugRunBatch
    && onDebugStratFilter
    && onDebugReset
  )

  if (debugReady && (statsOnly || !game)) {
    return (
      <div className="shell debug stats-only">
        <header className="top">
          <div className="brand">
            <span className="leaf" aria-hidden="true" />
            <h1>Grove</h1>
            <span className="top-seed">d{seed}</span>
            <span className="debug-pill">Debug</span>
          </div>
          <div className="top-actions">
            <button type="button" onClick={() => setRules(true)}>Rules</button>
            <button type="button" data-testid="glossary-open" onClick={() => setGlossary(true)}>Glossary</button>
            <button type="button" className="primary" onClick={onLobby}>Leave</button>
          </div>
        </header>
        <div className="stage stats-stage">
          <DebugRail
            game={game}
            seed={seed}
            stuck={stuck}
            speed={debugSpeed}
            view={debugView}
            batchSize={debugBatchSize}
            focus={debugFocus}
            runCount={debugRunCount}
            finishedCount={debugFinished}
            runningBatch={debugRunningBatch}
            summary={emptySummary}
            reports={debugReports}
            stratFilter={debugStratFilter}
            onSpeed={onDebugSpeed!}
            onStep={onDebugStep!}
            onView={onDebugView!}
            onBatchSize={onDebugBatchSize!}
            onFocus={onDebugFocus!}
            onRunBatch={onDebugRunBatch!}
            onStratFilter={onDebugStratFilter!}
            onReset={onDebugReset!}
          />
        </div>
        {rules ? <Rules onClose={() => setRules(false)} /> : null}
        {glossary ? <Glossary onClose={() => setGlossary(false)} /> : null}
      </div>
    )
  }

  if (!game) {
    return (
      <div className="shell">
        <header className="top">
          <div className="brand">
            <span className="leaf" aria-hidden="true" />
            <h1>Grove</h1>
          </div>
          <div className="top-actions">
            <button type="button" className="primary" onClick={onLobby}>Back to lobby</button>
          </div>
        </header>
      </div>
    )
  }

  const names = game.players.map((player) => player.name)
  const promptKey = game.pending ? `${game.turn}:${game.pending.actor}:${game.pending.prompt}:${game.pending.choices.length}` : ''
  const humans = game.players.filter((player) => !player.ai).map((player) => player.id)
  const primaryHuman = humans[0] ?? 0
  const pendingHuman = game.pending && !game.players[game.pending.actor]?.ai ? game.pending.actor : null
  const activeHuman = game.players[game.active] && !game.players[game.active]!.ai ? game.active : null
  // Only pass-the-device when another human must answer — not when you target an enemy on your own turn.
  const needsHandoff =
    !debug
    && humans.length > 1
    && pendingHuman !== null
    && acked !== promptKey
    && pendingHuman !== activeHuman
  const viewer: PlayerId = debug
    ? game.active
    : pendingHuman !== null && (acked === promptKey || pendingHuman === activeHuman || humans.length === 1)
      ? pendingHuman
      : (activeHuman ?? primaryHuman)
  const you = game.players[viewer]!
  const chairs = game.players.map((player) => ({
    key: `p-${player.id}`,
    id: player.id,
    mine: player.id === viewer,
  }))
  const pageCount = Math.max(1, Math.ceil(chairs.length / PAGE_SIZE))
  const safePage = ((page % pageCount) + pageCount) % pageCount
  const visible = chairs.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const canAct = !debug && !game.over && !game.veil && !game.pending && game.active === viewer && !you.ai
  const handIds = new Set(you.hand.map((card) => card.uid))
  const liveCombo = combo.filter((uid) => handIds.has(uid))
  if (liveCombo.length !== combo.length) setCombo(liveCombo)
  if (placing && !handIds.has(placing)) setPlacing(null)
  if (focus?.kind === 'hand' && !handIds.has(focus.uid)) setFocus(null)
  if (focus?.kind === 'hero' && !findHero(game, focus.uid)) setFocus(null)
  const plans = canAct ? comboPlans(game) : []
  const lines = statusLines(game, viewer)
  const lastLog = game.log[game.log.length - 1] ?? ''
  const showDetail = !!focus || !!placing || !!moving
  const activeName = game.players[game.active]?.name ?? 'Player'
  const whoseTurn = game.over ? 'Match over' : debug ? `${activeName}'s turn` : game.active === viewer ? 'Your turn' : `${activeName}'s turn`

  if (game.mode === 'hotseat' && game.veil && !game.players[game.active]?.ai) {
    return (
      <SeatCover
        title={game.players[game.active]!.name}
        body="Five cards are waiting. The other hand stays hidden until the seat passes back."
        action="Begin turn"
        testId="ready"
        names={names}
        scores={game.players.map((player) => scoreState(game, player.id).total)}
        onAction={() => onAction({ type: 'ready' })}
      />
    )
  }

  if (needsHandoff && pendingHuman !== null) {
    return (
      <SeatCover
        title={names[pendingHuman] ?? 'Player'}
        body="A response is waiting. Sit down before the choice is shown."
        action={`I'm ${names[pendingHuman]}`}
        testId="handoff"
        names={names}
        scores={game.players.map((player) => scoreState(game, player.id).total)}
        onAction={() => setAcked(promptKey)}
      />
    )
  }

  const chosen = liveCombo.map((uid) => you.hand.find((card) => card.uid === uid)).filter((card): card is CardInst => !!card)
  const comboReady = isCombo(chosen)
  const drawReason = !canAct ? null : game.deck.length === 0 ? 'The deck is empty.' : you.actions < 1 ? 'No actions left.' : you.hand.length >= you.handLimit ? 'Your hand is full.' : null

  function clickHand(card: CardInst) {
    if (debug) {
      setFocus({ kind: 'hand', uid: card.uid })
      return
    }
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
    if (!game) return
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
    <div className={`shell${debug ? ' debug' : ''}`}>
      <header className="top">
        <div className="brand">
          <span className="leaf" aria-hidden="true" />
          <h1>Grove</h1>
          <span className="top-seed">{debug ? `d${seed}` : `Seed ${seed}`}</span>
          {debug ? <span className="debug-pill">Debug</span> : null}
        </div>
        <div className="top-actions">
          <button type="button" onClick={() => setRules(true)}>Rules</button>
          <button type="button" data-testid="glossary-open" onClick={() => setGlossary(true)}>Glossary</button>
          <button type="button" data-testid="log-open" onClick={() => setLogOpen(true)}>Log</button>
          {game.over ? (
            <button type="button" className="primary" onClick={onLobby}>New match</button>
          ) : (
            <button type="button" onClick={() => (leaveArmed ? onLobby() : setLeaveArmed(true))}>
              {leaveArmed ? 'Leave match?' : 'Leave'}
            </button>
          )}
        </div>
      </header>

      {lines.length > 0 ? (
        <ul className="banners">
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
      {stuck ? <p className="banner warn">The Grove paused. End its turn if it cannot move.</p> : null}

      <div className="stage">
        <div className="board">
          <div className="board-frame">
            {pageCount > 1 ? (
              <button
                type="button"
                className="board-arrow"
                data-testid="board-prev"
                aria-label="Previous players"
                onClick={() => setPage((current) => (current + pageCount - 1) % pageCount)}
              >
                ‹
              </button>
            ) : null}
            <div className="board-grid" data-testid="board-grid" data-count={visible.length} data-page={safePage}>
              {visible.map((chair) => {
                const player = game.players[chair.id]!
                const scored = scoreState(game, chair.id)
                const shapes = countShapes(game, chair.id)
                return (
                  <Lane
                    key={chair.key}
                    name={player.name}
                    score={scored.total}
                    shapes={shapes}
                    handCount={player.hand.length}
                    active={game.active === chair.id}
                    scoreTestId={chair.mine ? 'score-you' : chair.id === (viewer + 1) % game.players.length ? 'score-foe' : `score-${chair.id}`}
                    handTestId={chair.mine ? undefined : chair.id === (viewer + 1) % game.players.length ? 'hand-foe' : `hand-${chair.id}`}
                    mine={chair.mine}
                    showHand={!chair.mine}
                    onHand={chair.mine ? undefined : () => setHandOpen(chair.id)}
                    teams={player.teams}
                    combos={player.combos}
                    game={game}
                    onInspect={(next) => { setFocus(next); setPlacing(null); setMoving(null) }}
                    onEmber={chair.mine && canAct ? (uid) => { setMoving(uid); setPlacing(null); setFocus({ kind: 'hero', uid }) } : undefined}
                  />
                )
              })}
            </div>
            {pageCount > 1 ? (
              <button
                type="button"
                className="board-arrow"
                data-testid="board-next"
                aria-label="Next players"
                onClick={() => setPage((current) => (current + 1) % pageCount)}
              >
                ›
              </button>
            ) : null}
          </div>
          {pageCount > 1 ? (
            <p className="board-page quiet" data-testid="board-page">
              Players {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, chairs.length)} of {chairs.length}
            </p>
          ) : null}
          {game.phased.length > 0 ? (
            <p className="aside-note">Set aside: {game.phased.map((entry) => display(entry.hero.defId).name).join(', ')}.</p>
          ) : null}
        </div>

        {debugReady ? (
          <DebugRail
            game={game}
            seed={seed}
            stuck={stuck}
            speed={debugSpeed}
            view={debugView}
            batchSize={debugBatchSize}
            focus={debugFocus}
            runCount={debugRunCount}
            finishedCount={debugFinished}
            runningBatch={debugRunningBatch}
            summary={emptySummary}
            reports={debugReports}
            stratFilter={debugStratFilter}
            onSpeed={onDebugSpeed!}
            onStep={onDebugStep!}
            onView={onDebugView!}
            onBatchSize={onDebugBatchSize!}
            onFocus={onDebugFocus!}
            onRunBatch={onDebugRunBatch!}
            onStratFilter={onDebugStratFilter!}
            onReset={onDebugReset!}
          />
        ) : (
          <aside className="hud">
            <div className="turn-chip">
              <span className="turn-line">
                <span>T{game.turn}</span>
                <span className="quiet">{whoseTurn}</span>
              </span>
              <span className="action-line">
                <strong data-testid="actions">{game.players[game.active].actions}</strong>
                <small>left</small>
              </span>
            </div>
            <div className="actions">
              <button type="button" className="primary" data-testid="draw" disabled={!canAct || !!drawReason} onClick={() => onAction({ type: 'draw' })}>
                Draw
              </button>
              <button type="button" data-testid="end" disabled={!canAct && !stuck} onClick={() => onAction({ type: 'end' })}>
                End turn
              </button>
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
            <div className="pile-row">
              <PileButton label="Deck" count={game.deck.length} testId="pile-deck" onClick={() => setPile('deck')} />
              <PileButton label="Grave" count={game.grave.length} testId="pile-grave" onClick={() => setPile('grave')} />
              <PileButton label="Exile" count={game.exile.length} testId="pile-exile" onClick={() => setPile('exile')} />
              <PileButton label="Runes" count={game.runes.length} testId="pile-runes" onClick={() => setPile('runes')} />
              <PileButton label="Neutrals" count={game.neutrals.length} testId="pile-neutrals" onClick={() => setPile('neutrals')} />
              <PileButton label="Towers" count={game.towers.length} testId="pile-towers" onClick={() => setPile('towers')} />
            </div>
            {showDetail ? (
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
            ) : null}
            <p className="log-last" data-testid="log-last">{lastLog}</p>
          </aside>
        )}
      </div>

      <footer className="handbar" data-testid="hand">
        <div className="hand-label">
          <span>{debug ? `${activeName}'s hand` : 'Your hand'}</span>
          <span>{you.hand.length} / {you.handLimit}</span>
        </div>
        {you.hand.length === 0 ? <p className="quiet">Nothing in hand.</p> : null}
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
      </footer>

      {!debug && game.pending ? <Prompt key={promptKey} pending={game.pending} names={names} onChoose={(ids) => onAction({ type: 'choose', ids })} /> : null}
      {rules ? <Rules onClose={() => setRules(false)} /> : null}
      {glossary ? <Glossary onClose={() => setGlossary(false)} /> : null}
      {logOpen ? <LogSheet log={game.log} onClose={() => setLogOpen(false)} /> : null}
      {pile ? <PileDialog game={game} pile={pile} onClose={() => setPile(null)} onRead={(defId) => { setPile(null); setFocus({ kind: 'card', defId }) }} /> : null}
      {handOpen !== null ? (
        <HandSheet
          game={game}
          viewer={viewer}
          owner={handOpen}
          revealed={debug || handOpen === viewer || handRevealed(game, viewer, handOpen)}
          onCard={(card) => { setFocus({ kind: 'card', defId: card.defId }); setHandOpen(null) }}
          onClose={() => setHandOpen(null)}
        />
      ) : null}
      {game.over ? <Over game={game} names={names} onLobby={onLobby} /> : null}
    </div>
  )
}

function countShapes(game: Game, id: PlayerId): { core: number; mix: number } {
  let core = 0
  let mix = 0
  for (const team of game.players[id].teams) {
    const shape = teamShape(scoreTeam(game, team).why)
    if (shape === 'core') core += 1
    if (shape === 'mix') mix += 1
  }
  return { core, mix }
}

function Lane({
  name,
  score,
  shapes,
  handCount,
  active,
  scoreTestId,
  handTestId,
  mine,
  showHand,
  onHand,
  teams,
  combos,
  game,
  onInspect,
  onEmber,
}: {
  name: string
  score: number
  shapes: { core: number; mix: number }
  handCount: number
  active: boolean
  scoreTestId: string
  handTestId?: string
  mine: boolean
  showHand: boolean
  onHand?: () => void
  teams: Game['players'][number]['teams']
  combos: Game['players'][number]['combos']
  game: Game
  onInspect: (focus: Focus) => void
  onEmber?: (uid: string) => void
}) {
  return (
    <section className={`lane${mine ? ' mine' : ' foe'}${active ? ' active' : ''}`}>
      <div className={`seat${active ? ' active' : ''}`}>
        <span>{name}</span>
        <strong data-testid={scoreTestId}>{score}</strong>
        <small>{shapes.core} core · {shapes.mix} mix</small>
        {showHand && onHand && handTestId ? (
          <button type="button" className="hand-count" data-testid={handTestId} onClick={onHand}>
            Hand <strong>{handCount}</strong>
          </button>
        ) : null}
      </div>
      <div className="lane-board">
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
                      peek
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
            {combos.map((entry) => (
              <article key={entry.id} className="combo-chip">
                <strong>{entry.points}</strong>
                <span>{entry.kind === 'mixed' ? 'Mixed path' : `Three ${entry.kind}s`}</span>
                {entry.protectedBy ? <em>Protected</em> : null}
                <div className="combo-minis">
                  {entry.cards.map((card) => (
                    <button key={card.uid} type="button" className={`mini kind-${card.defId}`} onClick={() => onInspect({ kind: 'card', defId: card.defId })}>
                      {display(card.defId).name}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
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
  names: string[]
  scores: number[]
  onAction: () => void
}) {
  return (
    <div className="cover">
      <p className="eyebrow">Pass the seat</p>
      <h1>{title}</h1>
      <p>{body}</p>
      <p className="cover-scores">{names.map((name, index) => `${name} ${scores[index] ?? 0}`).join(' · ')}</p>
      <button type="button" className="primary" data-testid={testId} onClick={onAction}>{action}</button>
    </div>
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
  if (!focus) return null
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
  testId,
  onClick,
}: {
  label: string
  count: number
  testId: string
  onClick: () => void
}) {
  return (
    <button type="button" className="pile-chip" data-testid={testId} onClick={onClick}>
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  )
}

function LogSheet({ log, onClose }: { log: string[]; onClose: () => void }) {
  return (
    <div className="scrim" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="log-title" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">{log.length} lines</p>
        <h2 id="log-title">Match log</h2>
        {log.length === 0 ? <p className="quiet">Nothing logged yet.</p> : null}
        <ol className="log-list">
          {log.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ol>
        <button type="button" className="primary" onClick={onClose}>Close</button>
      </section>
    </div>
  )
}

function HandSheet({
  game,
  viewer,
  owner,
  revealed,
  onCard,
  onClose,
}: {
  game: Game
  viewer: PlayerId
  owner: PlayerId
  revealed: boolean
  onCard: (card: CardInst) => void
  onClose: () => void
}) {
  const player = game.players[owner]
  const mine = owner === viewer
  return (
    <div className="scrim" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="hand-title" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">{player.hand.length} / {player.handLimit}</p>
        <h2 id="hand-title">{mine ? 'Your hand' : `${player.name}'s hand`}</h2>
        {!revealed ? <p>The hand stays hidden until a reveal. The count is all you get.</p> : null}
        {revealed && player.hand.length === 0 ? <p className="quiet">Nothing in hand.</p> : null}
        {revealed ? (
          <div className="hand-row">
            {player.hand.map((card) => (
              <CardFace
                key={card.uid}
                defId={card.defId}
                onClick={() => onCard(card)}
              />
            ))}
          </div>
        ) : null}
        <button type="button" className="primary" onClick={onClose}>Close</button>
      </section>
    </div>
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

function Over({ game, names, onLobby }: { game: Game; names: string[]; onLobby: () => void }) {
  const over = game.over
  if (!over) return null
  const best = Math.max(...over.scores)
  const winners = names.filter((_, index) => over.scores[index] === best)
  const headline = winners.length > 1 ? 'The match is tied.' : `${winners[0]} wins.`
  return (
    <div className="scrim">
      <section className="sheet over" role="dialog" aria-modal="true">
        <p className="eyebrow">{over.reason}</p>
        <h2>{headline}</h2>
        <div className="over-scores" style={{ gridTemplateColumns: `repeat(${Math.min(names.length, 4)}, minmax(0, 1fr))` }}>
          {names.map((name, index) => (
            <div key={`${name}-${index}`}>
              <strong>{over.scores[index]}</strong>
              <span>{name}</span>
              <small>{over.parts[index]?.teams ?? 0} from teams · {over.parts[index]?.settings ?? 0} from settings</small>
            </div>
          ))}
        </div>
        <button type="button" className="primary" onClick={onLobby}>New match</button>
      </section>
    </div>
  )
}
