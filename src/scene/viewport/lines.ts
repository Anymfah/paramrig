import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { Color } from 'three'

/**
 * Every line in the viewport goes through here.
 *
 * `LineBasicMaterial` draws a one-pixel aliased line whatever width it is given — the width is
 * ignored on almost every platform — and an editor whose wireframe, gizmo axes and glyphs are all
 * crawling with stair-steps looks broken before anything has gone wrong. `LineSegments2` draws
 * lines as triangle strips in screen space, so a width is a real width and the edge is smooth.
 */

export type ViewportLines = {
  object: LineSegments2
  material: LineMaterial
  setPositions: (positions: number[] | Float32Array) => void
  /** A colour for each end of each segment, which is how one set draws several states at once. */
  setColours: (colours: number[] | Float32Array) => void
  setColour: (colour: string | number) => void
  dispose: () => void
}

/** What a line set is given when it has nothing to draw: one degenerate segment, allocated once. */
const EMPTY_SEGMENT = new Float32Array([0, 0, 0, 0, 0, 0])

export function createLines(options: {
  positions?: number[] | Float32Array
  colour: string | number
  width: number
  /** Drawn on top of everything, for a gizmo or a cursor that must never be hidden. */
  alwaysVisible?: boolean
  dashed?: boolean
  dashSize?: number
  gapSize?: number
  opacity?: number
}): ViewportLines {
  const geometry = new LineSegmentsGeometry()
  if (options.positions && options.positions.length >= 6) {
    geometry.setPositions(Array.from(options.positions))
  } else {
    geometry.setPositions([0, 0, 0, 0, 0, 0])
  }
  const material = new LineMaterial({
    color: new Color(options.colour).getHex(),
    linewidth: options.width,
    worldUnits: false,
    dashed: !!options.dashed,
    ...(options.dashed ? { dashSize: options.dashSize ?? 0.1, gapSize: options.gapSize ?? 0.06 } : {}),
    transparent: options.opacity !== undefined && options.opacity < 1,
    opacity: options.opacity ?? 1,
    depthTest: !options.alwaysVisible,
    depthWrite: !options.alwaysVisible,
  })
  const object = new LineSegments2(geometry, material)
  // The bounding sphere of a rebuilt line set is stale until it is asked for again; without this
  // a line that moves out of its old sphere is culled and vanishes.
  object.frustumCulled = false
  if (options.dashed) object.computeLineDistances()
  return {
    object,
    material,
    setPositions: (positions) => {
      /*
       * The array goes straight through. `LineSegmentsGeometry` keeps a `Float32Array` as it is and
       * copies anything else, so turning one into a plain array first — which this used to do —
       * allocated a million numbers on a heavy mesh and threw them away a line later.
       */
      const enough = positions.length >= 6
      const buffer = enough
        ? (positions instanceof Float32Array ? positions : Float32Array.from(positions))
        : EMPTY_SEGMENT
      geometry.setPositions(buffer)
      object.visible = enough
      if (options.dashed) object.computeLineDistances()
    },
    setColours: (colours) => {
      if (colours.length < 6) return
      geometry.setColors(colours instanceof Float32Array ? colours : Float32Array.from(colours))
      material.vertexColors = true
      material.needsUpdate = true
    },
    setColour: (colour) => material.color.set(colour),
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** A single polyline, for a measurement or a knife cut, rather than a set of separate segments. */
export function createPolyline(options: { colour: string | number; width: number; alwaysVisible?: boolean }): {
  object: Line2
  material: LineMaterial
  setPoints: (points: number[]) => void
  dispose: () => void
} {
  const geometry = new LineGeometry()
  geometry.setPositions([0, 0, 0, 0, 0, 0])
  const material = new LineMaterial({
    color: new Color(options.colour).getHex(),
    linewidth: options.width,
    worldUnits: false,
    depthTest: !options.alwaysVisible,
    depthWrite: !options.alwaysVisible,
  })
  const object = new Line2(geometry, material)
  object.frustumCulled = false
  return {
    object,
    material,
    setPoints: (points) => {
      geometry.setPositions(points.length >= 6 ? points : [0, 0, 0, 0, 0, 0])
      object.visible = points.length >= 6
    },
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** The line material needs the pixel size of the viewport to draw a width in pixels. */
export function setLineResolution(material: LineMaterial, width: number, height: number): void {
  material.resolution.set(width, height)
}
