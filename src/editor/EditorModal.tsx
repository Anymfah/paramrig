import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Small centred overlay used by the command palette and the rename dialog: focus goes inside on
 * open and comes back on close, Escape and a click on the backdrop dismiss it.
 */
export function EditorModal({ prefix = 'editor', label, open, onClose, children }: {
  prefix?: string
  label: string
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restore.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null
    panel.current?.querySelector<HTMLElement>('input, button, [tabindex]')?.focus()
    return () => {
      const previous = restore.current
      if (previous?.isConnected) previous.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose])

  if (!open || typeof window === 'undefined') return null
  return createPortal(
    <div className={`${prefix}-modal`} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={panel} className={`${prefix}-modal__panel`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    window.document.body,
  )
}
