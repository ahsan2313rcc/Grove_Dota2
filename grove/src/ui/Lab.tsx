import { useMemo, useState } from 'react'
import { buildLab, labCards, labSetup, runLab, type LabResult } from '../game/lab.ts'
import { display } from '../game/catalog.ts'
import type { Game } from '../game/types.ts'
import { CardArt } from './CardArt.tsx'

type Sweep = { ran: number; broken: LabResult[]; flagged: LabResult[] }

export function Lab({ onClose, onPlay }: { onClose: () => void; onPlay: (game: Game, seed: number) => void }) {
  const cards = useMemo(() => labCards(), [])
  const [query, setQuery] = useState('')
  const [pick, setPick] = useState(cards[0]?.defId ?? '')
  const [seed, setSeed] = useState(7)
  const [sweep, setSweep] = useState<Sweep | null>(null)
  const needle = query.trim().toLowerCase()
  const shown = cards.filter((card) => !needle || `${card.name} ${card.text}`.toLowerCase().includes(needle))
  const card = cards.find((entry) => entry.defId === pick)
  const result = useMemo(() => (pick ? runLab(pick, seed) : null), [pick, seed])
  const setup = pick ? labSetup(pick) : null

  function runAll() {
    const results = cards.map((entry) => runLab(entry.defId, seed))
    setSweep({
      ran: results.length,
      broken: results.filter((entry) => entry.issues.length > 0),
      flagged: results.filter((entry) => entry.issues.length === 0 && entry.warnings.length > 0),
    })
  }

  return (
    <div className="scrim" onClick={onClose}>
      <article className="sheet glossary lab" role="dialog" aria-modal="true" aria-labelledby="lab-title" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">Debug</p>
        <h2 id="lab-title">Ability Lab</h2>
        <p className="quiet">
          Each card gets a preset two-player board. The lab plays it, lets every prompt auto-resolve, and checks that every
          card is still in exactly one place. Open the board on the table to step through it by hand.
        </p>

        <div className="glossary-tools">
          <label className="glossary-search">
            Search
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or text" data-testid="lab-search" />
          </label>
          <label className="glossary-search lab-seed">
            Seed
            <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value) || 1)} data-testid="lab-seed" />
          </label>
          <button type="button" onClick={runAll} data-testid="lab-run-all">Run every card</button>
        </div>

        {sweep ? (
          <div className="lab-sweep" data-testid="lab-sweep">
            <strong>
              {sweep.ran} cards: {sweep.broken.length} broken, {sweep.flagged.length} flagged
            </strong>
            {[...sweep.broken, ...sweep.flagged].map((entry) => (
              <button key={entry.defId} type="button" className="lab-chip" data-bad={entry.issues.length > 0} onClick={() => setPick(entry.defId)}>
                {display(entry.defId).name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="lab-split">
          <ul className="glossary-list lab-cards">
            {shown.map((entry) => (
              <li key={entry.defId}>
                <button type="button" className={entry.defId === pick ? 'on' : ''} onClick={() => setPick(entry.defId)}>
                  {entry.name}
                  <span className="quiet"> {entry.kind === 'item' ? 'item' : entry.timing}</span>
                </button>
              </li>
            ))}
          </ul>

          {card && result ? (
            <section className="lab-detail" data-testid="lab-detail">
              <header className="glossary-entry has-art">
                <CardArt defId={card.defId} size="icon" className="glossary-art" />
                <div className="glossary-body">
                  <strong>{card.name}</strong>
                  <p>{card.text}</p>
                </div>
              </header>

              <p className={result.issues.length ? 'warn' : 'quiet'} data-testid="lab-verdict">
                {result.issues.length ? 'Broken' : result.warnings.length ? 'Check by hand' : 'Resolves cleanly'}
              </p>
              {[...result.issues, ...result.warnings].length ? (
                <ul className="lab-lines">
                  {result.issues.map((line) => <li key={line} className="warn">{line}</li>)}
                  {result.warnings.map((line) => <li key={line}>{line}</li>)}
                </ul>
              ) : null}

              <h3>Board</h3>
              <ul className="lab-lines">
                {result.before.players.map((seat) => (
                  <li key={seat.id}>
                    <strong>{seat.name}</strong>: {seat.teams.map((team) => `[${team.heroes.map((hero) => display(hero.defId).name).join(', ')}${team.trap ? ' + trap' : ''}]`).join(' ')}
                    {' · hand '}{seat.hand.map((entry) => display(entry.defId).name).join(', ') || 'empty'}
                  </li>
                ))}
                {card.timing === 'trap' ? <li>Trap face down on your first team; you then play {display(setup?.entrant ?? 'axe').name} into it.</li> : null}
              </ul>

              <h3>What changed</h3>
              <ul className="lab-lines">
                {result.changes.length ? result.changes.map((line) => <li key={line}>{line}</li>) : <li className="quiet">Nothing</li>}
              </ul>

              <h3>Log</h3>
              <ol className="lab-lines lab-log">
                {result.log.map((line, index) => <li key={index}>{line}</li>)}
              </ol>

              <button type="button" className="primary block" data-testid="lab-play" onClick={() => onPlay(buildLab(card.defId, seed).game, seed)}>
                Open this board on the table
              </button>
            </section>
          ) : null}
        </div>
      </article>
    </div>
  )
}
