import type { BalanceSummary, CardBalanceRow, MatchReport } from '../game/balance.ts'
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
  onSpeed,
  onStep,
  onView,
  onBatchSize,
  onFocus,
  onRunBatch,
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
  onSpeed: (speed: DebugSpeed) => void
  onStep: () => void
  onView: (view: DebugView) => void
  onBatchSize: (size: number) => void
  onFocus: (index: number) => void
  onRunBatch: () => void
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
              max={64}
              value={batchSize}
              onChange={(event) => onBatchSize(Math.max(1, Math.min(64, Number(event.target.value) || 1)))}
            />
          </label>
          <button type="button" className="primary" data-testid="debug-run-batch" disabled={runningBatch} onClick={onRunBatch}>
            {runningBatch ? 'Running…' : `Run ${batchSize} in background`}
          </button>
        </div>
        {runCount > 1 ? (
          <div className="debug-focus">
            <span className="quiet">Watching</span>
            <select data-testid="debug-focus" value={focus} onChange={(event) => onFocus(Number(event.target.value))}>
              {Array.from({ length: runCount }, (_, index) => (
                <option key={index} value={index}>Game {index + 1} · seed {seed + index}</option>
              ))}
            </select>
          </div>
        ) : null}
        <p className="quiet">{finishedCount} finished · {summary.matches} traced</p>
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
        <h3>Avg points / turn</h3>
        <Sparkline values={summary.avgPtsByTurn} testId="graph-pts" />
      </div>

      <div className="debug-block">
        <h3>Avg cards / turn</h3>
        <Sparkline values={summary.avgCardsByTurn} testId="graph-cards" />
      </div>

      <div className="debug-block">
        <h3>Swing by kind</h3>
        <table className="debug-table">
          <thead>
            <tr><th>Kind</th><th>Plays</th><th>Avg Δ</th><th>Rel Δ</th></tr>
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
        <h3>Highest |rel swing|</h3>
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
                    <small>{scored.teams}+{scored.settings} · hand {player.hand.length} · {shapes.core}c/{shapes.mix}m</small>
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
        <tr><th>Card</th><th>n</th><th>Δ</th><th>Rel</th></tr>
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

function Sparkline({ values, testId }: { values: number[]; testId: string }) {
  const width = 260
  const height = 72
  if (values.length === 0) return <p className="quiet" data-testid={testId}>No turn samples yet.</p>
  const max = Math.max(...values.map((value) => Math.abs(value)), 1)
  const mid = height / 2
  const step = values.length > 1 ? width / (values.length - 1) : width
  const points = values.map((value, index) => {
    const x = index * step
    const y = mid - (value / max) * (height * 0.42)
    return `${x},${y}`
  }).join(' ')
  return (
    <div className="debug-graph" data-testid={testId}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trend">
        <line x1="0" y1={mid} x2={width} y2={mid} className="debug-axis" />
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
      </svg>
      <div className="debug-graph-meta">
        <span>T1</span>
        <span>avg {fmt(average(values))}</span>
        <span>T{values.length}</span>
      </div>
    </div>
  )
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
