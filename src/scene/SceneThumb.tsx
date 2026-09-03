import { meshOf } from '@/scene/document'
import type { SceneDocument, Vec3 } from '@/scene/types'

/**
 * A library card's picture of a scene, before there is a viewport to take one with: every object's
 * bounding box, drawn isometrically. It says how much is in the scene and roughly where, which is
 * what a card is for. The viewport replaces it with a real render in the shading prompt.
 */
export function SceneThumb({ document }: { document: SceneDocument }) {
  const boxes = document.objects.flatMap((object) => {
    if (!object.visible) return []
    const mesh = meshOf(document, object)
    const half: Vec3 = mesh ? meshHalfExtent(mesh.vertices) : [0.35, 0.35, 0.35]
    if (half[0] === 0 && half[1] === 0 && half[2] === 0) return []
    const [sx, sy, sz] = object.transform.scale
    return [{
      id: object.id,
      centre: object.transform.position,
      half: [Math.abs(half[0] * sx), Math.abs(half[1] * sy), Math.abs(half[2] * sz)] as Vec3,
      kind: object.kind,
    }]
  })
  if (boxes.length === 0) return <svg className="scene-thumb" viewBox="-50 -50 100 100" aria-hidden="true" />

  const points = boxes.flatMap((box) => corners(box.centre, box.half).map(project))
  const minX = Math.min(...points.map((point) => point[0]))
  const maxX = Math.max(...points.map((point) => point[0]))
  const minY = Math.min(...points.map((point) => point[1]))
  const maxY = Math.max(...points.map((point) => point[1]))
  const pad = Math.max(maxX - minX, maxY - minY) * 0.12 + 0.5
  const view = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`
  const stroke = Math.max(maxX - minX, maxY - minY) / 90

  // Farthest box first, so a nearer one covers it the way depth would.
  const ordered = [...boxes].sort((a, b) => depth(b.centre) - depth(a.centre))

  return (
    <svg className="scene-thumb" viewBox={view} aria-hidden="true" strokeWidth={stroke}>
      {ordered.map((box) => {
        const c = corners(box.centre, box.half).map(project)
        // The three visible faces of an isometric box: top, left and right.
        const faces = [
          [c[4]!, c[5]!, c[6]!, c[7]!],
          [c[0]!, c[1]!, c[5]!, c[4]!],
          [c[1]!, c[2]!, c[6]!, c[5]!],
        ]
        return (
          <g key={box.id} data-kind={box.kind}>
            {faces.map((face, index) => (
              <polygon
                key={index}
                className={`scene-thumb__face scene-thumb__face--${['top', 'left', 'right'][index]}`}
                points={face.map((point) => `${point[0]},${point[1]}`).join(' ')}
              />
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function meshHalfExtent(vertices: number[]): Vec3 {
  if (vertices.length < 3) return [0, 0, 0]
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = vertices[index + axis]!
      if (value < min[axis]!) min[axis] = value
      if (value > max[axis]!) max[axis] = value
    }
  }
  return [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2]
}

function corners(centre: Vec3, half: Vec3): Vec3[] {
  const [cx, cy, cz] = centre
  const [hx, hy, hz] = half
  return [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ]
}

const COS30 = Math.cos(Math.PI / 6)
const SIN30 = 0.5

/** A true isometric projection of a Z-up world: x and y go out at 30°, z straight up. */
function project(point: Vec3): [number, number] {
  return [(point[0] - point[1]) * COS30, (point[0] + point[1]) * SIN30 - point[2]]
}

function depth(point: Vec3): number {
  return point[0] + point[1] + point[2]
}
