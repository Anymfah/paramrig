import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { changedIds, countedLabel, DEFAULT_STEP_LABEL, START_LABEL, type HistoryStep } from '@/editor/history'
import { getSceneDocument, MAX_VERSIONS, saveSceneDocument, uniqueName } from '@/scene/document'
import { cameraPlacement } from '@/scene/operators/view'
import { runOperator as runRegisteredOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams } from '@/scene/operators/types'
import { getOperator } from '@/scene/operators/registry'
import type { SceneDocument, SceneObject, SceneSelection, ViewState } from '@/scene/types'

/**
 * The document, what is selected, and the history that ties them together.
 *
 * Two rules shape everything here. A document is replaced, never mutated, and only the objects an
 * edit touched are cloned — which is what lets a hundred undo steps of a heavy scene stay in
 * memory. And one continuous gesture is one undo step: `beginGesture` remembers where the document
 * was, every move during the drag writes without recording, and `endGesture` puts a single named
 * entry in the history. A click that moved nothing writes nothing at all.
 *
 * The view is deliberately outside the history. Undo is for the document; nobody wants their last
 * five undos to be camera moves.
 */

type HistoryEntry = { document: SceneDocument; label: string; at: number }

const EMPTY_SELECTION: SceneSelection = { objectIds: [], activeObjectId: null }

/**
 * What a brand new scene opens with: its first mesh, selected and active, the way Blender's startup
 * file opens with its cube. It is what makes Tab, G, R and S answer the first keystroke instead of
 * the second.
 *
 * Only a scene nobody has touched, which is what a startup file is: once a document has been
 * edited, `updatedAt` has moved, and a selection this editor invents is not the one the person
 * left. Blender can restore that because it stores the selection in the file; this editor
 * deliberately does not — a reopened document should not remember which row was highlighted — so
 * where Blender remembers, this opens with nothing, which is the honest answer rather than a guess.
 *
 * Only in object mode, and only a mesh: entering edit mode builds its own selection, and G on a
 * camera is not what anybody came here to do.
 */
function openingSelection(document: SceneDocument | null): SceneSelection {
  if (!document || document.view.mode !== 'object') return EMPTY_SELECTION
  if (document.createdAt !== document.updatedAt) return EMPTY_SELECTION
  const first = document.objects.find((object) => object.data.kind === 'mesh' && object.visible && object.selectable)
  return first ? { objectIds: [first.id], activeObjectId: first.id } : EMPTY_SELECTION
}

/**
 * What was selected in each document, kept for as long as the tab is open.
 *
 * Crossing between editing a scene and tuning its controls unmounts one React tree and mounts
 * another, and a selection that came back empty from that would make the crossing a cost rather
 * than a switch. It is memory rather than storage on purpose: a selection is where somebody is in
 * a session, not something a document carries.
 */
const lastSelection = new Map<string, SceneSelection>()

/** Forgets it, for a test that opens the same document twice and expects a clean start. */
export function clearSceneSelectionMemory(): void {
  lastSelection.clear()
}

/** How many steps a document keeps when the preferences say nothing, and the most it will keep. */
const HISTORY_LIMIT = 100
const HISTORY_CEILING = 256

export type LastOperation = {
  operatorId: string
  params: OperatorParams
  /** The document as it was before the operator ran, so F9 can replay against it. */
  before: SceneDocument
  beforeSelection: SceneSelection
  label: string
}

/**
 * A history entry holds the document itself, not a copy of it.
 *
 * Nothing in the editor writes into a document: an operator returns a new one, `withMesh` replaces
 * a map, a field spreads what it changes. So the document *is* the state at that moment, and
 * copying it buys nothing — while copying one that holds a hundred thousand vertices costs a
 * hundred milliseconds and mints fresh meshes the sanitiser then has to read all over again.
 *
 * If something ever did mutate a document in place, this is where the bug would show: undo would
 * come back to the state it was meant to leave. That is a defect to fix at the source rather than
 * to hide behind a copy of every mesh in the scene.
 */

function sameSelection(a: SceneSelection, b: SceneSelection): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Two documents that would draw the same. The timestamp is not part of what a person changed.
 *
 * Compared piece by piece rather than by serialising both: a document holding a twenty-thousand
 * vertex mesh is ten megabytes of JSON, and this is asked on every edit. Everything in a document
 * is replaced rather than mutated, so a piece that has not changed is the same object — and the
 * view, which is small and is rebuilt from parts, is the one worth looking inside.
 */
function sameDocument(a: SceneDocument, b: SceneDocument): boolean {
  if (a === b) return true
  return a.objects === b.objects
    && a.meshes === b.meshes
    && a.collections === b.collections
    && a.materials === b.materials
    && a.world === b.world
    && a.cursor === b.cursor
    && a.units === b.units
    && a.name === b.name
    && a.annotations === b.annotations
    && a.measurements === b.measurements
    && a.rig === b.rig
    && a.versions === b.versions
    && JSON.stringify(a.view) === JSON.stringify(b.view)
}

export function useSceneDocument(documentId: string, options: { undoSteps?: number } = {}) {
  /*
   * How deep the history goes is a preference, and it is read through a ref rather than closed over
   * so that changing it in the middle of an editing session takes effect on the next step rather
   * than on the next document.
   */
  const limit = useRef(HISTORY_LIMIT)
  limit.current = Math.max(8, Math.min(HISTORY_CEILING, options.undoSteps ?? HISTORY_LIMIT))
  const initial = useMemo(() => getSceneDocument(documentId), [documentId])
  const [document, setDocumentState] = useState<SceneDocument | null>(initial)
  const [selection, setSelectionState] = useState<SceneSelection>(() => lastSelection.get(documentId) ?? openingSelection(initial))
  const [history, setHistory] = useState<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] })
  const [lastOperation, setLastOperation] = useState<LastOperation | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  /**
   * History is mirrored in a ref and written through a helper: recording from inside a state
   * updater would run twice under StrictMode and record every edit twice.
   */
  const historyRef = useRef(history)
  historyRef.current = history
  const latest = useRef<SceneDocument | null>(initial)
  latest.current = document
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const gestureStart = useRef<SceneDocument | null>(null)
  const gestureLabel = useRef(DEFAULT_STEP_LABEL)
  const openedAt = useRef(Date.now())
  const loadedId = useRef(documentId)

  useEffect(() => {
    if (loadedId.current === documentId) return
    loadedId.current = documentId
    const next = getSceneDocument(documentId)
    latest.current = next
    setDocumentState(next)
    // Opening the same document again keeps what was selected in it; another opens the way a new
    // scene does — on its cube, if nobody has touched it yet.
    setSelectionState(lastSelection.get(documentId) ?? openingSelection(next))
    historyRef.current = { past: [], future: [] }
    setHistory(historyRef.current)
    setLastOperation(null)
    gestureStart.current = null
    openedAt.current = Date.now()
  }, [documentId])

  useEffect(() => {
    if (!document || gestureStart.current) return
    saveSceneDocument(document)
  }, [document])

  const writeHistory = useCallback((next: { past: HistoryEntry[]; future: HistoryEntry[] }) => {
    historyRef.current = next
    setHistory(next)
  }, [])

  const replace = useCallback((update: (current: SceneDocument) => SceneDocument, record = true, label = DEFAULT_STEP_LABEL) => {
    const current = latest.current
    if (!current) return
    const updated = cameraFollows(current, update(current))
    if (updated === current || sameDocument(updated, current)) return
    const next = { ...updated, updatedAt: new Date().toISOString() }
    if (record && !gestureStart.current) {
      writeHistory({
        past: [...historyRef.current.past.slice(-(limit.current - 1)), { document: current, label, at: Date.now() }],
        future: [],
      })
    }
    latest.current = next
    setDocumentState(next)
  }, [writeHistory])

  /** The view is saved with the document but never recorded: undo is for the scene, not the camera. */
  const setView = useCallback((update: ViewState | ((current: ViewState) => ViewState)) => {
    const current = latest.current
    if (!current) return
    const view = typeof update === 'function' ? update(current.view) : update
    if (view === current.view) return
    const next = cameraFollows(current, { ...current, view })
    latest.current = next
    setDocumentState(next)
  }, [])

  const beginGesture = useCallback((label = DEFAULT_STEP_LABEL) => {
    if (gestureStart.current || !latest.current) return
    // The document as it stands, not a copy of it: nothing in the editor writes into a document,
    // so the reference *is* the state before the gesture — and copying a mesh of a hundred thousand
    // vertices at the start of every drag is a cost nobody asked for.
    gestureStart.current = latest.current
    gestureLabel.current = label
  }, [])

  const endGesture = useCallback((label?: string) => {
    const name = label ?? gestureLabel.current
    const start = gestureStart.current
    const current = latest.current
    gestureStart.current = null
    gestureLabel.current = DEFAULT_STEP_LABEL
    if (!current || !start || sameDocument(current, start)) return
    writeHistory({
      past: [...historyRef.current.past.slice(-(limit.current - 1)), { document: start, label: name, at: Date.now() }],
      future: [],
    })
    queueMicrotask(() => saveSceneDocument(current))
  }, [writeHistory])

  const cancelGesture = useCallback(() => {
    const start = gestureStart.current
    gestureStart.current = null
    gestureLabel.current = DEFAULT_STEP_LABEL
    if (!start) return
    latest.current = start
    setDocumentState(start)
  }, [])

  const setSelection = useCallback((next: SceneSelection | ((current: SceneSelection) => SceneSelection)) => {
    setSelectionState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      if (sameSelection(current, value)) return current
      lastSelection.set(documentId, value)
      return value
    })
  }, [documentId])

  const selectObjects = useCallback((ids: string[], active?: string | null) => {
    setSelection({ objectIds: ids, activeObjectId: active === undefined ? ids.at(-1) ?? null : active })
  }, [setSelection])

  const editDocument = useCallback((edit: (current: SceneDocument) => SceneDocument, label = DEFAULT_STEP_LABEL, record = true) => {
    replace(edit, record, label)
  }, [replace])

  /** One object changed, every other object shared rather than copied. */
  const updateObjects = useCallback((patches: Array<{ id: string; patch: Partial<SceneObject> }>, label?: string, record = true) => {
    if (patches.length === 0) return
    const byId = new Map(patches.map((entry) => [entry.id, entry.patch]))
    replace((current) => ({
      ...current,
      objects: current.objects.map((object) => {
        const patch = byId.get(object.id)
        return patch ? { ...object, ...patch } : object
      }),
    }), record, label ?? countedLabel('Edit', patches.length))
  }, [replace])

  const updateObject = useCallback((id: string, patch: Partial<SceneObject>, label?: string, record = true) => {
    updateObjects([{ id, patch }], label, record)
  }, [updateObjects])

  const renameObject = useCallback((id: string, name: string) => {
    const current = latest.current
    if (!current) return
    const trimmed = name.trim().slice(0, 120)
    if (!trimmed) return
    const taken = current.objects.filter((object) => object.id !== id).map((object) => object.name)
    updateObject(id, { name: uniqueName(taken, trimmed) }, 'Rename')
  }, [updateObject])

  /* ------------------------------------------------------------- operators */

  const operatorContext = useCallback((document?: SceneDocument, override?: SceneSelection): OperatorContext | null => {
    const source = document ?? latest.current
    if (!source) return null
    const current = override ?? selectionRef.current
    return {
      document: source,
      selection: current,
      mode: source.view.mode,
      view: source.view,
      cursor: source.cursor,
      active: source.objects.find((object) => object.id === current.activeObjectId) ?? null,
    }
  }, [])

  /**
   * Runs an operator as one history entry, and remembers it so F9 can re-run it with different
   * numbers and ⇧R can repeat it. A refusal is a message, never a silent no-op.
   */
  const runOperator = useCallback((operatorId: string, params: Partial<OperatorParams> = {}, extra?: Partial<OperatorContext>) => {
    const base = operatorContext()
    if (!base) return
    const context = extra ? { ...base, ...extra } : base
    const operator = getOperator(operatorId)
    const result = runRegisteredOperator(operatorId, context, params)
    if (result.error) {
      setMessage(result.error)
      return
    }
    setMessage(null)
    // An operator that copies hands back the text; reaching the clipboard is the editor's job.
    if (result.clipboard && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(result.clipboard).catch(() => setMessage('The clipboard could not be written.'))
    }
    const label = result.label ?? operator?.label ?? DEFAULT_STEP_LABEL
    const record = operator?.history !== false
    // An operator that named its own step said something a person should read — "Removed 7
    // vertices", "the patch could not be merged" — and the status bar is where that goes.
    if (result.label && operator && result.label !== operator.label) setMessage(result.label)
    if (result.document) {
      replace(() => result.document!, record, label)
      // A view move is not an edit: it leaves no history entry and nothing for F9 to adjust.
      if (record) {
        setLastOperation({
          operatorId,
          params: { ...(operator?.defaults ?? {}), ...params } as OperatorParams,
          before: context.document,
          beforeSelection: context.selection,
          label,
        })
      }
    }
    if (result.selection) setSelection(result.selection)
  }, [operatorContext, replace, setSelection])

  /**
   * The "Adjust last operation" panel: the operator runs again on the document as it was before,
   * and replaces the same history entry rather than adding one per keystroke.
   */
  const adjustLastOperation = useCallback((params: OperatorParams) => {
    const last = lastOperation
    if (!last) return
    const context = operatorContext(last.before, last.beforeSelection)
    if (!context) return
    const result = runRegisteredOperator(last.operatorId, context, params)
    if (result.error) {
      setMessage(result.error)
      return
    }
    setMessage(null)
    if (!result.document) return
    const operator = getOperator(last.operatorId)
    const label = result.label ?? operator?.label ?? last.label
    // The entry this operator already made stays where it is; only the state after it changes.
    const next = { ...result.document, updatedAt: new Date().toISOString() }
    latest.current = next
    setDocumentState(next)
    if (result.selection) setSelection(result.selection)
    setLastOperation({ ...last, params, label })
  }, [lastOperation, operatorContext, setSelection])

  /**
   * A modal operator, running.
   *
   * Every frame of an extrusion, a bevel or a loop cut is the *same* operator run again against the
   * document as it was when the gesture opened, with a different number: that is what makes the
   * preview exactly what the result will be, and what makes the F9 panel afterwards a replay of the
   * same call rather than a second implementation of it. `preview` writes without history;
   * `commit` writes the one entry the whole gesture leaves behind.
   */
  const previewOperator = useCallback((
    operatorId: string,
    params: OperatorParams,
    before: SceneDocument,
    beforeSelection: SceneSelection,
  ): string | null => {
    const context = operatorContext(before, beforeSelection)
    if (!context) return 'There is no scene open.'
    const result = runRegisteredOperator(operatorId, context, params)
    if (result.error) return result.error
    if (!result.document) return null
    latest.current = result.document
    setDocumentState(result.document)
    if (result.selection) setSelection(result.selection)
    return null
  }, [operatorContext, setSelection])

  const commitOperator = useCallback((
    operatorId: string,
    params: OperatorParams,
    before: SceneDocument,
    beforeSelection: SceneSelection,
  ): string | null => {
    const context = operatorContext(before, beforeSelection)
    if (!context) return 'There is no scene open.'
    const result = runRegisteredOperator(operatorId, context, params)
    if (result.error) {
      // The preview is undone by putting back what was there before the gesture opened.
      latest.current = before
      setDocumentState(before)
      setSelection(beforeSelection)
      return result.error
    }
    if (!result.document) return null
    const operator = getOperator(operatorId)
    const label = result.label ?? operator?.label ?? DEFAULT_STEP_LABEL
    // The history entry is written against the document as it was before the gesture, so undo goes
    // back past the whole drag rather than past its last frame.
    latest.current = before
    replace(() => result.document!, operator?.history !== false, label)
    if (result.selection) setSelection(result.selection)
    if (operator?.history !== false) {
      setLastOperation({ operatorId, params, before, beforeSelection, label })
    }
    setMessage(null)
    return null
  }, [operatorContext, replace, setSelection])

  const repeatLastOperation = useCallback(() => {
    const last = lastOperation
    if (!last) return
    runOperator(last.operatorId, last.params)
  }, [lastOperation, runOperator])

  const clearLastOperation = useCallback(() => setLastOperation(null), [])

  /* --------------------------------------------------------------- history */

  const selectChanged = useCallback((before: SceneObject[], after: SceneObject[]) => {
    const survivors = new Set(after.map((object) => object.id))
    const touched = changedIds(before, after).filter((id) => survivors.has(id))
    if (touched.length) setSelection({ objectIds: touched, activeObjectId: touched.at(-1) ?? null })
  }, [setSelection])

  const undo = useCallback(() => {
    if (gestureStart.current) return
    const value = historyRef.current
    const previous = value.past.at(-1)
    const current = latest.current
    if (!previous || !current) return
    writeHistory({
      past: value.past.slice(0, -1),
      future: [{ document: current, label: previous.label, at: previous.at }, ...value.future].slice(0, limit.current),
    })
    // The view the person is looking through is theirs, not the history's.
    latest.current = { ...previous.document, view: current.view }
    setDocumentState(latest.current)
    setLastOperation(null)
    selectChanged(current.objects, latest.current.objects)
  }, [selectChanged, writeHistory])

  const redo = useCallback(() => {
    if (gestureStart.current) return
    const value = historyRef.current
    const next = value.future[0]
    const current = latest.current
    if (!next || !current) return
    writeHistory({
      past: [...value.past, { document: current, label: next.label, at: next.at }].slice(-limit.current),
      future: value.future.slice(1),
    })
    latest.current = { ...next.document, view: current.view }
    setDocumentState(latest.current)
    setLastOperation(null)
    selectChanged(current.objects, latest.current.objects)
  }, [selectChanged, writeHistory])

  const goToStep = useCallback((index: number) => {
    if (gestureStart.current) return
    const value = historyRef.current
    const current = latest.current
    if (!current) return
    const states: HistoryEntry[] = [
      { document: value.past[0]?.document ?? current, label: START_LABEL, at: value.past[0]?.at ?? openedAt.current },
      ...value.past.map((entry, position) => ({
        document: position + 1 < value.past.length ? value.past[position + 1]!.document : current,
        label: entry.label,
        at: entry.at,
      })),
      ...value.future,
    ]
    const position = value.past.length
    const target = Math.max(0, Math.min(states.length - 1, index))
    if (target === position) return
    writeHistory({
      past: states.slice(0, target).map((entry, at) => ({ document: entry.document, label: states[at + 1]!.label, at: states[at + 1]!.at })),
      future: states.slice(target + 1),
    })
    latest.current = { ...states[target]!.document, view: current.view }
    setDocumentState(latest.current)
    setLastOperation(null)
    selectChanged(current.objects, latest.current.objects)
  }, [selectChanged, writeHistory])

  const historySteps: HistoryStep[] = [
    { index: 0, label: START_LABEL, at: history.past[0]?.at ?? openedAt.current },
    ...history.past.map((entry, index) => ({ index: index + 1, label: entry.label, at: entry.at })),
    ...history.future.map((entry, index) => ({ index: history.past.length + 1 + index, label: entry.label, at: entry.at })),
  ]

  /* -------------------------------------------------------------- versions */

  const saveVersion = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 80) || `Version ${(latest.current?.versions?.length ?? 0) + 1}`
    replace((current) => ({
      ...current,
      versions: [
        ...(current.versions ?? []),
        {
          id: crypto.randomUUID(),
          name: trimmed,
          createdAt: new Date().toISOString(),
          objects: structuredClone(current.objects),
          meshes: structuredClone(current.meshes),
          collections: structuredClone(current.collections),
          materials: structuredClone(current.materials),
        },
      ].slice(-MAX_VERSIONS),
    }), true, `Save version “${trimmed}”`)
  }, [replace])

  const restoreVersion = useCallback((id: string) => {
    replace((current) => {
      const version = current.versions?.find((entry) => entry.id === id)
      if (!version) return current
      return {
        ...current,
        objects: structuredClone(version.objects),
        meshes: structuredClone(version.meshes),
        collections: structuredClone(version.collections),
        materials: structuredClone(version.materials),
      }
    }, true, 'Restore version')
    setSelection({ objectIds: [], activeObjectId: null })
  }, [replace, setSelection])

  const deleteVersion = useCallback((id: string) => {
    replace((current) => {
      const versions = (current.versions ?? []).filter((entry) => entry.id !== id)
      return { ...current, versions: versions.length ? versions : undefined }
    }, true, 'Delete version')
  }, [replace])

  const rename = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 120)
    if (!trimmed) return
    replace((current) => ({ ...current, name: trimmed }), true, 'Rename scene')
  }, [replace])

  /* ------------------------------------------------------------ selection */

  // A selection that names an object the document no longer has is not a selection.
  useEffect(() => {
    if (!document) return
    const alive = new Set(document.objects.map((object) => object.id))
    const ids = selection.objectIds.filter((id) => alive.has(id))
    const active = selection.activeObjectId && alive.has(selection.activeObjectId) ? selection.activeObjectId : ids.at(-1) ?? null
    if (ids.length === selection.objectIds.length && active === selection.activeObjectId) return
    setSelectionState({ ...selection, objectIds: ids, activeObjectId: active })
  }, [document, selection])

  const selectedObjects = (document?.objects ?? []).filter((object) => selection.objectIds.includes(object.id))
  const activeObject = (document?.objects ?? []).find((object) => object.id === selection.activeObjectId) ?? null

  return {
    document,
    selection,
    selectedObjects,
    activeObject,
    message,
    setMessage,
    setSelection,
    selectObjects,
    setView,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    goToStep,
    historySteps,
    historyIndex: history.past.length,
    beginGesture,
    endGesture,
    cancelGesture,
    editDocument,
    updateObject,
    updateObjects,
    renameObject,
    rename,
    runOperator,
    operatorContext,
    lastOperation,
    adjustLastOperation,
    previewOperator,
    commitOperator,
    repeatLastOperation,
    clearLastOperation,
    saveVersion,
    restoreVersion,
    deleteVersion,
  }
}

export type SceneEditor = ReturnType<typeof useSceneDocument>

/**
 * What navigating does while the view is looking through the camera.
 *
 * Two answers, and Blender's are both right. With the camera locked to the view, the camera *is*
 * the view: turning, panning and zooming move the object, and the shot is framed by flying around
 * in it. Without the lock, the view is a place a person has borrowed from the camera, and moving it
 * means they no longer want to be there — so the camera view is left rather than silently ignored,
 * which is the only alternative and reads as a bug.
 *
 * Changing a setting is not navigating: only the turntable's own numbers count.
 */
function cameraFollows(current: SceneDocument, updated: SceneDocument): SceneDocument {
  const before = current.view
  const view = updated.view
  const looking = before.camera?.looking === true && view.camera?.looking !== false
  const moved = view.yaw !== before.yaw
    || view.pitch !== before.pitch
    || view.distance !== before.distance
    || view.target[0] !== before.target[0]
    || view.target[1] !== before.target[1]
    || view.target[2] !== before.target[2]
  if (!looking || !moved) return updated
  if (view.camera?.lock !== true) {
    return { ...updated, view: { ...view, camera: { ...(view.camera ?? { looking: false }), looking: false } } }
  }
  const camera = updated.objects.find((object) => object.data.kind === 'camera' && object.data.active)
  if (!camera) return updated
  const placement = cameraPlacement(view)
  return {
    ...updated,
    objects: updated.objects.map((object) => (
      object.id === camera.id ? { ...object, transform: { ...object.transform, ...placement } } : object
    )),
  }
}
