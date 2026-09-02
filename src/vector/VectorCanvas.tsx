import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { boxMap, elementInLasso, pointInPolygon, transformElementAffine } from '@/vector/affine'
import { createVectorElement } from '@/vector/document'
import { resizeBounds, resizeCursor, resizeElement, rotatePoint, type DirectResizeHandle } from '@/vector/directTransform'
import { boundsBetween, elementCenter, intersects, round, rulerStep, rulerTicks, selectionBounds, snapAngle, snapBounds, snapGeometryPatch, type Bounds } from '@/vector/geometry'
import { addGuide, createGuide, moveGuide, removeGuide } from '@/vector/guides'
import { countedLabel } from '@/vector/history'
import { fillPointerEvents, isHittable, strokeHitWidth } from '@/vector/hitTest'
import { anglePoint, arcProperties, isFullEllipse, localPoint, polygonProperties, shapeHudLabel, shapePatch, shapePoint, type ShapeHandle } from '@/vector/shapes'
import { cornerHandlePoint, cornerRadiusAt, cornerRadiusPatch, CORNERS, type CornerName } from '@/vector/corners'
import { addStop, dropStop, gradientCircle, gradientLine, linearPatch, moveStop, pointAt, projectOnLine, radialPatch, STOP_DROP_PX } from '@/vector/gradient'
import { fillsOf, fillsPatch } from '@/vector/paints'
import { displayRect, droppedImageBounds, FULL_CROP, isFullCrop, panCrop, resizeCrop, type Crop } from '@/vector/crop'
import { imageNaturalSize, readImageFile } from '@/vector/images'
import { canvasMeasure, resizeTextPatch, textProperties } from '@/vector/text'
import { measurementLabel, nextZoom, zoomAround, zoomToBox, type Measurement } from '@/vector/measure'
import { constrainToAngle, faceNodeIds, handlePolar } from '@/vector/nodeEdit'
import { VectorTextEditor } from '@/vector/VectorTextEditor'
import {
  cubicAt, bendSegment, deleteNodes, deleteSegments, insertNodeOnSegment, moveHandle, moveNodes, nearestSegment, networkFromRuns, normalizeWorld, segmentCubic, smoothSegments, toggleNodeSmooth,
  transformNodes, worldNetwork, type AbsNetwork, type AbsSegment,
} from '@/vector/network'
import { pencilNodes } from '@/vector/pencil'
import { cutNode, cutSegment, scaleStylePatch, uniformFactor } from '@/vector/cut'
import { penAddAnchor, penCanClose, penCommit, penConnect, penConnectSegment, penDragHandle, penFromNode, penFromPoint, penFromSegment, penNodeAt, penPreviewData, penRemoveLast, penStart, type PenDraft } from '@/vector/pen'
import { layerAttributes, markerShape, outlinePathData, patternPlacement, renderModel, worldFaces, type RenderDef, type RenderModel } from '@/vector/render'
import { collectSnapTargets, nodeSnapTargets, snapBoundsDelta, snapPoint, type SnapMatch, type SnapTarget } from '@/vector/snapping'
import { transformElement, transformElements, type VectorTransformAxis, type VectorTransformMode } from '@/vector/transform'
import { buildTree, childrenOf, descendantIds, isContainer, leafElements, resolveSelection, transformLeaves, type TreeNode } from '@/vector/tree'
import type { VectorDocument, VectorElement, VectorGuide, VectorPaint, VectorTool } from '@/vector/types'

type Point = { x: number; y: number }
type Corner = Extract<DirectResizeHandle, 'nw' | 'ne' | 'se' | 'sw'>
type HandleRef = { segmentId: string; end: 'a' | 'b' }

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
  /** Opens in-place editing on a text element, as a double-click does. */
  editText: (id: string) => void
  /** The pivot the user has placed, or null when it still sits at the centre of the selection. */
  pivot: () => Point | null
  /** Adds picture files as image elements, centred on the middle of the page. */
  addImages: (files: File[], at?: Point) => Promise<void>
  /** Opens crop editing on an image element, as a double-click does. */
  cropImage: (id: string) => void
}

type Interaction =
  | { kind: 'create'; pointerId: number; start: Point; current: Point; targets: SnapTarget[] }
  | { kind: 'marquee'; pointerId: number; start: Point; current: Point; additive: boolean }
  | { kind: 'node-marquee'; pointerId: number; start: Point; current: Point; additive: boolean; element: VectorElement; world: AbsNetwork }
  | { kind: 'move'; pointerId: number; start: Point; elements: VectorElement[]; bounds: Bounds; originalIds: string[]; targets: SnapTarget[]; moved: boolean; toggleOnClick: string | null }
  | { kind: 'resize'; pointerId: number; start: Point; elements: VectorElement[]; bounds: Bounds; handle: DirectResizeHandle; single: VectorElement | null; targets: SnapTarget[] }
  | { kind: 'rotate'; pointerId: number; start: Point; elements: VectorElement[]; center: Point; single: VectorElement | null }
  | { kind: 'node'; pointerId: number; start: Point; anchorStart: Point; element: VectorElement; world: AbsNetwork; nodeIds: string[]; handle: HandleRef | null; targets: SnapTarget[]; moved: boolean; toggleOnClick: string | null }
  | { kind: 'segment-move'; pointerId: number; start: Point; element: VectorElement; world: AbsNetwork; nodeIds: string[]; segmentId: string; moved: boolean }
  | { kind: 'pen'; pointerId: number }
  | { kind: 'pencil'; pointerId: number; points: Point[]; mode?: 'smooth' | 'erase'; target?: VectorElement }
  | { kind: 'bend'; pointerId: number; element: VectorElement; world: AbsNetwork; segmentId: string; t: number }
  | { kind: 'node-resize'; pointerId: number; element: VectorElement; world: AbsNetwork; nodeIds: string[]; bounds: Bounds; handle: DirectResizeHandle }
  | { kind: 'node-rotate'; pointerId: number; start: Point; element: VectorElement; world: AbsNetwork; nodeIds: string[]; center: Point }
  | { kind: 'lasso'; pointerId: number; points: Point[]; additive: boolean }
  | { kind: 'crop'; pointerId: number; start: Point; element: VectorElement; box: Bounds; crop: Crop; handle: DirectResizeHandle | null }
  | { kind: 'shape'; pointerId: number; start: Point; element: VectorElement; handle: ShapeHandle }
  | { kind: 'corner'; pointerId: number; element: VectorElement; corner: CornerName; alone: boolean }
  | { kind: 'gradient'; pointerId: number; element: VectorElement; index: number; handle: GradientHandle; stop: number }
  | { kind: 'image-place'; pointerId: number; start: Point; element: VectorElement; index: number; paint: VectorPaint }
  | { kind: 'measure'; pointerId: number; from: Point; to: Point; targets: SnapTarget[] }
  | { kind: 'zoom'; pointerId: number; start: Point; current: Point; out: boolean }
  | { kind: 'pivot'; pointerId: number }
  | { kind: 'guide-create'; pointerId: number; axis: 'x' | 'y' }
  | { kind: 'guide-move'; pointerId: number; guide: VectorGuide; targets: SnapTarget[] }
  | { kind: 'modal'; target: 'elements'; mode: VectorTransformMode; axis: VectorTransformAxis; start: Point; elements: VectorElement[]; preview: VectorElement[] }
  | { kind: 'modal'; target: 'nodes'; mode: VectorTransformMode; axis: VectorTransformAxis; start: Point; element: VectorElement; world: AbsNetwork; nodeIds: string[]; preview: VectorElement }

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
  selectedNodeIds: string[]
  onSelectIds: (ids: string[]) => void
  onEnterGroup: (id: string | null) => void
  onSelectNodes: (ids: string[]) => void
  onToolChange: (tool: VectorTool) => void
  onAddElements: (elements: VectorElement[], select?: boolean, label?: string) => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onUpdateElements: (updates: Array<{ id: string; patch: Partial<VectorElement> }>, record?: boolean, label?: string) => void
  onDuplicateElements: (ids: string[], offset: number) => { ids: string[]; idMap: Record<string, string> }
  onSetGuides: (guides: VectorGuide[], record?: boolean) => void
  onEditElements: (edit: (elements: VectorElement[]) => VectorElement[], record?: boolean, label?: string) => void
  controller?: MutableRefObject<VectorCanvasController | null>
  onEscape: () => void
  /** While set, a click reads a colour off the drawing instead of selecting; null cancels. */
  sampling?: boolean
  onSample?: (point: Point | null) => void
  onGestureStart: (label?: string) => void
  onGestureEnd: (label?: string) => void
  onGestureCancel: () => void
}

/** What a modal G / R / S transform is called in the history. */
const MODAL_LABELS = { move: 'Move', rotate: 'Rotate', scale: 'Scale' } as const

/** How close the pencil has to pass for a segment to count as touched, in screen pixels. */
const PENCIL_REACH_PX = 12

const RULER_SIZE = 24
const SNAP_PX = 6
const PEN_CLOSE_PX = 8
const NODE_HIT_PX = 8
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
  selectedNodeIds,
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
  sampling = false,
  onSample,
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
  const pointerClient = useRef<Point | null>(null)
  const documentRef = useRef(document)
  const toolRef = useRef(tool)
  const viewRef = useRef(viewOptions)
  const selectedIdsRef = useRef(selectedIds)
  const selectedNodeIdsRef = useRef(selectedNodeIds)
  const selectedSegmentRef = useRef<string | null>(null)
  const penDraftRef = useRef<PenDraft | null>(null)
  const selectedGuideRef = useRef<string | null>(null)
  const callbacks = useRef({ onUpdate, onUpdateElements, onGestureStart, onGestureEnd, onGestureCancel, onSelectIds, onSelectNodes, onToolChange, onAddElements, onSetGuides, onEscape, onEnterGroup, onEditElements, onSample })
  const samplingRef = useRef(sampling)
  samplingRef.current = sampling
  const croppingRef = useRef(false)
  const placingRef = useRef(false)
  const [draftBounds, setDraftBounds] = useState<Bounds | null>(null)
  const [marqueeBounds, setMarqueeBounds] = useState<Bounds | null>(null)
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const measurementsRef = useRef(measurements)
  measurementsRef.current = measurements
  const [measureDraft, setMeasureDraft] = useState<Measurement | null>(null)
  const [zoomBox, setZoomBox] = useState<Bounds | null>(null)
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
  const pivotRef = useRef(pivot)
  pivotRef.current = pivot
  const [altDown, setAltDown] = useState(false)
  const [metaDown, setMetaDown] = useState(false)
  const [bending, setBending] = useState(false)
  const [rotateArc, setRotateArc] = useState<{ center: Point; from: number; to: number; radius: number } | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null)
  const [snapMatches, setSnapMatches] = useState<SnapMatch[]>([])
  const [hud, setHud] = useState<VectorHud | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedGuideId, setSelectedGuideState] = useState<string | null>(null)
  const [selectedSegmentId, setSelectedSegmentState] = useState<string | null>(null)
  const [draftGuide, setDraftGuide] = useState<VectorGuide | null>(null)
  const [coarse, setCoarse] = useState(false)
  const [textEditId, setTextEditId] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const [cropId, setCropId] = useState<string | null>(null)
  const [imagePlaceId, setImagePlaceId] = useState<string | null>(null)
  const [droppingStop, setDroppingStop] = useState(false)
  const textDraft = useRef('')
  const editText = useRef<(element: VectorElement) => void>(() => undefined)
  const addImages = useRef<(files: File[], at: Point) => Promise<void>>(async () => undefined)

  const setPenDraft = (draft: PenDraft | null) => {
    penDraftRef.current = draft
    setPenDraftState(draft)
  }
  const setSelectedGuide = (id: string | null) => {
    selectedGuideRef.current = id
    setSelectedGuideState(id)
  }
  const setSelectedSegment = (id: string | null) => {
    selectedSegmentRef.current = id
    setSelectedSegmentState(id)
  }

  const elements = document.elements
  const selectedElements = useMemo(() => elements.filter((element) => selectedIds.includes(element.id)), [elements, selectedIds])
  const selected = selectedElements.length === 1 ? selectedElements[0]! : null
  const editingCandidate = selected && !isContainer(selected) && selected.kind !== 'text' && selected.kind !== 'image' && selected.visible && !selected.locked ? selected : null
  const editing = (tool === 'node' || tool === 'bucket' || tool === 'scissors') && selected && !isContainer(selected) && selected.kind !== 'text' && selected.visible && !selected.locked ? selected : null
  const textEditing = textEditId ? elements.find((element) => element.id === textEditId && element.kind === 'text') ?? null : null
  const cropping = cropId ? elements.find((element) => element.id === cropId && element.kind === 'image' && !element.locked) ?? null : null
  const selectedLeaves = useMemo(() => leafElements(elements, selectedIds).filter((element) => element.visible && !element.locked), [elements, selectedIds])
  /** What a drag actually writes to: a boolean group hands over to the shapes underneath it. */
  const movableLeaves = useMemo(() => transformLeaves(elements, selectedIds).filter((element) => element.visible && !element.locked), [elements, selectedIds])
  const tree = useMemo(() => buildTree(elements), [elements])

  camera.current = { pan, zoom }
  documentRef.current = document
  toolRef.current = tool
  viewRef.current = viewOptions
  selectedIdsRef.current = selectedIds
  selectedNodeIdsRef.current = selectedNodeIds
  callbacks.current = { onUpdate, onUpdateElements, onGestureStart, onGestureEnd, onGestureCancel, onSelectIds, onSelectNodes, onToolChange, onAddElements, onSetGuides, onEscape, onEnterGroup, onEditElements, onSample }

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
      pivot: () => pivotRef.current,
      editText: (id) => {
        const element = documentRef.current.elements.find((item) => item.id === id)
        if (element?.kind === 'text' && !element.locked) editText.current(element)
      },
      cropImage: (id) => {
        const element = documentRef.current.elements.find((item) => item.id === id)
        if (element?.kind === 'image' && !element.locked) setCropId(id)
      },
      addImages: (files, at) => {
        const doc = documentRef.current
        return addImages.current(files, at ?? { x: doc.width / 2, y: doc.height / 2 })
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

  const clearOverlays = useCallback(() => {
    setBending(false)
    setRotateArc(null)
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
    setMeasureDraft(null)
    setZoomBox(null)
    setDroppingStop(false)
    clearOverlays()
  }, [clearOverlays])

  const cancelInteraction = useCallback(() => {
    const active = interaction.current
    if (!active) return
    const passive = active.kind === 'create' || active.kind === 'marquee' || active.kind === 'node-marquee' || active.kind === 'pen' || active.kind === 'guide-create' || active.kind === 'pencil' || active.kind === 'lasso' || active.kind === 'pivot' || active.kind === 'measure' || active.kind === 'zoom'
    if (!passive) callbacks.current.onGestureCancel()
    if (active.kind === 'move' && active.originalIds.length) callbacks.current.onSelectIds(active.originalIds)
    clearInteraction()
  }, [clearInteraction])

  useEffect(() => {
    if (tool !== 'pen' && penDraftRef.current) commitPen()
    if (tool !== 'node' && tool !== 'bucket' && tool !== 'pen' && (selectedNodeIdsRef.current.length || selectedSegmentRef.current)) {
      callbacks.current.onSelectNodes([])
      setSelectedSegment(null)
    }
  }, [tool, commitPen])

  useEffect(() => {
    if (!selectedGuideId) return
    if (!document.guides.some((guide) => guide.id === selectedGuideId)) setSelectedGuide(null)
  }, [document.guides, selectedGuideId])

  useEffect(() => {
    if (selectedIds.length !== 1) {
      if (selectedNodeIdsRef.current.length) callbacks.current.onSelectNodes([])
      setSelectedSegment(null)
    }
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
      const editingId = (toolRef.current === 'node') && selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0]! : null
      const editingElement = editingId ? doc.elements.find((element) => element.id === editingId) ?? null : null
      const nodeIds = selectedNodeIdsRef.current
      if (editingElement && nodeIds.length > 0 && !editingElement.locked && !interaction.current) {
        const world = worldNetwork(editingElement)
        const anchors = nodeIds.flatMap((id) => { const node = world.nodes.find((item) => item.id === id); return node ? [node.point] : [] })
        if (anchors.length === 0) return false
        const origin = {
          x: anchors.reduce((sum, value) => sum + value.x, 0) / anchors.length,
          y: anchors.reduce((sum, value) => sum + value.y, 0) / anchors.length,
        }
        let start = latestPointer.current ?? { x: origin.x + Math.max(40, editingElement.width / 2), y: origin.y }
        if (Math.hypot(start.x - origin.x, start.y - origin.y) < 1) {
          start = { x: origin.x + Math.max(40, editingElement.width / 2), y: origin.y }
        }
        callbacks.current.onGestureStart(MODAL_LABELS[mode])
        interaction.current = { kind: 'modal', target: 'nodes', mode, axis: null, start, element: structuredClone(editingElement), world, nodeIds: [...nodeIds], preview: structuredClone(editingElement) }
        setTransformStatus({ mode, axis: null })
        return true
      }
      const leaves = transformLeaves(doc.elements, selectedIdsRef.current).filter((element) => !element.locked && element.visible)
      if (leaves.length === 0 || toolRef.current !== 'transform' || interaction.current) return false
      const bounds = selectionBounds(leaves)
      const start = latestPointer.current ?? { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }
      callbacks.current.onGestureStart(MODAL_LABELS[mode])
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
      if (event.key === 'Meta' || event.key === 'Control') setMetaDown(true)
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
            active.world = worldNetwork(active.preview)
          }
          setTransformStatus({ mode: active.mode, axis: active.axis })
        }
        return
      }
      if (event.altKey) return
      if (key === 'escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (samplingRef.current) {
          callbacks.current.onSample?.(null)
          return
        }
        if (croppingRef.current) {
          setCropId(null)
          return
        }
        if (placingRef.current) {
          setImagePlaceId(null)
          return
        }
        if (active) {
          cancelInteraction()
          return
        }
        if (measurementsRef.current.length > 0) {
          setMeasurements([])
          return
        }
        if (penDraftRef.current) {
          commitPen()
          return
        }
        if (toolRef.current === 'node' || toolRef.current === 'bucket' || toolRef.current === 'scissors' || toolRef.current === 'hand' || toolRef.current === 'zoom' || toolRef.current === 'measure') {
          callbacks.current.onSelectNodes([])
          setSelectedSegment(null)
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
        const world = worldNetwork(editingElement)
        const nodeIds = selectedNodeIdsRef.current
        const segmentId = selectedSegmentRef.current
        if (nodeIds.length === 0 && !segmentId) return
        const rebuilt = nodeIds.length ? deleteNodes(editingElement, world, nodeIds) : deleteSegments(editingElement, world, [segmentId!])
        if (!rebuilt) {
          callbacks.current.onEditElements((all) => all.filter((element) => element.id !== editingElement.id))
          callbacks.current.onSelectIds([])
          callbacks.current.onToolChange('select')
          return
        }
        callbacks.current.onUpdate(editingElement.id, { ...rebuilt, kind: 'path' })
        callbacks.current.onSelectNodes([])
        setSelectedSegment(null)
        return
      }
      if (editingElement && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const nodeIds = selectedNodeIdsRef.current
        if (nodeIds.length === 0) return
        const amount = event.shiftKey ? 10 : 1
        const delta = {
          x: key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0,
          y: key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0,
        }
        callbacks.current.onUpdate(editingElement.id, { ...moveNodes(editingElement, worldNetwork(editingElement), nodeIds, delta), kind: 'path' })
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
      if (event.key === 'Meta' || event.key === 'Control') setMetaDown(false)
      if (event.code !== 'Space') return
      spaceHeld.current = false
      setSpaceDown(false)
    }
    const onPointerMove = (event: PointerEvent) => {
      const current = point(event)
      latestPointer.current = current
      pointerClient.current = localClient(event)
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
        const anchors = active.nodeIds.flatMap((id) => { const node = active.world.nodes.find((item) => item.id === id); return node ? [node.point] : [] })
        const origin = { x: anchors.reduce((sum, value) => sum + value.x, 0) / anchors.length, y: anchors.reduce((sum, value) => sum + value.y, 0) / anchors.length }
        const map = nodeModalMap(active.mode, active.axis, origin, active.start, current)
        const patch = transformNodes(active.element, active.world, active.nodeIds, map)
        active.preview = { ...active.element, ...patch }
        callbacks.current.onUpdate(active.element.id, { ...patch, kind: 'path' }, false)
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
      setMetaDown(false)
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
  }, [point, localClient, cancelInteraction, commitPen, showHud])

  const beginMove = (event: ReactPointerEvent<Element>, ids: string[], toggleOnClick: string | null = null) => {
    const doc = documentRef.current
    const leaves = transformLeaves(doc.elements, ids).filter((element) => element.visible && !element.locked)
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

  const startCrop = (event: ReactPointerEvent<SVGElement>, handle: DirectResizeHandle | null) => {
    if (event.button !== 0 || !cropping) return
    event.stopPropagation()
    onGestureStart('Crop image')
    interaction.current = {
      kind: 'crop',
      pointerId: event.pointerId,
      start: point(event.nativeEvent),
      element: structuredClone(cropping),
      box: { x: cropping.x, y: cropping.y, width: cropping.width, height: cropping.height },
      crop: cropping.crop ?? FULL_CROP,
      handle,
    }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const startCorner = (event: ReactPointerEvent<SVGElement>, element: VectorElement, corner: CornerName) => {
    if (event.button !== 0) return
    event.stopPropagation()
    onGestureStart('Round the corners')
    interaction.current = { kind: 'corner', pointerId: event.pointerId, element: structuredClone(element), corner, alone: event.altKey }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const startGradient = (event: ReactPointerEvent<SVGElement>, element: VectorElement, index: number, handle: GradientHandle, stop: number) => {
    if (event.button !== 0) return
    event.stopPropagation()
    onGestureStart('Edit gradient')
    interaction.current = { kind: 'gradient', pointerId: event.pointerId, element: structuredClone(element), index, handle, stop }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const startImagePlace = (event: ReactPointerEvent<SVGElement>, element: VectorElement, index: number, paint: VectorPaint) => {
    if (event.button !== 0) return
    event.stopPropagation()
    onGestureStart('Place the image')
    interaction.current = { kind: 'image-place', pointerId: event.pointerId, start: point(event.nativeEvent), element: structuredClone(element), index, paint: structuredClone(paint) }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  /** Pressing the ramp drops a stop where the pointer is and drags it from there. */
  const addGradientStop = (event: ReactPointerEvent<SVGElement>, element: VectorElement, index: number) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const paint = fillsOf(element)[index]
    if (!paint?.stops) return
    const line = gradientLine(paint)
    const hit = projectOnLine(line.from, line.to, normalizedPoint(element, point(event.nativeEvent)))
    const added = addStop(paint.stops, hit.t)
    if (added.index < 0) return
    onGestureStart('Add a gradient stop')
    patchFill(element, index, { stops: added.stops })
    // The drag that follows works from the ramp as it now stands, new stop included.
    const withStop: VectorElement = {
      ...structuredClone(element),
      ...fillsPatch(fillsOf(element).map((item, position) => position === index ? { ...item, stops: added.stops } : item)),
    }
    interaction.current = { kind: 'gradient', pointerId: event.pointerId, element: withStop, index, handle: 'stop', stop: added.index }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  /** Rewrites one paint of an element's fill list. */
  const patchFill = (element: VectorElement, index: number, patch: Partial<VectorPaint>) => {
    const paints = fillsOf(element).map((paint, position) => position === index ? { ...paint, ...patch } : paint)
    onUpdate(element.id, fillsPatch(paints), false)
  }

  const startShapeHandle = (event: ReactPointerEvent<SVGElement>, element: VectorElement, handle: ShapeHandle) => {
    if (event.button !== 0) return
    event.stopPropagation()
    onGestureStart(handle.startsWith('polygon') ? 'Shape the polygon' : 'Shape the arc')
    interaction.current = { kind: 'shape', pointerId: event.pointerId, start: point(event.nativeEvent), element: structuredClone(element), handle }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  /**
   * A drag draws the line it shows; a click drops a hundred pixels of it. The contour is the last
   * one used in the drawing, so a series of lines comes out consistent.
   */
  const addLine = (from: Point, to: Point) => {
    const end = Math.hypot(to.x - from.x, to.y - from.y) * zoom < 3 ? { x: from.x + 100, y: from.y } : to
    const geometry = normalizeWorld(networkFromRuns([{ points: [{ anchor: from }, { anchor: end }], closed: false }]))
    const previous = [...documentRef.current.elements].reverse().find((element) => element.stroke !== 'none' && element.strokeWidth > 0)
    onAddElements([createVectorElement('path', geometry, {
      name: 'Line',
      network: geometry.network,
      fill: 'none',
      ...(previous ? { stroke: previous.stroke, strokeWidth: previous.strokeWidth } : {}),
    })], true, 'Draw line')
  }

  /** Turns dropped or pasted picture files into image elements, centred on a point. */
  const addImageFiles = useCallback(async (files: File[], at: Point) => {
    const pictures = files.filter((file) => file.type.startsWith('image/'))
    if (pictures.length === 0) return
    const created: VectorElement[] = []
    for (const [index, file] of pictures.entries()) {
      const data = await readImageFile(file)
      if (!data) continue
      const natural = await imageNaturalSize(data) ?? { width: 320, height: 320 }
      const offset = index * 16
      const bounds = droppedImageBounds(natural, { x: at.x + offset, y: at.y + offset })
      created.push(createVectorElement('image', bounds, {
        name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'Image',
        image: data,
        imageWidth: natural.width,
        imageHeight: natural.height,
      }))
    }
    if (created.length) callbacks.current.onAddElements(created)
  }, [])

  /** Opens the in-place editor; the whole edit becomes one undo entry. */
  const openTextEditor = (element: VectorElement) => {
    if (interaction.current && interaction.current.kind !== 'modal') cancelInteraction()
    textDraft.current = element.text ?? ''
    onGestureStart('Edit text')
    setTextEditId(element.id)
  }

  editText.current = openTextEditor
  addImages.current = addImageFiles
  croppingRef.current = !!cropping

  /** A click drops an auto-sized text, a drag gives it a fixed box; both open the editor. */
  const addText = (box: Bounds | null, at: Point) => {
    const properties = textProperties({})
    const placeholder = { width: properties.fontSize * 4, height: properties.fontSize * properties.lineHeight }
    const bounds = box ?? { x: at.x, y: at.y - placeholder.height / 2, ...placeholder }
    const element = createVectorElement('text', bounds, { text: '', ...(box ? { textSizing: 'fixed' as const } : {}) })
    textDraft.current = ''
    onGestureStart('Add text')
    onAddElements([element])
    setTextEditId(element.id)
  }

  /** Keeps the box around the content: an auto box follows the text, a fixed box only grows down. */
  const applyTextEdit = (element: VectorElement, text: string) => {
    textDraft.current = text
    onUpdate(element.id, resizeTextPatch(element, { text }, canvasMeasure), false)
  }

  const closeTextEditor = (cancel: boolean) => {
    const id = textEditId
    setTextEditId(null)
    if (!id) return
    if (cancel) {
      onGestureCancel()
      return
    }
    // A text nobody typed into leaves nothing behind.
    if (!textDraft.current.trim()) {
      onEditElements((all) => all.filter((item) => item.id !== id), false)
      onSelectIds([])
      onGestureEnd()
      return
    }
    // An untouched name follows the content, the way a layer list expects.
    const element = documentRef.current.elements.find((item) => item.id === id)
    if (element && element.name === 'Text') {
      const first = textDraft.current.split('\n').find((line) => line.trim())?.trim()
      if (first) onUpdate(id, { name: first.slice(0, 40) }, false)
    }
    onGestureEnd()
  }

  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    flushPointerMove()
    const active = interaction.current
    if (!active || active.kind === 'modal' || active.pointerId !== event.pointerId) return
    if (active.kind === 'create') {
      const bounds = boundsBetween(active.start, active.current, event.shiftKey)
      if (tool === 'text') {
        addText(bounds.width >= 8 && bounds.height >= 8 ? (viewOptions.snapToPixelGrid ? snapBounds(bounds) : bounds) : null, active.start)
      } else if (tool === 'line') {
        addLine(active.start, event.shiftKey ? constrainAngle(active.start, active.current) : active.current)
      } else if (bounds.width >= 2 && bounds.height >= 2) {
        const kind = tool === 'ellipse' ? 'ellipse' : tool === 'frame' ? 'frame' : tool === 'polygon' ? 'polygon' : 'rectangle'
        onAddElements([createVectorElement(kind, viewOptions.snapToPixelGrid ? snapBounds(bounds) : bounds)])
      }
    } else if (active.kind === 'marquee') {
      const bounds = boundsBetween(active.start, active.current, false)
      const scope = enteredGroupId
      const candidates = bounds.width < 2 && bounds.height < 2 ? [] : childrenOf(elements, scope).filter((element) => element.visible && !element.locked)
      const hits = candidates.filter((element) => {
        const leaves = isContainer(element) ? leafElements(elements, [element.id]).filter((leaf) => leaf.visible) : [element]
        return leaves.some((leaf) => intersects(bounds, selectionBounds([leaf])))
      }).map((element) => element.id)
      onSelectIds(active.additive ? [...new Set([...selectedIds, ...hits])] : hits)
      setMarqueeBounds(null)
    } else if (active.kind === 'node-marquee') {
      const bounds = boundsBetween(active.start, active.current, false)
      const hits = active.world.nodes.filter((node) => node.point.x >= bounds.x && node.point.x <= bounds.x + bounds.width && node.point.y >= bounds.y && node.point.y <= bounds.y + bounds.height).map((node) => node.id)
      onSelectNodes(active.additive ? [...new Set([...selectedNodeIdsRef.current, ...hits])] : hits)
      if (hits.length) setSelectedSegment(null)
      setMarqueeBounds(null)
    } else if (active.kind === 'measure') {
      setMeasureDraft(null)
      // A measurement is a reading, not an edit: it stays on screen and never touches the document.
      if (Math.hypot(active.to.x - active.from.x, active.to.y - active.from.y) * zoom >= 4) {
        setMeasurements((current) => [...current, { id: `m${Date.now()}${current.length}`, from: active.from, to: active.to }])
      }
    } else if (active.kind === 'zoom') {
      setZoomBox(null)
      const size = viewportRef.current
      const doc = documentRef.current
      const page = { width: doc.width, height: doc.height }
      const box = boundsBetween(active.start, active.current, false)
      if (size && box.width * zoom >= 12 && box.height * zoom >= 12 && !active.out) {
        const view = zoomToBox(box, { width: size.clientWidth, height: size.clientHeight }, page)
        onZoomChange(view.zoom)
        onPanChange(view.pan)
      } else {
        // A click steps through the zoom levels, keeping the point under the pointer still.
        const to = nextZoom(zoom, active.out || event.altKey ? -1 : 1)
        onPanChange(zoomAround(active.start, camera.current.pan, zoom, to, page))
        onZoomChange(to)
      }
    } else if (active.kind === 'lasso') {
      const polygon = active.points
      if (polygon.length >= 3) {
        if (editing) {
          const hits = worldNetwork(editing).nodes.filter((node) => pointInPolygon(node.point, polygon)).map((node) => node.id)
          onSelectNodes(active.additive ? [...new Set([...selectedNodeIdsRef.current, ...hits])] : hits)
        } else {
          const candidates = childrenOf(elements, enteredGroupId).filter((element) => element.visible && !element.locked)
          const hits = candidates.filter((element) => {
            const leaves = isContainer(element) ? leafElements(elements, [element.id]).filter((leaf) => leaf.visible) : [element]
            return leaves.some((leaf) => elementInLasso(leaf, polygon))
          }).map((element) => element.id)
          onSelectIds(active.additive ? [...new Set([...selectedIds, ...hits])] : hits)
        }
      } else if (!active.additive && !editing) {
        onSelectIds([])
      }
    } else if (active.kind === 'pencil' && active.mode && active.target) {
      const target = documentRef.current.elements.find((item) => item.id === active.target!.id)
      if (target) {
        const world = worldNetwork(target)
        const radius = PENCIL_REACH_PX / zoom
        const touched = world.segments.filter((segment) => active.points.some((point) => segmentNear(world, segment, point, radius)))
        if (touched.length) {
          const edit = active.mode === 'erase'
            ? deleteSegments(target, world, touched.map((segment) => segment.id))
            : smoothSegments(target, world, touched.map((segment) => segment.id))
          onUpdate(target.id, { ...edit, kind: 'path' }, true, active.mode === 'erase' ? 'Rub out' : 'Smooth the path')
        }
      }
      setPencilPoints(null)
    } else if (active.kind === 'pencil') {
      const points = pencilNodes(active.points, zoom)
      if (points.length >= 2) {
        const first = points[0]!.anchor
        const last = points[points.length - 1]!.anchor
        const closed = points.length >= 3 && Math.hypot(first.x - last.x, first.y - last.y) <= PEN_CLOSE_PX / zoom
        const built = normalizeWorld(networkFromRuns([{ points: closed ? points.slice(0, -1) : points, closed }]))
        onAddElements([createVectorElement('path', built, { network: built.network, name: 'Pencil' })], true, 'Draw with pencil')
      }
    } else if (active.kind === 'pen' || active.kind === 'guide-create') {
      /* draft-only */
    } else if (active.kind === 'move') {
      if (active.moved) onGestureEnd()
      else {
        onGestureCancel()
        if (active.toggleOnClick) onSelectIds(selectedIds.filter((id) => id !== active.toggleOnClick))
      }
    } else if (active.kind === 'node') {
      if (active.moved) onGestureEnd()
      else {
        onGestureCancel()
        if (active.toggleOnClick) onSelectNodes(selectedNodeIds.filter((id) => id !== active.toggleOnClick))
      }
    } else if (active.kind === 'gradient') {
      if (droppingStop && active.handle === 'stop') {
        const paint = fillsOf(active.element)[active.index]
        const current = documentRef.current.elements.find((item) => item.id === active.element.id)
        const stops = current ? fillsOf(current)[active.index]?.stops : paint?.stops
        if (stops) patchFill(active.element, active.index, { stops: dropStop(stops, active.stop) })
      }
      setDroppingStop(false)
      onGestureEnd()
    } else if (active.kind === 'segment-move') {
      if (active.moved) onGestureEnd()
      else onGestureCancel()
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
    flushPointerMove()
    const active = interaction.current
    if (!active || active.kind === 'modal') return
    cancelInteraction()
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
  }

  const startResize = (event: ReactPointerEvent<SVGElement>, handle: DirectResizeHandle, single: VectorElement | null, leaves: VectorElement[]) => {
    if (event.button !== 0) return
    event.stopPropagation()
    onGestureStart(countedLabel('Resize', leaves.length))
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
    onGestureStart(countedLabel('Rotate', leaves.length))
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
    // While sampling, a shape is just something to read a colour off: let the click reach the canvas.
    if (sampling) return
    if (tool === 'pen' || tool === 'pencil' || tool === 'rectangle' || tool === 'ellipse' || tool === 'lasso' || tool === 'bucket' || tool === 'text' || tool === 'frame' || tool === 'line' || tool === 'polygon' || tool === 'scissors' || tool === 'hand' || tool === 'zoom' || tool === 'measure') return
    event.stopPropagation()
    const resolved = resolveSelection(elements, element.id, enteredGroupId, event.metaKey || event.ctrlKey)
    const resolvedElement = elements.find((item) => item.id === resolved) ?? element
    if (tool === 'node') {
      if (editing && editing.id === element.id) {
        const at = point(event.nativeEvent)
        if (!event.shiftKey) { onSelectNodes([]); setSelectedSegment(null) }
        interaction.current = { kind: 'node-marquee', pointerId: event.pointerId, start: at, current: at, additive: event.shiftKey, element: structuredClone(editing), world: worldNetwork(editing) }
        setMarqueeBounds({ x: at.x, y: at.y, width: 0, height: 0 })
        svgRef.current?.setPointerCapture(event.pointerId)
        return
      }
      onSelectIds([resolvedElement.id])
      onSelectNodes([])
      setSelectedSegment(null)
      if (isContainer(resolvedElement)) onToolChange('select')
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
    onGestureStart(countedLabel('Move', ids.length))
    beginMove(event, ids, toggleOnClick)
  }

  /**
   * Double-clicks arrive on the SVG because pointer capture retargets the compatibility mouse
   * events, so the target under the pointer is looked up from the document instead.
   */
  const onCanvasDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const stack = window.document.elementsFromPoint(event.clientX, event.clientY)
    const nodeHit = stack.map((node) => (node as Element).closest('[data-vector-node]')?.getAttribute('data-vector-node') ?? null).find((value): value is string => value !== null)
    if (nodeHit !== undefined && editing) {
      if (interaction.current && interaction.current.kind !== 'modal') cancelInteraction()
      onUpdate(editing.id, { ...toggleNodeSmooth(editing, worldNetwork(editing), nodeHit), kind: 'path' }, true, 'Toggle node')
      onSelectNodes([nodeHit])
      return
    }
    const segmentHit = stack.map((node) => (node as Element).closest('[data-vector-segment]')?.getAttribute('data-vector-segment') ?? null).find((value): value is string => value !== null)
    if (segmentHit !== undefined && editing) {
      if (interaction.current && interaction.current.kind !== 'modal') cancelInteraction()
      const hit = nearestSegment(editing, point(event.nativeEvent))
      if (hit && hit.segment.id === segmentHit) {
        const inserted = insertNodeOnSegment(editing, worldNetwork(editing), segmentHit, hit.t)
        const { nodeId, ...patch } = inserted
        onUpdate(editing.id, { ...patch, kind: 'path' }, true, 'Add node')
        onSelectNodes([nodeId])
        setSelectedSegment(null)
      }
      return
    }
    const hit = stack
      .map((node) => (node as Element).closest('[data-vector-element]')?.getAttribute('data-vector-element') ?? null)
      .find((id): id is string => !!id)
    const element = hit ? elements.find((item) => item.id === hit) ?? null : null
    if (!element) {
      if (tool === 'node' || tool === 'bucket') onToolChange('select')
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
    if (isContainer(resolvedElement)) {
      onEnterGroup(resolvedElement.id)
      onSelectIds([resolveSelection(elements, element.id, resolvedElement.id)])
      return
    }
    if (resolvedElement.locked) return
    onSelectIds([resolvedElement.id])
    onSelectNodes([])
    if (resolvedElement.kind === 'text') {
      openTextEditor(resolvedElement)
      return
    }
    if (resolvedElement.kind === 'image') {
      setCropId(resolvedElement.id)
      return
    }
    if (fillsOf(resolvedElement).some((paint) => paint.visible && paint.type === 'image' && paint.image)) {
      setImagePlaceId(resolvedElement.id)
      return
    }
    onToolChange('node')
  }

  /** Node of the selected element near a world point (pen tool). */
  const nodeNear = (element: VectorElement | null, at: Point): string | null => {
    if (!element) return null
    const threshold = NODE_HIT_PX / zoom
    const hit = worldNetwork(element).nodes.find((node) => Math.hypot(node.point.x - at.x, node.point.y - at.y) <= threshold)
    return hit ? hit.id : null
  }

  const onCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    // Sampling comes first: a click reads the drawing wherever it lands, shapes included.
    if (sampling) {
      event.stopPropagation()
      onSample?.(point(event.nativeEvent))
      return
    }
    const targetElement = event.target as Element
    const drawing = tool === 'pen' || tool === 'pencil' || tool === 'rectangle' || tool === 'ellipse' || tool === 'lasso' || tool === 'bucket' || tool === 'text' || tool === 'frame' || tool === 'line' || tool === 'polygon' || tool === 'scissors' || tool === 'zoom' || tool === 'measure'
    // Drawing tools work on top of existing shapes; selection tools leave shape clicks to the shapes.
    if (!drawing && targetElement !== event.currentTarget && targetElement.closest('[data-vector-element], [data-vector-handle], [data-vector-rotate], [data-vector-guide], [data-vector-node], [data-vector-control], [data-vector-segment]')) return
    const rawAt = point(event.nativeEvent)
    const penAnchor = penDraftRef.current?.current ? penDraftRef.current.world.nodes.find((node) => node.id === penDraftRef.current!.current)?.point : null
    const at = tool === 'pen' && event.shiftKey && penAnchor ? constrainAngle(penAnchor, rawAt) : rawAt
    if (tool === 'bucket') {
      const target = editing ?? bucketTarget(elements, at)
      if (!target) return
      const { hit } = worldFaces(target)
      const face = hit(at)
      if (!face) return
      const off = new Set(target.regionsOff ?? [])
      if (off.has(face.key)) off.delete(face.key)
      else off.add(face.key)
      onUpdate(target.id, { regionsOff: off.size ? [...off] : undefined, kind: target.kind === 'group' ? target.kind : 'path', ...(target.network ? {} : { network: worldNetworkAsLocal(target) }) })
      if (!editing) onSelectIds([target.id])
      return
    }
    if (tool === 'measure') {
      const targets = snapTargetsFor([])
      const from = snapFreePoint(rawAt, targets).point
      interaction.current = { kind: 'measure', pointerId: event.pointerId, from, to: from, targets }
      setMeasureDraft({ id: 'draft', from, to: from })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'zoom') {
      interaction.current = { kind: 'zoom', pointerId: event.pointerId, start: rawAt, current: rawAt, out: event.altKey }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'lasso') {
      interaction.current = { kind: 'lasso', pointerId: event.pointerId, points: [rawAt], additive: event.shiftKey }
      setLassoPoints([rawAt])
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'pencil' && (event.shiftKey || event.altKey) && editingCandidate) {
      // ⇧ redraws the part the stroke passes over, ⌥ rubs it out.
      interaction.current = { kind: 'pencil', pointerId: event.pointerId, points: [rawAt], mode: event.altKey ? 'erase' : 'smooth', target: structuredClone(editingCandidate) }
      setPencilPoints([rawAt])
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
        const base = selected && !isContainer(selected) && selected.kind !== 'text' && !selected.locked ? selected : null
        const nodeId = nodeNear(base, at)
        if (base && nodeId) {
          setPenDraft(penFromNode(base, nodeId))
          return
        }
        const near = base ? nearestSegment(base, at) : null
        if (base && near && near.distance <= threshold) {
          setPenDraft(penFromSegment(base, near.segment.id, near.t))
          return
        }
        const snappedStart = snapFreePoint(at, snapTargetsFor(base ? [base.id] : [])).point
        if (base && (base.kind === 'path' || base.network)) {
          // A selected path keeps growing as one network, even from a disconnected node.
          setPenDraft(penFromPoint(base, snappedStart))
          interaction.current = { kind: 'pen', pointerId: event.pointerId }
          event.currentTarget.setPointerCapture(event.pointerId)
          return
        }
        setPenDraft(penStart(snappedStart))
        onSelectIds([])
        interaction.current = { kind: 'pen', pointerId: event.pointerId }
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
      const existing = penNodeAt(draft, at, threshold)
      if (existing) {
        const next = penConnect(draft, existing)
        setPenDraft(next)
        setPenCloseHint(false)
        if (!next.current) commitPen()
        return
      }
      const near = nearestSegment({ ...normalizeWorld(draft.world), rotation: 0, kind: 'path' }, at)
      if (near && near.distance <= threshold) {
        setPenDraft(penConnectSegment(draft, near.segment.id, near.t))
        return
      }
      const snapped = snapFreePoint(at, snapTargetsFor(draft.element ? [draft.element.id] : [])).point
      setPenDraft(penAddAnchor(draft, snapped))
      interaction.current = { kind: 'pen', pointerId: event.pointerId }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'scissors' && editing) {
      const nodeHit = worldNetwork(editing).nodes.find((node) => Math.hypot(node.point.x - at.x, node.point.y - at.y) <= NODE_HIT_PX / zoom)
      if (nodeHit) {
        onUpdate(editing.id, { ...cutNode(editing, worldNetwork(editing), nodeHit.id), kind: 'path' }, true, 'Cut the node apart')
        onSelectNodes([])
        return
      }
      const segmentHit = nearestSegment(editing, at)
      if (segmentHit) {
        onUpdate(editing.id, { ...cutSegment(editing, worldNetwork(editing), segmentHit.segment.id, segmentHit.t), kind: 'path' }, true, 'Cut the path')
        onSelectNodes([])
      }
      return
    }
    if (tool === 'node' && editing && event.altKey) {
      const face = worldFaces(editing).hit(at)
      if (face) {
        const ids = faceNodeIds(face)
        onSelectNodes(event.shiftKey ? [...new Set([...selectedNodeIdsRef.current, ...ids])] : ids)
        setSelectedSegment(null)
        return
      }
    }
    if (tool === 'node' && editing) {
      if (!event.shiftKey) { onSelectNodes([]); setSelectedSegment(null) }
      interaction.current = { kind: 'node-marquee', pointerId: event.pointerId, start: at, current: at, additive: event.shiftKey, element: structuredClone(editing), world: worldNetwork(editing) }
      setMarqueeBounds({ x: at.x, y: at.y, width: 0, height: 0 })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (cropping) {
      setCropId(null)
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

  const applyCanvasPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = interaction.current
    const at = point(event.nativeEvent)
    if (tool === 'pen' && (!active || active.kind !== 'pen')) {
      const draft = penDraftRef.current
      const last = draft?.current ? draft.world.nodes.find((node) => node.id === draft.current)?.point ?? null : null
      const constrained = event.shiftKey && last ? constrainAngle(last, at) : at
      const snapped = snapFreePoint(constrained, snapTargetsFor(draft?.element ? [draft.element.id] : [])).point
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
      if (!draft || !draft.current) return
      const anchor = draft.world.nodes.find((node) => node.id === draft.current)!.point
      const handleAt = event.shiftKey ? constrainAngle(anchor, at) : at
      setPenDraft(penDragHandle(draft, handleAt, event.altKey))
      showHud(`${round(Math.hypot(handleAt.x - anchor.x, handleAt.y - anchor.y))} · ${round(normalizeDegrees(Math.atan2(-(handleAt.y - anchor.y), handleAt.x - anchor.x) * 180 / Math.PI))}°`, event.nativeEvent)
      return
    }
    if (active.kind === 'measure') {
      const to = event.shiftKey ? constrainAngle(active.from, at) : snapFreePoint(at, active.targets).point
      active.to = to
      setMeasureDraft({ id: 'draft', from: active.from, to })
      showHud(measurementLabel(active.from, to), event.nativeEvent)
      return
    }
    if (active.kind === 'zoom') {
      active.current = at
      setZoomBox(boundsBetween(active.start, at, false))
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
      onUpdate(active.element.id, { ...bendSegment(active.element, active.world, active.segmentId, active.t, at), kind: 'path' }, false)
      return
    }
    if (active.kind === 'node-resize') {
      const next = resizeBounds(active.bounds, active.handle, at, { lockRatio: event.shiftKey, fromCenter: event.altKey })
      const map = boxMap(active.bounds, next)
      onUpdate(active.element.id, { ...transformNodes(active.element, active.world, active.nodeIds, (p) => ({ x: map.a * p.x + map.c * p.y + map.e, y: map.b * p.x + map.d * p.y + map.f })), kind: 'path' }, false)
      showHud(`${round(next.width)} × ${round(next.height)}`, event.nativeEvent)
      return
    }
    if (active.kind === 'node-rotate') {
      const startAngle = Math.atan2(active.start.y - active.center.y, active.start.x - active.center.x)
      let delta = Math.atan2(at.y - active.center.y, at.x - active.center.x) - startAngle
      if (event.shiftKey) delta = snapAngle(delta * 180 / Math.PI) * Math.PI / 180
      const degrees = delta * 180 / Math.PI
      onUpdate(active.element.id, { ...transformNodes(active.element, active.world, active.nodeIds, (p) => rotatePoint(p, active.center, degrees)), kind: 'path' }, false)
      showHud(`${round(normalizeDegrees(degrees))}°`, event.nativeEvent)
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
        // A picture keeps its shape unless Shift says otherwise; everything else is the reverse.
        const lockRatio = active.single.kind === 'image' ? !event.shiftKey : tool === 'scale' ? true : event.shiftKey
        const patch = resizeElement(active.single, active.handle, pointer, { lockRatio, fromCenter: event.altKey })
        const styled = tool === 'scale'
          ? { ...patch, ...scaleStylePatch(active.single, uniformFactor(active.single, { width: patch.width ?? active.single.width, height: patch.height ?? active.single.height })) }
          : patch
        onUpdate(active.single.id, viewOptions.snapToPixelGrid ? snapGeometryPatch(styled) : styled, false)
        showHud(`${round(patch.width)} × ${round(patch.height)}`, event.nativeEvent)
      } else {
        const next = resizeBounds(active.bounds, active.handle, pointer, { lockRatio: event.shiftKey, fromCenter: event.altKey })
        const map = boxMap(active.bounds, next)
        const factor = tool === 'scale' ? uniformFactor(active.bounds, next) : 1
        const updates = active.elements.map((leaf) => ({ id: leaf.id, patch: { ...transformElementAffine(leaf, map), ...(tool === 'scale' ? scaleStylePatch(leaf, factor) : {}) } }))
          .map((update) => ({ ...update, patch: viewOptions.snapToPixelGrid ? snapGeometryPatch(update.patch) : update.patch }))
        onUpdateElements(updates, false)
        showHud(`${round(next.width)} × ${round(next.height)}`, event.nativeEvent)
      }
      setSnapMatches(matches)
      return
    }
    if (active.kind === 'node') {
      const dx = at.x - active.start.x
      const dy = at.y - active.start.y
      if (!active.moved && Math.hypot(dx, dy) * zoom < 3) return
      active.moved = true
      if (active.handle) {
        const segment = active.world.segments.find((item) => item.id === active.handle!.segmentId)
        const anchorId = segment ? (active.handle.end === 'a' ? segment.a : segment.b) : null
        const anchor = anchorId ? active.world.nodes.find((node) => node.id === anchorId)?.point ?? null : null
        // Shift holds the handle to a fifteen-degree step; otherwise it snaps to the other nodes.
        const target = anchor && event.shiftKey ? constrainToAngle(anchor, at) : snapFreePoint(at, active.targets).point
        setSnapMatches(anchor && event.shiftKey ? [] : snapFreePoint(at, active.targets).matches)
        onUpdate(active.element.id, { ...moveHandle(active.element, active.world, active.handle.segmentId, active.handle.end, target, event.altKey), kind: 'path' }, false)
        const polar = anchor ? handlePolar(anchor, target) : null
        showHud(polar ? `${round(polar.length)} · ${round(polar.angle)}°` : `${round(target.x)}, ${round(target.y)}`, event.nativeEvent)
        return
      }
      // Shift holds the move to a fifteen-degree step from where the node started, the way a
      // handle does; without it the node snaps to the other nodes and objects.
      const dragged = { x: active.anchorStart.x + dx, y: active.anchorStart.y + dy }
      const snapped = event.shiftKey
        ? { point: constrainToAngle(active.anchorStart, dragged), matches: [] }
        : snapFreePoint(dragged, active.targets)
      const delta = { x: snapped.point.x - active.anchorStart.x, y: snapped.point.y - active.anchorStart.y }
      onUpdate(active.element.id, { ...moveNodes(active.element, active.world, active.nodeIds, delta), kind: 'path' }, false)
      setSnapMatches(snapped.matches)
      showHud(`${round(snapped.point.x)}, ${round(snapped.point.y)} · Δ ${round(delta.x)}, ${round(delta.y)}`, event.nativeEvent)
      return
    }
    if (active.kind === 'corner') {
      const radius = cornerRadiusAt(active.element, active.corner, at)
      onUpdate(active.element.id, cornerRadiusPatch(active.element, active.corner, radius, active.alone), false)
      showHud(`${round(radius)} px${active.alone ? ' · one corner' : ''}`, event.nativeEvent)
      return
    }
    if (active.kind === 'gradient') {
      const paint = fillsOf(active.element)[active.index]
      if (!paint) return
      const local = normalizedPoint(active.element, at)
      if (paint.type === 'radial') {
        const circle = gradientCircle(paint)
        if (active.handle === 'center') patchFill(active.element, active.index, radialPatch(local, circle.radius))
        else patchFill(active.element, active.index, radialPatch(circle.center, Math.hypot(local.x - circle.center.x, local.y - circle.center.y)))
        showHud(active.handle === 'center' ? 'Gradient centre' : `${Math.round(gradientCircle(paint).radius * 100)}%`, event.nativeEvent)
        return
      }
      const line = gradientLine(paint)
      if (active.handle === 'from') patchFill(active.element, active.index, linearPatch(local, line.to))
      else if (active.handle === 'to') patchFill(active.element, active.index, linearPatch(line.from, local))
      else {
        const hit = projectOnLine(line.from, line.to, local)
        const stops = paint.stops ?? []
        const away = hit.distance * Math.min(active.element.width, active.element.height) * zoom > STOP_DROP_PX
        setDroppingStop(away && stops.length > 2)
        const moved = moveStop(stops, active.stop, hit.t)
        active.stop = moved.index
        patchFill(active.element, active.index, { stops: moved.stops })
        showHud(away && stops.length > 2 ? 'Release to remove' : `${Math.round(Math.min(1, Math.max(0, hit.t)) * 100)}%`, event.nativeEvent)
      }
      return
    }
    if (active.kind === 'image-place') {
      const offset = active.paint.imageOffset ?? { x: 0, y: 0 }
      patchFill(active.element, active.index, {
        imageOffset: {
          x: offset.x + (at.x - active.start.x) / Math.max(1, active.element.width),
          y: offset.y + (at.y - active.start.y) / Math.max(1, active.element.height),
        },
      })
      showHud('Place the image', event.nativeEvent)
      return
    }
    if (active.kind === 'shape') {
      onUpdate(active.element.id, shapePatch(active.element, active.handle, at, active.start, zoom), false)
      showHud(shapeHudLabel(active.element, active.handle, at, active.start, zoom), event.nativeEvent)
      return
    }
    if (active.kind === 'crop') {
      if (active.handle) {
        const next = resizeCrop(active.box, active.crop, active.handle, at)
        onUpdate(active.element.id, {
          x: round(next.box.x), y: round(next.box.y), width: round(next.box.width), height: round(next.box.height),
          crop: isFullCrop(next.crop) ? undefined : next.crop,
        }, false)
        showHud(`${round(next.box.width)} × ${round(next.box.height)}`, event.nativeEvent)
        return
      }
      const crop = panCrop(active.box, active.crop, { x: at.x - active.start.x, y: at.y - active.start.y })
      onUpdate(active.element.id, { crop: isFullCrop(crop) ? undefined : crop }, false)
      showHud(`${round(crop.x * 100)}%, ${round(crop.y * 100)}%`, event.nativeEvent)
      return
    }
    if (active.kind === 'segment-move') {
      const dx = at.x - active.start.x
      const dy = at.y - active.start.y
      if (!active.moved && Math.hypot(dx, dy) * zoom < 3) return
      active.moved = true
      onUpdate(active.element.id, { ...moveNodes(active.element, active.world, active.nodeIds, { x: dx, y: dy }), kind: 'path' }, false)
      showHud(`Δ ${round(dx)}, ${round(dy)}`, event.nativeEvent)
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
        const center = elementCenter(active.single)
        const turned = ((patch.rotation ?? 0) - active.single.rotation) * Math.PI / 180
        const from = Math.atan2(active.start.y - center.y, active.start.x - center.x)
        setRotateArc({ center, from, to: from + turned, radius: Math.max(24 / zoom, Math.hypot(at.x - center.x, at.y - center.y) * 0.55) })
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
        const from = Math.atan2(active.start.y - active.center.y, active.start.x - active.center.x)
        const to = Math.atan2(current.y - active.center.y, current.x - active.center.x)
        setRotateArc({ center: active.center, from, to, radius: Math.max(24 / zoom, Math.hypot(current.x - active.center.x, current.y - active.center.y) * 0.55) })
        showHud(`${round(normalizeDegrees((to - from) * 180 / Math.PI))}°`, event.nativeEvent)
      }
    }
  }

  /**
   * Pointer moves are coalesced to one per frame: only the latest position matters, and a drag
   * that outruns the display would otherwise re-arrange the edited network several times a frame.
   */
  const pendingMove = useRef<ReactPointerEvent<SVGSVGElement> | null>(null)
  const moveFrame = useRef<number | null>(null)
  const moveHandler = useRef(applyCanvasPointerMove)
  moveHandler.current = applyCanvasPointerMove

  const flushPointerMove = useCallback(() => {
    if (moveFrame.current !== null) {
      cancelAnimationFrame(moveFrame.current)
      moveFrame.current = null
    }
    const latest = pendingMove.current
    pendingMove.current = null
    if (latest) moveHandler.current(latest)
  }, [])

  // On unmount the pending move is dropped, not applied: nobody is dragging any more.
  useEffect(() => () => {
    if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current)
    moveFrame.current = null
    pendingMove.current = null
  }, [])

  const onCanvasPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    pendingMove.current = event
    if (moveFrame.current !== null) return
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = null
      const latest = pendingMove.current
      pendingMove.current = null
      if (latest) moveHandler.current(latest)
    })
  }, [])

  const onGuidePointerDown = (guide: VectorGuide, event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0 || tool !== 'select' && tool !== 'transform') return
    event.stopPropagation()
    setSelectedGuide(guide.id)
    onGestureStart('Move guide')
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

  const onNodePointerDown = (nodeId: string, handle: HandleRef | null, event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0 || !editing) return
    event.stopPropagation()
    if (tool === 'pen') return
    const world = worldNetwork(editing)
    if (!handle && (event.metaKey || event.ctrlKey)) {
      // ⌘ on a smooth node makes it a corner; ⌘-drag on a corner pulls out handles.
      const incident = world.segments.filter((segment) => segment.a === nodeId || segment.b === nodeId)
      const smooth = incident.some((segment) => (segment.a === nodeId && segment.ah) || (segment.b === nodeId && segment.bh))
      if (smooth) {
        onUpdate(editing.id, { ...toggleNodeSmooth(editing, world, nodeId), kind: 'path' }, true, 'Toggle node')
        onSelectNodes([nodeId])
        return
      }
      const first = incident[0]
      if (!first) return
      const anchor = world.nodes.find((node) => node.id === nodeId)!.point
      const seeded: AbsNetwork = {
        nodes: world.nodes.map((node) => node.id === nodeId ? { ...node, handles: 'mirrored' as const } : node),
        segments: world.segments.map((segment) => segment.id === first.id ? (segment.a === nodeId ? { ...segment, ah: anchor } : { ...segment, bh: anchor }) : segment),
      }
      onSelectNodes([nodeId])
      onGestureStart('Move handle')
      interaction.current = {
        kind: 'node', pointerId: event.pointerId, start: point(event.nativeEvent), anchorStart: anchor,
        element: structuredClone(editing), world: seeded, nodeIds: [nodeId], handle: { segmentId: first.id, end: first.a === nodeId ? 'a' : 'b' }, targets: [], moved: true, toggleOnClick: null,
      }
      setDirectCursor('crosshair')
      svgRef.current?.setPointerCapture(event.pointerId)
      return
    }
    let nodeIds = selectedNodeIds
    let toggleOnClick: string | null = null
    if (!handle) {
      if (event.shiftKey) {
        if (selectedNodeIds.includes(nodeId)) toggleOnClick = nodeId
        else nodeIds = [...selectedNodeIds, nodeId]
      } else if (!selectedNodeIds.includes(nodeId)) {
        nodeIds = [nodeId]
      }
      onSelectNodes(nodeIds)
      setSelectedSegment(null)
    } else {
      nodeIds = [nodeId]
    }
    onGestureStart(handle ? 'Move handle' : countedLabel('Move', nodeIds.length, 'node'))
    interaction.current = {
      kind: 'node', pointerId: event.pointerId, start: point(event.nativeEvent), anchorStart: world.nodes.find((node) => node.id === nodeId)!.point,
      element: structuredClone(editing), world, nodeIds, handle,
      // The shape's own nodes are snap targets too, minus the ones being dragged.
      targets: [
        ...snapTargetsFor([editing.id]),
        ...(viewOptions.snapToNodes ? nodeSnapTargets(world.nodes.filter((node) => !nodeIds.includes(node.id)).map((node) => node.point)) : []),
      ],
      moved: false, toggleOnClick,
    }
    setDirectCursor(handle ? 'crosshair' : 'move')
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const onSegmentPointerDown = (segmentId: string, event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0 || !editing) return
    event.stopPropagation()
    const at = point(event.nativeEvent)
    const world = worldNetwork(editing)
    if (event.metaKey || event.ctrlKey) {
      const hit = nearestSegment(editing, at)
      if (!hit) return
      onGestureStart('Bend segment')
      onSelectNodes([])
      setSelectedSegment(segmentId)
      setBending(true)
      interaction.current = { kind: 'bend', pointerId: event.pointerId, element: structuredClone(editing), world, segmentId, t: hit.t }
      setDirectCursor('move')
      svgRef.current?.setPointerCapture(event.pointerId)
      return
    }
    const segment = world.segments.find((item) => item.id === segmentId)
    if (!segment) return
    onSelectNodes([])
    setSelectedSegment(segmentId)
    onGestureStart('Move segment')
    interaction.current = { kind: 'segment-move', pointerId: event.pointerId, start: at, element: structuredClone(editing), world, nodeIds: [segment.a, segment.b], segmentId, moved: false }
    setDirectCursor('move')
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const startNodeResize = (handle: DirectResizeHandle, event: ReactPointerEvent<SVGElement>) => {
    if (!editing || event.button !== 0) return
    event.stopPropagation()
    const world = worldNetwork(editing)
    const bounds = nodeBoundsOf(world, selectedNodeIds)
    if (!bounds) return
    onGestureStart(countedLabel('Scale', selectedNodeIds.length, 'node'))
    interaction.current = { kind: 'node-resize', pointerId: event.pointerId, element: structuredClone(editing), world, nodeIds: [...selectedNodeIds], bounds, handle }
    setDirectCursor(resizeCursor(handle, 0))
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const startNodeRotate = (event: ReactPointerEvent<SVGElement>) => {
    if (!editing || event.button !== 0) return
    event.stopPropagation()
    const world = worldNetwork(editing)
    const bounds = nodeBoundsOf(world, selectedNodeIds)
    if (!bounds) return
    onGestureStart(countedLabel('Rotate', selectedNodeIds.length, 'node'))
    interaction.current = { kind: 'node-rotate', pointerId: event.pointerId, start: point(event.nativeEvent), element: structuredClone(editing), world, nodeIds: [...selectedNodeIds], center: elementCenter(bounds) }
    setTransformStatus({ mode: 'rotate', axis: null })
    setDirectCursor('var(--cursor-rotate)')
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const editingWorld = editing ? worldNetwork(editing) : null
  const nodeBox = editing && editingWorld && selectedNodeIds.length > 1 ? nodeBoundsOf(editingWorld, selectedNodeIds) : null

  // Cropping owns the overlay: the ordinary resize handles would sit on top of the crop ones.
  const showHandles = (tool === 'select' || tool === 'scale') && selectedLeaves.length > 0 && !editing && !cropping
  const singleDirect = showHandles && selectedElements.length === 1 && selected && selected.kind !== 'group' && selected.kind !== 'boolean' ? selected : null
  const multiBounds = showHandles && !singleDirect ? selectionBounds(selectedLeaves) : null
  const enteredGroup = enteredGroupId ? elements.find((element) => element.id === enteredGroupId) ?? null : null
  const shapePointerDown = useRef(onShapePointerDown)
  shapePointerDown.current = onShapePointerDown
  const stableShapePointerDown = useCallback((element: VectorElement, event: ReactPointerEvent<SVGElement>) => {
    shapePointerDown.current(element, event)
  }, [])

  /** Visible document rectangle, padded, so off-screen shapes can skip their hit companion. */
  const viewBounds = useMemo(() => {
    if (!viewportSize.width || !viewportSize.height) return null
    const halfWidth = viewportSize.width / 2 / zoom
    const halfHeight = viewportSize.height / 2 / zoom
    const pad = 64 / zoom
    return {
      x: document.width / 2 - pan.x / zoom - halfWidth - pad,
      y: document.height / 2 - pan.y / zoom - halfHeight - pad,
      width: (halfWidth + pad) * 2,
      height: (halfHeight + pad) * 2,
    }
  }, [viewportSize.width, viewportSize.height, zoom, pan.x, pan.y, document.width, document.height])

  /** A light label for whatever the pointer is over in node mode: node number, or segment length. */
  const nodeTip = (() => {
    if (tool !== 'node' || !editing || !editingWorld || interaction.current || !pointerClient.current) return null
    if (hoveredNode) {
      const index = editingWorld.nodes.findIndex((node) => node.id === hoveredNode)
      if (index < 0) return null
      return { label: `Node ${index + 1}`, x: pointerClient.current.x + 14, y: pointerClient.current.y + 14 }
    }
    if (hoveredSegment) {
      const segment = editingWorld.segments.find((item) => item.id === hoveredSegment)
      if (!segment) return null
      return { label: `${round(cubicLength(segmentCubic(editingWorld, segment)))} px`, x: pointerClient.current.x + 14, y: pointerClient.current.y + 14 }
    }
    return null
  })()

  /** The rounded box whose corners can be pulled: a plain rectangle, selected on its own. */
  const cornerTarget = showHandles && !cropping && selectedElements.length === 1 && selected && selected.kind === 'rectangle' && !selected.network && !selected.locked ? selected : null

  /** The gradient being shown on the canvas: the topmost visible fill of a lone selection. */
  const gradientTarget = (() => {
    if (!showHandles || cropping || selectedElements.length !== 1 || !selected || selected.locked) return null
    const paints = fillsOf(selected)
    for (let index = paints.length - 1; index >= 0; index -= 1) {
      const paint = paints[index]!
      if (!paint.visible || paint.opacity <= 0) continue
      if (paint.type === 'linear' || paint.type === 'radial') return { element: selected, index, paint }
      return null
    }
    return null
  })()

  /** The image fill being placed, once "Edit image" has been opened on it. */
  const imagePlacing = (() => {
    if (!imagePlaceId) return null
    const element = elements.find((item) => item.id === imagePlaceId && !item.locked)
    if (!element) return null
    const paints = fillsOf(element)
    for (let index = paints.length - 1; index >= 0; index -= 1) {
      const paint = paints[index]!
      if (paint.visible && paint.type === 'image' && paint.image) return { element, index, paint }
    }
    return null
  })()

  placingRef.current = !!imagePlacing

  /** The primitive whose live shape can be pulled about: only one, only while it is still a primitive. */
  const shapeTarget = showHandles && !cropping && selectedElements.length === 1 && selected && !selected.network && !selected.locked
    && (selected.kind === 'polygon' || selected.kind === 'ellipse') ? selected : null

  const hoverOutline = hoveredId && !interaction.current && (tool === 'select' || tool === 'transform') ? elements.find((element) => element.id === resolveSelection(elements, hoveredId, enteredGroupId)) ?? null : null
  const penTarget = tool === 'pen' && !penDraft && selected && !isContainer(selected) && selected.kind !== 'text' && !selected.locked ? selected : null

  return (
    <div
      ref={viewportRef}
      className="vector-canvas"
      data-tool={tool}
      data-space={spaceDown || undefined}
      data-panning={panning || undefined}
      data-sampling={sampling || undefined}
      data-transform={transformStatus?.mode}
      data-axis={transformStatus?.axis ?? undefined}
      data-direct={directCursor ? true : undefined}
      data-editing={editing ? true : undefined}
      data-pen-active={penDraft ? true : undefined}
      data-pen-close={penCloseHint || undefined}
      data-meta={metaDown || undefined}
      data-bending={bending || undefined}
      data-outlines={viewOptions.outlines === 'off' ? undefined : viewOptions.outlines}
      data-pixel-preview={viewOptions.pixelPreview === 'off' ? undefined : viewOptions.pixelPreview}
      data-rulers={viewOptions.rulers || undefined}
      style={{ '--direct-cursor': directCursor ?? 'default', '--page-background': document.background } as CSSProperties}
      onPointerDownCapture={(event) => {
        if (event.button !== 1 && !(event.button === 0 && (spaceHeld.current || tool === 'hand'))) return
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
      onDragOver={(event) => {
        if (![...event.dataTransfer.items].some((item) => item.kind === 'file')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDropping(false) }}
      onDrop={(event) => {
        const files = [...event.dataTransfer.files]
        if (files.length === 0) return
        event.preventDefault()
        setDropping(false)
        void addImageFiles(files, point(event.nativeEvent))
      }}
      data-dropping={dropping || undefined}
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
              textEditingId={textEditId}
              inheritedLocked={false}
              viewBounds={viewBounds}
              onPointerDown={stableShapePointerDown}
              onHover={setHoveredId}
            />
          </g>
          {rotateArc ? <RotationArc arc={rotateArc} zoom={zoom} /> : null}
          {cropping ? <CropFrame element={cropping} zoom={zoom} coarse={coarse} onStart={startCrop} /> : null}
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
          {editing && editingWorld ? (
            <VectorNodes
              element={editing}
              world={editingWorld}
              zoom={zoom}
              selectedIds={selectedNodeIds}
              selectedSegmentId={selectedSegmentId}
              interactive={tool === 'node'}
              hoveredNodeId={hoveredNode}
              hoveredSegmentId={hoveredSegment}
              onHoverNode={setHoveredNode}
              onHoverSegment={setHoveredSegment}
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
          {zoomBox ? <rect className="vector-zoom-box" x={zoomBox.x} y={zoomBox.y} width={zoomBox.width} height={zoomBox.height} /> : null}
          {[...measurements, ...(measureDraft ? [measureDraft] : [])].map((item) => (
            <Ruler key={item.id} measurement={item} zoom={zoom} draft={item.id === 'draft'} />
          ))}
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
              onResize={(handle, event) => startResize(event, handle, null, movableLeaves)}
              onRotate={(event) => startRotate(event, null, movableLeaves)}
            />
          ) : null}
          {/* Above the box handles: these sit on the same spots and must win the click. */}
          {shapeTarget ? <ShapeHandles element={shapeTarget} zoom={zoom} coarse={coarse} onStart={startShapeHandle} /> : null}
          {cornerTarget ? <CornerHandles element={cornerTarget} zoom={zoom} coarse={coarse} onStart={startCorner} /> : null}
          {gradientTarget ? (
            <GradientOverlay
              element={gradientTarget.element}
              index={gradientTarget.index}
              paint={gradientTarget.paint}
              zoom={zoom}
              coarse={coarse}
              dropping={droppingStop}
              onStart={startGradient}
              onAddStop={addGradientStop}
            />
          ) : null}
          {imagePlacing ? (
            <rect
              className="vector-image-place"
              x={imagePlacing.element.x}
              y={imagePlacing.element.y}
              width={imagePlacing.element.width}
              height={imagePlacing.element.height}
              transform={`rotate(${imagePlacing.element.rotation} ${elementCenter(imagePlacing.element).x} ${elementCenter(imagePlacing.element).y})`}
              onPointerDown={(event) => startImagePlace(event, imagePlacing.element, imagePlacing.index, imagePlacing.paint)}
            />
          ) : null}
          {tool === 'select' && selectedElements.length > 1 ? selectedLeaves.map((element) => <OutlineOnly key={element.id} element={element} thin />) : null}
          {penTarget ? worldNetwork(penTarget).nodes.map((node) => (
            <circle key={node.id} className="vector-pen__endpoint" cx={node.point.x} cy={node.point.y} r={4 / zoom} />
          )) : null}
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
      {textEditing ? (
        <VectorTextEditor
          element={textEditing}
          zoom={zoom}
          pan={pan}
          viewport={viewportSize}
          page={{ width: document.width, height: document.height }}
          color={textEditing.fill === 'none' ? 'currentColor' : textEditing.fill}
          onChange={(text) => applyTextEdit(textEditing, text)}
          onCommit={() => closeTextEditor(false)}
          onCancel={() => closeTextEditor(true)}
        />
      ) : null}
      {nodeTip ? <div className="vector-tip" style={{ left: nodeTip.x, top: nodeTip.y }}>{nodeTip.label}</div> : null}
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

/** Topmost hittable element whose filled region contains the point (bucket tool). */
function bucketTarget(elements: VectorElement[], at: Point): VectorElement | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index]!
    if (!isHittable(element)) continue
    if (worldFaces(element).hit(at)) return element
  }
  return null
}

/** Stores a primitive's implicit network so region toggles have stable keys. */
function worldNetworkAsLocal(element: VectorElement): VectorElement['network'] {
  return normalizeWorld(worldNetwork(element)).network
}

function nodeBoundsOf(world: AbsNetwork, ids: string[]): Bounds | null {
  const points = world.nodes.filter((node) => ids.includes(node.id)).map((node) => node.point)
  if (points.length === 0) return null
  const left = Math.min(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const right = Math.max(...points.map((point) => point.x))
  const bottom = Math.max(...points.map((point) => point.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function nodeModalMap(mode: VectorTransformMode, axis: VectorTransformAxis, origin: Point, start: Point, current: Point): (point: Point) => Point {
  if (mode === 'move') {
    const dx = axis === 'y' ? 0 : current.x - start.x
    const dy = axis === 'x' ? 0 : current.y - start.y
    return (point) => ({ x: point.x + dx, y: point.y + dy })
  }
  if (mode === 'rotate') {
    const angle = Math.atan2(current.y - origin.y, current.x - origin.x) - Math.atan2(start.y - origin.y, start.x - origin.x)
    return (point) => rotatePoint(point, origin, angle * 180 / Math.PI)
  }
  const startVector = { x: start.x - origin.x, y: start.y - origin.y }
  const currentVector = { x: current.x - origin.x, y: current.y - origin.y }
  const uniform = Math.max(0.01, Math.hypot(currentVector.x, currentVector.y) / Math.max(1, Math.hypot(startVector.x, startVector.y)))
  const ratio = (value: number, base: number) => Math.abs(base) > 0.01 ? Math.max(0.01, value / base) : uniform
  const factorX = axis === 'y' ? 1 : axis === 'x' ? ratio(currentVector.x, startVector.x) : uniform
  const factorY = axis === 'x' ? 1 : axis === 'y' ? ratio(currentVector.y, startVector.y) : uniform
  return (point) => ({ x: origin.x + (point.x - origin.x) * factorX, y: origin.y + (point.y - origin.y) * factorY })
}

function ShapeTree({ nodes, zoom, coarse, pixelPreview, selectedIds, editingId, textEditingId, inheritedLocked, viewBounds, onPointerDown, onHover }: {
  nodes: TreeNode[]
  zoom: number
  coarse: boolean
  pixelPreview: VectorPixelPreview
  selectedIds: string[]
  editingId: string | null
  textEditingId: string | null
  inheritedLocked: boolean
  viewBounds: Bounds | null
  onPointerDown: (element: VectorElement, event: ReactPointerEvent<SVGElement>) => void
  onHover: (id: string | null) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const element = node.element
        if (!element.visible) return null
        if (element.kind === 'boolean') {
          // The members are the recipe; only the combined shape is painted.
          return (
            <VectorShape
              key={element.id}
              element={element}
              locked={inheritedLocked || element.locked}
              zoom={zoom}
              coarse={coarse}
              pixelPreview={pixelPreview}
              selected={selectedIds.includes(element.id)}
              editing={element.id === editingId}
              hideText={false}
              hitTarget={withinView(element, viewBounds)}
              onPointerDown={onPointerDown}
              onHover={onHover}
            />
          )
        }
        if (element.kind === 'frame') {
          const clipId = `frame-clip-${element.id}`
          const children = (
            <ShapeTree
              nodes={node.children}
              zoom={zoom}
              coarse={coarse}
              pixelPreview={pixelPreview}
              selectedIds={selectedIds}
              editingId={editingId}
              textEditingId={textEditingId}
              inheritedLocked={inheritedLocked || element.locked}
              viewBounds={viewBounds}
              onPointerDown={onPointerDown}
              onHover={onHover}
            />
          )
          return (
            <g key={element.id} data-vector-frame={element.id} opacity={element.opacity}>
              <VectorShape
                element={element}
                locked={inheritedLocked || element.locked}
                zoom={zoom}
                coarse={coarse}
                pixelPreview={pixelPreview}
                selected={selectedIds.includes(element.id)}
                editing={false}
                hideText={false}
                hitTarget={withinView(element, viewBounds)}
                onPointerDown={onPointerDown}
                onHover={onHover}
              />
              {element.clipContent ? (
                <>
                  <defs><FrameClip id={clipId} element={element} /></defs>
                  <g clipPath={`url(#${clipId})`}>{children}</g>
                </>
              ) : children}
              <FrameLabel element={element} zoom={zoom} onPointerDown={onPointerDown} />
            </g>
          )
        }
        if (element.kind === 'group') {
          const mask = node.children[0]?.element.mask ? node.children[0]!.element : null
          const masked = mask ? node.children.slice(1) : node.children
          const clipId = `mask-${element.id}`
          return (
            <g key={element.id} data-vector-group={element.id} data-masked={mask ? true : undefined} opacity={element.opacity}>
              {mask ? <defs><MaskClip id={clipId} element={mask} /></defs> : null}
              <g clipPath={mask ? `url(#${clipId})` : undefined}>
              <ShapeTree
                nodes={masked}
                zoom={zoom}
                coarse={coarse}
                pixelPreview={pixelPreview}
                selectedIds={selectedIds}
                editingId={editingId}
                textEditingId={textEditingId}
                inheritedLocked={inheritedLocked || element.locked}
                viewBounds={viewBounds}
                onPointerDown={onPointerDown}
                onHover={onHover}
              />
              </g>
              {mask ? <MaskOutline element={mask} /> : null}
            </g>
          )
        }
        return (
          <VectorShape
            key={element.id}
            element={element}
            locked={inheritedLocked || element.locked}
            zoom={zoom}
            coarse={coarse}
            pixelPreview={pixelPreview}
            selected={selectedIds.includes(element.id)}
            editing={element.id === editingId}
            hideText={element.id === textEditingId}
            hitTarget={withinView(element, viewBounds)}
            onPointerDown={onPointerDown}
            onHover={onHover}
          />
        )
      })}
    </>
  )
}

/**
 * One painted shape plus its stroke hit companion. Memoised on primitive props so a gesture
 * re-renders only the object it edits; the hit companion is skipped for shapes outside the view.
 */
const VectorShape = memo(function VectorShape({ element, locked, zoom, coarse, pixelPreview, selected, editing, hideText, hitTarget, onPointerDown, onHover }: {
  element: VectorElement
  locked: boolean
  zoom: number
  coarse: boolean
  pixelPreview: VectorPixelPreview
  selected: boolean
  editing: boolean
  hideText: boolean
  hitTarget: boolean
  onPointerDown: (element: VectorElement, event: ReactPointerEvent<SVGElement>) => void
  onHover: (id: string | null) => void
}) {
  const rendered = previewGeometry(element, pixelPreview)
  const hittable = isHittable({ ...element, locked }) && hitTarget
  const model = renderModel(rendered, 'canvas')
  const pointerDown = (event: ReactPointerEvent<SVGElement>) => onPointerDown(element, event)
  const hover = hittable ? { onPointerEnter: () => onHover(element.id), onPointerLeave: () => onHover(null) } : {}
  // A text box is grabbed anywhere inside it; a shape only where it actually paints.
  const painted = model.text || model.image ? hitTarget : hitTarget && model.layers.some((layer) => layer.kind === 'fill')
  const fillEvents = fillPointerEvents({ locked, visible: element.visible, fill: painted ? '#000000' : 'none' })
  return (
    <>
      {model.defs.length ? <defs><RenderDefs defs={model.defs} /></defs> : null}
      <g
        data-vector-element={element.id}
        data-selected={selected || undefined}
        data-locked={locked || undefined}
        data-editing={editing || undefined}
        opacity={model.opacity}
        pointerEvents={fillEvents}
        onPointerDown={pointerDown}
        {...hover}
      >
        {model.layers.map((layer, index) => (
          <path key={index} d={layer.d} transform={model.transform} {...layerAttributes(layer)} pointerEvents={layer.kind === 'fill' ? fillEvents : 'none'} />
        ))}
        {model.image ? (
          <>
            {model.defs.length ? null : null}
            <image
              href={model.image.href}
              x={model.image.x}
              y={model.image.y}
              width={model.image.width}
              height={model.image.height}
              preserveAspectRatio="none"
              clipPath={model.image.clipPath ?? undefined}
              style={model.image.rendering === 'pixelated' ? { imageRendering: 'pixelated' } : undefined}
              transform={model.transform}
              pointerEvents="none"
            />
            <path d={model.d} transform={model.transform} fill="none" stroke="none" pointerEvents={fillEvents === 'none' ? 'none' : 'all'} />
          </>
        ) : null}
        {model.text ? <path d={model.d} transform={model.transform} fill="none" stroke="none" pointerEvents={fillEvents === 'none' ? 'none' : 'all'} /> : null}
        {model.text && !hideText ? <TextLayer text={model.text} transform={model.transform} /> : null}
        {model.layers.length === 0 && !model.text && !model.image ? <path d={model.d} transform={model.transform} fill="none" stroke="none" pointerEvents="none" /> : null}
      </g>
      {hittable && !model.text && !model.image ? (
        <path
          className="vector-hit"
          data-vector-element={element.id}
          d={model.d}
          transform={model.transform}
          strokeWidth={strokeHitWidth(rendered.strokeWidth * (element.strokeAlign && element.strokeAlign !== 'center' ? 2 : 1), zoom, coarse)}
          onPointerDown={pointerDown}
          {...hover}
        />
      ) : null}
    </>
  )
})

/** The frame's name above its top-left corner, at a constant screen size, and a way to grab it. */
function FrameLabel({ element, zoom, onPointerDown }: {
  element: VectorElement
  zoom: number
  onPointerDown: (element: VectorElement, event: ReactPointerEvent<SVGElement>) => void
}) {
  const center = elementCenter(element)
  return (
    <text
      className="vector-frame-label"
      x={element.x}
      y={element.y - 6 / zoom}
      fontSize={11 / zoom}
      transform={`rotate(${element.rotation} ${center.x} ${center.y})`}
      pointerEvents={element.locked ? 'none' : 'auto'}
      onPointerDown={(event) => onPointerDown(element, event)}
    >
      {element.name}
    </text>
  )
}

/** Live handles of a primitive that still has a shape to pull: polygon sides, star points, arc ends. */
function ShapeHandles({ element, zoom, coarse, onStart }: {
  element: VectorElement
  zoom: number
  coarse: boolean
  onStart: (event: ReactPointerEvent<SVGElement>, element: VectorElement, handle: ShapeHandle) => void
}) {
  const hit = (coarse ? 22 : 16) / zoom
  const glyph = 3 / zoom
  const spots: Array<{ handle: ShapeHandle; at: Point; label: string }> = []
  if (element.kind === 'polygon') {
    const { sides, innerRatio } = polygonProperties(element)
    spots.push({ handle: 'polygon-sides', at: shapePoint(element, anglePoint(90)), label: `${sides} sides` })
    spots.push({ handle: 'polygon-ratio', at: shapePoint(element, anglePoint(90 + 180 / sides, innerRatio * 0.5)), label: 'Star points' })
  } else {
    const arc = arcProperties(element)
    const full = isFullEllipse(arc)
    if (!full) spots.push({ handle: 'arc-start', at: shapePoint(element, anglePoint(arc.start)), label: 'Arc start' })
    spots.push({ handle: 'arc-end', at: shapePoint(element, anglePoint(full ? 0 : arc.start + arc.sweep)), label: full ? 'Open an arc' : 'Arc end' })
    spots.push({ handle: 'arc-ratio', at: shapePoint(element, anglePoint(full ? 90 : arc.start + arc.sweep / 2, arc.ratio * 0.5)), label: 'Inner radius' })
  }
  return (
    <g className="vector-shape-handles" aria-hidden="true">
      {spots.map((spot) => (
        <g key={spot.handle}>
          <circle
            className="vector-shape-handle__hit"
            data-vector-shape-handle={spot.handle}
            cx={spot.at.x}
            cy={spot.at.y}
            r={hit / 2}
            onPointerDown={(event) => onStart(event, element, spot.handle)}
          >
            <title>{spot.label}</title>
          </circle>
          <circle className="vector-shape-handle" cx={spot.at.x} cy={spot.at.y} r={glyph} />
        </g>
      ))}
    </g>
  )
}

/** The turn a rotation has made so far: an arc from where it started, with the angle beside it. */
function RotationArc({ arc, zoom }: { arc: { center: Point; from: number; to: number; radius: number }; zoom: number }) {
  const delta = arc.to - arc.from
  const at = (angle: number) => ({ x: arc.center.x + Math.cos(angle) * arc.radius, y: arc.center.y + Math.sin(angle) * arc.radius })
  const start = at(arc.from)
  const end = at(arc.to)
  const large = Math.abs(delta) > Math.PI ? 1 : 0
  const sweep = delta > 0 ? 1 : 0
  const label = at(arc.from + delta / 2)
  const degrees = normalizeDegrees((delta * 180) / Math.PI)
  return (
    <g className="vector-rotation" aria-hidden="true">
      <line className="vector-rotation__ray" x1={arc.center.x} y1={arc.center.y} x2={start.x} y2={start.y} />
      <line className="vector-rotation__ray" x1={arc.center.x} y1={arc.center.y} x2={end.x} y2={end.y} />
      <path className="vector-rotation__arc" d={`M ${start.x} ${start.y} A ${arc.radius} ${arc.radius} 0 ${large} ${sweep} ${end.x} ${end.y}`} />
      <text className="vector-rotation__value" x={label.x} y={label.y} fontSize={11 / zoom} dy={-6 / zoom}>{round(degrees)}°</text>
    </g>
  )
}

/** The shape a masking child cuts the rest of its group to. */
function MaskClip({ id, element }: { id: string; element: VectorElement }) {
  const model = renderModel(element, 'canvas')
  return <clipPath id={id}><path d={model.fillD || model.d} transform={model.transform} clipRule="evenodd" /></clipPath>
}

/** A dashed outline where the mask is, so it can be seen even though it is not painted. */
function MaskOutline({ element }: { element: VectorElement }) {
  const model = renderModel(element, 'canvas')
  return <path className="vector-mask-outline" d={model.d} transform={model.transform} />
}

/** Clip shape of a frame: its box, turned with it. */
function FrameClip({ id, element }: { id: string; element: VectorElement }) {
  const model = renderModel(element, 'canvas')
  return <clipPath id={id}><path d={model.d} transform={model.transform} /></clipPath>
}

/** One `<text>` with a `<tspan>` per line; the paint rides on the text itself. */
function TextLayer({ text, transform }: { text: NonNullable<RenderModel['text']>; transform: string }) {
  return (
    <text
      transform={transform}
      fontFamily={text.fontFamily}
      fontSize={text.fontSize}
      fontWeight={text.fontWeight}
      letterSpacing={text.letterSpacing || undefined}
      textAnchor={text.anchor}
      fill={text.fill}
      fillOpacity={text.fillOpacity}
      stroke={text.stroke ?? undefined}
      strokeOpacity={text.stroke ? text.strokeOpacity : undefined}
      strokeWidth={text.stroke ? text.strokeWidth : undefined}
      pointerEvents="none"
      xmlSpace="preserve"
    >
      {text.lines.map((line, index) => <tspan key={index} x={line.x} y={line.y}>{line.text}</tspan>)}
    </text>
  )
}

type GradientHandle = 'from' | 'to' | 'center' | 'radius' | 'stop'

/** Corner rounding pulled straight on the shape: one disc per corner, ⌥ for a single one. */
function CornerHandles({ element, zoom, coarse, onStart }: {
  element: VectorElement
  zoom: number
  coarse: boolean
  onStart: (event: ReactPointerEvent<SVGElement>, element: VectorElement, corner: CornerName) => void
}) {
  const hit = (coarse ? 22 : 16) / zoom
  return (
    <g className="vector-corner-handles" aria-hidden="true">
      {CORNERS.map((corner) => {
        const at = cornerHandlePoint(element, corner, zoom)
        return (
          <g key={corner}>
            <circle className="vector-corner-handle__hit" data-vector-corner={corner} cx={at.x} cy={at.y} r={hit / 2} onPointerDown={(event) => onStart(event, element, corner)}>
              <title>Corner radius</title>
            </circle>
            <circle className="vector-corner-handle" cx={at.x} cy={at.y} r={3 / zoom} />
          </g>
        )
      })}
    </g>
  )
}

/** The gradient itself, laid over the shape: ends, stops, and the ramp between them. */
function GradientOverlay({ element, index, paint, zoom, coarse, dropping, onStart, onAddStop }: {
  element: VectorElement
  index: number
  paint: VectorPaint
  zoom: number
  coarse: boolean
  dropping: boolean
  onStart: (event: ReactPointerEvent<SVGElement>, element: VectorElement, index: number, handle: GradientHandle, stop: number) => void
  onAddStop: (event: ReactPointerEvent<SVGElement>, element: VectorElement, index: number) => void
}) {
  const hit = (coarse ? 22 : 16) / zoom
  const at = (normalized: Point) => worldFromNormalized(element, normalized)
  const stops = paint.stops ?? []
  if (paint.type === 'radial') {
    const circle = gradientCircle(paint)
    const center = at(circle.center)
    const edge = at({ x: circle.center.x + circle.radius, y: circle.center.y })
    return (
      <g className="vector-gradient" aria-hidden="true">
        <line className="vector-gradient__line" x1={center.x} y1={center.y} x2={edge.x} y2={edge.y} />
        {[{ point: center, handle: 'center' as const }, { point: edge, handle: 'radius' as const }].map((item) => (
          <g key={item.handle}>
            <circle className="vector-gradient__hit" data-vector-gradient={item.handle} cx={item.point.x} cy={item.point.y} r={hit / 2} onPointerDown={(event) => onStart(event, element, index, item.handle, -1)} />
            <circle className="vector-gradient__end" cx={item.point.x} cy={item.point.y} r={4 / zoom} />
          </g>
        ))}
      </g>
    )
  }
  const line = gradientLine(paint)
  const from = at(line.from)
  const to = at(line.to)
  return (
    <g className="vector-gradient" data-dropping={dropping || undefined} aria-hidden="true">
      {/* The ramp itself is a target: pressing it drops a stop there and drags it straight away. */}
      <line
        className="vector-gradient__ramp"
        data-vector-gradient="ramp"
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        strokeWidth={hit / 2}
        onPointerDown={(event) => onAddStop(event, element, index)}
      />
      <line className="vector-gradient__line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      {stops.map((stop, position) => {
        const spot = at(pointAt(line.from, line.to, stop.t))
        return (
          <g key={position}>
            <circle className="vector-gradient__hit" data-vector-gradient={`stop-${position}`} cx={spot.x} cy={spot.y} r={hit / 2} onPointerDown={(event) => onStart(event, element, index, 'stop', position)} />
            <circle className="vector-gradient__stop" cx={spot.x} cy={spot.y} r={4 / zoom} style={{ fill: stop.color }} />
          </g>
        )
      })}
      {[{ point: from, handle: 'from' as const }, { point: to, handle: 'to' as const }].map((item) => (
        <g key={item.handle}>
          <circle className="vector-gradient__hit" data-vector-gradient={item.handle} cx={item.point.x} cy={item.point.y} r={hit / 2} onPointerDown={(event) => onStart(event, element, index, item.handle, -1)} />
          <rect className="vector-gradient__end" x={item.point.x - 4 / zoom} y={item.point.y - 4 / zoom} width={8 / zoom} height={8 / zoom} />
        </g>
      ))}
    </g>
  )
}

/** A world point as a fraction of an element's box, rotation undone. */
function normalizedPoint(element: VectorElement, at: Point): Point {
  const local = localPoint(element, at)
  return { x: (local.x - element.x) / Math.max(1e-6, element.width), y: (local.y - element.y) / Math.max(1e-6, element.height) }
}

/** The reverse: a fraction of the box back to a world point, rotation applied. */
function worldFromNormalized(element: VectorElement, normalized: Point): Point {
  return shapePoint(element, normalized)
}

/** Whether an element's box, generously padded for rotation and stroke, meets the visible area. */
function withinView(element: VectorElement, view: Bounds | null): boolean {
  if (!view) return true
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  const reach = Math.hypot(element.width, element.height) / 2 + element.strokeWidth + 8
  return centerX + reach >= view.x && centerX - reach <= view.x + view.width
    && centerY + reach >= view.y && centerY - reach <= view.y + view.height
}

export function RenderDefs({ defs }: { defs: RenderDef[] }) {
  return (
    <>
      {defs.map((def) => {
        switch (def.type) {
          case 'linearGradient':
            return <linearGradient key={def.id} id={def.id} x1={def.x1} y1={def.y1} x2={def.x2} y2={def.y2}>{def.stops.map((stop, index) => <stop key={index} offset={`${stop.t * 100}%`} stopColor={stop.color} />)}</linearGradient>
          case 'radialGradient':
            return <radialGradient key={def.id} id={def.id} cx={def.cx} cy={def.cy} r={def.r}>{def.stops.map((stop, index) => <stop key={index} offset={`${stop.t * 100}%`} stopColor={stop.color} />)}</radialGradient>
          case 'pattern': {
            const placed = patternPlacement(def)
            return (
              <pattern key={def.id} id={def.id} patternUnits="userSpaceOnUse" x={def.x} y={def.y} width={placed.tileWidth} height={placed.tileHeight}>
                <image href={def.image} x={placed.x} y={placed.y} width={placed.width} height={placed.height} preserveAspectRatio={placed.aspect} />
              </pattern>
            )
          }
          case 'clipPath':
            return <clipPath key={def.id} id={def.id}><path d={def.d} clipRule="evenodd" /></clipPath>
          case 'mask':
            return <mask key={def.id} id={def.id} maskUnits="userSpaceOnUse" x={def.x} y={def.y} width={def.width} height={def.height}><rect x={def.x} y={def.y} width={def.width} height={def.height} fill="#fff" /><path d={def.d} fill="#000" fillRule="evenodd" /></mask>
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
      <div className="vector-ruler vector-ruler--x" onPointerDown={(event) => onPointerDown('y', event)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
        {selection ? <span className="vector-ruler__span" style={{ left: origin.x + selection.x * zoom, width: Math.max(1, selection.width * zoom) }} /> : null}
        {xTicks.map((value) => <span key={value} className="vector-ruler__tick" style={{ left: origin.x + value * zoom }}><span>{formatRulerValue(value)}</span></span>)}
      </div>
      <div className="vector-ruler vector-ruler--y" onPointerDown={(event) => onPointerDown('x', event)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
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

/** Node-edit overlay: every segment is selectable, every node draggable, handles on selected nodes. */
function VectorNodes({ element, world, zoom, selectedIds, selectedSegmentId, interactive, hoveredNodeId, hoveredSegmentId, onHoverNode, onHoverSegment, onNodePointerDown, onSegmentPointerDown }: {
  element: VectorElement
  world: AbsNetwork
  zoom: number
  selectedIds: string[]
  selectedSegmentId: string | null
  interactive: boolean
  hoveredNodeId: string | null
  hoveredSegmentId: string | null
  onHoverNode: (id: string | null) => void
  onHoverSegment: (id: string | null) => void
  onNodePointerDown: (nodeId: string, handle: HandleRef | null, event: ReactPointerEvent<SVGElement>) => void
  onSegmentPointerDown: (segmentId: string, event: ReactPointerEvent<SVGElement>) => void
}) {
  const hitRadius = 5 / zoom
  const pointRadius = 3.5 / zoom
  const controlRadius = 3 / zoom
  const nodeMap = new Map(world.nodes.map((node) => [node.id, node]))
  const selectedSet = new Set(selectedIds)
  const shownHandles: Array<{ segment: AbsSegment; end: 'a' | 'b'; point: Point; anchor: Point }> = []
  for (const segment of world.segments) {
    for (const end of ['a', 'b'] as const) {
      const handle = end === 'a' ? segment.ah : segment.bh
      if (!handle) continue
      const nodeId = end === 'a' ? segment.a : segment.b
      const otherId = end === 'a' ? segment.b : segment.a
      // Handles show on selected nodes and on the far end of segments touching them.
      if (!selectedSet.has(nodeId) && !selectedSet.has(otherId) && selectedSegmentId !== segment.id) continue
      shownHandles.push({ segment, end, point: handle, anchor: nodeMap.get(nodeId)!.point })
    }
  }
  return (
    <g className="vector-nodes" aria-label={`${element.name} nodes`}>
      {world.segments.map((segment) => {
        const cubic = segmentCubic(world, segment)
        const straight = !segment.ah && !segment.bh
        const d = straight ? `M ${cubic[0].x} ${cubic[0].y} L ${cubic[3].x} ${cubic[3].y}` : `M ${cubic[0].x} ${cubic[0].y} C ${cubic[1].x} ${cubic[1].y} ${cubic[2].x} ${cubic[2].y} ${cubic[3].x} ${cubic[3].y}`
        return (
          <g key={segment.id} data-selected-segment={selectedSegmentId === segment.id || undefined} data-hovered={hoveredSegmentId === segment.id || undefined}>
            <path className="vector-nodes__outline" d={d} />
            {interactive ? (
              <path
                className="vector-nodes__segment-hit"
                data-vector-segment={segment.id}
                d={d}
                onPointerEnter={() => onHoverSegment(segment.id)}
                onPointerLeave={() => onHoverSegment(null)}
                onPointerDown={(event) => onSegmentPointerDown(segment.id, event)}
              />
            ) : null}
          </g>
        )
      })}
      {shownHandles.map((item) => (
        <g key={`${item.segment.id}-${item.end}`}>
          <line className="vector-nodes__control-line" x1={item.anchor.x} y1={item.anchor.y} x2={item.point.x} y2={item.point.y} />
          {interactive ? <circle className="vector-nodes__control-hit" data-vector-control={`${item.segment.id}:${item.end}`} cx={item.point.x} cy={item.point.y} r={hitRadius} onPointerDown={(event) => onNodePointerDown(item.end === 'a' ? item.segment.a : item.segment.b, { segmentId: item.segment.id, end: item.end }, event)} /> : null}
          <circle className="vector-nodes__control" cx={item.point.x} cy={item.point.y} r={controlRadius} />
        </g>
      ))}
      {world.nodes.map((node) => {
        const incident = world.segments.filter((segment) => segment.a === node.id || segment.b === node.id)
        const smooth = incident.some((segment) => (segment.a === node.id && segment.ah) || (segment.b === node.id && segment.bh))
        return (
          <g key={node.id} data-hovered={hoveredNodeId === node.id || undefined}>
            {interactive ? (
              <circle
                className="vector-nodes__hit"
                data-vector-node={node.id}
                cx={node.point.x}
                cy={node.point.y}
                r={hitRadius}
                onPointerEnter={() => onHoverNode(node.id)}
                onPointerLeave={() => onHoverNode(null)}
                onPointerDown={(event) => onNodePointerDown(node.id, null, event)}
              />
            ) : null}
            {smooth
              ? <circle className="vector-nodes__point" data-selected={selectedSet.has(node.id) || undefined} data-hovered={hoveredNodeId === node.id || undefined} cx={node.point.x} cy={node.point.y} r={hoveredNodeId === node.id ? pointRadius * 1.5 : pointRadius} />
              : <rect className="vector-nodes__point" data-selected={selectedSet.has(node.id) || undefined} data-hovered={hoveredNodeId === node.id || undefined} x={node.point.x - (hoveredNodeId === node.id ? pointRadius * 1.5 : pointRadius)} y={node.point.y - (hoveredNodeId === node.id ? pointRadius * 1.5 : pointRadius)} width={(hoveredNodeId === node.id ? pointRadius * 1.5 : pointRadius) * 2} height={(hoveredNodeId === node.id ? pointRadius * 1.5 : pointRadius) * 2} rx={0.75 / zoom} />}
          </g>
        )
      })}
    </g>
  )
}

function PenPreview({ draft, cursor, zoom, closeHint }: { draft: PenDraft; cursor: Point | null; zoom: number; closeHint: boolean }) {
  const size = 3.5 / zoom
  const current = draft.current ? draft.world.nodes.find((node) => node.id === draft.current) : null
  const start = draft.start ? draft.world.nodes.find((node) => node.id === draft.start) : null
  const lastSegment = draft.lastSegment ? draft.world.segments.find((segment) => segment.id === draft.lastSegment) : null
  const inHandle = lastSegment && current ? (lastSegment.b === current.id ? lastSegment.bh : lastSegment.ah) : undefined
  return (
    <g className="vector-pen">
      <path className="vector-pen__path" d={penPreviewData(draft, cursor)} />
      {current && inHandle ? <line className="vector-nodes__control-line" x1={current.point.x} y1={current.point.y} x2={inHandle.x} y2={inHandle.y} /> : null}
      {current && draft.pendingOut ? <line className="vector-nodes__control-line" x1={current.point.x} y1={current.point.y} x2={draft.pendingOut.x} y2={draft.pendingOut.y} /> : null}
      {current && inHandle ? <circle className="vector-nodes__control" cx={inHandle.x} cy={inHandle.y} r={3 / zoom} /> : null}
      {current && draft.pendingOut ? <circle className="vector-nodes__control" cx={draft.pendingOut.x} cy={draft.pendingOut.y} r={3 / zoom} /> : null}
      {draft.world.nodes.map((node) => (
        <rect key={node.id} className="vector-pen__anchor" data-first={node.id === draft.start || undefined} data-current={node.id === draft.current || undefined} x={node.point.x - size} y={node.point.y - size} width={size * 2} height={size * 2} rx={0.75 / zoom} />
      ))}
      {closeHint && start ? <circle className="vector-pen__close" cx={start.point.x} cy={start.point.y} r={PEN_CLOSE_PX / zoom} /> : null}
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

/**
 * Crop editing: the whole picture ghosted behind, the visible window with a thirds grid, and
 * eight handles that move the window while the picture stays where it is.
 */
function CropFrame({ element, zoom, coarse, onStart }: {
  element: VectorElement
  zoom: number
  coarse: boolean
  onStart: (event: ReactPointerEvent<SVGElement>, handle: DirectResizeHandle | null) => void
}) {
  const box = { x: element.x, y: element.y, width: element.width, height: element.height }
  const display = displayRect(box, element.crop ?? FULL_CROP)
  const center = elementCenter(element)
  const transform = `rotate(${element.rotation} ${center.x} ${center.y})`
  const size = (coarse ? 11 : 8) / zoom
  const handles: Array<{ handle: DirectResizeHandle; x: number; y: number }> = [
    { handle: 'nw', x: box.x, y: box.y },
    { handle: 'n', x: box.x + box.width / 2, y: box.y },
    { handle: 'ne', x: box.x + box.width, y: box.y },
    { handle: 'e', x: box.x + box.width, y: box.y + box.height / 2 },
    { handle: 'se', x: box.x + box.width, y: box.y + box.height },
    { handle: 's', x: box.x + box.width / 2, y: box.y + box.height },
    { handle: 'sw', x: box.x, y: box.y + box.height },
    { handle: 'w', x: box.x, y: box.y + box.height / 2 },
  ]
  return (
    <g className="vector-crop" data-vector-crop={element.id} transform={transform}>
      <image
        href={element.image}
        x={display.x}
        y={display.y}
        width={display.width}
        height={display.height}
        preserveAspectRatio="none"
        opacity={0.35}
        pointerEvents="none"
        style={element.imageRendering === 'pixelated' ? { imageRendering: 'pixelated' } : undefined}
      />
      <rect className="vector-crop__hit" x={box.x} y={box.y} width={box.width} height={box.height} onPointerDown={(event) => onStart(event, null)} />
      <rect className="vector-crop__frame" x={box.x} y={box.y} width={box.width} height={box.height} />
      {[1, 2].map((step) => (
        <g key={step}>
          <line className="vector-crop__grid" x1={box.x + (box.width * step) / 3} y1={box.y} x2={box.x + (box.width * step) / 3} y2={box.y + box.height} />
          <line className="vector-crop__grid" x1={box.x} y1={box.y + (box.height * step) / 3} x2={box.x + box.width} y2={box.y + (box.height * step) / 3} />
        </g>
      ))}
      {handles.map((item) => (
        <rect
          key={item.handle}
          className="vector-crop__handle"
          data-vector-crop-handle={item.handle}
          x={item.x - size / 2}
          y={item.y - size / 2}
          width={size}
          height={size}
          style={{ cursor: resizeCursor(item.handle, element.rotation) }}
          onPointerDown={(event) => onStart(event, item.handle)}
        />
      ))}
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
/** A measurement laid on the canvas: the line, its end ticks and its reading. */
function Ruler({ measurement, zoom, draft }: { measurement: Measurement; zoom: number; draft: boolean }) {
  const { from, to } = measurement
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  // The ticks sit across the line and keep their size on screen whatever the zoom.
  const tick = 5 / zoom
  const across = { x: (-dy / length) * tick, y: (dx / length) * tick }
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  return (
    <g className="vector-ruler" data-draft={draft || undefined}>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth={1 / zoom} />
      <line x1={from.x - across.x} y1={from.y - across.y} x2={from.x + across.x} y2={from.y + across.y} strokeWidth={1 / zoom} />
      <line x1={to.x - across.x} y1={to.y - across.y} x2={to.x + across.x} y2={to.y + across.y} strokeWidth={1 / zoom} />
      <text x={mid.x + across.x * 2.4} y={mid.y + across.y * 2.4} fontSize={11 / zoom} textAnchor="middle">
        {measurementLabel(from, to)}
      </text>
    </g>
  )
}

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

/** Three-quarter arc around a corner that leaves the quadrant pointing into the box uncovered. */
function rotateZonePath(cx: number, cy: number, r: number, corner: Corner): string {
  const skip: Record<Corner, number> = { nw: 0, ne: 90, se: 180, sw: 270 }
  const start = ((skip[corner] + 90) * Math.PI) / 180
  const end = ((skip[corner] + 360) * Math.PI) / 180
  const from = { x: cx + Math.cos(start) * r, y: cy + Math.sin(start) * r }
  const to = { x: cx + Math.cos(end) * r, y: cy + Math.sin(end) * r }
  return `M ${from.x} ${from.y} A ${r} ${r} 0 1 1 ${to.x} ${to.y}`
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

/** Whether a point passes within `radius` of a segment, sampled along its cubic. */
function segmentNear(world: AbsNetwork, segment: AbsSegment, point: Point, radius: number): boolean {
  const cubic = segmentCubic(world, segment)
  for (let step = 0; step <= 12; step += 1) {
    const at = cubicAt(cubic, step / 12)
    if (Math.hypot(at.x - point.x, at.y - point.y) <= radius) return true
  }
  return false
}

/** Length of a cubic, sampled finely enough to read out. */
function cubicLength(cubic: [Point, Point, Point, Point]): number {
  let total = 0
  let previous = cubic[0]
  for (let step = 1; step <= 24; step += 1) {
    const point = cubicAt(cubic, step / 24)
    total += Math.hypot(point.x - previous.x, point.y - previous.y)
    previous = point
  }
  return total
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

