import { sanitizeVectorDocument } from '@/vector/document'
import type { VectorDocument } from '@/vector/types'

/** File format written by "Save as…"; the document plus the metadata a library entry needs. */
export const PROJECT_FORMAT = 'paramrig.vector'
export const PROJECT_FORMAT_VERSION = 1
export const PROJECT_EXTENSION = '.paramrig.json'
export const PROJECT_MIME = 'application/json'

export type VectorProject = {
  format: typeof PROJECT_FORMAT
  formatVersion: number
  app: string
  savedAt: string
  document: VectorDocument
}

export type ProjectImport =
  /** `note` says what the file asked for and did not get, so the reader is told rather than left guessing. */
  | { ok: true; project: VectorProject; note?: string }
  | { ok: false; error: string }

export function exportProject(document: VectorDocument): VectorProject {
  return {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    app: 'ParamRig',
    savedAt: new Date().toISOString(),
    document: sanitizeVectorDocument(document) ?? document,
  }
}

export function serializeProject(document: VectorDocument): string {
  return `${JSON.stringify(exportProject(document), null, 2)}\n`
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
  const source = value as Partial<VectorProject>
  if (source.format !== PROJECT_FORMAT) {
    return { ok: false, error: 'That file is not a ParamRig project.' }
  }
  if (typeof source.formatVersion !== 'number' || source.formatVersion > PROJECT_FORMAT_VERSION) {
    return { ok: false, error: 'That project was saved by a newer version of ParamRig.' }
  }
  const document = sanitizeVectorDocument(source.document)
  if (!document) {
    return { ok: false, error: 'That project file is damaged and could not be read.' }
  }
  const note = rigNote(source.document, document)
  return {
    ok: true,
    ...(note ? { note } : {}),
    project: {
      format: PROJECT_FORMAT,
      formatVersion: source.formatVersion,
      app: typeof source.app === 'string' ? source.app.slice(0, 60) : 'ParamRig',
      savedAt: typeof source.savedAt === 'string' ? source.savedAt : document.updatedAt,
      document,
    },
  }
}

/**
 * What the file's rig lost on the way in. A control the app cannot read, or a binding that names an
 * object or a control that is not in the file, is dropped — and said so, rather than disappearing.
 */
export function rigNote(raw: unknown, document: VectorDocument): string | null {
  const source = raw && typeof raw === 'object' ? (raw as { rig?: unknown }).rig : null
  if (!source || typeof source !== 'object') return null
  const asked = source as { parameters?: unknown; bindings?: unknown }
  const wantedParameters = Array.isArray(asked.parameters) ? asked.parameters.length : 0
  const wantedBindings = Array.isArray(asked.bindings) ? asked.bindings.length : 0
  const gotParameters = document.rig?.parameters.length ?? 0
  const gotBindings = document.rig?.bindings.length ?? 0
  const lost: string[] = []
  if (wantedParameters > gotParameters) lost.push(`${wantedParameters - gotParameters} ${wantedParameters - gotParameters === 1 ? 'control' : 'controls'}`)
  if (wantedBindings > gotBindings) lost.push(`${wantedBindings - gotBindings} ${wantedBindings - gotBindings === 1 ? 'binding' : 'bindings'}`)
  if (lost.length === 0) return null
  const one = lost.length === 1 && lost[0]!.startsWith('1 ')
  return `${lost.join(' and ')} in that file could not be read and ${one ? 'was' : 'were'} left out.`
}

export function projectFileName(document: Pick<VectorDocument, 'name'>): string {
  return `${projectSlug(document.name)}${PROJECT_EXTENSION}`
}

export function projectSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
}
