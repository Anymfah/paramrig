import { Matrix4, Vector3 } from 'three'
import { localFromWorldPoint, worldMatrix } from '@/scene/objects'
import { meshOf, withMesh } from '@/scene/document'
import { keysActive, keyValue, shapedMesh } from '@/scene/mesh/shapeKeys'
import { dabSettings, DEFAULT_SCULPT_STATE, SculptSession } from '@/scene/sculpt/session'
import type { HudChannel } from '@/scene/viewport/hud'
import type { SceneViewport } from '@/scene/viewport/SceneViewport'
import { cameraPosition } from '@/scene/viewport/view'
import type { MeshData, SceneDocument, SceneObject, SculptState, ShapeKey, Vec3 } from '@/scene/types'

/**
 * Sculpting, from the pointer to the mesh.
 *
 * The arithmetic is `src/scene/sculpt/`, which has never heard of a browser. This is the part that
 * has: it finds where the ray meets the surface, turns the brush's radius in pixels into a radius
 * in the object's own units, walks the pointer's movement in dabs so that a fast stroke is as solid
 * as a slow one, and pushes the moved vertices straight into the drawn geometry.
 *
 * The document is written once, at the end of the stroke. That is the whole reason sculpting can
 * run at all: a stroke on a two-hundred-thousand-vertex mesh touches thousands of vertices sixty
 * times a second, and a document write per frame — a new mesh, a new history entry, a React render —
 * would be two orders of magnitude more work than the sculpting itself.
 */

export type SculptToolDeps = {
  viewport: () => SceneViewport | null
  document: () => SceneDocument | null
  hud: HudChannel
  /** Writes the sculpted mesh into the document; called once, when the stroke ends. */
  applyDocument: (edit: (current: SceneDocument) => SceneDocument) => void
  beginGesture: (label: string) => void
  endGesture: (label: string) => void
  invalidate: () => void
  /** What the status bar says when a stroke cannot go where it would have to go. */
  message: (text: string) => void
}

/** How far apart two dabs are, as a fraction of the radius: Blender's spacing, near enough. */
const SPACING = 0.25

/** At most this many dabs in one frame, so a flick across the screen cannot stall it. */
const MAX_DABS = 12

/** How many pixels of drag change the radius by its whole value, when F is held. */
const SIZE_PIXELS = 200

export class SculptTool {
  private deps: SculptToolDeps
  private session: SculptSession | null = null
  private objectId = ''
  private meshId = ''
  /*
   * The mesh as the document stores it, and the keys that were on when the session opened.
   *
   * The session works on the *shaped* mesh — what is on screen — because that is what the brush is
   * touching. Both of these are what the page compares against to know whether the copy the session
   * holds is still of this object: a key scrubbed while sculpting changes the surface under the
   * hand, and the session has to be built again.
   */
  private storedMesh: MeshData | null = null
  private storedKeys: ShapeKey[] | undefined
  /** Where the last dab landed, in the object's own space, so the next one can be walked to. */
  private last: Vec3 | null = null
  private stroking = false
  private state: SculptState = DEFAULT_SCULPT_STATE
  private modifiers = { invert: false, smoothing: false }
  /** The pending pointer, applied on the next frame: a stroke is one flush per frame, not per event. */
  private pending: { x: number; y: number; pressure: number } | null = null
  private frame = 0
  /** F and ⇧F: the drag that changes the radius or the strength, and what it started from. */
  private sizing: { kind: 'radius' | 'strength'; from: number; startX: number } | null = null

  constructor(deps: SculptToolDeps) {
    this.deps = deps
  }

  get active(): boolean {
    return this.stroking
  }

  get adjusting(): boolean {
    return this.sizing !== null
  }

  /** The mesh a session is open on, so the caller can tell whether it is still the right one. */
  get openOn(): string {
    return this.objectId
  }

  /** Whether the session's copy is still of this object, or the document has moved on without it. */
  matches(object: SceneObject, mesh: MeshData): boolean {
    return this.storedMesh === mesh && this.storedKeys === object.shapeKeys
  }

  /** Everything is thrown away: the mode changed, or the object did. */
  close(): void {
    this.session = null
    this.objectId = ''
    this.meshId = ''
    this.last = null
    this.stroking = false
    this.deps.viewport()?.transformOverlay?.setBrush(null, [0, 0, 1], 0)
  }

  /**
   * The brush cursor: where the ray meets the surface, and how wide the brush is there.
   *
   * Also the answer to "is the pointer on the model", which is what says whether a press starts a
   * stroke or turns the view.
   */
  hover(x: number, y: number, state: SculptState): boolean {
    const found = this.contact(x, y, state)
    const overlay = this.deps.viewport()?.transformOverlay
    if (!found) {
      overlay?.setBrush(null, [0, 0, 1], 0)
      this.deps.invalidate()
      return false
    }
    overlay?.setBrush(found.world, found.worldNormal, found.worldRadius)
    this.deps.invalidate()
    return true
  }

  /** A stroke begins. Returns false when the pointer is not on a mesh that can be sculpted. */
  begin(x: number, y: number, state: SculptState, pressure: number, modifiers: { invert: boolean; smoothing: boolean }): boolean {
    const found = this.contact(x, y, state)
    if (!found) return false
    this.state = state
    this.modifiers = modifiers
    if (!this.open(found.objectId)) return false
    this.stroking = true
    this.last = null
    this.session!.beginStroke()
    this.deps.beginGesture(strokeLabel(this.dab(0).brush))
    this.dabTo(found.local, found.localNormal, found.radius, pressure, found.view)
    this.push()
    return true
  }

  /** A pointer move during a stroke. The dab itself waits for the frame. */
  move(x: number, y: number, pressure: number): void {
    if (!this.stroking) return
    this.pending = { x, y, pressure }
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.flush()
    })
  }

  /** The stroke ends: the tree catches up, and the document learns about it once. */
  end(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
    }
    this.flush()
    this.pending = null
    if (!this.stroking || !this.session) {
      this.stroking = false
      return
    }
    this.stroking = false
    const stroke = this.session.endStroke()
    this.deps.viewport()?.sculptRefit(this.objectId)
    if (!stroke) {
      this.deps.endGesture(strokeLabel(this.dab(0).brush))
      return
    }
    const mesh = this.session.toMeshData()
    const meshId = this.meshId
    const objectId = this.objectId
    const intoKey = this.activeKey()
    if (intoKey) {
      /*
       * The stroke goes into the shape key rather than into the mesh.
       *
       * What the hand moved is the delta, and the key contributes `offset × value`, so the offset
       * has to grow by `delta ÷ value` for the surface to stay where the hand left it. This is the
       * one place the stroke's delta earns its keep: only the vertices that moved are written.
       */
      const amount = keyValue(intoKey.key)
      const offsets: Record<string, Vec3> = { ...intoKey.key.offsets }
      for (let index = 0; index < stroke.indices.length; index += 1) {
        const id = String(mesh.vertexIds[stroke.indices[index]!] ?? -1)
        const previous = offsets[id] ?? [0, 0, 0]
        offsets[id] = [
          previous[0] + (stroke.after[index * 3]! - stroke.before[index * 3]!) / amount,
          previous[1] + (stroke.after[index * 3 + 1]! - stroke.before[index * 3 + 1]!) / amount,
          previous[2] + (stroke.after[index * 3 + 2]! - stroke.before[index * 3 + 2]!) / amount,
        ]
      }
      const at = intoKey.index
      this.deps.applyDocument((current) => ({
        ...current,
        objects: current.objects.map((object) => (object.id === objectId && object.shapeKeys
          ? { ...object, shapeKeys: object.shapeKeys.map((key, index) => (index === at ? { ...key, offsets } : key)) }
          : object)),
      }))
      // The stored mesh has not moved; the keys have, so the session says it no longer knows which
      // ones it holds and is rebuilt on the next stroke against whatever the document now says.
      this.storedKeys = undefined
      this.session.rebase(mesh)
      this.deps.endGesture('Shape key')
      return
    }
    this.deps.applyDocument((current) => (current.meshes[meshId] ? withMesh(current, meshId, mesh) : current))
    // The session made this mesh, so it is still the session's own; without this the page would see
    // a mesh the session had never heard of and rebuild the whole thing between every two strokes.
    this.storedMesh = mesh
    this.session.rebase(mesh)
    this.deps.endGesture(strokeLabel(this.dab(0).brush))
  }

  /** F and ⇧F: the size and the strength, dragged rather than typed. */
  beginSizing(kind: 'radius' | 'strength', x: number, state: SculptState): void {
    this.sizing = { kind, from: kind === 'radius' ? state.size : state.strength, startX: x }
  }

  /** The value the drag has reached, or null when nothing is being dragged. */
  sizingValue(x: number): { kind: 'radius' | 'strength'; value: number } | null {
    const sizing = this.sizing
    if (!sizing) return null
    const travelled = (x - sizing.startX) / SIZE_PIXELS
    if (sizing.kind === 'radius') {
      return { kind: 'radius', value: Math.max(2, Math.min(500, sizing.from * (1 + travelled * 2))) }
    }
    return { kind: 'strength', value: Math.max(0, Math.min(2, sizing.from + travelled)) }
  }

  /** The value the drag started from, for an Escape that puts it back. */
  cancelSizing(): { kind: 'radius' | 'strength'; value: number } | null {
    const sizing = this.sizing
    this.sizing = null
    this.deps.hud.clear()
    return sizing ? { kind: sizing.kind, value: sizing.from } : null
  }

  endSizing(): void {
    this.sizing = null
    this.deps.hud.clear()
  }

  /**
   * The shape key a stroke would go into, if there is one.
   *
   * A key that is on is a key the brush is standing on: what is under the pointer is the mesh plus
   * that key, and putting the stroke into the mesh would move the surface twice as far as the hand
   * did. A key at nought cannot be written to at all — no offset times nought is a movement — and
   * that is said out loud rather than silently sculpting the mesh underneath it.
   */
  private activeKey(): { index: number; key: ShapeKey } | null {
    const document = this.deps.document()
    const object = document?.objects.find((candidate) => candidate.id === this.objectId)
    const keys = object?.shapeKeys
    if (!keys || keys.length === 0) return null
    const index = Math.min(keys.length - 1, Math.max(0, object?.activeShapeKey ?? 0))
    const key = keys[index]
    if (!key) return null
    if (Math.abs(keyValue(key)) <= 1e-6) {
      if (keysActive(keys)) this.deps.message(`Set “${key.name}” above nought to sculpt into it.`)
      return null
    }
    return { index, key }
  }

  /** The settings for one dab: what a person set, at the radius the brush has here. */
  private dab(radius: number) {
    return dabSettings(this.state, radius, this.modifiers)
  }

  /* ------------------------------------------------------------- the inside */

  private open(objectId: string): boolean {
    if (this.session && this.objectId === objectId) return true
    const document = this.deps.document()
    const object = document?.objects.find((candidate) => candidate.id === objectId)
    if (!document || !object || object.data.kind !== 'mesh') return false
    const mesh = meshOf(document, object)
    if (!mesh) return false
    /*
     * The brush touches what is drawn, and what is drawn is the mesh with its shape keys mixed in.
     * So the session opens on that, and where the stroke ends up — in the mesh or in a key — is
     * decided when the hand lets go.
     */
    this.storedMesh = mesh
    this.storedKeys = object.shapeKeys
    this.session = new SculptSession(shapedMesh(mesh, object.shapeKeys))
    this.objectId = objectId
    this.meshId = object.data.meshId
    return true
  }

  /**
   * Where the ray meets the surface, in both spaces.
   *
   * The radius arrives in pixels, as Blender's does, and is turned into the object's own units
   * where the brush actually is — so a brush stays the same size on screen as the view moves, which
   * is what a person sizing it against the model expects.
   */
  private contact(x: number, y: number, state: SculptState): {
    objectId: string
    world: Vec3
    worldNormal: Vec3
    worldRadius: number
    local: Vec3
    localNormal: Vec3
    radius: number
    view: Vec3
  } | null {
    const instance = this.deps.viewport()
    const document = this.deps.document()
    if (!instance || !document) return null
    const hit = instance.raycast(x, y)
    if (!hit) return null
    const object = document.objects.find((candidate) => candidate.id === hit.objectId)
    if (!object || object.data.kind !== 'mesh') return null
    const matrix = worldMatrix(document, object)
    const inverse = matrix.clone().invert()
    const local = localFromWorldPoint(matrix, hit.point)
    const worldRadius = instance.unitsPerPixelAt(hit.point) * state.size
    const localNormal = direction(hit.normal, inverse)
    const radius = worldRadius * scaleOf(matrix)
    const camera = cameraPosition(document.view)
    const toCamera: Vec3 = [camera[0] - hit.point[0], camera[1] - hit.point[1], camera[2] - hit.point[2]]
    return {
      objectId: hit.objectId,
      world: hit.point,
      worldNormal: hit.normal,
      worldRadius,
      local,
      localNormal,
      radius,
      view: direction([-toCamera[0], -toCamera[1], -toCamera[2]], inverse),
    }
  }

  /** The dabs between where the last one landed and where the pointer is now. */
  private flush(): void {
    const pending = this.pending
    this.pending = null
    if (!pending || !this.stroking || !this.session) return
    const found = this.contact(pending.x, pending.y, this.state)
    if (!found) return
    this.dabTo(found.local, found.localNormal, found.radius, pending.pressure, found.view)
    this.push()
  }

  /**
   * From the last dab to this point, at the brush's own spacing.
   *
   * The steps between are found by walking the straight line rather than by casting a ray for each,
   * which on a curved surface puts them slightly inside or outside it. At a quarter of the radius
   * apart that is a fraction of the brush's reach, and it is the difference between a stroke that
   * costs one raycast a frame and one that costs twelve.
   */
  private dabTo(point: Vec3, normal: Vec3, radius: number, pressure: number, view: Vec3): void {
    const session = this.session
    if (!session) return
    const settings = this.dab(radius)
    const from = this.last
    if (!from) {
      session.apply({ point, normal, view, pressure }, settings)
      this.last = [...point]
      return
    }
    const span = Math.hypot(point[0] - from[0], point[1] - from[1], point[2] - from[2])
    const steps = Math.max(1, Math.min(MAX_DABS, Math.round(span / Math.max(1e-6, radius * SPACING))))
    for (let step = 1; step <= steps; step += 1) {
      const at = step / steps
      session.apply({
        point: [
          from[0] + (point[0] - from[0]) * at,
          from[1] + (point[1] - from[1]) * at,
          from[2] + (point[2] - from[2]) * at,
        ],
        normal,
        view,
        pressure,
      }, settings)
    }
    this.last = [...point]
  }

  private push(): void {
    if (!this.session) return
    const instance = this.deps.viewport()
    instance?.sculptWrite(this.objectId, this.session.positions, this.session.normals)
    // Only when a mask is being painted: the wash is a whole extra pass over the drawn corners, and
    // a Draw stroke has not changed a single one of them.
    if (this.state.brush === 'mask') instance?.sculptWriteMask(this.objectId, this.session.mask)
  }
}

function strokeLabel(brush: string): string {
  return brush === 'mask' ? 'Mask' : brush === 'smooth' ? 'Smooth' : 'Sculpt'
}

/** A direction taken through a matrix, normalised: the movement of a point rather than the point. */
function direction(vector: Vec3, matrix: Matrix4): Vec3 {
  const found = new Vector3(vector[0], vector[1], vector[2]).transformDirection(matrix)
  return [found.x, found.y, found.z]
}

/**
 * How much wider a world unit is inside the object than outside it.
 *
 * A scaled object is sculpted in its own space, so a brush fifty pixels wide on screen is not fifty
 * pixels wide in the mesh. The average of the three scales is used rather than any one of them: an
 * object scaled twice as wide as it is tall gets a round brush that acts slightly oval, which is
 * what sculpting a scaled object does in Blender too.
 */
function scaleOf(matrix: Matrix4): number {
  const scale = new Vector3().setFromMatrixScale(matrix)
  const average = (scale.x + scale.y + scale.z) / 3
  return average > 1e-9 ? 1 / average : 1
}

export type { SculptState }
