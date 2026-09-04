import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { EditorCommandPalette } from '@/editor/EditorCommandPalette'
import { EditorModal } from '@/editor/EditorModal'
import { ensureSession } from '@/state/workspace'
import { resolveSceneValues, type SceneBinding } from '@/scene/rig'
import { SceneExposeContext, type SceneExposeContextValue } from '@/scene/exposeContext'
import { addControl, bindExisting, exposeProperty, removeControl, unbindProperty, updateControl, type ExposeRequest } from '@/scene/rigEdits'
import { insertKeyframes, KEY_CHANNELS, type KeyframeEntry } from '@/scene/animate'
import type { ParamValue } from '@/rigs/types'
import { SceneRenderDialog } from '@/scene/SceneRenderDialog'
import { downloadBlob, readModelFile, withImported, writeMaterialLibrary, writeModel, type ModelFormat } from '@/scene/io/models'
import { LiveRegion } from '@/editor/LiveRegion'
import {
  elementAnnouncement,
  modeAnnouncement,
  selectionAnnouncement,
  selectModeAnnouncement,
  toolAnnouncement,
} from '@/scene/announce'
import { editStats, type EditStats } from '@/scene/editStats'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { Button } from '@/ui/Button'
import { StatusMessage } from '@/ui/StatusMessage'
import { ContextMenuRoot } from '@/ui/ContextMenu'
import { editorCommands, menuEntries, sceneCommands, type SceneCommand } from '@/scene/commands'
import { DEFAULT_UV_EDITOR, getSceneDocument, sceneCounts, saveSceneDocument } from '@/scene/document'
import { DEFAULT_SCULPT_STATE } from '@/scene/sculpt/session'
import { describeKeymap, resolveKey } from '@/scene/keymap'
import { getOperator } from '@/scene/operators/registry'
import {
  isOpen as sectionIsOpen,
  readSceneSettings,
  readScenePrefs,
  tabOf,
  toggleFavorite,
  withSection,
  withTab,
  writeScenePrefs,
  writeSceneSettings,
  type SceneMode,
  type SceneSettings,
} from '@/scene/prefs'
/*
 * Loaded when it is first opened rather than with the editor: a dialog nobody has asked for yet is
 * a dialog that should not be between a person and their first frame.
 */
const ScenePreferencesDialog = lazy(async () => ({ default: (await import('@/scene/ScenePreferencesDialog')).ScenePreferencesDialog }))
/* The same reasoning for the second space: an editor nobody has opened costs nothing to have. */
const SceneUVEditor = lazy(async () => ({ default: (await import('@/scene/SceneUVEditor')).SceneUVEditor }))
import { SceneFavoritesContext, type SceneFavoritesValue } from '@/scene/favorites'
import { setTooltipDelay } from '@/ui/tooltipDelay'
import { withRecentCommand } from '@/editor/commands'
import { SceneFileMenu } from '@/scene/SceneFileMenu'
import { SceneHeader } from '@/scene/SceneHeader'
import { SceneHints, SceneKeymapHint } from '@/scene/SceneHints'
import { SceneMenu, type SceneMenuEntry } from '@/scene/SceneMenu'
import { ADD_MENU } from '@/scene/operators/add'
import { SNAP_PIE } from '@/scene/operators/cursor'
import type { OperatorContext } from '@/scene/operators/types'
import { SceneNavGizmo } from '@/scene/SceneNavGizmo'
import { SceneOutliner } from '@/scene/SceneOutliner'
import { ScenePieMenu, type ScenePieItem } from '@/scene/ScenePieMenu'
import { SceneProperties } from '@/scene/SceneProperties'
import { SceneRedoPanel } from '@/scene/SceneRedoPanel'
import { SceneSidebar } from '@/scene/SceneSidebar'
import { SceneStage, type SceneStageHandle } from '@/scene/SceneStage'
import { SceneSplitter } from '@/scene/SceneSplitter'
import { SceneStatusBar } from '@/scene/SceneStatusBar'
import { SceneToolbar } from '@/scene/SceneToolbar'
import { useSceneDocument } from '@/scene/useSceneDocument'
import { useSceneFile } from '@/scene/useSceneFile'
import type { SceneDocument, SceneSelection, SceneTool, SculptBrush, SelectMode, UvEditorState, ViewState } from '@/scene/types'
import type { TransformMode } from '@/scene/transform/session'
import type { SceneViewport, SceneViewportOptions } from '@/scene/viewport/SceneViewport'
import '@/scene/modifiers'
import '@/scene/operators'
import { operatorAvailability } from '@/scene/operators'
import { isModalOperator } from '@/scene/modalSpecs'
import { MESH_MENU, POINTER_MENUS, type MenuIds } from '@/scene/editMenus'
import { TOOL_OPERATORS } from '@/scene/toolOperators'
import type { OperatorParams } from '@/scene/operators'
import { SceneTouchBar } from '@/scene/SceneTouchBar'
import { FALLOFF_KINDS, type FalloffKind } from '@/scene/transform/proportional'

/**
 * What a fresh annotation is drawn in. Notes are the person's own marks rather than part of the
 * model, so they take the viewport's foreground rather than the selection colour.
 */
const ANNOTATION_COLOUR = '#f2f4f3'

/** Which modal session each modal operator opens. */
const MODAL_MODES: Record<string, TransformMode> = {
  'transform.move': 'move',
  'transform.rotate': 'rotate',
  'transform.scale': 'scale',
}

/** The menu the right button opens over the viewport: the Object menu, cut to what is used most. */
const CONTEXT_IDS = [
  'transform.move', 'transform.rotate', 'transform.scale', '-',
  'object.duplicate', 'object.duplicateLinked', '-',
  'object.setOrigin', 'object.shadeSmooth', 'object.shadeFlat', '-',
  'object.delete',
]

const SELECT_TOOLS: SceneTool[] = ['select-box', 'select-circle', 'select-lasso']

/** Handed to the resolver when a document has no controls, so its identity never changes. */
const NO_VALUES: Record<string, ParamValue> = {}

/** B and C name a way of selecting, not a selection: the key picks up the tool. */
const SELECT_TOOL_FOR = new Map<string, SceneTool>([
  ['select.box', 'select-box'],
  ['select.circle', 'select-circle'],
  ['select.lasso', 'select-lasso'],
])

/**
 * How long the live region waits before it speaks. Long enough that a drag is one sentence rather
 * than sixty, short enough that it still feels like an answer to what was just done.
 */
const ANNOUNCE_DELAY_MS = 300

/** Frames a second, as the timeline counts them: the transport reads a frame, not a fraction. */
const FPS = 30

/** Whether the pointer is a finger rather than a mouse, which is what a phone answers. */
function coarsePointerNow(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

/**
 * Whether something in the chrome has the focus, and Tab is therefore the browser's to answer.
 *
 * The viewport is not focusable, so a person working in it has the focus on the body, and Tab is
 * the editor's. The moment they reach a panel it is theirs again.
 */
function holdsFocus(): boolean {
  if (typeof window === 'undefined') return false
  const active = window.document.activeElement
  // An Element rather than an HTMLElement: the navigation gizmo's axes are focusable SVG circles,
  // and taking Tab from them would leave the focus on one of them with no way out.
  if (!(active instanceof Element) || active === window.document.body) return false
  return active.matches('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
}

/** The three numbers the live region cares about: what is selected, not what there is. */
function selectedElementCounts(stats: EditStats): { vertices: number; edges: number; faces: number } {
  return { vertices: stats.vertices.selected, edges: stats.edges.selected, faces: stats.faces.selected }
}

type PieKind = 'pivot' | 'orientation' | 'shading' | 'snap' | 'mode' | 'views'
type Pie = { kind: PieKind; at: { x: number; y: number } } | null

/**
 * The 3D editor: the outliner on the left, the viewport in the middle, the properties on the right.
 *
 * The page owns the document and the keyboard; the viewport owns the canvas and everything that
 * happens at pointer rate. Nothing that changes sixty times a second is state here.
 */
export function SceneEditorPage({ documentId, mode, onMode, createViewport, viewportOptions }: {
  documentId: string
  mode: SceneMode
  onMode: (mode: SceneMode) => void
  /** A test hands over a viewport double; the editor makes a real one. */
  createViewport?: (container: HTMLElement, options: SceneViewportOptions) => SceneViewport
  viewportOptions?: SceneViewportOptions
}) {
  const [settings, setSettings] = useState(() => readSceneSettings())
  const editor = useSceneDocument(documentId, { undoSteps: settings.preferences.undoSteps })
  const file = useSceneFile(editor.document)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')
  const [prefs, setPrefs] = useState(() => readScenePrefs())
  const [announcement, setAnnouncement] = useState('')
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [keymapOpen, setKeymapOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  /** Where the Q menu opens, or nothing when it is closed. */
  const [favoritesAt, setFavoritesAt] = useState<{ x: number; y: number } | null>(null)
  const [rendering, setRendering] = useState(false)
  const [redoExpanded, setRedoExpanded] = useState(false)
  const [pie, setPie] = useState<Pie>(null)
  const [contextAt, setContextAt] = useState<{ x: number; y: number } | null>(null)
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null)
  /** A menu of operators opened at the pointer: ⌃F, M, X and the rest of Blender's edit menus. */
  const [pointerMenu, setPointerMenu] = useState<{ title: string; ids: MenuIds; at: { x: number; y: number } } | null>(null)
  /**
   * What each tool is set to, kept per operator. Blender's Tool tab does the same: the numbers in
   * it are what the *next* drag starts from, so a bevel set to three segments stays at three.
   */
  const [toolOptions, setToolOptions] = useState<Record<string, OperatorParams>>({})
  /** A menu of plain choices — the falloff curves — which are settings rather than operators. */
  const [choiceMenu, setChoiceMenu] = useState<{
    title: string
    at: { x: number; y: number }
    entries: Array<{ id: string; label: string; checked: boolean; run: () => void }>
  } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const stage = useRef<SceneStageHandle | null>(null)
  const exists = useMemo(() => getSceneDocument(documentId) !== null, [documentId])
  const preferences = settings.preferences
  const [coarsePointer, setCoarsePointer] = useState(coarsePointerNow)

  // A tablet with a mouse plugged in stops being coarse; the viewport is told rather than rebuilt.
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const media = matchMedia('(pointer: coarse)')
    const onChange = () => setCoarsePointer(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const changeSettings = useCallback((next: SceneSettings) => {
    setSettings(next)
    writeSceneSettings(next)
  }, [])

  // Every tooltip in the application shares one delay, so it is set rather than passed.
  useEffect(() => {
    setTooltipDelay(preferences.tooltipDelayMs)
  }, [preferences.tooltipDelayMs])



  const { document, selection, selectObjects, setView, undo, redo, runOperator } = editor

  /*
   * What a screen reader is told, and when.
   *
   * The viewport is a canvas with nothing in it to read, so everything a sighted person takes in at
   * a glance is said instead. It is debounced because a drag through a marquee changes the
   * selection sixty times a second, and a live region that is rewritten that often reads nothing at
   * all: the pause is what turns a stream of changes into one sentence.
   */
  const say = useCallback((sentence: string | (() => string)) => {
    if (announceTimer.current !== null) clearTimeout(announceTimer.current)
    announceTimer.current = setTimeout(() => {
      announceTimer.current = null
      /*
       * The sentence is built here rather than at the call: counting what is selected in a mesh of
       * a hundred thousand vertices is real work, and doing it on every change of the document
       * would put it in the way of the edit itself. Only the sentence that is actually spoken is
       * ever built.
       */
      const text = typeof sentence === 'string' ? sentence : sentence()
      // A repeat has to differ or the region will not read it again: the year is never read out.
      setAnnouncement((current) => (current === text ? `${text} ` : text))
    }, ANNOUNCE_DELAY_MS)
  }, [])

  useEffect(() => () => {
    if (announceTimer.current !== null) clearTimeout(announceTimer.current)
  }, [])

  const viewMode = document?.view.mode ?? 'object'
  const selectMode = document?.view.selectMode ?? []
  const tool = document?.view.tool ?? 'select-box'

  /*
   * The selection, said once per settled change.
   *
   * It watches the selection rather than the document: moving a vertex changes the document sixty
   * times a second and changes nothing about what is selected, and an effect that ran on each of
   * those would put itself in the way of the edit.
   */
  const latest = useRef({ document, selectMode })
  latest.current = { document, selectMode }
  useEffect(() => {
    const { document: current, selectMode: kinds } = latest.current
    if (!current) return
    say(() => (viewMode === 'edit'
      ? elementAnnouncement(selectedElementCounts(editStats(current, selection)), kinds)
      : selectionAnnouncement(current, selection)))
  }, [selection, viewMode, say])

  useEffect(() => { say(modeAnnouncement(viewMode)) }, [viewMode, say])
  // Joined into one string so the effect depends on what the modes are rather than on the array.
  const selectModeKey = selectMode.join()
  useEffect(() => {
    if (viewMode !== 'edit') return
    say(selectModeAnnouncement(selectModeKey.split(',').filter(Boolean) as SelectMode[]))
  }, [selectModeKey, viewMode, say])
  useEffect(() => { say(toolAnnouncement(tool)) }, [tool, say])

  const lastLabel = editor.lastOperation?.label ?? null
  useEffect(() => { if (lastLabel) say(lastLabel) }, [lastLabel, say])
  const tab = tabOf(prefs, documentId)

  /*
   * The controls of a rigged document, and the values they are set to.
   *
   * The session belongs to the workbench rather than to this page — the same one the inspector and
   * Tune mode use — so a value set here is the value seen there, and it is persisted per document
   * without this page knowing how.
   */
  const session = document?.rig ? ensureSession(documentId) : null
  useSyncExternalStore(
    useCallback((listener: () => void) => session?.subscribe(listener) ?? (() => undefined), [session]),
    () => session?.getRevision() ?? 0,
    () => 0,
  )
  /*
   * The playhead has a channel of its own, because it moves sixty times a second and the revision
   * does not. Subscribing to it here is what makes an animation play in the viewport rather than
   * only in the workbench.
   */
  useSyncExternalStore(
    useCallback((listener: () => void) => session?.subscribeClock(listener) ?? (() => undefined), [session]),
    () => session?.displayPlayhead() ?? 0,
    () => 0,
  )
  /*
   * A document that carries controls is drawn as those controls say, while every edit still writes
   * to the raw document. It is the whole idea of a rig, and it is why the viewport, the render and
   * the exports are handed `shown` while the operators are handed `document`.
   */
  const rigValues = session?.previewValues() ?? NO_VALUES
  /** The controls that carry keyframes: what the transport is for, and what a field is coloured by. */
  const animatedParameters = new Set(
    (document?.rig?.parameters ?? []).filter((parameter) => session?.trackFor(parameter.id)).map((parameter) => parameter.id),
  )
  const animated = animatedParameters.size > 0
  const shown = document && document.rig && session ? resolveSceneValues(document, rigValues) : document

  /*
   * A keyframe cannot be added until the control it goes on exists, and a control does not exist
   * until the document that declares it has been saved and read back as a manifest. So the press
   * writes the document and leaves the keyframes here; the effect below runs on the next render,
   * by which time the session has been rebuilt with the new controls in it.
   */
  const [pendingKeys, setPendingKeys] = useState<KeyframeEntry[] | null>(null)
  /** Where the I menu opened, and what it is about to key. */
  const [keyframeAt, setKeyframeAt] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!pendingKeys || !session) return
    for (const entry of pendingKeys) session.addKeyframe(entry.parameterId, session.playheadTime(), entry.value)
    setPendingKeys(null)
    /*
     * And the tracks are mirrored into the document, so that the animation travels with the file
     * rather than living in this browser's draft. It is a one-way mirror and it is written here,
     * where a keyframe is made: the timeline in the workbench edits the draft, as it does for every
     * other rig, and what it does there stays there until something is keyed from the editor again.
     */
    const draft = session.toDraft()
    editor.editDocument((current) => (current.rig ? {
      ...current,
      rig: {
        ...current.rig,
        animation: {
          duration: session.durationTime(),
          fps: FPS,
          loop: session.isLoop(),
          tracks: structuredClone(draft.tracks ?? []),
        },
      },
    } : current), 'Insert keyframe', false)
  }, [pendingKeys, session, editor])

  const savePrefs = useCallback((next: typeof prefs) => {
    setPrefs(next)
    writeScenePrefs(next)
  }, [])

  const patchView = useCallback((patch: Partial<ViewState>) => {
    setView((current) => ({ ...current, ...patch }))
  }, [setView])

  /**
   * A model file, brought in at the cursor and selected.
   *
   * Everything an import decides — where it lands, how its names avoid the ones already there,
   * what the sanitiser makes of it — belongs to `io/models.ts`; the page only says what happened.
   */
  const importModel = useCallback(async (picked: File) => {
    try {
      const imported = await readModelFile(picked)
      if (imported.objects.length === 0) {
        editor.setMessage(`${picked.name} held no geometry this editor could read.`)
        return
      }
      let ids: string[] = []
      editor.editDocument((current) => {
        const next = withImported(current, imported)
        ids = next.objectIds
        return next.document
      }, `Import ${picked.name}`)
      if (ids.length > 0) editor.selectObjects(ids, ids[ids.length - 1] ?? null)
      editor.setMessage(`${picked.name}: ${imported.objects.length} ${imported.objects.length === 1 ? 'object' : 'objects'}.`)
    } catch (cause) {
      editor.setMessage(cause instanceof Error ? cause.message : `${picked.name} could not be read.`)
    }
  }, [editor])

  /** An export writes what is visible, or what is selected when there is a selection. */
  const exportModel = useCallback(async (format: ModelFormat) => {
    if (!document) return
    try {
      const objectIds = selection.objectIds.length > 0 ? selection.objectIds : undefined
      if (!shown) return
      const written = await writeModel(shown, format, { objectIds })
      downloadBlob(written.blob, written.fileName)
      if (format === 'obj') {
        const library = await writeMaterialLibrary(shown, { objectIds })
        downloadBlob(library.blob, library.fileName)
      }
      editor.setMessage(`Exported ${written.fileName}.`)
    } catch (cause) {
      editor.setMessage(cause instanceof Error ? cause.message : 'The export did not finish.')
    }
  }, [document, editor, selection.objectIds, shown])

  /*
   * The rig, as the panels edit it.
   *
   * Every one of these is a document edit like any other — it goes through the history, it is
   * undone with ⌃Z, it is saved with the document — because a control is part of the document
   * rather than part of the interface looking at it.
   */
  const expose = useCallback((request: ExposeRequest) => {
    let made: string | null = null
    editor.editDocument((current) => {
      const result = exposeProperty(current, request)
      if (!result) return current
      made = result.parameterId
      return result.document
    }, `Expose ${request.label}`)
    if (made) editor.setMessage(`${request.label} is now a control.`)
  }, [editor])

  const unbind = useCallback((binding: SceneBinding) => {
    editor.editDocument((current) => unbindProperty(current, binding.id), 'Unbind control')
  }, [editor])

  const goToControl = useCallback((binding: SceneBinding) => {
    // The control lives in the Controls tab; the object it writes to is what should be selected.
    if (binding.objectId) editor.selectObjects([binding.objectId], binding.objectId)
    savePrefs(withTab(prefs, documentId, 'controls'))
  }, [documentId, editor, prefs, savePrefs])

  const dropParameter = useCallback((parameterId: string, target: { objectId?: string; property: string }) => {
    editor.editDocument((current) => bindExisting(current, parameterId, target), 'Bind control')
  }, [editor])

  /** A control that drives nothing yet: a rig built from the controls down rather than up. */
  const addPlainControl = useCallback(() => {
    const count = (editor.document?.rig?.parameters.length ?? 0) + 1
    editor.editDocument((current) => addControl(current, {
      kind: 'number',
      id: `control-${count}`,
      label: `Control ${count}`,
      group: current.rig?.groups[0]?.id ?? 'main',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0,
    }), 'Add control')
  }, [editor])

  const renameControl = useCallback((parameterId: string, label: string) => {
    editor.editDocument((current) => updateControl(current, parameterId, { label }), 'Rename control')
  }, [editor])

  const moveControl = useCallback((parameterId: string, group: string) => {
    editor.editDocument((current) => updateControl(current, parameterId, { group }), 'Move control')
  }, [editor])

  const deleteControl = useCallback((parameterId: string) => {
    editor.editDocument((current) => removeControl(current, parameterId), 'Delete control')
  }, [editor])

  const goToBinding = useCallback((parameterId: string) => {
    const binding = editor.document?.rig?.bindings.find((entry) => entry.parameterId === parameterId)
    if (binding?.objectId) editor.selectObjects([binding.objectId], binding.objectId)
  }, [editor])

  /** Framing has to know how wide the viewport is, and the page is the only one that does. */
  const viewportAspect = useCallback(() => {
    const size = stage.current?.viewport?.pixelSize
    return size ? Math.max(0.1, size.width) / Math.max(0.1, size.height) : undefined
  }, [])

  /**
   * What a pointer-driven operator does to the document: every frame is the same operator run again
   * from where the gesture opened, and the last one is the only entry the history keeps.
   */
  const operatorBridge = useMemo(() => ({
    preview: editor.previewOperator,
    commit: editor.commitOperator,
    restore: (before: SceneDocument, beforeSelection: SceneSelection) => {
      editor.editDocument(() => before, 'Cancel', false)
      editor.setSelection(beforeSelection)
      editor.setMessage(null)
    },
    message: (text: string | null) => editor.setMessage(text),
  }), [editor])

  const run = useCallback((id: string, params: Record<string, unknown> = {}) => {
    const operator = getOperator(id)
    if (operator?.modal) {
      const context = editor.operatorContext()
      const available = context ? operator.available(context) : 'There is no scene open.'
      if (available !== true) {
        editor.setMessage(available)
        return
      }
      // G, R and S open a transform session; the modelling gestures open their own; and anything
      // else modal — spin, screw, a knife replayed from the palette — runs with the numbers it
      // declares, which is the only thing a menu entry can mean.
      const transform = MODAL_MODES[id]
      if (transform) {
        if (!stage.current?.startTransform(transform)) editor.setMessage('Select something to move first.')
        return
      }
      if (isModalOperator(id) && stage.current?.beginModalOperator(id)) return
    }
    const aspect = viewportAspect()
    runOperator(id, { ...params, ...(aspect ? { aspect } : {}) })
    // ⇧D and ⌥D put the copy under the pointer and hand straight over to a move, as Blender does;
    // the frame's wait is for the copy to reach the document the session will read.
    if (id === 'object.duplicate' || id === 'object.duplicateLinked') {
      requestAnimationFrame(() => stage.current?.startTransform('move'))
    }
  }, [editor, runOperator, viewportAspect])

  /** Opening a file replaces the document, which means going to its own address. */
  const openFromDisk = useCallback(async () => {
    const opened = await file.openFromDisk()
    if (!opened) return
    saveSceneDocument(opened)
    window.location.assign(`/r/${opened.id}`)
  }, [file])

  /**
   * What a drop in the outliner means. The operators say what happens to *the selection*, which is
   * right for a keystroke and wrong for a drag: a drag names its own object and its own target. So
   * the operator is run against a selection made for it, without disturbing the person's own.
   */
  const reparent = useCallback((
    id: string,
    target: { parentId?: string | null; collectionId?: string; index?: number },
    keepTransform: boolean,
  ) => {
    if (target.parentId !== undefined) {
      if (target.parentId === null) {
        editor.runOperator('object.clearParent', { keepTransform }, { selection: { objectIds: [id], activeObjectId: id } })
        return
      }
      editor.runOperator(
        'object.parent',
        { keepTransform },
        { selection: { objectIds: [id, target.parentId], activeObjectId: target.parentId } },
      )
      return
    }
    if (target.collectionId !== undefined) {
      editor.runOperator(
        'object.moveToCollection',
        { collectionId: target.collectionId },
        { selection: { objectIds: [id], activeObjectId: id } },
      )
      return
    }
    if (target.index === undefined) return
    // Reordering is the list's own business: the document has no order but the order of the array.
    editor.editDocument((current) => {
      const from = current.objects.findIndex((object) => object.id === id)
      if (from < 0) return current
      const objects = [...current.objects]
      const [moved] = objects.splice(from, 1)
      objects.splice(Math.max(0, Math.min(objects.length, target.index!)), 0, moved!)
      return { ...current, objects }
    }, 'Reorder')
  }, [editor])

  /* --------------------------------------------------------------- keyboard */

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || !document) return
    // A running modal tool gets first refusal on every key: X constrains an axis, it does not delete.
    if (stage.current?.handleKey(event)) {
      event.preventDefault()
      return
    }
    const target = event.target
    const typing = target instanceof HTMLElement
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    /*
     * Tab toggles edit mode, as Blender's does — but only when the focus is in the viewport or
     * nowhere. A keyboard has one way of moving between the panels of a page, and taking it away
     * would make the whole editor a trap: whoever had reached the outliner could never leave it.
     */
    if (event.key === 'Tab' && holdsFocus()) return
    const binding = resolveKey(event, {
      mode: document.view.mode,
      selectMode: document.view.selectMode,
      preferences,
      typing,
    })
    if (!binding) return
    const action = binding.action

    if (action.kind === 'operator') {
      event.preventDefault()
      // Renaming needs a name, and a key cannot supply one: F2 asks for it.
      if (action.id === 'object.rename') {
        const active = editor.activeObject
        if (!active) editor.setMessage('Select an object first.')
        else setRenaming(active.name)
        return
      }
      // B, C and the lasso choose a tool rather than selecting nothing: the region operators are
      // run by the drag that follows, with what it covered, and running one from a key with no
      // region at all would clear the selection instead of starting a gesture.
      if (SELECT_TOOL_FOR.has(action.id)) {
        patchView({ tool: SELECT_TOOL_FOR.get(action.id)! })
        setAnnouncement(binding.label)
        return
      }
      // A pointer-driven operator opens a gesture rather than running once: the key starts an
      // extrusion, and the pointer says how far. The availability check still happens first, so a
      // refused operator says why instead of opening a tool that can do nothing.
      if (isModalOperator(action.id)) {
        const here = editor.operatorContext()
        const availability = here ? operatorAvailability(action.id, here) : true
        if (availability !== true) {
          editor.setMessage(availability)
          return
        }
        const hovered = stage.current?.hoveredElement()
        const started = stage.current?.beginModalOperator(
          action.id,
          hovered?.kind === 'edge' ? { edge: hovered.slot } : undefined,
        )
        if (started) {
          setAnnouncement(binding.label)
          return
        }
      }
      run(action.id, (action.params ?? {}) as Record<string, unknown>)
      setAnnouncement(binding.label)
      return
    }

    switch (action.id) {
      case 'undo':
        event.preventDefault()
        undo()
        setAnnouncement('Undo')
        return
      case 'redo':
        event.preventDefault()
        redo()
        setAnnouncement('Redo')
        return
      case 'palette':
        event.preventDefault()
        setPaletteOpen(true)
        return
      case 'keymapSheet':
        event.preventDefault()
        setKeymapOpen(true)
        return
      case 'redoPanel':
        event.preventDefault()
        setRedoExpanded((current) => !current)
        return
      case 'repeatLast':
        event.preventDefault()
        editor.repeatLastOperation()
        return
      case 'panel.toolbar':
        event.preventDefault()
        patchView({ panels: { ...panelsOf(document.view), toolbar: !panelsOf(document.view).toolbar } })
        return
      case 'panel.sidebar':
        event.preventDefault()
        patchView({ panels: { ...panelsOf(document.view), sidebar: !panelsOf(document.view).sidebar } })
        return
      case 'tool.cycleSelect': {
        event.preventDefault()
        const index = SELECT_TOOLS.indexOf(document.view.tool)
        patchView({ tool: SELECT_TOOLS[(index + 1) % SELECT_TOOLS.length]! })
        return
      }
      case 'mode.toggleEdit':
        event.preventDefault()
        run('mode.toggleEdit')
        return
      case 'view.xray':
        event.preventDefault()
        patchView({ xray: !document.view.xray })
        return
      case 'snap.toggle':
        event.preventDefault()
        patchView({ snapEnabled: !document.view.snapEnabled })
        return
      case 'proportional.toggle':
        event.preventDefault()
        patchView({ proportional: !document.view.proportional })
        return
      case 'proportional.connected':
        event.preventDefault()
        patchView({ proportional: true })
        editor.setMessage('Proportional editing measures through the edges.')
        return
      case 'proportional.falloff':
        event.preventDefault()
        setChoiceMenu({
          title: 'Falloff',
          at: stage.current?.pointerPage() ?? pointerCentre(),
          entries: FALLOFF_KINDS.map((kind) => ({
            id: kind,
            label: falloffLabel(kind),
            checked: document.view.proportionalFalloff === kind,
            run: () => patchView({ proportionalFalloff: kind }),
          })),
        })
        return
      case 'select.linkedPick': {
        event.preventDefault()
        const hovered = stage.current?.hoveredElement()
        if (!hovered) {
          editor.setMessage('Put the pointer over the part to select.')
          return
        }
        run('mesh.selectPick', { kind: hovered.kind, slot: hovered.slot, objectId: hovered.objectId })
        run('mesh.selectLinked')
        return
      }
      case 'tool.knife':
        event.preventDefault()
        patchView({ tool: 'knife' })
        return
      case 'file.save':
        event.preventDefault()
        void file.saveNow()
        return
      case 'file.saveAs':
        event.preventDefault()
        void file.saveAs()
        return
      case 'file.open':
        event.preventDefault()
        void openFromDisk()
        return
      case 'file.render':
        event.preventDefault()
        setRendering(true)
        return
      case 'escape':
        if (pie) {
          event.preventDefault()
          setPie(null)
        }
        return
      case 'pie.pivot':
      case 'pie.orientation':
        event.preventDefault()
        setPie({
          kind: action.id === 'pie.pivot' ? 'pivot' : 'orientation',
          at: stage.current?.pointerPage() ?? pointerCentre(),
        })
        return
      case 'menu.uv':
      case 'menu.extrude':
      case 'menu.merge':
      case 'menu.delete':
      case 'menu.split':
      case 'menu.separate':
      case 'menu.normals':
      case 'menu.vertex':
      case 'menu.edge':
      case 'menu.face': {
        event.preventDefault()
        const menu = POINTER_MENUS[action.id]
        if (menu) setPointerMenu({ title: menu.title, ids: menu.ids, at: stage.current?.pointerPage() ?? pointerCentre() })
        return
      }
      case 'add.menu':
        // ⇧A opens the Add menu where the pointer is, as Blender's does, filterable by typing.
        event.preventDefault()
        setAddAt(stage.current?.pointerPage() ?? pointerCentre())
        return
      case 'cursor.snapPie':
        event.preventDefault()
        setPie({ kind: 'snap', at: stage.current?.pointerPage() ?? pointerCentre() })
        return
      case 'pie.shading':
        event.preventDefault()
        setPie({ kind: 'shading', at: stage.current?.pointerPage() ?? pointerCentre() })
        return
      case 'pie.views':
        event.preventDefault()
        setPie({ kind: 'views', at: stage.current?.pointerPage() ?? pointerCentre() })
        return
      case 'favorites':
        event.preventDefault()
        setFavoritesAt(stage.current?.pointerPage() ?? pointerCentre())
        return
      case 'preferences':
        event.preventDefault()
        setPreferencesOpen(true)
        return
      case 'spacebar':
        event.preventDefault()
        if (preferences.spacebarAction === 'search') setPaletteOpen(true)
        else if (preferences.spacebarAction === 'tools') {
          patchView({ panels: { ...panelsOf(document.view), toolbar: !panelsOf(document.view).toolbar } })
        }
        else if (session) session.setPlaying(!session.isPlaying())
        return
      case 'anim.keyframe':
        event.preventDefault()
        setKeyframeAt(stage.current?.pointerPage() ?? pointerCentre())
        return
      case 'mode.pie':
        event.preventDefault()
        setPie({ kind: 'mode', at: stage.current?.pointerPage() ?? pointerCentre() })
        return
      default:
        return
    }
  }, [document, editor, file, openFromDisk, patchView, pie, preferences, redo, run, session, undo])

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  /* ---------------------------------------------------------------- render */

  if (!document) {
    return (
      <main id="main" className="library-main scroll-area">
        <StatusMessage tone="error">
          {exists ? 'That scene could not be read.' : 'That scene is not in this browser.'}
        </StatusMessage>
      </main>
    )
  }

  // Past the guard above, both are documents rather than maybes.
  const drawn = shown ?? document
  const counts = sceneCounts(drawn)
  const context = editor.operatorContext()
  const panels = panelsOf(document.view)
  const uvEditor = document.view.uv ?? DEFAULT_UV_EDITOR
  const sculpt = document.view.sculpt ?? DEFAULT_SCULPT_STATE
  const patchUv = (patch: Partial<UvEditorState>) => patchView({ uv: { ...uvEditor, ...patch } })
  const commands: SceneCommand[] = [
    ...sceneCommands({ context, runOperator: (id) => run(id) }),
    ...editorCommands({
      undo,
      redo,
      palette: () => setPaletteOpen(true),
      favorites: () => setFavoritesAt(stage.current?.pointerPage() ?? pointerCentre()),
      preferences: () => setPreferencesOpen(true),
      redoPanel: () => setRedoExpanded((current) => !current),
      keymapSheet: () => setKeymapOpen(true),
      repeatLast: () => editor.repeatLastOperation(),
      'panel.toolbar': () => patchView({ panels: { ...panels, toolbar: !panels.toolbar } }),
      'panel.sidebar': () => patchView({ panels: { ...panels, sidebar: !panels.sidebar } }),
      'panel.uv': () => patchUv({ open: !uvEditor.open }),
      'anim.keyframe': () => setKeyframeAt(stage.current?.pointerPage() ?? pointerCentre()),
      ...(session ? { 'anim.play': () => session.setPlaying(!session.isPlaying()) } : {}),
      'file.save': () => void file.saveNow(),
      'file.saveAs': () => void file.saveAs(),
      'file.open': () => void openFromDisk(),
    }),
  ]

  const contextEntries = menuEntries(CONTEXT_IDS, context, (id) => run(id)) as SceneMenuEntry[]

  /*
   * The Q menu: whatever was put on it, in the order it was added, as the commands they name.
   *
   * A favourite that no longer exists — an operator from a build that had it, a command renamed —
   * is simply not shown. It stays in the list, because a person who goes back to a build that has
   * it should find it where they left it.
   */
  const favoriteEntries: SceneMenuEntry[] = settings.favorites.flatMap((id) => {
    const command = commands.find((entry) => entry.id === id)
    return command ? [command as SceneMenuEntry] : []
  })

  const favorites: SceneFavoritesValue = {
    has: (id) => settings.favorites.includes(id),
    toggle: (id) => changeSettings(toggleFavorite(settings, id)),
  }

  /*
   * What the panels need to turn a field into a control. It is one context rather than a dozen
   * props because a field is written where it belongs — in its own panel — and threading the rig
   * through every component between here and a row would be a worse cost than a context.
   */
  const exposeContext: SceneExposeContextValue = {
    document,
    groups: document.rig?.groups ?? [],
    parameters: document.rig?.parameters ?? [],
    bindings: document.rig?.bindings ?? [],
    onExpose: expose,
    onUnbind: unbind,
    onGoToControl: goToControl,
    onDropParameter: dropParameter,
    animated: animatedParameters,
  }

  return (
    <SceneFavoritesContext.Provider value={favorites}>
    <SceneExposeContext.Provider value={exposeContext}>
    <ContextMenuRoot>
      <WorkspaceShell
        rigs={listRigs()}
        activeId={document.id}
        mainLabel="Viewport"
        navLabel="Objects"
        mobilePanel={mobilePanel}
        onMobilePanel={setMobilePanel}
        renderNavigation={({ compact, inert, onNavigate }) => (
          <SceneOutliner
            document={document}
            selection={selection}
            compact={compact}
            inert={inert}
            onNavigate={onNavigate}
            onSelect={selectObjects}
            onRename={editor.renameObject}
            onRenameCollection={(id, name) => editor.editDocument((current) => ({
              ...current,
              collections: current.collections.map((entry) => (entry.id === id ? { ...entry, name } : entry)),
            }), 'Rename collection')}
            onReparent={(id, target, keepTransform) => reparent(id, target, keepTransform)}
            onUpdateObject={(id, patch) => editor.updateObject(id, patch, 'Change object')}
            onUpdateCollection={(id, patch) => editor.editDocument((current) => ({
              ...current,
              collections: current.collections.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
            }), 'Change collection')}
            onRunOperator={run}
            onOpenTab={(next) => savePrefs(withTab(prefs, documentId, next))}
          />
        )}
        inspector={
          <SceneProperties
            document={document}
            selection={selection}
            selectedObjects={editor.selectedObjects}
            activeObject={editor.activeObject}
            mode={document.view.mode}
            tab={tab}
            onTab={(next) => savePrefs(withTab(prefs, documentId, next))}
            onActiveMaterialSlot={(slot) => editor.setSelection({ ...selection, activeMaterialSlot: slot })}
            controls={{
              session,
              mode,
              onMode,
              onAdd: addPlainControl,
              onRename: renameControl,
              onMove: moveControl,
              onRemove: deleteControl,
              onGoTo: goToBinding,
            }}
            onUpdateObject={editor.updateObject}
            onUpdateObjects={editor.updateObjects}
            onEditDocument={editor.editDocument}
            onRunOperator={(id, params) => run(id, params ?? {})}
            onGestureStart={() => editor.beginGesture('Change value')}
            onGestureEnd={() => editor.endGesture('Change value')}
            isOpen={(sectionId) => sectionIsOpen(prefs, sectionId)}
            onSection={(sectionId, open) => savePrefs(withSection(prefs, sectionId, open))}
            history={{
              steps: editor.historySteps,
              index: editor.historyIndex,
              onGoTo: editor.goToStep,
              versions: document.versions ?? [],
              onRestoreVersion: editor.restoreVersion,
              onDeleteVersion: editor.deleteVersion,
              onSaveVersion: editor.saveVersion,
            }}
          />
        }
      >
        <h1 className="visually-hidden">{document.name}</h1>
        <div
          className="scene-stage"
          id="main"
          tabIndex={-1}
          data-scene-theme={preferences.theme === 'paramrig' ? undefined : preferences.theme}
        >
          <div className="scene-titlebar">
            <SceneFileMenu
              name={document.name}
              file={file}
              versions={document.versions ?? []}
              onRename={editor.rename}
              onOpen={() => void openFromDisk()}
              onImport={(dropped) => void file.openFromDisk(dropped)}
              onImportModel={(picked) => void importModel(picked)}
              onExportModel={(format) => void exportModel(format)}
              onRender={() => setRendering(true)}
              onExport={file.downloadProject}
              onRevert={() => {
                const stored = getSceneDocument(documentId)
                if (stored) editor.editDocument(() => stored, 'Revert')
              }}
              onSaveVersion={editor.saveVersion}
              onRestoreVersion={editor.restoreVersion}
              onDeleteVersion={editor.deleteVersion}
            />
            <SceneHeader
              view={document.view}
              mode={document.view.mode}
              context={context}
              onRunOperator={run}
              onView={patchView}
              onMode={(next) => run(next === 'edit' ? 'mode.edit' : next === 'sculpt' ? 'mode.sculpt' : 'mode.object')}
              onCommand={(id) => commands.find((command) => command.id === id)?.run()}
              onSculpt={(patch) => patchView({ sculpt: { ...sculpt, ...patch } })}
            />
          </div>
          <div
            className="scene-body"
            data-uv={uvEditor.open ? 'open' : undefined}
            style={{ '--scene-uv-split': String(uvEditor.split) } as CSSProperties}
          >
            <div className="scene-area">
              <SceneStage
                document={drawn}
                keepKey={documentId}
                selection={selection}
                preferences={preferences}
                onView={setView}
                onModelDrop={(picked) => void importModel(picked)}
                onMaterialDrop={(materialId, objectId, faceId) => run('material.drop', {
                  materialId,
                  objectId,
                  faceId: faceId === null ? '' : String(faceId),
                })}
                onSelect={selectObjects}
                onRegionSelect={(ids, selectMode) => run('select.box', { ids, mode: selectMode })}
                operatorBridge={operatorBridge}
                toolOptions={toolOptions}
                onPickElement={(hit, pickMode) => {
                  if (!hit) {
                    run('mesh.selectPick', { slot: -1, extend: pickMode !== 'new' })
                    return
                  }
                  if (pickMode === 'loop' || pickMode === 'ring') {
                    run(pickMode === 'loop' ? 'mesh.selectLoop' : 'mesh.selectRing', { edge: hit.slot, extend: false })
                    return
                  }
                  run('mesh.selectPick', {
                    kind: hit.kind,
                    slot: hit.slot,
                    objectId: hit.objectId,
                    extend: pickMode === 'extend',
                    toggle: pickMode === 'toggle',
                  })
                }}
                onPolyBuild={(request) => run('mesh.polyBuild', request)}
                onRegionElements={(found, selectMode) => run('mesh.selectRegion', {
                  mode: selectMode,
                  found: [...found].map(([objectId, entry]) => ({
                    objectId,
                    vertices: [...entry.vertices],
                    edges: [...entry.edges],
                    faces: [...entry.faces],
                  })),
                })}
                onPlaceCursor={(position, normal) => run('cursor.place', { position, ...(normal ? { normal } : {}) })}
                onContextMenu={setContextAt}
                onAnnotate={(points) => editor.editDocument((current) => ({
                  ...current,
                  annotations: [...(current.annotations ?? []), { id: crypto.randomUUID(), color: ANNOTATION_COLOUR, width: 3, points }],
                }), 'Annotate', false)}
                onMeasure={(from, to) => editor.editDocument((current) => ({
                  ...current,
                  measurements: [...(current.measurements ?? []), { id: crypto.randomUUID(), from, to }],
                }), 'Measure', false)}
                onTransform={(patches) => editor.updateObjects(patches, 'Transform', false)}
                onEditDocument={(edit) => editor.editDocument(edit, 'Transform', false)}
                onGestureStart={editor.beginGesture}
                onGestureEnd={(label) => {
                  editor.endGesture(label)
                  /*
                   * Auto merge: vertices dropped onto one another are welded as the gesture ends, the
                   * way Blender's own option does it. It is off by default because a merge that
                   * nobody asked for is a merge nobody can see happening.
                   */
                  if (document.view.mode === 'edit' && preferences.autoMergeDistance > 0) {
                    runOperator('mesh.mergeByDistance', { distance: preferences.autoMergeDistance })
                  }
                }}
                onGestureCancel={editor.cancelGesture}
                sculpt={sculpt}
                onReady={(handle) => { stage.current = handle }}
                createViewport={createViewport}
                options={{
                  ...viewportOptions,
                  pixelScale: preferences.resolutionScale,
                  /*
                   * A phone draws at most one and a half device pixels for one of ours, and casts no
                   * shadows: both are the difference between a viewport that turns under a finger and
                   * one that stutters. Neither is a preference, because neither is a taste.
                   */
                  ...(coarsePointer ? { maxPixelRatio: 1.5, shadows: false } : {}),
                }}
              >
                <SceneHints />
              </SceneStage>

              <SceneTouchBar
                mode={document.view.mode}
                selectMode={document.view.selectMode}
                onMode={() => run('mode.toggleEdit')}
                onSelectMode={(kind) => run(`mode.select${kind === 'vertex' ? 'Vertex' : kind === 'edge' ? 'Edge' : 'Face'}`)}
                onRun={(id) => run(id)}
                onMore={(at) => setPointerMenu({ title: 'Mesh', ids: MESH_MENU, at })}
              />
              <SceneToolbar
                open={panels.toolbar}
                tool={document.view.mode === 'sculpt' ? sculpt.brush : document.view.tool}
                mode={document.view.mode}
                onTool={(tool) => {
                  if (document.view.mode === 'sculpt') patchView({ sculpt: { ...sculpt, brush: tool as SculptBrush } })
                  else patchView({ tool: tool as SceneTool })
                }}
                onClose={() => patchView({ panels: { ...panels, toolbar: false } })}
              />
              <SceneSidebar
                open={panels.sidebar}
                tab={panels.sidebarTab}
                onTab={(sidebarTab) => patchView({ panels: { ...panels, sidebarTab } })}
                onClose={() => patchView({ panels: { ...panels, sidebar: false } })}
                document={document}
                selection={selection}
                activeObject={editor.activeObject}
                selectedObjects={editor.selectedObjects}
                onUpdateObject={editor.updateObject}
                onEditDocument={editor.editDocument}
                onView={patchView}
                toolParams={toolOptions[TOOL_OPERATORS[document.view.tool] ?? ''] ?? {}}
                onToolParams={(params) => {
                  const id = TOOL_OPERATORS[document.view.tool]
                  if (id) setToolOptions((current) => ({ ...current, [id]: params }))
                }}
                onGestureStart={() => editor.beginGesture('Change value')}
                onGestureEnd={() => editor.endGesture('Change value')}
              />
              <SceneNavGizmo
                view={document.view}
                hasCamera={document.objects.some((object) => object.data.kind === 'camera' && object.data.active)}
                onAxis={(axis) => run(`view.${axis}`)}
                onOrbit={(dx, dy) => stage.current?.navigator?.orbit(dx, dy)}
                onPan={(dx, dy) => stage.current?.navigator?.pan(dx, dy)}
                onZoom={(delta) => stage.current?.navigator?.zoomBy(delta)}
                onToggleProjection={() => run('view.togglePerspective')}
                onCamera={() => run('view.camera')}
              />
              <SceneRedoPanel
                operation={editor.lastOperation
                  ? { operatorId: editor.lastOperation.operatorId, label: editor.lastOperation.label, params: editor.lastOperation.params }
                  : null}
                expanded={redoExpanded}
                onExpanded={setRedoExpanded}
                onAdjust={editor.adjustLastOperation}
              />
            </div>
            {uvEditor.open ? (
              <SceneSplitter
                label="Viewport and UV editor"
                value={uvEditor.split}
                onChange={(split) => patchUv({ split })}
                onReset={() => patchUv({ split: DEFAULT_UV_EDITOR.split })}
              />
            ) : null}
            {uvEditor.open ? (
              <Suspense fallback={<div className="scene-uv scene-uv--loading" aria-hidden="true" />}>
                <SceneUVEditor
                  document={drawn}
                  selection={selection}
                  uv={uvEditor}
                  onUv={patchUv}
                  onClose={() => patchUv({ open: false })}
                  onSelection={editor.setSelection}
                  onEditDocument={editor.editDocument}
                  onRunOperator={(id) => run(id)}
                  context={context}
                  onGestureStart={editor.beginGesture}
                  onGestureEnd={editor.endGesture}
                  onGestureCancel={editor.cancelGesture}
                />
              </Suspense>
            ) : null}
          </div>
          <SceneStatusBar
            document={document}
            selection={selection}
            counts={counts}
            message={editor.message}
            keymapHint={<SceneKeymapHint onOpen={() => setKeymapOpen(true)} />}
            {...(session && animated ? {
              animation: {
                frame: Math.round(session.displayPlayhead() * FPS),
                frames: Math.round(session.durationTime() * FPS),
                playing: session.isPlaying(),
                onPlay: (playing: boolean) => session.setPlaying(playing),
                onFrame: (frame: number) => session.setPlayhead(frame / FPS),
              },
            } : {})}
          />
        </div>
      </WorkspaceShell>

      <SceneRenderDialog document={drawn} open={rendering} onClose={() => setRendering(false)} />
      <EditorCommandPalette
        prefix="scene"
        commands={commands}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        recent={settings.recentCommands}
        onRun={(id) => changeSettings({ ...settings, recentCommands: withRecentCommand(settings.recentCommands, id) })}
      />
      {preferencesOpen ? (
        <Suspense fallback={null}>
          <ScenePreferencesDialog
            open
            onClose={() => setPreferencesOpen(false)}
            preferences={preferences}
            onChange={(patch) => changeSettings({ ...settings, preferences: { ...preferences, ...patch } })}
          />
        </Suspense>
      ) : null}
      <EditorModal prefix="scene" label="Keyboard" open={keymapOpen} onClose={() => setKeymapOpen(false)}>
        <KeymapSheet />
      </EditorModal>
      <EditorModal prefix="scene" label="Rename object" open={renaming !== null} onClose={() => setRenaming(null)}>
        <form
          className="scene-rename"
          onSubmit={(event) => {
            event.preventDefault()
            const name = renaming?.trim()
            setRenaming(null)
            if (name) run('object.rename', { name })
          }}
        >
          <label className="scene-rename__label" htmlFor="scene-rename-field">Name</label>
          <input
            id="scene-rename-field"
            className="scene-palette__input"
            value={renaming ?? ''}
            maxLength={120}
            autoFocus
            onChange={(event) => setRenaming(event.currentTarget.value)}
          />
          <div className="scene-rename__actions">
            <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button type="submit">Rename</Button>
          </div>
        </form>
      </EditorModal>
      {pie ? (
        <ScenePieMenu
          open
          at={pie.at}
          label={PIE_LABELS[pie.kind]}
          animate={preferences.pieAnimation}
          items={pieItems(pie.kind, context)}
          onPick={(id, params) => {
            setPie(null)
            if (pie.kind === 'pivot') patchView({ pivot: id as ViewState['pivot'] })
            else if (pie.kind === 'orientation') patchView({ orientation: id as ViewState['orientation'] })
            else if (pie.kind === 'shading') patchView({ shading: id as ViewState['shading'] })
            else if (pie.kind === 'mode') run(id === 'object' ? 'mode.object' : id === 'edit' ? 'mode.edit' : 'mode.sculpt')
            else run(id, params as OperatorParams | undefined)
          }}
          onClose={() => setPie(null)}
        />
      ) : null}
      {favoritesAt ? (
        <SceneMenu
          label="Quick favourites"
          entries={favoriteEntries}
          at={favoritesAt}
          open
          onOpenChange={(open) => { if (!open) setFavoritesAt(null) }}
        />
      ) : null}
      {pointerMenu ? (
        <SceneMenu
          label={pointerMenu.title}
          entries={menuEntries(pointerMenu.ids, context, (id) => run(id)) as SceneMenuEntry[]}
          at={pointerMenu.at}
          open
          onOpenChange={(open) => { if (!open) setPointerMenu(null) }}
        />
      ) : null}
      {choiceMenu ? (
        <SceneMenu
          label={choiceMenu.title}
          entries={choiceMenu.entries.map((entry) => ({
            id: entry.id,
            label: entry.label,
            checked: entry.checked,
            run: () => {
              entry.run()
              setChoiceMenu(null)
            },
          }))}
          at={choiceMenu.at}
          open
          onOpenChange={(open) => { if (!open) setChoiceMenu(null) }}
        />
      ) : null}
      {keyframeAt ? (
        <SceneMenu
          label="Insert keyframe"
          entries={KEY_CHANNELS.map((channel) => ({
            id: channel.id,
            label: channel.label,
            run: () => {
              setKeyframeAt(null)
              const object = editor.activeObject
              if (!object) {
                editor.setMessage('Select an object to key first.')
                return
              }
              const built = insertKeyframes(document, object, channel.id)
              if (typeof built === 'string') {
                editor.setMessage(built)
                return
              }
              /*
               * Saved at once rather than on the next idle: the controls a keyframe needs reach the
               * session through the stored manifest, so a keyframe on a channel that has just been
               * given a control would otherwise land on a control nobody had heard of yet.
               */
              editor.editDocument(() => built.document, 'Insert keyframe')
              saveSceneDocument(built.document)
              setPendingKeys(built.entries)
            },
          }))}
          at={keyframeAt}
          open
          onOpenChange={(open) => { if (!open) setKeyframeAt(null) }}
        />
      ) : null}
      {addAt ? (
        <SceneMenu
          label="Add"
          entries={addEntries(context, run)}
          at={addAt}
          open
          onOpenChange={(open) => { if (!open) setAddAt(null) }}
        />
      ) : null}
      {contextAt ? (
        <SceneMenu
          label="Object"
          entries={contextEntries}
          at={contextAt}
          open
          onOpenChange={(open) => { if (!open) setContextAt(null) }}
        />
      ) : null}
      <LiveRegion name="scene" message={announcement} />
    </ContextMenuRoot>
    </SceneExposeContext.Provider>
    </SceneFavoritesContext.Provider>
  )
}

/** The falloff curves, as a person reads them in the ⇧O menu. */
function falloffLabel(kind: FalloffKind): string {
  if (kind === 'inverse-square') return 'Inverse square'
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

function panelsOf(view: ViewState): NonNullable<ViewState['panels']> {
  return view.panels ?? { toolbar: true, sidebar: false, sidebarTab: 'item' }
}

/** Where a pie opens when it is called from the keyboard rather than the pointer. */
function pointerCentre(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

const PIVOT_ITEMS: ScenePieItem[] = [
  { id: 'bounding-box', label: 'Bounding box centre', icon: 'pivot-bounding-box' },
  { id: 'cursor', label: '3D cursor', icon: 'pivot-cursor' },
  { id: 'individual', label: 'Individual origins', icon: 'pivot-individual' },
  { id: 'median', label: 'Median point', icon: 'pivot-median' },
  { id: 'active', label: 'Active element', icon: 'pivot-active' },
]

const ORIENTATION_ITEMS: ScenePieItem[] = [
  { id: 'global', label: 'Global', icon: 'orientation-global' },
  { id: 'local', label: 'Local', icon: 'orientation-local' },
  { id: 'normal', label: 'Normal', icon: 'orientation-normal' },
  { id: 'gimbal', label: 'Gimbal', icon: 'orientation-gimbal' },
  { id: 'view', label: 'View', icon: 'orientation-view' },
  { id: 'cursor', label: 'Cursor', icon: 'orientation-cursor' },
]

const SHADING_ITEMS: ScenePieItem[] = [
  { id: 'wireframe', label: 'Wireframe', icon: 'shading-wireframe' },
  { id: 'solid', label: 'Solid', icon: 'shading-solid' },
  { id: 'material', label: 'Material preview', icon: 'shading-material' },
  { id: 'rendered', label: 'Rendered', icon: 'shading-rendered' },
]

const MODE_ITEMS: ScenePieItem[] = [
  { id: 'object', label: 'Object mode' },
  { id: 'edit', label: 'Edit mode', disabled: true, reason: 'Edit mode arrives with the mesh editing prompt.' },
  { id: 'sculpt', label: 'Sculpt mode' },
]

/**
 * The `~` pie: the six axis views and the camera, at the angles the numpad puts them.
 *
 * The positions are Blender's, which is the whole point of a pie — top at the top, front at the
 * bottom, left on the left. Learning the gesture once should mean knowing it in both editors.
 */
const VIEW_ITEMS: ScenePieItem[] = [
  { id: 'view.top', label: 'Top' },
  { id: 'view.right', label: 'Right' },
  { id: 'view.camera', label: 'Camera' },
  { id: 'view.back', label: 'Back' },
  { id: 'view.bottom', label: 'Bottom' },
  { id: 'view.left', label: 'Left' },
  { id: 'view.frameAll', label: 'Frame all' },
  { id: 'view.front', label: 'Front' },
]

const PIE_LABELS: Record<PieKind, string> = {
  pivot: 'Pivot point',
  orientation: 'Transform orientation',
  shading: 'Viewport shading',
  snap: 'Snap',
  mode: 'Mode',
  views: 'View',
}

function pieItems(kind: PieKind, context: OperatorContext | null): ScenePieItem[] {
  if (kind === 'pivot') return PIVOT_ITEMS
  if (kind === 'orientation') return ORIENTATION_ITEMS
  if (kind === 'shading') return SHADING_ITEMS
  if (kind === 'mode') return MODE_ITEMS
  if (kind === 'views') {
    return VIEW_ITEMS.map((item) => {
      const operator = getOperator(item.id)
      const availability = operator && context ? operator.available(context) : true
      return { ...item, ...(availability === true ? {} : { disabled: true, reason: availability }) }
    })
  }
  /*
   * The snap pie is the operators themselves, so what it offers and what it refuses come from them.
   *
   * Blender's pie carries "Selection to cursor" twice — the fourth slice keeps the offset and the
   * eighth does not — which here is one operator at two settings. The last slice therefore names
   * its own parameters and says so in its label, rather than being a second copy of the fourth.
   */
  return SNAP_PIE.map((id, position) => {
    const operator = getOperator(id)
    const availability = operator && context ? operator.available(context) : true
    const flattened = id === 'cursor.selectionToCursor' && position === SNAP_PIE.length - 1
    return {
      id,
      label: flattened ? 'Selection to cursor, all on it' : operator?.label ?? id,
      ...(flattened ? { params: { keepOffset: false } } : {}),
      ...(operator?.icon ? { icon: operator.icon } : {}),
      ...(availability === true ? {} : { disabled: true, reason: availability }),
    }
  })
}

/** The ⇧A menu: the Add sections, in Blender's order, with a rule between them. */
function addEntries(context: OperatorContext | null, run: (id: string) => void): SceneMenuEntry[] {
  const entries: SceneMenuEntry[] = []
  for (const section of ADD_MENU) {
    if (entries.length) entries.push({ separator: true })
    entries.push(...menuEntries(section.items, context, run) as SceneMenuEntry[])
  }
  return entries
}

/** The keymap, as the F1 sheet shows it: generated from the table, so it cannot go out of date. */
function KeymapSheet() {
  const sections = describeKeymap()
  return (
    <div className="scene-keymap scroll-area">
      <h2 className="scene-keymap__title">Keyboard</h2>
      {sections.map((section) => (
        <section key={section.title} className="scene-keymap__section">
          <h3>{section.title}</h3>
          <ul>
            {section.entries.map((entry) => (
              <li key={`${entry.shortcut}-${entry.label}`}>
                <kbd>{entry.shortcut}</kbd>
                <span className="scene-keymap__label">{entry.label}</span>
                {entry.note ? <span className="scene-keymap__note">{entry.note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
