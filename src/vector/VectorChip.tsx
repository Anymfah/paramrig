import type { CSSProperties, ReactNode } from 'react'

/**
 * The one floating surface of the canvas. The measurement HUD, the node tip and the selection bar
 * are all the same object — same ground, same hairline, same radius, same type — so the canvas
 * never shows two kinds of small floating box.
 */
export function VectorChip({ className, style, role, live, dataset, children }: {
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
      className={`vector-chip ${className ?? ''}`.trim()}
      style={style}
      role={role}
      aria-live={live}
      {...Object.fromEntries(Object.entries(dataset ?? {}).map(([key, value]) => [`data-${key}`, value]))}
    >
      {children}
    </div>
  )
}
