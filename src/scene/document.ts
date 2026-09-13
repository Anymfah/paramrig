import { readStore, writeDocument, storageMessage, type StorageResult } from '@/editor/storage'
import { BUNDLED_SCENES } from '@/rigs/examples/paper-lantern'
import { readSceneSettings } from '@/scene/prefs'
import type { RigManifest } from '@/rigs/types'
import type { SceneDocument } from '@/scene/types'
import { createSceneDocument as createDocument, sanitizeSceneDocument, sanitizeSceneView, sceneDocumentKey, compactDocument, MAX_STORED_BYTES, COMPACT_THRESHOLD_BYTES } from './model'
export * from './model'
export { STORAGE_BLOCKED_MESSAGE, STORAGE_FULL_MESSAGE, storageMessage, type StorageResult } from '@/editor/storage'
const STORAGE_KEY = 'paramrig.scene-documents.v1'

export function createSceneDocument(name = 'Untitled'): SceneDocument {
  const document = createDocument(name)
  if (document.view.solid) document.view.solid.matcap = readSceneSettings().preferences.matcap
  const saved = saveSceneDocument(document)
  if (!saved.ok) throw new Error(storageMessage(saved) ?? "The document could not be saved.")
  return document
}

/* -------------------------------------------------------------- storage */

/**
 * The store as it was last read, so that reading it again costs nothing.
 *
 * Reading meant parsing every stored document and validating every mesh in it — hundreds of
 * milliseconds on a scene of a hundred thousand vertices — and every save reads before it writes.
 * A profile of an orbit over such a scene spent a quarter of its samples inside `validateMeshData`,
 * and a profile of a vertex move nearly two thirds. Nothing of that was needed: what this tab wrote
 * it has already validated.
 *
 * The cache is dropped when this tab writes, and when another tab does — a `storage` event fires
 * only in the tabs that did not make the change, which is exactly when it must be re-read.
 */
let store: Record<string, SceneDocument> | null = null

/**
 * The document the last save was too big to keep, and what its content was.
 *
 * A scene of a hundred thousand vertices does not fit in browser storage — it comes to some
 * twenty-seven megabytes of JSON against a twenty-megabyte ceiling — and finding that out costs a
 * full sanitisation and two serialisations of all of it. Every time. A profile of the editor on
 * such a scene spends a hundred and forty milliseconds of every Tab, and every settled orbit,
 * preparing a save that is then refused, because turning the camera makes a new document object
 * and the effect that saves fires on any of them.
 *
 * A document that does not fit still does not fit until its content changes, so the refusal is
 * remembered and the work is not done again. The comparison is by reference over everything a
 * document stores except the view and the timestamp, which is what an orbit or a Tab leaves
 * untouched. That the answer keeps holding rests on the size being stable rather than on the
 * sanitiser being pure — it is not pure, it stamps `updatedAt` and mints ids for annotations that
 * lack one — but neither of those changes how many bytes the meshes take.
 *
 * It holds one document, and it holds the incoming one rather than the sanitised copy, because the
 * incoming references are what the next call arrives with. That does pin the un-sanitised arrays
 * for the life of the tab, on top of the copy the store cache already holds; on a scene light
 * enough to store, nothing is ever remembered here at all.
 */
let refused: { id: string; content: SceneDocument } | null = null

/**
 * The `meshes` record the last save sanitised, and the meshes reading it produced.
 *
 * Sanitising a document is nearly all mesh reading, and an edit that leaves the geometry alone —
 * Tab, an orbit, a rename, a keyframe — hands back the very same `meshes` object, because nothing
 * here writes into a document it was given. When it is that object again, what reading it produced
 * last time is what reading it would produce now, so those meshes are handed to the sanitiser
 * instead and it finds them already validated.
 *
 * One slot, and armed only when the sanitiser really ran and dropped no mesh: a swept mesh would
 * otherwise be missing from the reuse, and an undo that brings its object back would find nothing.
 */
let meshesRead: { from: SceneDocument['meshes']; to: SceneDocument['meshes'] } | null = null

/**
 * The key a document is stored under.
 *
 * `sanitizeSceneDocument` truncates an id, so the id a caller hands in and the key its document
 * sits under in storage are not always the same string. Anything that reaches into the store has
 * to go through here, or it looks a long-id document up under a name nothing was written to.
 */

/** Everything a document stores except its view and its timestamp, compared the cheap way. */
function sameStoredContent(a: SceneDocument, b: SceneDocument): boolean {
  return a.objects === b.objects
    && a.meshes === b.meshes
    && a.collections === b.collections
    && a.materials === b.materials
    && a.world === b.world
    && a.cursor === b.cursor
    && a.units === b.units
    && a.name === b.name
    && a.output === b.output
    && a.colorManagement === b.colorManagement
    && a.annotations === b.annotations
    && a.measurements === b.measurements
    && a.rig === b.rig
    && a.versions === b.versions
}

/** Forgets what this module remembers about storage, so the three can never disagree. */
function forgetStore(): void {
  store = null
  refused = null
  meshesRead = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === STORAGE_KEY) forgetStore()
  })
}

/** Forgets the cache, for a test that writes to storage behind the store's back. */
export function clearSceneDocumentCache(): void {
  forgetStore()
}

function readAll(): Record<string, SceneDocument> {
  if (!store) store = readStore(STORAGE_KEY, sanitizeSceneDocument)
  return store
}

/**
 * Every scene there is: what is stored, then whatever the app ships that has not been opened.
 *
 * A bundled example is a document like any other — the same shape, the same editor, the same rig —
 * so it is served from here rather than from a second registry the library would have to merge. It
 * stops being bundled the moment it is edited: saving writes it to storage under its own id, and
 * the stored one is what the next read finds.
 */
/** Built once, so a bundled document keeps one identity across every read that memoises on it. */
let bundled: SceneDocument[] | null = null

function bundledScenes(): SceneDocument[] {
  if (!bundled) bundled = BUNDLED_SCENES.map((make) => make())
  return bundled
}

export function listSceneDocuments(): SceneDocument[] {
  const stored = readAll()
  const bundled = bundledScenes().filter((document) => !stored[document.id])
  return [...Object.values(stored), ...bundled].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getSceneDocument(id: string): SceneDocument | null {
  return readAll()[id] ?? bundledScenes().find((document) => document.id === id) ?? null
}

/** Whether a document is the copy the app ships, rather than one this browser has written. */
export function isBundledScene(id: string): boolean {
  return bundledScenes().some((document) => document.id === id) && !readAll()[id]
}

/**
 * Writes a document to browser storage. A heavy document is compacted first — positions rounded to
 * a hundredth of a millimetre, no whitespace — and one that is heavy even so is refused rather
 * than silently truncated, so the editor can offer a file on disk instead.
 */
export function saveSceneDocument(document: SceneDocument): StorageResult {
  /*
   * The one refusal that can be answered without doing the work. The view still reaches the cache,
   * so a scene too big to store reopens where it was left rather than where it was last small
   * enough — which is what a full save would have left behind, at the cost of one spread.
   */
  const key = sceneDocumentKey(document.id)
  if (refused && refused.id === key && sameStoredContent(refused.content, document)) {
    const documents = readAll()
    const cached = documents[key]
    if (cached) documents[key] = { ...cached, view: sanitizeSceneView(document.view), updatedAt: document.updatedAt }
    return { ok: false, reason: 'quota' }
  }
  const documents = readAll()
  const known = meshesRead?.from === document.meshes ? meshesRead.to : null
  const clean = sanitizeSceneDocument(known ? { ...document, meshes: known } : document) ?? document
  // Armed only on a real sanitise: the fallback above hands back the document untouched, and its
  // meshes have not been read at all.
  meshesRead = clean !== document && Object.keys(clean.meshes).length === Object.keys(document.meshes).length
    ? { from: document.meshes, to: clean.meshes }
    : null
  /*
   * Opening a bundled example is not editing it. The editor saves whatever it loads, so without
   * this a scene the app ships would be copied into storage by being looked at — and would then
   * be listed as a project of this browser's rather than as the example it still is.
   */
  if (!documents[clean.id] && unchangedBundle(clean)) return { ok: true }
  const size = JSON.stringify(clean).length
  const entry = size > COMPACT_THRESHOLD_BYTES ? compactDocument(clean) : clean
  /*
   * Weighed before it is filed, because `documents` IS the cache — `readAll` hands back the module's
   * own map, not a copy. Filing it first and returning on the refusal left twenty-seven megabytes in
   * the cache of a tab that had refused to store them, and the next document to save, however small,
   * was written out with them: one `setItem` over quota, silently, for the rest of the session.
   */
  if (JSON.stringify(entry).length > MAX_STORED_BYTES) {
    refused = { id: key, content: document }
    return { ok: false, reason: 'quota' }
  }
  documents[clean.id] = entry
  // Only this document's: a small scene saving is no news about a heavy one, and throwing its
  // refusal away would make the next gesture on it pay the full sanitisation again.
  if (refused?.id === key) refused = null
  const result = writeDocument(STORAGE_KEY, clean.id, entry)
  // The cache is what was just written, whether or not the write landed: a refused write leaves
  // storage as it was, and `documents` is that plus the change this tab is holding in memory.
  store = documents
  return result
}

/** Whether a document is a bundled one that nothing has altered, down to the last number. */
function unchangedBundle(document: SceneDocument): boolean {
  const shipped = bundledScenes().find((entry) => entry.id === document.id)
  return !!shipped && JSON.stringify(sanitizeSceneDocument(shipped) ?? shipped) === JSON.stringify(document)
}

export function deleteSceneDocument(id: string): StorageResult {
  const documents = { ...readAll() }
  delete documents[id]
  store = documents
  if (refused?.id === sceneDocumentKey(id)) refused = null
  return writeDocument(STORAGE_KEY, id, undefined)
}

/* ------------------------------------------------------------- manifest */

/** The document as the rest of the workbench sees it: one more rig in the library. */
export function sceneManifest(document: SceneDocument): RigManifest {
  const rig = document.rig
  const controls = rig?.parameters.length ?? 0
  const objects = document.objects.length
  const bundled = isBundledScene(document.id)
  return {
    id: document.id,
    name: document.name,
    summary: controls > 0
      ? `Scene · ${controls} ${controls === 1 ? 'control' : 'controls'}`
      : `Scene · ${objects} ${objects === 1 ? 'object' : 'objects'}`,
    description: '',
    renderer: 'scene',
    rendererLabel: 'Scene',
    collection: bundled ? 'examples' : 'project',
    title: bundled ? 'Examples/Scene' : 'Projects/Scene',
    sourceFile: bundled ? `src/rigs/examples/${document.id.replace(/^example-/, '')}.ts` : 'Local document',
    tags: ['scene', '3d', bundled ? 'example' : 'project', ...(controls > 0 ? ['rig'] : [])],
    groups: rig?.groups ?? [],
    parameters: rig?.parameters ?? [],
    ...(rig?.inspectorCategories ? { inspectorCategories: rig.inspectorCategories } : {}),
    // The keyframes the scene carries, so that opening it — here or in the workbench — opens it
    // animated rather than still.
    ...(rig?.animation ? { animation: rig.animation } : {}),
  }
}
