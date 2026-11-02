import { useState, type ReactNode } from 'react'
import { AI_STRATS, stratLabel } from '../game/ai.ts'
import type { BalanceSummary, CardBalanceRow, MatchReport, StratFilter } from '../game/balance.ts'
import type { AiStrat } from '../game/types.ts'
import { display } from '../game/catalog.ts'
import { scoreState, scoreTeam } from '../game/flow.ts'
import { teamShape } from '../game/scoring.ts'
import type { Game } from '../game/types.ts'

export type DebugSpeed = 0 | 0.5 | 1 | 2
export type DebugView = 'watch' | 'stats'

const MAX_QUEUE = 1024

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
}) {
  const active = game?.players[game.active]
  void _focus
  void _onFocus

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
          {summary.finished}/{summary.matches} done · avg T{fmt(summary.avgTurns)} · spread {fmt(summary.avgFinalSpread)} · win {fmt(summary.avgWinnerScore)}
        </p>
      </div>

      <div className="debug-block">
        <h3>By strat</h3>
        <p className="quiet debug-legend">Place = average finish (1 is first).</p>
        {summary.byStrat.length === 0 ? (
          <p className="quiet">No strat samples yet.</p>
        ) : (
          <table className="debug-table">
            <thead>
              <tr><th>Strat</th><th>W</th><th>Avg</th><th>Place</th><th>Self</th><th>Rel</th></tr>
            </thead>
            <tbody>
              {summary.byStrat.map((row) => (
                <tr key={row.strat}>
                  <td><strong>{stratLabel(row.strat)}</strong><small>{row.plays} plays</small></td>
                  <td>{row.wins}/{row.finishes}</td>
                  <td>{fmt(row.avgScore)}</td>
                  <td>{fmt(row.avgStanding)}</td>
                  <td>{signed(row.avgSelfSwing)}</td>
                  <td>{signed(row.avgRelSwing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="debug-block">
        <h3>Avg points / turn</h3>
        <Sparkline values={summary.avgPtsByTurn} labels={summary.turnLabels} testId="graph-pts" yLabel="pts" />
      </div>

      <div className="debug-block">
        <h3>Avg cards / turn</h3>
        <Sparkline values={summary.avgCardsByTurn} labels={summary.turnLabels} testId="graph-cards" yLabel="cards" baselineZero />
      </div>

      <div className="debug-block">
        <h3>Shape compare</h3>
        <p className="quiet debug-legend">
          Core ×3/×4/×5 are exclusive: 3+ heroes and a same-attr stack of exactly 3 / 4 / 5+ (mixed boards count in n).
          Core team /match = ×3+×4+×5. Mixed · 3 attrs = 3+ heroes with exactly 3 attributes (not 4).
          Pure / avg pts use mono-core (or matching mix) scores only.
        </p>
        <SortableTable
          empty="No shape samples yet."
          columns={[
            { key: 'label', label: 'Shape', get: (row) => row.label, sortValue: (row) => row.label },
            { key: 'count', label: 'n', get: (row) => String(row.count), sortValue: (row) => row.count },
            { key: 'pure', label: 'Pure', get: (row) => String(row.pureCount), sortValue: (row) => row.pureCount },
            { key: 'avg', label: '/match', get: (row) => fmt(row.avgCount), sortValue: (row) => row.avgCount },
            { key: 'pts', label: 'Avg pts', get: (row) => fmt(row.avgPoints), sortValue: (row) => row.avgPoints },
            { key: 'ppc', label: 'Pts/card', get: (row) => fmt(row.avgPtsPerCard), sortValue: (row) => row.avgPtsPerCard },
          ]}
          rows={summary.shapeCompare}
          rowKey={(row) => row.id}
        />
      </div>

      <div className="debug-block">
        <h3>Event counts</h3>
        <SortableTable
          empty="No events yet."
          columns={[
            { key: 'label', label: 'Event', get: (row) => row.label, sortValue: (row) => row.label },
            { key: 'total', label: 'Total', get: (row) => String(row.total), sortValue: (row) => row.total },
            { key: 'per', label: '/match', get: (row) => fmt(row.perMatch), sortValue: (row) => row.perMatch },
          ]}
          rows={summary.eventStats}
          rowKey={(row) => row.id}
        />
      </div>

      <div className="debug-block">
        <h3>Heroes by attribute</h3>
        <SortableTable
          empty="No hero plays yet."
          columns={[
            { key: 'attr', label: 'Attr', get: (row) => attrLabel(row.attr), sortValue: (row) => row.attr },
            { key: 'n', label: 'n', get: (row) => String(row.plays), sortValue: (row) => row.plays },
            { key: 'self', label: 'Self', get: (row) => signed(row.avgActorSwing), sortValue: (row) => row.avgActorSwing },
            { key: 'rel', label: 'Rel', get: (row) => signed(row.avgRelativeSwing), sortValue: (row) => row.avgRelativeSwing },
          ]}
          rows={summary.byAttr}
          rowKey={(row) => row.attr}
          defaultSort={{ key: 'n', dir: 'desc' }}
        />
      </div>

      <div className="debug-block">
        <h3>Swing by kind</h3>
        <p className="quiet debug-legend">Self = your score change. Rel = Self minus average opponent score change. Ability = on-play cast effect after the body is seated.</p>
        <SortableTable
          empty="No swings yet."
          columns={[
            { key: 'kind', label: 'Kind', get: (row) => row.kind, sortValue: (row) => row.kind },
            { key: 'plays', label: 'Plays', get: (row) => String(row.plays), sortValue: (row) => row.plays },
            { key: 'self', label: 'Self', get: (row) => signed(row.avgActorSwing), sortValue: (row) => row.avgActorSwing },
            { key: 'rel', label: 'Rel', get: (row) => signed(row.avgRelativeSwing), sortValue: (row) => row.avgRelativeSwing },
          ]}
          rows={summary.kindSwing}
          rowKey={(row) => row.kind}
          defaultSort={{ key: 'rel', dir: 'desc' }}
        />
      </div>

      <p className="quiet debug-legend">
        Body = score swing from seating the hero (before ability targets resolve). Ability = swing from the cast effect.
        Rel = your Δ minus average opponent Δ. Click a column header to cycle desc → asc → off. Rank follows the active sort.
      </p>
      <div className="debug-block">
        <h3>Heroes (body)</h3>
        <CardSortTable rows={summary.heroes} empty="No hero placements yet." />
      </div>
      <div className="debug-block">
        <h3>Abilities (effect)</h3>
        <CardSortTable rows={summary.abilities} empty="No ability activations yet." />
      </div>
      <div className="debug-block">
        <h3>Terrains</h3>
        <CardSortTable rows={summary.terrains} empty="No terrain plays yet." />
      </div>
      <div className="debug-block">
        <h3>Items / runes / neutrals / towers</h3>
        <CardSortTable rows={summary.loot} empty="No loot plays yet." />
      </div>

      <div className="debug-block">
        <h3>Highest impact</h3>
        <CardSortTable rows={summary.contested} empty="No contested swings yet." defaultSort={{ key: 'abs', dir: 'desc' }} />
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

function SortableTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'Nothing yet.',
  defaultSort = null,
  limit,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: string
  defaultSort?: SortState
  limit?: number
}) {
  const [sort, setSort] = useState<SortState>(defaultSort)
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
  const shown = limit ? ordered.slice(0, limit) : ordered
  return (
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
                  onClick={() => setSort((current) => cycleSort(current, col.key))}
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
            <td className="debug-rank-col">{index + 1}</td>
            {columns.map((col) => (
              <td key={col.key} className={col.className}>{col.get(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CardSortTable({
  rows,
  empty = 'No card plays yet.',
  defaultSort = { key: 'rel', dir: 'desc' as const },
}: {
  rows: CardBalanceRow[]
  empty?: string
  defaultSort?: SortState
}) {
  return (
    <SortableTable
      empty={empty}
      defaultSort={defaultSort}
      rows={rows}
      rowKey={(row) => `${row.kind}-${row.defId}`}
      columns={[
        {
          key: 'card',
          label: 'Card',
          get: (row) => (
            <>
              <strong>{row.name}</strong>
              <small>
                {row.kind}
                {row.attr ? ` · ${attrLabel(row.attr)}` : ''}
                {row.instant ? ' · instant' : ''}
              </small>
            </>
          ),
          sortValue: (row) => row.name,
        },
        { key: 'n', label: 'n', get: (row) => String(row.plays), sortValue: (row) => row.plays },
        { key: 'rel', label: 'Rel', get: (row) => signed(row.avgRelativeSwing), sortValue: (row) => row.avgRelativeSwing },
        { key: 'abs', label: '|Rel|', get: (row) => fmt(row.avgAbsSwing), sortValue: (row) => row.avgAbsSwing },
        { key: 'self', label: 'Self', get: (row) => signed(row.avgActorSwing), sortValue: (row) => row.avgActorSwing },
        {
          key: 'win',
          label: 'Win%',
          get: (row) => (row.presence > 0 ? `${Math.round(row.winRate * 100)}%` : '—'),
          sortValue: (row) => row.winRate,
        },
      ]}
    />
  )
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
  const width = 280
  const height = 96
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
    <div className="debug-graph" data-testid={testId}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${yLabel} by turn`}>
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
    const shape = teamShape(scoreTeam(game, team).why)
    if (shape === 'core') core += 1
    if (shape === 'mix') mix += 1
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
