import { display } from '../game/catalog.ts'
import type { Attr, Range } from '../game/types.ts'

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
  const kindLabel = info.kind === 'hero' ? 'Hero' : info.kind === 'item' ? 'Item' : info.kind === 'setting' ? 'Setting' : info.kind === 'rune' ? 'Rune' : info.kind === 'neutral' ? 'Neutral' : 'Tower'
  const className = `card${selected ? ' selected' : ''}${compact ? ' compact' : ''}${peek ? ' peek' : ''}`
  const body = peek ? (
    <>
      <span className="peek-marks">
        {shownAttrs.map((attr) => (
          <span key={attr} className={`sigil attr-${attr}`} title={attr}>{attr[0]}</span>
        ))}
        {shownRange === 'Melee' ? <span className="sigil sword" title="Melee" aria-label="Melee" /> : null}
        {shownRange === 'Ranged' ? <span className="sigil bow" title="Ranged" aria-label="Ranged" /> : null}
      </span>
      <span className="card-name">{info.name}</span>
    </>
  ) : (
    <>
      <span className="card-kicker">
        <span>{kindLabel}</span>
        {info.instant ? <span className="free-pill">Free</span> : null}
      </span>
      {shownAttrs.length > 0 ? (
        <span className="pills">
          {shownAttrs.map((attr) => (
            <span key={attr} className={`pill attr-${attr}`}>{attr}</span>
          ))}
          {shownRange ? <span className="pill range">{shownRange}</span> : null}
        </span>
      ) : shownRange ? (
        <span className="pills"><span className="pill range">{shownRange}</span></span>
      ) : info.kind === 'hero' || info.kind === 'neutral' ? (
        <span className="pills"><span className="pill muted">No attribute</span></span>
      ) : null}
      <span className="card-name">{info.name}</span>
      {!compact && info.spell ? <span className="card-spell">{info.spell}</span> : null}
      {!compact ? <span className="card-text">{info.text}</span> : null}
      {compact && marks.length > 0 ? <span className="card-marks">{marks.slice(0, 2).join(' · ')}</span> : null}
    </>
  )
  const title = `${info.name}. ${info.text}`
  const data = {
    'data-kind': info.kind === 'setting' ? defId : info.kind,
    'data-attr': shownAttrs[0] ?? info.attr ?? '',
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
