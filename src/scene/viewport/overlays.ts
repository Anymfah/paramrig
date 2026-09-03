import { Group, Object3D } from 'three'
import { createLines, type ViewportLines } from '@/scene/viewport/lines'
import type { CameraData, EmptyData, LightData, Vec3 } from '@/scene/types'

/**
 * The things in a scene that have no shape.
 *
 * A light, a camera and an empty are positions and settings; what is drawn for them is a glyph
 * that says which they are and how they are aimed. Blender's shapes are the ones a person coming
 * from Blender reads without being told, so these are Blender's shapes: a sun's rays, a spot's
 * cone, an area light's rectangle, a camera's pyramid with a triangle on top for "up".
 *
 * Every glyph is line geometry in one object per scene object, so the whole set costs one draw
 * call each and can be rebuilt without touching the meshes.
 */

export type Glyph = {
  object: Object3D
  lines: ViewportLines[]
  dispose: () => void
}

/** Line segments as flat triples, in the object's own space; the object's matrix places them. */
function segments(points: Array<[Vec3, Vec3]>): number[] {
  return points.flatMap(([a, b]) => [a[0], a[1], a[2], b[0], b[1], b[2]])
}

function circle(radius: number, plane: 'xy' | 'xz' | 'yz', steps = 32, offset: Vec3 = [0, 0, 0]): Array<[Vec3, Vec3]> {
  const points: Vec3[] = []
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2
    const c = Math.cos(angle) * radius
    const s = Math.sin(angle) * radius
    const point: Vec3 = plane === 'xy' ? [c, s, 0] : plane === 'xz' ? [c, 0, s] : [0, c, s]
    points.push([point[0] + offset[0], point[1] + offset[1], point[2] + offset[2]])
  }
  return points.map((point, index) => [point, points[(index + 1) % points.length]!] as [Vec3, Vec3])
}

function makeGlyph(parts: Array<{ points: Array<[Vec3, Vec3]>; colour: string; width: number; dashed?: boolean }>): Glyph {
  const group = new Group()
  group.matrixAutoUpdate = false
  const lines: ViewportLines[] = []
  for (const part of parts) {
    const line = createLines({
      positions: segments(part.points),
      colour: part.colour,
      width: part.width,
      ...(part.dashed ? { dashed: true, dashSize: 0.12, gapSize: 0.08 } : {}),
    })
    lines.push(line)
    group.add(line.object)
  }
  return {
    object: group,
    lines,
    dispose: () => {
      for (const line of lines) line.dispose()
      group.clear()
    },
  }
}

/**
 * A light's glyph. The rays, the cone and the rectangle all point down the object's local -Z, the
 * way Blender aims a light, so rotating the object aims the glyph with no extra bookkeeping.
 */
export function lightGlyph(data: LightData, colour: string): Glyph {
  const parts: Array<{ points: Array<[Vec3, Vec3]>; colour: string; width: number; dashed?: boolean }> = []
  const ring = circle(0.25, 'xy')
  parts.push({ points: ring, colour, width: 1.6 })
  if (data.light === 'point') {
    // Eight short rays, which is what says "this shines everywhere" at a glance.
    const rays: Array<[Vec3, Vec3]> = []
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      rays.push([[c * 0.35, s * 0.35, 0], [c * 0.55, s * 0.55, 0]])
    }
    parts.push({ points: rays, colour, width: 1.4 })
  }
  if (data.light === 'sun') {
    const rays: Array<[Vec3, Vec3]> = []
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      rays.push([[c * 0.4, s * 0.4, 0], [c * 0.65, s * 0.65, 0]])
    }
    parts.push({ points: rays, colour, width: 1.4 })
    // A sun is a direction, not a place: the dashed line says where it points.
    parts.push({ points: [[[0, 0, 0], [0, 0, -3]]], colour, width: 1.2, dashed: true })
  }
  if (data.light === 'spot') {
    const half = (data.spotAngle / 2) * (Math.PI / 180)
    const depth = 2
    const radius = Math.tan(Math.min(half, 1.5)) * depth
    parts.push({ points: circle(radius, 'xy', 32, [0, 0, -depth]), colour, width: 1.4 })
    const rim: Array<[Vec3, Vec3]> = []
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2
      rim.push([[0, 0, 0], [Math.cos(angle) * radius, Math.sin(angle) * radius, -depth]])
    }
    parts.push({ points: rim, colour, width: 1.4 })
  }
  if (data.light === 'area') {
    const [width, height] = data.areaShape === 'square' || data.areaShape === 'disk'
      ? [data.areaSize[0], data.areaSize[0]]
      : data.areaSize
    if (data.areaShape === 'disk' || data.areaShape === 'ellipse') {
      parts.push({ points: circle(width / 2, 'xy'), colour, width: 1.6 })
    } else {
      const hw = width / 2
      const hh = height / 2
      parts.push({
        points: [
          [[-hw, -hh, 0], [hw, -hh, 0]], [[hw, -hh, 0], [hw, hh, 0]],
          [[hw, hh, 0], [-hw, hh, 0]], [[-hw, hh, 0], [-hw, -hh, 0]],
        ],
        colour,
        width: 1.6,
      })
    }
    parts.push({ points: [[[0, 0, 0], [0, 0, -1]]], colour, width: 1.2, dashed: true })
  }
  return makeGlyph(parts)
}

/**
 * A camera's pyramid, sized so the near rectangle is one unit away — and the little triangle on
 * top, which is the only thing in the glyph that says which way up the picture is.
 */
export function cameraGlyph(data: CameraData, colour: string): Glyph {
  const depth = 1
  const halfHeight = data.projection === 'orthographic'
    ? data.orthoScale / 2
    : (data.sensor / 2 / data.focalLength) * depth
  const halfWidth = halfHeight * 1.5
  const corners: Vec3[] = [
    [-halfWidth, -halfHeight, -depth],
    [halfWidth, -halfHeight, -depth],
    [halfWidth, halfHeight, -depth],
    [-halfWidth, halfHeight, -depth],
  ]
  const points: Array<[Vec3, Vec3]> = [
    [corners[0]!, corners[1]!], [corners[1]!, corners[2]!], [corners[2]!, corners[3]!], [corners[3]!, corners[0]!],
    [[0, 0, 0], corners[0]!], [[0, 0, 0], corners[1]!], [[0, 0, 0], corners[2]!], [[0, 0, 0], corners[3]!],
    [[-halfWidth * 0.6, halfHeight * 1.15, -depth], [halfWidth * 0.6, halfHeight * 1.15, -depth]],
    [[-halfWidth * 0.6, halfHeight * 1.15, -depth], [0, halfHeight * 1.75, -depth]],
    [[halfWidth * 0.6, halfHeight * 1.15, -depth], [0, halfHeight * 1.75, -depth]],
  ]
  return makeGlyph([{ points, colour, width: 1.6 }])
}

/** The seven shapes an empty can take, at the size the object asks for. */
export function emptyGlyph(data: EmptyData, colour: string): Glyph {
  const size = data.size
  const points: Array<[Vec3, Vec3]> = []
  switch (data.display) {
    case 'arrows':
      points.push([[0, 0, 0], [size, 0, 0]], [[0, 0, 0], [0, size, 0]], [[0, 0, 0], [0, 0, size]])
      points.push([[size, 0, 0], [size * 0.8, size * 0.1, 0]], [[size, 0, 0], [size * 0.8, -size * 0.1, 0]])
      points.push([[0, size, 0], [size * 0.1, size * 0.8, 0]], [[0, size, 0], [-size * 0.1, size * 0.8, 0]])
      points.push([[0, 0, size], [size * 0.1, 0, size * 0.8]], [[0, 0, size], [-size * 0.1, 0, size * 0.8]])
      break
    case 'single-arrow':
      points.push([[0, 0, 0], [0, 0, size]], [[0, 0, size], [size * 0.12, 0, size * 0.82]], [[0, 0, size], [-size * 0.12, 0, size * 0.82]])
      break
    case 'cube': {
      const h = size
      const corners: Vec3[] = [
        [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
        [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
      ]
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
        points.push([corners[a!]!, corners[b!]!])
      }
      break
    }
    case 'sphere':
      points.push(...circle(size, 'xy'), ...circle(size, 'xz'), ...circle(size, 'yz'))
      break
    case 'circle':
      points.push(...circle(size, 'xy'))
      break
    case 'cone': {
      points.push(...circle(size * 0.5, 'xy'))
      for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2
        points.push([[Math.cos(angle) * size * 0.5, Math.sin(angle) * size * 0.5, 0], [0, 0, size]])
      }
      break
    }
    default:
      points.push([[-size, 0, 0], [size, 0, 0]], [[0, -size, 0], [0, size, 0]], [[0, 0, -size], [0, 0, size]])
  }
  return makeGlyph([{ points, colour, width: 1.5 }])
}

/**
 * The 3D cursor: a ring in red and white with a cross through it, drawn facing the camera and at a
 * constant size on screen, so it is the same object however far away the view is.
 */
export function cursorGlyph(colours: { ring: string; ground: string }): Glyph & { setScreenScale: (scale: number) => void } {
  const ring = circle(0.08, 'xy', 40)
  const cross: Array<[Vec3, Vec3]> = [
    [[-0.16, 0, 0], [-0.09, 0, 0]], [[0.09, 0, 0], [0.16, 0, 0]],
    [[0, -0.16, 0], [0, -0.09, 0]], [[0, 0.09, 0], [0, 0.16, 0]],
  ]
  const glyph = makeGlyph([
    { points: ring, colour: colours.ground, width: 3.4 },
    { points: ring, colour: colours.ring, width: 1.6 },
    { points: cross, colour: colours.ground, width: 3.4 },
    { points: cross, colour: colours.ring, width: 1.6 },
  ])
  return {
    ...glyph,
    setScreenScale: (scale) => {
      glyph.object.scale.setScalar(scale)
      glyph.object.updateMatrix()
    },
  }
}
