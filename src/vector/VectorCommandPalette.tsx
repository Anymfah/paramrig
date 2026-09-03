import { EditorCommandPalette } from '@/editor/EditorCommandPalette'
import type { VectorCommand } from '@/vector/commands'

/** The command palette, with the vector editor's class names. See `EditorCommandPalette`. */
export function VectorCommandPalette({ commands, open, onClose }: {
  commands: VectorCommand[]
  open: boolean
  onClose: () => void
}) {
  return <EditorCommandPalette prefix="vector" commands={commands} open={open} onClose={onClose} />
}
