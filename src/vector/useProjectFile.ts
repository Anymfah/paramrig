import { useMemo } from 'react'
import { useProjectFile as useEditorProjectFile, type ProjectFile as EditorProjectFile, type ProjectFormat } from '@/editor/useProjectFile'
import { documentThumbnail, saveVectorDocument } from '@/vector/document'
import { importProject, projectFileName, PROJECT_EXTENSION, PROJECT_FORMAT, PROJECT_MIME, serializeProject } from '@/vector/project'
import type { VectorDocument } from '@/vector/types'

export type { SaveState } from '@/editor/useProjectFile'
export { formatClock, saveBadgeLabel } from '@/editor/useProjectFile'

export type ProjectFile = EditorProjectFile<VectorDocument>

/** What a vector project file is, for the shared autosave hook. */
export const VECTOR_PROJECT_FORMAT: ProjectFormat<VectorDocument> = {
  magic: PROJECT_FORMAT,
  storageKey: 'paramrig.vector-documents.v1',
  extension: PROJECT_EXTENSION,
  mime: PROJECT_MIME,
  pickerLabel: 'ParamRig project',
  documentId: (document) => document.id,
  documentName: (document) => document.name,
  fileName: (document) => projectFileName(document),
  serialize: (document) => serializeProject(document),
  parse: (text) => {
    const result = importProject(text)
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, document: result.project.document, ...(result.note ? { note: result.note } : {}) }
  },
  save: (document) => saveVectorDocument(document),
  recent: (document) => ({
    kind: 'vector',
    width: document.width,
    height: document.height,
    background: document.background,
    thumbnail: documentThumbnail(document),
  }),
}

/**
 * Keeps the document written where the user expects it: browser storage always, and a file on
 * disk once one is chosen. The work is the shared hook's; this binds it to the vector format.
 */
export function useProjectFile(document: VectorDocument | null): ProjectFile {
  const format = useMemo(() => VECTOR_PROJECT_FORMAT, [])
  return useEditorProjectFile(document, format)
}
