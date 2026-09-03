import { Group } from 'three'
import { createLines, type ViewportLines } from '@/scene/viewport/lines'
import type { Vec3 } from '@/scene/types'
import type { SceneTheme } from '@/scene/viewport/theme'
import { splitAlpha } from '@/scene/viewport/theme'

/**
 * What a modal transform draws in the world: the constrained axes right across the view, the
 * dashed line from the pivot to the pointer that a rotation or a scale is measured along, and the
 * pointer itself.
 *
 * The pointer is drawn rather than shown because a modal transform takes the pointer lock: the
 * real cursor is hidden and the movement no longer stops at the edge of the screen, which is what
 * lets a rotation keep going past a full turn. Blender does the same, and the drawn cursor is what
 * tells the user the editor still knows where they are.
 */

export type TransformOverlay = {
  group: Group
  /** Draws the axes named, each in its own colour, through the pivot and across the whole view. */
  setAxes: (axes: Array<'x' | 'y' | 'z'>, pivot: Vec3, reach: number) => void
  /** The dashed line a rotation or a scale is measured along. */
  setMeasureLine: (from: Vec3 | null, to: Vec3 | null) => void
  /** Proportional editing's circle: how far the movement reaches, drawn where it is measured from. */
  setProportional: (centre: Vec3 | null, radius: number) => void
  setTheme: (theme: SceneTheme) => void
  setResolution: (width: number, height: number) => void
  clear: () => void
  dispose: () => void
}

export function createTransformOverlay(theme: SceneTheme): TransformOverlay {
  const group = new Group()
  group.name = 'transform-overlay'
  const axisLines: Record<'x' | 'y' | 'z', ViewportLines> = {
    x: createLines({ colour: splitAlpha(theme.axisX).colour, width: 1.4, alwaysVisible: true }),
    y: createLines({ colour: splitAlpha(theme.axisY).colour, width: 1.4, alwaysVisible: true }),
    z: createLines({ colour: splitAlpha(theme.axisZ).colour, width: 1.4, alwaysVisible: true }),
  }
  const measure = createLines({ colour: splitAlpha(theme.gizmoView).colour, width: 1.2, alwaysVisible: true, dashed: true, dashSize: 0.25, gapSize: 0.18 })
  const circle = createLines({ colour: splitAlpha(theme.proportional).colour, width: 1.4, alwaysVisible: true })
  circle.object.visible = false
  for (const line of [axisLines.x, axisLines.y, axisLines.z, measure, circle]) {
    line.object.visible = false
    line.object.renderOrder = 900
    group.add(line.object)
  }

  return {
    group,
    setAxes: (axes, pivot, reach) => {
      for (const name of ['x', 'y', 'z'] as const) {
        const line = axisLines[name]
        if (!axes.includes(name)) {
          line.object.visible = false
          continue
        }
        const direction: Vec3 = name === 'x' ? [1, 0, 0] : name === 'y' ? [0, 1, 0] : [0, 0, 1]
        line.setPositions([
          pivot[0] - direction[0] * reach, pivot[1] - direction[1] * reach, pivot[2] - direction[2] * reach,
          pivot[0] + direction[0] * reach, pivot[1] + direction[1] * reach, pivot[2] + direction[2] * reach,
        ])
        line.object.visible = true
      }
    },
    setMeasureLine: (from, to) => {
      if (!from || !to) {
        measure.object.visible = false
        return
      }
      measure.setPositions([from[0], from[1], from[2], to[0], to[1], to[2]])
      measure.object.visible = true
    },
    setProportional: (centre, radius) => {
      if (!centre || !(radius > 0)) {
        circle.object.visible = false
        return
      }
      /*
       * A ring on the plane the view looks at, so the circle reads as a circle from wherever the
       * scene is being seen. Blender draws it the same way: the falloff is measured in space, but
       * what a person needs to see is how far it reaches on screen.
       */
      const points: number[] = []
      const steps = 64
      for (let step = 0; step < steps; step += 1) {
        const from = (step / steps) * Math.PI * 2
        const to = ((step + 1) / steps) * Math.PI * 2
        points.push(
          centre[0] + Math.cos(from) * radius, centre[1] + Math.sin(from) * radius, centre[2],
          centre[0] + Math.cos(to) * radius, centre[1] + Math.sin(to) * radius, centre[2],
        )
      }
      circle.setPositions(points)
      circle.object.visible = true
    },
    setTheme: (next) => {
      circle.setColour(splitAlpha(next.proportional).colour)
      axisLines.x.setColour(splitAlpha(next.axisX).colour)
      axisLines.y.setColour(splitAlpha(next.axisY).colour)
      axisLines.z.setColour(splitAlpha(next.axisZ).colour)
      measure.setColour(splitAlpha(next.gizmoView).colour)
    },
    setResolution: (width, height) => {
      for (const line of [axisLines.x, axisLines.y, axisLines.z, measure, circle]) line.material.resolution.set(width, height)
    },
    clear: () => {
      for (const line of [axisLines.x, axisLines.y, axisLines.z, measure, circle]) line.object.visible = false
    },
    dispose: () => {
      for (const line of [axisLines.x, axisLines.y, axisLines.z, measure, circle]) line.dispose()
      group.clear()
    },
  }
}
