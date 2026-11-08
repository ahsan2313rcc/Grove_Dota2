import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AI_STRATS, stratLabel } from '../game/ai.ts'
import {
  buildTurnGraph,
  IMPACT_HORIZONS,
  summarizeShapesAtTurn,
  type BalanceSummary,
  type CardBalanceRow,
  type MatchReport,
  type ShapeCompareRow,
  type StratFilter,
  type TurnGraphMetric,
} from '../game/balance.ts'
import {
  AI_POWER_MAX,
  AI_POWER_MIN,
  aiSearchBudget,
  aiThoughtPowerLabel,
} from '../game/aiPower.ts'
import type { NnMemoryInfo } from '../game/nnMemory.ts'
import type { AiStrat } from '../game/types.ts'
import { display } from '../game/catalog.ts'
import { scoreState, scoreTeam } from '../game/flow.ts'
import { teamShapes } from '../game/scoring.ts'
import type { Game } from '../game/types.ts'
import { CardArt } from './CardArt.tsx'

export type DebugSpeed = 0 | 0.5 | 1 | 2
export type DebugView = 'watch' | 'stats'

const MAX_QUEUE = 100_000

const SPEEDS: { value: DebugSpeed; label: string }[] = [
  { value: 0, label: 'Pause' },
  { value: 0.5, label: '0.5×' },
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
]

export function DebugRail({
  game,
  seed,
  stuck,
  speed,
  view,
  batchSize,
  focus: _focus,
  runCount,
  finishedCount,
  runningBatch,
  queueLeft = 0,
  summary,
  reports,
  stratFilter,
  onSpeed,
  onStep,
  onView,
  onBatchSize,
  onFocus: _onFocus,
  onRunBatch,
  onPlayNext,
  onStratFilter,
  onReset,
  trainNeural = false,
  nnInfo,
  onTrainNeural,
  onNnSave,
  onNnExportGit,
  onNnClear,
  thoughtPower = 7,
  onThoughtPower,
}: {
  game: Game | null
  seed: number
  stuck: boolean
  speed: DebugSpeed
  view: DebugView
  batchSize: number
  focus: number
  runCount: number
  finishedCount: number
  runningBatch: boolean
  queueLeft?: number
  summary: BalanceSummary
  reports: MatchReport[]
  stratFilter: StratFilter
  onSpeed: (speed: DebugSpeed) => void
  onStep: () => void
  onView: (view: DebugView) => void
  onBatchSize: (size: number) => void
  onFocus: (index: number) => void
  onRunBatch: () => void
  onPlayNext?: () => void
  onStratFilter: (filter: StratFilter) => void
  onReset: () => void
  trainNeural?: boolean
  nnInfo?: NnMemoryInfo
  onTrainNeural?: (on: boolean) => void
  onNnSave?: () => void
  onNnExportGit?: () => void
  onNnClear?: () => void
  thoughtPower?: number
  onThoughtPower?: (value: number) => void
}) {
  const active = game?.players[game.active]
  void _focus
  void _onFocus
  const [scrubTurn, setScrubTurn] = useState<number | null>(null)
  const [graphMetric, setGraphMetric] = useState<TurnGraphMetric>('rel')
  const [graphHero, setGraphHero] = useState<string>('')

  const maxTurn = Math.max(1, summary.maxTurn || 1)
  const effectiveTurn = scrubTurn == null ? null : Math.min(scrubTurn, maxTurn)
  const shapeRows = useMemo(
    () => (effectiveTurn == null ? summary.shapeCompare : summarizeShapesAtTurn(reports, stratFilter, effectiveTurn)),
    [effectiveTurn, reports, stratFilter, summary.shapeCompare],
  )
  const graphPoints = useMemo(
    () => buildTurnGraph(reports, stratFilter, graphMetric, graphHero || null),
    [reports, stratFilter, graphMetric, graphHero],
  )

  return (
    <aside className="debug-rail" data-testid="debug-rail">
      <div className="debug-head">
        <p className="eyebrow">Debug balance</p>
        <h2>d{seed}</h2>
        <p className="quiet">
          {runningBatch && view === 'stats'
            ? `Fast sim… ${finishedCount} done · ${queueLeft} left`
            : queueLeft > 0 && view === 'watch'
              ? `${queueLeft} queued · ${finishedCount} done`
              : game?.over
                ? 'Match over'
                : stuck
                  ? 'AI stuck'
                  : game
                    ? `${active?.name ?? '—'} · T${game.turn}`
                    : 'Stats only'}
        </p>
      </div>

      <div className="debug-speeds" role="group" aria-label="View mode">
        <button type="button" className={view === 'watch' ? 'on' : ''} data-testid="debug-view-watch" onClick={() => onView('watch')}>Watch</button>
        <button type="button" className={view === 'stats' ? 'on' : ''} data-testid="debug-view-stats" onClick={() => onView('stats')}>Stats only</button>
      </div>

      <div className="debug-speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className={speed === entry.value ? 'on' : ''}
            data-testid={`debug-speed-${entry.label.replace('×', 'x').toLowerCase()}`}
            onClick={() => onSpeed(entry.value)}
            disabled={view === 'stats' && !game}
          >
            {entry.label}
          </button>
        ))}
        <button type="button" data-testid="debug-step" disabled={!game || !!game.over || speed !== 0 || view === 'stats'} onClick={onStep}>
          Step
        </button>
        <button type="button" data-testid="debug-reset" onClick={onReset}>
          Reset
        </button>
      </div>

      {onThoughtPower ? (
        <div className="debug-block">
          <h3>AI thought power</h3>
          <label className="thought-power">
            <span>
              {thoughtPower}/10 · {aiThoughtPowerLabel(thoughtPower)}
            </span>
            <input
              data-testid="debug-thought-power"
              type="range"
              min={AI_POWER_MIN}
              max={AI_POWER_MAX}
              step={1}
              value={thoughtPower}
              onChange={(event) => onThoughtPower(Number(event.target.value))}
            />
            <span className="quiet">
              {(() => {
                const b = aiSearchBudget(thoughtPower)
                return `Heuristic depth ${b.depth} · beam ${b.beam} · hand ${b.handPly}`
              })()}
            </span>
          </label>
        </div>
      ) : null}

      <div className="debug-block">
        <h3>Sequential queue</h3>
        <div className="debug-batch">
          <label>
            Add
            <input
              data-testid="debug-batch-size"
              type="number"
              min={1}
              max={MAX_QUEUE}
              value={batchSize}
              onChange={(event) => onBatchSize(Math.max(1, Math.min(MAX_QUEUE, Number(event.target.value) || 1)))}
            />
          </label>
          <button type="button" className="primary" data-testid="debug-run-batch" disabled={runningBatch && view === 'stats'} onClick={onRunBatch}>
            {view === 'stats' ? `Sim ${batchSize} fast` : `Queue ${batchSize}`}
          </button>
          {onPlayNext ? (
            <button type="button" data-testid="debug-play-next" onClick={onPlayNext}>
              Next game
            </button>
          ) : null}
        </div>
        <p className="quiet">
          Stats runs at max speed, one game at a time. Switch to Watch to slow the board. {queueLeft > 0 ? `${queueLeft} left. ` : ''}
          {finishedCount} finished · {summary.matches} traced{runningBatch ? ' · running' : ''}
        </p>
      </div>

      {onTrainNeural ? (
        <div className="debug-block">
          <h3>Neural memory</h3>
          <label className="check-row">
            <input
              data-testid="debug-train-neural"
              type="checkbox"
              checked={trainNeural}
              onChange={(event) => onTrainNeural(event.target.checked)}
            />
            Train enabled
          </label>
          <p className="quiet">
            Every AI-vs-AI game run here (Stats or Watch) trains the Neural value net from all seats' decisions; seats keep their own strat and only Neural seats explore. Each position is scored by the rel change it led to now and +1/+3/+5/+10 turns later, plus the final placement. Autosaves every 10 games. Save → localStorage. Export for git → `nn-value.json` under `grove/src/game/data/`. Clear returns to the shipped checkpoint.
            {nnInfo
              ? ` Memory: ${nnInfo.trainedGames} games · ${nnInfo.trainedSamples.toLocaleString()} samples · fit error ±${(Math.sqrt(nnInfo.recentLoss) * 20).toFixed(1)} rel pts${nnInfo.persisted ? ' · saved locally' : ' · unsaved'}.`
              : ''}
          </p>
          <div className="debug-speeds" role="group" aria-label="Neural memory actions">
            <button type="button" data-testid="debug-nn-save" onClick={() => onNnSave?.()}>Save</button>
            <button type="button" data-testid="debug-nn-export-git" onClick={() => onNnExportGit?.()}>Export for git</button>
            <button type="button" data-testid="debug-nn-clear" onClick={() => onNnClear?.()}>Clear</button>
          </div>
        </div>
      ) : null}

      <div className="debug-block">
        <h3>Strat filter</h3>
        <div className="debug-speeds" role="group" aria-label="Strat filters">
          {AI_STRATS.map((entry) => {
            const on = stratFilter.strats.includes(entry.id)
            return (
              <button
                key={entry.id}
                type="button"
                className={on ? 'on' : ''}
                data-testid={`debug-strat-${entry.id}`}
                aria-pressed={on}
                onClick={() => onStratFilter(toggleStrat(stratFilter, entry.id))}
              >
                {entry.label}
              </button>
            )
          })}
          <button
            type="button"
            className={stratFilter.mixOnly ? 'on' : ''}
            data-testid="debug-strat-mix"
            aria-pressed={stratFilter.mixOnly}
            onClick={() => onStratFilter({ ...stratFilter, mixOnly: !stratFilter.mixOnly })}
          >
            Mixed seats
          </button>
        </div>
        <p className="quiet debug-legend">
          {stratFilter.strats.length === 0 && !stratFilter.mixOnly
            ? 'All seats. Toggle strats to slice tables; Mixed seats keeps only matches with different seat strats.'
            : [
              stratFilter.strats.length > 0 ? `Seats: ${stratFilter.strats.map(stratLabel).join(' · ')}` : 'All strats',
              stratFilter.mixOnly ? 'mixed-seat matches only' : null,
            ].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="debug-block">
        <h3>Summary</h3>
        <p className="quiet" data-testid="debug-summary-line">
          {summary.finished}/{summary.matches} games done · avg length T{fmt(summary.avgTurns)} · final spread {fmt(summary.avgFinalSpread)} pts · winner avg {fmt(summary.avgWinnerScore)} pts
        </p>
        <p className="quiet debug-legend">
          Rel = score Δ vs the mean opponent while the play resolves · Self = own score Δ · Impact = how much more Rel the seat gained over the next +1/+3/+5/+10 turns than an average play at the same stage (so auras, traps, engines and discard count when they pay off) · Rel +5 = raw Rel change five turns on. Hover Impact for every horizon. Win% = play-weighted seat wins.
        </p>
      </div>

      <div className="debug-block">
        <h3>By strat</h3>
        <p className="quiet debug-legend">Place = average finish (1 is first). Self/Rel = mean swing for that strat’s plays.</p>
        {summary.byStrat.length === 0 ? (
          <p className="quiet">No strat samples yet.</p>
        ) : (
          <table className="debug-table debug-table-compact">
            <thead>
              <tr><th>Strat</th><th className="debug-num" title="Wins / finished seats">W</th><th className="debug-num" title="Average final score">Avg</th><th className="debug-num">Place</th><th className="debug-num">Self</th><th className="debug-num">Rel</th></tr>
            </thead>
            <tbody>
              {summary.byStrat.map((row) => (
                <tr key={row.strat}>
                  <td><strong>{stratLabel(row.strat)}</strong><small>{row.plays} plays</small></td>
                  <td className="debug-num">{row.wins}/{row.finishes}</td>
                  <td className="debug-num">{fmt(row.avgScore)}</td>
                  <td className="debug-num">{fmt(row.avgStanding)}</td>
                  <td className="debug-num">{signed(row.avgSelfSwing)}</td>
                  <td className="debug-num">{signed(row.avgRelSwing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="debug-block">
        <h3>Turn scrubber</h3>
        <p className="quiet debug-legend">
          Shape table below uses the board at this turn (or Final). Snapshots are taken at the end of each seat’s turn.
        </p>
        <div className="debug-scrub">
          <label>
            Turn
            <input
              data-testid="debug-turn-scrub"
              type="range"
              min={1}
              max={maxTurn}
              value={effectiveTurn ?? maxTurn}
              onChange={(event) => setScrubTurn(Number(event.target.value))}
            />
          </label>
          <strong>{effectiveTurn == null ? `Final (T${maxTurn})` : `T${effectiveTurn}`}</strong>
          <button type="button" className="debug-mode-cycle" onClick={() => setScrubTurn(null)}>Final</button>
        </div>
      </div>

      <div className="debug-block">
        <h3>Turn graph</h3>
        <div className="debug-graph-controls">
          <label>
            Y
            <select data-testid="debug-graph-metric" value={graphMetric} onChange={(event) => setGraphMetric(event.target.value as TurnGraphMetric)}>
              <option value="rel">Hero Rel</option>
              <option value="self">Hero Self</option>
              <option value="seatScore">Seat score</option>
              <option value="pointsDelta">Turn Δ pts</option>
              <option value="cards">Cards / turn</option>
            </select>
          </label>
          <label>
            Hero
            <select
              data-testid="debug-graph-hero"
              value={graphHero}
              onChange={(event) => setGraphHero(event.target.value)}
              disabled={graphMetric !== 'rel' && graphMetric !== 'self'}
            >
              <option value="">All heroes</option>
              {summary.graphHeroes.map((hero) => (
                <option key={hero.defId} value={hero.defId}>{hero.name}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="quiet debug-legend">X = turn. Hero Rel/Self combine body+ability per play. Seat score averages filtered seats.</p>
        <TurnGraph points={graphPoints} testId="graph-turn-metric" />
      </div>

      <div className="debug-block">
        <h3>Shape compare {effectiveTurn == null ? '(final)' : `(T${effectiveTurn})`}</h3>
        <p className="quiet debug-legend">
          Core ×N = same-attr stack N (5+ → ×5). Mix · M = M distinct attrs. Dual-count allowed.
          Avg pts = mean team score. Pts/card = points ÷ heroes (cards for terrain). Pure = mono cores, or mixes with one hero per attribute.
        </p>
        <ShapeTable rows={shapeRows.filter((row) => !row.id.endsWith('_terrain'))} />
        <h4 className="debug-subhead">Terrain combos</h4>
        <p className="quiet debug-legend">
          Three alike = 8 + reward (River → rune, Jungle → neutral, Lane → tower). 1 of each = 5. Mixed combo (2 + 1) = 3.
        </p>
        <ShapeTable rows={shapeRows.filter((row) => row.id.endsWith('_terrain'))} />
      </div>

      <div className="debug-block">
        <h3>Event counts</h3>
        <SortableTable
          empty="No events yet."
          columns={[
            { key: 'label', label: 'Event', get: (row) => row.label, sortValue: (row) => row.label },
            { key: 'total', label: 'Total', get: (row) => String(row.total), sortValue: (row) => row.total, className: 'debug-num' },
            { key: 'per', label: '/match', get: (row) => fmt(row.perMatch), sortValue: (row) => row.perMatch, className: 'debug-num' },
          ]}
          rows={summary.eventStats}
          rowKey={(row) => row.id}
          pageSize={10}
        />
      </div>

      <ImpactTable rows={summary.contested} />

      <div className="debug-rel-grid">
        <HeroModeTable
          total={summary.heroPlaysTotal}
          silenced={summary.heroPlaysSilenced}
          open={summary.heroPlaysOpen}
          seats={summary.seats}
        />
        <div className="debug-block">
          <h3>Items / runes / neutrals / towers</h3>
          <CardSortTable rows={summary.loot} empty="No loot plays yet." pageSize={10} />
        </div>
      </div>

      <div className="debug-rel-grid">
        <div className="debug-block">
          <h3>By attribute</h3>
          <p className="quiet debug-legend">Hero body + ability swings rolled by attr.</p>
          <SortableTable
            empty="No attr samples yet."
            defaultSort={{ key: 'plays', dir: 'desc' }}
            columns={[
              {
                key: 'attr',
                label: 'Attr',
                get: (row) => <strong>{row.attr === 'none' ? '—' : attrLabel(row.attr)}</strong>,
                sortValue: (row) => row.attr,
              },
              { key: 'plays', label: 'n', get: (row) => String(row.plays), sortValue: (row) => row.plays, className: 'debug-num' },
              { key: 'rel', label: 'Rel', get: (row) => signed(row.avgRelativeSwing), sortValue: (row) => row.avgRelativeSwing, className: 'debug-num' },
              { key: 'self', label: 'Self', get: (row) => signed(row.avgActorSwing), sortValue: (row) => row.avgActorSwing, className: 'debug-num' },
            ]}
            rows={summary.byAttr}
            rowKey={(row) => String(row.attr)}
          />
        </div>
        <div className="debug-block">
          <h3>Terrains</h3>
          <CardSortTable rows={summary.terrains} empty="No terrain plays yet." pageSize={10} />
        </div>
      </div>

      <div className="debug-block">
        <h3>By ability type</h3>
        <p className="quiet debug-legend">
          Primary effect family per on-play ability. Impact uses the same horizon baseline as the card tables (Rel dropped here — ability Rel mixed body seating).
        </p>
        <SortableTable
          empty="No ability types yet."
          defaultSort={{ key: 'impact', dir: 'desc' }}
          columns={[
            { key: 'label', label: 'Type', get: (row) => <strong>{row.label}</strong>, sortValue: (row) => row.label },
            { key: 'plays', label: 'n', get: (row) => String(row.plays), sortValue: (row) => row.plays, className: 'debug-num' },
            { key: 'self', label: 'Self', get: (row) => signed(row.avgActorSwing), sortValue: (row) => row.avgActorSwing, className: 'debug-num' },
            {
              key: 'impact',
              label: 'Impact',
              get: (row) => signed(row.avgImpact),
              sortValue: (row) => row.avgImpact,
              className: 'debug-num',
            },
            {
              key: 'win',
              label: 'Win%',
              get: (row) => (row.presence > 0 ? pctCell(row.winRate, row.wins, row.presence, summary.seats) : '—'),
              sortValue: (row) => winRateShown(row.winRate, summary.seats),
              className: 'debug-num',
            },
          ]}
          rows={summary.byAbilityType}
          rowKey={(row) => row.id}
          pageSize={10}
        />
      </div>

      {game ? (
        <>
          <div className="debug-block">
            <h3>Live standings</h3>
            <ul className="debug-standings">
              {game.players.map((player) => {
                const scored = scoreState(game, player.id)
                const shapes = countShapes(game, player.id)
                return (
                  <li key={player.id} className={player.id === game.active ? 'on' : ''}>
                    <div className="debug-standing-top">
                      <strong>{player.name}</strong>
                      <span>{scored.total}</span>
                    </div>
                    <small>
                      {player.ai ? `${stratLabel(player.strat)} · ` : ''}
                      {scored.teams}+{scored.terrains} · hand {player.hand.length} · {shapes.core}c/{shapes.mix}m
                    </small>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="debug-block">
            <h3>Active board</h3>
            <ul className="debug-teams">
              {active?.teams.map((team) => {
                const scored = scoreTeam(game, team)
                return (
                  <li key={team.id}>
                    <strong>{scored.points}</strong> {scored.why}
                    <span>{team.heroes.map((hero) => display(hero.defId).name).join(', ')}</span>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="debug-block">
            <h3>Log</h3>
            <ol className="debug-log">
              {game.log.slice(-10).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
            </ol>
          </div>
        </>
      ) : null}

      {reports.length > 0 ? (
        <div className="debug-block">
          <h3>Match results</h3>
          <ul className="debug-results">
            {reports.slice(-12).map((report) => (
              <li key={report.seed}>
                seed {report.seed}: {report.over ? report.finalScores.join('–') : 'open'} · T{report.turns}
                <small> · {report.mixture ? 'mix' : stratLabel(report.seatStrats[0] ?? 'balanced')}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  )
}

type SortDir = 'asc' | 'desc'

type SortState = { key: string; dir: SortDir } | null

type Column<T> = {
  key: string
  label: string
  get: (row: T) => ReactNode
  sortValue: (row: T) => string | number
  className?: string
}

function cycleSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, dir: 'desc' }
  if (current.dir === 'desc') return { key, dir: 'asc' }
  return null
}

const PAGE_SIZE = 10

function SortableTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'Nothing yet.',
  defaultSort = null,
  limit,
  pageSize,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: string
  defaultSort?: SortState
  /** Hard cap (no paging). Prefer pageSize for top-N with next/prev. */
  limit?: number
  /** Page through sorted rows this many at a time (default off). */
  pageSize?: number
}) {
  const [sort, setSort] = useState<SortState>(defaultSort)
  const [page, setPage] = useState(0)
  if (rows.length === 0) return <p className="quiet">{empty}</p>
  const ordered = [...rows]
  if (sort) {
    const col = columns.find((entry) => entry.key === sort.key)
    if (col) {
      ordered.sort((a, b) => {
        const av = col.sortValue(a)
        const bv = col.sortValue(b)
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
  }
  const capped = limit ? ordered.slice(0, limit) : ordered
  const size = pageSize && pageSize > 0 ? pageSize : 0
  const pages = size ? Math.max(1, Math.ceil(capped.length / size)) : 1
  const safePage = Math.min(page, pages - 1)
  const shown = size ? capped.slice(safePage * size, safePage * size + size) : capped
  const rankBase = size ? safePage * size : 0
  return (
    <div className="debug-table-wrap">
      <table className="debug-table debug-table-sort">
        <thead>
          <tr>
            <th className="debug-rank-col" title="Rank">#</th>
            {columns.map((col) => {
              const active = sort?.key === col.key
              const mark = !active ? '' : sort.dir === 'desc' ? ' ↓' : ' ↑'
              return (
                <th key={col.key} className={col.className}>
                  <button
                    type="button"
                    className={`debug-sort${active ? ' on' : ''}`}
                    aria-pressed={active}
                    title={`Sort by ${col.label}`}
                    onClick={() => {
                      setSort((current) => cycleSort(current, col.key))
                      setPage(0)
                    }}
                  >
                    {col.label}{mark}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr key={rowKey(row)}>
              <td className="debug-rank-col">{rankBase + index + 1}</td>
              {columns.map((col) => (
                <td key={col.key} className={col.className}>{col.get(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {size && capped.length > size ? (
        <div className="debug-page" data-testid="debug-table-page">
          <button type="button" disabled={safePage <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
            Prev {size}
          </button>
          <span className="quiet">
            {rankBase + 1}–{Math.min(rankBase + size, capped.length)} of {capped.length}
          </span>
          <button type="button" disabled={safePage >= pages - 1} onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}>
            Next {size}
          </button>
        </div>
      ) : null}
    </div>
  )
}

type HeroSwingMode = 'total' | 'silenced' | 'open'

function HeroModeTable({
  total,
  silenced,
  open,
  seats,
}: {
  total: CardBalanceRow[]
  silenced: CardBalanceRow[]
  open: CardBalanceRow[]
  seats: number
}) {
  const [mode, setMode] = useState<HeroSwingMode>('total')
  // Cycle drives Rel/Impact and the Win% partition (total vs ability vs silenced).
  const rows = mode === 'total' ? total : mode === 'silenced' ? silenced : open
  const label =
    mode === 'total' ? 'Total (body+ability)' : mode === 'silenced' ? 'Silenced' : 'Ability fired'
  const winLegend =
    mode === 'total'
      ? 'n / Win% = all plays'
      : mode === 'silenced'
        ? 'n / Win% = silenced plays only'
        : 'n / Win% = ability-fired plays only'
  return (
    <div className="debug-block">
      <h3>
        Heroes{' '}
        <button
          type="button"
          className="debug-mode-cycle"
          data-testid="hero-swing-mode"
          onClick={() => setMode((current) => (current === 'total' ? 'silenced' : current === 'silenced' ? 'open' : 'total'))}
        >
          {label}
        </button>
      </h3>
      <p className="quiet debug-legend">
        Cycle total → silenced → ability fired for that slice (Rel / Impact / Win%). {winLegend}. Win% scaled so fair ≈ 50%. Hover % for raw.
      </p>
      <CardSortTable
        key={mode}
        rows={rows}
        empty="No hero plays yet for this mode."
        heroWins
        heroWinMode={mode}
        seats={seats}
        pageSize={PAGE_SIZE}
      />
    </div>
  )
}

function ImpactTable({ rows }: { rows: CardBalanceRow[] }) {
  return (
    <div className="debug-block" data-testid="debug-impact-table">
      <h3>Highest impact</h3>
      <p className="quiet debug-legend">
        Impact = how much Rel improved over the next +1/+3/+5/+10 turns vs an average play at that stage of the game
        (weights 25% / 30% / 25% / 20%). Ranked by |Impact| × √n. Hover a cell for horizons + mechanical EV bag.
      </p>
      <CardSortTable
        rows={rows}
        empty="No impact samples yet."
        defaultSort={{ key: 'impact', dir: 'desc' }}
        pageSize={PAGE_SIZE}
      />
    </div>
  )
}

function ShapeTable({ rows }: { rows: ShapeCompareRow[] }) {
  if (rows.length === 0) return <p className="quiet">No shape samples yet.</p>
  return (
    <table className="debug-table debug-table-compact debug-table-shape" data-testid="debug-shape-table">
      <thead>
        <tr>
          <th>Shape</th>
          <th className="debug-num" title="Teams or combos counted (dual-count allowed)">n</th>
          <th className="debug-num" title="Mean count per match">/match</th>
          <th className="debug-num" title="Mean points per team or combo">Avg pts</th>
          <th className="debug-num" title="Points ÷ heroes (terrain: ÷ 3 cards)">Pts/card</th>
          <th className="debug-num" title="Mono cores, or mixes with one hero per attribute">Pure</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} data-shape={row.id}>
            <td><strong>{row.label}</strong></td>
            <td className="debug-num">{row.count}</td>
            <td className="debug-num">{fmt(row.avgCount)}</td>
            <td className="debug-num">{fmt(row.avgPoints)}</td>
            <td className="debug-num">{fmt(row.avgPtsPerCard)}</td>
            <td className="debug-num">{row.pureCount ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TurnGraph({
  points,
  testId,
}: {
  points: { turn: number; value: number; samples: number }[]
  testId: string
}) {
  const values = points.map((point) => point.value)
  const labels = points.map((point) => point.turn)
  const samples = points.reduce((sum, point) => sum + point.samples, 0)
  if (values.length === 0) {
    return <p className="quiet" data-testid={testId}>No turn samples yet.</p>
  }
  return (
    <Sparkline
      values={values}
      labels={labels}
      testId={testId}
      yLabel={`${samples} samples`}
      baselineZero
    />
  )
}

/** One n + Win% pair — ability / silenced splits live behind the Heroes cycle button. */
function heroWinColumns(mode: HeroSwingMode, seats: number): Column<CardBalanceRow>[] {
  const sampleCount = (row: CardBalanceRow) => {
    if (mode !== 'total') return row.plays
    const samples = row.abilityPlays + row.silencedPlays
    return samples > 0 ? samples : row.plays
  }
  return [
    {
      key: 'n',
      label: 'n',
      get: (row) => String(sampleCount(row)),
      sortValue: (row) => sampleCount(row),
      className: 'debug-num',
    },
    {
      key: 'win',
      label: 'Win%',
      get: (row) => pctCell(row.playWinRate, row.playWins, sampleCount(row), seats),
      sortValue: (row) => winRateShown(row.playWinRate, seats),
      className: 'debug-num',
    },
  ]
}

function CardSortTable({
  rows,
  empty = 'No card plays yet.',
  defaultSort = { key: 'rel', dir: 'desc' as const },
  heroWins = false,
  heroWinMode = 'total' as HeroSwingMode,
  seats = 0,
  pageSize = PAGE_SIZE,
}: {
  rows: CardBalanceRow[]
  empty?: string
  defaultSort?: SortState
  /** Heroes table: n / Win% for the active cycle slice. */
  heroWins?: boolean
  /** Cycle mode: total / silenced / ability-fired partition. */
  heroWinMode?: HeroSwingMode
  /** Lobby size for seat-scaled hero Win% (fair ≈ 50%). */
  seats?: number
  pageSize?: number
}) {
  const winCols: Column<CardBalanceRow>[] = heroWins
    ? heroWinColumns(heroWinMode, seats)
    : [
        {
          key: 'win',
          label: 'Win%',
          get: (row) =>
            row.plays > 0
              ? pctCell(row.playWinRate, row.playWins, row.plays, seats)
              : row.presence > 0
                ? pctCell(row.winRate, row.wins, row.presence, seats)
                : '—',
          sortValue: (row) => {
            const rate = row.plays > 0 ? row.playWinRate : row.winRate
            return winRateShown(rate, seats)
          },
          className: 'debug-num',
        },
      ]

  // Hero win cols already include n for the active cycle slice.
  const hideGenericN = heroWins

  return (
    <SortableTable
      empty={empty}
      defaultSort={defaultSort}
      rows={rows}
      rowKey={(row) => `${row.kind}-${row.defId}`}
      pageSize={pageSize}
      columns={[
        {
          key: 'card',
          label: 'Card',
          get: (row) => (
            <span className="debug-card-cell">
              <CardArt defId={row.defId} size="icon" className="debug-card-art" />
              <span className="debug-card-copy">
                <strong>{row.name}</strong>
                <small>
                  {row.kind}
                  {row.attr ? ` · ${attrLabel(row.attr)}` : ''}
                  {row.instant ? ' · instant' : ''}
                </small>
              </span>
            </span>
          ),
          sortValue: (row) => row.name,
        },
        ...(hideGenericN
          ? []
          : [{ key: 'n', label: 'n', get: (row: CardBalanceRow) => String(row.plays), sortValue: (row: CardBalanceRow) => row.plays, className: 'debug-num' }]),
        { key: 'rel', label: 'Rel', get: (row) => signed(row.avgRelativeSwing), sortValue: (row) => row.avgRelativeSwing, className: 'debug-num' },
        { key: 'self', label: 'Self', get: (row) => signed(row.avgActorSwing), sortValue: (row) => row.avgActorSwing, className: 'debug-num' },
        {
          key: 'impact',
          label: 'Impact',
          get: (row) => (
            <span title={impactTooltip(row)} className="debug-impact">
              {signed(row.avgImpact)}
            </span>
          ),
          sortValue: (row) => row.avgImpact,
          className: 'debug-num',
        },
        {
          key: 'h5',
          label: 'Rel +5',
          get: (row) => signed(row.avgHorizon[2] ?? 0),
          sortValue: (row) => row.avgHorizon[2] ?? 0,
          className: 'debug-num',
        },
        ...winCols,
      ]}
    />
  )
}

/**
 * Seat-scaled Win% with fair share ≈ 50% (raw × seats / 2).
 * 2-seat lobby → raw %; 4-seat → raw × 2, so 25% raw reads as 50%.
 */
function winRateShown(rate: number, seats: number): number {
  return seats > 0 ? (rate * seats) / 2 : rate
}

/**
 * Hero Win% display. When `seats` is set, scale so fair ≈ 50%. Tooltip keeps raw wins/n.
 */
function pctCell(rate: number, wins: number, samples: number, seats = 0): ReactNode {
  if (samples <= 0) return '—'
  const shown = winRateShown(rate, seats)
  const fair = seats > 0 ? ` · fair raw ${(100 / seats).toFixed(0)}%` : ''
  return (
    <span className={samples < 3 ? 'debug-low-n' : undefined} title={`${wins}/${samples} raw ${Math.round(rate * 100)}%${fair}${samples < 3 ? ' · too few samples' : ''}`}>
      {Math.round(shown * 100)}%
    </span>
  )
}

/** Compact avg for sparse effect columns — hide pure zeros. */
function soft(value: number): string {
  if (!value) return '·'
  return value >= 10 ? String(Math.round(value)) : fmt(value)
}

/** Hover detail: measured horizons behind Impact, plus the mechanical EV bag for reference. */
function impactTooltip(row: CardBalanceRow): string {
  const horizons = IMPACT_HORIZONS.map((offset, index) => `+${offset}: ${signed(row.avgHorizon[index] ?? 0)}`).join(' · ')
  const parts = [
    row.avgDestroy ? `destroy ${soft(row.avgDestroy)}` : null,
    row.avgExile ? `exile ${soft(row.avgExile)}` : null,
    row.avgDiscard ? `discard ${soft(row.avgDiscard)}` : null,
    row.avgSteal ? `steal ${soft(row.avgSteal)}` : null,
    row.avgBounce ? `bounce ${soft(row.avgBounce)}` : null,
  ].filter(Boolean)
  const mix = parts.length > 0 ? parts.join(' · ') : 'deploy / tempo / economy'
  return `Impact ${signed(row.avgImpact)} vs an average play at the same stage. Rel change after ${horizons} turns. Mechanical EV ${fmt(row.avgPressure)} (${mix}).`
}

function attrLabel(attr: string): string {
  if (attr === 'STR') return 'Strength'
  if (attr === 'AGI') return 'Agility'
  if (attr === 'INT') return 'Intelligence'
  if (attr === 'UNI') return 'Universal'
  return attr
}

function toggleStrat(filter: StratFilter, strat: AiStrat): StratFilter {
  const on = filter.strats.includes(strat)
  const strats = on ? filter.strats.filter((entry) => entry !== strat) : [...filter.strats, strat]
  return { ...filter, strats }
}

function Sparkline({
  values,
  labels,
  testId,
  yLabel,
  baselineZero = false,
}: {
  values: number[]
  labels?: number[]
  testId: string
  yLabel: string
  baselineZero?: boolean
}) {
  const left = 36
  const right = 8
  const top = 8
  const bottom = 18
  const frameRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(280)
  useEffect(() => {
    const node = frameRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width)
      if (next > 0) setWidth(next)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const height = 110
  const plotW = width - left - right
  const plotH = height - top - bottom
  if (values.length === 0) return <p className="quiet" data-testid={testId}>No turn samples yet.</p>
  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const yMin = baselineZero ? Math.min(0, dataMin) : Math.min(dataMin, 0)
  const yMax = Math.max(dataMax, baselineZero ? 1 : 0, yMin + 1)
  const span = Math.max(yMax - yMin, 1e-6)
  const yAt = (value: number) => top + plotH - ((value - yMin) / span) * plotH
  const xAt = (index: number) => left + (values.length > 1 ? (index / (values.length - 1)) * plotW : plotW / 2)
  const points = values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(' ')
  const zeroY = yAt(0)
  const ticks = uniqueTicks([yMax, (yMin + yMax) / 2, yMin, 0].filter((value) => value >= yMin - 1e-9 && value <= yMax + 1e-9))
  const firstLabel = labels?.[0] ?? 1
  const lastLabel = labels?.[labels.length - 1] ?? values.length
  return (
    <div className="debug-graph" data-testid={testId} ref={frameRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${yLabel} by turn`}>
        <line x1={left} y1={top} x2={left} y2={top + plotH} className="debug-axis" />
        <line x1={left} y1={top + plotH} x2={left + plotW} y2={top + plotH} className="debug-axis" />
        {yMin < 0 && yMax > 0 ? <line x1={left} y1={zeroY} x2={left + plotW} y2={zeroY} className="debug-axis-zero" /> : null}
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left - 4} y1={yAt(tick)} x2={left} y2={yAt(tick)} className="debug-axis" />
            <text x={left - 6} y={yAt(tick) + 3} textAnchor="end" className="debug-axis-label">{fmt(tick)}</text>
          </g>
        ))}
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
        <text x={left} y={height - 4} className="debug-axis-label">T{firstLabel}</text>
        <text x={left + plotW} y={height - 4} textAnchor="end" className="debug-axis-label">T{lastLabel}</text>
      </svg>
      <div className="debug-graph-meta">
        <span>{yLabel}</span>
        <span>avg {fmt(average(values))}</span>
        <span>{fmt(dataMin)} … {fmt(dataMax)}</span>
      </div>
    </div>
  )
}

function uniqueTicks(values: number[]): number[] {
  const seen = new Set<string>()
  const out: number[] = []
  for (const value of values) {
    const key = fmt(value)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out.sort((a, b) => b - a)
}

function countShapes(game: Game, id: number): { core: number; mix: number } {
  let core = 0
  let mix = 0
  for (const team of game.players[id]?.teams ?? []) {
    const shapes = teamShapes(scoreTeam(game, team).why)
    if (shapes.core) core += 1
    if (shapes.mix) mix += 1
  }
  return { core, mix }
}

function signed(value: number): string {
  const text = fmt(value)
  return value > 0 ? `+${text}` : text
}

function fmt(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '')
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
