import { display } from '../game/catalog.ts'
import type { Attr, Range, Timing } from '../game/types.ts'
import { CardArt } from './CardArt.tsx'

const TIMING_BADGE: Record<Timing, string> = {
  cast: 'On play',
  aura: 'Aura',
  instant: 'Instant',
  trap: 'Trap',
}

export function CardFace({
  defId,
  compact = false,
  peek = false,
  selected = false,
  faceDown = false,
  attrs,
  range,
  marks = [],
  onClick,
  testId,
}: {
  defId: string
  compact?: boolean
  peek?: boolean
  selected?: boolean
  faceDown?: boolean
  attrs?: Attr[]
  range?: Range | null
  marks?: string[]
  onClick?: () => void
  testId?: string
}) {
  if (faceDown) {
    const body = (
      <>
        <span className="back-ring" />
        <span className="back-word">Grove</span>
      </>
    )
    if (!onClick) return <div className="card back" data-kind="back">{body}</div>
    return (
      <button type="button" className="card back" data-kind="back" onClick={onClick} data-testid={testId}>
        {body}
      </button>
    )
  }

  const info = display(defId)
  const shownAttrs = attrs ?? (info.attr ? [info.attr] : [])
  const shownRange = range === undefined ? info.range : range
  const timing = info.timing
  const kindLabel =
    info.kind === 'hero'
      ? 'Hero'
      : info.kind === 'item'
        ? 'Item'
        : info.kind === 'terrain'
          ? 'Terrain'
          : info.kind === 'rune'
            ? 'Rune'
            : info.kind === 'neutral'
              ? 'Neutral'
              : info.kind === 'ancient'
                ? 'Ancient'
                : 'Tower'
  const className = `card has-art${selected ? ' selected' : ''}${compact ? ' compact' : ''}${peek ? ' peek' : ''}`
  const timingBadge = timing ? (
    <span className={`type-pill timing-${timing}`} title={TIMING_BADGE[timing]}>
      {TIMING_BADGE[timing]}
    </span>
  ) : null

  const body = peek ? (
    <>
      <CardArt defId={defId} size="icon" className="peek-art" />
      <span className="peek-body">
        <span className="peek-marks">
          {shownAttrs.map((attr) => (
            <span key={attr} className={`sigil attr-${attr}`} title={attr}>
              {attr[0]}
            </span>
          ))}
          {shownRange === 'Melee' ? <span className="sigil sword" title="Melee" aria-label="Melee" /> : null}
          {shownRange === 'Ranged' ? <span className="sigil bow" title="Ranged" aria-label="Ranged" /> : null}
        </span>
        <span className="card-name">{info.name}</span>
      </span>
      {timing === 'aura' ? timingBadge : null}
    </>
  ) : (
    <>
      <div className="card-art-frame">
        <CardArt defId={defId} size="portrait" />
        <span className="card-art-fade" />
      </div>
      {timingBadge}
      <span className="card-kicker">
        <span>{kindLabel}</span>
      </span>
      {shownAttrs.length > 0 ? (
        <span className="pills">
          {shownAttrs.map((attr) => (
            <span key={attr} className={`pill attr-${attr}`}>
              {attr}
            </span>
          ))}
          {shownRange ? <span className="pill range">{shownRange}</span> : null}
        </span>
      ) : shownRange ? (
        <span className="pills">
          <span className="pill range">{shownRange}</span>
        </span>
      ) : info.kind === 'hero' || info.kind === 'neutral' ? (
        <span className="pills">
          <span className="pill muted">No attribute</span>
        </span>
      ) : null}
      <span className="card-name">{info.name}</span>
      {!compact && info.spell ? <span className="card-spell">{info.spell}</span> : null}
      {!compact ? <span className="card-text">{info.text}</span> : null}
      {compact && marks.length > 0 ? <span className="card-marks">{marks.slice(0, 2).join(' · ')}</span> : null}
    </>
  )

  const title = timing ? `${info.name} (${TIMING_BADGE[timing]}). ${info.text}` : `${info.name}. ${info.text}`
  const data = {
    'data-kind': info.kind === 'terrain' ? defId : info.kind,
    'data-attr': shownAttrs[0] ?? info.attr ?? '',
    'data-timing': timing ?? '',
  }
  if (!onClick) {
    return (
      <div className={className} title={title} data-testid={testId} {...data}>
        {body}
      </div>
    )
  }
  return (
    <button type="button" className={className} title={title} onClick={onClick} data-testid={testId} {...data}>
      {body}
    </button>
  )
}
