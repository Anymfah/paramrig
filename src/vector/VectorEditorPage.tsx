import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { RigManifest } from '@/rigs/types'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { useRovingFocus } from '@/ui/useRovingFocus'
import { nodeAnnouncement, selectionAnnouncement, toolAnnouncement } from '@/vector/announce'
import { MAX_ZOOM, MIN_ZOOM, nextZoom } from '@/vector/measure'
import { readPrefs, updatePrefs } from '@/state/workspace'
import { IconButton } from '@/ui/Button'
import { IconBringForward, IconCheck, IconChevronRight, IconCopy, IconEyeOff, IconFlipH, IconFlipV, IconGrid, IconGroup, IconLock, IconNode, IconPaste, IconPencil, IconRotate90, IconSendBackward, IconTrash, IconUngroup, IconUnlock } from '@/ui/icons'
import { flipAffine, rotationAffine, transformElementAffine } from '@/vector/affine'
import { elementCenter } from '@/vector/geometry'
import { importSvg } from '@/vector/svgImport'
import { pastedBindings, readClipboardPayload, writeClipboardPayload } from '@/vector/clipboard'
import type { VectorCanvasController } from '@/vector/VectorCanvas'
import { Tooltip } from '@/ui/Tooltip'
import { alignElements, type AlignMode, type ElementPatch } from '@/vector/align'
import { createVectorDocument, createVectorElement, MAX_EXPORT_PRESETS } from '@/vector/document'
import { DEFAULT_EXPORT, embedFonts, exportBounds, exportFileName, exportMarkup, rasterize, type ExportSettings } from '@/vector/export'
import { VectorExportMenu } from '@/vector/VectorExportMenu'
import { ContextMenuRoot, ContextTarget, type ContextMenuItem } from '@/ui/ContextMenu'
import {
  appearanceOf,
  appearancePatch,
  fitBoxMap,
  matchingIds,
  nextSiblingId,
  opacityFromDigit,
  SHORTCUTS,
  type Appearance,
  type OpacityBuffer,
  type VectorCommand,
} from '@/vector/commands'
import { countedLabel } from '@/vector/history'
import { VectorCommandPalette } from '@/vector/VectorCommandPalette'
import { VectorRenameDialog } from '@/vector/VectorRenameDialog'
import { VectorRotateCopiesDialog, VectorTransformDialog } from '@/vector/VectorTransformDialog'
import { VectorTraceDialog } from '@/vector/VectorTraceDialog'
import { tracedElements } from '@/vector/traceImage'
import { brushFromElement } from '@/vector/brushes'
import { patternFromElement } from '@/vector/patterns'
import { componentFrom, detachInstance, instanceOf, resetOverrides } from '@/vector/instances'
import { summaryColor } from '@/vector/paints'
import { pathBounds, pathDataOf } from '@/vector/textPath'
import { exportPdf, pdfPages } from '@/vector/pdfExport'
import { serializeVectorMarkup } from '@/vector/document'
import { ensureFont, ensureFonts } from '@/vector/fontLoader'
import { boxBounds, boxCenter, copyAngles, IDENTITY_TRANSFORM, numericPatches, rotatedCopyPatches, type NumericTransform } from '@/vector/repeat'
import { VectorFileMenu } from '@/vector/VectorFileMenu'
import { readInspectorPrefs, tabOf, withTab, writeInspectorPrefs, type InspectorTab } from '@/vector/inspectorPrefs'
import { ToolGroup, ZoomControl } from '@/vector/VectorToolbar'
import { DEFAULT_ENTRIES, groupOfTool, TOOL_GROUPS, type ToolGroupId } from '@/vector/toolGroups'
import { STAR_INNER_RATIO } from '@/vector/shapes'
import { colorAt, sampleDocument, type CanvasSample } from '@/vector/sampling'
import {
  applyStylePatch,
  detachStylePatch,
  pushRecentColor,
  styleFromElement,
  styleIdKey,
  syncStylePatches,
  toggleSwatch,
} from '@/vector/styles'
import type { PaintPalette } from '@/vector/VectorPaintPanel'
import { VectorSaveBadge } from '@/vector/VectorSaveBadge'
import { useProjectFile } from '@/vector/useProjectFile'
import { selectionBounds } from '@/vector/geometry'
import { booleanLabel, BOOLEAN_OPERATIONS, maskPatch } from '@/vector/booleanGroups'
import type { BooleanOperation } from '@/vector/booleans'
import { ancestorIds, childrenOf, descendantIds, groupElements, isContainer, leafElements, transformLeaves } from '@/vector/tree'
import { VectorCanvas, type VectorViewOptions } from '@/vector/VectorCanvas'
import { VectorSelectionBar } from '@/vector/VectorSelectionBar'
import { geometryOps } from '@/vector/geometryOps'
import { connectNodes, deleteNodes, toggleNodeSmooth, worldNetwork } from '@/vector/network'
import { VectorInspector } from '@/vector/VectorInspector'
import { VectorLayers } from '@/vector/VectorLayers'
import { documentAssets } from '@/vector/assets'
import { controlId, DEFAULT_RIG_GROUP, emptyRig, parameterForProperty, resolveRigValues, type VectorBinding, type VectorRig } from '@/vector/rig'
import { ExposeProvider, type ExposeRequest } from '@/vector/VectorExpose'
import { VectorControls } from '@/vector/VectorControls'
import { ensureSession } from '@/state/workspace'
import type { VectorMode } from '@/vector/inspectorPrefs'
import type { AssetActions } from '@/vector/VectorAssets'
import { DEFAULT_BRUSH_SETTINGS } from '@/vector/brushes'
import type { VectorElement, VectorFont, VectorNetwork, VectorPaint, VectorStyleKind, VectorTool } from '@/vector/types'
import { useVectorDocument } from '@/vector/useVectorDocument'

const ALIGN_KEYS: Record<string, AlignMode> = { KeyA: 'left', KeyH: 'centerX', KeyD: 'right', KeyW: 'top', KeyV: 'centerY', KeyS: 'bottom' }

export function VectorEditorPage({ manifest, mode = 'edit', onMode }: {
  manifest: RigManifest
  mode?: VectorMode
  onMode?: (mode: VectorMode) => void
}) {
  const navigate = useNavigate()
  const editor = useVectorDocument(manifest.id)
  const [tool, setTool] = useState<VectorTool>('select')
  /** Which tool each toolbar group is showing: the last one used in it. */
  const [groupEntry, setGroupEntry] = useState<Record<ToolGroupId, string>>(DEFAULT_ENTRIES)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [zoom, setZoom] = useState(() => {
    if (typeof window === 'undefined' || window.innerWidth >= 768) return 0.8
    return Math.max(0.25, Math.min(0.8, (window.innerWidth - 48) / 800))
  })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [viewOptions, setViewOptions] = useState<VectorViewOptions>({
    pixelPreview: 'off',
    pixelGrid: false,
    snapToPixelGrid: false,
    snapToObjects: true,
    snapToGuides: true,
    snapToNodes: true,
    layoutGuides: false,
    rulers: false,
    guides: true,
    minimap: false,
    outlines: 'off',
  })
  const controller = useRef<VectorCanvasController | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT)
  const [exportError, setExportError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** Which of the inspector's three tabs this document was left on. */
  const [inspectorTab, setInspectorTabState] = useState<InspectorTab>(() => tabOf(readInspectorPrefs(), manifest.id))
  const setInspectorTab = useCallback((next: InspectorTab) => {
    setInspectorTabState(next)
    writeInspectorPrefs(withTab(readInspectorPrefs(), manifest.id, next))
  }, [manifest.id])
  const [renameOpen, setRenameOpen] = useState(false)
  /** The navigation tool the menu offers first: whichever was used last. */
  const toolbarRef = useRef<HTMLDivElement>(null)
  useRovingFocus(toolbarRef)
  /** Read out to a screen reader: the selection, the nodes, the tool, the last history entry. */
  const [announcement, setAnnouncement] = useState('')
  /** The mesh knot the canvas has selected, so the inspector can offer its colour. */
  const [meshPoint, setMeshPoint] = useState<number | null>(null)
  const [traceOpen, setTraceOpen] = useState(false)
  const [transformOpen, setTransformOpen] = useState(false)
  const [rotateCopiesOpen, setRotateCopiesOpen] = useState(false)
  /** ⌘⇧T reopens the dialog on the values it was last applied with. */
  const lastTransform = useRef<NumericTransform>(IDENTITY_TRANSFORM)
  const appearanceClipboard = useRef<Appearance | null>(null)
  const elementClipboard = useRef<VectorElement[]>([])
  /** Mirrors what the clipboards hold, so the palette and menus can grey the right entries. */
  const [clipboard, setClipboard] = useState({ elements: 0, appearance: false })
  const opacityBuffer = useRef<OpacityBuffer | null>(null)
  const [sampler, setSampler] = useState<{ sample: CanvasSample; apply: (hex: string) => void } | null>(null)
  const restorePanels = useRef<{ nav: boolean; inspector: boolean } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  /** ⌘\ clears the panels away from the canvas, and puts them back as they were. */
  const togglePanels = useCallback(() => {
    const prefs = readPrefs()
    if (restorePanels.current) {
      updatePrefs({ navCollapsed: restorePanels.current.nav, inspectorCollapsed: restorePanels.current.inspector })
      restorePanels.current = null
      return
    }
    restorePanels.current = { nav: prefs.navCollapsed, inspector: prefs.inspectorCollapsed }
    updatePrefs({ navCollapsed: true, inspectorCollapsed: true })
  }, [])

  const toggleFullscreen = useCallback(() => {
    const stage = window.document.getElementById('main')
    if (!stage) return
    if (window.document.fullscreenElement) void window.document.exitFullscreen()
    else void stage.requestFullscreen?.().catch(() => undefined)
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(!!window.document.fullscreenElement)
    window.document.addEventListener('fullscreenchange', onChange)
    return () => window.document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const lastLayerClick = useRef<string | null>(null)
  const editorRef = useRef(editor)
  editorRef.current = editor
  const file = useProjectFile(editor.document)
  const fileRef = useRef(file)
  fileRef.current = file

  const document = editor.document
  const rig = document?.rig ?? null
  const session = rig ? ensureSession(manifest.id) : null
  useSyncExternalStore(
    useCallback((listener: () => void) => session?.subscribe(listener) ?? (() => undefined), [session]),
    () => session?.getRevision() ?? 0,
    () => 0,
  )
  const rigValues = session?.previewValues() ?? {}
  /** What is on screen: the document as its controls say. Editing still writes to the raw one. */
  const shown = document && rig ? resolveRigValues(document, rigValues) : document
  const selectedIds = editor.selectedIds
  const selectedElements = editor.selectedElements
  /** What the inspector describes: the objects as they are drawn, so a driven field reads true. */
  const shownSelection = shown === document
    ? selectedElements
    : selectedElements.map((element) => shown?.elements.find((item) => item.id === element.id) ?? element)
  const canUngroup = selectedElements.some((element) => element.kind === 'group')
  /** Tools that need one editable object under them, and say so by going quiet without it. */
  const nodeEditable = selectedIds.length === 1 && selectedElements[0] && selectedElements[0].kind !== 'group' && selectedElements[0].kind !== 'text' && !selectedElements[0].locked
  const disabledEntries = [
    ...(nodeEditable ? [] : ['node']),
    ...(selectedIds.length === 1 ? [] : ['scissors', 'width']),
  ]
  const allLocked = selectedElements.length > 0 && selectedElements.every((element) => element.locked)

  const chooseTool = useCallback((next: VectorTool, entryId?: string) => {
    setTool(next)
    const group = groupOfTool(next)
    if (!group) return
    const entry = entryId ?? TOOL_GROUPS.find((item) => item.id === group)!.tools.find((item) => item.tool === next)?.id
    if (entry) setGroupEntry((current) => current[group] === entry ? current : { ...current, [group]: entry })
  }, [])

  const group = useCallback(() => {
    const current = editorRef.current
    if (current.selectedIds.length === 0) return
    const id = current.groupSelection(current.selectedIds)
    if (id) {
      current.setSelectedIds([id])
      current.setEnteredGroupId(null)
    }
  }, [])

  const ungroup = useCallback(() => {
    const current = editorRef.current
    const groups = current.selectedElements.filter((element) => element.kind === 'group')
    if (groups.length === 0) return
    const children = groups.flatMap((element) => childrenOf(current.document?.elements ?? [], element.id).map((child) => child.id))
    current.ungroup(groups.map((element) => element.id))
    current.setSelectedIds(children)
  }, [])

  const transformSelection = useCallback((build: (center: { x: number; y: number }) => ReturnType<typeof flipAffine>, label = 'Transform') => {
    const current = editorRef.current
    const doc = current.document
    if (!doc || current.selectedIds.length === 0) return
    const leaves = transformLeaves(doc.elements, current.selectedIds).filter((element) => !element.locked)
    if (leaves.length === 0) return
    const center = elementCenter(selectionBounds(leafElements(doc.elements, current.selectedIds)))
    const map = build(center)
    current.updateElements(leaves.map((leaf) => ({ id: leaf.id, patch: transformElementAffine(leaf, map) })), true, label)
  }, [])

  /** The numeric Transform dialog: one move, scale, turn and flip in a single undo entry. */
  const applyNumericTransform = useCallback((transform: NumericTransform) => {
    const current = editorRef.current
    const doc = current.document
    if (!doc || current.selectedIds.length === 0) return
    const leaves = transformLeaves(doc.elements, current.selectedIds).filter((element) => !element.locked)
    if (leaves.length === 0) return
    lastTransform.current = transform
    const center = boxCenter(boxBounds(leafElements(doc.elements, current.selectedIds)))
    current.updateElements(numericPatches(leaves, transform, center), true, 'Transform')
  }, [])

  /** Copies swung around the pivot: one undo entry for the whole ring. */
  const applyRotateCopies = useCallback((count: number, total: number) => {
    const current = editorRef.current
    const doc = current.document
    if (!doc || current.selectedIds.length === 0) return
    const ids = current.selectedIds
    const originals = transformLeaves(doc.elements, ids).filter((element) => !element.locked)
    if (originals.length === 0) return
    const pivot = controller.current?.pivot() ?? boxCenter(boxBounds(leafElements(doc.elements, ids)))
    const angles = copyAngles(count, total)
    current.beginGesture(countedLabel('Rotate', angles.length, 'copy'))
    for (const angle of angles) {
      const { idMap } = current.duplicateElements(ids, 0)
      // The copies land on the originals, so their patches can be worked out from the originals.
      current.updateElements(rotatedCopyPatches(originals, angle, pivot).map((patch) => ({ id: idMap[patch.id] ?? patch.id, patch: patch.patch })), false)
    }
    current.endGesture(countedLabel('Rotate', angles.length, 'copy'))
    current.clearRepeat()
  }, [])

  /** Applies a font to the selected texts, registering it with the document when it is new. */
  const pickFont = useCallback((family: string, source: 'system' | 'google' | 'file' | 'app') => {
    const current = editorRef.current
    const doc = current.document
    if (!doc) return
    const texts = current.selectedElements.filter((element) => element.kind === 'text')
    if (texts.length === 0) return
    const known = (doc.fonts ?? []).find((font) => font.family === family)
    const font: VectorFont | null = known ?? (source === 'google' ? { family, source: 'google', weights: [400] } : null)
    current.editDocument((state) => ({
      ...state,
      ...(font && !(state.fonts ?? []).some((item) => item.family === family) ? { fonts: [...(state.fonts ?? []), font] } : {}),
      elements: state.elements.map((element) => texts.some((text) => text.id === element.id) ? { ...element, fontFamily: family } : element),
    }), true, `Set font ${family}`)
    // The face has to reach the page before the canvas can draw with it.
    if (font) void ensureFont(font)
  }, [])

  const importFont = useCallback((font: VectorFont) => {
    const current = editorRef.current
    const doc = current.document
    if (!doc) return
    const texts = current.selectedElements.filter((element) => element.kind === 'text')
    current.editDocument((state) => ({
      ...state,
      fonts: [...(state.fonts ?? []).filter((item) => item.family !== font.family), font],
      elements: state.elements.map((element) => texts.some((text) => text.id === element.id) ? { ...element, fontFamily: font.family } : element),
    }), true, `Import font ${font.family}`)
    void ensureFont(font)
  }, [])

  /** Drops an instance of a component in the middle of the view, or at a point on the canvas. */
  const placeComponent = useCallback((componentId: string, at?: { x: number; y: number }) => {
    const current = editorRef.current
    const doc = current.document
    if (!doc) return
    const master = doc.elements.find((element) => element.id === componentId && element.kind === 'component')
    if (!master) return
    const instance = instanceOf(master, crypto.randomUUID(), at ?? { x: doc.width / 2, y: doc.height / 2 })
    current.addElement(instance)
  }, [])

  /** Wraps the selection in a component: the master everything else copies. */
  const createComponent = useCallback(() => {
    const current = editorRef.current
    const doc = current.document
    if (!doc || current.selectedIds.length === 0) return
    const id = crypto.randomUUID()
    const existing = doc.elements.filter((element) => element.kind === 'component').length
    const name = current.selectedElements.length === 1 ? current.selectedElements[0]!.name : `Component ${existing + 1}`
    current.editElements((elements) => componentFrom(elements, current.selectedIds, id, name)?.elements ?? elements, true, 'Create component')
    current.setSelectedIds([id])
  }, [])

  /** Turns the selected path into a brush the document keeps, and stamps the selection with it. */
  const defineBrush = useCallback((element: VectorElement) => {
    const current = editorRef.current
    const doc = current.document
    if (!doc) return
    const existing = doc.brushes ?? []
    let name = `Brush ${existing.length + 1}`
    while (existing.some((brush) => brush.name === name)) name = `${name}'`
    const brush = brushFromElement(element, name, crypto.randomUUID())
    if (!brush) return
    current.editDocument((state) => ({ ...state, brushes: [...(state.brushes ?? []), brush] }), true, `Define brush “${brush.name}”`)
  }, [])

  const pasteElements = useCallback((elements: VectorElement[], offset = 0, parent?: string, bindings: VectorBinding[] = []): string[] => {
    const current = editorRef.current
    if (!current.document || elements.length === 0) return []
    const idMap = new Map(elements.map((element) => [element.id, crypto.randomUUID()]))
    const copies = elements.map((element): VectorElement => {
      const { parentId, ...rest } = element
      const mapped = parentId && idMap.has(parentId) ? idMap.get(parentId)! : parent ?? current.enteredGroupId ?? undefined
      const moved = element.kind !== 'group' ? { x: element.x + offset, y: element.y + offset } : {}
      return { ...rest, ...moved, id: idMap.get(element.id)!, ...(mapped ? { parentId: mapped } : {}) }
    })
    // A copy keeps whatever bindings this document already has the controls for.
    const kept = bindings.length && current.document.rig
      ? pastedBindings(bindings, Object.fromEntries(idMap), new Set(current.document.rig.parameters.map((parameter) => parameter.id)))
      : []
    if (kept.length) {
      current.editDocument((state) => ({
        ...state,
        elements: [...state.elements, ...copies],
        rig: state.rig ? { ...state.rig, bindings: [...state.rig.bindings, ...kept] } : state.rig,
      }), true, 'Paste')
    } else {
      current.addElements(copies, true, 'Paste')
    }
    return copies.map((element) => element.id)
  }, [])

  const importFile = useCallback(async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    const elements = importSvg(text, { currentColor: '#D4E7E1' })
    if (elements.length === 0) return
    const current = editorRef.current
    if (elements.length === 1) {
      pasteElements(elements)
      return
    }
    const group = createVectorElement('group', { x: 0, y: 0, width: 1, height: 1 }, { name: file.name.replace(/\.svg$/i, '') || 'Import' })
    if (current.enteredGroupId) group.parentId = current.enteredGroupId
    const idMap = new Map(elements.map((element) => [element.id, crypto.randomUUID()]))
    const copies = elements.map((element): VectorElement => ({ ...element, id: idMap.get(element.id)!, parentId: group.id }))
    current.editElements((all) => [...all, ...copies, group])
    current.setSelectedIds([group.id])
  }, [pasteElements])

  const openProject = useCallback(async (picked?: File) => {
    const opened = await fileRef.current.openFromDisk(picked)
    if (opened) navigate(`/r/${opened.id}`)
  }, [navigate])

  const requestOpen = useCallback(() => {
    if (typeof window.showOpenFilePicker === 'function') void openProject()
    else projectInput.current?.click()
  }, [openProject])

  const newDocument = useCallback(() => {
    navigate(`/r/${createVectorDocument().id}`)
  }, [navigate])

  /** Elements a copy covers: the selection plus everything under it. */
  const selectionBlock = useCallback((): VectorElement[] => {
    const current = editorRef.current
    const doc = current.document
    if (!doc || current.selectedIds.length === 0) return []
    const ids = new Set(current.selectedIds.flatMap((id) => [id, ...descendantIds(doc.elements, id)]))
    return doc.elements.filter((element) => ids.has(element.id))
  }, [])

  const copySelection = useCallback((cut: boolean) => {
    const block = selectionBlock()
    if (block.length === 0) return
    elementClipboard.current = structuredClone(block)
    setClipboard((current) => ({ ...current, elements: block.length }))
    if (cut) editorRef.current.removeElements(editorRef.current.selectedIds)
  }, [selectionBlock])

  const pasteStored = useCallback(() => {
    const ids = pasteElements(elementClipboard.current, 12)
    if (ids.length) editorRef.current.setSelectedIds(ids)
  }, [pasteElements])

  const copyAppearance = useCallback(() => {
    const source = editorRef.current.selectedElements.find((element) => element.kind !== 'group')
    if (!source) return
    appearanceClipboard.current = appearanceOf(source)
    setClipboard((current) => ({ ...current, appearance: true }))
  }, [])

  const pasteAppearance = useCallback(() => {
    const appearance = appearanceClipboard.current
    const current = editorRef.current
    if (!appearance || current.selectedIds.length === 0) return
    const targets = leafElements(current.document?.elements ?? [], current.selectedIds).filter((element) => !element.locked)
    if (targets.length === 0) return
    current.updateElements(targets.map((element) => ({ id: element.id, patch: appearancePatch(appearance) })), true, 'Paste properties')
  }, [])

  /**
   * Drops the copied objects into the space the selection occupied: scaled to fit its box,
   * keeping their shape, at the same place in the stack, in one undo step.
   */
  const pasteToReplace = useCallback(() => {
    const current = editorRef.current
    const doc = current.document
    const clipboard = elementClipboard.current
    if (!doc || clipboard.length === 0 || current.selectedIds.length === 0) return
    const targets = leafElements(doc.elements, current.selectedIds)
    const sources = clipboard.filter((element) => element.kind !== 'group')
    if (targets.length === 0 || sources.length === 0) return
    const map = fitBoxMap(selectionBounds(sources), selectionBounds(targets))
    const parent = doc.elements.find((element) => element.id === current.selectedIds[0])?.parentId
    const idMap = new Map(clipboard.map((element) => [element.id, crypto.randomUUID()]))
    const copies = clipboard.map((element): VectorElement => {
      const { parentId, ...rest } = element
      const mapped = parentId && idMap.has(parentId) ? idMap.get(parentId)! : parent
      return { ...rest, ...transformElementAffine(element, map), id: idMap.get(element.id)!, ...(mapped ? { parentId: mapped } : {}) }
    })
    const removed = new Set(current.selectedIds.flatMap((id) => [id, ...descendantIds(doc.elements, id)]))
    current.editElements((elements) => {
      const anchor = Math.max(...current.selectedIds.map((id) => elements.findIndex((element) => element.id === id)))
      const rest = elements.filter((element) => !removed.has(element.id))
      const at = rest.findIndex((element) => elements.indexOf(element) > anchor)
      const index = at < 0 ? rest.length : at
      return [...rest.slice(0, index), ...copies, ...rest.slice(index)]
    }, true, 'Paste to replace')
    current.setSelectedIds(copies.filter((copy) => !copy.parentId || !copies.some((other) => other.id === copy.parentId)).map((copy) => copy.id))
  }, [])

  const order = useCallback((mode: 'forward' | 'backward' | 'front' | 'back') => {
    const current = editorRef.current
    if (current.selectedIds.length === 0) return
    current.orderElements(current.selectedIds, mode)
  }, [])

  const walkSiblings = useCallback((direction: 1 | -1) => {
    const current = editorRef.current
    const doc = current.document
    if (!doc) return
    const next = nextSiblingId(doc.elements, current.selectedIds.at(-1) ?? null, current.enteredGroupId, direction)
    if (next) current.setSelectedIds([next])
  }, [])

  const setOpacity = useCallback((digit: string) => {
    const current = editorRef.current
    if (current.selectedIds.length === 0) return
    const { opacity, buffer } = opacityFromDigit(opacityBuffer.current, digit, Date.now())
    opacityBuffer.current = buffer
    current.updateElements(current.selectedElements.filter((element) => !element.locked).map((element) => ({ id: element.id, patch: { opacity } })), true, 'Change opacity')
  }, [])

  const selectSame = useCallback((key: 'fill' | 'stroke' | 'strokeWidth') => {
    const current = editorRef.current
    const doc = current.document
    const reference = current.selectedElements.find((element) => element.kind !== 'group')
    if (!doc || !reference) return
    current.setSelectedIds(matchingIds(doc.elements, reference, key))
  }, [])

  const toggleMask = useCallback(() => {
    const current = editorRef.current
    const patches = maskPatch(current.document?.elements ?? [], current.selectedIds)
    if (patches.length === 0) return
    current.updateElements(patches, true, patches[0]!.patch.mask ? 'Use as mask' : 'Remove mask')
  }, [])

  const alignSelection = useCallback((mode: AlignMode) => {
    const current = editorRef.current
    const doc = current.document
    if (!doc || current.selectedElements.length === 0) return
    const leaves = leafElements(doc.elements, current.selectedIds)
    const target = current.selectedElements.length > 1 && leaves.length ? selectionBounds(leaves) : { x: 0, y: 0, width: doc.width, height: doc.height }
    current.updateElements(expandMoves(doc.elements, alignElements(current.selectedElements, mode, target)), true, 'Align')
  }, [])

  useEffect(() => {
    const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)
    const onCopy = (event: ClipboardEvent, cut: boolean) => {
      if (editable(event.target)) return
      const current = editorRef.current
      const doc = current.document
      if (!doc || current.selectedIds.length === 0) return
      const ids = new Set(current.selectedIds.flatMap((id) => [id, ...leafElements(doc.elements, [id]).map((leaf) => leaf.id), ...doc.elements.filter((element) => element.parentId === id).map((element) => element.id)]))
      const elements = doc.elements.filter((element) => ids.has(element.id) || (element.parentId && ids.has(element.parentId)))
      event.preventDefault()
      writeClipboardPayload(event.clipboardData, elements, doc)
      elementClipboard.current = structuredClone(elements)
      setClipboard((value) => ({ ...value, elements: elements.length }))
      if (cut) current.removeElements(current.selectedIds)
    }
    const onPaste = (event: ClipboardEvent) => {
      if (editable(event.target)) return
      const pictures = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'))
      if (pictures.length > 0) {
        event.preventDefault()
        void controller.current?.addImages(pictures)
        return
      }
      const payload = readClipboardPayload(event.clipboardData)
      if (!payload) {
        // Nothing readable on the system clipboard: fall back to what a menu copy stored.
        if (elementClipboard.current.length === 0) return
        event.preventDefault()
        pasteStored()
        return
      }
      event.preventDefault()
      pasteElements(payload.elements, payload.source === 'internal' ? 12 : 0, undefined, payload.bindings)
    }
    const copyHandler = (event: ClipboardEvent) => onCopy(event, false)
    const cutHandler = (event: ClipboardEvent) => onCopy(event, true)
    window.document.addEventListener('copy', copyHandler)
    window.document.addEventListener('cut', cutHandler)
    window.document.addEventListener('paste', onPaste)
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return
      const current = editorRef.current
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (meta && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) current.redo()
        else current.undo()
        return
      }
      if (meta && key === 's') {
        event.preventDefault()
        if (event.shiftKey) void fileRef.current.saveAs()
        else void fileRef.current.saveNow()
        return
      }
      if (meta && key === 'o') {
        event.preventDefault()
        requestOpen()
        return
      }
      if (meta && (key === ']' || key === '[' || event.code === 'BracketRight' || event.code === 'BracketLeft')) {
        event.preventDefault()
        const forward = key === ']' || event.code === 'BracketRight'
        order(event.altKey ? (forward ? 'front' : 'back') : (forward ? 'forward' : 'backward'))
        return
      }
      if (meta && event.altKey && key === 'c') {
        event.preventDefault()
        copyAppearance()
        return
      }
      if (meta && event.altKey && key === 'v') {
        event.preventDefault()
        pasteAppearance()
        return
      }
      if (meta && event.shiftKey && key === 'r') {
        event.preventDefault()
        pasteToReplace()
        return
      }
      if (meta && (key === '\\' || event.code === 'Backslash')) {
        event.preventDefault()
        togglePanels()
        return
      }
      if (meta && event.shiftKey && key === 'f') {
        event.preventDefault()
        toggleFullscreen()
        return
      }
      if (event.ctrlKey && meta && key === 'm') {
        event.preventDefault()
        toggleMask()
        return
      }
      if (meta && key === '/') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (meta && event.shiftKey && key === 't') {
        event.preventDefault()
        if (current.selectedIds.length > 0) setTransformOpen(true)
        return
      }
      if (meta && key === 'd') {
        event.preventDefault()
        current.duplicateSelection()
        return
      }
      if (meta && key === 'a') {
        event.preventDefault()
        const doc = current.document
        if (!doc) return
        current.setSelectedIds(childrenOf(doc.elements, current.enteredGroupId).filter((element) => element.visible && !element.locked).map((element) => element.id))
        return
      }
      if (meta && key === 'g') {
        event.preventDefault()
        if (event.shiftKey) ungroup()
        else group()
        return
      }
      if (meta && key === 'e') {
        event.preventDefault()
        window.document.querySelector<HTMLButtonElement>('.vector-inspector button[data-action="combine"]')?.click()
        return
      }
      if (meta && key === 'j') {
        event.preventDefault()
        window.document.querySelector<HTMLButtonElement>('.vector-inspector button[data-action="join"]')?.click()
        return
      }
      if (meta && event.shiftKey && key === 'l') {
        event.preventDefault()
        if (current.selectedElements.length === 0) return
        const locked = !current.selectedElements.every((element) => element.locked)
        current.updateElements(current.selectedElements.map((element) => ({ id: element.id, patch: { locked } })), true, locked ? 'Lock' : 'Unlock')
        return
      }
      if (meta && event.shiftKey && key === 'h') {
        event.preventDefault()
        if (current.selectedElements.length === 0) return
        const visible = !current.selectedElements.every((element) => element.visible)
        current.updateElements(current.selectedElements.map((element) => ({ id: element.id, patch: { visible } })), true, visible ? 'Show' : 'Hide')
        return
      }
      if (meta && (event.code === 'Equal' || event.code === 'Minus' || event.code === 'NumpadAdd' || event.code === 'NumpadSubtract')) {
        event.preventDefault()
        controller.current?.zoomStep(event.code === 'Equal' || event.code === 'NumpadAdd' ? 1 : -1)
        return
      }
      if ((meta || event.shiftKey) && (key === '0' || key === '1' || key === '2' || event.code === 'Digit0' || event.code === 'Digit1' || event.code === 'Digit2')) {
        event.preventDefault()
        const doc = current.document
        if (event.code === 'Digit0') controller.current?.zoomTo(1)
        else if (event.code === 'Digit1') controller.current?.fit(null)
        else if (event.code === 'Digit2' && doc) {
          const leaves = leafElements(doc.elements, current.selectedIds)
          controller.current?.fit(leaves.length ? selectionBounds(leaves) : null, 96)
        }
        return
      }
      if (event.altKey && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && current.selectedElements.length > 0) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        if (meta) {
          // ⌥⌘ left and right turn the selection: a degree, or fifteen with ⇧.
          const turn = (key === 'arrowright' ? 1 : key === 'arrowleft' ? -1 : 0) * (event.shiftKey ? 15 : 1)
          if (turn) applyNumericTransform({ ...IDENTITY_TRANSFORM, rotation: turn })
          return
        }
        // ⌥ resizes instead of moving.
        const box = selectionBounds(leafElements(current.document?.elements ?? [], current.selectedIds))
        if (box.width <= 0 || box.height <= 0) return
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
        applyNumericTransform({
          ...IDENTITY_TRANSFORM,
          scaleX: (Math.max(1, box.width + dx) / box.width) * 100,
          scaleY: (Math.max(1, box.height + dy) / box.height) * 100,
        })
        return
      }
      if (event.altKey && meta && (event.code === 'KeyK' || event.code === 'KeyB')) {
        event.preventDefault()
        if (event.code === 'KeyK') createComponent()
        else {
          const targets = current.selectedElements.filter((element) => element.kind === 'instance')
          if (targets.length) current.editElements((elements) => targets.reduce((all, target) => detachInstance(all, target.id), elements), true, countedLabel('Detach', targets.length, 'instance'))
        }
        return
      }
      if (meta) return
      if (key === 'tab') {
        // Only the canvas walks objects with Tab; everywhere else it still moves focus.
        const active = window.document.activeElement
        const onCanvas = !active || active === window.document.body || (active instanceof HTMLElement && !!active.closest('#main'))
        if (!onCanvas) return
        event.preventDefault()
        walkSiblings(event.shiftKey ? -1 : 1)
        return
      }
      if (event.shiftKey && key === 'enter') {
        event.preventDefault()
        const doc = current.document
        const parent = doc && current.enteredGroupId ? doc.elements.find((element) => element.id === current.enteredGroupId) ?? null : null
        current.setEnteredGroupId(parent?.parentId ?? null)
        if (parent) current.setSelectedIds([parent.id])
        return
      }
      if (!event.shiftKey && /^[0-9]$/.test(event.key) && current.selectedIds.length > 0) {
        event.preventDefault()
        setOpacity(event.key)
        return
      }
      if (event.altKey && event.code === 'KeyP') {
        event.preventDefault()
        chooseTool('polygon')
        return
      }
      if (event.altKey) {
        const mode = ALIGN_KEYS[event.code]
        if (mode && current.selectedElements.length > 0) {
          event.preventDefault()
          alignSelection(mode)
        } else if (event.code === 'KeyR' && current.selectedElements.length > 0) {
          event.preventDefault()
          transformSelection((center) => rotationAffine(event.shiftKey ? -90 : 90, center), 'Rotate 90°')
        }
        return
      }
      if (event.shiftKey && (key === 'h' || key === 'v') && current.selectedElements.length > 0) {
        event.preventDefault()
        transformSelection((center) => flipAffine(key === 'h' ? 'x' : 'y', center), key === 'h' ? 'Flip horizontal' : 'Flip vertical')
        return
      }
      if (event.code === 'Equal' || event.code === 'Minus' || event.code === 'NumpadAdd' || event.code === 'NumpadSubtract') {
        event.preventDefault()
        controller.current?.zoomStep(event.code === 'Equal' || event.code === 'NumpadAdd' ? 1 : -1)
        return
      }
      if (event.repeat && !['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) return
      if (key === 'v') chooseTool('select')
      else if (key === 'q') chooseTool('lasso')
      else if (key === 'b') chooseTool('bucket')
      else if (key === 'p' && event.shiftKey) chooseTool('pencil')
      else if (key === 'p') chooseTool('pen')
      else if (key === 't') chooseTool('text')
      else if (key === 'f') chooseTool('frame')
      else if (key === 'l') chooseTool('line')
      else if (key === 'c') chooseTool('scissors')
      else if (key === 'k') chooseTool('scale')
      else if (key === 'w' && event.shiftKey) chooseTool('width')
      else if (key === 'h') chooseTool('hand')
      else if (key === 'z' && !event.metaKey && !event.ctrlKey) chooseTool('zoom')
      else if (key === 'm' && event.shiftKey) chooseTool('measure')
      else if (key === 'r') chooseTool('rectangle')
      else if (key === 'o') chooseTool('ellipse')
      else if (key === 'enter') {
        const selected = current.selected
        if (current.selectedIds.length === 1 && selected) {
          event.preventDefault()
          if (isContainer(selected)) {
            current.setEnteredGroupId(selected.id)
            const first = childrenOf(current.document?.elements ?? [], selected.id).at(-1)
            if (first) current.setSelectedIds([first.id])
          } else if (selected.kind === 'text') {
            controller.current?.editText(selected.id)
          } else if (!selected.locked) {
            chooseTool('node')
          }
        }
      } else if ((tool === 'select' || tool === 'transform') && current.selectedElements.length > 0 && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        event.preventDefault()
        const amount = event.shiftKey ? 10 : 1
        const dx = key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0
        const dy = key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0
        const leaves = transformLeaves(current.document?.elements ?? [], current.selectedIds).filter((element) => !element.locked)
        if (leaves.length === 0) return
        current.updateElements(leaves.map((element) => ({ id: element.id, patch: { x: element.x + dx, y: element.y + dy } })), true, countedLabel('Move', leaves.length))
      } else if ((key === 'backspace' || key === 'delete') && current.selectedIds.length > 0 && tool !== 'node' && tool !== 'bucket') {
        event.preventDefault()
        current.removeElements(current.selectedIds)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.document.removeEventListener('copy', copyHandler)
      window.document.removeEventListener('cut', cutHandler)
      window.document.removeEventListener('paste', onPaste)
    }
  }, [tool, chooseTool, applyNumericTransform, createComponent, group, ungroup, alignSelection, transformSelection, pasteElements, pasteStored, requestOpen, order, copyAppearance, pasteAppearance, pasteToReplace, walkSiblings, setOpacity, togglePanels, toggleFullscreen, toggleMask])

  /**
   * One live region for the canvas, 300ms behind the action so a run of small changes is spoken
   * once. What it says is whatever changed last: the selection, the nodes, the tool, or the entry
   * that just went into the history.
   */
  // The fonts a document carries have to be registered with the page before anything can be drawn.
  useEffect(() => { void ensureFonts(document?.fonts) }, [document?.fonts])

  const spoken = useRef({ tool, ids: '', nodes: 0, depth: 0, ready: false })
  const pendingAnnounce = useRef(0)
  useEffect(() => {
    const ids = selectedIds.join(',')
    const depth = editor.historyDepth
    const previous = spoken.current
    const label = editor.historySteps[editor.historySteps.length - 1]?.label
    let message = ''
    if (!previous.ready) message = ''
    else if (previous.tool !== tool) message = toolAnnouncement(tool)
    else if (previous.depth < depth && label) message = label
    else if (previous.nodes !== selectedNodeIds.length && selectedNodeIds.length > 0) message = nodeAnnouncement(selectedNodeIds.length)
    else if (previous.ids !== ids) message = selectionAnnouncement(document?.elements ?? [], selectedIds)
    spoken.current = { tool, ids, nodes: selectedNodeIds.length, depth, ready: true }
    if (!message) return
    window.clearTimeout(pendingAnnounce.current)
    pendingAnnounce.current = window.setTimeout(() => setAnnouncement(message), 300)
  }, [tool, selectedIds, selectedNodeIds, editor.historyDepth, editor.historySteps, document])

  if (!document) {
    return (
      <main className="vector-missing" id="main">
        <button type="button" className="btn btn--solid btn--md" onClick={() => navigate('/')}>Back to library</button>
      </main>
    )
  }

  /** The picture "Trace image" would work on: a single image, unlocked. */
  const traceable = selectedElements.length === 1 && selectedElements[0]?.kind === 'image' && !selectedElements[0].locked
    ? selectedElements[0]
    : null

  /** A text and an outline selected together are what "Attach to path" needs. */
  const attachable = (() => {
    if (selectedElements.length !== 2) return null
    const text = selectedElements.find((element) => element.kind === 'text')
    const path = selectedElements.find((element) => element !== text && element.kind !== 'group' && element.kind !== 'image' && element.kind !== 'text')
    return text && path ? { text, path } : null
  })()

  /** The frame an export means: the selected one, the one holding the selection, or the only one. */
  const frames = document.elements.filter((element) => element.kind === 'frame')
  const selectedFrame = selectedElements.find((element) => element.kind === 'frame')
    ?? frames.find((frame) => selectedIds.some((id) => ancestorIds(document.elements, id).includes(frame.id)))
    ?? (frames.length === 1 ? frames[0] : undefined)
    ?? null

  const runExport = async (settings: ExportSettings) => {
    setExportError(null)
    const selection = { frameId: selectedFrame?.id ?? null, selectedIds }
    const bounds = exportBounds(document, settings.target, selection)
    const markup = exportMarkup(document, settings, selection)
    if (!markup || !bounds) {
      setExportError('There is nothing to export with those settings.')
      return
    }
    const embedded = await embedFonts(markup, document.fonts ?? [])
    const name = exportFileName(document, settings, selectedFrame?.name)
    if (settings.format === 'pdf') {
      // Anything the format cannot say — an effect, a pattern, a mesh, a picture — is rasterised
      // one element at a time and placed as an image, at twice the size so it holds up in print.
      const rasteriseElement = async (element: VectorElement) => {
        const box = { x: element.x, y: element.y, width: element.width, height: element.height }
        const single = serializeVectorMarkup([{ ...element, rotation: 0 }], box)
        const blob = await rasterize(await embedFonts(single, document.fonts ?? []), box, 2, 'image/jpeg')
        if (!blob) return null
        return { data: new Uint8Array(await blob.arrayBuffer()), width: Math.round(box.width * 2), height: Math.round(box.height * 2) }
      }
      const { bytes, notes } = await exportPdf(
        pdfPages(document, settings.target === 'frame' || settings.target === 'document'),
        { background: settings.transparent ? undefined : document.background, rasterise: rasteriseElement },
      )
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name)
      if (notes.skipped.length) setExportError(`${notes.skipped.join(', ')} could not be written into the PDF.`)
      return
    }
    if (settings.format === 'svg') {
      downloadBlob(new Blob([embedded], { type: 'image/svg+xml' }), name)
      return
    }
    const png = await rasterize(embedded, bounds, settings.scale, 'image/png', document.colorSpace)
    if (!png) {
      setExportError('That drawing could not be rendered to PNG in this browser.')
      return
    }
    downloadBlob(png, name)
  }

  const palette: PaintPalette = {
    space: document.colorSpace,
    recent: document.recentColors,
    swatches: document.swatches,
    onColorUsed: (hex) => editor.updateDocument({ recentColors: pushRecentColor(document.recentColors, hex) }, false),
    onAddSwatch: (hex) => editor.updateDocument({ swatches: toggleSwatch(document.swatches, hex) }, true, 'Pin colour'),
    onRemoveSwatch: (hex) => editor.updateDocument({ swatches: toggleSwatch(document.swatches, hex, true) }, true, 'Unpin colour'),
    onPickFromCanvas: (apply) => { void startCanvasPick(apply) },
  }

  /** Renders the page offscreen once, then the next canvas click reads a pixel out of it. */
  const startCanvasPick = async (apply: (hex: string) => void) => {
    setExportError(null)
    const sample = await sampleDocument(document)
    if (!sample) {
      setExportError('This browser could not render the drawing to sample a colour from it.')
      return
    }
    setSampler({ sample, apply })
  }

  const finishCanvasPick = (point: { x: number; y: number } | null) => {
    const active = sampler
    setSampler(null)
    if (!active || !point) return
    const hex = colorAt(active.sample, point)
    if (!hex) return
    active.apply(hex)
    editor.updateDocument({ recentColors: pushRecentColor(document.recentColors, hex) }, false)
  }

  const createStyle = (kind: VectorStyleKind, source: VectorElement) => {
    const existing = document.styles ?? []
    const base = kind === 'fill' ? 'Fill style' : kind === 'stroke' ? 'Stroke style' : 'Effect style'
    let name = `${base} ${existing.filter((style) => style.kind === kind).length + 1}`
    while (existing.some((style) => style.name === name)) name = `${name}'`
    const style = styleFromElement(source, kind, name, crypto.randomUUID())
    const targets = leafElements(document.elements, selectedIds)
    editor.editDocument((current) => ({
      ...current,
      styles: [...(current.styles ?? []), style],
      elements: current.elements.map((element) => targets.some((target) => target.id === element.id) ? { ...element, ...applyStylePatch(style) } : element),
    }), true, `Create style “${style.name}”`)
  }

  const linkStyle = (kind: VectorStyleKind, styleId: string | null) => {
    const style = styleId ? (document.styles ?? []).find((item) => item.id === styleId) : null
    if (styleId && !style) return
    const targets = leafElements(document.elements, selectedIds)
    if (targets.length === 0) return
    editor.updateElements(targets.map((element) => ({ id: element.id, patch: style ? applyStylePatch(style) : detachStylePatch(kind) })), true, style ? `Apply “${style.name}”` : 'Detach style')
  }

  const updateStyle = (styleId: string, paints: VectorPaint[], record?: boolean) => {
    editor.editDocument((current) => {
      const styles = (current.styles ?? []).map((style) => style.id === styleId ? { ...style, paints } : style)
      const style = styles.find((item) => item.id === styleId)
      if (!style) return current
      const patches = new Map(syncStylePatches(current.elements, style).map((entry) => [entry.id, entry.patch]))
      return {
        ...current,
        styles,
        elements: current.elements.map((element) => patches.has(element.id) ? { ...element, ...patches.get(element.id)! } : element),
      }
    }, record, 'Change style')
  }

  const deleteStyle = (styleId: string) => {
    const style = (document.styles ?? []).find((item) => item.id === styleId)
    if (!style) return
    const key = styleIdKey(style.kind)
    editor.editDocument((current) => ({
      ...current,
      styles: (current.styles ?? []).filter((item) => item.id !== styleId),
      // The objects keep the look they had; only the link goes.
      elements: current.elements.map((element) => element[key] === styleId ? { ...element, [key]: undefined } : element),
    }), true, `Delete style “${style.name}”`)
  }

  /** Writes a change to the document's rig in one history entry. */
  const editRig = (build: (rig: VectorRig) => VectorRig, label: string) => {
    editor.editDocument((current) => ({ ...current, rig: build(current.rig ?? emptyRig()) }), true, label)
  }

  /** Turns a field of the Design tab into a control, and points it at that field. */
  const exposeField = (request: ExposeRequest) => {
    const element = document.elements.find((item) => item.id === request.elementId)
    if (!element) return
    const current = document.rig ?? emptyRig()
    const id = controlId(request.label, new Set(current.parameters.map((parameter) => parameter.id)))
    const parameter = parameterForProperty({
      id,
      label: request.label,
      group: request.group,
      property: request.property,
      element,
      ...(typeof request.min === 'number' ? { min: request.min } : {}),
      ...(typeof request.max === 'number' ? { max: request.max } : {}),
      ...(typeof request.step === 'number' ? { step: request.step } : {}),
    })
    if (!parameter) return
    editRig((state) => ({
      ...state,
      groups: state.groups.some((group) => group.id === request.group)
        ? state.groups
        : [...state.groups, { id: request.group, label: request.newGroupLabel ?? request.group }],
      parameters: [...state.parameters, parameter],
      bindings: [
        ...state.bindings.filter((binding) => !(binding.elementId === request.elementId && binding.property === request.property)),
        { id: crypto.randomUUID(), elementId: request.elementId, property: request.property, parameterId: id },
      ],
    }), `Expose ${request.label}`)
    setInspectorTab('controls')
  }

  const unbind = (binding: VectorBinding) => {
    editRig((state) => ({ ...state, bindings: state.bindings.filter((item) => item.id !== binding.id) }), 'Unbind')
  }

  /** Points an existing control at a field, replacing whatever drove it before. */
  const bindParameter = (parameterId: string, elementId: string, property: string) => {
    editRig((state) => ({
      ...state,
      bindings: [
        ...state.bindings.filter((binding) => !(binding.elementId === elementId && binding.property === property)),
        { id: crypto.randomUUID(), elementId, property, parameterId },
      ],
    }), 'Bind control')
  }

  /** A control with nothing behind it, for a macro or an expression. */
  const addControl = () => {
    const current = document.rig ?? emptyRig()
    const id = controlId('Control', new Set(current.parameters.map((parameter) => parameter.id)))
    editRig((state) => ({
      ...state,
      parameters: [...state.parameters, {
        kind: 'number',
        id,
        label: `Control ${state.parameters.length + 1}`,
        group: state.groups[0]?.id ?? DEFAULT_RIG_GROUP.id,
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 0,
      }],
    }), 'Add control')
  }

  const renameControl = (parameterId: string, label: string) => {
    const trimmed = label.trim().slice(0, 80)
    if (!trimmed) return
    editRig((state) => ({ ...state, parameters: state.parameters.map((parameter) => parameter.id === parameterId ? { ...parameter, label: trimmed } : parameter) }), 'Rename control')
  }

  const moveControl = (parameterId: string, group: string) => {
    editRig((state) => ({ ...state, parameters: state.parameters.map((parameter) => parameter.id === parameterId ? { ...parameter, group } : parameter) }), 'Move control')
  }

  const deleteControl = (parameterId: string) => {
    editRig((state) => ({
      ...state,
      parameters: state.parameters.filter((parameter) => parameter.id !== parameterId),
      bindings: state.bindings.filter((binding) => binding.parameterId !== parameterId),
    }), 'Delete control')
  }

  /** What the rail can do with the things this document reuses. */
  const assetActions: AssetActions = {
    onPlace: (asset) => { if (asset.sourceId) placeComponent(asset.sourceId) },
    onApply: (asset) => {
      if (asset.kind === 'style') {
        const style = (document.styles ?? []).find((item) => item.id === asset.id)
        if (style) linkStyle(style.kind, style.id)
        return
      }
      if (asset.kind === 'brush') {
        const targets = selectedElements.filter((element) => element.kind !== 'group')
        if (targets.length === 0) return
        editor.updateElements(targets.map((element) => ({ id: element.id, patch: { brush: { ...(element.brush ?? DEFAULT_BRUSH_SETTINGS), id: asset.id } } })), true, `Brush with “${asset.name}”`)
        return
      }
      if (asset.kind === 'font') pickFont(asset.name, 'file')
    },
    onRename: (asset, name) => {
      const trimmed = name.trim().slice(0, 60)
      if (!trimmed || trimmed === asset.name) return
      if (asset.kind === 'style') {
        editor.updateDocument({ styles: (document.styles ?? []).map((style) => style.id === asset.id ? { ...style, name: trimmed } : style) }, true, 'Rename style')
        return
      }
      if (asset.kind === 'brush') {
        editor.updateDocument({ brushes: (document.brushes ?? []).map((brush) => brush.id === asset.id ? { ...brush, name: trimmed } : brush) }, true, 'Rename brush')
        return
      }
      if (asset.kind === 'component' || asset.kind === 'pattern') editor.renameElement(asset.id, trimmed)
    },
    onDuplicate: (asset) => {
      if (asset.kind === 'style') {
        const style = (document.styles ?? []).find((item) => item.id === asset.id)
        if (!style) return
        editor.updateDocument({ styles: [...(document.styles ?? []), { ...style, id: crypto.randomUUID(), name: `${style.name} copy` }] }, true, 'Duplicate style')
        return
      }
      if (asset.kind === 'brush') {
        const brush = (document.brushes ?? []).find((item) => item.id === asset.id)
        if (!brush) return
        editor.updateDocument({ brushes: [...(document.brushes ?? []), { ...brush, id: crypto.randomUUID(), name: `${brush.name} copy` }] }, true, 'Duplicate brush')
        return
      }
      if (asset.sourceId) editor.duplicateElement(asset.sourceId)
    },
    onDelete: (asset) => {
      if (asset.kind === 'style') { deleteStyle(asset.id); return }
      if (asset.kind === 'brush') {
        editor.editDocument((current) => ({
          ...current,
          brushes: (current.brushes ?? []).filter((brush) => brush.id !== asset.id),
          elements: current.elements.map((element) => element.brush?.id === asset.id ? { ...element, brush: undefined } : element),
        }), true, `Delete brush “${asset.name}”`)
        return
      }
      if (asset.kind === 'font') {
        editor.updateDocument({ fonts: (document.fonts ?? []).filter((font) => font.family !== asset.id) }, true, `Delete font “${asset.name}”`)
        return
      }
      if (asset.sourceId) editor.removeElements([asset.sourceId])
    },
    onSelectUsers: (asset) => { if (asset.userIds.length > 0) editor.setSelectedIds(asset.userIds) },
  }

  /** Wraps shapes in a boolean group, which keeps them editable underneath the result. */
  const booleanGroup = (operation: BooleanOperation, ids: string[]) => {
    if (ids.length < 2) return
    const group = createVectorElement('boolean', { x: 0, y: 0, width: 1, height: 1 }, { name: booleanLabel(operation) })
    const first = document.elements.find((element) => element.id === ids[0])
    const wrapped: VectorElement = {
      ...group,
      operation,
      fill: first?.fill ?? group.fill,
      stroke: first?.stroke ?? 'none',
      strokeWidth: first?.strokeWidth ?? 0,
      ...(first?.fills ? { fills: first.fills } : {}),
      ...(first?.strokes ? { strokes: first.strokes } : {}),
    }
    editor.editElements((elements) => groupElements(elements, ids, wrapped), true, `${booleanLabel(operation)} as a group`)
    editor.setSelectedIds([wrapped.id])
  }

  const savePreset = (name: string, settings: ExportSettings) => {
    const presets = [...(document.exportPresets ?? []), { id: crypto.randomUUID(), name: name.trim().slice(0, 60), ...settings }].slice(-MAX_EXPORT_PRESETS)
    editor.updateDocument({ exportPresets: presets })
  }

  const deletePreset = (id: string) => {
    const presets = (document.exportPresets ?? []).filter((preset) => preset.id !== id)
    editor.updateDocument({ exportPresets: presets.length ? presets : undefined })
  }

  const toggleLock = () => {
    if (selectedElements.length === 0) return
    editor.updateElements(selectedElements.map((element) => ({ id: element.id, patch: { locked: !allLocked } })), true, allLocked ? 'Unlock' : 'Lock')
  }

  const single = selectedElements.length === 1 ? selectedElements[0]! : null
  const hasSelection = selectedIds.length > 0
  const paintReference = selectedElements.find((element) => element.kind !== 'group') ?? null

  /** Gives every selected node handles, or takes them away, in one history entry. */
  const shapeNodes = (mode: 'smooth' | 'corner') => {
    const target = tool === 'node' && single && single.kind !== 'group' && single.kind !== 'text' && !single.locked ? single : null
    if (!target || selectedNodeIds.length === 0) return
    let current = target
    for (const id of selectedNodeIds) {
      const world = worldNetwork(current)
      const node = world.nodes.find((item) => item.id === id)
      if (!node) continue
      const smooth = world.segments.some((segment) => (segment.a === id && segment.ah) || (segment.b === id && segment.bh))
      if (smooth === (mode === 'smooth')) continue
      current = { ...current, ...toggleNodeSmooth(current, world, id), kind: 'path' }
    }
    if (current === target) return
    editor.updateElement(target.id, { ...current, kind: 'path' }, true, countedLabel(mode === 'smooth' ? 'Smooth' : 'Corner', selectedNodeIds.length, 'node'))
  }

  /** The one object whose nodes are open for editing, and the actions the node bar offers on them. */
  const nodeTarget = tool === 'node' && single && single.kind !== 'group' && single.kind !== 'text' && !single.locked ? single : null
  const nodeWorld = nodeTarget ? worldNetwork(nodeTarget) : null
  const applyNodeEdit = (edit: { network: VectorNetwork; x: number; y: number; width: number; height: number } | null, label: string, selection?: string[]) => {
    if (!nodeTarget || !edit) return
    editor.updateElement(nodeTarget.id, { ...edit, kind: 'path' }, true, label)
    if (selection) setSelectedNodeIds(selection)
  }
  const nodePair = selectedNodeIds.length === 2 ? selectedNodeIds : null
  const nodeActions = {
    canConnect: !!nodeWorld && !!nodePair && !nodeWorld.segments.some((segment) => (segment.a === nodePair[0] && segment.b === nodePair[1]) || (segment.a === nodePair[1] && segment.b === nodePair[0])),
    canShape: !!nodeTarget && selectedNodeIds.length > 0,
    canDelete: !!nodeTarget && selectedNodeIds.length > 0,
    onConnect: () => {
      if (!nodeTarget || !nodeWorld || !nodePair) return
      applyNodeEdit(connectNodes(nodeTarget, nodeWorld, nodePair[0]!, nodePair[1]!), 'Connect nodes', [])
    },
    onScissors: () => chooseTool('scissors'),
    onSmooth: () => shapeNodes('smooth'),
    onCorner: () => shapeNodes('corner'),
    onDeleteNodes: () => {
      if (!nodeTarget || !nodeWorld) return
      applyNodeEdit(deleteNodes(nodeTarget, nodeWorld, selectedNodeIds), countedLabel('Delete', selectedNodeIds.length, 'node'), [])
    },
  }

  const ops = geometryOps({
    elements: document.elements,
    selected: selectedElements,
    onUpdate: editor.updateElement,
    onEditElements: editor.editElements,
    onSelectIds: editor.setSelectedIds,
    onBooleanGroup: booleanGroup,
  })

  const commands: VectorCommand[] = [
    { id: 'undo', label: 'Undo', section: 'Edit', shortcut: SHORTCUTS.undo, disabled: !editor.canUndo, run: editor.undo },
    { id: 'redo', label: 'Redo', section: 'Edit', shortcut: SHORTCUTS.redo, disabled: !editor.canRedo, run: editor.redo },
    { id: 'copy', label: 'Copy', section: 'Edit', shortcut: SHORTCUTS.copy, disabled: !hasSelection, run: () => copySelection(false) },
    { id: 'cut', label: 'Cut', section: 'Edit', shortcut: SHORTCUTS.cut, disabled: !hasSelection, run: () => copySelection(true) },
    { id: 'paste', label: 'Paste', section: 'Edit', shortcut: SHORTCUTS.paste, disabled: clipboard.elements === 0, run: pasteStored },
    { id: 'paste-replace', label: 'Paste to replace', section: 'Edit', shortcut: SHORTCUTS.pasteToReplace, disabled: !hasSelection || clipboard.elements === 0, run: pasteToReplace },
    { id: 'copy-properties', label: 'Copy properties', section: 'Edit', shortcut: SHORTCUTS.copyProperties, disabled: !paintReference, run: copyAppearance },
    { id: 'paste-properties', label: 'Paste properties', section: 'Edit', shortcut: SHORTCUTS.pasteProperties, disabled: !hasSelection || !clipboard.appearance, run: pasteAppearance },
    { id: 'duplicate', label: 'Duplicate', section: 'Edit', shortcut: SHORTCUTS.duplicate, disabled: !hasSelection, run: editor.duplicateSelection },
    { id: 'delete', label: 'Delete', section: 'Edit', shortcut: SHORTCUTS.delete, disabled: !hasSelection, run: () => editor.removeElements(selectedIds) },
    { id: 'select-all', label: 'Select all', section: 'Selection', shortcut: SHORTCUTS.selectAll, run: () => editor.setSelectedIds(childrenOf(document.elements, editor.enteredGroupId).filter((element) => element.visible && !element.locked).map((element) => element.id)) },
    { id: 'next-sibling', label: 'Select next object', section: 'Selection', shortcut: SHORTCUTS.nextSibling, run: () => walkSiblings(1) },
    { id: 'previous-sibling', label: 'Select previous object', section: 'Selection', shortcut: SHORTCUTS.previousSibling, run: () => walkSiblings(-1) },
    { id: 'same-fill', label: 'Select all with same fill', section: 'Selection', disabled: !paintReference, run: () => selectSame('fill') },
    { id: 'same-stroke', label: 'Select all with same stroke', section: 'Selection', disabled: !paintReference, run: () => selectSame('stroke') },
    { id: 'same-stroke-width', label: 'Select all with same stroke width', section: 'Selection', disabled: !paintReference, run: () => selectSame('strokeWidth') },
    { id: 'bring-forward', label: 'Bring forward', section: 'Arrange', shortcut: SHORTCUTS.bringForward, disabled: !hasSelection, run: () => order('forward') },
    { id: 'send-backward', label: 'Send backward', section: 'Arrange', shortcut: SHORTCUTS.sendBackward, disabled: !hasSelection, run: () => order('backward') },
    { id: 'bring-to-front', label: 'Bring to front', section: 'Arrange', shortcut: SHORTCUTS.bringToFront, disabled: !hasSelection, run: () => order('front') },
    { id: 'send-to-back', label: 'Send to back', section: 'Arrange', shortcut: SHORTCUTS.sendToBack, disabled: !hasSelection, run: () => order('back') },
    { id: 'group', label: 'Group', section: 'Arrange', shortcut: SHORTCUTS.group, disabled: !hasSelection, run: group },
    { id: 'ungroup', label: 'Ungroup', section: 'Arrange', shortcut: SHORTCUTS.ungroup, disabled: !canUngroup, run: ungroup },
    { id: 'flip-h', label: 'Flip horizontal', section: 'Arrange', shortcut: SHORTCUTS.flipHorizontal, disabled: !hasSelection, run: () => transformSelection((center) => flipAffine('x', center), 'Flip horizontal') },
    { id: 'flip-v', label: 'Flip vertical', section: 'Arrange', shortcut: SHORTCUTS.flipVertical, disabled: !hasSelection, run: () => transformSelection((center) => flipAffine('y', center), 'Flip vertical') },
    { id: 'rotate-90', label: 'Rotate 90°', section: 'Arrange', shortcut: SHORTCUTS.rotate90, disabled: !hasSelection, run: () => transformSelection((center) => rotationAffine(90, center), 'Rotate 90°') },
    { id: 'lock', label: allLocked ? 'Unlock' : 'Lock', section: 'Object', shortcut: SHORTCUTS.lock, disabled: !hasSelection, run: toggleLock },
    { id: 'hide', label: selectedElements.every((element) => element.visible) ? 'Hide' : 'Show', section: 'Object', shortcut: SHORTCUTS.hide, disabled: !hasSelection, run: () => editor.updateElements(selectedElements.map((element) => ({ id: element.id, patch: { visible: !selectedElements.every((item) => item.visible) } }))) },
    { id: 'opacity', label: 'Set opacity', section: 'Object', shortcut: SHORTCUTS.opacity, disabled: !hasSelection, run: () => setOpacity('0') },
    { id: 'edit-nodes', label: 'Edit nodes', section: 'Object', shortcut: SHORTCUTS.enter, disabled: !single || single.kind === 'group' || single.kind === 'text' || single.locked, run: () => chooseTool('node') },
    { id: 'edit-text', label: 'Edit text', section: 'Object', shortcut: SHORTCUTS.enter, disabled: single?.kind !== 'text', run: () => { if (single) controller.current?.editText(single.id) } },
    { id: 'combine', label: 'Combine paths', section: 'Object', shortcut: SHORTCUTS.combine, disabled: selectedElements.filter((element) => element.kind !== 'group').length < 2, run: () => ops.combine() },
    { id: 'flatten', label: 'Flatten', section: 'Object', disabled: !hasSelection, run: ops.flatten },
    { id: 'arrowhead', label: single?.strokeArrowEnd && single.strokeArrowEnd !== 'none' ? 'Remove arrowhead' : 'Line with arrowhead', section: 'Object', disabled: !single || single.kind === 'group' || single.strokeWidth <= 0, run: () => {
      if (!single) return
      const on = single.strokeArrowEnd && single.strokeArrowEnd !== 'none'
      editor.updateElement(single.id, { strokeArrowEnd: on ? undefined : 'triangle' }, true, on ? 'Remove arrowhead' : 'Add arrowhead')
    } },
    { id: 'mask', label: document.elements.find((element) => selectedIds.includes(element.id))?.mask ? 'Remove mask' : 'Use as mask', section: 'Object', shortcut: SHORTCUTS.mask, disabled: selectedIds.length === 0, run: toggleMask },
    ...BOOLEAN_OPERATIONS.map((operation) => ({
      id: `boolean-${operation}`,
      label: booleanLabel(operation),
      section: 'Object',
      disabled: selectedElements.filter((element) => element.kind !== 'group').length < 2,
      run: () => booleanGroup(operation, selectedElements.filter((element) => element.kind !== 'group').map((element) => element.id)),
    })),
    { id: 'outline-stroke', label: 'Outline stroke', section: 'Object', disabled: !single || single.kind === 'group' || single.strokeWidth <= 0, run: ops.outline },
    { id: 'create-component', label: 'Create component', section: 'Object', shortcut: SHORTCUTS.createComponent, disabled: !hasSelection, run: createComponent },
    { id: 'detach-instance', label: 'Detach instance', section: 'Object', shortcut: SHORTCUTS.detachInstance, disabled: !selectedElements.some((element) => element.kind === 'instance'), run: () => {
      const targets = selectedElements.filter((element) => element.kind === 'instance')
      editor.editElements((elements) => targets.reduce((all, target) => detachInstance(all, target.id), elements), true, countedLabel('Detach', targets.length, 'instance'))
    } },
    { id: 'go-to-component', label: 'Go to main component', section: 'Object', disabled: !selectedElements.some((element) => element.kind === 'instance' && element.componentId), run: () => {
      const instance = selectedElements.find((element) => element.kind === 'instance' && element.componentId)
      if (!instance?.componentId) return
      editor.setSelectedIds([instance.componentId])
      const master = document.elements.find((element) => element.id === instance.componentId)
      if (master) controller.current?.fit(selectionBounds([master]), 96)
    } },
    { id: 'reset-overrides', label: 'Reset overrides', section: 'Object', disabled: !selectedElements.some((element) => element.kind === 'instance' && element.overrides), run: () => {
      const targets = selectedElements.filter((element) => element.kind === 'instance' && element.overrides)
      editor.editElements((elements) => targets.reduce((all, target) => resetOverrides(all, target.id), elements), true, countedLabel('Reset', targets.length, 'instance'))
    } },
    { id: 'trace-image', label: 'Trace image…', section: 'Object', disabled: !traceable, run: () => setTraceOpen(true) },
    { id: 'define-pattern', label: 'Define pattern from selection', section: 'Object', disabled: selectedIds.length < 2, run: () => {
      const doc = editor.document
      if (!doc || selectedIds.length < 2) return
      // The topmost selected object is the tile; the ones under it are filled with it.
      const ordered = doc.elements.filter((element) => selectedIds.includes(element.id))
      const source = ordered[ordered.length - 1]
      const targets = ordered.slice(0, -1)
      if (!source || targets.length === 0) return
      editor.editDocument((state) => ({
        ...state,
        elements: state.elements.map((element) => {
          if (element.id === source.id) return { ...element, visible: false }
          if (!targets.some((target) => target.id === element.id)) return element
          const paint = patternFromElement(source, crypto.randomUUID())
          return { ...element, fill: summaryColor([paint]), fills: [paint] }
        }),
      }), true, countedLabel('Fill with pattern', targets.length))
      editor.setSelectedIds(targets.map((target) => target.id))
    } },
    { id: 'attach-to-path', label: 'Attach to path', section: 'Object', disabled: !attachable, run: () => {
      if (!attachable) return
      editor.updateElement(attachable.text.id, {
        textPath: { elementId: attachable.path.id, offset: 0, side: 'above', align: 'left', d: pathDataOf(attachable.path) },
        ...(pathBounds(attachable.path) ?? {}),
      }, true, 'Attach to path')
      editor.setSelectedIds([attachable.text.id])
    } },
    { id: 'detach-from-path', label: 'Detach from path', section: 'Object', disabled: !selectedElements.some((element) => element.textPath), run: () => {
      const targets = selectedElements.filter((element) => element.textPath)
      editor.updateElements(targets.map((element) => ({ id: element.id, patch: { textPath: undefined } })), true, 'Detach from path')
    } },
    { id: 'reset-stroke-width', label: 'Reset stroke width', section: 'Object', disabled: !selectedElements.some((element) => element.strokeProfile), run: () => {
      const targets = selectedElements.filter((element) => element.strokeProfile)
      editor.updateElements(targets.map((element) => ({ id: element.id, patch: { strokeProfile: undefined } })), true, 'Reset stroke width')
    } },
    { id: 'transform', label: 'Transform…', section: 'Arrange', shortcut: SHORTCUTS.transform, disabled: !hasSelection, run: () => setTransformOpen(true) },
    { id: 'rotate-copies', label: 'Rotate copies…', section: 'Arrange', disabled: !hasSelection, run: () => setRotateCopiesOpen(true) },
    { id: 'rename', label: 'Rename layers…', section: 'Object', disabled: !hasSelection, run: () => setRenameOpen(true) },
    { id: 'open', label: 'Open…', section: 'File', shortcut: SHORTCUTS.open, run: requestOpen },
    { id: 'save-as', label: 'Save as…', section: 'File', shortcut: SHORTCUTS.saveAs, run: () => void file.saveAs() },
    { id: 'import-svg', label: 'Import SVG…', section: 'File', run: () => importInput.current?.click() },
    { id: 'export', label: 'Export…', section: 'File', run: () => void runExport(exportSettings) },
    { id: 'panels', label: restorePanels.current ? 'Show panels' : 'Hide panels', section: 'View', shortcut: SHORTCUTS.panels, run: togglePanels },
    { id: 'fullscreen', label: fullscreen ? 'Leave full screen' : 'Full screen canvas', section: 'View', shortcut: SHORTCUTS.fullscreen, run: toggleFullscreen },
    { id: 'zoom-reset', label: 'Zoom to 100%', section: 'View', shortcut: SHORTCUTS.zoomReset, run: () => controller.current?.zoomTo(1) },
    { id: 'zoom-fit', label: 'Fit page', section: 'View', shortcut: SHORTCUTS.zoomFit, run: () => controller.current?.fit(null) },
    { id: 'zoom-selection', label: 'Fit selection', section: 'View', shortcut: SHORTCUTS.zoomSelection, disabled: !hasSelection, run: () => controller.current?.fit(selectionBounds(leafElements(document.elements, selectedIds)), 96) },
  ]

  const byId = new Map(commands.map((command) => [command.id, command]))
  const menuItem = (id: string, icon?: ReactNode, separatorBefore?: boolean): ContextMenuItem[] => {
    const command = byId.get(id)
    if (!command) return []
    return [{ label: command.shortcut ? `${command.label} · ${command.shortcut}` : command.label, icon, disabled: command.disabled, ...(separatorBefore === undefined ? {} : { separatorBefore }), onSelect: command.run }]
  }

  const canvasMenuItems: ContextMenuItem[] = [
    ...menuItem('copy', <IconCopy />),
    ...menuItem('paste', <IconPaste />, false),
    ...menuItem('duplicate', undefined, false),
    ...menuItem('delete', <IconTrash />, false),
    ...menuItem('group', <IconGroup />),
    ...menuItem('ungroup', <IconUngroup />, false),
    ...menuItem('bring-forward', <IconBringForward />),
    ...menuItem('send-backward', <IconSendBackward />, false),
    ...menuItem('bring-to-front', undefined, false),
    ...menuItem('send-to-back', undefined, false),
    ...menuItem('flip-h', <IconFlipH />),
    ...menuItem('flip-v', <IconFlipV />, false),
    ...menuItem('rotate-90', <IconRotate90 />, false),
    ...menuItem('combine'),
    ...menuItem('flatten', undefined, false),
    ...menuItem('outline-stroke', undefined, false),
    ...menuItem('arrowhead', undefined, false),
    ...menuItem('mask', undefined, false),
    ...menuItem(single?.kind === 'text' ? 'edit-text' : 'edit-nodes', <IconNode />, false),
    ...menuItem('same-fill'),
    ...menuItem('same-stroke', undefined, false),
    ...menuItem('same-stroke-width', undefined, false),
    ...menuItem('rename', <IconPencil />),
    ...menuItem('lock', allLocked ? <IconUnlock /> : <IconLock />),
    ...menuItem('hide', <IconEyeOff />, false),
  ]

  /** What the bar's ⋯ holds: the canvas menu minus the eight actions already on the bar. */
  const barMenuItems: ContextMenuItem[] = [
    ...menuItem('copy'),
    ...menuItem('paste', undefined, false),
    ...menuItem('duplicate', undefined, false),
    ...menuItem('bring-forward'),
    ...menuItem('send-backward', undefined, false),
    ...menuItem('bring-to-front', undefined, false),
    ...menuItem('send-to-back', undefined, false),
    ...menuItem('combine'),
    ...menuItem('flatten', undefined, false),
    ...menuItem('outline-stroke', undefined, false),
    ...menuItem('mask', undefined, false),
    ...menuItem(single?.kind === 'text' ? 'edit-text' : 'edit-nodes', undefined, false),
    ...menuItem('same-fill'),
    ...menuItem('same-stroke', undefined, false),
    ...menuItem('same-stroke-width', undefined, false),
    ...menuItem('rename'),
  ]

  const selectFromLayers = (id: string, mode: 'replace' | 'toggle' | 'range') => {
    if (mode === 'replace') {
      editor.setSelectedIds([id])
      lastLayerClick.current = id
      return
    }
    if (mode === 'toggle') {
      editor.setSelectedIds(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id])
      lastLayerClick.current = id
      return
    }
    const anchor = lastLayerClick.current ?? selectedIds.at(-1) ?? id
    const order = document.elements.map((element) => element.id)
    const from = order.indexOf(anchor)
    const to = order.indexOf(id)
    if (from < 0 || to < 0) {
      editor.setSelectedIds([id])
      return
    }
    const [start, end] = from < to ? [from, to] : [to, from]
    const anchorElement = document.elements[from]!
    const range = order.slice(start, end + 1).filter((value) => (document.elements.find((element) => element.id === value)?.parentId ?? null) === (anchorElement.parentId ?? null))
    editor.setSelectedIds([...new Set([...selectedIds, ...range])])
  }

  return (
    <WorkspaceShell
      rigs={listRigs()}
      activeId={document.id}
      mainLabel="Canvas"
      navLabel="Layers"
      mobilePanel={mobilePanel}
      onMobilePanel={setMobilePanel}
      renderNavigation={({ compact, inert, onNavigate }) => (
        <VectorLayers
          document={document}
          selectedIds={selectedIds}
          enteredGroupId={editor.enteredGroupId}
          compact={compact}
          inert={inert}
          onNavigate={onNavigate}
          onSelect={selectFromLayers}
          onUpdate={editor.updateElement}
          onUpdateElements={editor.updateElements}
          onRemove={editor.removeElements}
          onReorder={editor.reorderElement}
          onMoveInTree={editor.moveElementInTree}
          onRename={editor.renameElement}
          onDuplicate={editor.duplicateElement}
          onGroup={(ids) => { editor.setSelectedIds(ids); requestAnimationFrame(group) }}
          onUngroup={(ids) => { editor.setSelectedIds(ids); requestAnimationFrame(ungroup) }}
          onRenameMany={(ids) => { editor.setSelectedIds(ids); setRenameOpen(true) }}
          assets={documentAssets(document)}
          assetActions={assetActions}
        />
      )}
      inspector={
        <ExposeProvider value={{
          elementId: single?.id ?? null,
          elementName: single?.name ?? '',
          groups: rig?.groups ?? [],
          parameters: rig?.parameters ?? [],
          bindings: rig?.bindings ?? [],
          onExpose: exposeField,
          onUnbind: unbind,
          onGoToControl: () => setInspectorTab('controls'),
          onDropParameter: bindParameter,
        }}>
        <VectorInspector
          document={shown ?? document}
          tab={inspectorTab}
          onTab={setInspectorTab}
          controls={
            <VectorControls
              session={session}
              groups={rig?.groups ?? []}
              parameters={rig?.parameters ?? []}
              bindings={rig?.bindings ?? []}
              mode={mode}
              onMode={(next) => onMode?.(next)}
              onAdd={addControl}
              onRename={renameControl}
              onMove={moveControl}
              onDelete={deleteControl}
            />
          }
          tool={tool}
          selectedElements={shownSelection}
          selectedNodeIds={selectedNodeIds}
          onUpdateDocument={editor.updateDocument}
          onUpdate={editor.updateElement}
          onUpdateElements={editor.updateElements}
          onEditElements={editor.editElements}
          onSelectIds={editor.setSelectedIds}
          onSelectNodes={setSelectedNodeIds}
          historyDepth={editor.historyDepth}
          historySteps={editor.historySteps}
          historyIndex={editor.historyIndex}
          onGoToStep={editor.goToStep}
          onSaveVersion={editor.saveVersion}
          onRestoreVersion={editor.restoreVersion}
          onDeleteVersion={editor.deleteVersion}
          onGestureStart={editor.beginGesture}
          onGestureEnd={editor.endGesture}
          onGestureCancel={editor.cancelGesture}
          saveMessage={file.message ?? exportError}
          palette={palette}
          onCreateStyle={createStyle}
          onLinkStyle={linkStyle}
          onUpdateStyle={updateStyle}
          onDeleteStyle={deleteStyle}
          onCropImage={(id) => controller.current?.cropImage(id)}
          selectedMeshPoint={meshPoint}
          onDefineBrush={defineBrush}
          onPickFont={pickFont}
          onImportFont={importFont}
          onBooleanGroup={booleanGroup}
        />
        </ExposeProvider>
      }
    >
      <h1 className="visually-hidden">{document.name}</h1>
      <div ref={toolbarRef} className="workspace-toolbar vector-toolbar" role="toolbar" aria-label="Vector tools">
        <div className="workspace-toolbar__group vector-toolbar__start">
          <VectorFileMenu
            file={file}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            undoLabel={editor.canUndo ? editor.historySteps[editor.historyIndex]?.label ?? null : null}
            redoLabel={editor.canRedo ? editor.historySteps[editor.historyIndex + 1]?.label ?? null : null}
            onUndo={editor.undo}
            onRedo={editor.redo}
            onNewDocument={newDocument}
            onOpenProject={requestOpen}
            onImportSvg={() => importInput.current?.click()}
            onCommands={() => setPaletteOpen(true)}
          />
        </div>
        <div className="workspace-toolbar__group vector-toolbar__tools">
          {TOOL_GROUPS.map((group) => (
            <ToolGroup
              key={group.id}
              group={group}
              entryId={groupEntry[group.id]}
              activeTool={tool}
              disabled={disabledEntries}
              onChoose={(entry) => chooseTool(entry.tool, entry.id)}
              onActivate={(entry, keyboard) => {
                chooseTool(entry.tool, entry.id)
                if (!keyboard) return
                if (entry.id === 'rectangle') editor.addElement(createVectorElement('rectangle', centeredBounds(document, 160, 120)))
                if (entry.id === 'ellipse') editor.addElement(createVectorElement('ellipse', centeredBounds(document, 140, 140)))
              }}
            />
          ))}
        </div>
        <div className="vector-toolbar__title">
          <input
            className="vector-document-name"
            aria-label="Document name"
            defaultValue={document.name}
            maxLength={120}
            key={document.name}
            spellCheck={false}
            onBlur={(event) => editor.rename(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.currentTarget.value = document.name
                event.currentTarget.blur()
              }
            }}
          />
          <VectorSaveBadge file={file} />
        </div>
        <div className="workspace-toolbar__group vector-toolbar__end">
          <ZoomControl
            zoom={zoom}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            hasSelection={selectedIds.length > 0}
            onStep={(direction) => setZoom((value) => nextZoom(value, direction))}
            onZoomTo={(scale) => controller.current?.zoomTo(scale)}
            onFitPage={() => controller.current?.fit(null)}
            onFitSelection={() => controller.current?.fit(selectionBounds(leafElements(document.elements, selectedIds)), 96)}
          />
          <ViewOptionsMenu value={viewOptions} onChange={setViewOptions} fullscreen={fullscreen} onFullscreen={toggleFullscreen} />
          <VectorExportMenu
            settings={exportSettings}
            onSettings={setExportSettings}
            frameName={selectedFrame?.name ?? null}
            selectionCount={selectedIds.length}
            presets={document.exportPresets ?? []}
            onExport={(settings) => void runExport(settings)}
            onSavePreset={savePreset}
            onDeletePreset={deletePreset}
          />
          <input ref={importInput} type="file" accept=".svg,image/svg+xml" className="visually-hidden" tabIndex={-1} onChange={(event) => { void importFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
          <input ref={projectInput} type="file" accept=".json,application/json" className="visually-hidden" tabIndex={-1} onChange={(event) => { const picked = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (picked) void openProject(picked) }} />
        </div>
      </div>
      <div
        className="preview-stage vector-stage"
        id="main"
        tabIndex={-1}
        onContextMenuCapture={(event) => {
          // A right click ends a modal transform; it should not also open the menu.
          if (window.document.querySelector('.vector-canvas[data-transform]')) event.stopPropagation()
        }}
      >
        <ContextMenuRoot>
        <ContextTarget className="vector-stage__menu" items={canvasMenuItems} label="Canvas actions" touchActions={false}>
        <VectorCanvas
          document={shown ?? document}
          tool={tool}
          zoom={zoom}
          pan={pan}
          viewOptions={viewOptions}
          onPanChange={setPan}
          onZoomChange={setZoom}
          selectedIds={selectedIds}
          enteredGroupId={editor.enteredGroupId}
          selectedNodeIds={selectedNodeIds}
          onSelectIds={editor.setSelectedIds}
          onEnterGroup={editor.setEnteredGroupId}
          onSelectNodes={setSelectedNodeIds}
          onToolChange={chooseTool}
          onAddElements={(elements) => {
            const star = tool === 'polygon' && groupEntry.shapes === 'star'
            editor.addElements(star ? elements.map((element) => element.kind === 'polygon' ? { ...element, name: 'Star', innerRatio: STAR_INNER_RATIO } : element) : elements)
            if (tool === 'rectangle' || tool === 'ellipse' || tool === 'text' || tool === 'frame' || tool === 'polygon' || tool === 'line') chooseTool('select')
          }}
          onUpdate={editor.updateElement}
          onUpdateElements={editor.updateElements}
          onDuplicateElements={editor.duplicateElements}
          onSetGuides={editor.setGuides}
          onEditElements={editor.editElements}
          controller={controller}
          onEscape={() => {
            if (editor.enteredGroupId) {
              editor.setSelectedIds([editor.enteredGroupId])
              editor.setEnteredGroupId(null)
            } else {
              editor.setSelectedIds([])
            }
          }}
          onGestureStart={editor.beginGesture}
          onGestureEnd={editor.endGesture}
          onGestureCancel={editor.cancelGesture}
          sampling={!!sampler}
          onSample={finishCanvasPick}
          onMeshPointChange={setMeshPoint}
          onPlaceComponent={placeComponent}
          overlay={(anchor) => anchor && (anchor.mode === 'nodes' ? !!nodeTarget : selectedIds.length > 0) ? (
            <VectorSelectionBar
              anchor={anchor}
              actions={{
                canUngroup,
                canCombine: selectedElements.filter((element) => element.kind !== 'group').length > 1,
                locked: allLocked,
                hidden: selectedElements.length > 0 && selectedElements.every((element) => !element.visible),
                onGroup: group,
                onUngroup: ungroup,
                onBoolean: (operation) => booleanGroup(operation, selectedElements.filter((element) => element.kind !== 'group').map((element) => element.id)),
                onFlip: (axis) => transformSelection((center) => flipAffine(axis, center), axis === 'x' ? 'Flip horizontal' : 'Flip vertical'),
                onRotate90: () => transformSelection((center) => rotationAffine(90, center), 'Rotate 90°'),
                onLock: toggleLock,
                onHide: () => editor.updateElements(selectedElements.map((element) => ({ id: element.id, patch: { visible: !selectedElements.every((item) => item.visible) } }))),
                onDelete: () => editor.removeElements(selectedIds),
                more: barMenuItems,
              }}
              nodeActions={nodeActions}
            />
          ) : null}
        />
        </ContextTarget>
        </ContextMenuRoot>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite" data-vector-announce>{announcement}</p>
      <VectorCommandPalette commands={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <VectorTraceDialog
        image={traceable}
        open={traceOpen && !!traceable}
        onClose={() => setTraceOpen(false)}
        onTrace={(layers, size, options) => {
          if (!traceable) return
          const traced = tracedElements(layers, traceable, size, options.smoothing)
          if (traced.length === 0) return
          // The picture stays, hidden under its own drawing: undo is one step, and it can come back.
          editor.editDocument((state) => ({
            ...state,
            elements: [
              ...state.elements.map((element) => element.id === traceable.id ? { ...element, visible: false } : element),
              ...traced,
            ],
          }), true, countedLabel('Trace', traced.length, 'path'))
          editor.setSelectedIds(traced.map((element) => element.id))
        }}
      />
      <VectorTransformDialog
        count={selectedIds.length}
        open={transformOpen && selectedIds.length > 0}
        initial={lastTransform.current}
        onClose={() => setTransformOpen(false)}
        onApply={applyNumericTransform}
      />
      <VectorRotateCopiesDialog
        count={selectedIds.length}
        open={rotateCopiesOpen && selectedIds.length > 0}
        onClose={() => setRotateCopiesOpen(false)}
        onApply={applyRotateCopies}
      />
      <VectorRenameDialog
        elements={selectedElements}
        open={renameOpen && selectedElements.length > 0}
        onClose={() => setRenameOpen(false)}
        onRename={(names) => editor.updateElements(selectedElements.map((element, index) => ({ id: element.id, patch: { name: names[index]! } })), true, countedLabel('Rename', selectedElements.length, 'layer'))}
      />
    </WorkspaceShell>
  )
}

/** Turns group moves into leaf moves so grouped objects follow. */
function expandMoves(elements: VectorElement[], patches: ElementPatch[]): ElementPatch[] {
  const updates: ElementPatch[] = []
  for (const { id, patch } of patches) {
    const element = elements.find((item) => item.id === id)
    if (!element) continue
    if (!isContainer(element)) {
      updates.push({ id, patch })
      continue
    }
    const dx = typeof patch.x === 'number' ? patch.x - element.x : 0
    const dy = typeof patch.y === 'number' ? patch.y - element.y : 0
    for (const leaf of transformLeaves(elements, [id])) updates.push({ id: leaf.id, patch: { x: Math.round((leaf.x + dx) * 100) / 100, y: Math.round((leaf.y + dy) * 100) / 100 } })
  }
  return updates
}

function ViewOptionsMenu({ value, onChange, fullscreen, onFullscreen }: {
  value: VectorViewOptions
  onChange: (value: VectorViewOptions) => void
  fullscreen: boolean
  onFullscreen: () => void
}) {
  const active = value.pixelPreview !== 'off' || value.pixelGrid || value.snapToPixelGrid || value.layoutGuides || value.rulers || value.outlines !== 'off'
  const update = <Key extends keyof VectorViewOptions>(key: Key, next: VectorViewOptions[Key]) => onChange({ ...value, [key]: next })
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content="View options">
        <DropdownMenu.Trigger asChild>
          <IconButton label="View options" aria-pressed={active}><IconGrid /></IconButton>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu vector-view-menu" side="bottom" align="end" sideOffset={8} collisionPadding={8} aria-label="View options">
          <ViewSubmenu label="Pixel preview" value={value.pixelPreview} onChange={(next) => update('pixelPreview', next)} options={[
            { value: 'off', label: 'Off' },
            { value: '1x', label: '1×' },
            { value: '2x', label: '2×' },
          ]} />
          <ViewToggle label="Pixel grid" hint="from 400%" checked={value.pixelGrid} onChange={(checked) => update('pixelGrid', checked)} />
          <DropdownMenu.Separator className="menu__sep" />
          <ViewToggle label="Snap to pixel grid" checked={value.snapToPixelGrid} onChange={(checked) => update('snapToPixelGrid', checked)} />
          <ViewToggle label="Snap to objects" checked={value.snapToObjects} onChange={(checked) => update('snapToObjects', checked)} />
          <ViewToggle label="Snap to guides" checked={value.snapToGuides} onChange={(checked) => update('snapToGuides', checked)} />
          <ViewToggle label="Snap to nodes" checked={value.snapToNodes} onChange={(checked) => update('snapToNodes', checked)} />
          <DropdownMenu.Separator className="menu__sep" />
          <ViewToggle label="Rulers" checked={value.rulers} onChange={(checked) => update('rulers', checked)} />
          <ViewToggle label="Guides" checked={value.guides} onChange={(checked) => update('guides', checked)} />
          <ViewToggle label="Layout grid" checked={value.layoutGuides} onChange={(checked) => update('layoutGuides', checked)} />
          <ViewToggle label="Minimap" checked={value.minimap} onChange={(checked) => update('minimap', checked)} />
          <ViewSubmenu label="Outlines" value={value.outlines} onChange={(next) => update('outlines', next)} options={[
            { value: 'off', label: 'Off' },
            { value: 'all', label: 'All objects' },
            { value: 'selected', label: 'Selected objects' },
          ]} />
          <DropdownMenu.Separator className="menu__sep" />
          <DropdownMenu.CheckboxItem
            className="menu__item vector-view-menu__item"
            checked={fullscreen}
            onCheckedChange={onFullscreen}
          >
            <span className="vector-view-menu__check"><DropdownMenu.ItemIndicator><IconCheck /></DropdownMenu.ItemIndicator></span>
            <span className="vector-view-menu__label">Full screen canvas</span>
            <kbd>{SHORTCUTS.fullscreen}</kbd>
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ViewToggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <DropdownMenu.CheckboxItem
      className="menu__item vector-view-menu__item"
      checked={checked}
      onCheckedChange={(next) => onChange(next === true)}
      onSelect={(event) => event.preventDefault()}
    >
      <span className="vector-view-menu__check"><DropdownMenu.ItemIndicator><IconCheck /></DropdownMenu.ItemIndicator></span>
      <span className="vector-view-menu__label">{label}</span>
      {hint ? <kbd>{hint}</kbd> : null}
    </DropdownMenu.CheckboxItem>
  )
}

function ViewSubmenu<Value extends string>({ label, value, options, onChange }: {
  label: string
  value: Value
  options: Array<{ value: Value; label: string }>
  onChange: (value: Value) => void
}) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className="menu__item vector-view-menu__item">
        <span className="vector-view-menu__check">{value !== 'off' ? <IconCheck /> : null}</span>
        <span className="vector-view-menu__label">{label}</span>
        <IconChevronRight />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent className="menu vector-view-menu__sub" sideOffset={6} collisionPadding={8}>
          <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as Value)}>
            {options.map((option) => (
              <DropdownMenu.RadioItem key={option.value} className="menu__item vector-view-menu__item" value={option.value}>
                <span className="vector-view-menu__check"><DropdownMenu.ItemIndicator><IconCheck /></DropdownMenu.ItemIndicator></span>
                <span className="vector-view-menu__label">{option.label}</span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

function centeredBounds(document: { width: number; height: number }, width: number, height: number) {
  return { x: (document.width - width) / 2, y: (document.height - height) / 2, width, height }
}


function downloadBlob(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = href
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(href)
}
