import { useMemo, useState } from 'react'
import { HEROES, ITEMS, REWARDS, SETTINGS } from '../game/catalog.ts'
import type { Attr } from '../game/types.ts'

type Tab = 'heroes' | 'items' | 'settings' | 'runes' | 'neutrals' | 'towers'

const TABS: { id: Tab; label: string }[] = [
  { id: 'heroes', label: 'Heroes' },
  { id: 'items', label: 'Items' },
  { id: 'settings', label: 'Settings' },
  { id: 'runes', label: 'Runes' },
  { id: 'neutrals', label: 'Neutrals' },
  { id: 'towers', label: 'Towers' },
]

const ATTRS: Attr[] = ['STR', 'AGI', 'INT', 'UNI']

const ATTR_LABEL: Record<Attr, string> = {
  STR: 'Strength',
  AGI: 'Agility',
  INT: 'Intelligence',
  UNI: 'Universal',
}

const TIMING_LABEL = {
  cast: 'On play',
  aura: 'Aura',
  instant: 'Instant',
} as const

export function Glossary({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('heroes')
  const [query, setQuery] = useState('')
  const [attr, setAttr] = useState<Attr | 'all'>('all')
  const needle = query.trim().toLowerCase()

  const heroes = useMemo(() => {
    return HEROES
      .filter((hero) => (attr === 'all' ? true : hero.attr === attr))
      .filter((hero) => matches(needle, hero.name, hero.spell, hero.text, hero.attr, hero.range))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [attr, needle])

  const items = useMemo(() => {
    return ITEMS
      .filter((item) => matches(needle, item.name, item.text, item.instant ? 'instant free' : ''))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name) || b.copies - a.copies)
  }, [needle])

  const settings = useMemo(() => {
    return SETTINGS.filter((setting) => matches(needle, setting.name, setting.text))
  }, [needle])

  const rewards = useMemo(() => {
    const kind = tab === 'runes' || tab === 'neutrals' || tab === 'towers' ? tab.replace(/s$/, '') as 'rune' | 'neutral' | 'tower' : null
    if (!kind) return []
    return REWARDS
      .filter((reward) => reward.kind === kind)
      .filter((reward) => matches(needle, reward.name, reward.text, reward.attr ?? ''))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [needle, tab])

  const count = tab === 'heroes' ? heroes.length
    : tab === 'items' ? items.length
      : tab === 'settings' ? settings.length
        : rewards.length

  return (
    <div className="scrim" onClick={onClose}>
      <article className="sheet glossary" role="dialog" aria-modal="true" aria-labelledby="glossary-title" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">Card reference</p>
        <h2 id="glossary-title">Glossary</h2>
        <p className="quiet">Browse every hero, item, setting, and reward in the shared decks.</p>

        <div className="glossary-tabs" role="tablist" aria-label="Card type">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? 'on' : ''}
              data-testid={`glossary-tab-${entry.id}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="glossary-tools">
          <label className="glossary-search">
            Search
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or text"
              data-testid="glossary-search"
            />
          </label>
          {tab === 'heroes' ? (
            <div className="layout-picks" role="group" aria-label="Attribute filter">
              <button type="button" className={attr === 'all' ? 'on' : ''} onClick={() => setAttr('all')}>All</button>
              {ATTRS.map((value) => (
                <button key={value} type="button" className={attr === value ? 'on' : ''} onClick={() => setAttr(value)}>
                  {value}
                </button>
              ))}
            </div>
          ) : null}
          <span className="quiet">{count} cards</span>
        </div>

        {tab === 'heroes' ? (
          <ul className="glossary-list">
            {heroes.map((hero) => (
              <li key={hero.id} className="glossary-entry" data-kind="hero" data-attr={hero.attr}>
                <header>
                  <strong>{hero.name}</strong>
                  <span className="glossary-marks">
                    <span className={`pill attr-${hero.attr}`}>{ATTR_LABEL[hero.attr]}</span>
                    <span className="pill range">{hero.range}</span>
                    <span className="pill muted">{TIMING_LABEL[hero.timing]}</span>
                  </span>
                </header>
                <p className="spell">{hero.spell}</p>
                <p>{hero.text}</p>
              </li>
            ))}
          </ul>
        ) : null}

        {tab === 'items' ? (
          <ul className="glossary-list">
            {items.map((item) => (
              <li key={item.id} className="glossary-entry" data-kind="item">
                <header>
                  <strong>{item.name}</strong>
                  <span className="glossary-marks">
                    <span className="pill muted">{item.copies}× in deck</span>
                    {item.instant ? <span className="free-pill">Free</span> : null}
                  </span>
                </header>
                <p>{item.text}</p>
              </li>
            ))}
          </ul>
        ) : null}

        {tab === 'settings' ? (
          <ul className="glossary-list">
            {settings.map((setting) => (
              <li key={setting.id} className="glossary-entry" data-kind={setting.id}>
                <header>
                  <strong>{setting.name}</strong>
                  <span className="glossary-marks"><span className="pill muted">12× in deck</span></span>
                </header>
                <p>{setting.text}</p>
              </li>
            ))}
          </ul>
        ) : null}

        {tab === 'runes' || tab === 'neutrals' || tab === 'towers' ? (
          <ul className="glossary-list">
            {rewards.map((reward) => (
              <li key={reward.id} className="glossary-entry" data-kind={reward.kind} data-attr={reward.attr ?? ''}>
                <header>
                  <strong>{reward.name}</strong>
                  <span className="glossary-marks">
                    {reward.attr ? <span className={`pill attr-${reward.attr}`}>{ATTR_LABEL[reward.attr]}</span> : null}
                    <span className="pill muted">{reward.copies}× in pile</span>
                    {reward.instant ? <span className="free-pill">Free</span> : null}
                    {reward.token ? <span className="pill muted">Neutral body</span> : null}
                  </span>
                </header>
                <p>{reward.text}</p>
              </li>
            ))}
          </ul>
        ) : null}

        {count === 0 ? <p className="quiet">No cards match that search.</p> : null}
        <button type="button" className="primary" onClick={onClose}>Close</button>
      </article>
    </div>
  )
}

function matches(needle: string, ...parts: string[]): boolean {
  if (!needle) return true
  return parts.some((part) => part.toLowerCase().includes(needle))
}
