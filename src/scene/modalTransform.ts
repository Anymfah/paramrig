import { localFromWorld, objectBounds, worldPosition, worldTransform } from '@/scene/objects'
import {
  beginTransform,
  cancelTransform,
  confirmTransform,
  transformChanged,
  transformLabel,
  transformOutput,
  updateTransform,
  type TransformMode,
  type TransformSession,
  type TransformTarget,
} from '@/scene/transform/session'
import type { AxisConstraint } from '@/scene/transform/constraints'
import type { ViewBasis } from '@/scene/transform/math'
import type { SceneDocument, SceneObject, SceneSelection, Vec3 } from '@/scene/types'
import { chipSide, type HudChannel } from '@/scene/viewport/hud'
import type { SceneViewport } from '@/scene/viewport/SceneViewport'
import type { TransformOverlay } from '@/scene/viewport/transformOverlay'
import { cameraBasis, fovFromFocalLength } from '@/scene/viewport/view'

/** The pivot for the current selection, without opening a session: what the gizmos are drawn at. */
export function selectionPivot(document: SceneDocument, selection: SceneSelection): Vec3 | null {
  const objects = document.objects.filter((object) => selection.objectIds.includes(object.id))
  if (objects.length === 0) return null
  const targets: TransformTarget[] = objects.map((object) => ({
    id: object.id,
    transform: worldTransform(document, object),
    centre: worldPosition(document, object),
    ...(objectBounds(document, object) ? { bounds: objectBounds(document, object)! } : {}),
  }))
  return pivotOf(document, targets, selection)
}

/**
 * G, R and S in the viewport.
 *
 * The arithmetic is `src/scene/transform/session.ts`, which knows nothing about a browser. This is
 * the part that does: it takes the pointer lock so the movement never stops at the edge of the
 * screen, draws the constraint axes and the measuring line, keeps the readout beside the pointer,
 * and turns the session's world-space answers back into the local transforms the document stores.
 *
 * One session is one entry in the history, and a session that never moved writes nothing at all.
 */

export type ModalTransformDeps = {
  viewport: () => SceneViewport | null
  document: () => SceneDocument | null
  selection: () => SceneSelection
  hud: HudChannel
  overlay: () => TransformOverlay | null
  /** Writes the transforms without recording; the gesture's single entry comes at the end. */
  apply: (patches: Array<{ id: string; patch: Partial<SceneObject> }>) => void
  beginGesture: (label: string) => void
  endGesture: (label: string) => void
  cancelGesture: () => void
  invalidate: () => void
  /** Where the pointer is now, in viewport pixels, when a session starts from the keyboard. */
  pointer: () => [number, number]
}

export class ModalTransform {
  private session: TransformSession | null = null
  private deps: ModalTransformDeps
  /** Where the drawn pointer is. Under pointer lock it moves by deltas and can leave the viewport. */
  private cursor: [number, number] = [0, 0]
  private locked = false
  private element: HTMLElement | null = null
  /** Whether the session was opened by dragging a handle, in which case letting go confirms it. */
  private fromDrag = false

  constructor(deps: ModalTransformDeps) {
    this.deps = deps
  }

  get active(): boolean {
    return this.session !== null
  }

  get mode(): TransformMode | null {
    return this.session?.mode ?? null
  }

  /** True while the running session belongs to a drag, so releasing the button confirms it. */
  get dragging(): boolean {
    return this.session !== null && this.fromDrag
  }

  /**
   * Opens a session on the current selection. Returns false — and changes nothing — when there is
   * nothing to move, so the caller can say why.
   */
  start(mode: TransformMode, element: HTMLElement | null, options: { pointer?: [number, number]; constraint?: AxisConstraint; fromDrag?: boolean } = {}): boolean {
    // Starting a second session over a running one would leave the first one's gesture open and
    // its history entry never written; the running one is cancelled rather than abandoned.
    if (this.session) this.cancel()
    const document = this.deps.document()
    const viewport = this.deps.viewport()
    if (!document || !viewport) return false
    const selection = this.deps.selection()
    const objects = document.objects.filter((object) => selection.objectIds.includes(object.id))
    if (objects.length === 0) return false

    const targets: TransformTarget[] = objects.map((object) => ({
      id: object.id,
      transform: worldTransform(document, object),
      centre: worldPosition(document, object),
      ...(objectBounds(document, object) ? { bounds: objectBounds(document, object)! } : {}),
    }))
    const pointer = options.pointer ?? this.deps.pointer()
    const pivot = pivotOf(document, targets, selection)
    const view = this.viewBasis(viewport, document, pivot)

    this.session = beginTransform({
      mode,
      targets,
      pivot: document.view.pivot,
      orientation: document.view.orientation,
      view,
      pointer,
      sceneCursor: document.cursor.position,
      activeId: selection.activeObjectId,
      units: document.units,
      snap: document.view.snapEnabled,
      ...(options.constraint ? { constraint: options.constraint } : {}),
    })
    this.cursor = pointer
    this.element = element
    this.fromDrag = !!options.fromDrag
    this.deps.beginGesture(transformLabel(this.session))
    this.locked = false
    /*
     * The pointer lock is what lets a rotation pass a full turn: the cursor is hidden and the
     * movement arrives as deltas that never run out of screen. It is asked for only when the
     * session starts from the keyboard — a drag already has the pointer captured, and taking the
     * cursor away in the middle of one would buy nothing.
     */
    if (!this.fromDrag && element && typeof element.requestPointerLock === 'function') {
      try {
        const request = element.requestPointerLock() as unknown
        if (request && typeof (request as Promise<void>).catch === 'function') (request as Promise<void>).catch(() => undefined)
        // Escape is the browser's way out of a pointer lock, and it keeps the key to itself. So
        // the lock going away *is* the cancel: whichever way the person leaves, the session ends
        // the same, and the transform goes back to where it started.
        //
        // `locked` is set by the event, never by the request. A browser may refuse a lock — Chrome
        // does for a few seconds after a person has pressed Escape out of one — and a session that
        // took the refusal for a loss would cancel itself the moment it opened.
        window.document.addEventListener('pointerlockchange', this.onLockChange)
        window.document.addEventListener('pointerlockerror', this.onLockError)
      } catch {
        this.locked = false
      }
    }
    this.draw()
    return true
  }

  /** A pointer move while a session is open. Under lock these are deltas, not positions. */
  move(input: { x: number; y: number; dx: number; dy: number; shift: boolean; ctrl: boolean; alt: boolean }): void {
    if (!this.session) return
    const viewport = this.deps.viewport()
    const size = viewport?.pixelSize ?? { width: 1, height: 1 }
    if (this.locked) {
      this.cursor = [this.cursor[0] + input.dx, this.cursor[1] + input.dy]
    } else {
      this.cursor = [input.x, input.y]
    }
    // The drawn cursor wraps at the edges, the way Blender's does, so a long sweep never ends.
    if (this.locked) {
      this.cursor = [wrap(this.cursor[0], size.width), wrap(this.cursor[1], size.height)]
    }
    this.session = updateTransform(this.session, {
      cursor: this.cursor,
      modifiers: { shift: input.shift, ctrl: input.ctrl, alt: input.alt },
    })
    this.draw()
  }

  /**
   * A key while a session is open. Returns true when the session consumed it, which is how the
   * page knows not to run whatever else that key does.
   */
  key(event: { key: string; code: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
    if (!this.session) return false
    if (event.metaKey || event.ctrlKey) return false
    if (event.key === 'Escape') {
      this.cancel()
      return true
    }
    if (event.key === 'Enter' || event.key === 'NumpadEnter') {
      this.confirm()
      return true
    }
    // A second R turns a rotation into a trackball turn, which is Blender's R R.
    if (this.session.mode === 'rotate' && event.code === 'KeyR') {
      const pointer = this.cursor
      this.restart('trackball', pointer)
      return true
    }
    const consumed = ['x', 'y', 'z', '-', '.', ',', '/', 'Tab', 'Backspace']
    const digit = event.key.length === 1 && event.key >= '0' && event.key <= '9'
    const letter = event.code === 'KeyX' ? 'x' : event.code === 'KeyY' ? 'y' : event.code === 'KeyZ' ? 'z' : null
    const key = letter ?? event.key
    if (!digit && !consumed.includes(key)) return false
    this.session = updateTransform(this.session, {
      cursor: this.cursor,
      modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey },
      key,
    })
    this.draw()
    return true
  }

  confirm(): void {
    const session = this.session
    if (!session) return
    const results = confirmTransform(session)
    this.write(results)
    const moved = transformChanged(session)
    this.close()
    // A press and release that moved nothing is not an edit, and leaves no step in the history.
    if (moved) this.deps.endGesture(transformLabel(session))
    else this.deps.cancelGesture()
  }

  cancel(): void {
    const session = this.session
    if (!session) return
    this.write(cancelTransform(session))
    this.close()
    this.deps.cancelGesture()
  }

  /** Starts the same selection over in another mode, keeping the pointer where it is. */
  private restart(mode: TransformMode, pointer: [number, number]): void {
    const session = this.session
    if (!session) return
    this.write(cancelTransform(session))
    const element = this.element
    this.session = null
    this.deps.cancelGesture()
    this.start(mode, element, { pointer })
  }

  private onLockChange = (): void => {
    if (!this.session) return
    if (window.document.pointerLockElement === this.element) {
      this.locked = true
      return
    }
    // Losing a lock the session actually held is how Escape reaches it; never having had one is
    // not, and the session carries on without the wrap.
    if (!this.locked) return
    this.locked = false
    this.cancel()
  }

  private onLockError = (): void => {
    this.locked = false
  }

  private close(): void {
    this.session = null
    this.fromDrag = false
    if (typeof window !== 'undefined') {
      window.document.removeEventListener('pointerlockchange', this.onLockChange)
      window.document.removeEventListener('pointerlockerror', this.onLockError)
    }
    this.deps.hud.clear()
    this.deps.overlay()?.clear()
    if (this.locked && typeof window !== 'undefined' && window.document.exitPointerLock) {
      window.document.exitPointerLock()
    }
    this.locked = false
    this.element = null
    this.deps.invalidate()
  }

  private write(results: Array<{ id: string; transform: import('@/scene/types').Transform }>): void {
    const document = this.deps.document()
    if (!document) return
    const patches = results.flatMap((result) => {
      const object = document.objects.find((entry) => entry.id === result.id)
      if (!object) return []
      return [{ id: result.id, patch: { transform: localFromWorld(document, object, result.transform) } }]
    })
    if (patches.length) this.deps.apply(patches)
  }

  private draw(): void {
    const session = this.session
    const viewport = this.deps.viewport()
    if (!session || !viewport) return
    const output = transformOutput(session)
    this.write(output.transforms)
    const size = viewport.pixelSize
    this.deps.hud.set({
      visible: true,
      text: output.hud,
      header: output.header,
      x: this.cursor[0],
      y: this.cursor[1],
      side: chipSide(this.cursor[0], size.width),
    })
    const overlay = this.deps.overlay()
    if (overlay) {
      const pivot = session.view.pivotScreen
      const world = viewport.unproject(pivot[0], pivot[1], 0.5)
      const reach = Math.max(20, (this.deps.document()?.view.distance ?? 10) * 20)
      overlay.setAxes(output.axes, world, reach)
      overlay.setMeasureLine(
        session.mode === 'move' ? null : world,
        session.mode === 'move' ? null : viewport.unproject(this.cursor[0], this.cursor[1], 0.5),
      )
    }
    this.deps.invalidate()
  }

  /** Everything the session needs to know about the camera, without handing it one. */
  private viewBasis(viewport: SceneViewport, document: SceneDocument, pivot: Vec3): ViewBasis {
    const basis = cameraBasis(document.view.yaw, document.view.pitch)
    const size = viewport.pixelSize
    const fov = (fovFromFocalLength(document.view.focalLength) * Math.PI) / 180
    const distance = document.view.projection === 'orthographic'
      ? document.view.distance
      : Math.max(1e-3, distanceAlong(basis.forward, viewport, pivot, document))
    const unitsPerPixel = (2 * Math.tan(fov / 2) * distance) / Math.max(1, size.height)
    const screen = viewport.project(pivot) ?? [size.width / 2, size.height / 2]
    return { right: basis.right, up: basis.up, forward: basis.forward, unitsPerPixel, pivotScreen: screen }
  }
}

/** How far the pivot is in front of the camera, which is the depth a pixel is measured at. */
function distanceAlong(forward: Vec3, viewport: SceneViewport, pivot: Vec3, document: SceneDocument): number {
  void viewport
  const camera = [
    document.view.target[0] - forward[0] * document.view.distance,
    document.view.target[1] - forward[1] * document.view.distance,
    document.view.target[2] - forward[2] * document.view.distance,
  ]
  return (pivot[0] - camera[0]!) * forward[0] + (pivot[1] - camera[1]!) * forward[1] + (pivot[2] - camera[2]!) * forward[2]
}

/** Where a transform turns and scales about, which is also where the gizmos are drawn. */
export function pivotOf(document: SceneDocument, targets: TransformTarget[], selection: SceneSelection): Vec3 {
  if (document.view.pivot === 'cursor') return document.cursor.position
  if (document.view.pivot === 'active') {
    const active = targets.find((target) => target.id === selection.activeObjectId)
    if (active) return active.centre
  }
  if (document.view.pivot === 'bounding-box') {
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (const target of targets) {
      const box = target.bounds ?? { min: target.centre, max: target.centre }
      for (let axis = 0; axis < 3; axis += 1) {
        if (box.min[axis]! < min[axis]!) min[axis] = box.min[axis]!
        if (box.max[axis]! > max[axis]!) max[axis] = box.max[axis]!
      }
    }
    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  }
  const sum: Vec3 = [0, 0, 0]
  for (const target of targets) {
    sum[0] += target.centre[0]
    sum[1] += target.centre[1]
    sum[2] += target.centre[2]
  }
  const count = Math.max(1, targets.length)
  return [sum[0] / count, sum[1] / count, sum[2] / count]
}

/** The drawn cursor comes back on the other side rather than stopping at the edge. */
function wrap(value: number, extent: number): number {
  if (extent <= 1) return value
  if (value < 0) return value + extent
  if (value > extent) return value - extent
  return value
}
