import type { CSSProperties, ReactNode } from 'react'
import { EditorChip } from '@/editor/EditorChip'

/** The canvas chip, with the vector editor's class names. See `EditorChip`. */
export function VectorChip(props: {
  className?: string
  style?: CSSProperties
  role?: string
  live?: 'polite' | 'off'
  dataset?: Record<string, string | undefined>
  children: ReactNode
}) {
  return <EditorChip prefix="vector" {...props} />
}
