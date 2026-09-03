import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  TorusGeometry,
  Vector3,
  type Camera,
} from 'three'
import { createLines, type ViewportLines } from '@/scene/viewport/lines'
import { createPickMaterial, type PickResult } from '@/scene/viewport/picking'
import { splitAlpha, type SceneTheme } from '@/scene/viewport/theme'
import type { TransformMode } from '@/scene/transform/session'
import type { Vec3 } from '@/scene/types'

/**
 * The Move, Rotate and Scale gizmos.
 *
 * Two things make a gizmo usable, and both are about the pointer rather than the drawing. It has
 * to be the same size on screen at every distance, or it is a speck when you zoom out and fills the
 * view when you zoom in — so the whole thing is scaled by the world size of a pixel at its own
 * depth. And its grab area has to be far larger than its ink: the arrow is a hairline, the thing
 * you can catch is a 32-pixel cylinder around it, which is why the picking geometry here is a
 * separate, invisible set of solids rather than the shapes you see.
 *
 * Occlusion comes free from the id buffer: the picking pass draws the objects too, with depth, so a
 * handle behind a wall is behind it, exactly as in Blender.
 */

/** The gizmo is drawn a nominal one unit across and scaled to this many pixels on screen. */
const GIZMO_RADIUS_PX = 90
/** The pointer target around a handle, as a fraction of that radius: 16 px each side of the ink. */
const GRAB = 16 / GIZMO_RADIUS_PX

export type GizmoKind = 'move' | 'rotate' | 'scale'

export type GizmoHandle = {
  id: number
  mode: TransformMode
  /** Which axes the drag is constrained to; empty means free in the view plane. */
  axes: Array<'x' | 'y' | 'z'>
  kind: 'axis' | 'plane' | 'view' | 'uniform' | 'trackball'
}

export type GizmoSet = {
  /** Drawn in the overlay scene, after the objects, with the depth buffer kept. */
  group: Group
  /** The invisible solids the id buffer draws, in the picking scene. */
  pickGroup: Group
  update: (options: {
    kinds: GizmoKind[]
    pivot: Vec3
    /** The axis frame the gizmo points along: global, local, normal — whatever the header says. */
    basis: { x: Vec3; y: Vec3; z: Vec3 }
    /** World units per screen pixel at the pivot, so the gizmo keeps its size. */
    unitsPerPixel: number
    camera: Camera
  }) => void
  setHover: (id: number | null) => void
  setVisible: (visible: boolean) => void
  handleOf: (pick: PickResult) => GizmoHandle | null
  setTheme: (theme: SceneTheme) => void
  setResolution: (width: number, height: number) => void
  dispose: () => void
}

const AXES: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z']
const AXIS_VECTOR: Record<'x' | 'y' | 'z', Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }

type Part = {
  handle: GizmoHandle
  kind: GizmoKind
  /** What is drawn, and what is picked. Both are placed by the same matrix. */
  visuals: Object3D[]
  lines: ViewportLines[]
  materials: MeshBasicMaterial[]
  pick: Mesh
  colour: () => string
}

export function createGizmos(theme: SceneTheme): GizmoSet {
  let current = theme
  const group = new Group()
  group.name = 'gizmos'
  const pickGroup = new Group()
  pickGroup.name = 'gizmo-picking'
  const parts: Part[] = []
  const byId = new Map<number, Part>()
  let nextId = 0
  const owned: Array<{ dispose: () => void }> = []

  const axisColour = (axis: 'x' | 'y' | 'z') => () => splitAlpha(axis === 'x' ? current.axisX : axis === 'y' ? current.axisY : current.axisZ).colour
  const viewColour = () => splitAlpha(current.gizmoView).colour
  const planeColour = () => splitAlpha(current.gizmoPlane).colour

  const register = (part: Omit<Part, 'handle'> & { handle: Omit<GizmoHandle, 'id'> }): Part => {
    const id = nextId++
    const full: Part = { ...part, handle: { ...part.handle, id } }
    parts.push(full)
    byId.set(id, full)
    for (const visual of full.visuals) {
      visual.renderOrder = 1000
      visual.traverse((node) => {
        node.renderOrder = 1000
        const material = (node as Mesh).material as MeshBasicMaterial | undefined
        if (material && 'depthTest' in material) {
          material.depthTest = false
          material.depthWrite = false
        }
      })
      group.add(visual)
    }
    const pickMaterial = createPickMaterial('gizmo', id)
    // A gizmo is drawn and picked in front of everything, geometry included. It has to be: a Move
    // gizmo sits at its object's own centre, so anything else would make it unusable the moment
    // the object filled the view. Blender does the same, and the click order the plan asks for —
    // gizmo, then object, then nothing — is only true if it does.
    pickMaterial.depthTest = false
    pickMaterial.depthWrite = false
    full.pick.material = pickMaterial
    full.pick.renderOrder = 1000
    full.pick.visible = false
    pickGroup.add(full.pick)
    owned.push({
      dispose: () => {
        for (const line of full.lines) line.dispose()
        for (const material of full.materials) material.dispose()
        for (const visual of full.visuals) {
          if (visual instanceof Mesh) visual.geometry.dispose()
        }
        full.pick.geometry.dispose()
        ;(full.pick.material as MeshBasicMaterial).dispose()
      },
    })
    return full
  }

  /* ------------------------------------------------------------ the shapes */

  for (const axis of AXES) {
    const colour = axisColour(axis)
    // Move: a hairline shaft with a cone on the end, caught by a fat invisible cylinder.
    const shaft = createLines({ colour: colour(), width: 2, positions: [0, 0, 0, 0, 0, 0], alwaysVisible: true })
    const headMaterial = new MeshBasicMaterial({ color: new Color(colour()), toneMapped: false })
    const head = new Mesh(new ConeGeometry(0.055, 0.2, 16), headMaterial)
    const moveGroup = new Group()
    moveGroup.add(shaft.object, head)
    register({
      kind: 'move',
      handle: { mode: 'move', axes: [axis], kind: 'axis' },
      visuals: [moveGroup],
      lines: [shaft],
      materials: [headMaterial],
      pick: new Mesh(new CylinderGeometry(GRAB, GRAB, 1, 8)),
      colour,
    })

    // Scale: the same shaft with a cube on the end.
    const scaleShaft = createLines({ colour: colour(), width: 2, positions: [0, 0, 0, 0, 0, 0], alwaysVisible: true })
    const cubeMaterial = new MeshBasicMaterial({ color: new Color(colour()), toneMapped: false })
    const cube = new Mesh(new BoxGeometry(0.11, 0.11, 0.11), cubeMaterial)
    const scaleGroup = new Group()
    scaleGroup.add(scaleShaft.object, cube)
    register({
      kind: 'scale',
      handle: { mode: 'scale', axes: [axis], kind: 'axis' },
      visuals: [scaleGroup],
      lines: [scaleShaft],
      materials: [cubeMaterial],
      pick: new Mesh(new CylinderGeometry(GRAB, GRAB, 1, 8)),
      colour,
    })

    // Rotate: a ring in the plane the axis is normal to.
    const ring = createLines({ colour: colour(), width: 2.4, positions: ringPositions(1), alwaysVisible: true })
    register({
      kind: 'rotate',
      handle: { mode: 'rotate', axes: [axis], kind: 'axis' },
      visuals: [ring.object],
      lines: [ring],
      materials: [],
      pick: new Mesh(new TorusGeometry(1, GRAB, 6, 48)),
      colour,
    })
  }

  // The three planes, for both Move and Scale: a small square in the corner between two axes.
  const PLANES: Array<{ axes: Array<'x' | 'y' | 'z'>; normal: 'x' | 'y' | 'z' }> = [
    { axes: ['y', 'z'], normal: 'x' },
    { axes: ['x', 'z'], normal: 'y' },
    { axes: ['x', 'y'], normal: 'z' },
  ]
  for (const plane of PLANES) {
    for (const mode of ['move', 'scale'] as const) {
      const colour = axisColour(plane.normal)
      const material = new MeshBasicMaterial({ color: new Color(planeColour()), transparent: true, opacity: 0.5, side: DoubleSide, toneMapped: false, depthWrite: false })
      const quad = new Mesh(new PlaneGeometry(0.26, 0.26), material)
      register({
        kind: mode,
        handle: { mode, axes: plane.axes, kind: 'plane' },
        visuals: [quad],
        lines: [],
        materials: [material],
        pick: new Mesh(new PlaneGeometry(0.3, 0.3)),
        colour,
      })
    }
  }

  // Free move in the view plane: the small circle at the centre.
  const viewRing = createLines({ colour: viewColour(), width: 1.8, positions: ringPositions(0.22), alwaysVisible: true })
  register({
    kind: 'move',
    handle: { mode: 'move', axes: [], kind: 'view' },
    visuals: [viewRing.object],
    lines: [viewRing],
    materials: [],
    pick: new Mesh(new CircleGeometry(0.24, 24)),
    colour: viewColour,
  })

  // Rotate about the view's own axis: the outer ring.
  const viewRotate = createLines({ colour: viewColour(), width: 2.2, positions: ringPositions(1.18), alwaysVisible: true })
  register({
    kind: 'rotate',
    handle: { mode: 'rotate', axes: [], kind: 'view' },
    visuals: [viewRotate.object],
    lines: [viewRotate],
    materials: [],
    pick: new Mesh(new TorusGeometry(1.18, GRAB, 6, 48)),
    colour: viewColour,
  })

  // The trackball: the disc inside the rings, which turns freely.
  const trackballMaterial = new MeshBasicMaterial({ color: new Color(viewColour()), transparent: true, opacity: 0.06, side: DoubleSide, toneMapped: false, depthWrite: false })
  const trackball = new Mesh(new CircleGeometry(0.94, 40), trackballMaterial)
  register({
    kind: 'rotate',
    handle: { mode: 'trackball', axes: [], kind: 'trackball' },
    visuals: [trackball],
    lines: [],
    materials: [trackballMaterial],
    pick: new Mesh(new CircleGeometry(0.94, 32)),
    colour: viewColour,
  })

  // Uniform scale: the ring the whole selection is resized by.
  const uniform = createLines({ colour: viewColour(), width: 1.8, positions: ringPositions(1.12), alwaysVisible: true })
  register({
    kind: 'scale',
    handle: { mode: 'scale', axes: [], kind: 'uniform' },
    visuals: [uniform.object],
    lines: [uniform],
    materials: [],
    pick: new Mesh(new TorusGeometry(1.12, GRAB, 6, 48)),
    colour: viewColour,
  })

  let hovered: number | null = null

  const paint = () => {
    for (const part of parts) {
      const hot = part.handle.id === hovered
      const colour = hot ? splitAlpha(current.active).colour : part.handle.kind === 'plane' ? planeColour() : part.colour()
      for (const line of part.lines) line.setColour(colour)
      for (const material of part.materials) {
        material.color.set(colour)
        if (part.handle.kind === 'plane') material.opacity = hot ? 0.85 : 0.5
        if (part.handle.kind === 'trackball') material.opacity = hot ? 0.14 : 0.06
      }
    }
  }
  paint()

  const scratch = new Quaternion()
  const scratchUp = new Vector3()

  return {
    group,
    pickGroup,
    update: ({ kinds, pivot, basis, unitsPerPixel, camera }) => {
      const scale = Math.max(1e-6, unitsPerPixel * GIZMO_RADIUS_PX)
      for (const container of [group, pickGroup]) {
        container.position.set(pivot[0], pivot[1], pivot[2])
        container.scale.setScalar(scale)
        container.updateMatrixWorld(true)
      }
      const facing = camera.quaternion
      for (const part of parts) {
        const on = kinds.includes(part.kind)
        for (const visual of part.visuals) visual.visible = on
        part.pick.visible = on
        if (!on) continue
        const axis = part.handle.axes[0]
        if (part.handle.kind === 'axis' && axis) {
          const direction = new Vector3(...applyBasis(basis, AXIS_VECTOR[axis]))
          scratch.setFromUnitVectors(new Vector3(0, 1, 0), direction)
          const shaftGroup = part.visuals[0]!
          shaftGroup.quaternion.copy(scratch)
          shaftGroup.position.set(0, 0, 0)
          if (part.handle.mode === 'rotate') {
            // A ring lies in the plane its axis is normal to, so it is turned to face the axis.
            shaftGroup.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), direction))
          } else {
            const children = (shaftGroup as Group).children
            const line = children[0]
            const head = children[1]
            if (line) {
              const lines = part.lines[0]
              lines?.setPositions([0, 0.18, 0, 0, 0.86, 0])
            }
            if (head) head.position.set(0, part.handle.mode === 'scale' ? 0.92 : 0.94, 0)
          }
          part.pick.quaternion.copy(part.handle.mode === 'rotate'
            ? new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), direction)
            : scratch)
          part.pick.position.set(0, 0, 0)
          if (part.handle.mode !== 'rotate') {
            part.pick.position.copy(direction.clone().multiplyScalar(0.55))
            part.pick.scale.set(1, 0.8, 1)
          }
          continue
        }
        if (part.handle.kind === 'plane') {
          const [a, b] = part.handle.axes
          if (!a || !b) continue
          const first = new Vector3(...applyBasis(basis, AXIS_VECTOR[a]))
          const second = new Vector3(...applyBasis(basis, AXIS_VECTOR[b]))
          const centre = first.clone().multiplyScalar(0.42).add(second.clone().multiplyScalar(0.42))
          const normal = first.clone().cross(second).normalize()
          const orientation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal)
          for (const node of [part.visuals[0]!, part.pick]) {
            node.position.copy(centre)
            node.quaternion.copy(orientation)
          }
          continue
        }
        // Everything else faces the viewer.
        for (const node of [part.visuals[0]!, part.pick]) {
          node.quaternion.copy(facing)
          node.position.set(0, 0, 0)
        }
      }
      scratchUp.set(0, 0, 0)
    },
    setHover: (id) => {
      if (hovered === id) return
      hovered = id
      paint()
    },
    setVisible: (visible) => {
      group.visible = visible
      pickGroup.visible = visible
    },
    handleOf: (pick) => (pick && pick.kind === 'gizmo' ? byId.get(pick.id)?.handle ?? null : null),
    setTheme: (next) => {
      current = next
      paint()
    },
    setResolution: (width, height) => {
      for (const part of parts) for (const line of part.lines) line.material.resolution.set(width, height)
    },
    dispose: () => {
      for (const entry of owned) entry.dispose()
      group.clear()
      pickGroup.clear()
      parts.length = 0
      byId.clear()
    },
  }
}

/** A closed ring on the XY plane, as the segment list `LineSegments2` wants. */
function ringPositions(radius: number, steps = 64): number[] {
  const points: number[] = []
  for (let index = 0; index < steps; index += 1) {
    const a = (index / steps) * Math.PI * 2
    const b = ((index + 1) / steps) * Math.PI * 2
    points.push(Math.cos(a) * radius, Math.sin(a) * radius, 0, Math.cos(b) * radius, Math.sin(b) * radius, 0)
  }
  return points
}

function applyBasis(basis: { x: Vec3; y: Vec3; z: Vec3 }, vector: Vec3): Vec3 {
  return [
    basis.x[0] * vector[0] + basis.y[0] * vector[1] + basis.z[0] * vector[2],
    basis.x[1] * vector[0] + basis.y[1] * vector[1] + basis.z[1] * vector[2],
    basis.x[2] * vector[0] + basis.y[2] * vector[1] + basis.z[2] * vector[2],
  ]
}
