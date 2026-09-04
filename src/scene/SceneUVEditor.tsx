import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { activeUv, activeUvIndex, uvMapsOf, withActiveUv } from '@/scene/mesh/uv'
import { meshOf, objectById, withMesh } from '@/scene/document'
import { EditMesh } from '@/scene/mesh/editMesh'
import { fromElements, propagateUp, toElements } from '@/scene/mesh/selection'
import { SceneMenu, type SceneMenuEntry } from '@/scene/SceneMenu'
import { drawUv, UV_COLOURS, type UvBackground, type UvColours } from '@/scene/uv/draw'
import { uvGeometry, type UvGeometry } from '@/scene/uv/geometry'
import {
  applyPick,
  faceAt,
  loopsOfFace,
  loopsOfIsland,
  loopsOfPoints,
  nearestEdge,
  nearestPoint,
  pointsInBox,
  selectedPoints,
  uvIslands,
  NOTHING,
  type UvPickMode,
  type UvSelectMode,
} from '@/scene/uv/select'
import { faceStretch } from '@/scene/uv/stretch'
import { applyUvResults, uvMedian, uvTargets, uvViewBasis, UV_UNITS } from '@/scene/uv/transform'
import {
  beginTransform,
  cancelTransform,
  confirmTransform,
  transformChanged,
  transformOutput,
  updateTransform,
  type TransformMode,
  type TransformSession,
} from '@/scene/transform/session'
import {
  fitUvView,
  IMAGE_BOUNDS,
  panView,
  screenToUv,
  UV_ZOOM_STEP,
  zoomAround,
  type UvView,
} from '@/scene/uv/view'
import type { ElementIds, MeshData, SceneDocument, SceneSelection, UvEditorState } from '@/scene/types'
import { loadResource } from '@/state/resources'
import { IconButton } from '@/ui/Button'
import { IconClose, IconFrame, IconMinus, IconPlus } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'

/**
 * The UV editor: the second space, where the image is and where the map over it is read and moved.
 *
 * Blender puts unwrapping in one editor and the map in another, and the division is a real one. The
 * viewport answers "where is this surface", and this answers "where on the image is it drawn" —
 * two questions with two sets of coordinates, which is why they are two canvases rather than one
 * with a mode. Everything here is in the unit square: `v` points up, the image is one across, and
 * `src/scene/uv/view.ts` is the whole of the arithmetic between that and the pixels on screen.
 *
 * The mesh is shown while it is open for editing, as Blender does, and — with UV sync selection off,
 * which is Blender's default — only the faces that are selected in the viewport. A map belongs to
 * the corners of faces, and choosing which faces to look at in the viewport is how a person says
 * which part of the map they mean.
 *
 * G, R and S are the viewport's own session (`transform/session.ts`) handed a camera that looks
 * straight at the plane. Nothing about moving UVs is written twice.
 */

/** A point's radius in pixels; a finger asks for a larger one, as everything else here does. */
const POINT_RADIUS = 2.5
const COARSE_POINT_RADIUS = 3.5

/** How near a click has to land, in pixels. Blender's own tolerance, near enough. */
const PICK_RADIUS_PX = 14
const COARSE_PICK_RADIUS_PX = 22

/** Below this a press and its release are a click rather than a box. */
const DRAG_THRESHOLD_PX = 4

/** The custom properties the canvas takes its colours from, and the fallback for each. */
const COLOUR_ROLES: Array<[keyof UvColours, string]> = [
  ['ground', '--scene-uv-ground'],
  ['image', '--scene-uv-image'],
  ['checkerLight', '--scene-uv-checker-light'],
  ['checkerDark', '--scene-uv-checker-dark'],
  ['grid', '--scene-uv-grid'],
  ['gridMajor', '--scene-uv-border'],
  ['edge', '--scene-uv-edge'],
  ['edgeSelected', '--scene-uv-edge-selected'],
  ['point', '--scene-uv-point'],
  ['pointSelected', '--scene-uv-point-selected'],
  ['halo', '--scene-uv-halo'],
  ['face', '--scene-uv-face'],
  ['stretchLow', '--scene-uv-stretch-low'],
  ['stretchMid', '--scene-uv-stretch-mid'],
  ['stretchHigh', '--scene-uv-stretch-high'],
]

const SELECT_MODES: Array<{ value: UvSelectMode; label: string; key: string }> = [
  { value: 'vertex', label: 'Vertex', key: '1' },
  { value: 'edge', label: 'Edge', key: '2' },
  { value: 'face', label: 'Face', key: '3' },
  { value: 'island', label: 'Island', key: '4' },
]

/** Which key opens which session, in the letters Blender uses. */
const TRANSFORM_KEYS: Record<string, TransformMode> = { g: 'move', r: 'rotate', s: 'scale' }

/**
 * What the history calls a gesture here.
 *
 * The session's own label counts its targets and calls them objects — "Move 4 objects" — which is
 * true in the viewport and wrong in the image: what moved is a corner of a map, and a person
 * reading their history wants to know which map moved rather than how many points it had.
 */
function sessionLabel(mode: TransformMode): string {
  return mode === 'move' ? 'Move UV' : mode === 'rotate' ? 'Rotate UV' : mode === 'scale' ? 'Scale UV' : 'Transform UV'
}

export function SceneUVEditor({
  document: scene,
  selection,
  uv,
  onUv,
  onClose,
  onSelection,
  onEditDocument,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: {
  document: SceneDocument
  selection: SceneSelection
  uv: UvEditorState
  onUv: (patch: Partial<UvEditorState>) => void
  onClose: () => void
  onSelection: (next: SceneSelection) => void
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string, record: boolean) => void
  onGestureStart: (label: string) => void
  onGestureEnd: (label: string) => void
  onGestureCancel: () => void
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const frame = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<UvView | null>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [marquee, setMarquee] = useState<{ from: [number, number]; to: [number, number]; mode: UvPickMode } | null>(null)
  const [session, setSession] = useState<TransformSession | null>(null)
  /*
   * The running session, kept beside the state that draws it.
   *
   * A pointer move has to read the session, work out the next one and write the document — and a
   * state updater is not the place for that: React runs an updater during the render, and a render
   * that writes to its parent is the "cannot update a component while rendering another" warning
   * and a real bug behind it. So the ref is what the handlers read, and the state is what draws.
   */
  const running = useRef<TransformSession | null>(null)
  /** Whether this session actually holds the pointer; a browser may refuse the lock. */
  const locked = useRef(false)
  const panning = useRef<{ pointerId: number; last: [number, number] } | null>(null)
  const pressed = useRef<{ pointerId: number; at: [number, number]; mode: UvPickMode } | null>(null)
  /* The map and the geometry as they were when a session opened: every frame of it is measured
   * from there, so a cancelled gesture puts back exactly what it found. */
  const before = useRef<{ data: number[]; geometry: UvGeometry; cursor: [number, number] } | null>(null)
  /*
   * Where the session feels the pointer to be. Under pointer lock the real pointer stops moving, so
   * the drawn one is carried along by the movement deltas — which is what lets a drag run past the
   * edge of a narrow editor without the gesture stopping at the frame.
   */
  const virtual = useRef<[number, number]>([0, 0])

  const object = selection.activeObjectId ? objectById(scene, selection.activeObjectId) : null
  const objectId = object?.id ?? ''
  const meshId = object?.data.kind === 'mesh' ? object.data.meshId : ''
  const mesh = object ? meshOf(scene, object) : null
  const editing = scene.view.mode === 'edit'
  const map = mesh ? uvMapsOf(mesh)[activeUvIndex(mesh)] ?? null : null
  const data = mesh && editing ? activeUv(mesh) : null

  /*
   * With sync off — Blender's default — the editor shows the faces the viewport has selected, and
   * nothing else. It is not a filter for tidiness: it is how a person says which part of a map they
   * are working on, and it is what keeps a character's whole layout out of the way while one hand
   * is being unwrapped.
   */
  const shownFaces = useMemo(() => (
    uv.sync || !mesh ? undefined : facesOf(mesh, selection, objectId)
  ), [uv.sync, mesh, selection, objectId])

  const geometry = useMemo(
    () => (mesh && data ? uvGeometry(mesh, data, shownFaces ? { faces: shownFaces } : {}) : null),
    [mesh, data, shownFaces],
  )
  const islands = useMemo(() => (geometry ? uvIslands(geometry) : null), [geometry])
  /*
   * With sync on there is one selection, not two: what is selected in the mesh is what is selected
   * here, and a pick here writes the mesh's own. That is Blender's rule and the reason the option
   * exists — two selections of the same surface that disagree is the thing it is there to prevent.
   */
  const selected = useMemo(() => (
    uv.sync && mesh ? syncedLoops(mesh, selection, objectId) : new Set(selection.uv?.[objectId] ?? [])
  ), [uv.sync, mesh, selection, objectId])
  const marks = useMemo(() => (geometry ? selectedPoints(geometry, selected) : null), [geometry, selected])

  const stretch = useMemo(() => {
    if (!mesh || !data || uv.stretch === 'none') return null
    return faceStretch(mesh, data, uv.stretch)
  }, [mesh, data, uv.stretch])

  const image = useTextureImage(textureOf(scene, object?.id ?? null, selection.activeMaterialSlot ?? 0))
  const colours = useCanvasColours(frame)
  const coarse = useCoarsePointer()
  const pickRadius = coarse ? COARSE_PICK_RADIUS_PX : PICK_RADIUS_PX

  /* The canvas is sized by its box rather than by the window: a splitter drag resizes it too. */
  useEffect(() => {
    const element = frame.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const box = element.getBoundingClientRect()
      setSize({ width: Math.round(box.width), height: Math.round(box.height) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /*
   * The first view frames the image, once there is a canvas to frame it in. It is deliberately not
   * refitted afterwards: a person who has zoomed into a corner of the map and then moves a splitter
   * has not asked to be taken back out again.
   */
  useEffect(() => {
    if (view !== null || size.width === 0 || size.height === 0) return
    setView(fitUvView(IMAGE_BOUNDS, size))
  }, [view, size])

  const fit = useCallback(() => {
    if (size.width === 0) return
    setView(fitUvView(geometry?.bounds ?? IMAGE_BOUNDS, size))
  }, [geometry, size])

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context || !view || size.width === 0) return
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    canvas.current!.width = Math.round(size.width * ratio)
    canvas.current!.height = Math.round(size.height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawUv(context, {
      view,
      size,
      colours,
      background: uv.background,
      image,
      grid: uv.grid,
      stretch,
      geometry,
      selected: marks,
      pointRadius: coarse ? COARSE_POINT_RADIUS : POINT_RADIUS,
    })
  }, [view, size, colours, uv.background, uv.grid, image, stretch, geometry, marks, coarse])

  /*
   * The wheel is bound by hand because React's is passive: a passive listener cannot call
   * `preventDefault`, and without it the page scrolls out from under a person zooming.
   */
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const box = element.getBoundingClientRect()
      const anchor: [number, number] = [event.clientX - box.left, event.clientY - box.top]
      const factor = event.deltaY < 0 ? UV_ZOOM_STEP : 1 / UV_ZOOM_STEP
      setView((current) => (current ? zoomAround(current, factor, anchor) : current))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (factor: number): void => {
    setView((current) => (current ? zoomAround(current, factor, [size.width / 2, size.height / 2]) : current))
  }

  /* ------------------------------------------------------------- selecting */

  const setSelected = useCallback((loops: Iterable<number>): void => {
    const kept = [...loops].sort((a, b) => a - b)
    if (uv.sync && mesh) {
      onSelection({ ...selection, elements: { ...(selection.elements ?? {}), [objectId]: elementsOfLoops(mesh, kept) } })
      return
    }
    onSelection({ ...selection, uv: { ...(selection.uv ?? {}), [objectId]: kept } })
  }, [onSelection, selection, objectId, uv.sync, mesh])

  const pick = useCallback((at: [number, number], mode: UvPickMode): void => {
    if (!geometry || !view) return
    const place = screenToUv(view, at)
    const radius = pickRadius / view.zoom
    const loops = pickLoops(geometry, islands, place, uv.selectMode, radius)
    setSelected(applyPick(selected, loops, mode))
  }, [geometry, view, islands, uv.selectMode, pickRadius, selected, setSelected])

  const box = useCallback((from: [number, number], to: [number, number], mode: UvPickMode): void => {
    if (!geometry || !view) return
    const a = screenToUv(view, from)
    const b = screenToUv(view, to)
    const found = pointsInBox(geometry, {
      minU: Math.min(a[0], b[0]),
      maxU: Math.max(a[0], b[0]),
      minV: Math.min(a[1], b[1]),
      maxV: Math.max(a[1], b[1]),
    })
    setSelected(applyPick(selected, loopsOfPoints(geometry, found), mode))
  }, [geometry, view, selected, setSelected])

  const selectAll = useCallback((all: boolean): void => {
    if (!geometry) return
    if (!all) {
      setSelected([])
      return
    }
    const loops: number[] = []
    for (let face = 0; face < geometry.faceStart.length; face += 1) loops.push(...loopsOfFace(geometry, face))
    setSelected(loops)
  }, [geometry, setSelected])

  /* ------------------------------------------------------------ transforming */

  const startSession = useCallback((mode: TransformMode): void => {
    if (!geometry || !view || !data || !meshId || selected.size === 0) return
    const points = [...new Set([...selected].map((loop) => geometry.loopPoint[loop] ?? -1))].filter((point) => point >= 0)
    if (points.length === 0) return
    const at = cursor ?? [size.width / 2, size.height / 2]
    before.current = { data: data.slice(), geometry, cursor: at }
    virtual.current = [at[0], at[1]]
    locked.current = false
    // A session that cannot lock the pointer is still a session; it simply stops at the frame. The
    // request is a promise in a modern browser and an unhandled rejection is a console error, so a
    // refusal is caught rather than left to be reported as a fault of the editor's.
    if (frame.current && typeof frame.current.requestPointerLock === 'function') {
      try {
        const request = frame.current.requestPointerLock() as unknown
        if (request && typeof (request as Promise<void>).catch === 'function') (request as Promise<void>).catch(() => undefined)
      } catch {
        /* Refused: the gesture runs without the lock. */
      }
    }
    onGestureStart(sessionLabel(mode))
    const opened = beginTransform({
      mode,
      targets: uvTargets(geometry, points),
      pivot: 'median',
      orientation: 'global',
      view: uvViewBasis(view, uvMedian(geometry, points)),
      pointer: at,
      units: UV_UNITS,
    })
    running.current = opened
    setSession(opened)
  }, [geometry, view, data, meshId, selected, cursor, size, onGestureStart])

  const writeSession = useCallback((next: TransformSession): void => {
    const start = before.current
    if (!start || !meshId) return
    const written = applyUvResults(start.data, start.geometry, confirmTransform(next))
    onEditDocument((current) => {
      const found = current.meshes[meshId]
      return found ? withMesh(current, meshId, withActiveUv(found, written)) : current
    }, sessionLabel(next.mode), false)
  }, [meshId, onEditDocument])

  const endSession = useCallback((keep: boolean): void => {
    const ending = running.current
    const start = before.current
    running.current = null
    before.current = null
    setSession(null)
    if (locked.current && typeof globalThis.document?.exitPointerLock === 'function') globalThis.document.exitPointerLock()
    locked.current = false
    if (!ending || !start) return
    if (!keep || !transformChanged(ending)) {
      if (meshId) {
        onEditDocument((current) => {
          const found = current.meshes[meshId]
          return found ? withMesh(current, meshId, withActiveUv(found, applyUvResults(start.data, start.geometry, cancelTransform(ending)))) : current
        }, 'Cancel', false)
      }
      onGestureCancel()
      return
    }
    onGestureEnd(sessionLabel(ending.mode))
  }, [meshId, onEditDocument, onGestureCancel, onGestureEnd])

  const stepSession = useCallback((at: [number, number], modifiers: { shift: boolean; ctrl: boolean; alt: boolean }, key?: string): void => {
    const current = running.current
    if (!current) return
    const next = updateTransform(current, { cursor: at, modifiers, ...(key ? { key } : {}) })
    running.current = next
    setSession(next)
    writeSession(next)
  }, [writeSession])

  /*
   * Escape is the browser's way out of a pointer lock and it keeps the key to itself, so the lock
   * going away is how Escape reaches a running session. Losing a lock that was actually held is
   * therefore a cancel; never having had one is not.
   */
  useEffect(() => {
    if (!session || typeof globalThis.document === 'undefined') return
    const onChange = (): void => {
      if (globalThis.document.pointerLockElement === frame.current) {
        locked.current = true
        return
      }
      if (!locked.current) return
      locked.current = false
      endSession(false)
    }
    globalThis.document.addEventListener('pointerlockchange', onChange)
    return () => globalThis.document.removeEventListener('pointerlockchange', onChange)
  }, [session, endSession])

  /* ------------------------------------------------------------------ keys */

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const consume = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    if (session) {
      if (key === 'Escape') {
        endSession(false)
        consume()
        return
      }
      if (key === 'Enter') {
        endSession(true)
        consume()
        return
      }
      // X and Y are the image's own axes; a digit, a point or a minus is a number being typed.
      if (/^[xy0-9.-]$/.test(key) || key === 'Backspace') {
        stepSession(virtual.current, { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey }, key)
        consume()
      }
      return
    }
    const mode = TRANSFORM_KEYS[key]
    if (mode) {
      startSession(mode)
      consume()
      return
    }
    if (key === 'a' && !event.altKey) {
      selectAll(true)
      consume()
      return
    }
    if (key === 'a' && event.altKey) {
      selectAll(false)
      consume()
      return
    }
    const chosen = SELECT_MODES.find((entry) => entry.key === key)
    if (chosen) {
      onUv({ selectMode: chosen.value })
      consume()
    }
  }

  /* -------------------------------------------------------------- pointers */

  const localPoint = (event: ReactPointerEvent<HTMLDivElement>): [number, number] => {
    const box2 = event.currentTarget.getBoundingClientRect()
    return [event.clientX - box2.left, event.clientY - box2.top]
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    frame.current?.focus()
    if (session) {
      // A click confirms a running session and a right-click cancels it, as in the viewport.
      endSession(event.button === 0)
      event.preventDefault()
      return
    }
    if (event.button === 1) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      panning.current = { pointerId: event.pointerId, last: [event.clientX, event.clientY] }
      return
    }
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pressed.current = {
      pointerId: event.pointerId,
      at: localPoint(event),
      mode: event.shiftKey ? 'extend' : event.ctrlKey || event.metaKey ? 'toggle' : 'new',
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (session) {
      const at: [number, number] = locked.current
        ? [virtual.current[0] + event.movementX, virtual.current[1] + event.movementY]
        : localPoint(event)
      virtual.current = at
      setCursor(at)
      stepSession(at, { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey })
      return
    }
    const at = localPoint(event)
    setCursor(at)
    const drag = panning.current
    if (drag && drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.last[0]
      const dy = event.clientY - drag.last[1]
      drag.last = [event.clientX, event.clientY]
      setView((current) => (current ? panView(current, dx, dy) : current))
      return
    }
    const press = pressed.current
    if (!press || press.pointerId !== event.pointerId) return
    if (marquee || Math.hypot(at[0] - press.at[0], at[1] - press.at[1]) > DRAG_THRESHOLD_PX) {
      setMarquee({ from: press.at, to: at, mode: press.mode })
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (panning.current?.pointerId === event.pointerId) {
      panning.current = null
      return
    }
    const press = pressed.current
    pressed.current = null
    if (!press || press.pointerId !== event.pointerId) return
    const at = localPoint(event)
    if (marquee) {
      box(marquee.from, at, marquee.mode)
      setMarquee(null)
      return
    }
    pick(at, press.mode)
  }

  const points = geometry ? geometry.points.length / 2 : 0
  // Points rather than corners: the reader is being told about what is drawn, and what is drawn is
  // points — a corner nobody can see is not a thing to count out loud.
  const chosen = marks ? marks.reduce((total, mark) => total + mark, 0) : 0
  const reading = view && cursor ? screenToUv(view, cursor) : null
  const output = session ? transformOutput(session) : null

  return (
    <section className="scene-uv" aria-label="UV editor">
      <div className="scene-uv__header">
        <span className="scene-uv__title">UV</span>
        <div className="scene-uv__group" role="group" aria-label="Selection mode">
          {SELECT_MODES.map((entry) => (
            <Tooltip key={entry.value} content={`${entry.label} · ${entry.key}`}>
              <IconButton
                label={entry.label}
                className="scene-header__button scene-uv__mode"
                aria-pressed={uv.selectMode === entry.value}
                onClick={() => onUv({ selectMode: entry.value })}
              >
                <span aria-hidden="true">{entry.label.charAt(0)}</span>
              </IconButton>
            </Tooltip>
          ))}
        </div>
        <SceneMenu label="Display" entries={displayEntries(uv, onUv)} />
        <div className="scene-uv__spacer" />
        <div className="scene-uv__group" role="group" aria-label="Zoom">
          <Tooltip content="Zoom out">
            <IconButton label="Zoom out" className="scene-header__button" onClick={() => zoomBy(1 / UV_ZOOM_STEP)}>
              <IconMinus />
            </IconButton>
          </Tooltip>
          <Tooltip content="Zoom in">
            <IconButton label="Zoom in" className="scene-header__button" onClick={() => zoomBy(UV_ZOOM_STEP)}>
              <IconPlus />
            </IconButton>
          </Tooltip>
          <Tooltip content={geometry ? 'Frame the map' : 'Frame the image'}>
            <IconButton label="Frame the map" className="scene-header__button" onClick={fit}>
              <IconFrame />
            </IconButton>
          </Tooltip>
        </div>
        <Tooltip content="Close the UV editor">
          <IconButton label="Close the UV editor" className="scene-header__button" onClick={onClose}>
            <IconClose />
          </IconButton>
        </Tooltip>
      </div>
      <div
        ref={frame}
        className="scene-uv__frame"
        tabIndex={0}
        role="application"
        aria-label="UV map"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onPointerCancel={() => { panning.current = null; pressed.current = null; setMarquee(null) }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <canvas ref={canvas} className="scene-uv__canvas" role="img" aria-label={canvasLabel(map?.name ?? null, points, chosen, editing)} />
        {marquee ? (
          <svg className="scene-marquee" aria-hidden="true">
            <rect
              className="scene-marquee__shape"
              x={Math.min(marquee.from[0], marquee.to[0])}
              y={Math.min(marquee.from[1], marquee.to[1])}
              width={Math.abs(marquee.to[0] - marquee.from[0])}
              height={Math.abs(marquee.to[1] - marquee.from[1])}
            />
          </svg>
        ) : null}
        {output && cursor ? (
          <span className="scene-uv__hud" style={{ left: `${cursor[0] + 16}px`, top: `${cursor[1] + 16}px` }}>{output.hud}</span>
        ) : null}
        {geometry && (geometry.faceStart.length > 0 || !editing) ? null : (
          <p className="scene-uv__notice">{notice(mesh, editing, geometry, uv.sync)}</p>
        )}
      </div>
      <div className="scene-uv__status">
        {output ? <span className="scene-uv__running">{output.header}</span> : (
          <>
            <span className="scene-uv__map">{map ? map.name : 'No UV map'}</span>
            <span>{geometry ? `${chosen} of ${points} points` : ''}</span>
          </>
        )}
        <span className="scene-uv__spacer" />
        {reading ? <span>{reading[0].toFixed(3)}, {reading[1].toFixed(3)}</span> : null}
        <span>{view ? `${Math.round(view.zoom)} px` : ''}</span>
      </div>
    </section>
  )
}

/** What a click lands on, in the mode the editor is in. */
function pickLoops(
  geometry: UvGeometry,
  islands: Int32Array | null,
  at: [number, number],
  mode: UvSelectMode,
  radius: number,
): number[] {
  if (mode === 'vertex') {
    const point = nearestPoint(geometry, at, radius)
    return point === NOTHING ? [] : loopsOfPoints(geometry, [point])
  }
  if (mode === 'edge') {
    const edge = nearestEdge(geometry, at, radius)
    if (edge === NOTHING) return []
    return loopsOfPoints(geometry, [geometry.edges[edge * 2] ?? 0, geometry.edges[edge * 2 + 1] ?? 0])
  }
  const face = faceAt(geometry, at)
  if (face === NOTHING) return []
  if (mode === 'face') return loopsOfFace(geometry, face)
  if (!islands) return loopsOfFace(geometry, face)
  const point = geometry.loopPoint[geometry.faceStart[face] ?? 0] ?? 0
  return loopsOfIsland(geometry, islands, islands[point] ?? 0)
}

/** The corners of every vertex the mesh has selected: the UV selection, with sync on. */
function syncedLoops(mesh: MeshData, selection: SceneSelection, objectId: string): Set<number> {
  const vertices = toElements(selection, objectId).vertices
  const loops = new Set<number>()
  let loop = 0
  for (const face of mesh.faces) {
    for (const slot of face) {
      if (vertices.has(mesh.vertexIds[slot] ?? -1)) loops.add(loop)
      loop += 1
    }
  }
  return loops
}

/**
 * The mesh selection a UV selection means, with sync on.
 *
 * The vertices are what a corner names directly; the edges and faces follow from them by the rule
 * the rest of the editor already uses — an edge is selected when both its ends are — so the mesh's
 * three levels stay consistent with one another and with what the UV editor shows.
 */
function elementsOfLoops(mesh: MeshData, loops: number[]): ElementIds {
  const wanted = new Set(loops)
  const vertices = new Set<number>()
  let loop = 0
  for (const face of mesh.faces) {
    for (const slot of face) {
      if (wanted.has(loop)) vertices.add(mesh.vertexIds[slot] ?? -1)
      loop += 1
    }
  }
  return fromElements(propagateUp(EditMesh.from(mesh), { vertices, edges: new Set(), faces: new Set() }))
}

/** The faces the viewport has selected, as slots, which is what the geometry is built from. */
function facesOf(mesh: MeshData, selection: SceneSelection, objectId: string): Set<number> {
  const ids = toElements(selection, objectId).faces
  const slots = new Set<number>()
  for (let slot = 0; slot < mesh.faceIds.length; slot += 1) {
    if (ids.has(mesh.faceIds[slot]!)) slots.add(slot)
  }
  return slots
}

/** What a screen reader is told the picture is, since a canvas says nothing on its own. */
function canvasLabel(name: string | null, points: number, selected: number, editing: boolean): string {
  if (!editing) return 'The image, with no UV map shown: the mesh is not open for editing.'
  if (!name) return 'The image, with no UV map on this mesh.'
  return `UV map ${name}, ${points} points, ${selected} selected.`
}

/** Why there is nothing to look at, in the terms of whatever is missing. */
function notice(mesh: MeshData | null, editing: boolean, geometry: UvGeometry | null, sync: boolean): string {
  if (!mesh) return 'Pick a mesh to see the image its material is painted with.'
  if (!editing) return 'Open the mesh for editing with Tab to see its UV map.'
  if (!geometry) return 'This mesh has no UV map yet. Unwrap it with U.'
  return sync
    ? 'This mesh has no faces.'
    : 'Select faces in the viewport to see their UVs, or turn on UV sync selection to see the whole map.'
}

function displayEntries(uv: UvEditorState, onUv: (patch: Partial<UvEditorState>) => void): SceneMenuEntry[] {
  const background = (value: UvBackground, label: string): SceneMenuEntry => ({
    id: `background-${value}`,
    label,
    checked: uv.background === value,
    choice: 'radio',
    run: () => onUv({ background: value }),
  })
  const stretch = (value: UvEditorState['stretch'], label: string): SceneMenuEntry => ({
    id: `stretch-${value}`,
    label,
    checked: uv.stretch === value,
    choice: 'radio',
    run: () => onUv({ stretch: value }),
  })
  return [
    { id: 'sync', label: 'UV sync selection', checked: uv.sync, choice: 'check', run: () => onUv({ sync: !uv.sync }) },
    { separator: true },
    { heading: 'Background' },
    background('texture', 'Material texture'),
    background('checker', 'Checker'),
    background('none', 'Plain'),
    { separator: true },
    { id: 'grid', label: 'Grid', checked: uv.grid, choice: 'check', run: () => onUv({ grid: !uv.grid }) },
    { separator: true },
    { heading: 'Stretch' },
    stretch('none', 'Off'),
    stretch('angle', 'Angle'),
    stretch('area', 'Area'),
  ]
}

/** The base-colour image of the material in the object's active slot, when there is one. */
function textureOf(scene: SceneDocument, objectId: string | null, slot: number): string | null {
  const object = objectId ? objectById(scene, objectId) : null
  const materialId = object?.materialSlots[slot] ?? object?.materialSlots[0]
  if (!materialId) return null
  const material = scene.materials.find((entry) => entry.id === materialId)
  return material?.textures?.baseColor?.resourceId ?? null
}

/**
 * The decoded image behind a resource id.
 *
 * A bitmap holds memory outside the heap, so it is closed when it is replaced or when the editor
 * goes away; a component that leaked one per texture change would leak a texture's worth of memory
 * every time somebody tried a different image.
 */
function useTextureImage(resourceId: string | null): ImageBitmap | null {
  const [image, setImage] = useState<ImageBitmap | null>(null)
  useEffect(() => {
    if (!resourceId || typeof createImageBitmap !== 'function') {
      setImage(null)
      return
    }
    let live = true
    let made: ImageBitmap | null = null
    void loadResource(resourceId)
      .then(async (blob) => {
        if (!blob || !live) return
        made = await createImageBitmap(blob)
        if (!live) {
          made.close()
          return
        }
        setImage(made)
      })
      .catch(() => {
        /* A resource that cannot be read leaves the square plain rather than the editor broken. */
      })
    return () => {
      live = false
      made?.close()
      setImage(null)
    }
  }, [resourceId])
  return image
}

/**
 * The colours, read off the element rather than written into the module.
 *
 * A canvas cannot inherit a custom property, so every colour has to be resolved to a string before
 * it is drawn. Reading them from the editor's own element is what makes the two themes and the
 * theme override on the stage work here without a second table of colours to keep in step.
 */
function useCanvasColours(element: { current: HTMLElement | null }): UvColours {
  const [colours, setColours] = useState<UvColours>(UV_COLOURS)
  useEffect(() => {
    const node = element.current
    if (!node || typeof getComputedStyle !== 'function') return
    const read = (): void => {
      const style = getComputedStyle(node)
      const next = { ...UV_COLOURS }
      for (const [role, property] of COLOUR_ROLES) {
        const value = style.getPropertyValue(property).trim()
        if (value.length > 0) next[role] = value
      }
      setColours((current) => (sameColours(current, next) ? current : next))
    }
    read()
    /*
     * Two things change the answer without changing a prop: the platform's light or dark setting,
     * and the theme override the stage carries. Both are watched, because a canvas that kept the
     * colours it was born with would be the one part of the editor that ignored a theme change.
     */
    const scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
    scheme?.addEventListener?.('change', read)
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(read) : null
    const stage = node.closest('.scene-stage')
    if (stage) observer?.observe(stage, { attributes: true, attributeFilter: ['data-scene-theme'] })
    observer?.observe(node.ownerDocument.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      scheme?.removeEventListener?.('change', read)
      observer?.disconnect()
    }
  }, [element])
  return colours
}

function sameColours(a: UvColours, b: UvColours): boolean {
  return COLOUR_ROLES.every(([role]) => a[role] === b[role])
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const query = matchMedia('(pointer: coarse)')
    setCoarse(query.matches)
    const onChange = (): void => setCoarse(query.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])
  return coarse
}
