import { EditorSaveBadge } from '@/editor/EditorSaveBadge'
import type { ProjectFile } from '@/editor/useProjectFile'
import type { VectorDocument } from '@/vector/types'

/** The autosave badge, with the vector editor's class names. See `EditorSaveBadge`. */
export function VectorSaveBadge({ file }: { file: ProjectFile<VectorDocument> }) {
  return <EditorSaveBadge prefix="vector" file={file} />
}
