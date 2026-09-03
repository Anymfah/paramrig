import { sanitizeSceneDocument } from '@/scene/document'
import type { SceneDocument } from '@/scene/types'

/** File format written by "Save as…": the document plus the metadata a library entry needs. */
export const PROJECT_FORMAT = 'paramrig.scene'
export const PROJECT_FORMAT_VERSION = 1
export const PROJECT_EXTENSION = '.paramrig.json'
export const PROJECT_MIME = 'application/json'
export const PROJECT_KIND = 'scene'

export type SceneProject = {
  format: typeof PROJECT_FORMAT
  formatVersion: number
  kind: typeof PROJECT_KIND
  app: string
  savedAt: string
  document: SceneDocument
}

export type ProjectImport =
  /** `note` says what the file asked for and did not get, so the reader is told rather than left guessing. */
  | { ok: true; project: SceneProject; note?: string }
  | { ok: false; error: string }

export function exportProject(document: SceneDocument): SceneProject {
  return {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    kind: PROJECT_KIND,
    app: 'ParamRig',
    savedAt: new Date().toISOString(),
    document: sanitizeSceneDocument(document) ?? document,
  }
}

export function serializeProject(document: SceneDocument): string {
  return `${JSON.stringify(exportProject(document), null, 2)}\n`
}

export function projectFileName(document: SceneDocument): string {
  const stem = document.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene'
  return `${stem}${PROJECT_EXTENSION}`
}

/** Reads a project file. Never throws: every failure comes back as a message to show. */
export function importProject(input: unknown): ProjectImport {
  let value = input
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { ok: false, error: 'That file is not valid JSON.' }
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'That file is not a ParamRig project.' }
  }
  const source = value as Omit<Partial<SceneProject>, 'format'> & { format?: string }
  if (source.format === 'paramrig.vector') {
    return { ok: false, error: 'That is a vector document. Open it from the library, or use File · Import project in the vector editor.' }
  }
  if (source.format !== PROJECT_FORMAT) {
    return { ok: false, error: 'That file is not a ParamRig scene.' }
  }
  if (typeof source.formatVersion !== 'number' || source.formatVersion > PROJECT_FORMAT_VERSION) {
    return { ok: false, error: 'That scene was saved by a newer version of ParamRig.' }
  }
  const document = sanitizeSceneDocument(source.document)
  if (!document) {
    return { ok: false, error: 'That project file is damaged and could not be read.' }
  }
  const note = importNote(source.document, document)
  return {
    ok: true,
    ...(note ? { note } : {}),
    project: {
      format: PROJECT_FORMAT,
      formatVersion: source.formatVersion,
      kind: PROJECT_KIND,
      app: typeof source.app === 'string' ? source.app.slice(0, 60) : 'ParamRig',
      savedAt: typeof source.savedAt === 'string' ? source.savedAt : document.updatedAt,
      document,
    },
  }
}

/**
 * What the file lost on the way in. An object whose mesh is missing, or a control the app cannot
 * read, is dropped — and said so, rather than disappearing between one save and the next.
 */
export function importNote(raw: unknown, document: SceneDocument): string | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Partial<SceneDocument>
  const notes: string[] = []
  const rawObjects = Array.isArray(source.objects) ? source.objects.length : 0
  if (rawObjects > document.objects.length) {
    const lost = rawObjects - document.objects.length
    notes.push(`${lost} ${lost === 1 ? 'object' : 'objects'} could not be read and ${lost === 1 ? 'was' : 'were'} left out.`)
  }
  const rawBindings = Array.isArray((source.rig as { bindings?: unknown[] } | undefined)?.bindings)
    ? (source.rig as { bindings: unknown[] }).bindings.length
    : 0
  const keptBindings = document.rig?.bindings.length ?? 0
  if (rawBindings > keptBindings) {
    const lost = rawBindings - keptBindings
    notes.push(`${lost} ${lost === 1 ? 'binding' : 'bindings'} pointed at something this file does not contain.`)
  }
  return notes.length ? notes.join(' ') : null
}
