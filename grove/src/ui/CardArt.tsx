import { useState } from 'react'
import { display } from '../game/catalog.ts'
import { cardArtUrl, type ArtKind } from './media.ts'

function artKindOf(defId: string): ArtKind {
  const info = display(defId)
  if (info.kind === 'hero') return 'hero'
  if (info.kind === 'item') return 'item'
  if (info.kind === 'terrain') return 'terrain'
  if (info.kind === 'rune') return 'rune'
  if (info.kind === 'neutral') return 'neutral'
  if (info.kind === 'tower') return 'tower'
  if (info.kind === 'ancient') return 'ancient'
  return 'other'
}

/** Portrait / icon art with graceful fallback when CDN misses. */
export function CardArt({
  defId,
  size = 'portrait',
  className = '',
}: {
  defId: string
  size?: 'portrait' | 'icon'
  className?: string
}) {
  const info = display(defId)
  const src = cardArtUrl(defId, artKindOf(defId), size)
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <span
        className={`card-art fallback kind-${info.kind}${info.attr ? ` attr-${info.attr}` : ''} ${className}`.trim()}
        aria-hidden
      >
        <span>{info.name.slice(0, 1)}</span>
      </span>
    )
  }

  return (
    <img
      className={`card-art ${size} ${className}`.trim()}
      src={src}
      alt=""
      loading={size === 'portrait' ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
