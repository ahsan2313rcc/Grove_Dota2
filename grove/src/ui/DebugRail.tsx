import { AI_STRATS, stratLabel } from '../game/ai.ts'
import type { BalanceSummary, CardBalanceRow, MatchReport, StratFilter } from '../game/balance.ts'
import type { AiStrat } from '../game/types.ts'
import { display } from '../game/catalog.ts'
import { scoreState, scoreTeam } from '../game/flow.ts'
import { teamShape } from '../game/scoring.ts'
import type { Game } from '../game/types.ts'

export type DebugSpeed = 0 | 0.5 | 1 | 2
export type DebugView = 'watch' | 'stats'

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
  focus,
  runCount,
  finishedCount,
  runningBatch,
  summary,
  reports,
  stratFilter,
  onSpeed,
  onStep,
  onView,
  onBatchSize,
  onFocus,
  onRunBatch,
  onStratFilter,
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
  summary: BalanceSummary
  reports: MatchReport[]
  stratFilter: StratFilter
  onSpeed: (speed: DebugSpeed) => void
  onStep: () => void
  onView: (view: DebugView) => void
  onBatchSize: (size: number) => void
  onFocus: (index: number) => void
  onRunBatch: () => void
  onStratFilter: (filter: StratFilter) => void
}) {
  const active = game?.players[game.active]

  return (
    <aside className="debug-rail" data-testid="debug-rail">
      <div className="debug-head">
        <p className="eyebrow">Debug balance</p>
        <h2>ahsan-{seed}</h2>
        <p className="quiet">
          {runningBatch
            ? `Batch running… ${finishedCount}/${runCount}`
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
      </div>

      <div className="debug-block">
        <h3>Parallel runs</h3>
        <div className="debug-batch">
          <label>
            Games
            <input
              data-testid="debug-batch-size"
              type="number"
              min={1}
              max={1024}
              value={batchSize}
              onChange={(event) => onBatchSize(Math.max(1, Math.min(1024, Number(event.target.value) || 1)))}
            />
          </label>
          <button type="button" className="primary" data-testid="debug-run-batch" disabled={runningBatch} onClick={onRunBatch}>
            {runningBatch ? 'Running…' : `Run ${batchSize} in background`}
          </button>
        </div>
        {runCount > 1 && !runningBatch && game ? (
          <div className="debug-focus">
            <span className="quiet">Watching</span>
            <select data-testid="debug-focus" value={focus} onChange={(event) => onFocus(Number(event.target.value))}>
              {Array.from({ length: Math.min(runCount, 8) }, (_, index) => (
                <option key={index} value={index}>Game {index + 1} · seed {seed + index}</option>
              ))}
            </select>
          </div>
        ) : null}
        <p className="quiet">{finishedCount} finished · {summary.matches} traced · max 1024</p>
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
            Mix only
          </button>
        </div>
        <p className="quiet debug-legend">
          {stratFilter.strats.length === 0 && !stratFilter.mixOnly
            ? 'All strats on. Toggle personalities on/off; Mix only keeps mixed seat matches.'
            : [
              stratFilter.strats.length > 0 ? stratFilter.strats.map(stratLabel).join(' · ') : 'All strats',
              stratFilter.mixOnly ? 'mixture matches' : null,
            ].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="debug-block">
        <h3>Summary</h3>
        <dl className="debug-piles">
          <div><dt>Matches</dt><dd>{summary.finished}/{summary.matches}</dd></div>
          <div><dt>Avg turns</dt><dd>{fmt(summary.avgTurns)}</dd></div>
          <div><dt>Avg spread</dt><dd>{fmt(summary.avgFinalSpread)}</dd></div>
          <div><dt>Avg win</dt><dd>{fmt(summary.avgWinnerScore)}</dd></div>
        </dl>
      </div>

      <div className="debug-block">
        <h3>By strat</h3>
        {summary.byStrat.length === 0 ? (
          <p className="quiet">No strat samples yet.</p>
        ) : (
          <table className="debug-table">
            <thead>
              <tr><th>Strat</th><th>W</th><th>Avg</th><th>Self</th><th>Rel</th></tr>
            </thead>
            <tbody>
              {summary.byStrat.map((row) => (
                <tr key={row.strat}>
                  <td><strong>{stratLabel(row.strat)}</strong><small>{row.plays} plays</small></td>
                  <td>{row.wins}/{row.finishes}</td>
                  <td>{fmt(row.avgScore)}</td>
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
        <h3>Swing by kind</h3>
        <p className="quiet debug-legend">Self = your score change. Rel = Self minus average opponent score change.</p>
        <table className="debug-table">
          <thead>
            <tr><th>Kind</th><th>Plays</th><th>Self</th><th>Rel</th></tr>
          </thead>
          <tbody>
            {summary.kindSwing.map((row) => (
              <tr key={row.kind}>
                <td>{row.kind}</td>
                <td>{row.plays}</td>
                <td>{signed(row.avgActorSwing)}</td>
                <td>{signed(row.avgRelativeSwing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="debug-block">
        <h3>Highest |Rel|</h3>
        <CardTable rows={summary.cards} />
      </div>

      <div className="debug-block">
        <h3>Most contested</h3>
        <CardTable rows={summary.contested} />
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
                      {scored.teams}+{scored.settings} · hand {player.hand.length} · {shapes.core}c/{shapes.mix}m
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

function CardTable({ rows }: { rows: CardBalanceRow[] }) {
  if (rows.length === 0) return <p className="quiet">No card plays yet.</p>
  return (
    <table className="debug-table">
      <thead>
        <tr><th>Card</th><th>n</th><th>Self</th><th>Rel</th></tr>
      </thead>
      <tbody>
        {rows.slice(0, 12).map((row) => (
          <tr key={`${row.kind}-${row.defId}`}>
            <td>
              <strong>{row.name}</strong>
              <small>{row.kind}</small>
            </td>
            <td>{row.plays}</td>
            <td>{signed(row.avgActorSwing)}</td>
            <td>{signed(row.avgRelativeSwing)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
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
