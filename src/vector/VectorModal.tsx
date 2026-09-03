import type { ReactNode } from 'react'
import { EditorModal } from '@/editor/EditorModal'

/** The centred overlay, with the vector editor's class names. See `EditorModal`. */
export function VectorModal(props: { label: string; open: boolean; onClose: () => void; children: ReactNode }) {
  return <EditorModal prefix="vector" {...props} />
}
