import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { boxMap, elementInLasso, pointInPolygon, transformElementAffine } from '@/vector/affine'
import { bendSegment, insertNode, isSmoothNode, nearestSegment, seedHandles, toggleNodeType } from '@/vector/bezier'
import { pencilNodes } from '@/vector/pencil'
import { createVectorElement } from '@/vector/document'
import { resizeBounds, resizeCursor, resizeElement, type DirectResizeHandle } from '@/vector/directTransform'
import { boundsBetween, elementCenter, intersects, round, rulerStep, rulerTicks, selectionBounds, snapAngle, snapBounds, snapGeometryPatch, type Bounds } from '@/vector/geometry'
import { addGuide, createGuide, moveGuide, removeGuide } from '@/vector/guides'
import { fillPointerEvents, isHittable, strokeHitWidth } from '@/vector/hitTest'
import { layerAttributes, markerShape, outlinePathData, renderModel, type RenderDef } from '@/vector/render'
import { penAddAnchor, penCanClose, penClose, penCommit, penDragHandle, penFromElement, penPreviewData, penRemoveLast, penStart, type PenDraft } from '@/vector/pen'
import { collectSnapTargets, snapBoundsDelta, snapPoint, type SnapMatch, type SnapTarget } from '@/vector/snapping'
import { transformElement, transformElements, type VectorTransformAxis, type VectorTransformMode } from '@/vector/transform'
import { buildTree, childrenOf, descendantIds, leafElements, resolveSelection, type TreeNode } from '@/vector/tree'
import { defaultVectorNodes, elementFromWorldNodes, moveVectorNode, neighbours, nodeIndicesInBounds, nodePosition, nodeSelectionBounds, nodeWorldPosition, scaleNodesToBounds, transformVectorNodes, vectorPathData } from '@/vector/vectorPath'
import { combineElements, deleteNodes, joinNodes, openEndpoints as openEndpointsOf } from '@/vector/subpaths'
import type { VectorDocument, VectorElement, VectorGuide, VectorNode, VectorTool } from '@/vector/types'

type Point = { x: number; y: number }
type Corner = Extract<DirectResizeHandle, 'nw' | 'ne' | 'se' | 'sw'>
type NodePart = 'anchor' | 'in' | 'out'

export type VectorPixelPreview = 'off' | '1x' | '2x'
export type VectorOutlineMode = 'off' | 'all' | 'selected'
export type VectorViewOptions = {
  pixelPreview: VectorPixelPreview
  pixelGrid: boolean
  snapToPixelGrid: boolean
  snapToObjects: boolean
  snapToGuides: boolean
  snapToNodes: boolean
  layoutGuides: boolean
  rulers: boolean
  guides: boolean
  minimap: boolean
  outlines: VectorOutlineMode
}

export type VectorHud = { label: string; x: number; y: number }

/** Imperative view commands the page can call (zoom to fit, zoom to selection). */
export type VectorCanvasController = {
  fit: (bounds: Bounds | null, padding?: number) => void
  zoomTo: (zoom: number) => void
}

type Interaction =
  | { kind: 'create'; pointerId: number; start: Point; current: Point; targets: SnapTarget[] }
  | { kind: 'marquee'; pointerId: number; start: Point; current: Point; additive: boolean }
  | { kind: 'node-marquee'; pointerId: number; start: Point; current: Point; additive: boolean; outside: boolean; element: VectorElement; nodes: VectorNode[] }
  | { kind: 'move'; pointerId: number; start: Point; elements: VectorElement[]; bounds: Bounds; originalIds: string[]; targets: SnapTarget[]; moved: boolean; toggleOnClick: string | null }
  | { kind: 'resize'; pointerId: number; start: Point; elements: VectorElement[]; bounds: Bounds; handle: DirectResizeHandle; single: VectorElement | null; targets: SnapTarget[] }
  | { kind: 'rotate'; pointerId: number; start: Point; elements: VectorElement[]; center: Point; single: VectorElement | null }
  | { kind: 'node'; pointerId: number; start: Point; anchorStart: Point; element: VectorElement; nodes: VectorNode[]; nodeIndices: number[]; nodeIndex: number; part: NodePart; targets: SnapTarget[] }
  | { kind: 'pen'; pointerId: number; anchorIndex: number }
  | { kind: 'pencil'; pointerId: number; points: Point[] }
  | { kind: 'bend'; pointerId: number; element: VectorElement; nodes: VectorNode[]; segmentIndex: number; t: number }
  | { kind: 'node-resize'; pointerId: number; element: VectorElement; nodes: VectorNode[]; nodeIndices: number[]; bounds: Bounds; handle: DirectResizeHandle }
  | { kind: 'node-rotate'; pointerId: number; start: Point; element: VectorElement; nodes: VectorNode[]; nodeIndices: number[]; center: Point }
  | { kind: 'lasso'; pointerId: number; points: Point[]; additive: boolean }
  | { kind: 'pivot'; pointerId: number }
  | { kind: 'guide-create'; pointerId: number; axis: 'x' | 'y' }
  | { kind: 'guide-move'; pointerId: number; guide: VectorGuide; targets: SnapTarget[] }
  | { kind: 'modal'; target: 'elements'; mode: VectorTransformMode; axis: VectorTransformAxis; start: Point; elements: VectorElement[]; preview: VectorElement[] }
  | { kind: 'modal'; target: 'nodes'; mode: VectorTransformMode; axis: VectorTransformAxis; start: Point; element: VectorElement; nodes: VectorNode[]; nodeIndices: number[]; preview: VectorElement }

type VectorCanvasProps = {
  document: VectorDocument
  tool: VectorTool
  zoom: number
  pan: Point
  viewOptions: VectorViewOptions
  onPanChange: (pan: Point) => void
  onZoomChange: (zoom: number) => void
  selectedIds: string[]
  enteredGroupId: string | null
  selectedNodeIndices: number[]
  onSelectIds: (ids: string[]) => void
  onEnterGroup: (id: string | null) => void
  onSelectNodes: (indices: number[]) => void
  onToolChange: (tool: VectorTool) => void
  onAddElements: (elements: VectorElement[]) => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onUpdateElements: (updates: Array<{ id: string; patch: Partial<VectorElement> }>, record?: boolean) => void
  onDuplicateElements: (ids: string[], offset: number) => { ids: string[]; idMap: Record<string, string> }
  onSetGuides: (guides: VectorGuide[], record?: boolean) => void
  onEditElements: (edit: (elements: VectorElement[]) => VectorElement[], record?: boolean) => void
  controller?: MutableRefObject<VectorCanvasController | null>
  onEscape: () => void
  onGestureStart: () => void
  onGestureEnd: () => void
  onGestureCancel: () => void
}

const RULER_SIZE = 24
const SNAP_PX = 6
const PEN_CLOSE_PX = 8
const PIXEL_GRID_MIN_ZOOM = 4

export function VectorCanvas({
  document,
  tool,
  zoom,
  pan,
  viewOptions,
  onPanChange,
  onZoomChange,
  selectedIds,
  enteredGroupId,
  selectedNodeIndices,
  onSelectIds,
  onEnterGroup,
  onSelectNodes,
  onToolChange,
  onAddElements,
  onUpdate,
  onUpdateElements,
  onDuplicateElements,
  onSetGuides,
  onEditElements,
  controller,
  onEscape,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: VectorCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const instanceId = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const worldRef = useRef<SVGGElement>(null)
  const interaction = useRef<Interaction | null>(null)
  const panDrag = useRef<{ pointerId: number; x: number; y: number; origin: Point } | null>(null)
  const camera = useRef({ pan, zoom })
  const spaceHeld = useRef(false)
  const latestPointer = useRef<Point | null>(null)
  const latestClient = useRef<Point | null>(null)
  const documentRef = useRef(document)
  const toolRef = useRef(tool)
  const viewRef = useRef(viewOptions)
  const selectedIdsRef = useRef(selectedIds)
  const selectedNodeIndicesRef = useRef(selectedNodeIndices)
  const penDraftRef = useRef<PenDraft | null>(null)
  const selectedGuideRef = useRef<string | null>(null)
  const enteredGroupRef = useRef(enteredGroupId)
  const callbacks = useRef({ onUpdate, onUpdateElements, onGestureStart, onGestureEnd, onGestureCancel, onSelectIds, onSelectNodes, onToolChange, onAddElements, onSetGuides, onEscape, onEnterGroup, onEditElements })
  const [draftBounds, setDraftBounds] = useState<Bounds | null>(null)
  const [marqueeBounds, setMarqueeBounds] = useState<Bounds | null>(null)
  const [panning, setPanning] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const [directCursor, setDirectCursor] = useState<string | null>(null)
  const [transformStatus, setTransformStatus] = useState<{ mode: VectorTransformMode; axis: VectorTransformAxis } | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [penDraft, setPenDraftState] = useState<PenDraft | null>(null)
  const [penCursor, setPenCursor] = useState<Point | null>(null)
  const [penCloseHint, setPenCloseHint] = useState(false)
  const [pencilPoints, setPencilPoints] = useState<Point[] | null>(null)
  const [lassoPoints, setLassoPoints] = useState<Point[] | null>(null)
  const [pivot, setPivot] = useState<Point | null>(null)
  const [altDown, setAltDown] = useState(false)
  const [snapMatches, setSnapMatches] = useState<SnapMatch[]>([])
  const [hud, setHud] = useState<VectorHud | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedGuideId, setSelectedGuideState] = useState<string | null>(null)
  const [draftGuide, setDraftGuide] = useState<VectorGuide | null>(null)
  const [coarse, setCoarse] = useState(false)

  const setPenDraft = (draft: PenDraft | null) => {
    penDraftRef.current = draft
    setPenDraftState(draft)
  }
  const setSelectedGuide = (id: string | null) => {
    selectedGuideRef.current = id
    setSelectedGuideState(id)
  }

  const elements = document.elements
  const selectedElements = useMemo(() => elements.filter((element) => selectedIds.includes(element.id)), [elements, selectedIds])
  const selected = selectedElements.length === 1 ? selectedElements[0]! : null
  const editing = tool === 'node' && selected && selected.kind !== 'group' && selected.visible && !selected.locked ? selected : null
  const selectedLeaves = useMemo(() => leafElements(elements, selectedIds).filter((element) => element.visible && !element.locked), [elements, selectedIds])
  const tree = useMemo(() => buildTree(elements), [elements])

  camera.current = { pan, zoom }
  documentRef.current = document
  toolRef.current = tool
  viewRef.current = viewOptions
  selectedIdsRef.current = selectedIds
  selectedNodeIndicesRef.current = selectedNodeIndices
  enteredGroupRef.current = enteredGroupId
  callbacks.current = { onUpdate, onUpdateElements, onGestureStart, onGestureEnd, onGestureCancel, onSelectIds, onSelectNodes, onToolChange, onAddElements, onSetGuides, onEscape, onEnterGroup, onEditElements }

  const point = useCallback((event: Pick<PointerEvent, 'clientX' | 'clientY'>): Point => {
    const svg = svgRef.current
    const world = worldRef.current
    if (!svg || !world) return { x: 0, y: 0 }
    const value = svg.createSVGPoint()
    value.x = event.clientX
    value.y = event.clientY
    const matrix = world.getScreenCTM()?.inverse()
    const local = matrix ? value.matrixTransform(matrix) : value
    return { x: local.x, y: local.y }
  }, [])

  const localClient = useCallback((event: Pick<PointerEvent, 'clientX' | 'clientY'>): Point => {
    const rect = viewportRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }, [])

  const showHud = useCallback((label: string, event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
    const at = localClient(event)
    setHud({ label, x: at.x, y: at.y })
  }, [localClient])

  const snapThreshold = () => SNAP_PX / camera.current.zoom

  const snapTargetsFor = useCallback((excludeIds: string[]): SnapTarget[] => {
    const doc = documentRef.current
    const view = viewRef.current
    const excluded = excludeIds.flatMap((id) => [id, ...descendantIds(doc.elements, id)])
    return collectSnapTargets(doc.elements, excluded, { width: doc.width, height: doc.height }, doc.guides, {
      objects: view.snapToObjects,
      guides: view.snapToGuides && view.guides,
      nodes: view.snapToNodes,
    })
  }, [])

  const snapFreePoint = useCallback((at: Point, targets: SnapTarget[]) => {
    return snapPoint(at, targets, snapThreshold(), { pixel: viewRef.current.snapToPixelGrid })
  }, [])

  useEffect(() => {
    setPivot(null)
  }, [selectedIds])

  useEffect(() => {
    if (!controller) return
    controller.current = {
      fit: (bounds, padding = 48) => {
        const size = viewportRef.current
        if (!size) return
        const doc = documentRef.current
        const target = bounds ?? { x: 0, y: 0, width: doc.width, height: doc.height }
        const width = Math.max(1, target.width)
        const height = Math.max(1, target.height)
        const nextZoom = clamp(Math.min((size.clientWidth - padding * 2) / width, (size.clientHeight - padding * 2) / height), 0.1, 8)
        const center = { x: target.x + width / 2, y: target.y + height / 2 }
        onZoomChange(nextZoom)
        onPanChange({ x: -(center.x - doc.width / 2) * nextZoom, y: -(center.y - doc.height / 2) * nextZoom })
      },
      zoomTo: (nextZoom) => {
        const current = camera.current
        const ratio = clamp(nextZoom, 0.1, 8) / current.zoom
        onZoomChange(clamp(nextZoom, 0.1, 8))
        onPanChange({ x: current.pan.x * ratio, y: current.pan.y * ratio })
      },
    }
    return () => { controller.current = null }
  }, [controller, onPanChange, onZoomChange])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(pointer: coarse)')
    const sync = () => setCoarse(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const sync = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    sync()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync)
      return () => window.removeEventListener('resize', sync)
    }
    const observer = new ResizeObserver(sync)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const current = camera.current
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : 1
      if (event.ctrlKey || event.metaKey) {
        const rect = viewport.getBoundingClientRect()
        const anchor = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }
        const nextZoom = clamp(current.zoom * Math.exp(-event.deltaY * scale * 0.002), 0.1, 8)
        const ratio = nextZoom / current.zoom
        onPanChange({
          x: anchor.x - (anchor.x - current.pan.x) * ratio,
          y: anchor.y - (anchor.y - current.pan.y) * ratio,
        })
        onZoomChange(nextZoom)
        return
      }
      const horizontal = event.shiftKey && Math.abs(event.deltaX) < 1 ? event.deltaY : event.deltaX
      const vertical = event.shiftKey && Math.abs(event.deltaX) < 1 ? 0 : event.deltaY
      onPanChange({ x: current.pan.x - horizontal * scale, y: current.pan.y - vertical * scale })
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [onPanChange, onZoomChange])

  const commitPen = useCallback(() => {
    const draft = penDraftRef.current
    if (!draft) return
    setPenDraft(null)
    setPenCloseHint(false)
    const result = penCommit(draft)
    if (!result) return
    if ('element' in result) {
      callbacks.current.onAddElements([result.element])
    } else {
      callbacks.current.onUpdate(result.id, result.patch)
      callbacks.current.onSelectIds([result.id])
    }
  }, [])

  const clearInteraction = useCallback(() => {
    interaction.current = null
    setDraftBounds(null)
    setMarqueeBounds(null)
    setTransformStatus(null)
    setDirectCursor(null)
    setSnapMatches([])
    setHud(null)
    setDraftGuide(null)
    setPencilPoints(null)
    setLassoPoints(null)
  }, [])

  const cancelInteraction = useCallback(() => {
    const active = interaction.current
    if (!active) return
    const passive = active.kind === 'create' || active.kind === 'marquee' || active.kind === 'node-marquee' || active.kind === 'pen' || active.kind === 'guide-create' || active.kind === 'pencil' || active.kind === 'lasso' || active.kind === 'pivot'
    if (!passive) callbacks.current.onGestureCancel()
    if (active.kind === 'move' && active.originalIds.length) callbacks.current.onSelectIds(active.originalIds)
    clearInteraction()
  }, [clearInteraction])

  useEffect(() => {
    if (tool !== 'pen' && penDraftRef.current) commitPen()
    if (tool !== 'node' && selectedNodeIndicesRef.current.length) callbacks.current.onSelectNodes([])
  }, [tool, commitPen])

  useEffect(() => {
    if (!selectedGuideId) return
    if (!document.guides.some((guide) => guide.id === selectedGuideId)) setSelectedGuide(null)
  }, [document.guides, selectedGuideId])

  useEffect(() => {
    if (selectedIds.length !== 1 && selectedNodeIndicesRef.current.length) callbacks.current.onSelectNodes([])
  }, [selectedIds])

  useEffect(() => {
    const finishModal = (result: 'confirm' | 'cancel') => {
      if (interaction.current?.kind !== 'modal') return
      if (result === 'cancel') callbacks.current.onGestureCancel()
      else callbacks.current.onGestureEnd()
      interaction.current = null
      setTransformStatus(null)
      setHud(null)
    }
    const startModal = (mode: VectorTransformMode) => {
      const doc = documentRef.current
      const editingId = toolRef.current === 'node' && selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0]! : null
      const editingElement = editingId ? doc.elements.find((element) => element.id === editingId) ?? null : null
      const nodeIndices = selectedNodeIndicesRef.current
      if (editingElement && nodeIndices.length > 0 && !editingElement.locked && !interaction.current) {
        const nodes = structuredClone(editingElement.vectorNodes ?? defaultVectorNodes(editingElement))
        const anchors = nodeIndices.flatMap((index) => nodes[index] ? [nodeWorldPosition(editingElement, nodes[index]!)] : [])
        const origin = {
          x: anchors.reduce((sum, value) => sum + value.x, 0) / anchors.length,
          y: anchors.reduce((sum, value) => sum + value.y, 0) / anchors.length,
        }
        let start = latestPointer.current ?? { x: origin.x + Math.max(40, editingElement.width / 2), y: origin.y }
        if (Math.hypot(start.x - origin.x, start.y - origin.y) < 1) {
          start = { x: origin.x + Math.max(40, editingElement.width / 2), y: origin.y }
        }
        callbacks.current.onGestureStart()
        interaction.current = {
          kind: 'modal', target: 'nodes', mode, axis: null, start,
          element: structuredClone(editingElement), nodes, nodeIndices: [...nodeIndices], preview: structuredClone(editingElement),
        }
        setTransformStatus({ mode, axis: null })
        return true
      }
      const leaves = leafElements(doc.elements, selectedIdsRef.current).filter((element) => !element.locked && element.visible)
      if (leaves.length === 0 || toolRef.current !== 'transform' || interaction.current) return false
      const bounds = selectionBounds(leaves)
      const start = latestPointer.current ?? { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }
      callbacks.current.onGestureStart()
      interaction.current = { kind: 'modal', target: 'elements', mode, axis: null, start, elements: structuredClone(leaves), preview: structuredClone(leaves) }
      setTransformStatus({ mode, axis: null })
      return true
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const editable = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)
      if (event.code === 'Space' && !editable) {
        event.preventDefault()
        spaceHeld.current = true
        setSpaceDown(true)
      }
      if (event.key === 'Alt') setAltDown(true)
      if (editable || event.metaKey || event.ctrlKey) return
      const active = interaction.current
      const key = event.key.toLowerCase()
      if (active?.kind === 'modal') {
        const activeKey = active.mode === 'move' ? 'g' : active.mode === 'rotate' ? 'r' : 's'
        if (!event.repeat && key === activeKey) {
          event.preventDefault()
          event.stopImmediatePropagation()
          finishModal('cancel')
          return
        }
        if (key === 'escape' || key === 'enter') {
          event.preventDefault()
          event.stopImmediatePropagation()
          finishModal(key === 'escape' ? 'cancel' : 'confirm')
          return
        }
        if (active.mode !== 'rotate' && (key === 'x' || key === 'y')) {
          event.preventDefault()
          event.stopImmediatePropagation()
          active.axis = active.axis === key ? null : key
          active.start = latestPointer.current ?? active.start
          if (active.target === 'elements') {
            active.elements = structuredClone(active.preview)
          } else {
            active.element = structuredClone(active.preview)
            active.nodes = structuredClone(active.preview.vectorNodes ?? defaultVectorNodes(active.preview))
          }
          setTransformStatus({ mode: active.mode, axis: active.axis })
        }
        return
      }
      if (event.altKey) return
      if (key === 'escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (active) {
          cancelInteraction()
          return
        }
        if (penDraftRef.current) {
          if (penDraftRef.current.nodes.length >= 2) commitPen()
          else { setPenDraft(null); setPenCloseHint(false) }
          return
        }
        if (toolRef.current === 'node') {
          callbacks.current.onSelectNodes([])
          callbacks.current.onToolChange('select')
          return
        }
        if (selectedGuideRef.current) {
          setSelectedGuide(null)
          return
        }
        callbacks.current.onEscape()
        return
      }
      if (penDraftRef.current) {
        if (key === 'enter') {
          event.preventDefault()
          event.stopImmediatePropagation()
          commitPen()
          return
        }
        if (key === 'backspace' || key === 'delete') {
          event.preventDefault()
          event.stopImmediatePropagation()
          const next = penRemoveLast(penDraftRef.current)
          setPenDraft(next)
          if (!next) setPenCloseHint(false)
          return
        }
      }
      if (selectedGuideRef.current && (key === 'backspace' || key === 'delete')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        callbacks.current.onSetGuides(removeGuide(documentRef.current.guides, selectedGuideRef.current))
        setSelectedGuide(null)
        return
      }
      const editingId = toolRef.current === 'node' && selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0]! : null
      const editingElement = editingId ? documentRef.current.elements.find((element) => element.id === editingId) ?? null : null
      if (editingElement && (key === 'backspace' || key === 'delete')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const nodeIndices = selectedNodeIndicesRef.current
        if (nodeIndices.length === 0) return
        const nodes = editingElement.vectorNodes ?? defaultVectorNodes(editingElement)
        const rebuilt = deleteNodes(editingElement, nodes, nodeIndices)
        if (!rebuilt) return
        callbacks.current.onUpdate(editingElement.id, { ...rebuilt, kind: editingElement.kind === 'group' ? editingElement.kind : 'path' })
        callbacks.current.onSelectNodes([])
        return
      }
      if (editingElement && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const nodeIndices = selectedNodeIndicesRef.current
        if (nodeIndices.length === 0) return
        const nodes = editingElement.vectorNodes ?? defaultVectorNodes(editingElement)
        const amount = event.shiftKey ? 10 : 1
        const delta = {
          x: key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0,
          y: key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0,
        }
        callbacks.current.onUpdate(editingElement.id, transformVectorNodes(editingElement, nodes, nodeIndices, 'move', null, { x: 0, y: 0 }, delta))
        return
      }
      if (!event.repeat && (key === 'g' || key === 'r' || key === 's')) {
        const mode: VectorTransformMode = key === 'g' ? 'move' : key === 'r' ? 'rotate' : 'scale'
        if (startModal(mode)) {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltDown(false)
      if (event.code !== 'Space') return
      spaceHeld.current = false
      setSpaceDown(false)
    }
    const onPointerMove = (event: PointerEvent) => {
      const current = point(event)
      latestPointer.current = current
      latestClient.current = { x: event.clientX, y: event.clientY }
      const active = interaction.current
      if (active?.kind !== 'modal') return
      event.preventDefault()
      if (active.target === 'elements') {
        const origin = elementCenter(selectionBounds(active.elements))
        const updates = transformElements(active.mode, active.axis, active.elements, active.start, current, active.elements.length > 1 ? origin : undefined)
          .map((update) => ({ ...update, patch: viewRef.current.snapToPixelGrid ? snapGeometryPatch(update.patch) : update.patch }))
        const byId = new Map(updates.map((update) => [update.id, update.patch]))
        active.preview = active.elements.map((element) => ({ ...element, ...byId.get(element.id) }))
        callbacks.current.onUpdateElements(updates, false)
        const label = active.mode === 'move'
          ? `Δ ${round(current.x - active.start.x)}, ${round(current.y - active.start.y)}`
          : active.mode === 'rotate' && active.preview.length === 1
            ? `${round(active.preview[0]!.rotation)}°`
            : `${round(selectionBounds(active.preview).width)} × ${round(selectionBounds(active.preview).height)}`
        showHud(label, event)
      } else {
        const rawPatch = transformVectorNodes(active.element, active.nodes, active.nodeIndices, active.mode, active.axis, active.start, current)
        const patch = viewRef.current.snapToPixelGrid ? snapGeometryPatch(rawPatch) : rawPatch
        active.preview = { ...active.element, ...patch }
        callbacks.current.onUpdate(active.element.id, patch, false)
        showHud(`Δ ${round(current.x - active.start.x)}, ${round(current.y - active.start.y)}`, event)
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (interaction.current?.kind !== 'modal' || event.button !== 0 && event.button !== 2) return
      event.preventDefault()
      event.stopPropagation()
      finishModal(event.button === 2 ? 'cancel' : 'confirm')
    }
    const onBlur = () => {
      spaceHeld.current = false
      setSpaceDown(false)
      setAltDown(false)
      finishModal('cancel')
      if (penDraftRef.current) commitPen()
    }
    // Registered from a child effect, so this listener runs before the page's window listener
    // and can stop propagation for keys the canvas owns (Escape, Enter, Backspace, arrows).
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [point, cancelInteraction, commitPen, showHud])

  const beginMove = (event: ReactPointerEvent<Element>, ids: string[], toggleOnClick: string | null = null) => {
    const doc = documentRef.current
    const leaves = leafElements(doc.elements, ids).filter((element) => element.visible && !element.locked)
    let moving = structuredClone(leaves)
    if (event.altKey) {
      // The copies join the open gesture, so the duplicate and the move undo together.
      const { ids: copies, idMap } = onDuplicateElements(ids, 0)
      if (copies.length) {
        moving = moving.map((element) => ({ ...element, id: idMap[element.id] ?? element.id }))
        onSelectIds(copies)
      }
    }
    interaction.current = {
      kind: 'move', pointerId: event.pointerId, start: point(event.nativeEvent),
      elements: moving, bounds: selectionBounds(leaves), originalIds: ids, targets: snapTargetsFor(ids), moved: false, toggleOnClick,
    }
    setDirectCursor('move')
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = interaction.current
    if (!active || active.kind === 'modal' || active.pointerId !== event.pointerId) return
    if (active.kind === 'create') {
      const bounds = boundsBetween(active.start, active.current, event.shiftKey)
      if (bounds.width >= 2 && bounds.height >= 2) {
        onAddElements([createVectorElement(tool === 'ellipse' ? 'ellipse' : 'rectangle', viewOptions.snapToPixelGrid ? snapBounds(bounds) : bounds)])
      }
    } else if (active.kind === 'marquee') {
      const bounds = boundsBetween(active.start, active.current, false)
      const scope = enteredGroupId
      // A plain click on empty canvas (no drag) selects nothing, even inside an unfilled shape's box.
      const candidates = bounds.width < 2 && bounds.height < 2 ? [] : childrenOf(elements, scope).filter((element) => element.visible && !element.locked)
      const hits = candidates.filter((element) => {
        const leaves = element.kind === 'group' ? leafElements(elements, [element.id]).filter((leaf) => leaf.visible) : [element]
        return leaves.some((leaf) => intersects(bounds, selectionBounds([leaf])))
      }).map((element) => element.id)
      onSelectIds(active.additive ? [...new Set([...selectedIds, ...hits])] : hits)
      setMarqueeBounds(null)
    } else if (active.kind === 'node-marquee') {
      const bounds = boundsBetween(active.start, active.current, false)
      const hits = nodeIndicesInBounds(active.element, active.nodes, bounds)
      onSelectNodes(active.additive ? [...new Set([...selectedNodeIndicesRef.current, ...hits])] : hits)
      setMarqueeBounds(null)
    } else if (active.kind === 'move') {
      if (active.moved) onGestureEnd()
      else {
        onGestureCancel()
        if (active.toggleOnClick) onSelectIds(selectedIds.filter((id) => id !== active.toggleOnClick))
      }
    } else if (active.kind === 'lasso') {
      const polygon = active.points
      if (polygon.length >= 3) {
        if (editing) {
          const nodes = editing.vectorNodes ?? defaultVectorNodes(editing)
          const hits = nodes.flatMap((node, index) => pointInPolygon(nodeWorldPosition(editing, node), polygon) ? [index] : [])
          onSelectNodes(active.additive ? [...new Set([...selectedNodeIndicesRef.current, ...hits])] : hits)
        } else {
          const candidates = childrenOf(elements, enteredGroupId).filter((element) => element.visible && !element.locked)
          const hits = candidates.filter((element) => {
            const leaves = element.kind === 'group' ? leafElements(elements, [element.id]).filter((leaf) => leaf.visible) : [element]
            return leaves.some((leaf) => elementInLasso(leaf, polygon))
          }).map((element) => element.id)
          onSelectIds(active.additive ? [...new Set([...selectedIds, ...hits])] : hits)
        }
      } else if (!active.additive && !editing) {
        onSelectIds([])
      }
    } else if (active.kind === 'pencil') {
      const nodes = pencilNodes(active.points, zoom)
      if (nodes.length >= 2) {
        const first = nodes[0]!.anchor
        const last = nodes[nodes.length - 1]!.anchor
        const closed = nodes.length >= 3 && Math.hypot(first.x - last.x, first.y - last.y) <= PEN_CLOSE_PX / zoom
        const built = elementFromWorldNodes(closed ? nodes.slice(0, -1) : nodes)
        onAddElements([createVectorElement('path', built, { vectorNodes: built.vectorNodes, closed, name: 'Pencil' })])
      }
    } else if (active.kind === 'pen' || active.kind === 'guide-create') {
      /* draft-only */
    } else if (active.kind === 'guide-move') {
      const client = localClient(event.nativeEvent)
      const onRuler = (active.guide.axis === 'y' && client.y <= RULER_SIZE) || (active.guide.axis === 'x' && client.x <= RULER_SIZE)
      if (onRuler) {
        onGestureCancel()
        onSetGuides(removeGuide(documentRef.current.guides, active.guide.id))
        setSelectedGuide(null)
      } else {
        onGestureEnd()
      }
    } else {
      onGestureEnd()
    }
    clearInteraction()
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
  }

  const abort = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = interaction.current
    if (!active || active.kind === 'modal') return
    cancelInteraction()
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
  }

  const startResize = (event: ReactPointerEvent<SVGElement>, handle: DirectResizeHandle, single: VectorElement | null, leaves: VectorElement[]) => {
    if (event.button !== 0) return
    event.stopPropagation()
    onGestureStart()
    const ids = single ? [single.id] : selectedIds
    interaction.current = {
      kind: 'resize', pointerId: event.pointerId, start: point(event.nativeEvent),
      elements: structuredClone(leaves), bounds: selectionBounds(leaves), handle, single: single ? structuredClone(single) : null, targets: snapTargetsFor(ids),
    }
    setDirectCursor(resizeCursor(handle, single?.rotation ?? 0))
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const startRotate = (event: ReactPointerEvent<SVGElement>, single: VectorElement | null, leaves: VectorElement[]) => {
    if (event.button !== 0) return
    event.stopPropagation()
    onGestureStart()
    const bounds = selectionBounds(leaves)
    interaction.current = {
      kind: 'rotate', pointerId: event.pointerId, start: point(event.nativeEvent),
      elements: structuredClone(leaves), center: pivot ?? (single ? elementCenter(single) : elementCenter(bounds)), single: single ? structuredClone(single) : null,
    }
    setTransformStatus({ mode: 'rotate', axis: null })
    setDirectCursor('var(--cursor-rotate)')
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const onShapePointerDown = (element: VectorElement, event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0) return
    if (tool === 'pen' || tool === 'rectangle' || tool === 'ellipse') return
    event.stopPropagation()
    const resolved = resolveSelection(elements, element.id, enteredGroupId, event.metaKey || event.ctrlKey)
    const resolvedElement = elements.find((item) => item.id === resolved) ?? element
    if (tool === 'node') {
      if (editing && editing.id === element.id) {
        const at = point(event.nativeEvent)
        if (!event.shiftKey) onSelectNodes([])
        interaction.current = {
          kind: 'node-marquee', pointerId: event.pointerId, start: at, current: at,
          additive: event.shiftKey, outside: false, element: structuredClone(editing), nodes: structuredClone(editing.vectorNodes ?? defaultVectorNodes(editing)),
        }
        setMarqueeBounds({ x: at.x, y: at.y, width: 0, height: 0 })
        svgRef.current?.setPointerCapture(event.pointerId)
        return
      }
      onSelectIds([resolvedElement.id])
      onSelectNodes([])
      if (resolvedElement.kind === 'group') onToolChange('select')
      return
    }
    let ids = selectedIds
    let toggleOnClick: string | null = null
    if (event.shiftKey) {
      // Shift-drag moves the whole selection; a Shift-click (no movement) toggles on pointer up.
      if (selectedIds.includes(resolved)) toggleOnClick = resolved
      else {
        ids = [...selectedIds, resolved]
        onSelectIds(ids)
      }
    } else if (!selectedIds.includes(resolved)) {
      ids = [resolved]
      onSelectIds(ids)
    }
    if (tool !== 'select' || resolvedElement.locked) return
    onGestureStart()
    beginMove(event, ids, toggleOnClick)
  }

  /**
   * Double-clicks arrive on the SVG because pointer capture retargets the compatibility mouse
   * events, so the shape under the pointer is looked up from the document instead.
   */
  const onCanvasDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const stack = window.document.elementsFromPoint(event.clientX, event.clientY)
    const nodeHit = stack.map((node) => (node as Element).closest('[data-vector-node]')?.getAttribute('data-vector-node') ?? null).find((value): value is string => value !== null)
    if (nodeHit !== undefined && editing) {
      onNodeDoubleClick(Number(nodeHit), event)
      return
    }
    const hit = stack
      .map((node) => (node as Element).closest('[data-vector-element]')?.getAttribute('data-vector-element') ?? null)
      .find((id): id is string => !!id)
    const element = hit ? elements.find((item) => item.id === hit) ?? null : null
    if (!element) {
      if (tool === 'node') onToolChange('select')
      return
    }
    onShapeDoubleClick(element, event)
  }

  const onShapeDoubleClick = (element: VectorElement, event: ReactMouseEvent<SVGElement>) => {
    if (tool !== 'select' && tool !== 'transform') return
    event.preventDefault()
    event.stopPropagation()
    const resolved = resolveSelection(elements, element.id, enteredGroupId, event.metaKey || event.ctrlKey)
    const resolvedElement = elements.find((item) => item.id === resolved) ?? element
    if (interaction.current && interaction.current.kind !== 'modal') cancelInteraction()
    if (resolvedElement.kind === 'group') {
      onEnterGroup(resolvedElement.id)
      onSelectIds([resolveSelection(elements, element.id, resolvedElement.id)])
      return
    }
    if (resolvedElement.locked) return
    onSelectIds([resolvedElement.id])
    onSelectNodes([])
    onToolChange('node')
  }

  const onCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const targetElement = event.target as Element
    const drawing = tool === 'pen' || tool === 'pencil' || tool === 'rectangle' || tool === 'ellipse' || tool === 'lasso'
    // Drawing tools work on top of existing shapes; selection tools leave shape clicks to the shapes.
    if (!drawing && targetElement !== event.currentTarget && targetElement.closest('[data-vector-element], [data-vector-handle], [data-vector-rotate], [data-vector-guide], [data-vector-node], [data-vector-control], [data-vector-segment]')) return
    const rawAt = point(event.nativeEvent)
    const at = tool === 'pen' && event.shiftKey && penDraftRef.current ? constrainAngle(penDraftRef.current.nodes[penDraftRef.current.nodes.length - 1]!.anchor, rawAt) : rawAt
    if (tool === 'lasso') {
      interaction.current = { kind: 'lasso', pointerId: event.pointerId, points: [rawAt], additive: event.shiftKey }
      setLassoPoints([rawAt])
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'pencil') {
      onSelectIds([])
      interaction.current = { kind: 'pencil', pointerId: event.pointerId, points: [rawAt] }
      setPencilPoints([rawAt])
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'pen') {
      const draft = penDraftRef.current
      const threshold = PEN_CLOSE_PX / zoom
      if (!draft) {
        const endpoint = findOpenEndpoint(elements, at, threshold)
        const next = endpoint ? penFromElement(endpoint.element, endpoint.end, endpoint.subpath) : null
        const started = next ?? penStart(snapFreePoint(at, snapTargetsFor([])).point)
        setPenDraft(started)
        onSelectIds(endpoint ? [endpoint.element.id] : [])
        interaction.current = { kind: 'pen', pointerId: event.pointerId, anchorIndex: started.nodes.length - 1 }
        if (endpoint) interaction.current = null
        else event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
      if (penCanClose(draft, at, threshold)) {
        setPenDraft(penClose(draft))
        penDraftRef.current = penClose(draft)
        commitPen()
        return
      }
      const target = findOpenEndpoint(elements, at, threshold)
      if (target && !(draft.continue && target.element.id === draft.continue.id && target.subpath === draft.continue.subpath)) {
        // Joining onto another free end: commit the draft, merge both objects, connect the ends.
        const result = penCommit(draft)
        if (result) {
          const source = 'element' in result ? result.element : { ...draft.continue!.element, ...result.patch }
          const joinIndex = 'element' in result ? source.vectorNodes!.length - 1 : lastNodeOfSubpath(source, draft.continue!.subpath)
          const same = target.element.id === source.id
          const nodesOf = (element: VectorElement) => element.vectorNodes ?? defaultVectorNodes(element)
          const combined = same ? null : combineElements([source, target.element], nodesOf)
          const base: VectorElement = combined ? { ...source, ...combined, kind: 'path', rotation: 0 } : source
          const offset = same ? 0 : (source.vectorNodes?.length ?? 0)
          const joined = joinNodes(base, base.vectorNodes!, joinIndex, offset + target.index)
          const final: VectorElement = joined ? { ...base, ...joined } : base
          setPenDraft(null)
          setPenCloseHint(false)
          onEditElements((current) => {
            const without = current.filter((element) => element.id !== final.id && element.id !== target.element.id)
            const anchor = current.findIndex((element) => element.id === target.element.id || element.id === final.id)
            const at = Math.max(0, Math.min(without.length, anchor < 0 ? without.length : anchor))
            return [...without.slice(0, at), final, ...without.slice(at)]
          })
          onSelectIds([final.id])
        }
        return
      }
      const snapped = snapFreePoint(at, snapTargetsFor(draft.continue ? [draft.continue.id] : [])).point
      const next = penAddAnchor(draft, snapped)
      setPenDraft(next)
      interaction.current = { kind: 'pen', pointerId: event.pointerId, anchorIndex: next.nodes.length - 1 }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'node' && editing) {
      if (!event.shiftKey) onSelectNodes([])
      interaction.current = {
        kind: 'node-marquee', pointerId: event.pointerId, start: at, current: at,
        additive: event.shiftKey, outside: true, element: structuredClone(editing), nodes: structuredClone(editing.vectorNodes ?? defaultVectorNodes(editing)),
      }
      setMarqueeBounds({ x: at.x, y: at.y, width: 0, height: 0 })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'select' || tool === 'transform' || tool === 'node') {
      setSelectedGuide(null)
      if (!event.shiftKey) {
        onSelectIds([])
        if (enteredGroupId) onEnterGroup(null)
      }
      if (tool === 'node') onToolChange('select')
      interaction.current = { kind: 'marquee', pointerId: event.pointerId, start: at, current: at, additive: event.shiftKey }
      setMarqueeBounds({ x: at.x, y: at.y, width: 0, height: 0 })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    const targets = snapTargetsFor([])
    const start = snapFreePoint(at, targets).point
    interaction.current = { kind: 'create', pointerId: event.pointerId, start, current: start, targets }
    setDraftBounds({ x: start.x, y: start.y, width: 0, height: 0 })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onCanvasPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = interaction.current
    const at = point(event.nativeEvent)
    if (tool === 'pen' && (!active || active.kind !== 'pen')) {
      const draft = penDraftRef.current
      const last = draft?.nodes[draft.nodes.length - 1]?.anchor
      const constrained = event.shiftKey && last ? constrainAngle(last, at) : at
      const snapped = snapFreePoint(constrained, snapTargetsFor(draft?.continue ? [draft.continue.id] : [])).point
      setPenCursor(snapped)
      setPenCloseHint(!!draft && penCanClose(draft, at, PEN_CLOSE_PX / zoom))
      if (last) {
        const length = Math.hypot(snapped.x - last.x, snapped.y - last.y)
        const angle = normalizeDegrees(Math.atan2(-(snapped.y - last.y), snapped.x - last.x) * 180 / Math.PI)
        showHud(`${round(length)} · ${round(angle)}°`, event.nativeEvent)
      }
    }
    if (!active || active.kind === 'modal' || active.pointerId !== event.pointerId) return
    if (active.kind === 'pen') {
      const draft = penDraftRef.current
      if (!draft) return
      const anchor = draft.nodes[active.anchorIndex]!.anchor
      const handleAt = event.shiftKey ? constrainAngle(anchor, at) : at
      const next = penDragHandle(draft, active.anchorIndex, handleAt, event.altKey)
      setPenDraft(next)
      showHud(`${round(Math.hypot(handleAt.x - anchor.x, handleAt.y - anchor.y))} · ${round(normalizeDegrees(Math.atan2(-(handleAt.y - anchor.y), handleAt.x - anchor.x) * 180 / Math.PI))}°`, event.nativeEvent)
      return
    }
    if (active.kind === 'lasso') {
      const last = active.points[active.points.length - 1]!
      if (Math.hypot(at.x - last.x, at.y - last.y) * zoom < 2) return
      active.points.push(at)
      setLassoPoints([...active.points])
      return
    }
    if (active.kind === 'pivot') {
      const snapped = snapFreePoint(at, snapTargetsFor([])).point
      setPivot(snapped)
      showHud(`Pivot ${round(snapped.x)}, ${round(snapped.y)}`, event.nativeEvent)
      return
    }
    if (active.kind === 'pencil') {
      const last = active.points[active.points.length - 1]!
      if (Math.hypot(at.x - last.x, at.y - last.y) * zoom < 1.5) return
      active.points.push(at)
      setPencilPoints([...active.points])
      return
    }
    if (active.kind === 'bend') {
      onUpdate(active.element.id, bendSegment(active.element, active.nodes, active.segmentIndex, active.t, at), false)
      return
    }
    if (active.kind === 'node-resize') {
      const pointer = snapFreePoint(at, []).point
      const next = resizeBounds(active.bounds, active.handle, pointer, { lockRatio: event.shiftKey, fromCenter: event.altKey })
      onUpdate(active.element.id, scaleNodesToBounds(active.element, active.nodes, active.nodeIndices, active.bounds, next), false)
      showHud(`${round(next.width)} × ${round(next.height)}`, event.nativeEvent)
      return
    }
    if (active.kind === 'node-rotate') {
      let current = at
      const startAngle = Math.atan2(active.start.y - active.center.y, active.start.x - active.center.x)
      let delta = Math.atan2(at.y - active.center.y, at.x - active.center.x) - startAngle
      if (event.shiftKey) {
        delta = snapAngle(delta * 180 / Math.PI) * Math.PI / 180
        const radius = Math.hypot(at.x - active.center.x, at.y - active.center.y)
        current = { x: active.center.x + Math.cos(startAngle + delta) * radius, y: active.center.y + Math.sin(startAngle + delta) * radius }
      }
      onUpdate(active.element.id, transformVectorNodes(active.element, active.nodes, active.nodeIndices, 'rotate', null, active.start, current, active.center), false)
      showHud(`${round(normalizeDegrees(delta * 180 / Math.PI))}°`, event.nativeEvent)
      return
    }
    if (active.kind === 'create') {
      const snapped = snapFreePoint(at, active.targets)
      active.current = snapped.point
      const bounds = boundsBetween(active.start, snapped.point, event.shiftKey)
      setDraftBounds(bounds)
      setSnapMatches(snapped.matches)
      showHud(`${bounds.width} × ${bounds.height}`, event.nativeEvent)
      return
    }
    if (active.kind === 'marquee' || active.kind === 'node-marquee') {
      active.current = at
      setMarqueeBounds(boundsBetween(active.start, at, false))
      return
    }
    if (active.kind === 'move') {
      let dx = at.x - active.start.x
      let dy = at.y - active.start.y
      if (!active.moved && Math.hypot(dx, dy) * zoom < 3) return
      active.moved = true
      if (event.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0
        else dx = 0
      }
      const snapped = snapBoundsDelta(active.bounds, { x: dx, y: dy }, active.targets, snapThreshold(), { pixel: viewOptions.snapToPixelGrid })
      onUpdateElements(active.elements.map((element) => ({
        id: element.id,
        patch: { x: round(element.x + snapped.dx), y: round(element.y + snapped.dy) },
      })), false)
      setSnapMatches(snapped.matches)
      showHud(`Δ ${round(snapped.dx)}, ${round(snapped.dy)}`, event.nativeEvent)
      return
    }
    if (active.kind === 'resize') {
      const affectsX = active.handle.includes('e') || active.handle.includes('w')
      const affectsY = active.handle.includes('n') || active.handle.includes('s')
      const snapped = snapPoint(at, active.targets, snapThreshold(), { pixel: viewOptions.snapToPixelGrid })
      const pointer = { x: affectsX ? snapped.point.x : at.x, y: affectsY ? snapped.point.y : at.y }
      const matches = snapped.matches.filter((match) => (match.axis === 'x' && affectsX) || (match.axis === 'y' && affectsY))
      if (active.single) {
        const patch = resizeElement(active.single, active.handle, pointer, { lockRatio: event.shiftKey, fromCenter: event.altKey })
        onUpdate(active.single.id, viewOptions.snapToPixelGrid ? snapGeometryPatch(patch) : patch, false)
        showHud(`${round(patch.width)} × ${round(patch.height)}`, event.nativeEvent)
      } else {
        const next = resizeBounds(active.bounds, active.handle, pointer, { lockRatio: event.shiftKey, fromCenter: event.altKey })
        const map = boxMap(active.bounds, next)
        const updates = active.elements.map((leaf) => ({ id: leaf.id, patch: transformElementAffine(leaf, map) }))
          .map((update) => ({ ...update, patch: viewOptions.snapToPixelGrid ? snapGeometryPatch(update.patch) : update.patch }))
        onUpdateElements(updates, false)
        showHud(`${round(next.width)} × ${round(next.height)}`, event.nativeEvent)
      }
      setSnapMatches(matches)
      return
    }
    if (active.kind === 'node') {
      if (active.part === 'anchor') {
        const candidate = { x: active.anchorStart.x + at.x - active.start.x, y: active.anchorStart.y + at.y - active.start.y }
        const snapped = snapFreePoint(candidate, active.targets)
        const current = { x: active.start.x + snapped.point.x - active.anchorStart.x, y: active.start.y + snapped.point.y - active.anchorStart.y }
        onUpdate(active.element.id, transformVectorNodes(active.element, active.nodes, active.nodeIndices, 'move', null, active.start, current), false)
        setSnapMatches(snapped.matches)
        showHud(`${round(snapped.point.x)}, ${round(snapped.point.y)}`, event.nativeEvent)
      } else {
        onUpdate(active.element.id, moveVectorNode(active.element, active.nodes, active.nodeIndex, active.part, at, !event.altKey), false)
        showHud(`${round(at.x)}, ${round(at.y)}`, event.nativeEvent)
      }
      return
    }
    if (active.kind === 'guide-move') {
      const snapped = snapFreePoint(at, active.targets).point
      const position = active.guide.axis === 'x' ? snapped.x : snapped.y
      onSetGuides(moveGuide(documentRef.current.guides, active.guide.id, position), false)
      showHud(`${active.guide.axis === 'x' ? 'X' : 'Y'} ${round(position)}`, event.nativeEvent)
      return
    }
    if (active.kind === 'rotate') {
      if (active.single && !pivot) {
        const patch = transformElement('rotate', null, active.single, active.start, at)
        if (event.shiftKey && typeof patch.rotation === 'number') patch.rotation = snapAngle(patch.rotation)
        onUpdate(active.single.id, patch, false)
        showHud(`${round(patch.rotation ?? 0)}°`, event.nativeEvent)
      } else {
        let current = at
        if (event.shiftKey) {
          const startAngle = Math.atan2(active.start.y - active.center.y, active.start.x - active.center.x)
          const angle = Math.atan2(at.y - active.center.y, at.x - active.center.x)
          const snappedDelta = snapAngle((angle - startAngle) * 180 / Math.PI) * Math.PI / 180
          const radius = Math.hypot(at.x - active.center.x, at.y - active.center.y)
          current = { x: active.center.x + Math.cos(startAngle + snappedDelta) * radius, y: active.center.y + Math.sin(startAngle + snappedDelta) * radius }
        }
        const updates = transformElements('rotate', null, active.elements, active.start, current, active.center)
        onUpdateElements(updates, false)
        const delta = Math.atan2(current.y - active.center.y, current.x - active.center.x) - Math.atan2(active.start.y - active.center.y, active.start.x - active.center.x)
        showHud(`${round(normalizeDegrees(delta * 180 / Math.PI))}°`, event.nativeEvent)
      }
    }
  }

  const onGuidePointerDown = (guide: VectorGuide, event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0 || tool !== 'select' && tool !== 'transform') return
    event.stopPropagation()
    setSelectedGuide(guide.id)
    onGestureStart()
    interaction.current = { kind: 'guide-move', pointerId: event.pointerId, guide, targets: snapTargetsFor([]) }
    setDirectCursor(guide.axis === 'x' ? 'col-resize' : 'row-resize')
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const onRulerPointerDown = (axis: 'x' | 'y', event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !viewOptions.guides) return
    event.preventDefault()
    interaction.current = { kind: 'guide-create', pointerId: event.pointerId, axis }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDirectCursor(axis === 'x' ? 'col-resize' : 'row-resize')
  }

  const onRulerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = interaction.current
    if (active?.kind !== 'guide-create' || active.pointerId !== event.pointerId) return
    const client = localClient(event.nativeEvent)
    const onRuler = active.axis === 'y' ? client.y <= RULER_SIZE : client.x <= RULER_SIZE
    if (onRuler) {
      setDraftGuide(null)
      setHud(null)
      return
    }
    const at = point(event.nativeEvent)
    const snapped = snapFreePoint(at, snapTargetsFor([])).point
    const position = active.axis === 'x' ? snapped.x : snapped.y
    setDraftGuide({ id: 'draft', axis: active.axis, position })
    showHud(`${active.axis === 'x' ? 'X' : 'Y'} ${round(position)}`, event.nativeEvent)
  }

  const onRulerPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = interaction.current
    if (active?.kind !== 'guide-create' || active.pointerId !== event.pointerId) return
    if (draftGuide) {
      const guide = createGuide(draftGuide.axis, draftGuide.position)
      onSetGuides(addGuide(documentRef.current.guides, guide))
      setSelectedGuide(guide.id)
    }
    clearInteraction()
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
  }

  const onNodePointerDown = (nodeIndex: number, part: NodePart, event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0 || !editing) return
    event.stopPropagation()
    if (tool === 'pen') return
    let nodes = structuredClone(editing.vectorNodes ?? defaultVectorNodes(editing))
    if (part === 'anchor' && (event.metaKey || event.ctrlKey)) {
      // ⌘ on a smooth node makes it a corner; ⌘-drag on a corner pulls out mirrored handles.
      const node = nodes[nodeIndex]!
      if (isSmoothNode(node)) {
        onUpdate(editing.id, toggleNodeType(editing, nodes, nodeIndex))
        onSelectNodes([nodeIndex])
        return
      }
      nodes = seedHandles(nodes, nodeIndex)
      onSelectNodes([nodeIndex])
      onGestureStart()
      onUpdate(editing.id, { vectorNodes: nodes }, false)
      interaction.current = {
        kind: 'node', pointerId: event.pointerId, start: point(event.nativeEvent), anchorStart: nodeWorldPosition(editing, nodes[nodeIndex]!),
        element: structuredClone({ ...editing, vectorNodes: nodes }), nodes, nodeIndices: [nodeIndex], nodeIndex, part: 'out', targets: [],
      }
      setDirectCursor('crosshair')
      svgRef.current?.setPointerCapture(event.pointerId)
      return
    }
    if (part === 'anchor' && event.shiftKey) {
      onSelectNodes(selectedNodeIndices.includes(nodeIndex)
        ? selectedNodeIndices.filter((index) => index !== nodeIndex)
        : [...selectedNodeIndices, nodeIndex])
      return
    }
    const nodeIndices = part === 'anchor' && selectedNodeIndices.includes(nodeIndex)
      ? selectedNodeIndices
      : [nodeIndex]
    onSelectNodes(nodeIndices)
    onGestureStart()
    interaction.current = {
      kind: 'node', pointerId: event.pointerId, start: point(event.nativeEvent), anchorStart: nodeWorldPosition(editing, nodes[nodeIndex]!),
      element: structuredClone(editing), nodes, nodeIndices, nodeIndex, part, targets: snapTargetsFor([editing.id]),
    }
    setDirectCursor(part === 'anchor' ? 'move' : 'crosshair')
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const onNodeDoubleClick = (nodeIndex: number, event: ReactMouseEvent<SVGElement>) => {
    if (!editing) return
    event.preventDefault()
    event.stopPropagation()
    if (interaction.current && interaction.current.kind !== 'modal') cancelInteraction()
    const nodes = editing.vectorNodes ?? defaultVectorNodes(editing)
    onUpdate(editing.id, toggleNodeType(editing, nodes, nodeIndex))
    onSelectNodes([nodeIndex])
  }

  const onSegmentPointerDown = (event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0 || !editing) return
    event.stopPropagation()
    const at = point(event.nativeEvent)
    const nodes = editing.vectorNodes ?? defaultVectorNodes(editing)
    const hit = nearestSegment(editing, nodes, at)
    if (!hit) return
    onGestureStart()
    if (event.metaKey || event.ctrlKey) {
      onSelectNodes([])
      interaction.current = { kind: 'bend', pointerId: event.pointerId, element: structuredClone(editing), nodes: structuredClone(nodes), segmentIndex: hit.index, t: hit.t }
      setDirectCursor('move')
      svgRef.current?.setPointerCapture(event.pointerId)
      return
    }
    const inserted = insertNode(editing, nodes, hit.index, hit.t)
    const { insertedIndex, ...patch } = inserted
    onUpdate(editing.id, patch, false)
    const next = { ...editing, ...patch }
    onSelectNodes([insertedIndex])
    interaction.current = {
      kind: 'node', pointerId: event.pointerId, start: at, anchorStart: hit.point,
      element: structuredClone(next), nodes: structuredClone(patch.vectorNodes), nodeIndices: [insertedIndex], nodeIndex: insertedIndex, part: 'anchor', targets: snapTargetsFor([editing.id]),
    }
    setDirectCursor('move')
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const startNodeResize = (handle: DirectResizeHandle, event: ReactPointerEvent<SVGElement>) => {
    if (!editing || event.button !== 0) return
    event.stopPropagation()
    const nodes = structuredClone(editing.vectorNodes ?? defaultVectorNodes(editing))
    const bounds = nodeSelectionBounds(editing, nodes, selectedNodeIndices)
    if (!bounds) return
    onGestureStart()
    interaction.current = { kind: 'node-resize', pointerId: event.pointerId, element: structuredClone(editing), nodes, nodeIndices: [...selectedNodeIndices], bounds, handle }
    setDirectCursor(resizeCursor(handle, 0))
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const startNodeRotate = (event: ReactPointerEvent<SVGElement>) => {
    if (!editing || event.button !== 0) return
    event.stopPropagation()
    const nodes = structuredClone(editing.vectorNodes ?? defaultVectorNodes(editing))
    const bounds = nodeSelectionBounds(editing, nodes, selectedNodeIndices)
    if (!bounds) return
    onGestureStart()
    interaction.current = { kind: 'node-rotate', pointerId: event.pointerId, start: point(event.nativeEvent), element: structuredClone(editing), nodes, nodeIndices: [...selectedNodeIndices], center: elementCenter(bounds) }
    setTransformStatus({ mode: 'rotate', axis: null })
    setDirectCursor('var(--cursor-rotate)')
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const nodeBox = editing && selectedNodeIndices.length > 1 ? nodeSelectionBounds(editing, editing.vectorNodes ?? defaultVectorNodes(editing), selectedNodeIndices) : null

  const showHandles = (tool === 'select') && selectedLeaves.length > 0 && !editing
  const singleDirect = showHandles && selectedElements.length === 1 && selected && selected.kind !== 'group' ? selected : null
  const multiBounds = showHandles && !singleDirect ? selectionBounds(selectedLeaves) : null
  const enteredGroup = enteredGroupId ? elements.find((element) => element.id === enteredGroupId) ?? null : null
  const hoverOutline = hoveredId && !interaction.current && (tool === 'select' || tool === 'transform') ? elements.find((element) => element.id === resolveSelection(elements, hoveredId, enteredGroupId)) ?? null : null
  const openEndpoints = tool === 'pen' ? elements.flatMap((element) => {
    if (!isHittable(element) || !element.vectorNodes) return []
    return openEndpointsOf(element).map((end) => ({ id: `${element.id}-${end.index}`, point: end.point }))
  }) : []

  return (
    <div
      ref={viewportRef}
      className="vector-canvas"
      data-tool={tool}
      data-space={spaceDown || undefined}
      data-panning={panning || undefined}
      data-transform={transformStatus?.mode}
      data-axis={transformStatus?.axis ?? undefined}
      data-direct={directCursor ? true : undefined}
      data-editing={editing ? true : undefined}
      data-pen-active={penDraft ? true : undefined}
      data-outlines={viewOptions.outlines === 'off' ? undefined : viewOptions.outlines}
      data-pixel-preview={viewOptions.pixelPreview === 'off' ? undefined : viewOptions.pixelPreview}
      data-rulers={viewOptions.rulers || undefined}
      style={{ '--direct-cursor': directCursor ?? 'default', '--page-background': document.background } as CSSProperties}
      onPointerDownCapture={(event) => {
        if (event.button !== 1 && !(event.button === 0 && spaceHeld.current)) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        panDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: camera.current.pan }
        setPanning(true)
      }}
      onPointerMove={(event) => {
        const active = panDrag.current
        if (!active || active.pointerId !== event.pointerId) return
        onPanChange({ x: active.origin.x + event.clientX - active.x, y: active.origin.y + event.clientY - active.y })
      }}
      onPointerUp={(event) => {
        if (panDrag.current?.pointerId !== event.pointerId) return
        panDrag.current = null
        setPanning(false)
        try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
      }}
      onPointerCancel={() => { panDrag.current = null; setPanning(false) }}
      onLostPointerCapture={() => { panDrag.current = null; setPanning(false) }}
      onPointerLeave={() => { setHoveredId(null); if (tool === 'pen') setPenCursor(null) }}
    >
      <svg
        ref={svgRef}
        className="vector-artboard"
        role="application"
        aria-label={`${document.name} vector canvas`}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onDoubleClick={onCanvasDoubleClick}
        onPointerUp={finish}
        onPointerCancel={abort}
        onLostPointerCapture={() => {
          const active = interaction.current
          if (!active || active.kind === 'modal' || active.kind === 'guide-create') return
          cancelInteraction()
        }}
      >
        <defs>
          <pattern id={`${instanceId}-layout-guides`} width="64" height="64" patternUnits="userSpaceOnUse">
            <path className="vector-layout-grid__line" d="M 64 0 L 0 0 0 64" />
          </pattern>
          <pattern id={`${instanceId}-pixel-grid`} width={1} height={1} patternUnits="userSpaceOnUse">
            <path className="vector-pixel-grid__line" d="M 1 0 L 0 0 0 1" />
          </pattern>
        </defs>
        <g
          ref={worldRef}
          className="vector-world"
          transform={`translate(${viewportSize.width / 2 + pan.x} ${viewportSize.height / 2 + pan.y}) scale(${zoom}) translate(${-document.width / 2} ${-document.height / 2})`}
        >
          <rect className="vector-page" x={0} y={0} width={document.width} height={document.height} />
          {viewOptions.layoutGuides ? <rect className="vector-layout-grid" x={-100000} y={-100000} width={200000} height={200000} fill={`url(#${instanceId}-layout-guides)`} /> : null}
          {viewOptions.pixelGrid && zoom >= PIXEL_GRID_MIN_ZOOM * 0.75 ? (
            <rect className="vector-pixel-grid" x={-100000} y={-100000} width={200000} height={200000} fill={`url(#${instanceId}-pixel-grid)`} style={{ opacity: clamp((zoom - PIXEL_GRID_MIN_ZOOM * 0.75) / (PIXEL_GRID_MIN_ZOOM * 0.25), 0, 1) }} />
          ) : null}
          <g className="vector-shapes" data-pixel-preview={viewOptions.pixelPreview === 'off' ? undefined : viewOptions.pixelPreview}>
            <ShapeTree
              nodes={tree}
              zoom={zoom}
              coarse={coarse}
              pixelPreview={viewOptions.pixelPreview}
              selectedIds={selectedIds}
              editingId={editing?.id ?? null}
              inheritedLocked={false}
              onPointerDown={onShapePointerDown}
              onHover={setHoveredId}
            />
          </g>
          {enteredGroup ? <GroupFrame element={enteredGroup} /> : null}
          {hoverOutline && !selectedIds.includes(hoverOutline.id) ? <HoverOutline element={hoverOutline} leaves={leafElements(elements, [hoverOutline.id])} /> : null}
          {viewOptions.guides ? (
            <GuideLines
              guides={document.guides}
              draft={draftGuide}
              selectedId={selectedGuideId}
              interactive={tool === 'select' || tool === 'transform'}
              onPointerDown={onGuidePointerDown}
            />
          ) : null}
          {transformStatus?.axis && selectedLeaves.length ? <AxisGuide bounds={selectionBounds(selectedLeaves)} axis={transformStatus.axis} /> : null}
          {(tool === 'transform') && selectedLeaves.length > 0 ? selectedLeaves.map((element) => <OutlineOnly key={element.id} element={element} />) : null}
          {editing ? (
            <VectorNodes
              element={editing}
              zoom={zoom}
              selectedIndices={selectedNodeIndices}
              onNodePointerDown={onNodePointerDown}
              onSegmentPointerDown={onSegmentPointerDown}
            />
          ) : null}
          {nodeBox && nodeBox.width + nodeBox.height > 0 ? (
            <g className="vector-selection vector-node-box">
              <rect x={nodeBox.x} y={nodeBox.y} width={nodeBox.width} height={nodeBox.height} />
              <Handles bounds={nodeBox} zoom={zoom} rotation={0} onResize={startNodeResize} onRotate={(_corner, event) => startNodeRotate(event)} />
            </g>
          ) : null}
          {pencilPoints && pencilPoints.length > 1 ? <polyline className="vector-pencil__path" points={pencilPoints.map((item) => `${item.x},${item.y}`).join(' ')} /> : null}
          {lassoPoints && lassoPoints.length > 1 ? <polygon className="vector-lasso" points={lassoPoints.map((item) => `${item.x},${item.y}`).join(' ')} /> : null}
          {showHandles && (singleDirect || multiBounds) ? (
            <Pivot
              point={pivot ?? elementCenter(singleDirect ?? multiBounds!)}
              custom={!!pivot}
              zoom={zoom}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                interaction.current = { kind: 'pivot', pointerId: event.pointerId }
                setDirectCursor('move')
                svgRef.current?.setPointerCapture(event.pointerId)
              }}
              onDoubleClick={() => setPivot(null)}
            />
          ) : null}
          {altDown && selectedLeaves.length > 0 && (tool === 'select' || tool === 'transform') && !interaction.current ? (
            <Measurements from={selectionBounds(selectedLeaves)} to={hoverOutline && !selectedIds.includes(hoverOutline.id) ? selectionBounds(leafElements(elements, [hoverOutline.id])) : { x: 0, y: 0, width: document.width, height: document.height }} zoom={zoom} />
          ) : null}
          {singleDirect ? (
            <Selection
              element={singleDirect}
              zoom={zoom}
              onResize={(handle, event) => startResize(event, handle, singleDirect, [singleDirect])}
              onRotate={(_corner, event) => startRotate(event, singleDirect, [singleDirect])}
            />
          ) : null}
          {multiBounds ? (
            <MultiSelection
              bounds={multiBounds}
              leaves={selectedLeaves}
              zoom={zoom}
              onResize={(handle, event) => startResize(event, handle, null, selectedLeaves)}
              onRotate={(event) => startRotate(event, null, selectedLeaves)}
            />
          ) : null}
          {tool === 'select' && selectedElements.length > 1 ? selectedLeaves.map((element) => <OutlineOnly key={element.id} element={element} thin />) : null}
          {openEndpoints.map((endpoint) => (
            <circle key={endpoint.id} className="vector-pen__endpoint" cx={endpoint.point.x} cy={endpoint.point.y} r={4 / zoom} />
          ))}
          {penDraft ? <PenPreview draft={penDraft} cursor={penCursor} zoom={zoom} closeHint={penCloseHint} /> : null}
          {snapMatches.map((match, index) => (
            match.axis === 'x'
              ? <line key={index} className="vector-smart-guide" data-kind={match.kind} x1={match.value} x2={match.value} y1={match.from} y2={match.to} />
              : <line key={index} className="vector-smart-guide" data-kind={match.kind} x1={match.from} x2={match.to} y1={match.value} y2={match.value} />
          ))}
          {draftBounds ? (
            tool === 'ellipse' ? (
              <ellipse className="vector-draft" cx={draftBounds.x + draftBounds.width / 2} cy={draftBounds.y + draftBounds.height / 2} rx={draftBounds.width / 2} ry={draftBounds.height / 2} />
            ) : (
              <rect className="vector-draft" {...draftBounds} />
            )
          ) : null}
          {marqueeBounds ? <rect className="vector-marquee" data-vector-marquee="true" {...marqueeBounds} /> : null}
        </g>
      </svg>
      {viewOptions.rulers ? (
        <CanvasRulers
          document={document}
          viewport={viewportSize}
          pan={pan}
          zoom={zoom}
          selection={selectedLeaves.length ? selectionBounds(selectedLeaves) : null}
          interactive={viewOptions.guides}
          onPointerDown={onRulerPointerDown}
          onPointerMove={onRulerPointerMove}
          onPointerUp={onRulerPointerUp}
          onPointerCancel={() => { if (interaction.current?.kind === 'guide-create') clearInteraction() }}
        />
      ) : null}
      {hud ? <div className="vector-hud" role="status" aria-live="polite" style={{ left: hud.x, top: hud.y }}>{hud.label}</div> : null}
      {viewOptions.minimap ? (
        <Minimap
          document={document}
          elements={elements}
          viewport={viewportSize}
          pan={pan}
          zoom={zoom}
          onNavigate={(world) => onPanChange({ x: -(world.x - document.width / 2) * zoom, y: -(world.y - document.height / 2) * zoom })}
        />
      ) : null}
    </div>
  )
}

function findOpenEndpoint(elements: VectorElement[], at: Point, threshold: number): { element: VectorElement; end: 'start' | 'end'; subpath: number; index: number } | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index]!
    if (!isHittable(element) || !element.vectorNodes) continue
    for (const end of openEndpointsOf(element)) {
      if (Math.hypot(end.point.x - at.x, end.point.y - at.y) <= threshold) return { element, end: end.end, subpath: end.subpath, index: end.index }
    }
  }
  return null
}

function lastNodeOfSubpath(element: VectorElement, subpath: number): number {
  const nodes = element.vectorNodes ?? []
  const declared = element.subpaths && element.subpaths.length ? element.subpaths : [{ start: 0, closed: element.closed !== false }]
  const next = declared[subpath + 1]
  return (next ? next.start : nodes.length) - 1
}

function ShapeTree({ nodes, zoom, coarse, pixelPreview, selectedIds, editingId, inheritedLocked, onPointerDown, onHover }: {
  nodes: TreeNode[]
  zoom: number
  coarse: boolean
  pixelPreview: VectorPixelPreview
  selectedIds: string[]
  editingId: string | null
  inheritedLocked: boolean
  onPointerDown: (element: VectorElement, event: ReactPointerEvent<SVGElement>) => void
  onHover: (id: string | null) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const element = node.element
        if (!element.visible) return null
        if (element.kind === 'group') {
          return (
            <g key={element.id} data-vector-group={element.id} opacity={element.opacity}>
              <ShapeTree
                nodes={node.children}
                zoom={zoom}
                coarse={coarse}
                pixelPreview={pixelPreview}
                selectedIds={selectedIds}
                editingId={editingId}
                inheritedLocked={inheritedLocked || element.locked}
                onPointerDown={onPointerDown}
                onHover={onHover}
              />
            </g>
          )
        }
        return (
          <VectorShape
            key={element.id}
            element={inheritedLocked ? { ...element, locked: true } : element}
            zoom={zoom}
            coarse={coarse}
            pixelPreview={pixelPreview}
            selected={selectedIds.includes(element.id)}
            editing={element.id === editingId}
            onPointerDown={(event) => onPointerDown(element, event)}
            onHover={onHover}
          />
        )
      })}
    </>
  )
}

function VectorShape({ element, zoom, coarse, pixelPreview, selected, editing, onPointerDown, onHover }: {
  element: VectorElement
  zoom: number
  coarse: boolean
  pixelPreview: VectorPixelPreview
  selected: boolean
  editing: boolean
  onPointerDown: (event: ReactPointerEvent<SVGElement>) => void
  onHover: (id: string | null) => void
}) {
  const rendered = previewGeometry(element, pixelPreview)
  const hittable = isHittable(element)
  const model = renderModel(rendered, 'canvas')
  const hover = hittable ? { onPointerEnter: () => onHover(element.id), onPointerLeave: () => onHover(null) } : {}
  const fillEvents = fillPointerEvents({ ...element, fill: model.layers.some((layer) => layer.kind === 'fill') ? '#000000' : 'none' })
  return (
    <>
      {model.defs.length ? <defs><RenderDefs defs={model.defs} /></defs> : null}
      <g
        data-vector-element={element.id}
        data-selected={selected || undefined}
        data-locked={element.locked || undefined}
        data-editing={editing || undefined}
        opacity={model.opacity}
        pointerEvents={fillEvents}
        onPointerDown={onPointerDown}
        {...hover}
      >
        {model.layers.map((layer, index) => (
          <path key={index} d={layer.d} transform={model.transform} {...layerAttributes(layer)} pointerEvents={layer.kind === 'fill' ? fillEvents : 'none'} />
        ))}
        {model.layers.length === 0 ? <path d={model.d} transform={model.transform} fill="none" stroke="none" pointerEvents="none" /> : null}
      </g>
      {hittable ? (
        <path
          className="vector-hit"
          data-vector-element={element.id}
          d={model.d}
          transform={model.transform}
          strokeWidth={strokeHitWidth(rendered.strokeWidth * (element.strokeAlign && element.strokeAlign !== 'center' ? 2 : 1), zoom, coarse)}
          onPointerDown={onPointerDown}
          {...hover}
        />
      ) : null}
    </>
  )
}

export function RenderDefs({ defs }: { defs: RenderDef[] }) {
  return (
    <>
      {defs.map((def) => {
        switch (def.type) {
          case 'linearGradient':
            return <linearGradient key={def.id} id={def.id} x1={def.x1} y1={def.y1} x2={def.x2} y2={def.y2}>{def.stops.map((stop, index) => <stop key={index} offset={`${stop.t * 100}%`} stopColor={stop.color} />)}</linearGradient>
          case 'radialGradient':
            return <radialGradient key={def.id} id={def.id}>{def.stops.map((stop, index) => <stop key={index} offset={`${stop.t * 100}%`} stopColor={stop.color} />)}</radialGradient>
          case 'pattern': {
            const tile = def.mode === 'tile'
            const size = tile ? Math.max(1, Math.min(def.width, def.height) / 2) : def.width
            const height = tile ? size : def.height
            return <pattern key={def.id} id={def.id} patternUnits="userSpaceOnUse" x={def.x} y={def.y} width={size} height={height}><image href={def.image} x={0} y={0} width={size} height={height} preserveAspectRatio={def.mode === 'fit' ? 'xMidYMid meet' : def.mode === 'fill' ? 'xMidYMid slice' : 'none'} /></pattern>
          }
          case 'clipPath':
            return <clipPath key={def.id} id={def.id}><path d={def.d} /></clipPath>
          case 'mask':
            return <mask key={def.id} id={def.id} maskUnits="userSpaceOnUse" x={def.x} y={def.y} width={def.width} height={def.height}><rect x={def.x} y={def.y} width={def.width} height={def.height} fill="#fff" /><path d={def.d} fill="#000" /></mask>
          case 'marker': {
            const shape = markerShape(def.shape)
            return <marker key={def.id} id={def.id} markerUnits="strokeWidth" markerWidth={shape.size} markerHeight={shape.size} refX={shape.refX} refY={shape.size / 2} orient={def.end ? 'auto' : 'auto-start-reverse'}><path d={shape.d} fill={shape.fill ? def.color : 'none'} stroke={def.color} strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" /></marker>
          }
        }
      })}
    </>
  )
}

function CanvasRulers({ document, viewport, pan, zoom, selection, interactive, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  document: Pick<VectorDocument, 'width' | 'height'>
  viewport: { width: number; height: number }
  pan: Point
  zoom: number
  selection: Bounds | null
  interactive: boolean
  onPointerDown: (axis: 'x' | 'y', event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: () => void
}) {
  const origin = {
    x: viewport.width / 2 + pan.x - document.width * zoom / 2,
    y: viewport.height / 2 + pan.y - document.height * zoom / 2,
  }
  const step = rulerStep(zoom)
  const xTicks = rulerTicks(-origin.x / zoom, (viewport.width - origin.x) / zoom, step)
  const yTicks = rulerTicks(-origin.y / zoom, (viewport.height - origin.y) / zoom, step)
  return (
    <div className="vector-rulers" aria-hidden="true" data-interactive={interactive || undefined}>
      <div
        className="vector-ruler vector-ruler--x"
        onPointerDown={(event) => onPointerDown('y', event)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {selection ? <span className="vector-ruler__span" style={{ left: origin.x + selection.x * zoom, width: Math.max(1, selection.width * zoom) }} /> : null}
        {xTicks.map((value) => <span key={value} className="vector-ruler__tick" style={{ left: origin.x + value * zoom }}><span>{formatRulerValue(value)}</span></span>)}
      </div>
      <div
        className="vector-ruler vector-ruler--y"
        onPointerDown={(event) => onPointerDown('x', event)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {selection ? <span className="vector-ruler__span" style={{ top: origin.y + selection.y * zoom, height: Math.max(1, selection.height * zoom) }} /> : null}
        {yTicks.map((value) => <span key={value} className="vector-ruler__tick" style={{ top: origin.y + value * zoom }}><span>{formatRulerValue(value)}</span></span>)}
      </div>
      <div className="vector-ruler__corner" />
    </div>
  )
}

function GuideLines({ guides, draft, selectedId, interactive, onPointerDown }: {
  guides: VectorGuide[]
  draft: VectorGuide | null
  selectedId: string | null
  interactive: boolean
  onPointerDown: (guide: VectorGuide, event: ReactPointerEvent<SVGElement>) => void
}) {
  const all = draft ? [...guides, draft] : guides
  return (
    <g className="vector-guides">
      {all.map((guide) => {
        const isDraft = guide.id === 'draft'
        const line = guide.axis === 'x'
          ? { x1: guide.position, x2: guide.position, y1: -100000, y2: 100000 }
          : { x1: -100000, x2: 100000, y1: guide.position, y2: guide.position }
        return (
          <g key={guide.id} className="vector-guide" data-axis={guide.axis} data-selected={guide.id === selectedId || undefined} data-draft={isDraft || undefined}>
            <line className="vector-guide__line" {...line} />
            {interactive && !isDraft ? (
              <line className="vector-guide__hit" data-vector-guide={guide.id} {...line} onPointerDown={(event) => onPointerDown(guide, event)} />
            ) : null}
          </g>
        )
      })}
    </g>
  )
}

function VectorNodes({ element, zoom, selectedIndices, onNodePointerDown, onSegmentPointerDown }: {
  element: VectorElement
  zoom: number
  selectedIndices: number[]
  onNodePointerDown: (nodeIndex: number, part: NodePart, event: ReactPointerEvent<SVGCircleElement>) => void
  onSegmentPointerDown: (event: ReactPointerEvent<SVGPathElement>) => void
}) {
  const nodes = element.vectorNodes ?? defaultVectorNodes(element)
  const cx = element.x + element.width / 2
  const cy = element.y + element.height / 2
  const hitRadius = 5 / zoom
  const pointRadius = 3.5 / zoom
  const controlRadius = 3 / zoom
  const shown = new Set<number>()
  for (const index of selectedIndices) {
    shown.add(index)
    const around = neighbours(element, nodes.length, index)
    if (around.next !== null) shown.add(around.next)
    if (around.previous !== null) shown.add(around.previous)
  }
  return (
    <g className="vector-nodes" transform={`rotate(${element.rotation} ${cx} ${cy})`}>
      <path className="vector-nodes__outline" d={vectorPathData(element, nodes)} />
      <path className="vector-nodes__segment-hit" data-vector-segment="true" d={vectorPathData(element, nodes)} onPointerDown={onSegmentPointerDown} />
      {[...shown].map((index) => {
        const node = nodes[index]
        if (!node) return null
        const anchor = nodePosition(element, node)
        const selectedNode = selectedIndices.includes(index)
        return (['in', 'out'] as const).map((part) => {
          if (!node[part]) return null
          if (!selectedNode) {
            // Neighbouring nodes only show the handle that faces a selected node.
            const around = neighbours(element, nodes.length, index)
            const facing = part === 'out' ? around.next : around.previous
            if (facing === null || !selectedIndices.includes(facing)) return null
          }
          const handle = nodePosition(element, node, part)
          return <g key={`${index}-${part}`}>
            <line className="vector-nodes__control-line" x1={anchor.x} y1={anchor.y} x2={handle.x} y2={handle.y} />
            <circle className="vector-nodes__control-hit" data-vector-control={part} cx={handle.x} cy={handle.y} r={hitRadius} onPointerDown={(event) => onNodePointerDown(index, part, event)} />
            <circle className="vector-nodes__control" cx={handle.x} cy={handle.y} r={controlRadius} />
          </g>
        })
      })}
      {nodes.map((node, index) => {
        const position = nodePosition(element, node)
        const smooth = !!node.in || !!node.out
        return <g key={index}>
          <circle className="vector-nodes__hit" data-vector-node={index} cx={position.x} cy={position.y} r={hitRadius} onPointerDown={(event) => onNodePointerDown(index, 'anchor', event)} />
          {smooth
            ? <circle className="vector-nodes__point" data-selected={selectedIndices.includes(index) || undefined} cx={position.x} cy={position.y} r={pointRadius} />
            : <rect className="vector-nodes__point" data-selected={selectedIndices.includes(index) || undefined} x={position.x - pointRadius} y={position.y - pointRadius} width={pointRadius * 2} height={pointRadius * 2} rx={0.75 / zoom} />}
        </g>
      })}
    </g>
  )
}

function PenPreview({ draft, cursor, zoom, closeHint }: { draft: PenDraft; cursor: Point | null; zoom: number; closeHint: boolean }) {
  const first = draft.nodes[0]!
  const last = draft.nodes[draft.nodes.length - 1]!
  const size = 3.5 / zoom
  return (
    <g className="vector-pen">
      <path className="vector-pen__path" d={penPreviewData(draft, draft.closed ? null : cursor)} />
      {last.in ? <line className="vector-nodes__control-line" x1={last.anchor.x} y1={last.anchor.y} x2={last.in.x} y2={last.in.y} /> : null}
      {last.out ? <line className="vector-nodes__control-line" x1={last.anchor.x} y1={last.anchor.y} x2={last.out.x} y2={last.out.y} /> : null}
      {last.in ? <circle className="vector-nodes__control" cx={last.in.x} cy={last.in.y} r={3 / zoom} /> : null}
      {last.out ? <circle className="vector-nodes__control" cx={last.out.x} cy={last.out.y} r={3 / zoom} /> : null}
      {draft.nodes.map((node, index) => (
        <rect key={index} className="vector-pen__anchor" data-first={index === 0 || undefined} x={node.anchor.x - size} y={node.anchor.y - size} width={size * 2} height={size * 2} rx={0.75 / zoom} />
      ))}
      {closeHint ? <circle className="vector-pen__close" cx={first.anchor.x} cy={first.anchor.y} r={PEN_CLOSE_PX / zoom} /> : null}
    </g>
  )
}

function AxisGuide({ bounds, axis }: { bounds: Bounds; axis: Exclude<VectorTransformAxis, null> }) {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  return axis === 'x'
    ? <line className="vector-axis-guide" x1={-100000} x2={100000} y1={cy} y2={cy} />
    : <line className="vector-axis-guide" x1={cx} x2={cx} y1={-100000} y2={100000} />
}

function OutlineOnly({ element, thin }: { element: VectorElement; thin?: boolean }) {
  const center = elementCenter(element)
  return (
    <g className="vector-selection" data-thin={thin || undefined} transform={`rotate(${element.rotation} ${center.x} ${center.y})`}>
      <rect x={element.x} y={element.y} width={element.width} height={element.height} />
    </g>
  )
}

function HoverOutline({ element, leaves }: { element: VectorElement; leaves: VectorElement[] }) {
  if (element.kind === 'group') {
    const bounds = selectionBounds(leaves)
    return <rect className="vector-hover" x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} />
  }
  const center = elementCenter(element)
  return <path className="vector-hover" d={outlinePathData(element)} transform={`rotate(${element.rotation} ${center.x} ${center.y})`} />
}

function GroupFrame({ element }: { element: VectorElement }) {
  return <rect className="vector-group-frame" x={element.x} y={element.y} width={element.width} height={element.height} />
}

function Selection({ element, zoom, onResize, onRotate }: {
  element: VectorElement
  zoom: number
  onResize: (handle: DirectResizeHandle, event: ReactPointerEvent<SVGElement>) => void
  onRotate: (corner: Corner, event: ReactPointerEvent<SVGElement>) => void
}) {
  const cx = element.x + element.width / 2
  const cy = element.y + element.height / 2
  return (
    <g className="vector-selection" transform={`rotate(${element.rotation} ${cx} ${cy})`}>
      <rect x={element.x} y={element.y} width={element.width} height={element.height} />
      <Handles bounds={element} zoom={zoom} rotation={element.rotation} onResize={onResize} onRotate={onRotate} />
    </g>
  )
}

function MultiSelection({ bounds, leaves, zoom, onResize, onRotate }: {
  bounds: Bounds
  leaves: VectorElement[]
  zoom: number
  onResize: (handle: DirectResizeHandle, event: ReactPointerEvent<SVGElement>) => void
  onRotate: (event: ReactPointerEvent<SVGElement>) => void
}) {
  return (
    <g className="vector-selection vector-multi-selection" data-count={leaves.length}>
      <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} />
      <Handles bounds={bounds} zoom={zoom} rotation={0} onResize={onResize} onRotate={(_corner, event) => onRotate(event)} />
    </g>
  )
}

function Handles({ bounds, zoom, rotation, onResize, onRotate }: {
  bounds: Bounds
  zoom: number
  rotation: number
  onResize: (handle: DirectResizeHandle, event: ReactPointerEvent<SVGElement>) => void
  onRotate: (corner: Corner, event: ReactPointerEvent<SVGElement>) => void
}) {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const points: { handle: DirectResizeHandle; x: number; y: number; corner?: Corner }[] = [
    { handle: 'nw', corner: 'nw', x: bounds.x, y: bounds.y },
    { handle: 'n', x: cx, y: bounds.y },
    { handle: 'ne', corner: 'ne', x: bounds.x + bounds.width, y: bounds.y },
    { handle: 'e', x: bounds.x + bounds.width, y: cy },
    { handle: 'se', corner: 'se', x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { handle: 's', x: cx, y: bounds.y + bounds.height },
    { handle: 'sw', corner: 'sw', x: bounds.x, y: bounds.y + bounds.height },
    { handle: 'w', x: bounds.x, y: cy },
  ]
  const visiblePoints = points.filter((point) => {
    if (point.handle === 'n' || point.handle === 's') return bounds.width * zoom >= 40
    if (point.handle === 'e' || point.handle === 'w') return bounds.height * zoom >= 40
    return true
  })
  const resizeHitRadius = 16 / zoom
  const handleRadius = 4 / zoom
  return (
    <>
      {visiblePoints.map((item) => (
        <g key={item.handle}>
          {item.corner ? <path
            className="vector-selection__rotate-hit"
            data-vector-rotate={item.corner}
            d={rotateZonePath(item.x, item.y, 22 / zoom, item.corner)}
            onPointerDown={(event) => onRotate(item.corner!, event)}
          /> : null}
          <circle
            className="vector-selection__resize-hit"
            data-vector-handle={item.handle}
            cx={item.x}
            cy={item.y}
            r={resizeHitRadius}
            style={{ cursor: resizeCursor(item.handle, rotation) }}
            onPointerDown={(event) => onResize(item.handle, event)}
          />
          <rect className="vector-selection__handle" x={item.x - handleRadius} y={item.y - handleRadius} width={handleRadius * 2} height={handleRadius * 2} rx={1 / zoom} />
        </g>
      ))}
    </>
  )
}

/** Three-quarter arc around a corner that leaves the quadrant pointing into the box uncovered. */
function rotateZonePath(cx: number, cy: number, r: number, corner: Corner): string {
  const skip: Record<Corner, number> = { nw: 0, ne: 90, se: 180, sw: 270 }
  const start = ((skip[corner] + 90) * Math.PI) / 180
  const end = ((skip[corner] + 360) * Math.PI) / 180
  const from = { x: cx + Math.cos(start) * r, y: cy + Math.sin(start) * r }
  const to = { x: cx + Math.cos(end) * r, y: cy + Math.sin(end) * r }
  return `M ${from.x} ${from.y} A ${r} ${r} 0 1 1 ${to.x} ${to.y}`
}

function Pivot({ point, custom, zoom, onPointerDown, onDoubleClick }: { point: Point; custom: boolean; zoom: number; onPointerDown: (event: ReactPointerEvent<SVGElement>) => void; onDoubleClick: () => void }) {
  const arm = 6 / zoom
  return (
    <g className="vector-pivot" data-custom={custom || undefined}>
      <circle className="vector-pivot__hit" data-vector-handle="pivot" cx={point.x} cy={point.y} r={5 / zoom} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} />
      <circle className="vector-pivot__ring" cx={point.x} cy={point.y} r={4 / zoom} />
      <line className="vector-pivot__arm" x1={point.x - arm} x2={point.x + arm} y1={point.y} y2={point.y} />
      <line className="vector-pivot__arm" x1={point.x} x2={point.x} y1={point.y - arm} y2={point.y + arm} />
    </g>
  )
}

/** Distance lines between two boxes along each axis, drawn where the boxes do not overlap. */
function Measurements({ from, to, zoom }: { from: Bounds; to: Bounds; zoom: number }) {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; label: string }> = []
  const fromRight = from.x + from.width
  const fromBottom = from.y + from.height
  const toRight = to.x + to.width
  const toBottom = to.y + to.height
  const overlapY = Math.max(from.y, to.y) <= Math.min(fromBottom, toBottom)
  const overlapX = Math.max(from.x, to.x) <= Math.min(fromRight, toRight)
  const midY = overlapY ? (Math.max(from.y, to.y) + Math.min(fromBottom, toBottom)) / 2 : from.y + from.height / 2
  const midX = overlapX ? (Math.max(from.x, to.x) + Math.min(fromRight, toRight)) / 2 : from.x + from.width / 2
  const contains = to.x <= from.x && toRight >= fromRight && to.y <= from.y && toBottom >= fromBottom
  if (contains) {
    lines.push({ x1: from.x, x2: to.x, y1: midY, y2: midY, label: `${round(from.x - to.x)}` })
    lines.push({ x1: fromRight, x2: toRight, y1: midY, y2: midY, label: `${round(toRight - fromRight)}` })
    lines.push({ x1: midX, x2: midX, y1: from.y, y2: to.y, label: `${round(from.y - to.y)}` })
    lines.push({ x1: midX, x2: midX, y1: fromBottom, y2: toBottom, label: `${round(toBottom - fromBottom)}` })
  } else {
    if (fromRight < to.x) lines.push({ x1: fromRight, x2: to.x, y1: midY, y2: midY, label: `${round(to.x - fromRight)}` })
    else if (toRight < from.x) lines.push({ x1: from.x, x2: toRight, y1: midY, y2: midY, label: `${round(from.x - toRight)}` })
    if (fromBottom < to.y) lines.push({ x1: midX, x2: midX, y1: fromBottom, y2: to.y, label: `${round(to.y - fromBottom)}` })
    else if (toBottom < from.y) lines.push({ x1: midX, x2: midX, y1: from.y, y2: toBottom, label: `${round(from.y - toBottom)}` })
  }
  const fontSize = 11 / zoom
  return (
    <g className="vector-measure">
      {lines.filter((line) => line.label !== '0').map((line, index) => {
        const horizontal = line.y1 === line.y2
        const lx = (line.x1 + line.x2) / 2
        const ly = (line.y1 + line.y2) / 2
        const width = (line.label.length * 7 + 8) / zoom
        const height = 16 / zoom
        return (
          <g key={index}>
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
            <rect x={horizontal ? lx - width / 2 : lx + 4 / zoom} y={horizontal ? ly + 4 / zoom : ly - height / 2} width={width} height={height} rx={2 / zoom} />
            <text x={horizontal ? lx : lx + 4 / zoom + width / 2} y={(horizontal ? ly + 4 / zoom : ly - height / 2) + height / 2} fontSize={fontSize} textAnchor="middle" dominantBaseline="central">{line.label}</text>
          </g>
        )
      })}
    </g>
  )
}

function Minimap({ document, elements, viewport, pan, zoom, onNavigate }: {
  document: VectorDocument
  elements: VectorElement[]
  viewport: { width: number; height: number }
  pan: Point
  zoom: number
  onNavigate: (world: Point) => void
}) {
  const leaves = elements.filter((element) => element.kind !== 'group' && element.visible)
  const content = leaves.length ? selectionBounds(leaves) : { x: 0, y: 0, width: document.width, height: document.height }
  const view = {
    x: document.width / 2 - (viewport.width / 2 + pan.x) / zoom,
    y: document.height / 2 - (viewport.height / 2 + pan.y) / zoom,
    width: viewport.width / zoom,
    height: viewport.height / zoom,
  }
  const left = Math.min(0, content.x, view.x)
  const top = Math.min(0, content.y, view.y)
  const right = Math.max(document.width, content.x + content.width, view.x + view.width)
  const bottom = Math.max(document.height, content.y + content.height, view.y + view.height)
  const pad = Math.max(right - left, bottom - top) * 0.05
  const box = { x: left - pad, y: top - pad, width: right - left + pad * 2, height: bottom - top + pad * 2 }
  const dragging = useRef<number | null>(null)
  const navigate = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = Math.max(box.width / rect.width, box.height / rect.height)
    const offsetX = (rect.width * scale - box.width) / 2
    const offsetY = (rect.height * scale - box.height) / 2
    onNavigate({ x: box.x - offsetX + (event.clientX - rect.left) * scale, y: box.y - offsetY + (event.clientY - rect.top) * scale })
  }
  return (
    <svg
      className="vector-minimap"
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Canvas overview"
      onPointerDown={(event) => { if (event.button !== 0) return; dragging.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); navigate(event) }}
      onPointerMove={(event) => { if (dragging.current === event.pointerId) navigate(event) }}
      onPointerUp={(event) => { dragging.current = null; try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* released */ } }}
      onPointerCancel={() => { dragging.current = null }}
    >
      <rect className="vector-minimap__page" x={0} y={0} width={document.width} height={document.height} />
      {leaves.map((element) => {
        const bounds = selectionBounds([element])
        return <rect key={element.id} className="vector-minimap__shape" x={bounds.x} y={bounds.y} width={Math.max(1, bounds.width)} height={Math.max(1, bounds.height)} />
      })}
      <rect className="vector-minimap__view" x={view.x} y={view.y} width={view.width} height={view.height} />
    </svg>
  )
}

function formatRulerValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round(value))
}

function previewGeometry(element: VectorElement, mode: VectorPixelPreview): VectorElement {
  if (mode === 'off') return element
  const step = mode === '1x' ? 1 : 0.5
  const snap = (value: number) => Math.round(value / step) * step
  return {
    ...element,
    x: snap(element.x),
    y: snap(element.y),
    width: Math.max(step, snap(element.width)),
    height: Math.max(step, snap(element.height)),
    strokeWidth: snap(element.strokeWidth),
  }
}

/** Snaps the direction from `origin` to `point` onto 45° increments, keeping the projected length. */
function constrainAngle(origin: Point, point: Point): Point {
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  const angle = Math.atan2(dy, dx)
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
  const length = Math.hypot(dx, dy) * Math.cos(angle - snapped)
  return { x: round(origin.x + Math.cos(snapped) * length), y: round(origin.y + Math.sin(snapped) * length) }
}

function normalizeDegrees(value: number): number {
  let degrees = value % 360
  if (degrees > 180) degrees -= 360
  if (degrees < -180) degrees += 360
  return degrees
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

