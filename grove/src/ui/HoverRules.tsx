import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Shared hover/focus rules chip used for Trap rules, Neutral rules, and similar hints. */
export function HoverRulesHint({
  label,
  steps,
  testId,
}: {
  label: string
  steps: readonly string[]
  testId?: string
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  function show() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setOpen(true)
  }

  function hide() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      setOpen(false)
      closeTimer.current = null
    }, 140)
  }

  useEffect(() => {
    if (!open || !buttonRef.current) return
    const place = () => {
      const rect = buttonRef.current!.getBoundingClientRect()
      const width = 280
      const left = Math.min(rect.left, window.innerWidth - width - 8)
      setPos({ top: rect.bottom + 4, left: Math.max(8, left) })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  return (
    <div className="trap-blurb" data-testid={testId}>
      <button
        ref={buttonRef}
        type="button"
        className="trap-hint"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {label}
      </button>
      {open
        ? createPortal(
            <ol
              className="trap-rules-list trap-rules-float"
              style={{ top: pos.top, left: pos.left }}
              onMouseEnter={show}
              onMouseLeave={hide}
            >
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>,
            document.body,
          )
        : null}
    </div>
  )
}
