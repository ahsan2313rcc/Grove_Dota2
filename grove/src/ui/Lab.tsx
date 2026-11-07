import { useMemo, useState } from 'react'
import { buildLab, LAB_BROKEN, LAB_FLAGGED, labCards, labSetup, runLab, type LabResult } from '../game/lab.ts'
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
          <button
            type="button"
            onClick={runAll}
            data-testid="lab-run-all"
            title="Auto-plays every hero, item, and neutral on its lab board and lists any that break or look suspicious"
          >
            Run every card
          </button>
          {card ? (
            <button
              type="button"
              className="primary"
              data-testid="lab-play"
              onClick={() => onPlay(buildLab(card.defId, seed).game, seed)}
            >
              Open board
            </button>
          ) : null}
        </div>
        <p className="quiet lab-run-hint">
          <strong>Run every card</strong> auto-plays each hero, item, and neutral on its preset board with the current seed.
          {' '}{LAB_BROKEN}{' '}{LAB_FLAGGED}
        </p>

        {sweep ? (
          <div className="lab-sweep" data-testid="lab-sweep">
            <strong>
              {sweep.ran} cards: {sweep.broken.length} broken, {sweep.flagged.length} flagged
            </strong>
            {sweep.broken.length > 0 ? (
              <div className="lab-sweep-group" data-testid="lab-sweep-broken">
                <p className="lab-sweep-label warn">Broken</p>
                <p className="quiet lab-sweep-why">{LAB_BROKEN}</p>
                <ul className="lab-sweep-list">
                  {sweep.broken.map((entry) => (
                    <li key={entry.defId}>
                      <button type="button" className="lab-chip" data-bad="true" onClick={() => setPick(entry.defId)}>
                        {display(entry.defId).name}
                      </button>
                      <ul className="lab-lines">
                        {entry.issues.map((line) => <li key={line} className="warn">{line}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {sweep.flagged.length > 0 ? (
              <div className="lab-sweep-group" data-testid="lab-sweep-flagged">
                <p className="lab-sweep-label">Flagged</p>
                <p className="quiet lab-sweep-why">{LAB_FLAGGED}</p>
                <ul className="lab-sweep-list">
                  {sweep.flagged.map((entry) => (
                    <li key={entry.defId}>
                      <button type="button" className="lab-chip" onClick={() => setPick(entry.defId)}>
                        {display(entry.defId).name}
                      </button>
                      <ul className="lab-lines">
                        {entry.warnings.map((line) => <li key={line}>{line}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {sweep.broken.length === 0 && sweep.flagged.length === 0 ? (
              <p className="quiet">Every card resolved cleanly on this seed.</p>
            ) : null}
          </div>
        ) : null}

        <div className="lab-split">
          <ul className="glossary-list lab-cards">
            {shown.map((entry) => (
              <li key={entry.defId}>
                <button type="button" className={entry.defId === pick ? 'on' : ''} onClick={() => setPick(entry.defId)}>
                  {entry.name}
                  <span className="quiet"> {entry.kind === 'item' ? 'item' : entry.kind === 'neutral' ? `neutral · ${entry.timing}` : entry.timing}</span>
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
                {result.issues.length ? 'Broken' : result.warnings.length ? 'Flagged — check by hand' : 'Resolves cleanly'}
              </p>
              {[...result.issues, ...result.warnings].length ? (
                <ul className="lab-lines">
                  {result.issues.map((line) => <li key={line} className="warn">{line}</li>)}
                  {result.warnings.map((line) => <li key={line}>{line}</li>)}
                </ul>
              ) : null}

              <h3>Board</h3>
              {setup?.note ? <p className="quiet" data-testid="lab-note">{setup.note}</p> : null}
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
            </section>
          ) : null}
        </div>
      </article>
    </div>
  )
}
