import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activeUv, activeUvIndex, uvMapsOf } from '@/scene/mesh/uv'
import { meshOf, objectById } from '@/scene/document'
import { SceneMenu, type SceneMenuEntry } from '@/scene/SceneMenu'
import { drawUv, UV_COLOURS, type UvBackground, type UvColours } from '@/scene/uv/draw'
import { uvGeometry } from '@/scene/uv/geometry'
import { faceStretch } from '@/scene/uv/stretch'
import {
  fitUvView,
  IMAGE_BOUNDS,
  panView,
  screenToUv,
  UV_ZOOM_STEP,
  zoomAround,
  type UvView,
} from '@/scene/uv/view'
import type { SceneDocument, SceneSelection, UvEditorState } from '@/scene/types'
import { loadResource } from '@/state/resources'
import { IconButton } from '@/ui/Button'
import { IconClose, IconFrame, IconMinus, IconPlus } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'

/**
 * The UV editor: the second space, where the image is and where the map over it is read.
 *
 * Blender puts unwrapping in one editor and the map in another, and the division is a real one. The
 * viewport answers "where is this surface", and this answers "where on the image is it drawn" —
 * two questions with two sets of coordinates, which is why they are two canvases rather than one
 * with a mode. Everything here is in the unit square: `v` points up, the image is one across, and
 * `src/scene/uv/view.ts` is the whole of the arithmetic between that and the pixels on screen.
 *
 * The mesh is shown while it is open for editing, as Blender does. A map belongs to the corners of
 * faces, and there is no selection of corners in object mode — so in object mode this shows the
 * image and says how to reach the map, rather than drawing something that cannot be touched.
 */

/** A point's radius in pixels; a finger asks for a larger one, as everything else here does. */
const POINT_RADIUS = 2.5
const COARSE_POINT_RADIUS = 3.5

/** The custom properties the canvas takes its colours from, and the fallback for each. */
const COLOUR_ROLES: Array<[keyof UvColours, string]> = [
  ['ground', '--scene-uv-ground'],
  ['image', '--scene-uv-image'],
  ['checkerLight', '--scene-uv-checker-light'],
  ['checkerDark', '--scene-uv-checker-dark'],
  ['grid', '--scene-uv-grid'],
  ['gridMajor', '--scene-uv-border'],
  ['edge', '--scene-uv-edge'],
  ['point', '--scene-uv-point'],
  ['halo', '--scene-uv-halo'],
  ['face', '--scene-uv-face'],
  ['stretchLow', '--scene-uv-stretch-low'],
  ['stretchMid', '--scene-uv-stretch-mid'],
  ['stretchHigh', '--scene-uv-stretch-high'],
]

export function SceneUVEditor({ document: scene, selection, uv, onUv, onClose }: {
  document: SceneDocument
  selection: SceneSelection
  uv: UvEditorState
  onUv: (patch: Partial<UvEditorState>) => void
  onClose: () => void
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const frame = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<UvView | null>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const panning = useRef<{ pointerId: number; last: [number, number] } | null>(null)

  const object = selection.activeObjectId ? objectById(scene, selection.activeObjectId) : null
  const mesh = object ? meshOf(scene, object) : null
  const editing = scene.view.mode === 'edit'
  const map = mesh ? uvMapsOf(mesh)[activeUvIndex(mesh)] ?? null : null
  const data = mesh && editing ? activeUv(mesh) : null

  const geometry = useMemo(() => (mesh && data ? uvGeometry(mesh, data) : null), [mesh, data])
  const stretch = useMemo(() => {
    if (!mesh || !data || uv.stretch === 'none') return null
    return faceStretch(mesh, data, uv.stretch)
  }, [mesh, data, uv.stretch])

  const image = useTextureImage(textureOf(scene, object?.id ?? null, selection.activeMaterialSlot ?? 0))
  const colours = useCanvasColours(frame)
  const coarse = useCoarsePointer()

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
      pointRadius: coarse ? COARSE_POINT_RADIUS : POINT_RADIUS,
    })
  }, [view, size, colours, uv.background, uv.grid, image, stretch, geometry, coarse])

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

  const points = geometry?.points.length ? geometry.points.length / 2 : 0
  const reading = view && cursor ? screenToUv(view, cursor) : null

  return (
    <section className="scene-uv" aria-label="UV editor">
      <div className="scene-uv__header">
        <span className="scene-uv__title">UV</span>
        <span className="scene-uv__map">{map ? map.name : 'No UV map'}</span>
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
        onPointerDown={(event) => {
          // The middle button pans here as it does in the viewport; the primary button is the
          // selection's, and stays free for it.
          if (event.button !== 1) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          panning.current = { pointerId: event.pointerId, last: [event.clientX, event.clientY] }
        }}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          setCursor([event.clientX - box.left, event.clientY - box.top])
          const drag = panning.current
          if (!drag || drag.pointerId !== event.pointerId) return
          const dx = event.clientX - drag.last[0]
          const dy = event.clientY - drag.last[1]
          drag.last = [event.clientX, event.clientY]
          setView((current) => (current ? panView(current, dx, dy) : current))
        }}
        onPointerUp={(event) => {
          if (panning.current?.pointerId !== event.pointerId) return
          panning.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerLeave={() => setCursor(null)}
        onPointerCancel={() => { panning.current = null }}
      >
        <canvas ref={canvas} className="scene-uv__canvas" role="img" aria-label={canvasLabel(map?.name ?? null, points, editing)} />
        {geometry ? null : (
          <p className="scene-uv__notice">
            {!mesh
              ? 'Pick a mesh to see the image its material is painted with.'
              : !editing
                ? 'Open the mesh for editing with Tab to see its UV map.'
                : 'This mesh has no UV map yet. Unwrap it with U.'}
          </p>
        )}
      </div>
      <div className="scene-uv__status">
        <span>{map ? map.name : '—'}</span>
        <span>{geometry ? `${points.toLocaleString()} points` : ''}</span>
        <span className="scene-uv__spacer" />
        {reading ? <span>{reading[0].toFixed(3)}, {reading[1].toFixed(3)}</span> : null}
        <span>{view ? `${Math.round(view.zoom)} px` : ''}</span>
      </div>
    </section>
  )
}

/** What a screen reader is told the picture is, since a canvas says nothing on its own. */
function canvasLabel(name: string | null, points: number, editing: boolean): string {
  if (!editing) return 'The image, with no UV map shown: the mesh is not open for editing.'
  if (!name) return 'The image, with no UV map on this mesh.'
  return `UV map ${name}, ${points} points.`
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
