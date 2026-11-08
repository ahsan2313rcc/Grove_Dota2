import { DEFAULT_SCORE_RULES, normalizeRules, type ScoreRules, type SeatTable } from '../game/scoring.ts'

const SEATS = [2, 3, 4, 5, 6, 7, 8] as const

export function winSummary(rules: ScoreRules, seats: number): string {
  const index = Math.max(0, Math.min(6, seats - 2))
  const target = rules.scoreWin ? `first to hold ${rules.winScores[index]}` : 'no target score'
  const ancient = rules.ancientEndgame
    ? `Ancient ~${rules.ancientDepths[index]}% · +${rules.ancientBonus}`
    : 'no Ancient'
  return `${target} · ${ancient}`
}

export function WinConditionPanel({ value, onChange }: { value: ScoreRules; onChange: (rules: ScoreRules) => void }) {
  const commit = (next: ScoreRules) => onChange(normalizeRules(next))

  function setCell(key: 'winScores' | 'ancientDepths', index: number, raw: number) {
    const next = [...value[key]] as SeatTable
    next[index] = raw
    commit({ ...value, [key]: next })
  }

  return (
    <div className="win-panel" data-testid="win-panel">
      <label className="check-row">
        <input
          data-testid="win-score-on"
          type="checkbox"
          checked={value.scoreWin}
          onChange={(event) => commit({ ...value, scoreWin: event.target.checked })}
        />
        Target score
      </label>
      <p className="quiet">
        End your turn at the target and you win at the start of your next turn, as long as you still have it and nobody else does. Opponents stop you by reaching it too or by knocking you below it.
      </p>
      <label className="check-row">
        <input
          data-testid="win-ancient-on"
          type="checkbox"
          checked={value.ancientEndgame}
          onChange={(event) => commit({ ...value, ancientEndgame: event.target.checked })}
        />
        Ancient endgame
      </label>
      <p className="quiet">
        Drawing The Ancient starts the final round: each player gets one more turn, then the highest score wins.
        Whoever controls The Ancient on the board gets +{value.ancientBonus} at the end. Depth is how far down the deck it sits after the deal, ±5%.
      </p>
      <label>
        Ancient points
        <input
          data-testid="win-ancient-bonus"
          type="number"
          min={0}
          max={99}
          disabled={!value.ancientEndgame}
          value={value.ancientBonus}
          onChange={(event) => commit({ ...value, ancientBonus: Number(event.target.value) || 0 })}
        />
      </label>
      <table className="win-table">
        <thead>
          <tr>
            <th scope="col">Players</th>
            <th scope="col">Target</th>
            <th scope="col">Ancient depth %</th>
          </tr>
        </thead>
        <tbody>
          {SEATS.map((seats, index) => (
            <tr key={seats}>
              <th scope="row">{seats}</th>
              <td>
                <input
                  data-testid={`win-target-${seats}`}
                  type="number"
                  min={10}
                  max={150}
                  disabled={!value.scoreWin}
                  value={value.winScores[index]}
                  onChange={(event) => setCell('winScores', index, Number(event.target.value) || 0)}
                />
              </td>
              <td>
                <input
                  data-testid={`win-depth-${seats}`}
                  type="number"
                  min={5}
                  max={100}
                  disabled={!value.ancientEndgame}
                  value={value.ancientDepths[index]}
                  onChange={(event) => setCell('ancientDepths', index, Number(event.target.value) || 0)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        data-testid="win-defaults"
        onClick={() =>
          commit({
            ...value,
            scoreWin: DEFAULT_SCORE_RULES.scoreWin,
            ancientEndgame: DEFAULT_SCORE_RULES.ancientEndgame,
            ancientBonus: DEFAULT_SCORE_RULES.ancientBonus,
            winScores: DEFAULT_SCORE_RULES.winScores,
            ancientDepths: DEFAULT_SCORE_RULES.ancientDepths,
          })
        }
      >
        Defaults
      </button>
    </div>
  )
}
