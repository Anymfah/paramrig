import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { worldMatrix } from '@/scene/objects'
import type { LightData, SceneDocument, SceneObject, SceneSelection, Vec3 } from '@/scene/types'
import type { SceneViewport } from '@/scene/viewport/SceneViewport'

/**
 * The handle on a light's glyph: the rim of a spot's cone, the corner of an area's rectangle.
 *
 * A spot angle typed into a field is a number; dragged on the cone it is a shape, and the shape is
 * what a person is deciding. Blender puts a handle there for that reason, and so does this.
 *
 * It is drawn in the page rather than in the scene, as the camera frame is: an SVG circle is crisp
 * at any pixel ratio, it can be given a 32-pixel target without being 32 pixels of geometry, and it
 * cannot end up in a render. What the scene provides is the projection — where the rim of the cone
 * lands on screen — and the drag is then plain arithmetic on screen distances.
 *
 * The value follows the ratio of two distances rather than an angle: the pointer's distance from
 * the light's own centre, over what it was when the drag began. That makes a drag towards the
 * centre narrow the cone and away widen it, whatever direction it is dragged in, which is what the
 * hand expects from a radius.
 */

/** How far down its own axis a spot's cone is drawn, matching the glyph in `overlays.ts`. */
const CONE_DEPTH = 2

type Handle = {
  id: string
  label: string
  /** Where the handle sits, in viewport pixels. */
  at: [number, number]
  /** The light's own centre, in viewport pixels; the drag is measured from it. */
  centre: [number, number]
  apply: (ratio: number) => Partial<LightData>
}

export function SceneLightHandles({ document: scene, selection, viewport, onEditDocument, onGestureStart, onGestureEnd }: {
  document: SceneDocument
  selection: SceneSelection
  /** Read at render time for the projection; null before the viewport is up. */
  viewport: SceneViewport | null
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onGestureStart: () => void
  onGestureEnd: () => void
}) {
  const [dragging, setDragging] = useState<{ id: string; from: number } | null>(null)

  const active = scene.objects.find((object) => (
    object.id === selection.activeObjectId && object.data.kind === 'light' && object.visible
  ))
  const handles = active && viewport ? handlesFor(scene, active, viewport) : []
  if (handles.length === 0) return null

  const start = (handle: Handle) => (event: ReactPointerEvent<SVGCircleElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    const x = event.clientX - (box?.left ?? 0)
    const y = event.clientY - (box?.top ?? 0)
    setDragging({ id: handle.id, from: Math.max(1, Math.hypot(x - handle.centre[0], y - handle.centre[1])) })
    onGestureStart()
  }

  const move = (handle: Handle) => (event: ReactPointerEvent<SVGCircleElement>) => {
    if (dragging?.id !== handle.id) return
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    const x = event.clientX - (box?.left ?? 0)
    const y = event.clientY - (box?.top ?? 0)
    const now = Math.hypot(x - handle.centre[0], y - handle.centre[1])
    const patch = handle.apply(now / dragging.from)
    onEditDocument((current) => ({
      ...current,
      objects: current.objects.map((object) => (
        object.id === active?.id && object.data.kind === 'light'
          ? { ...object, data: { ...object.data, ...patch } }
          : object
      )),
    }), handle.label)
  }

  const end = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!dragging) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDragging(null)
    onGestureEnd()
  }

  return (
    <svg className="scene-light-handles" aria-hidden="true">
      {handles.map((handle) => (
        <g key={handle.id}>
          <line
            className="scene-light-handles__stem"
            x1={handle.centre[0]}
            y1={handle.centre[1]}
            x2={handle.at[0]}
            y2={handle.at[1]}
          />
          <circle
            className="scene-light-handles__grip"
            data-dragging={dragging?.id === handle.id || undefined}
            cx={handle.at[0]}
            cy={handle.at[1]}
            r={16}
            onPointerDown={start(handle)}
            onPointerMove={move(handle)}
            onPointerUp={end}
            onPointerCancel={end}
          />
        </g>
      ))}
    </svg>
  )
}

/** The handles a light offers, already projected. A light with nothing to drag offers none. */
function handlesFor(scene: SceneDocument, object: SceneObject, viewport: SceneViewport): Handle[] {
  if (object.data.kind !== 'light') return []
  const data = object.data
  const matrix = worldMatrix(scene, object)
  const place = (local: Vec3): [number, number] | null => {
    const point = new Float64Array(3)
    const m = matrix.elements
    for (let axis = 0; axis < 3; axis += 1) {
      point[axis] = m[axis]! * local[0] + m[4 + axis]! * local[1] + m[8 + axis]! * local[2] + m[12 + axis]!
    }
    return viewport.project([point[0]!, point[1]!, point[2]!])
  }
  const centre = place([0, 0, 0])
  if (!centre) return []

  if (data.light === 'spot') {
    const half = (data.spotAngle / 2) * (Math.PI / 180)
    const radius = Math.tan(Math.min(half, 1.5)) * CONE_DEPTH
    const rim = place([radius, 0, -CONE_DEPTH])
    if (!rim) return []
    return [{
      id: 'spot-angle',
      label: 'Spot size',
      at: rim,
      centre: place([0, 0, -CONE_DEPTH]) ?? centre,
      apply: (ratio) => ({
        // Back from a radius to the angle that draws it, kept inside Blender's own limits.
        spotAngle: Math.min(180, Math.max(1, (2 * Math.atan((radius * ratio) / CONE_DEPTH) * 180) / Math.PI)),
      }),
    }]
  }

  if (data.light === 'area') {
    const square = data.areaShape === 'square' || data.areaShape === 'disk'
    const width = data.areaSize[0]
    const height = square ? data.areaSize[0] : data.areaSize[1]
    const corner = place([width / 2, height / 2, 0])
    if (!corner) return []
    return [{
      id: 'area-size',
      label: 'Area size',
      at: corner,
      centre,
      apply: (ratio) => ({
        areaSize: [
          Math.min(1000, Math.max(0.001, width * ratio)),
          square ? Math.min(1000, Math.max(0.001, width * ratio)) : Math.min(1000, Math.max(0.001, height * ratio)),
        ] as [number, number],
      }),
    }]
  }
  return []
}
