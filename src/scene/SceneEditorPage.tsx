import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorCommandPalette } from '@/editor/EditorCommandPalette'
import { EditorModal } from '@/editor/EditorModal'
import { LiveRegion } from '@/editor/LiveRegion'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
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
import type { SceneTool, ViewState } from '@/scene/types'
import type { TransformMode } from '@/scene/transform/session'
import type { SceneViewport, SceneViewportOptions } from '@/scene/viewport/SceneViewport'
import '@/scene/operators'

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

  const run = useCallback((id: string, params: Record<string, unknown> = {}) => {
    const operator = getOperator(id)
    if (operator?.modal) {
      const transform = MODAL_MODES[id]
      const context = editor.operatorContext()
      const available = context ? operator.available(context) : 'There is no scene open.'
      if (!transform || available !== true) {
        editor.setMessage(available === true ? 'That tool is not available here.' : available)
        return
      }
      if (!stage.current?.startTransform(transform)) editor.setMessage('Select something to move first.')
      return
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
        editor.setMessage('Edit mode arrives with the mesh editing prompt.')
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
              onMode={() => editor.setMessage('Edit mode arrives with the mesh editing prompt.')}
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
              onGestureStart={editor.beginGesture}
              onGestureEnd={editor.endGesture}
              onGestureCancel={editor.cancelGesture}
              onReady={(handle) => { stage.current = handle }}
              createViewport={createViewport}
              options={viewportOptions}
            >
              <SceneHints />
            </SceneStage>
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
            else if (pie.kind === 'mode') editor.setMessage('Edit mode arrives with the mesh editing prompt.')
            else run(id)
          }}
          onClose={() => setPie(null)}
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
