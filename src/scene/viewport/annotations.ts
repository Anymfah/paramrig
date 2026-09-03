import { Group } from 'three'
import { createLines, type ViewportLines } from '@/scene/viewport/lines'
import type { Annotation, Measurement, Vec3 } from '@/scene/types'
import { splitAlpha, type SceneTheme } from '@/scene/viewport/theme'

/**
 * The two things a person draws *on* a scene rather than in it: freehand notes, and rulers.
 *
 * Both are kept in the document but outside the history. An annotation is a note to a colleague or
 * to oneself the following morning; undoing a modelling step and losing the note that explained it
 * would be the wrong trade, and a ruler is a question about the model, not a change to it.
 */

export type AnnotationLayer = {
  group: Group
  setAnnotations: (annotations: Annotation[]) => void
  /** The stroke being drawn right now, before it is committed. */
  setDraft: (points: Vec3[], colour: string, width: number) => void
  setMeasurements: (measurements: Measurement[], active: string | null) => void
  setDraftRuler: (from: Vec3 | null, to: Vec3 | null) => void
  setTheme: (theme: SceneTheme) => void
  setResolution: (width: number, height: number) => void
  dispose: () => void
}

export function createAnnotationLayer(theme: SceneTheme): AnnotationLayer {
  let current = theme
  const group = new Group()
  group.name = 'annotations'
  const strokes: ViewportLines[] = []
  const rulers: ViewportLines[] = []
  const draft = createLines({ colour: '#ffffff', width: 3, alwaysVisible: true })
  const draftRuler = createLines({ colour: splitAlpha(theme.measure).colour, width: 2, alwaysVisible: true, dashed: true, dashSize: 0.12, gapSize: 0.08 })
  draft.object.visible = false
  draftRuler.object.visible = false
  group.add(draft.object, draftRuler.object)
  let resolution: [number, number] = [1, 1]

  const grow = (pool: ViewportLines[], count: number, colour: string, width: number, dashed = false) => {
    while (pool.length < count) {
      const line = createLines({ colour, width, alwaysVisible: true, ...(dashed ? { dashed: true, dashSize: 0.14, gapSize: 0.1 } : {}) })
      line.material.resolution.set(resolution[0], resolution[1])
      pool.push(line)
      group.add(line.object)
    }
    for (let index = count; index < pool.length; index += 1) pool[index]!.object.visible = false
  }

  /** A path becomes the pairs of endpoints a segment list wants. */
  const segmentsOf = (points: Vec3[]): number[] => {
    const flat: number[] = []
    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = points[index]!
      const b = points[index + 1]!
      flat.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }
    return flat
  }

  return {
    group,
    setAnnotations: (annotations) => {
      grow(strokes, annotations.length, '#ffffff', 3)
      annotations.forEach((annotation, index) => {
        const line = strokes[index]!
        line.setColour(annotation.color)
        line.material.linewidth = annotation.width
        line.setPositions(segmentsOf(annotation.points))
        line.object.visible = annotation.points.length > 1
      })
    },
    setDraft: (points, colour, width) => {
      draft.setColour(colour)
      draft.material.linewidth = width
      draft.setPositions(segmentsOf(points))
      draft.object.visible = points.length > 1
    },
    setMeasurements: (measurements, active) => {
      grow(rulers, measurements.length, splitAlpha(current.measure).colour, 2)
      measurements.forEach((measurement, index) => {
        const line = rulers[index]!
        // The one under the pointer is drawn in the selection colour, so Delete has a target.
        line.setColour(splitAlpha(measurement.id === active ? current.selected : current.measure).colour)
        const points = measurement.apex
          ? [measurement.from, measurement.apex, measurement.to]
          : [measurement.from, measurement.to]
        line.setPositions(segmentsOf(points))
        line.object.visible = true
      })
    },
    setDraftRuler: (from, to) => {
      if (!from || !to) {
        draftRuler.object.visible = false
        return
      }
      draftRuler.setPositions([from[0], from[1], from[2], to[0], to[1], to[2]])
      draftRuler.object.visible = true
    },
    setTheme: (next) => {
      current = next
      draftRuler.setColour(splitAlpha(next.measure).colour)
    },
    setResolution: (width, height) => {
      resolution = [width, height]
      for (const line of [draft, draftRuler, ...strokes, ...rulers]) line.material.resolution.set(width, height)
    },
    dispose: () => {
      for (const line of [draft, draftRuler, ...strokes, ...rulers]) line.dispose()
      strokes.length = 0
      rulers.length = 0
      group.clear()
    },
  }
}

/** The distance a ruler reads, in the document's units. */
export function measurementLength(measurement: Measurement): number {
  if (!measurement.apex) return distance(measurement.from, measurement.to)
  return distance(measurement.from, measurement.apex) + distance(measurement.apex, measurement.to)
}

/** The angle at the apex, in degrees, for a ruler that has one. */
export function measurementAngle(measurement: Measurement): number | null {
  if (!measurement.apex) return null
  const a = subtract(measurement.from, measurement.apex)
  const b = subtract(measurement.to, measurement.apex)
  const lengths = length(a) * length(b)
  if (lengths < 1e-9) return null
  const cosine = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / lengths))
  return (Math.acos(cosine) * 180) / Math.PI
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** How a ruler reads on screen: "1.41 m", or "1.41 m · 90°" when it has an apex. */
export function measurementLabel(measurement: Measurement, unit = 'm'): string {
  const angle = measurementAngle(measurement)
  const length = `${round(measurementLength(measurement))} ${unit}`
  return angle === null ? length : `${length} · ${round(angle)}°`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
