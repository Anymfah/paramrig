import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createVectorElement } from '@/vector/document'
import { resizeCursor, resizeElement, rotatePoint, type DirectResizeHandle } from '@/vector/directTransform'
import { transformElement, transformElements, type VectorTransformAxis, type VectorTransformMode } from '@/vector/transform'
import { defaultVectorNodes, moveVectorNode, nodeIndicesInBounds, nodePosition, nodeWorldPosition, transformVectorNodes, vectorPathData } from '@/vector/vectorPath'
import type { VectorDocument, VectorElement, VectorNode, VectorTool } from '@/vector/types'

type Point = { x: number; y: number }
type Bounds = { x: number; y: number; width: number; height: number }
type Corner = Extract<DirectResizeHandle, 'nw' | 'ne' | 'se' | 'sw'>

export type VectorPixelPreview = 'off' | '1x' | '2x'
export type VectorOutlineMode = 'off' | 'all' | 'selected'
export type VectorViewOptions = {
  pixelPreview: VectorPixelPreview
  pixelGrid: boolean
  snapToPixelGrid: boolean
  layoutGuides: boolean
  rulers: boolean
  outlines: VectorOutlineMode
}

type Interaction =
  | { kind: 'create'; pointerId: number; start: Point; current: Point }
  | { kind: 'marquee'; pointerId: number; start: Point; current: Point; additive: boolean }
  | { kind: 'node-marquee'; pointerId: number; start: Point; current: Point; additive: boolean; outside: boolean; element: VectorElement; nodes: VectorNode[] }
  | { kind: 'move'; pointerId: number; start: Point; element: VectorElement }
  | { kind: 'resize'; pointerId: number; start: Point; element: VectorElement; handle: DirectResizeHandle }
  | { kind: 'rotate'; pointerId: number; start: Point; element: VectorElement }
  | { kind: 'node'; pointerId: number; start: Point; element: VectorElement; nodes: VectorNode[]; nodeIndices: number[]; nodeIndex: number; part: 'anchor' | 'in' | 'out' }
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
  selectedId: string | null
  selectedIds: string[]
  onSelect: (id: string | null) => void
  onSelectIds: (ids: string[]) => void
  onEnterNodeEdit: () => void
  onAdd: (element: VectorElement) => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onUpdateElements: (updates: Array<{ id: string; patch: Partial<VectorElement> }>, record?: boolean) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  onGestureCancel: () => void
}

export function VectorCanvas({
  document,
  tool,
  zoom,
  pan,
  viewOptions,
  onPanChange,
  onZoomChange,
  selectedId,
  selectedIds,
  onSelect,
  onSelectIds,
  onEnterNodeEdit,
  onAdd,
  onUpdate,
  onUpdateElements,
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
  const clickCandidate = useRef<{ id: string; pointerId: number; x: number; y: number } | null>(null)
  const lastShapeClick = useRef<{ id: string; x: number; y: number; time: number } | null>(null)
  const lastCanvasClick = useRef<{ x: number; y: number; time: number } | null>(null)
  const documentRef = useRef(document)
  const selectedRef = useRef<VectorElement | null>(null)
  const selectedElementsRef = useRef<VectorElement[]>([])
  const toolRef = useRef(tool)
  const snapRef = useRef(viewOptions.snapToPixelGrid)
  const editingIdRef = useRef<string | null>(null)
  const selectedNodeIndicesRef = useRef<number[]>([])
  const callbacks = useRef({ onUpdate, onUpdateElements, onGestureStart, onGestureEnd, onGestureCancel })
  const [draftBounds, setDraftBounds] = useState<Bounds | null>(null)
  const [marqueeBounds, setMarqueeBounds] = useState<Bounds | null>(null)
  const [panning, setPanning] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const [directCursor, setDirectCursor] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedNodeIndices, setSelectedNodeIndices] = useState<number[]>([])
  const [transformStatus, setTransformStatus] = useState<{ mode: VectorTransformMode; axis: VectorTransformAxis } | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const selected = document.elements.find((element) => element.id === selectedId) ?? null
  const selectedElements = document.elements.filter((element) => selectedIds.includes(element.id))

  camera.current = { pan, zoom }
  documentRef.current = document
  selectedRef.current = selected
  selectedElementsRef.current = selectedElements
  toolRef.current = tool
  snapRef.current = viewOptions.snapToPixelGrid
  editingIdRef.current = editingId
  selectedNodeIndicesRef.current = selectedNodeIndices
  callbacks.current = { onUpdate, onUpdateElements, onGestureStart, onGestureEnd, onGestureCancel }

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

  useEffect(() => {
    const finishModal = (result: 'confirm' | 'cancel') => {
      if (interaction.current?.kind !== 'modal') return
      if (result === 'cancel') callbacks.current.onGestureCancel()
      else callbacks.current.onGestureEnd()
      interaction.current = null
      setTransformStatus(null)
    }
    const startModal = (mode: VectorTransformMode) => {
      const editingElement = editingIdRef.current ? selectedRef.current : null
      const nodeIndices = selectedNodeIndicesRef.current
      if (editingElement && nodeIndices.length > 0 && !editingElement.locked && toolRef.current === 'transform' && !interaction.current) {
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
      const elements = selectedElementsRef.current.filter((element) => !element.locked)
      if (elements.length === 0 || toolRef.current !== 'transform' || interaction.current) return false
      const bounds = selectionBounds(elements)
      const start = latestPointer.current ?? { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }
      callbacks.current.onGestureStart()
      interaction.current = { kind: 'modal', target: 'elements', mode, axis: null, start, elements: structuredClone(elements), preview: structuredClone(elements) }
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
      if (editable || event.metaKey || event.ctrlKey || event.altKey) return
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
      if (editingIdRef.current && (key === 'backspace' || key === 'delete')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const element = selectedRef.current
        const nodeIndices = selectedNodeIndicesRef.current
        if (!element || nodeIndices.length === 0) return
        const nodes = element.vectorNodes ?? defaultVectorNodes(element)
        const selected = new Set(nodeIndices)
        if (nodes.length - selected.size < 3) return
        callbacks.current.onUpdate(element.id, { vectorNodes: nodes.filter((_, index) => !selected.has(index)) })
        setSelectedNodeIndices([])
        return
      }
      if (editingIdRef.current && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const element = selectedRef.current
        const nodeIndices = selectedNodeIndicesRef.current
        if (!element || nodeIndices.length === 0) return
        const nodes = element.vectorNodes ?? defaultVectorNodes(element)
        const amount = event.shiftKey ? 10 : 1
        const delta = {
          x: key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0,
          y: key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0,
        }
        callbacks.current.onUpdate(element.id, transformVectorNodes(element, nodes, nodeIndices, 'move', null, { x: 0, y: 0 }, delta))
        return
      }
      if (!event.repeat && (key === 'g' || key === 'r' || key === 's')) {
        const mode: VectorTransformMode = key === 'g' ? 'move' : key === 'r' ? 'rotate' : 'scale'
        if (startModal(mode)) {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
        return
      }
      if (key === 'escape' && active) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (active.kind !== 'create' && active.kind !== 'marquee' && active.kind !== 'node-marquee') callbacks.current.onGestureCancel()
        interaction.current = null
        setDraftBounds(null)
        setMarqueeBounds(null)
        setTransformStatus(null)
        setDirectCursor(null)
        return
      }
      if (key === 'escape' && editingIdRef.current) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setEditingId(null)
        setSelectedNodeIndices([])
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      spaceHeld.current = false
      setSpaceDown(false)
    }
    const onPointerMove = (event: PointerEvent) => {
      const current = point(event)
      latestPointer.current = current
      const active = interaction.current
      if (active?.kind !== 'modal') return
      event.preventDefault()
      if (active.target === 'elements') {
        const updates = transformElements(active.mode, active.axis, active.elements, active.start, current)
          .map((update) => ({ ...update, patch: snapRef.current ? snapGeometryPatch(update.patch) : update.patch }))
        const byId = new Map(updates.map((update) => [update.id, update.patch]))
        active.preview = active.elements.map((element) => ({ ...element, ...byId.get(element.id) }))
        callbacks.current.onUpdateElements(updates, false)
      } else {
        const rawPatch = transformVectorNodes(active.element, active.nodes, active.nodeIndices, active.mode, active.axis, active.start, current)
        const patch = snapRef.current ? snapGeometryPatch(rawPatch) : rawPatch
        active.preview = { ...active.element, ...patch }
        callbacks.current.onUpdate(active.element.id, patch, false)
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
      finishModal('cancel')
    }
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
  }, [point])

  useEffect(() => {
    if (tool !== 'select' && tool !== 'transform' || editingId && editingId !== selectedId) {
      setEditingId(null)
      setSelectedNodeIndices([])
    }
  }, [editingId, selectedId, tool])

  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    const candidate = clickCandidate.current
    if (candidate?.pointerId === event.pointerId) {
      const distance = Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y)
      if (distance <= 5) {
        lastShapeClick.current = { id: candidate.id, x: event.clientX, y: event.clientY, time: performance.now() }
      }
      clickCandidate.current = null
    }
    const active = interaction.current
    if (!active || active.kind === 'modal' || active.pointerId !== event.pointerId) return
    if (active.kind === 'create') {
      const bounds = boundsBetween(active.start, active.current, event.shiftKey)
      if (bounds.width >= 2 && bounds.height >= 2) {
        onAdd(createVectorElement(tool === 'ellipse' ? 'ellipse' : 'rectangle', viewOptions.snapToPixelGrid ? snapBounds(bounds) : bounds))
      }
    } else if (active.kind === 'marquee') {
      const bounds = boundsBetween(active.start, active.current, false)
      const hits = document.elements
        .filter((element) => element.visible && !element.locked && intersects(bounds, selectionBounds([element])))
        .map((element) => element.id)
      onSelectIds(active.additive ? [...new Set([...selectedIds, ...hits])] : hits)
      setMarqueeBounds(null)
    } else if (active.kind === 'node-marquee') {
      const bounds = boundsBetween(active.start, active.current, false)
      const hits = nodeIndicesInBounds(active.element, active.nodes, bounds)
      setSelectedNodeIndices(active.additive ? [...new Set([...selectedNodeIndicesRef.current, ...hits])] : hits)
      if (active.outside && bounds.width <= 3 && bounds.height <= 3) {
        const previous = lastCanvasClick.current
        const repeated = previous
          && performance.now() - previous.time <= 450
          && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 8
        if (repeated) {
          setEditingId(null)
          setSelectedNodeIndices([])
          lastCanvasClick.current = null
        } else {
          lastCanvasClick.current = { x: event.clientX, y: event.clientY, time: performance.now() }
        }
      } else {
        lastCanvasClick.current = null
      }
      setMarqueeBounds(null)
    } else {
      onGestureEnd()
    }
    interaction.current = null
    setDraftBounds(null)
    setTransformStatus(null)
    setDirectCursor(null)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
  }

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
      data-editing={editingId ? true : undefined}
      data-outlines={viewOptions.outlines === 'off' ? undefined : viewOptions.outlines}
      data-pixel-preview={viewOptions.pixelPreview === 'off' ? undefined : viewOptions.pixelPreview}
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
    >
      <svg
        ref={svgRef}
        className="vector-artboard"
        role="application"
        aria-label={`${document.name} vector canvas`}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.target !== event.currentTarget && (event.target as Element).closest('[data-vector-element], [data-vector-handle], [data-vector-rotate]')) return
          const at = point(event.nativeEvent)
          if (editingId && selected && selected.id === editingId && (tool === 'select' || tool === 'transform')) {
            if (!event.shiftKey) setSelectedNodeIndices([])
            interaction.current = {
              kind: 'node-marquee', pointerId: event.pointerId, start: at, current: at,
              additive: event.shiftKey, outside: true, element: structuredClone(selected), nodes: structuredClone(selected.vectorNodes ?? defaultVectorNodes(selected)),
            }
            setMarqueeBounds({ x: at.x, y: at.y, width: 0, height: 0 })
            event.currentTarget.setPointerCapture(event.pointerId)
            return
          }
          if (tool === 'transform') {
            setEditingId(null)
            setSelectedNodeIndices([])
            if (!event.shiftKey) onSelectIds([])
            interaction.current = { kind: 'marquee', pointerId: event.pointerId, start: at, current: at, additive: event.shiftKey }
            setMarqueeBounds({ x: at.x, y: at.y, width: 0, height: 0 })
            event.currentTarget.setPointerCapture(event.pointerId)
            return
          }
          if (tool === 'select') {
            setEditingId(null)
            setSelectedNodeIndices([])
            onSelectIds([])
            return
          }
          interaction.current = { kind: 'create', pointerId: event.pointerId, start: at, current: at }
          setDraftBounds({ x: at.x, y: at.y, width: 0, height: 0 })
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const candidate = clickCandidate.current
          if (candidate?.pointerId === event.pointerId && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) > 5) {
            clickCandidate.current = null
            lastShapeClick.current = null
          }
          const active = interaction.current
          if (!active || active.kind === 'modal' || active.pointerId !== event.pointerId) return
          const at = point(event.nativeEvent)
          if (active.kind === 'create') {
            active.current = at
            setDraftBounds(boundsBetween(active.start, at, event.shiftKey))
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
            if (event.shiftKey) {
              if (Math.abs(dx) >= Math.abs(dy)) dy = 0
              else dx = 0
            }
            onUpdate(active.element.id, {
              x: viewOptions.snapToPixelGrid ? Math.round(active.element.x + dx) : round(active.element.x + dx),
              y: viewOptions.snapToPixelGrid ? Math.round(active.element.y + dy) : round(active.element.y + dy),
            }, false)
            return
          }
          if (active.kind === 'resize') {
            const patch = resizeElement(active.element, active.handle, at, {
              lockRatio: event.shiftKey,
              fromCenter: event.altKey,
            })
            onUpdate(active.element.id, viewOptions.snapToPixelGrid ? snapGeometryPatch(patch) : patch, false)
            return
          }
          if (active.kind === 'node') {
            const rawPatch = active.part === 'anchor'
              ? transformVectorNodes(active.element, active.nodes, active.nodeIndices, 'move', null, active.start, at)
              : moveVectorNode(active.element, active.nodes, active.nodeIndex, active.part, at, !event.altKey)
            const patch = viewOptions.snapToPixelGrid ? snapGeometryPatch(rawPatch) : rawPatch
            onUpdate(active.element.id, patch, false)
            return
          }
          const rotateAt = point(event.nativeEvent)
          const patch = transformElement('rotate', null, active.element, active.start, rotateAt)
          if (event.shiftKey && typeof patch.rotation === 'number') patch.rotation = Math.round(patch.rotation / 15) * 15
          onUpdate(active.element.id, patch, false)
        }}
        onPointerUp={finish}
        onPointerCancel={(event) => {
          if (clickCandidate.current?.pointerId === event.pointerId) clickCandidate.current = null
          const active = interaction.current
          if (!active || active.kind === 'modal') return
          if (active.kind !== 'create' && active.kind !== 'marquee' && active.kind !== 'node-marquee') onGestureCancel()
          interaction.current = null
          setDraftBounds(null)
          setMarqueeBounds(null)
          setTransformStatus(null)
          setDirectCursor(null)
          try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
        }}
        onLostPointerCapture={() => {
          clickCandidate.current = null
          const active = interaction.current
          if (!active || active.kind === 'modal') return
          if (active.kind !== 'create' && active.kind !== 'marquee' && active.kind !== 'node-marquee') onGestureCancel()
          interaction.current = null
          setDraftBounds(null)
          setMarqueeBounds(null)
          setTransformStatus(null)
          setDirectCursor(null)
        }}
      >
        <defs>
          <pattern id={`${instanceId}-layout-guides`} width="64" height="64" patternUnits="userSpaceOnUse">
            <path className="vector-layout-grid__line" d="M 64 0 L 0 0 0 64" />
          </pattern>
          <pattern id={`${instanceId}-pixel-grid`} width={zoom >= 4 ? 1 : 8} height={zoom >= 4 ? 1 : 8} patternUnits="userSpaceOnUse">
            <path className="vector-pixel-grid__line" d={`M ${zoom >= 4 ? 1 : 8} 0 L 0 0 0 ${zoom >= 4 ? 1 : 8}`} />
          </pattern>
        </defs>
        <g
          ref={worldRef}
          className="vector-world"
          transform={`translate(${viewportSize.width / 2 + pan.x} ${viewportSize.height / 2 + pan.y}) scale(${zoom}) translate(${-document.width / 2} ${-document.height / 2})`}
        >
        {viewOptions.layoutGuides ? <rect className="vector-layout-grid" x={-100000} y={-100000} width={200000} height={200000} fill={`url(#${instanceId}-layout-guides)`} /> : null}
        {viewOptions.pixelGrid ? <rect className="vector-pixel-grid" x={-100000} y={-100000} width={200000} height={200000} fill={`url(#${instanceId}-pixel-grid)`} /> : null}
        <g className="vector-shapes" data-pixel-preview={viewOptions.pixelPreview === 'off' ? undefined : viewOptions.pixelPreview}>
        {document.elements.filter((element) => element.visible).map((element) => (
          <VectorShape
            key={element.id}
            element={element}
            pixelPreview={viewOptions.pixelPreview}
            selected={selectedIds.includes(element.id)}
            editing={element.id === editingId}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              const previous = lastShapeClick.current
              const repeated = previous?.id === element.id
                && performance.now() - previous.time <= 450
                && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 8
              if (repeated && (tool === 'select' || tool === 'transform') && !element.locked) {
                event.preventDefault()
                clickCandidate.current = null
                lastShapeClick.current = null
                interaction.current = null
                setDirectCursor(null)
                if (tool === 'select') onEnterNodeEdit()
                onSelect(element.id)
                setEditingId(element.id)
                setSelectedNodeIndices([])
                return
              }
              if (tool !== 'select' && tool !== 'transform') return
              if (editingId === element.id) {
                const at = point(event.nativeEvent)
                if (!event.shiftKey) setSelectedNodeIndices([])
                interaction.current = {
                  kind: 'node-marquee', pointerId: event.pointerId, start: at, current: at,
                  additive: event.shiftKey, outside: false, element: structuredClone(element), nodes: structuredClone(element.vectorNodes ?? defaultVectorNodes(element)),
                }
                lastCanvasClick.current = null
                setMarqueeBounds({ x: at.x, y: at.y, width: 0, height: 0 })
                svgRef.current?.setPointerCapture(event.pointerId)
                return
              }
              clickCandidate.current = { id: element.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
              if (event.shiftKey) {
                onSelectIds(selectedIds.includes(element.id)
                  ? selectedIds.filter((id) => id !== element.id)
                  : [...selectedIds, element.id])
                return
              } else if (!selectedIds.includes(element.id) || selectedIds.length > 1) {
                onSelect(element.id)
              }
              if (tool !== 'select' || element.locked) return
              onGestureStart()
              interaction.current = {
                kind: 'move',
                pointerId: event.pointerId,
                start: point(event.nativeEvent),
                element: structuredClone(element),
              }
              setDirectCursor('move')
              svgRef.current?.setPointerCapture(event.pointerId)
            }}
            onDoubleClick={(event) => {
              if ((tool !== 'select' && tool !== 'transform') || element.locked) return
              event.preventDefault()
              event.stopPropagation()
              if (tool === 'select') onEnterNodeEdit()
              onSelect(element.id)
              setEditingId(element.id)
              setSelectedNodeIndices([])
            }}
          />
        ))}
        </g>
        {transformStatus?.axis && selected ? <AxisGuide element={selected} axis={transformStatus.axis} /> : null}
        {editingId && selected && selected.id === editingId && selected.visible && !selected.locked ? (
          <VectorNodes
            element={selected}
            zoom={zoom}
            selectedIndices={selectedNodeIndices}
            onNodePointerDown={(nodeIndex, part, event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              const nodes = structuredClone(selected.vectorNodes ?? defaultVectorNodes(selected))
              if (part === 'anchor' && event.shiftKey) {
                setSelectedNodeIndices(selectedNodeIndices.includes(nodeIndex)
                  ? selectedNodeIndices.filter((index) => index !== nodeIndex)
                  : [...selectedNodeIndices, nodeIndex])
                return
              }
              const nodeIndices = part === 'anchor' && selectedNodeIndices.includes(nodeIndex)
                ? selectedNodeIndices
                : [nodeIndex]
              setSelectedNodeIndices(nodeIndices)
              onGestureStart()
              interaction.current = {
                kind: 'node',
                pointerId: event.pointerId,
                start: point(event.nativeEvent),
                element: structuredClone(selected),
                nodes,
                nodeIndices,
                nodeIndex,
                part,
              }
              setDirectCursor(part === 'anchor' ? 'move' : 'crosshair')
              svgRef.current?.setPointerCapture(event.pointerId)
            }}
          />
        ) : (tool === 'select' || tool === 'transform') && selectedElements.length > 0 ? (
          <>
            {selectedElements.filter((element) => element.visible && !element.locked).map((element) => {
              const direct = tool === 'select' && selectedElements.length === 1
              return <Selection key={element.id} element={element} zoom={zoom} direct={direct} onResize={(handle, event) => {
                if (!direct || event.button !== 0) return
                event.stopPropagation()
                onGestureStart()
                interaction.current = {
                  kind: 'resize',
                  pointerId: event.pointerId,
                  start: point(event.nativeEvent),
                  element: structuredClone(element),
                  handle,
                }
                setDirectCursor(resizeCursor(handle, element.rotation))
                svgRef.current?.setPointerCapture(event.pointerId)
              }} onRotate={(_corner, event) => {
                if (!direct || event.button !== 0) return
                event.stopPropagation()
                onGestureStart()
                interaction.current = {
                  kind: 'rotate',
                  pointerId: event.pointerId,
                  start: point(event.nativeEvent),
                  element: structuredClone(element),
                }
                setTransformStatus({ mode: 'rotate', axis: null })
                setDirectCursor('var(--cursor-rotate)')
                svgRef.current?.setPointerCapture(event.pointerId)
              }} />
            })}
          </>
        ) : null}
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
      {viewOptions.rulers ? <CanvasRulers document={document} viewport={viewportSize} pan={pan} zoom={zoom} /> : null}
    </div>
  )
}

function VectorShape({ element, pixelPreview, selected, editing, onPointerDown, onDoubleClick }: {
  element: VectorElement
  pixelPreview: VectorPixelPreview
  selected: boolean
  editing: boolean
  onPointerDown: (event: ReactPointerEvent<SVGElement>) => void
  onDoubleClick: (event: ReactMouseEvent<SVGElement>) => void
}) {
  const rendered = previewGeometry(element, pixelPreview)
  const transform = `rotate(${rendered.rotation} ${rendered.x + rendered.width / 2} ${rendered.y + rendered.height / 2})`
  const common = {
    'data-vector-element': element.id,
    'data-selected': selected || undefined,
    fill: rendered.fill,
    stroke: rendered.stroke,
    strokeWidth: rendered.strokeWidth,
    opacity: rendered.opacity,
    transform,
    onPointerDown,
    onDoubleClick,
  }
  if (rendered.vectorNodes) return <path {...common} data-editing={editing || undefined} d={vectorPathData(rendered)} />
  return rendered.kind === 'ellipse' ? (
    <ellipse {...common} cx={rendered.x + rendered.width / 2} cy={rendered.y + rendered.height / 2} rx={rendered.width / 2} ry={rendered.height / 2} />
  ) : (
    <rect {...common} x={rendered.x} y={rendered.y} width={rendered.width} height={rendered.height} />
  )
}

function CanvasRulers({ document, viewport, pan, zoom }: {
  document: Pick<VectorDocument, 'width' | 'height'>
  viewport: { width: number; height: number }
  pan: Point
  zoom: number
}) {
  const origin = {
    x: viewport.width / 2 + pan.x - document.width * zoom / 2,
    y: viewport.height / 2 + pan.y - document.height * zoom / 2,
  }
  const step = rulerStep(zoom)
  const xTicks = rulerTicks(-origin.x / zoom, (viewport.width - origin.x) / zoom, step)
  const yTicks = rulerTicks(-origin.y / zoom, (viewport.height - origin.y) / zoom, step)
  return (
    <div className="vector-rulers" aria-hidden="true">
      <div className="vector-ruler vector-ruler--x">
        {xTicks.map((value) => <span key={value} className="vector-ruler__tick" style={{ left: origin.x + value * zoom }}><span>{formatRulerValue(value)}</span></span>)}
      </div>
      <div className="vector-ruler vector-ruler--y">
        {yTicks.map((value) => <span key={value} className="vector-ruler__tick" style={{ top: origin.y + value * zoom }}><span>{formatRulerValue(value)}</span></span>)}
      </div>
      <div className="vector-ruler__corner" />
    </div>
  )
}

function VectorNodes({ element, zoom, selectedIndices, onNodePointerDown }: {
  element: VectorElement
  zoom: number
  selectedIndices: number[]
  onNodePointerDown: (nodeIndex: number, part: 'anchor' | 'in' | 'out', event: ReactPointerEvent<SVGCircleElement>) => void
}) {
  const nodes = element.vectorNodes ?? defaultVectorNodes(element)
  const cx = element.x + element.width / 2
  const cy = element.y + element.height / 2
  const hitRadius = 5 / zoom
  const pointRadius = 3.5 / zoom
  const controlRadius = 3 / zoom
  const activeIndex = selectedIndices.at(-1) ?? null
  const active = activeIndex === null ? null : nodes[activeIndex] ?? null
  const activeAnchor = active ? nodePosition(element, active) : null
  return (
    <g className="vector-nodes" transform={`rotate(${element.rotation} ${cx} ${cy})`}>
      <path className="vector-nodes__outline" d={vectorPathData(element, nodes)} />
      {active && activeAnchor ? (['in', 'out'] as const).map((part) => {
        if (!active[part]) return null
        const handle = nodePosition(element, active, part)
        return <g key={part}>
          <line className="vector-nodes__control-line" x1={activeAnchor.x} y1={activeAnchor.y} x2={handle.x} y2={handle.y} />
          <circle className="vector-nodes__control-hit" data-vector-control={part} cx={handle.x} cy={handle.y} r={hitRadius} onPointerDown={(event) => onNodePointerDown(activeIndex!, part, event)} />
          <circle className="vector-nodes__control" cx={handle.x} cy={handle.y} r={controlRadius} />
        </g>
      }) : null}
      {nodes.map((node, index) => {
        const position = nodePosition(element, node)
        return <g key={index}>
          <circle className="vector-nodes__hit" data-vector-node={index} cx={position.x} cy={position.y} r={hitRadius} onPointerDown={(event) => onNodePointerDown(index, 'anchor', event)} />
          <rect className="vector-nodes__point" data-selected={selectedIndices.includes(index) || undefined} x={position.x - pointRadius} y={position.y - pointRadius} width={pointRadius * 2} height={pointRadius * 2} rx={0.75 / zoom} />
        </g>
      })}
    </g>
  )
}

function AxisGuide({ element, axis }: { element: VectorElement; axis: Exclude<VectorTransformAxis, null> }) {
  const cx = element.x + element.width / 2
  const cy = element.y + element.height / 2
  return axis === 'x'
    ? <line className="vector-axis-guide" x1={-100000} x2={100000} y1={cy} y2={cy} />
    : <line className="vector-axis-guide" x1={cx} x2={cx} y1={-100000} y2={100000} />
}

function Selection({ element, zoom, direct, onResize, onRotate }: {
  element: VectorElement
  zoom: number
  direct: boolean
  onResize: (handle: DirectResizeHandle, event: ReactPointerEvent<SVGCircleElement>) => void
  onRotate: (corner: Corner, event: ReactPointerEvent<SVGCircleElement>) => void
}) {
  const cx = element.x + element.width / 2
  const cy = element.y + element.height / 2
  const points: { handle: DirectResizeHandle; x: number; y: number; corner?: Corner }[] = [
    { handle: 'nw', corner: 'nw', x: element.x, y: element.y },
    { handle: 'n', x: cx, y: element.y },
    { handle: 'ne', corner: 'ne', x: element.x + element.width, y: element.y },
    { handle: 'e', x: element.x + element.width, y: cy },
    { handle: 'se', corner: 'se', x: element.x + element.width, y: element.y + element.height },
    { handle: 's', x: cx, y: element.y + element.height },
    { handle: 'sw', corner: 'sw', x: element.x, y: element.y + element.height },
    { handle: 'w', x: element.x, y: cy },
  ]
  const visiblePoints = points.filter((point) => {
    if (point.handle === 'n' || point.handle === 's') return element.width * zoom >= 40
    if (point.handle === 'e' || point.handle === 'w') return element.height * zoom >= 40
    return true
  })
  const resizeHitRadius = 16 / zoom
  const handleRadius = 4 / zoom
  return (
    <g className="vector-selection" transform={`rotate(${element.rotation} ${cx} ${cy})`}>
      <rect x={element.x} y={element.y} width={element.width} height={element.height} />
      {direct ? visiblePoints.map((item) => (
        <g key={item.handle}>
          {item.corner ? <circle
            className="vector-selection__rotate-hit"
            data-vector-rotate={item.corner}
            cx={item.x}
            cy={item.y}
            r={27 / zoom}
            onPointerDown={(event) => onRotate(item.corner!, event)}
          /> : null}
          <circle
            className="vector-selection__resize-hit"
            data-vector-handle={item.handle}
            cx={item.x}
            cy={item.y}
            r={resizeHitRadius}
            style={{ cursor: resizeCursor(item.handle, element.rotation) }}
            onPointerDown={(event) => onResize(item.handle, event)}
          />
          <rect className="vector-selection__handle" x={item.x - handleRadius} y={item.y - handleRadius} width={handleRadius * 2} height={handleRadius * 2} rx={1 / zoom} />
        </g>
      )) : null}
    </g>
  )
}

function boundsBetween(start: Point, end: Point, square: boolean): Bounds {
  let width = Math.abs(end.x - start.x)
  let height = Math.abs(end.y - start.y)
  if (square) width = height = Math.max(width, height)
  return {
    x: round(end.x >= start.x ? start.x : start.x - width),
    y: round(end.y >= start.y ? start.y : start.y - height),
    width: round(width),
    height: round(height),
  }
}

function selectionBounds(elements: VectorElement[]): Bounds {
  const points = elements.flatMap((element) => {
    const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
    return [
      { x: element.x, y: element.y },
      { x: element.x + element.width, y: element.y },
      { x: element.x + element.width, y: element.y + element.height },
      { x: element.x, y: element.y + element.height },
    ].map((corner) => rotatePoint(corner, center, element.rotation))
  })
  const left = Math.min(...points.map((value) => value.x))
  const top = Math.min(...points.map((value) => value.y))
  const right = Math.max(...points.map((value) => value.x))
  const bottom = Math.max(...points.map((value) => value.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
}

function rulerStep(zoom: number): number {
  const target = 72 / zoom
  const power = 10 ** Math.floor(Math.log10(target))
  const normalized = target / power
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power
}

function rulerTicks(start: number, end: number, step: number): number[] {
  const first = Math.floor(start / step) * step
  const count = Math.min(200, Math.ceil((end - first) / step) + 1)
  return Array.from({ length: Math.max(0, count) }, (_, index) => round(first + index * step))
}

function formatRulerValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round(value))
}

function snapBounds(bounds: Bounds): Bounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  }
}

function snapGeometryPatch<Patch extends Partial<VectorElement>>(patch: Patch): Patch {
  const next = { ...patch }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = next[key]
    if (typeof value !== 'number') continue
    Object.assign(next, { [key]: key === 'width' || key === 'height' ? Math.max(1, Math.round(value)) : Math.round(value) })
  }
  return next
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
