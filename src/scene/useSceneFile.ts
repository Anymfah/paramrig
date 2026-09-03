import { useMemo } from 'react'
import { useProjectFile, type ProjectFile, type ProjectFormat } from '@/editor/useProjectFile'
import { saveSceneDocument } from '@/scene/document'
import { sceneThumbnail } from '@/scene/io/thumbnail'
import { importProject, projectFileName, PROJECT_EXTENSION, PROJECT_FORMAT, PROJECT_MIME, serializeProject } from '@/scene/project'
import type { SceneDocument } from '@/scene/types'

export type { SaveState } from '@/editor/useProjectFile'
export { formatClock, saveBadgeLabel } from '@/editor/useProjectFile'

/** The card the library draws is 256 pixels square, and the picture is made to match it. */
const RECENT_THUMBNAIL_SIZE = 256

/**
 * The scene editor's half of the shared autosave hook: how a scene is written, read back, and
 * described to the library. The vector editor binds the same hook in `@/vector/useProjectFile`,
 * and the two are deliberately twins — a difference between them is a bug in one of them.
 */
export const SCENE_PROJECT_FORMAT: ProjectFormat<SceneDocument> = {
  magic: PROJECT_FORMAT,
  storageKey: 'paramrig.scene-documents.v1',
  extension: PROJECT_EXTENSION,
  mime: PROJECT_MIME,
  pickerLabel: 'ParamRig scene',
  documentId: (document) => document.id,
  documentName: (document) => document.name,
  fileName: (document) => projectFileName(document),
  serialize: (document) => serializeProject(document),
  parse: (text) => {
    const result = importProject(text)
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, document: result.project.document, ...(result.note ? { note: result.note } : {}) }
  },
  save: (document) => saveSceneDocument(document),
  recent: (document) => ({
    kind: 'scene',
    // A scene has no page to be the size of; the card is told the size of the picture instead, so
    // whatever draws the entry has a viewBox to use rather than two undefined numbers.
    width: RECENT_THUMBNAIL_SIZE,
    height: RECENT_THUMBNAIL_SIZE,
    thumbnail: sceneThumbnail(document, { size: RECENT_THUMBNAIL_SIZE }),
  }),
}

/**
 * Keeps the scene written where the user expects it: browser storage always, and a file on disk
 * once one is chosen. The work is the shared hook's; this binds it to the scene format.
 */
export function useSceneFile(document: SceneDocument | null): ProjectFile<SceneDocument> {
  const format = useMemo(() => SCENE_PROJECT_FORMAT, [])
  return useProjectFile(document, format)
}
