import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorCommandPalette } from '@/editor/EditorCommandPalette'
import { EditorModal } from '@/editor/EditorModal'
import { LiveRegion } from '@/editor/LiveRegion'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { Button } from '@/ui/Button'
import { StatusMessage } from '@/ui/StatusMessage'
import { ContextMenuRoot } from '@/ui/ContextMenu'
import { editorCommands, menuEntries, sceneCommands, type SceneCommand } from '@/scene/commands'
import { getSceneDocument, sceneCounts, saveSceneDocument } from '@/scene/document'
import { describeKeymap, resolveKey } from '@/scene/keymap'
import { getOperator } from '@/scene/operators/registry'
import {
  isOpen as sectionIsOpen,
  readScenePrefs,
  tabOf,
  withSection,
  withTab,
  writeScenePrefs,
  DEFAULT_PREFERENCES,
  type SceneMode,
} from '@/scene/prefs'
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
import { SceneStatusBar } from '@/scene/SceneStatusBar'
import { SceneToolbar } from '@/scene/SceneToolbar'
import { useSceneDocument } from '@/scene/useSceneDocument'
import { useSceneFile } from '@/scene/useSceneFile'
import type { SceneDocument, SceneSelection, SceneTool, ViewState } from '@/scene/types'
import type { TransformMode } from '@/scene/transform/session'
import type { SceneViewport, SceneViewportOptions } from '@/scene/viewport/SceneViewport'
import '@/scene/operators'
import { operatorAvailability } from '@/scene/operators'
import { isModalOperator } from '@/scene/modalSpecs'
import { MESH_MENU, POINTER_MENUS, type MenuIds } from '@/scene/editMenus'
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

/** B and C name a way of selecting, not a selection: the key picks up the tool. */
const SELECT_TOOL_FOR = new Map<string, SceneTool>([
  ['select.box', 'select-box'],
  ['select.circle', 'select-circle'],
  ['select.lasso', 'select-lasso'],
])

type PieKind = 'pivot' | 'orientation' | 'shading' | 'snap' | 'mode'
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
  const editor = useSceneDocument(documentId)
  const file = useSceneFile(editor.document)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')
  const [prefs, setPrefs] = useState(() => readScenePrefs())
  const [announcement, setAnnouncement] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [keymapOpen, setKeymapOpen] = useState(false)
  const [redoExpanded, setRedoExpanded] = useState(false)
  const [pie, setPie] = useState<Pie>(null)
  const [contextAt, setContextAt] = useState<{ x: number; y: number } | null>(null)
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null)
  /** A menu of operators opened at the pointer: ⌃F, M, X and the rest of Blender's edit menus. */
  const [pointerMenu, setPointerMenu] = useState<{ title: string; ids: MenuIds; at: { x: number; y: number } } | null>(null)
  /** A menu of plain choices — the falloff curves — which are settings rather than operators. */
  const [choiceMenu, setChoiceMenu] = useState<{
    title: string
    at: { x: number; y: number }
    entries: Array<{ id: string; label: string; checked: boolean; run: () => void }>
  } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const stage = useRef<SceneStageHandle | null>(null)
  const exists = useMemo(() => getSceneDocument(documentId) !== null, [documentId])
  const preferences = prefs.preferences ?? DEFAULT_PREFERENCES

  const { document, selection, selectObjects, setView, undo, redo, runOperator } = editor
  const tab = tabOf(prefs, documentId)

  const savePrefs = useCallback((next: typeof prefs) => {
    setPrefs(next)
    writeScenePrefs(next)
  }, [])

  const patchView = useCallback((patch: Partial<ViewState>) => {
    setView((current) => ({ ...current, ...patch }))
  }, [setView])

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
      case 'mode.pie':
        event.preventDefault()
        setPie({ kind: 'mode', at: stage.current?.pointerPage() ?? pointerCentre() })
        return
      default:
        return
    }
  }, [document, editor, file, openFromDisk, patchView, pie, preferences, redo, run, undo])

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

  void mode
  void onMode

  const counts = sceneCounts(document)
  const context = editor.operatorContext()
  const panels = panelsOf(document.view)
  const commands: SceneCommand[] = [
    ...sceneCommands({ context, runOperator: (id) => run(id) }),
    ...editorCommands({
      undo,
      redo,
      palette: () => setPaletteOpen(true),
      redoPanel: () => setRedoExpanded((current) => !current),
      keymapSheet: () => setKeymapOpen(true),
      repeatLast: () => editor.repeatLastOperation(),
      'panel.toolbar': () => patchView({ panels: { ...panels, toolbar: !panels.toolbar } }),
      'panel.sidebar': () => patchView({ panels: { ...panels, sidebar: !panels.sidebar } }),
      'file.save': () => void file.saveNow(),
      'file.saveAs': () => void file.saveAs(),
      'file.open': () => void openFromDisk(),
    }),
  ]

  const contextEntries = menuEntries(CONTEXT_IDS, context, (id) => run(id)) as SceneMenuEntry[]

  return (
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
            tab={tab}
            onTab={(next) => savePrefs(withTab(prefs, documentId, next))}
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
          data-scene-theme={preferences.theme === 'blender-classic' ? 'blender-classic' : undefined}
        >
          <div className="scene-titlebar">
            <SceneFileMenu
              name={document.name}
              file={file}
              versions={document.versions ?? []}
              onRename={editor.rename}
              onOpen={() => void openFromDisk()}
              onImport={(dropped) => void file.openFromDisk(dropped)}
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
            />
          </div>
          <div className="scene-body">
            <SceneStage
              document={document}
              selection={selection}
              preferences={preferences}
              onView={setView}
              onSelect={selectObjects}
              onRegionSelect={(ids, selectMode) => run('select.box', { ids, mode: selectMode })}
              operatorBridge={operatorBridge}
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
              onGestureEnd={editor.endGesture}
              onGestureCancel={editor.cancelGesture}
              onReady={(handle) => { stage.current = handle }}
              createViewport={createViewport}
              options={viewportOptions}
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
              tool={document.view.tool}
              mode={document.view.mode}
              onTool={(tool) => patchView({ tool })}
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
          <SceneStatusBar
            document={document}
            selection={selection}
            counts={counts}
            message={editor.message}
            keymapHint={<SceneKeymapHint onOpen={() => setKeymapOpen(true)} />}
          />
        </div>
      </WorkspaceShell>

      <EditorCommandPalette prefix="scene" commands={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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
          items={pieItems(pie.kind, context)}
          onPick={(id) => {
            setPie(null)
            if (pie.kind === 'pivot') patchView({ pivot: id as ViewState['pivot'] })
            else if (pie.kind === 'orientation') patchView({ orientation: id as ViewState['orientation'] })
            else if (pie.kind === 'shading') patchView({ shading: id as ViewState['shading'] })
            else if (pie.kind === 'mode') run(id === 'object' ? 'mode.object' : id === 'edit' ? 'mode.edit' : 'mode.sculpt')
            else run(id)
          }}
          onClose={() => setPie(null)}
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
  { id: 'sculpt', label: 'Sculpt mode', disabled: true, reason: 'Sculpt mode arrives with the horizon prompt.' },
]

const PIE_LABELS: Record<PieKind, string> = {
  pivot: 'Pivot point',
  orientation: 'Transform orientation',
  shading: 'Viewport shading',
  snap: 'Snap',
  mode: 'Mode',
}

function pieItems(kind: PieKind, context: OperatorContext | null): ScenePieItem[] {
  if (kind === 'pivot') return PIVOT_ITEMS
  if (kind === 'orientation') return ORIENTATION_ITEMS
  if (kind === 'shading') return SHADING_ITEMS
  if (kind === 'mode') return MODE_ITEMS
  // The snap pie is the operators themselves, so what it offers and what it refuses come from them.
  return SNAP_PIE.map((id) => {
    const operator = getOperator(id)
    const availability = operator && context ? operator.available(context) : true
    return {
      id,
      label: operator?.label ?? id,
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
