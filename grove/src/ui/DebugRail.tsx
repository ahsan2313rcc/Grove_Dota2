import { display } from '../game/catalog.ts'
import { scoreState, scoreTeam } from '../game/flow.ts'
import { teamShape } from '../game/scoring.ts'
import type { Game } from '../game/types.ts'

export type DebugSpeed = 0 | 0.5 | 1 | 2

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
  onSpeed,
  onStep,
}: {
  game: Game
  seed: number
  stuck: boolean
  speed: DebugSpeed
  onSpeed: (speed: DebugSpeed) => void
  onStep: () => void
}) {
  const active = game.players[game.active]
  const leader = [...game.players]
    .map((player) => ({ name: player.name, total: scoreState(game, player.id).total }))
    .sort((a, b) => b.total - a.total)[0]

  return (
    <aside className="debug-rail" data-testid="debug-rail">
      <div className="debug-head">
        <p className="eyebrow">Debug</p>
        <h2>ahsan-{seed}</h2>
        <p className="quiet">{game.over ? 'Match over' : stuck ? 'AI stuck' : `${active?.name ?? '—'} · T${game.turn}`}</p>
      </div>

      <div className="debug-speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className={speed === entry.value ? 'on' : ''}
            data-testid={`debug-speed-${entry.label.replace('×', 'x').toLowerCase()}`}
            onClick={() => onSpeed(entry.value)}
          >
            {entry.label}
          </button>
        ))}
        <button type="button" data-testid="debug-step" disabled={!!game.over || speed !== 0} onClick={onStep}>
          Step
        </button>
      </div>

      <dl className="debug-piles">
        <div><dt>Deck</dt><dd>{game.deck.length}</dd></div>
        <div><dt>Grave</dt><dd>{game.grave.length}</dd></div>
        <div><dt>Exile</dt><dd>{game.exile.length}</dd></div>
        <div><dt>Runes</dt><dd>{game.runes.length}</dd></div>
        <div><dt>Neutrals</dt><dd>{game.neutrals.length}</dd></div>
        <div><dt>Towers</dt><dd>{game.towers.length}</dd></div>
      </dl>

      <div className="debug-block">
        <h3>Standings</h3>
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
                  {scored.teams} teams · {scored.settings} settings · hand {player.hand.length}/{player.handLimit}
                </small>
                <small>
                  {player.teams.length} boards · {shapes.core} core · {shapes.mix} mix · {player.actions} act
                </small>
              </li>
            )
          })}
        </ul>
        {leader ? <p className="quiet">Lead: {leader.name} at {leader.total}</p> : null}
      </div>

      <div className="debug-block">
        <h3>Active board</h3>
        {active && active.teams.length === 0 ? <p className="quiet">No teams yet.</p> : null}
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
          {game.log.slice(-14).map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ol>
      </div>
    </aside>
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
