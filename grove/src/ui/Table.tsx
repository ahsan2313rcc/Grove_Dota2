import { useEffect, useState, type ReactNode } from 'react'
import { display } from '../game/catalog.ts'
import { comboPlans, morphCasts, needsTeam, playableFromGrave, teamsFor, undyingRevive } from '../game/engine.ts'
import { allLocs, findHero, isTrapHero, scoreState, scoreTeam } from '../game/flow.ts'
import { teamShapes } from '../game/scoring.ts'
import type { Action, CardInst, Game, PlayerId } from '../game/types.ts'
import { CardFace } from './CardFace.tsx'
import { Prompt } from './Prompt.tsx'
import { handRevealed, heroMarks, isCombo, playBlock, playsAsInstant, shownAttrs, shownRange, statusLines } from './present.ts'
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
  tableGen = 0,
  debug = false,
  debugSpeed = 1,
  debugView = 'watch',
  debugBatchSize = 100,
  debugFocus = 0,
  debugRunCount = 1,
  debugFinished = 0,
  debugRunningBatch = false,
  debugQueueLeft = 0,
  debugSummary,
  debugReports = [],
  debugStratFilter = ALL_STRAT_FILTER,
  onDebugSpeed,
  onDebugStep,
  onDebugView,
  onDebugBatchSize,
  onDebugFocus,
  onDebugRunBatch,
  onDebugPlayNext,
  onDebugStratFilter,
  onDebugReset,
  debugTrainNeural = false,
  debugNnInfo,
  onDebugTrainNeural,
  onDebugNnSave,
  onDebugNnExportGit,
  onDebugNnClear,
  debugThoughtPower = 7,
  onDebugThoughtPower,
  onlineSeat = null,
  onAction,
  onLobby,
}: {
  game: Game | null
  seed: number
  stuck: boolean
  /** Bumps when a new match starts; clears ephemeral UI without remounting the table. */
  tableGen?: number
  debug?: boolean
  debugSpeed?: DebugSpeed
  debugView?: DebugView
  debugBatchSize?: number
  debugFocus?: number
  debugRunCount?: number
  debugFinished?: number
  debugRunningBatch?: boolean
  debugQueueLeft?: number
  debugSummary?: BalanceSummary
  debugReports?: MatchReport[]
  debugStratFilter?: StratFilter
  onDebugSpeed?: (speed: DebugSpeed) => void
  onDebugStep?: () => void
  onDebugView?: (view: DebugView) => void
  onDebugBatchSize?: (size: number) => void
  onDebugFocus?: (index: number) => void
  onDebugRunBatch?: () => void
  onDebugPlayNext?: () => void
  onDebugStratFilter?: (filter: StratFilter) => void
  onDebugReset?: () => void
  debugTrainNeural?: boolean
  debugNnInfo?: import('../game/nnMemory.ts').NnMemoryInfo
  onDebugTrainNeural?: (on: boolean) => void
  onDebugNnSave?: () => void
  onDebugNnExportGit?: () => void
  onDebugNnClear?: () => void
  debugThoughtPower?: number
  onDebugThoughtPower?: (value: number) => void
  /** When set, this seat is the networked player (no hotseat handoff). */
  onlineSeat?: PlayerId | null
  onAction: (action: Action) => void
  onLobby: () => void
}) {
  const [combo, setCombo] = useState<string[]>([])
  const [focus, setFocus] = useState<Focus | null>(null)
  const [placing, setPlacing] = useState<string | null>(null)
  const [extras, setExtras] = useState<string[]>([])
  const [pile, setPile] = useState<PileName | null>(null)
  const [rules, setRules] = useState(false)
  const [glossary, setGlossary] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [winOpen, setWinOpen] = useState(false)
  const [handOpen, setHandOpen] = useState<PlayerId | null>(null)
  const [page, setPage] = useState(0)
  const [acked, setAcked] = useState('')
  const [leaveArmed, setLeaveArmed] = useState(false)
  /** Hotseat: non-active human sits down to play Instant cards. */
  const [reactSeat, setReactSeat] = useState<PlayerId | null>(null)

  // Soft-reset interaction state on a new match. Never remount via key={match} —
  // that reloaded every card portrait and felt like the page was refreshing.
  useEffect(() => {
    setCombo([])
    setFocus(null)
    setPlacing(null)
    setExtras([])
    setPile(null)
    setLogOpen(false)
    setHandOpen(null)
    setPage(0)
    setAcked('')
    setLeaveArmed(false)
    setReactSeat(null)
  }, [tableGen])
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
    heroes: [],
    heroPlaysTotal: [],
    heroPlaysSilenced: [],
    heroPlaysOpen: [],
    abilities: [],
    heroHigh: [],
    heroLow: [],
    terrains: [],
    terrainHigh: [],
    terrainLow: [],
    loot: [],
    lootHigh: [],
    lootLow: [],
    contested: [],
    avgPtsByTurn: [],
    avgCardsByTurn: [],
    turnLabels: [],
    kindSwing: [],
    byAbilityType: [],
    byStrat: [],
    shapeCompare: [],
    eventStats: [],
    byAttr: [],
    maxTurn: 1,
    graphHeroes: [],
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
      }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!game || statsOnly) return
    document.querySelector('.lane.mine')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [game, statsOnly, teamCount, comboCount])

  useEffect(() => {
    if (reactSeat === null || !game) return
    const humans = game.players.filter((player) => !player.ai).map((player) => player.id)
    if (game.over || game.veil || game.pending || reactSeat === game.active || !humans.includes(reactSeat)) {
      setReactSeat(null)
    }
  }, [game, reactSeat])

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
            queueLeft={debugQueueLeft}
            summary={emptySummary}
            reports={debugReports}
            stratFilter={debugStratFilter}
            onSpeed={onDebugSpeed!}
            onStep={onDebugStep!}
            onView={onDebugView!}
            onBatchSize={onDebugBatchSize!}
            onFocus={onDebugFocus!}
            onRunBatch={onDebugRunBatch!}
            onPlayNext={onDebugPlayNext}
            onStratFilter={onDebugStratFilter!}
            onReset={onDebugReset!}
            trainNeural={debugTrainNeural}
            nnInfo={debugNnInfo}
            onTrainNeural={onDebugTrainNeural}
            onNnSave={onDebugNnSave}
            onNnExportGit={onDebugNnExportGit}
            onNnClear={onDebugNnClear}
            thoughtPower={debugThoughtPower}
            onThoughtPower={onDebugThoughtPower}
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
  const networked = onlineSeat !== null && onlineSeat !== undefined
  // Only pass-the-device when another human must answer — not when you target an enemy on your own turn.
  const needsHandoff =
    !debug
    && !networked
    && humans.length > 1
    && pendingHuman !== null
    && acked !== promptKey
    && pendingHuman !== activeHuman
  const viewer: PlayerId = networked
    ? onlineSeat
    : debug
      ? game.active
      : pendingHuman !== null && (acked === promptKey || pendingHuman === activeHuman || humans.length === 1)
        ? pendingHuman
        : reactSeat !== null && humans.includes(reactSeat) && reactSeat !== game.active
          ? reactSeat
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
  const seatLive = networked || !you.ai
  const canAct = !debug && !game.over && !game.veil && !game.pending && game.active === viewer && seatLive
  const canInstant =
    !debug
    && !game.over
    && !game.veil
    && !game.pending
    && game.active !== viewer
    && seatLive
  const canPlayCards = canAct || canInstant
  const handIds = new Set(you.hand.map((card) => card.uid))
  const graveTop = canAct ? playableFromGrave(game, viewer) : null
  const liveCombo = combo.filter((uid) => handIds.has(uid) || uid === graveTop?.uid)
  if (liveCombo.length !== combo.length) setCombo(liveCombo)
  if (placing && !handIds.has(placing) && placing !== graveTop?.uid) {
    setPlacing(null)
    setExtras([])
  }
  if (extras.some((uid) => !handIds.has(uid))) setExtras((current) => current.filter((uid) => handIds.has(uid)))
  if (focus?.kind === 'hand' && !handIds.has(focus.uid)) setFocus(null)
  if (focus?.kind === 'hero' && !findHero(game, focus.uid)) setFocus(null)
  const plans = canAct ? comboPlans(game) : []
  const lines = statusLines(game, viewer)
  const lastLog = game.log[game.log.length - 1] ?? ''
  const showDetail = !!focus || !!placing
  const activeName = game.players[game.active]?.name ?? 'Player'
  const whoseTurn = game.over ? 'Match over' : debug ? `${activeName}'s turn` : game.active === viewer ? 'Your turn' : `${activeName}'s turn`
  const reactCandidates = !networked && !debug && humans.length > 1 && !game.pending && !game.over && !game.veil
    ? humans.filter((id) => id !== game.active && id !== viewer)
    : []

  if (!networked && game.mode === 'hotseat' && game.veil && !game.players[game.active]?.ai) {
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

  const chosen = liveCombo
    .map((uid) => you.hand.find((card) => card.uid === uid) ?? (graveTop?.uid === uid ? graveTop : null))
    .filter((card): card is CardInst => !!card)
  const comboReady = isCombo(chosen)
  const drawReason = !canAct ? null : game.deck.length === 0 ? 'The deck is empty — final round.' : you.actions < 1 ? 'No actions left.' : null
  const selectedUid = placing ?? (focus?.kind === 'hand' ? focus.uid : null)
  const selectedCard = selectedUid
    ? (graveTop?.uid === selectedUid ? graveTop : null)
      ?? game.clinkzExile.find((card) => card.uid === selectedUid)
      ?? you.hand.find((card) => card.uid === selectedUid)
      ?? null
    : null
  const playReason = !selectedCard
    ? 'Select a card'
    : !canPlayCards
      ? 'Cannot play now'
      : (playBlock(game, viewer, selectedCard)
        ?? (canInstant && !playsAsInstant(game, viewer, selectedCard) ? 'Only Instant cards now' : null))
  const clinkzPlayable = canPlayCards ? game.clinkzExile.filter((card) => card.kind === 'item') : []

  function toggleTerrainCombo(card: CardInst, fromGrave = false) {
    setPlacing(null)
    setExtras([])
    if (liveCombo.includes(card.uid)) {
      setCombo((current) => current.filter((uid) => uid !== card.uid))
      if (focus?.kind === 'hand' && focus.uid === card.uid) setFocus(null)
      return
    }
    if (liveCombo.length >= 3) return
    setCombo((current) => [...current, card.uid])
    setFocus(fromGrave ? { kind: 'card', defId: card.defId } : { kind: 'hand', uid: card.uid })
  }

  function clickHand(card: CardInst) {
    if (debug) {
      setFocus((current) => (current?.kind === 'hand' && current.uid === card.uid ? null : { kind: 'hand', uid: card.uid }))
      return
    }
    if (card.kind === 'terrain') {
      toggleTerrainCombo(card)
      return
    }
    // Active hero (placing or focused) + other heroes toggle silent companions for one action.
    const primary =
      placing
      ?? (focus?.kind === 'hand'
        ? you.hand.find((entry) => entry.uid === focus.uid && entry.kind === 'hero')?.uid
        : undefined)
    if (canAct && primary && card.kind === 'hero' && card.uid !== primary) {
      setExtras((current) => (current.includes(card.uid) ? current.filter((uid) => uid !== card.uid) : [...current, card.uid]))
      if (!placing) setFocus({ kind: 'hand', uid: primary })
      else setFocus({ kind: 'hand', uid: card.uid })
      return
    }
    // Clicking the already-selected card again clears the selection.
    if (placing === card.uid || (focus?.kind === 'hand' && focus.uid === card.uid)) {
      setCombo([])
      setExtras([])
      setPlacing(null)
      setFocus(null)
      return
    }
    setCombo([])
    setExtras((current) => (card.kind === 'hero' ? current.filter((uid) => uid !== card.uid) : []))
    setPlacing(null)
    setFocus({ kind: 'hand', uid: card.uid })
  }

  function playFocused(uid: string) {
    if (!game) return
    const fromGrave = graveTop?.uid === uid ? graveTop : null
    const fromClinkz = game.clinkzExile.find((card) => card.uid === uid) ?? null
    const card = fromGrave ?? fromClinkz ?? you.hand.find((entry) => entry.uid === uid)
    if (!card || !canPlayCards) return
    if (!fromGrave && !fromClinkz && playBlock(game, viewer, card)) return
    if (canInstant && !fromGrave && !fromClinkz && !playsAsInstant(game, viewer, card)) return
    // Exorcism terrain: fold into the combo picker instead of a lone play.
    if (card.kind === 'terrain') {
      if (fromGrave) toggleTerrainCombo(card, true)
      return
    }
    if (needsTeam(card.defId, card.kind)) {
      setPlacing(uid)
      setExtras((current) => current.filter((extra) => extra !== uid))
      setFocus(fromGrave || fromClinkz ? { kind: 'card', defId: card.defId } : { kind: 'hand', uid })
      return
    }
    onAction({ type: 'play', uid, team: '', extras: extras.length > 0 && card.kind === 'hero' ? extras : undefined })
    setExtras([])
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
          <button type="button" data-testid="win-open" onClick={() => setWinOpen(true)}>Win</button>
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
                    onInspect={(next) => {
                      setFocus((current) => {
                        if (current?.kind === 'hero' && next.kind === 'hero' && current.uid === next.uid) return null
                        if (current?.kind === 'card' && next.kind === 'card' && current.defId === next.defId) return null
                        return next
                      })
                      setPlacing(null)
                    }}
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
            queueLeft={debugQueueLeft}
            summary={emptySummary}
            reports={debugReports}
            stratFilter={debugStratFilter}
            onSpeed={onDebugSpeed!}
            onStep={onDebugStep!}
            onView={onDebugView!}
            onBatchSize={onDebugBatchSize!}
            onFocus={onDebugFocus!}
            onRunBatch={onDebugRunBatch!}
            onPlayNext={onDebugPlayNext}
            onStratFilter={onDebugStratFilter!}
            onReset={onDebugReset!}
            trainNeural={debugTrainNeural}
            nnInfo={debugNnInfo}
            onTrainNeural={onDebugTrainNeural}
            onNnSave={onDebugNnSave}
            onNnExportGit={onDebugNnExportGit}
            onNnClear={onDebugNnClear}
            thoughtPower={debugThoughtPower}
            onThoughtPower={onDebugThoughtPower}
          />
        ) : (
          <aside className="hud">
            <div className="hud-top">
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
              <div className="pile-stack" data-testid="pile-stack">
                <PileButton label="Deck" count={game.deck.length} testId="pile-deck" onClick={() => setPile('deck')} />
                <PileButton
                  label="Grave"
                  count={game.grave.length}
                  testId="pile-grave"
                  onClick={() => setPile('grave')}
                  highlight={!!graveTop}
                />
                <PileButton label="Exile" count={game.exile.length} testId="pile-exile" onClick={() => setPile('exile')} />
                <div className="pile-extra">
                  <PileButton label="Runes" count={game.runes.length} testId="pile-runes" onClick={() => setPile('runes')} />
                  <PileButton label="Neutrals" count={game.neutrals.length} testId="pile-neutrals" onClick={() => setPile('neutrals')} />
                  <PileButton label="Towers" count={game.towers.length} testId="pile-towers" onClick={() => setPile('towers')} />
                </div>
              </div>
            </div>
            <div className="actions">
              <button type="button" className="primary" data-testid="draw" disabled={!canAct || !!drawReason} onClick={() => onAction({ type: 'draw' })} title={drawReason ?? undefined}>
                Draw
              </button>
              <button
                type="button"
                className="primary"
                data-testid="play-selected"
                disabled={!selectedCard || !!playReason}
                title={playReason ?? (selectedCard ? display(selectedCard.defId).name : undefined)}
                onClick={() => selectedUid && playFocused(selectedUid)}
              >
                Play{selectedCard ? ` · ${display(selectedCard.defId).name}` : ''}
              </button>
              <button type="button" data-testid="end" disabled={!canAct && !stuck} onClick={() => onAction({ type: 'end' })}>
                End turn
              </button>
              {reactSeat !== null ? (
                <button type="button" data-testid="react-done" onClick={() => setReactSeat(null)}>
                  Back to {activeName}
                </button>
              ) : null}
              {reactCandidates.map((id) => (
                <button key={id} type="button" data-testid={`react-${id}`} onClick={() => setReactSeat(id)}>
                  Instant as {names[id]}
                </button>
              ))}
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
              {canAct && undyingRevive(game).ok && chosen.length >= 2 ? (
                <button
                  type="button"
                  className="combo"
                  onClick={() =>
                    onAction({
                      type: 'undying',
                      team: 'new',
                      discards: chosen.slice(0, 2).map((card) => card.uid),
                    })
                  }
                  title="Discard 2 selected cards to return Undying"
                >
                  Flesh Golem · revive
                </button>
              ) : null}
              {canAct && graveTop ? (
                <button
                  type="button"
                  className="combo"
                  data-testid="grave-play"
                  onClick={() => playFocused(graveTop.uid)}
                  title={
                    graveTop.kind === 'terrain'
                      ? 'Death Prophet — include this terrain in a combo'
                      : 'Death Prophet — play the top card of the grave'
                  }
                >
                  Exorcism · {display(graveTop.defId).name}
                  {graveTop.kind === 'terrain' ? ' · combo' : ''}
                  {liveCombo.includes(graveTop.uid) ? ' ✓' : ''}
                </button>
              ) : null}
            </div>
            {showDetail ? (
              <Detail
                game={game}
                viewer={viewer}
                canAct={canAct}
                canInstant={canInstant}
                focus={focus}
                placing={placing}
                extras={extras}
                comboReady={comboReady}
                chosen={chosen}
                onPlay={playFocused}
                onPlace={() => onAction({ type: 'combo', uids: chosen.map((card) => card.uid) })}
                onTeam={(team) => {
                  if (placing) {
                    onAction({
                      type: 'play',
                      uid: placing,
                      team,
                      extras: extras.length > 0 ? extras : undefined,
                    })
                  }
                  setPlacing(null)
                  setExtras([])
                  setReactSeat(null)
                }}
                onMorph={(uid) => onAction({ type: 'morph', uid })}
                onCancel={() => { setPlacing(null); setExtras([]) }}
              />
            ) : null}
            <p className="log-last" data-testid="log-last">{lastLog}</p>
          </aside>
        )}
      </div>

      <footer className="handbar" data-testid="hand">
        <div className="hand-label">
          <span>{debug ? `${activeName}'s hand` : 'Your hand'}</span>
          <span className={you.hand.length > you.handLimit ? 'over-limit' : undefined}>
            {you.hand.length} / {you.handLimit}
            {you.hand.length > you.handLimit ? ` · discard ${you.hand.length - you.handLimit} at end of turn` : ''}
          </span>
        </div>
        {you.hand.length === 0 && clinkzPlayable.length === 0 ? <p className="quiet">Nothing in hand.</p> : null}
        <div className="hand-row">
          {you.hand.map((card) => (
            <CardFace
              key={card.uid}
              defId={card.defId}
              selected={
                liveCombo.includes(card.uid)
                || placing === card.uid
                || extras.includes(card.uid)
                || (focus?.kind === 'hand' && focus.uid === card.uid)
              }
              onClick={() => clickHand(card)}
              testId={`hand-${card.defId}`}
            />
          ))}
          {clinkzPlayable.map((card) => (
            <CardFace
              key={`clinkz-${card.uid}`}
              defId={card.defId}
              selected={focus?.kind === 'card' && focus.defId === card.defId}
              onClick={() => {
                setFocus({ kind: 'card', defId: card.defId })
                playFocused(card.uid)
              }}
              testId={`clinkz-${card.defId}`}
            />
          ))}
        </div>
        {clinkzPlayable.length > 0 ? (
          <p className="quiet">Skeleton Walk: exiled items above play free this turn.</p>
        ) : null}
      </footer>

      {!debug && game.pending && (!networked || game.pending.actor === onlineSeat) ? (
        <Prompt key={promptKey} pending={game.pending} names={names} onChoose={(ids) => onAction({ type: 'choose', ids })} />
      ) : null}
      {rules ? <Rules onClose={() => setRules(false)} /> : null}
      {glossary ? <Glossary onClose={() => setGlossary(false)} /> : null}
      {logOpen ? <LogSheet log={game.log} names={names} onClose={() => setLogOpen(false)} /> : null}
      {winOpen ? <WinConditionSheet game={game} viewer={viewer} names={names} onClose={() => setWinOpen(false)} /> : null}
      {pile ? (
        <PileDialog
          game={game}
          pile={pile}
          gravePlay={pile === 'grave' ? graveTop : null}
          onClose={() => setPile(null)}
          onRead={(defId) => { setPile(null); setFocus({ kind: 'card', defId }) }}
          onPlayGrave={(uid) => { setPile(null); playFocused(uid) }}
        />
      ) : null}
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
    const shapes = teamShapes(scoreTeam(game, team).why)
    if (shapes.core) core += 1
    if (shapes.mix) mix += 1
  }
  return { core, mix }
}

function teamLetter(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index)
  return String(index + 1)
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
            const letter = teamLetter(index)
            return (
              <article key={team.id} className="team" data-testid={mine ? `team-${index}` : undefined}>
                <header>
                  <span className="team-letter">{letter}</span>
                  <strong className="team-points">{scored.points}</strong>
                  <span className="team-why">{scored.why}</span>
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
                      onClick={() => onInspect({ kind: 'hero', uid: hero.uid })}
                    />
                  ))}
                </div>
                <footer>
                  {team.glyph ? <em>Glyph</em> : null}
                  {team.gaze ? <em>Gaze</em> : null}
                  {team.noEnter ? <em>Sealed</em> : null}
                  {team.mine ? <em>Mine</em> : null}
                  {team.trap ? <em>Trap</em> : null}
                  {team.heroes.length === 0 && !team.trap ? <em>Empty</em> : null}
                </footer>
              </article>
            )
          })}
        </div>
        {combos.length > 0 ? (
          <div className="combos">
            {combos.map((entry) => (
              <article key={entry.id} className="combo-chip" title={entry.kind === 'mixed' ? 'Mixed path' : entry.kind === 'pair' ? 'Split path' : `Three ${entry.kind}s`}>
                <strong>{entry.points}</strong>
                <div className="combo-minis">
                  {entry.cards.map((card) => (
                    <button
                      key={card.uid}
                      type="button"
                      className={`mini kind-${card.defId}`}
                      title={display(card.defId).name}
                      onClick={() => onInspect({ kind: 'card', defId: card.defId })}
                    >
                      {card.defId === 'river' ? 'R' : card.defId === 'jungle' ? 'J' : 'L'}
                    </button>
                  ))}
                </div>
                {entry.protectedBy ? <em>P</em> : null}
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
  canInstant,
  focus,
  placing,
  extras,
  comboReady,
  chosen,
  onPlay,
  onPlace,
  onTeam,
  onMorph,
  onCancel,
}: {
  game: Game
  viewer: PlayerId
  canAct: boolean
  canInstant: boolean
  focus: Focus | null
  placing: string | null
  extras: string[]
  comboReady: boolean
  chosen: CardInst[]
  onPlay: (uid: string) => void
  onPlace: () => void
  onTeam: (team: string) => void
  onMorph: (uid: string) => void
  onCancel: () => void
}) {
  const canPlayCards = canAct || canInstant
  if (placing) {
    const graveCard = playableFromGrave(game, viewer)
    const fromGrave = graveCard?.uid === placing ? graveCard : null
    const card = fromGrave ?? game.players[viewer].hand.find((entry) => entry.uid === placing)
    const options = card ? teamsFor(game, placing, extras) : []
    const mates = extras
      .map((uid) => game.players[viewer].hand.find((entry) => entry.uid === uid))
      .filter((entry): entry is CardInst => !!entry)
    const trap = !!card && isTrapHero(card.defId)
    return (
      <div className="detail">
        <p>
          {fromGrave ? 'Exorcism' : trap ? 'Plant' : 'Active'} {card ? display(card.defId).name : 'hero'}
          {!trap && mates.length > 0 ? ` + ${mates.map((entry) => display(entry.defId).name).join(', ')} (silent)` : ''}
          {' '}onto
        </p>
        <p className="quiet">
          {fromGrave
            ? 'Death Prophet plays the top of the grave for free — pick a team.'
            : trap
            ? 'Choose any team — yours or an opponent’s. At most one trap per team.'
            : card && playsAsInstant(game, viewer, card)
            ? 'Place onto an existing team or a new one. Ability targets resolve from the card text after seating.'
            : 'Click more heroes in hand to bring them in silently. Only the active ability fires.'}
        </p>
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
      </div>
    )
  }
  const card = game.players[viewer].hand.find((entry) => entry.uid === focus.uid)
  if (!card) return <div className="detail quiet">That card has left your hand.</div>
  const info = display(card.defId)
  const block = playBlock(game, viewer, card)
  const mates = card.kind === 'hero'
    ? extras
      .map((uid) => game.players[viewer].hand.find((entry) => entry.uid === uid))
      .filter((entry): entry is CardInst => !!entry && entry.uid !== card.uid)
    : []
  const asInstant = playsAsInstant(game, viewer, card)
  const offTurnInstant = canInstant && asInstant
  const playable = canPlayCards && !block && (canAct || offTurnInstant)
  return (
    <div className="detail">
      <h3>{info.name}</h3>
      {info.spell ? <p className="spell">{info.spell}</p> : null}
      <p>{info.text}</p>
      {mates.length > 0 ? (
        <p className="quiet">Companions: {mates.map((entry) => display(entry.defId).name).join(', ')} (silent)</p>
      ) : null}
      {canAct && card.kind === 'hero' ? (
        <p className="quiet">Click other heroes to add silent companions, then play — one action for the squad.</p>
      ) : null}
      <div className="inline-choices">
        {card.kind === 'terrain' ? (
          <button type="button" className="combo" disabled={!canAct || !comboReady} onClick={onPlace}>
            {comboReady ? 'Place these three · free' : `Selected ${chosen.length}/3`}
          </button>
        ) : (
          <button type="button" className="primary" data-testid="play-card" disabled={!playable} onClick={() => onPlay(card.uid)}>
            {asInstant
              ? `Play ${info.name} · Instant`
              : mates.length > 0
                ? `Play squad · 1 action`
                : `Play ${info.name} · 1 action`}
          </button>
        )}
        {block ? <span className="quiet">{block}</span> : null}
      </div>
    </div>
  )
}

function WinConditionSheet({
  game,
  viewer,
  names,
  onClose,
}: {
  game: Game
  viewer: PlayerId
  names: string[]
  onClose: () => void
}) {
  const target = game.winScore ?? null
  const holds = game.holds ?? []
  const scores = game.players.map((player) => scoreState(game, player.id).total)
  const ancientHolder = game.ancient
    ? allLocs(game).find((loc) => loc.hero.defId === 'ancient')?.hero.controller
    : undefined
  return (
    <div className="scrim" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="win-live-title" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">Match</p>
        <h2 id="win-live-title">Win condition</h2>
        <p data-testid="win-final-rule">
          {game.ancientEnabled
            ? 'Drawing The Ancient starts the final round: each player gets one more turn, then the highest score wins (+10 to whoever holds The Ancient).'
            : 'When the shared deck empties, the final round begins: each player gets one more turn, then the highest score wins.'}
        </p>
        {target ? (
          <p data-testid="target-score">
            Target score <strong>{target}</strong>: end your turn on it and still hold it alone at the start of your next turn to win early.
          </p>
        ) : (
          <p className="quiet">No target score this match.</p>
        )}
        <h3>This match</h3>
        <ul className="win-live" data-testid="win-block">
          <li data-testid="win-ancient">
            {game.ancient
              ? `Final round · ${game.ancient.endsLeft} turn${game.ancient.endsLeft === 1 ? '' : 's'} left${
                  ancientHolder === undefined
                    ? ''
                    : ancientHolder === viewer
                      ? ' · +10 yours'
                      : ` · +10 ${names[ancientHolder] ?? 'seat'}`
                }`
              : game.ancientEnabled
                ? 'Ancient still in the deck'
                : game.deck.length === 0
                  ? 'Deck empty · final round pending'
                  : `Deck ${game.deck.length} · empties to start the final round`}
          </li>
          {holds.map((hold) => {
            const who = hold.seat === viewer ? 'You' : names[hold.seat] ?? 'A seat'
            const score = scores[hold.seat] ?? 0
            return (
              <li key={hold.seat} data-testid="win-hold">
                {who} holds a claim at {score}/{target}
              </li>
            )
          })}
          {scores.map((score, id) => (
            <li key={id} className="quiet">
              {id === viewer ? 'You' : names[id]}: {score}
            </li>
          ))}
        </ul>
        <button type="button" className="primary" data-testid="win-live-done" onClick={onClose}>Close</button>
      </section>
    </div>
  )
}

function PileButton({
  label,
  count,
  testId,
  onClick,
  highlight = false,
}: {
  label: string
  count: number
  testId: string
  onClick: () => void
  highlight?: boolean
}) {
  return (
    <button type="button" className={`pile-chip${highlight ? ' on' : ''}`} data-testid={testId} onClick={onClick}>
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  )
}

function LogSheet({ log, names, onClose }: { log: string[]; names: string[]; onClose: () => void }) {
  const pages = paginateLog(condenseLog(log))
  const [page, setPage] = useState(Math.max(0, pages.length - 1))
  const safe = Math.min(page, pages.length - 1)
  const current = pages[safe] ?? { title: 'Match', lines: [] as { text: string; kind: LogKind }[] }
  return (
    <div className="scrim" onClick={onClose}>
      <section className="sheet sheet-log" role="dialog" aria-modal="true" aria-labelledby="log-title" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">{log.length} lines · {pages.length} round{pages.length === 1 ? '' : 's'}</p>
        <h2 id="log-title">Match log</h2>
        {pages.length > 1 ? (
          <div className="log-pager">
            <button type="button" disabled={safe <= 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>Prev</button>
            <strong>{current.title}</strong>
            <button type="button" disabled={safe >= pages.length - 1} onClick={() => setPage((n) => Math.min(pages.length - 1, n + 1))}>Next</button>
          </div>
        ) : null}
        {current.lines.length === 0 ? <p className="quiet">Nothing logged yet.</p> : null}
        <ol className="log-list">
          {current.lines.map((entry, index) => (
            <li key={`${safe}-${index}-${entry.text}`} className={`log-line log-${entry.kind}`}>
              {emphasize(entry.text, names)}
            </li>
          ))}
        </ol>
        <button type="button" className="primary" onClick={onClose}>Close</button>
      </section>
    </div>
  )
}

type LogKind = 'turn' | 'action' | 'ability' | 'instant' | 'aura' | 'detail'

/** Fold repeated destroys and exiles into one line each, so a wipe reads as a list. */
function condenseLog(log: string[]): string[] {
  const out: string[] = []
  let destroy: { cause: string; owner: string; names: string[] } | null = null
  let exile: string[] = []
  const flushDestroy = () => {
    if (!destroy) return
    const list = destroy.names.join(', ')
    out.push(destroy.owner ? `${destroy.cause} destroys ${destroy.owner}'s ${list}.` : `${destroy.cause} destroys ${list}.`)
    destroy = null
  }
  const flushExile = () => {
    if (exile.length === 0) return
    out.push(exile.length === 1 ? `${exile[0]} is exiled.` : `Exiled: ${exile.join(', ')}.`)
    exile = []
  }
  for (const line of log) {
    const killed = /^(.+?) destroys (.+)$/.exec(line)
    if (killed) {
      flushExile()
      const rest = killed[2]!
      const owned = /^(.+?)'s (.+)\.$/.exec(rest)
      const cause = killed[1]!
      const owner = owned ? owned[1]! : ''
      const hero = owned ? owned[2]! : rest.replace(/\.$/, '')
      if (destroy && destroy.cause === cause && destroy.owner === owner) destroy.names.push(hero)
      else {
        flushDestroy()
        destroy = { cause, owner, names: [hero] }
      }
      continue
    }
    const gone = /^(.+) is exiled\.$/.exec(line)
    if (gone) {
      flushDestroy()
      exile.push(gone[1]!)
      continue
    }
    flushDestroy()
    flushExile()
    out.push(line)
  }
  flushDestroy()
  flushExile()
  return out
}

function emphasize(text: string, names: string[]): ReactNode {
  const known = [...names].filter((name) => name.length > 0).sort((a, b) => b.length - a.length)
  if (known.length === 0) return text
  const re = new RegExp(`(${known.map(escapeRe).join('|')})`, 'g')
  return text.split(re).map((part, index) => (known.includes(part) ? <strong key={index}>{part}</strong> : part))
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function paginateLog(log: string[]): { title: string; lines: { text: string; kind: LogKind }[] }[] {
  // One page per full round. A new round starts when the first seat's turn returns. Turn lines stay highlighted.
  const pages: { title: string; lines: { text: string; kind: LogKind }[] }[] = []
  let current: { title: string; lines: { text: string; kind: LogKind }[] } | null = null
  let opener: string | null = null
  let round = 0
  for (const line of log) {
    const turn = /^(.+)'s turn\./.exec(line)
    if (turn) {
      const name = turn[1]!
      if (!opener) {
        opener = name
        round = 1
        current = { title: `Round ${round}`, lines: [] }
        pages.push(current)
      } else if (name === opener) {
        round += 1
        current = { title: `Round ${round}`, lines: [] }
        pages.push(current)
      }
      if (!current) {
        current = { title: 'Opening', lines: [] }
        pages.push(current)
      }
      current.lines.push({ text: line, kind: 'turn' })
      continue
    }
    if (!current) {
      current = { title: 'Opening', lines: [] }
      pages.push(current)
    }
    current.lines.push({ text: line, kind: classifyLog(line) })
  }
  return pages.length > 0 ? pages : [{ title: 'Match', lines: [] }]
}

function classifyLog(line: string): LogKind {
  if (/'s turn\./.test(line)) return 'turn'
  if (/plays Instant /.test(line)) return 'instant'
  if (/ is an aura|aura\./i.test(line) || line.startsWith('Arcane Aura')) return 'aura'
  if (/plays |fields |calls |draws \d+ (for the turn|as an action)|sets /.test(line)) return 'action'
  if (/— /.test(line) || /stops |nullif|counters |Global Silence|Orchid|Shiva/.test(line)) return 'ability'
  return 'detail'
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
  gravePlay,
  onClose,
  onRead,
  onPlayGrave,
}: {
  game: Game
  pile: PileName
  gravePlay: { uid: string; defId: string } | null
  onClose: () => void
  onRead: (defId: string) => void
  onPlayGrave: (uid: string) => void
}) {
  const sealed = pile === 'deck' || pile === 'runes' || pile === 'neutrals' || pile === 'towers'
  const cards = pile === 'grave' ? game.grave : pile === 'exile' ? game.exile : []
  const title = pile === 'deck' ? 'Shared deck' : pile === 'grave' ? 'Grave' : pile === 'exile' ? 'Exile' : pile === 'runes' ? 'Runes' : pile === 'neutrals' ? 'Neutrals' : 'Towers'
  const count = game[pile].length
  const top = cards[cards.length - 1]
  return (
    <div className="scrim" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">{count} cards</p>
        <h2>{title}</h2>
        {pile === 'deck' ? <p>The deck is shared and face down. The match ends when it is empty.</p> : null}
        {pile === 'runes' || pile === 'neutrals' || pile === 'towers' ? <p>This pile is shuffled face down. Three matching terrains take the top card. You can read it once it reaches your hand.</p> : null}
        {pile === 'grave' ? (
          <p>
            Discarded cards and destroyed heroes wait here.
            {gravePlay && top ? ' Death Prophet can play the top card (free).' : ' Anyone can take from the grave when an ability says so.'}
          </p>
        ) : null}
        {pile === 'exile' ? (
          <p>
            Exiled cards are normally out of the game.
            {game.clinkzExile.length > 0
              ? ' Skeleton Walk items listed in your hand bar can be played free this turn.'
              : ''}
          </p>
        ) : null}
        {gravePlay && top ? (
          <div className="actions">
            <button type="button" className="primary" data-testid="grave-play-dialog" onClick={() => onPlayGrave(top.uid)}>
              Exorcism · play {display(top.defId).name}
            </button>
          </div>
        ) : null}
        {!sealed && cards.length === 0 ? <p className="quiet">Nothing here yet.</p> : null}
        {!sealed && pile === 'grave' ? (
          <>
            {cards.length > 1 ? (
              <p className="quiet">Newest first. Only the top card can be played or taken from the top.</p>
            ) : null}
            <div className="hand-row dialog-cards grave-list" data-testid="grave-list">
              {[...cards].reverse().map((card, index) => (
                <div key={card.uid} className={index === 0 ? 'grave-slot top' : 'grave-slot'}>
                  <CardFace
                    defId={card.defId}
                    compact
                    selected={index === 0 && !!gravePlay}
                    onClick={() => onRead(card.defId)}
                  />
                  <small className="quiet">{index === 0 ? 'Top' : `#${index + 1}`}</small>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {!sealed && pile !== 'grave' ? (
          <div className="hand-row dialog-cards">
            {cards.map((card) => (
              <CardFace
                key={card.uid}
                defId={card.defId}
                compact
                onClick={() => onRead(card.defId)}
              />
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
              <small>{over.parts[index]?.teams ?? 0} from teams · {over.parts[index]?.terrains ?? 0} from terrains</small>
            </div>
          ))}
        </div>
        <button type="button" className="primary" onClick={onLobby}>New match</button>
      </section>
    </div>
  )
}
