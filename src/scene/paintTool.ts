import { surfaceContact, walkDabs } from '@/scene/brushContact'
import { meshOf, withMesh } from '@/scene/model'
import { colourDomain } from '@/scene/paint/attribute'
import { PaintSession, paintSettings, rgbOf } from '@/scene/paint/session'
import type { HudChannel } from '@/scene/viewport/hud'
import type { SceneViewport } from '@/scene/viewport/SceneViewport'
import type { MeshData, PaintState, SceneDocument, SceneObject, Vec3 } from '@/scene/types'

/**
 * Vertex painting, from the pointer to the mesh.
 *
 * The sculpt tool's twin, and deliberately its twin: the ray, the radius in pixels, the walk from
 * the last dab and the once-per-stroke write into the document are the same, and they are shared in
 * `brushContact`. What differs is what a dab does, and where the answer goes — a colour attribute
 * rather than the positions.
 */

export type PaintToolDeps = {
  viewport: () => SceneViewport | null
  document: () => SceneDocument | null
  hud: HudChannel
  applyDocument: (edit: (current: SceneDocument) => SceneDocument) => void
  beginGesture: (label: string) => void
  endGesture: (label: string) => void
  invalidate: () => void
  message: (text: string) => void
}

/** How many pixels of drag change the radius by its whole value, when F is held. */
const SIZE_PIXELS = 200

export class PaintTool {
  private deps: PaintToolDeps
  private session: PaintSession | null = null
  private objectId = ''
  private meshId = ''
  private storedMesh: MeshData | null = null
  private last: Vec3 | null = null
  private stroking = false
  private state: PaintState | null = null
  private modifiers = { invert: false, smoothing: false }
  private pending: { x: number; y: number; pressure: number } | null = null
  private frame = 0
  private sizing: { kind: 'radius' | 'strength'; from: number; startX: number } | null = null

  constructor(deps: PaintToolDeps) {
    this.deps = deps
  }

  get active(): boolean {
    return this.stroking
  }

  get adjusting(): boolean {
    return this.sizing !== null
  }

  get openOn(): string {
    return this.objectId
  }

  /** Whether the session's copy is still of this object, or the document has moved on without it. */
  matches(_object: SceneObject, mesh: MeshData): boolean {
    return this.storedMesh === mesh
  }

  close(): void {
    this.session = null
    this.objectId = ''
    this.meshId = ''
    this.last = null
    this.stroking = false
    this.deps.viewport()?.transformOverlay?.setBrush(null, [0, 0, 1], 0)
  }

  /** The brush cursor, and the answer to "is the pointer on a model". */
  hover(x: number, y: number, state: PaintState): boolean {
    const found = surfaceContact(this.deps.viewport(), this.deps.document(), x, y, state.size)
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

  begin(x: number, y: number, state: PaintState, pressure: number, modifiers: { invert: boolean; smoothing: boolean }): boolean {
    const found = surfaceContact(this.deps.viewport(), this.deps.document(), x, y, state.size)
    if (!found) return false
    this.state = state
    this.modifiers = modifiers
    if (!this.open(found.objectId, state)) return false
    this.stroking = true
    this.last = null
    this.session!.beginStroke()
    this.deps.beginGesture('Paint')
    this.dabTo(found.local, found.localNormal, found.radius, pressure)
    this.push()
    return true
  }

  move(x: number, y: number, pressure: number): void {
    if (!this.stroking) return
    this.pending = { x, y, pressure }
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.flush()
    })
  }

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
    const changed = this.session.endStroke()
    if (!changed) {
      this.deps.endGesture('Paint')
      return
    }
    this.write()
    this.deps.endGesture('Paint')
  }

  /** Every value set to one colour: Blender's ⇧K, which paints the whole mesh at once. */
  fill(objectId: string, state: PaintState, colour?: string): boolean {
    if (!this.open(objectId, state)) return false
    this.deps.beginGesture('Fill colour')
    this.session!.fill(rgbOf(colour ?? state.colour))
    this.write()
    this.deps.endGesture('Fill colour')
    return true
  }

  beginSizing(kind: 'radius' | 'strength', x: number, state: PaintState): void {
    this.sizing = { kind, from: kind === 'radius' ? state.size : state.strength, startX: x }
  }

  sizingValue(x: number): { kind: 'radius' | 'strength'; value: number } | null {
    const sizing = this.sizing
    if (!sizing) return null
    const travelled = (x - sizing.startX) / SIZE_PIXELS
    if (sizing.kind === 'radius') {
      return { kind: 'radius', value: Math.max(2, Math.min(500, sizing.from * (1 + travelled * 2))) }
    }
    return { kind: 'strength', value: Math.max(0, Math.min(2, sizing.from + travelled)) }
  }

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

  /* ------------------------------------------------------------- the inside */

  private open(objectId: string, state: PaintState): boolean {
    if (this.session && this.objectId === objectId) return true
    const document = this.deps.document()
    const object = document?.objects.find((candidate) => candidate.id === objectId)
    if (!document || !object || object.data.kind !== 'mesh') return false
    const mesh = meshOf(document, object)
    if (!mesh) return false
    /*
     * A mesh that already carries a colour is painted on the domain it carries it on: switching
     * domains under a person's hand would throw away what they had painted, and the Data panel is
     * where that choice is made deliberately.
     */
    this.storedMesh = mesh
    this.session = new PaintSession(mesh, colourDomain(mesh) ?? state.domain)
    this.objectId = objectId
    this.meshId = object.data.meshId
    return true
  }

  private write(): void {
    const session = this.session
    if (!session) return
    const mesh = session.toMeshData()
    const meshId = this.meshId
    this.deps.applyDocument((current) => (current.meshes[meshId] ? withMesh(current, meshId, mesh) : current))
    // The session made this mesh, so the page must not read it as somebody else's and rebuild.
    this.storedMesh = mesh
    session.rebase(mesh)
  }

  private flush(): void {
    const pending = this.pending
    this.pending = null
    if (!pending || !this.stroking || !this.session || !this.state) return
    const found = surfaceContact(this.deps.viewport(), this.deps.document(), pending.x, pending.y, this.state.size)
    if (!found) return
    this.dabTo(found.local, found.localNormal, found.radius, pending.pressure)
    this.push()
  }

  private dabTo(point: Vec3, normal: Vec3, radius: number, pressure: number): void {
    const session = this.session
    if (!session || !this.state) return
    const settings = paintSettings(this.state, radius, this.modifiers)
    walkDabs(this.last, point, radius, (at) => session.apply({ point: at, normal, pressure }, settings))
    this.last = [...point]
  }

  private push(): void {
    if (!this.session) return
    this.deps.viewport()?.paintWrite(this.objectId, this.session.cornerColours())
  }
}

export type { PaintState }
