import type { CSSProperties, ReactNode } from 'react'

/**
 * The one floating surface of an editor canvas. The measurement HUD, the node tip and the
 * selection bar are all the same object — same ground, same hairline, same radius, same type —
 * so a canvas never shows two kinds of small floating box.
 *
 * `prefix` names the family of classes it emits, so the vector editor keeps the class names its
 * stylesheet and its QA scripts already know while the scene editor gets its own.
 */
export function EditorChip({ prefix = 'editor', className, style, role, live, dataset, children }: {
  prefix?: string
  className?: string
  style?: CSSProperties
  role?: string
  /** Set for a chip that reads itself out as it changes, like the measurement readout. */
  live?: 'polite' | 'off'
  dataset?: Record<string, string | undefined>
  children: ReactNode
}) {
  return (
    <div
      className={`${prefix}-chip ${className ?? ''}`.trim()}
      style={style}
      role={role}
      aria-live={live}
      {...Object.fromEntries(Object.entries(dataset ?? {}).map(([key, value]) => [`data-${key}`, value]))}
    >
      {children}
    </div>
  )
}
