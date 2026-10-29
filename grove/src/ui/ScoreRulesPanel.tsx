import { useEffect, useState } from 'react'
import { cloneRules, DEFAULT_SCORE_RULES, normalizeRules, type ScoreRules } from '../game/scoring.ts'

export function ScoreRulesPanel({
  value,
  onChange,
}: {
  value: ScoreRules
  onChange: (rules: ScoreRules) => void
}) {
  const [draft, setDraft] = useState<ScoreRules>(() => cloneRules(value))

  useEffect(() => {
    setDraft(cloneRules(value))
  }, [value])

  function commit(next: ScoreRules) {
    const normalized = normalizeRules(next)
    setDraft(normalized)
    onChange(normalized)
  }

  function setNum<K extends 'heroPoints' | 'coreCombo' | 'mixCombo'>(key: K, raw: number) {
    commit({ ...draft, [key]: raw })
  }

  function setBonus(kind: 'coreBonus' | 'mixBonus' | 'attackBonus', index: number, raw: number) {
    const next = [...draft[kind]] as number[]
    next[index] = raw
    commit({ ...draft, [kind]: next as ScoreRules[typeof kind] })
  }

  return (
    <div className="score-panel" data-testid="score-panel">
      <div className="debug-score">
        <label>
          Hero pts
          <input data-testid="score-hero" type="number" min={0} max={9} value={draft.heroPoints} onChange={(event) => setNum('heroPoints', Number(event.target.value) || 0)} />
        </label>
        <label>
          Core combo
          <input data-testid="score-core-combo" type="number" min={0} max={99} value={draft.coreCombo} onChange={(event) => setNum('coreCombo', Number(event.target.value) || 0)} />
        </label>
        <label>
          Mix combo
          <input data-testid="score-mix-combo" type="number" min={0} max={99} value={draft.mixCombo} onChange={(event) => setNum('mixCombo', Number(event.target.value) || 0)} />
        </label>
      </div>
      <p className="quiet debug-score-label">Core bonus · heroes 1–5</p>
      <div className="debug-score-row" data-testid="score-core-bonus">
        {draft.coreBonus.map((entry, index) => (
          <label key={`core-${index}`}>
            ×{index + 1}
            <input type="number" min={0} max={99} value={entry} onChange={(event) => setBonus('coreBonus', index, Number(event.target.value) || 0)} />
          </label>
        ))}
      </div>
      <p className="quiet debug-score-label">Mix bonus · attrs 1–4</p>
      <div className="debug-score-row" data-testid="score-mix-bonus">
        {draft.mixBonus.map((entry, index) => (
          <label key={`mix-${index}`}>
            {index + 1}a
            <input type="number" min={0} max={99} value={entry} onChange={(event) => setBonus('mixBonus', index, Number(event.target.value) || 0)} />
          </label>
        ))}
      </div>
      <p className="quiet debug-score-label">Attack bonus · heroes 1–5</p>
      <div className="debug-score-row" data-testid="score-attack-bonus">
        {draft.attackBonus.map((entry, index) => (
          <label key={`atk-${index}`}>
            ×{index + 1}
            <input type="number" min={0} max={99} value={entry} onChange={(event) => setBonus('attackBonus', index, Number(event.target.value) || 0)} />
          </label>
        ))}
      </div>
      <label className="debug-check">
        <input
          data-testid="score-attack-on-core"
          type="checkbox"
          checked={draft.attackOnCore}
          onChange={(event) => commit({ ...draft, attackOnCore: event.target.checked })}
        />
        Attack bonus on core teams
      </label>
      <label className="debug-check">
        <input
          data-testid="score-attack-on-mix"
          type="checkbox"
          checked={draft.attackOnMix}
          onChange={(event) => commit({ ...draft, attackOnMix: event.target.checked })}
        />
        Attack bonus on mixed teams
      </label>
      <div className="debug-speeds">
        <button type="button" data-testid="score-defaults" onClick={() => commit(DEFAULT_SCORE_RULES)}>
          Defaults
        </button>
      </div>
    </div>
  )
}
