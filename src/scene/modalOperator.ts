import { getOperator, type OperatorParams } from '@/scene/operators'
import type { SceneDocument, SceneSelection, Vec3 } from '@/scene/types'
import { chipSide, type HudChannel } from '@/scene/viewport/hud'
import type { SceneViewport } from '@/scene/viewport/SceneViewport'

/**
 * The gesture behind E, I, ⌃B, ⌃R and the rest.
 *
 * Blender's modelling tools are all the same shape: a key opens them, the pointer drives one
 * number, the wheel drives a second, a few letters toggle their options, and Enter or a click keeps
 * the result while Escape or a right click throws it away. Written out once per operator that would
 * be eight variations on a theme, each with its own bugs; written here once, an operator says which
 * of its parameters the pointer drives and gets the whole gesture.
 *
 * Every frame is the operator run again from the document as it was when the gesture opened. That
 * is what makes the preview *be* the result rather than resemble it, and it is why the F9 panel
 * afterwards can replay the same call with a number typed in: there is only one implementation.
 */

/** How a pointer movement becomes a number. */
export type ModalDrive = {
  param: string
  /**
   * What the pointer is measuring. A distance is metres on screen; a factor is a share of a span
   * of pixels; a vector is a distance along a direction, which is what an extrusion moves along —
   * and X, Y and Z during the gesture swap that direction for a world axis, as Blender's do.
   */
  kind: 'distance' | 'factor' | 'vector'
  /** For 'factor': how many pixels reach a factor of one. */
  span?: number
  min?: number
  max?: number
  /** Which way the movement counts: away from where it started, or along the screen's x. */
  axis?: 'radial' | 'x' | 'y'
  /** For 'vector': the direction the distance is measured along when the gesture opens. */
  direction?: Vec3
}

/** A key pressed during the gesture, and what it does to a parameter. */
export type ModalKey = {
  code: string
  param: string
  label: string
  kind: 'toggle' | 'cycle' | 'step'
  values?: string[]
  step?: number
  min?: number
  max?: number
}

export type ModalSpec = {
  operatorId: string
  drive: ModalDrive
  /**
   * A first stage in which the pointer chooses *what* the operator is about rather than how much.
   *
   * A loop cut runs over the ring of the edge under the pointer, and Blender lets you move from
   * ring to ring before committing to one: nothing is cut, a preview is drawn, and the click both
   * chooses the ring and hands over to the slide. Without this the edge would be whichever one
   * happened to be under the pointer when the key went down.
   */
  choose?: { param: string; kind: 'edge' }
  /** The lines to draw while choosing, in world space, given the parameters as they stand. */
  preview?: (params: OperatorParams) => Vec3[][]
  /** The wheel's parameter — segments on a bevel, cuts on a loop cut. */
  wheel?: { param: string; step: number; min: number; max: number }
  keys?: ModalKey[]
  /** What the HUD chip says. Given the parameters as they stand. */
  readout: (params: OperatorParams) => string
  /** Extra parameters the caller fixes, which the pointer never touches. */
  fixed?: OperatorParams
}

export type ModalOperatorDeps = {
  viewport: () => SceneViewport | null
  document: () => SceneDocument | null
  selection: () => SceneSelection
  hud: HudChannel
  preview: (operatorId: string, params: OperatorParams, before: SceneDocument, selection: SceneSelection) => string | null
  commit: (operatorId: string, params: OperatorParams, before: SceneDocument, selection: SceneSelection) => string | null
  restore: (document: SceneDocument, selection: SceneSelection) => void
  message: (text: string | null) => void
  pointer: () => [number, number]
  /** The edge under a point, for the stage that chooses one. */
  edgeUnder?: (x: number, y: number) => number | null
  /** Draws the preview lines, in world space, or clears them with null. */
  showPreview?: (lines: Vec3[][] | null) => void
  /** The preference: whether Escape after an extrusion takes the new geometry away with it. */
  cancelRemovesExtrusion?: () => boolean
}

/** The operators whose gesture makes geometry before it moves it, which is what the preference is about. */
const EXTRUSIONS = new Set([
  'mesh.extrudeRegion',
  'mesh.extrudeEdges',
  'mesh.extrudeVertices',
  'mesh.extrudeManifold',
  'mesh.extrudeAlongNormals',
  'mesh.extrudeIndividual',
])

export class ModalOperator {
  private readonly deps: ModalOperatorDeps
  private spec: ModalSpec | null = null
  private params: OperatorParams = {}
  private before: SceneDocument | null = null
  private beforeSelection: SceneSelection = { objectIds: [], activeObjectId: null }
  private start: [number, number] = [0, 0]
  private cursor: [number, number] = [0, 0]
  private element: HTMLElement | null = null
  private locked = false
  private fromDrag = false
  private precise = false
  /** The direction a vector drive is measuring along; X, Y and Z replace it during the gesture. */
  private direction: Vec3 = [0, 0, 1]
  private axisName: string | null = null
  /** 'choose' picks what the operator is about; 'adjust' drives its number. */
  private stage: 'choose' | 'adjust' = 'adjust'

  constructor(deps: ModalOperatorDeps) {
    this.deps = deps
  }

  get running(): boolean {
    return this.spec !== null
  }

  get operatorId(): string | null {
    return this.spec?.operatorId ?? null
  }

  /**
   * Opens a gesture. False — and nothing changed — when the operator would refuse anyway, so the
   * caller can put the reason in the status bar instead of leaving a tool that does nothing open.
   */
  begin(spec: ModalSpec, element: HTMLElement | null, options: { pointer?: [number, number]; fromDrag?: boolean } = {}): boolean {
    if (this.spec) this.cancel()
    const document = this.deps.document()
    const operator = getOperator(spec.operatorId)
    if (!document || !operator) return false
    this.spec = spec
    this.before = document
    this.beforeSelection = this.deps.selection()
    this.params = { ...operator.defaults, ...(spec.fixed ?? {}) }
    this.start = options.pointer ?? this.deps.pointer()
    this.cursor = this.start
    this.element = element
    this.fromDrag = !!options.fromDrag
    this.locked = false
    this.precise = false
    this.direction = spec.drive.direction ?? [0, 0, 1]
    this.axisName = null
    this.stage = spec.choose ? 'choose' : 'adjust'
    if (spec.choose) {
      const edge = this.deps.edgeUnder?.(this.start[0], this.start[1]) ?? null
      if (edge !== null) this.params = { ...this.params, [spec.choose.param]: edge }
    }
    if (!this.fromDrag && element && typeof element.requestPointerLock === 'function') {
      try {
        const request = element.requestPointerLock() as unknown
        if (request && typeof (request as Promise<void>).catch === 'function') (request as Promise<void>).catch(() => undefined)
        window.document.addEventListener('pointerlockchange', this.onLockChange)
      } catch {
        this.locked = false
      }
    }
    this.apply()
    return true
  }

  move(input: { x: number; y: number; dx: number; dy: number; shift: boolean }): void {
    const spec = this.spec
    if (!spec) return
    this.precise = input.shift
    if (this.locked) this.cursor = [this.cursor[0] + input.dx, this.cursor[1] + input.dy]
    else this.cursor = [input.x, input.y]
    if (this.stage === 'choose' && spec.choose) {
      // Nothing is done yet: the pointer is choosing which edge, and the preview follows it.
      const edge = this.deps.edgeUnder?.(input.x, input.y) ?? null
      if (edge !== null) this.params = { ...this.params, [spec.choose.param]: edge }
      this.apply()
      return
    }
    this.params = { ...this.params, [spec.drive.param]: this.drivenValue() }
    this.apply()
  }

  /** The wheel, which is how a bevel gains a segment and a loop cut gains a loop. */
  wheel(delta: number): boolean {
    const spec = this.spec
    if (!spec?.wheel) return false
    const current = Number(this.params[spec.wheel.param] ?? spec.wheel.min)
    const next = Math.max(spec.wheel.min, Math.min(spec.wheel.max, current + (delta < 0 ? spec.wheel.step : -spec.wheel.step)))
    if (next === current) return true
    this.params = { ...this.params, [spec.wheel.param]: next }
    this.apply()
    return true
  }

  /** A key during the gesture. True when it was one of ours. */
  key(event: { key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
    const spec = this.spec
    if (!spec) return false
    if (event.key === 'Escape') {
      this.cancel()
      return true
    }
    if (event.key === 'Enter' || event.key === 'NumpadEnter') {
      this.confirm()
      return true
    }
    if (event.metaKey || event.ctrlKey) return false
    if (spec.drive.kind === 'vector' && (event.code === 'KeyX' || event.code === 'KeyY' || event.code === 'KeyZ')) {
      const axis = event.code === 'KeyX' ? 0 : event.code === 'KeyY' ? 1 : 2
      const name = event.code.slice(3)
      // Pressing the same axis again goes back to the direction the gesture opened along, which is
      // how Blender lets an extrusion leave its normal and come back to it.
      if (this.axisName === name) {
        this.direction = spec.drive.direction ?? [0, 0, 1]
        this.axisName = null
      } else {
        this.direction = axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1]
        this.axisName = name
      }
      this.params = { ...this.params, [spec.drive.param]: this.drivenValue() }
      this.apply()
      return true
    }
    const binding = spec.keys?.find((entry) => entry.code === event.code)
    if (binding) {
      this.params = { ...this.params, [binding.param]: this.pressed(binding) }
      this.apply()
      return true
    }
    // A digit types the number the pointer was dragging, which is how Blender takes an exact width.
    if (event.key.length === 1 && ((event.key >= '0' && event.key <= '9') || event.key === '.' || event.key === '-')) {
      const typed = `${this.typing}${event.key}`
      this.typing = typed
      const value = Number(typed)
      if (Number.isFinite(value)) {
        this.params = {
          ...this.params,
          [spec.drive.param]: spec.drive.kind === 'vector' ? this.along(value) : value,
        }
        this.apply()
      }
      return true
    }
    if (event.key === 'Backspace' && this.typing.length > 0) {
      this.typing = this.typing.slice(0, -1)
      const typed = this.typing.length > 0 ? Number(this.typing) : 0
      const value = Number.isFinite(typed) ? typed : 0
      this.params = { ...this.params, [spec.drive.param]: spec.drive.kind === 'vector' ? this.along(value) : value }
      this.apply()
      return true
    }
    return false
  }

  confirm(): void {
    const spec = this.spec
    const before = this.before
    if (!spec || !before) return
    if (this.stage === 'choose') {
      // The first click settles what the operator is about and hands over to the number, measured
      // from where that click landed rather than from where the key was pressed.
      this.stage = 'adjust'
      this.start = this.cursor
      this.deps.showPreview?.(null)
      this.apply()
      return
    }
    const params = this.params
    this.close()
    const error = this.deps.commit(spec.operatorId, params, before, this.beforeSelection)
    if (error) this.deps.message(error)
  }

  cancel(): void {
    const before = this.before
    const spec = this.spec
    const params = this.params
    this.close()
    if (!spec || !before) return
    this.deps.restore(before, this.beforeSelection)
    if (this.deps.cancelRemovesExtrusion?.() !== false || !EXTRUSIONS.has(spec.operatorId)) return
    /*
     * Blender's preference, off: escaping an extrusion keeps the geometry it made and leaves it
     * where it started, so the new faces are there to be moved afterwards. On — the default — the
     * restore above is the whole of it, and the extrusion goes with the gesture.
     */
    const offset = ModalOperator.zeroOf(params.offset)
    const error = this.deps.commit(spec.operatorId, { ...params, offset }, before, this.beforeSelection)
    if (error) this.deps.message(error)
  }

  /** The same shape as the offset the gesture was driving, at nothing. */
  private static zeroOf(value: OperatorParams[string] | undefined): OperatorParams[string] {
    return Array.isArray(value) ? value.map(() => 0) : 0
  }

  private typing = ''

  private close(): void {
    this.spec = null
    this.before = null
    this.typing = ''
    this.stage = 'adjust'
    this.deps.showPreview?.(null)
    this.deps.hud.set({ visible: false, text: '', header: '', x: 0, y: 0, side: 'right' })
    window.document.removeEventListener('pointerlockchange', this.onLockChange)
    if (this.locked && typeof window.document.exitPointerLock === 'function') window.document.exitPointerLock()
    this.locked = false
    this.element = null
  }

  private onLockChange = (): void => {
    if (!this.spec) return
    if (window.document.pointerLockElement === this.element) {
      this.locked = true
      return
    }
    // A refusal is not a loss: the browser turns a lock down for a few seconds after Escape, and a
    // gesture that took that for the pointer being freed would cancel itself the moment it opened.
    if (!this.locked) return
    this.locked = false
    this.cancel()
  }

  /** What the pointer is asking for: a number, or a distance along the drive's direction. */
  private drivenValue(): number | Vec3 {
    const spec = this.spec
    if (!spec) return 0
    const distance = this.driven()
    return spec.drive.kind === 'vector' ? this.along(distance) : distance
  }

  private along(distance: number): Vec3 {
    return [this.direction[0] * distance, this.direction[1] * distance, this.direction[2] * distance]
  }

  /** The number the pointer is asking for, in the parameter's own units. */
  private driven(): number {
    const spec = this.spec
    if (!spec) return 0
    const dx = this.cursor[0] - this.start[0]
    const dy = this.cursor[1] - this.start[1]
    const pixels = spec.drive.axis === 'x' ? dx : spec.drive.axis === 'y' ? -dy : Math.hypot(dx, dy) * Math.sign(dx + -dy || 1)
    const slowed = this.precise ? pixels * 0.1 : pixels
    let value: number
    if (spec.drive.kind === 'factor') value = slowed / (spec.drive.span ?? 200)
    else value = slowed * this.metresPerPixel()
    if (spec.drive.min !== undefined) value = Math.max(spec.drive.min, value)
    if (spec.drive.max !== undefined) value = Math.min(spec.drive.max, value)
    return value
  }

  /** How much of the world one pixel covers where the gesture is happening. */
  private metresPerPixel(): number {
    const viewport = this.deps.viewport()
    const document = this.deps.document()
    if (!viewport || !document) return 0.01
    return viewport.unitsPerPixelAt(document.view.target)
  }

  private pressed(binding: ModalKey): OperatorParams[string] {
    const current = this.params[binding.param]
    if (binding.kind === 'toggle') return current !== true
    if (binding.kind === 'step') {
      const value = Number(current ?? 0) + (binding.step ?? 1)
      const min = binding.min ?? Number.NEGATIVE_INFINITY
      const max = binding.max ?? Number.POSITIVE_INFINITY
      return Math.max(min, Math.min(max, value))
    }
    const values = binding.values ?? []
    if (values.length === 0) return current ?? null
    const at = values.indexOf(String(current))
    return values[(at + 1) % values.length]!
  }

  /** Runs the operator again and draws where the gesture stands. */
  private apply(): void {
    const spec = this.spec
    const before = this.before
    if (!spec || !before) return
    if (this.stage === 'choose') {
      // The mesh is left alone and the lines are drawn over it: a preview of a cut that has not
      // happened is the whole point of the stage.
      this.deps.showPreview?.(spec.preview ? spec.preview(this.params) : null)
    } else {
      const error = this.deps.preview(spec.operatorId, this.params, before, this.beforeSelection)
      this.deps.message(error)
    }
    const viewport = this.deps.viewport()
    const size = viewport?.pixelSize ?? { width: 1, height: 1 }
    this.deps.hud.set({
      visible: true,
      text: spec.readout(this.params),
      header: this.header(),
      x: this.cursor[0],
      y: this.cursor[1],
      side: chipSide(this.cursor[0], size.width),
    })
  }

  /** The modal header: what the gesture is, and every key that does something while it runs. */
  private header(): string {
    const spec = this.spec
    if (!spec) return ''
    const operator = getOperator(spec.operatorId)
    const parts = [operator?.label ?? spec.operatorId, spec.readout(this.params)]
    if (this.stage === 'choose') {
      return `${operator?.label ?? spec.operatorId}  ${spec.readout(this.params)} | Move to choose · Click to cut · Escape cancel`
    }
    const keys = (spec.keys ?? []).map((entry) => `${keyName(entry.code)} ${entry.label}`)
    if (spec.drive.kind === 'vector') keys.push(this.axisName ? `${this.axisName} axis, again to free` : 'X Y Z axis')
    if (spec.wheel) keys.push(`Wheel ${spec.wheel.param}`)
    keys.push('⇧ precise', 'Enter confirm', 'Escape cancel')
    return `${parts.filter(Boolean).join('  ')} | ${keys.join(' · ')}`
  }
}

/** `KeyC` reads as C, `Digit2` as 2: what a header should print for a physical key. */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`
  return code
}
