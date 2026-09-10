import { readStore, writeStore, type StorageResult } from '@/editor/storage'
import type { RigManifest } from '@/rigs/types'
import { rigText as text } from '@/rigs/sanitize'
import { defaultPatch, sanitizeAudioPatch } from '@/audio/patch'
import { sanitizeAudioRig, type AudioRig } from '@/audio/rig'
import type { AudioPatch } from '@/audio/types'
import { BUNDLED_PATCHES } from '@/rigs/examples/arcade-coin'

export { STORAGE_BLOCKED_MESSAGE, STORAGE_FULL_MESSAGE, storageMessage, type StorageResult } from '@/editor/storage'

const STORAGE_KEY = 'paramrig.audio-documents.v1'

/**
 * A sound kept aside. Sound design is comparison — you get somewhere, you try something else, and
 * you need the somewhere back. These live on the document rather than in the browser's draft store
 * so that they travel with the patch when it is exported.
 */
export type AudioSnapshot = {
  id: string
  name: string
  createdAt: string
  patch: AudioPatch
}

/** Past this many the list stops being findable, and the oldest gives way. */
export const MAX_SNAPSHOTS = 24

/** A patch, its name, and the controls it chooses to expose. A patch with a rig is a rig. */
export type AudioDocument = {
  version: 1
  id: string
  name: string
  patch: AudioPatch
  snapshots?: AudioSnapshot[]
  /** A patch with one is an instrument someone else can use without seeing the seventy fields. */
  rig?: AudioRig
  createdAt: string
  updatedAt: string
}

function readAll(): Record<string, AudioDocument> {
  return readStore(STORAGE_KEY, sanitizeAudioDocument)
}

function writeAll(documents: Record<string, AudioDocument>): StorageResult {
  return writeStore(STORAGE_KEY, documents)
}

export function createAudioDocument(): AudioDocument {
  const now = new Date().toISOString()
  const document: AudioDocument = {
    version: 1,
    id: `audio-${crypto.randomUUID()}`,
    name: 'Untitled',
    patch: defaultPatch(),
    createdAt: now,
    updatedAt: now,
  }
  saveAudioDocument(document)
  return document
}

/** A patch read back from storage or a file. The patch itself is clamped rather than refused. */
export function sanitizeAudioDocument(value: unknown): AudioDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const id = text(source.id, 80)
  if (!id) return null
  const now = new Date(0).toISOString()
  const rig = sanitizeAudioRig(source.rig)
  const snapshots = (Array.isArray(source.snapshots) ? source.snapshots : [])
    .slice(0, MAX_SNAPSHOTS)
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const row = entry as Record<string, unknown>
      const snapshotId = text(row.id, 80)
      if (!snapshotId) return []
      return [{
        id: snapshotId,
        name: text(row.name, 80) ?? 'Sound',
        createdAt: text(row.createdAt, 40) ?? new Date(0).toISOString(),
        patch: sanitizeAudioPatch(row.patch),
      }]
    })
  return {
    version: 1,
    id,
    name: text(source.name, 120) ?? 'Untitled',
    patch: sanitizeAudioPatch(source.patch),
    ...(snapshots.length ? { snapshots } : {}),
    ...(rig ? { rig } : {}),
    createdAt: text(source.createdAt, 40) ?? now,
    updatedAt: text(source.updatedAt, 40) ?? now,
  }
}

/**
 * Every patch this browser can open: the ones it has stored, plus the ones the app ships that have
 * not been edited. A bundled patch becomes an ordinary stored one the moment it is changed.
 */
export function listAudioDocuments(): AudioDocument[] {
  const stored = readAll()
  const bundled = BUNDLED_PATCHES.map((build) => build()).filter((document) => !stored[document.id])
  return [...Object.values(stored), ...bundled].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getAudioDocument(id: string): AudioDocument | null {
  const stored = readAll()[id]
  if (stored) return stored
  const bundled = BUNDLED_PATCHES.map((build) => build()).find((document) => document.id === id)
  return bundled ? sanitizeAudioDocument(bundled) : null
}

export function isBundledAudioDocument(id: string): boolean {
  return BUNDLED_PATCHES.some((build) => build().id === id) && !readAll()[id]
}

/** Whether a document is a bundled one that nothing has altered, down to the last number. */
function unchangedBundle(document: AudioDocument): boolean {
  const shipped = BUNDLED_PATCHES.map((build) => build()).find((entry) => entry.id === document.id)
  // Both sides sanitised: the comparison is of content, and one side arriving with its keys in
  // another order is not a change. It used to compare the shipped patch against the raw document,
  // so any change to what the sanitiser emits made an example start copying itself into storage.
  return !!shipped && JSON.stringify(sanitizeAudioDocument(shipped)) === JSON.stringify(sanitizeAudioDocument(document))
}

export function saveAudioDocument(document: AudioDocument): StorageResult {
  const documents = readAll()
  // Opening a bundled patch is not editing it. Without this, listening to the example would copy
  // it into storage and the library would file it under this browser's projects.
  if (!documents[document.id] && unchangedBundle(document)) return { ok: true }
  documents[document.id] = sanitizeAudioDocument(document) ?? document
  return writeAll(documents)
}

export function deleteAudioDocument(id: string): StorageResult {
  const documents = readAll()
  delete documents[id]
  return writeAll(documents)
}

/** How long a patch runs, phrased for a card rather than for a field. */
function durationLabel(seconds: number): string {
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`
}

/**
 * The patch as the rest of the workbench sees it. A patch that exposes controls carries them here,
 * so a `RigSession` built from this manifest works the way it does for every other rig.
 */
export function audioManifest(document: AudioDocument): RigManifest {
  const rig = document.rig
  const controls = rig?.parameters.length ?? 0
  const layers = document.patch.layers.filter((layer) => layer.enabled).length
  const bundled = isBundledAudioDocument(document.id)
  return {
    id: document.id,
    name: document.name,
    summary: controls > 0
      ? `Audio · ${controls} ${controls === 1 ? 'control' : 'controls'}`
      : `Audio · ${durationLabel(document.patch.duration)}, ${layers} ${layers === 1 ? 'layer' : 'layers'}`,
    description: '',
    renderer: 'audio',
    rendererLabel: 'Audio',
    collection: bundled ? 'examples' : 'project',
    title: bundled ? 'Examples/Audio' : 'Projects/Audio',
    sourceFile: bundled ? `src/rigs/examples/${document.id.replace(/^audio-example-/, '')}.ts` : 'Local document',
    tags: ['audio', 'sound', bundled ? 'example' : 'project', ...(controls > 0 ? ['rig'] : [])],
    groups: rig?.groups ?? [],
    parameters: rig?.parameters ?? [],
    ...(rig?.inspectorCategories ? { inspectorCategories: rig.inspectorCategories } : {}),
  }
}
