import type { ScenePreferences } from '@/scene/prefs'
import type { Vec3, ViewState } from '@/scene/types'
import {
  AXIS_VIEWS,
  clampPitch,
  dampAngle,
  damp,
  dampVec3,
  frameBox,
  fovFromFocalLength,
  isAxisView,
  orthoHeight,
  wrapYaw,
  zoomDistance,
  zoomToPoint,
  type AxisView,
  type Box,
} from '@/scene/viewport/view'

/**
 * Orbit, pan and zoom, written for this editor rather than taken from `OrbitControls`.
 *
 * `OrbitControls` is a demo helper: it owns the camera, it runs its own loop, it has no notion of
 * a document's saved view, and its zoom steps in fixed multiples of a wheel notch. What a modelling
 * viewport needs is different and specific — the point under the pointer must stay under the
 * pointer while zooming, an axis view must be exact and switch the projection, an orbit must damp
 * over about a tenth of a second and then stop asking for frames, and none of it may travel
 * through React at pointer rate.
 *
 * So the navigator keeps the live view itself. Every change is pushed straight at the viewport;
 * the document only hears about it when the gesture settles, which is the one moment a re-render
 * costs nothing.
 */

export type NavigatorCallbacks = {
  /** Called at pointer rate: draw this. */
  apply: (view: ViewState) => void
  /** Called when the movement has settled: store this. */
  commit: (view: ViewState) => void
  /** The world point under a pixel, when there is geometry there; used to zoom towards it. */
  depthAt?: (x: number, y: number) => Vec3 | null
  /** The box to frame, for Home and for the full-scene framing. */
  boundsOf?: (which: 'all' | 'selection') => Box | null
  /** The viewport's size in CSS pixels; pan speed and framing both need it. */
  size: () => { width: number; height: number }
}

export type NavigationGesture = 'orbit' | 'pan' | 'zoom' | null

const ORBIT_TAU = 120
/** How long a view change takes when the preferences say nothing. Blender's own default. */
const TRANSITION_MS = 200
const ORBIT_DEGREES_PER_PIXEL = 0.4
const TRACKBALL_DEGREES_PER_PIXEL = 0.35

export class ViewNavigator {
  private view: ViewState
  /** Where the view is heading; the drawn view damps towards it. */
  private target: { yaw: number; pitch: number; distance: number; centre: Vec3 }
  private preferences: ScenePreferences
  private callbacks: NavigatorCallbacks
  private gesture: NavigationGesture = null
  private pointerId: number | null = null
  private last: [number, number] = [0, 0]
  private moved = false
  private animating = false
  private lastTick = 0
  private transition: {
    until: number
    /** How long this one lasts: the preference at the moment it started, not the constant. */
    length: number
    from: { yaw: number; pitch: number; distance: number; centre: Vec3 }
    projection: ViewState['projection']
  } | null = null
  private commitTimer: ReturnType<typeof setTimeout> | null = null
  /** Set once a real middle button has been seen; the ⌥ emulation then steps aside. */
  private sawMiddleButton = false

  constructor(view: ViewState, preferences: ScenePreferences, callbacks: NavigatorCallbacks) {
    this.view = { ...view }
    this.preferences = preferences
    this.callbacks = callbacks
    this.target = { yaw: view.yaw, pitch: view.pitch, distance: view.distance, centre: [...view.target] }
  }

  setPreferences(preferences: ScenePreferences): void {
    this.preferences = preferences
  }

  /**
   * Adopts a view asked for from elsewhere. Anything that is not the camera — the projection, the
   * overlays, the mode — is taken at once; the four numbers that place the camera are travelled to,
   * so a menu entry and a keystroke move the view the same way a drag does.
   */
  adopt(view: ViewState): void {
    const cameraMoved = view.yaw !== this.target.yaw
      || view.pitch !== this.target.pitch
      || view.distance !== this.target.distance
      || view.target.some((value, index) => value !== this.target.centre[index])
    // Everything that is not the camera — the projection, the shading, the overlays — is taken at
    // once; the four numbers that place the camera stay with the damping until it has arrived.
    this.view = {
      ...view,
      yaw: this.view.yaw,
      pitch: this.view.pitch,
      distance: this.view.distance,
      target: this.view.target,
    }
    if (!cameraMoved) {
      this.push()
      return
    }
    this.moveTo({ yaw: view.yaw, pitch: view.pitch, distance: view.distance, centre: [...view.target] }, { animate: true })
  }

  /** Adopts a view without travelling to it: a document opening, or an undo. */
  setView(view: ViewState): void {
    this.view = { ...view }
    this.target = { yaw: view.yaw, pitch: view.pitch, distance: view.distance, centre: [...view.target] }
    this.transition = null
    this.animating = false
  }

  get current(): ViewState {
    return this.view
  }

  get active(): NavigationGesture {
    return this.gesture
  }

  get isAnimating(): boolean {
    return this.animating || this.transition !== null
  }

  /* ------------------------------------------------------------- gestures */

  /**
   * Which navigation gesture a press starts, if any.
   *
   * Blender's middle button is the whole of viewport navigation, and a trackpad has no middle
   * button; the ⌥ emulation exists for that and steps aside the moment a real one is used, so a
   * mouse user never loses ⌥-click to the camera.
   */
  gestureFor(event: { button: number; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): NavigationGesture {
    if (event.button === 1) {
      this.sawMiddleButton = true
      return event.shiftKey ? 'pan' : event.ctrlKey ? 'zoom' : 'orbit'
    }
    if (event.button !== 0) return null
    if (!event.altKey) return null
    if (!this.preferences.emulateThreeButton && this.sawMiddleButton) return null
    return event.shiftKey ? 'pan' : event.ctrlKey ? 'zoom' : 'orbit'
  }

  begin(gesture: NavigationGesture, pointerId: number, x: number, y: number): void {
    this.clearCommit()
    this.gesture = gesture
    this.pointerId = pointerId
    // The gesture starts from where the press landed, not from the first move, so nothing jumps.
    this.last = [x, y]
    this.moved = false
    this.transition = null
  }

  move(x: number, y: number): void {
    if (!this.gesture) return
    const dx = x - this.last[0]
    const dy = y - this.last[1]
    this.last = [x, y]
    if (dx === 0 && dy === 0) return
    this.moved = true
    if (this.gesture === 'orbit') this.orbit(dx, dy)
    else if (this.gesture === 'pan') this.pan(dx, dy)
    else this.zoomBy(dy * 4)
  }

  end(): boolean {
    const moved = this.moved
    this.gesture = null
    this.pointerId = null
    this.moved = false
    if (moved) this.scheduleCommit()
    return moved
  }

  get capturedPointer(): number | null {
    return this.pointerId
  }

  orbit(dx: number, dy: number): void {
    this.scheduleCommit()
    const speed = this.preferences.orbitStyle === 'trackball' ? TRACKBALL_DEGREES_PER_PIXEL : ORBIT_DEGREES_PER_PIXEL
    this.target.yaw = wrapYaw(this.target.yaw - dx * speed)
    this.target.pitch = clampPitch(this.target.pitch + dy * speed)
    // Leaving an axis view by hand means the user wants to look around, which is a perspective act.
    if (this.preferences.autoPerspective && this.view.projection === 'orthographic' && !isAxisView(this.target.yaw, this.target.pitch)) {
      this.view = { ...this.view, projection: 'perspective' }
    }
    this.animating = true
    this.tickSoon()
  }

  pan(dx: number, dy: number): void {
    this.scheduleCommit()
    const height = this.viewHeight()
    const perPixel = height / Math.max(1, this.viewportHeight())
    const { right, up } = basisOf(this.target.yaw, this.target.pitch)
    this.target.centre = [
      this.target.centre[0] - right[0] * dx * perPixel + up[0] * dy * perPixel,
      this.target.centre[1] - right[1] * dx * perPixel + up[1] * dy * perPixel,
      this.target.centre[2] - right[2] * dx * perPixel + up[2] * dy * perPixel,
    ]
    this.animating = true
    this.tickSoon()
  }

  /**
   * The wheel. Zoom is continuous and multiplicative, and — this is the part that has to be exact —
   * the world point under the pointer stays under the pointer, so a wheel is a way of moving
   * towards something rather than a way of making things bigger.
   */
  wheel(event: { deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey: boolean }, x: number, y: number): void {
    // A trackpad reports pixels, a wheel reports lines; a line is worth about sixteen pixels.
    const raw = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY
    this.zoomBy(this.preferences.invertZoomWheel ? -raw : raw, x, y)
  }

  zoomBy(delta: number, x?: number, y?: number): void {
    this.scheduleCommit()
    const before = this.target.distance
    const after = zoomDistance(before, delta, { min: 1e-3, max: 1e5 })
    if (this.preferences.zoomToMouse && x !== undefined && y !== undefined) {
      const point = this.callbacks.depthAt?.(x, y)
      if (point) this.target.centre = zoomToPoint(this.target.centre, point, before, after)
    }
    this.target.distance = after
    this.animating = true
    this.tickSoon()
  }

  /**
   * Two fingers on a trackpad.
   *
   * Blender orbits with them and pans with ⇧, which is what a modeller expects; macOS means two
   * fingers as a scroll, which is a pan. Both are right, so which one it is is a preference — and
   * the modifier swaps them either way, so neither habit loses a gesture.
   */
  trackpad(dx: number, dy: number, modifiers: { shift: boolean; ctrl: boolean }): void {
    if (modifiers.ctrl) {
      this.zoomBy(this.preferences.invertZoomWheel ? -dy * 3 : dy * 3)
      return
    }
    const pans = this.preferences.trackpadNatural ? !modifiers.shift : modifiers.shift
    if (pans) this.pan(dx, dy)
    else this.orbit(dx, dy)
  }

  /* ---------------------------------------------------------------- views */

  toAxis(axis: AxisView, options: { animate?: boolean } = {}): void {
    const angles = AXIS_VIEWS[axis]
    this.moveTo({ yaw: angles.yaw, pitch: angles.pitch }, options)
    if (this.preferences.autoPerspective) this.view = { ...this.view, projection: 'orthographic' }
  }

  /** Numpad 9: the view from the exact opposite side. */
  toOpposite(options: { animate?: boolean } = {}): void {
    this.moveTo({ yaw: wrapYaw(this.target.yaw + 180), pitch: -this.target.pitch }, options)
  }

  /** Numpad 2/4/6/8: a step of fifteen degrees, which is how a keyboard orbits. */
  step(direction: 'up' | 'down' | 'left' | 'right', degrees = 15): void {
    const yaw = direction === 'left' ? degrees : direction === 'right' ? -degrees : 0
    const pitch = direction === 'up' ? degrees : direction === 'down' ? -degrees : 0
    this.moveTo({ yaw: wrapYaw(this.target.yaw + yaw), pitch: clampPitch(this.target.pitch + pitch) }, { animate: true })
  }

  toggleProjection(): void {
    this.view = { ...this.view, projection: this.view.projection === 'perspective' ? 'orthographic' : 'perspective' }
    this.push()
    this.scheduleCommit()
  }

  frame(which: 'all' | 'selection', options: { animate?: boolean } = {}): boolean {
    const box = this.callbacks.boundsOf?.(which)
    if (!box) return false
    const framed = frameBox(box, { fovDegrees: fovFromFocalLength(this.view.focalLength), aspect: aspectOf(this.callbacks.size()) })
    this.moveTo({ centre: framed.target, distance: framed.distance }, options)
    return true
  }

  moveTo(to: Partial<{ yaw: number; pitch: number; distance: number; centre: Vec3 }>, options: { animate?: boolean } = {}): void {
    this.clearCommit()
    const from = { ...this.target, centre: [...this.target.centre] as Vec3 }
    this.target = {
      yaw: to.yaw ?? this.target.yaw,
      pitch: to.pitch ?? this.target.pitch,
      distance: to.distance ?? this.target.distance,
      centre: to.centre ? [...to.centre] : this.target.centre,
    }
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const length = this.preferences.smoothViewMs ?? TRANSITION_MS
    if (options.animate === false || reduced || length <= 0) {
      this.view = this.destination()
      this.transition = null
      this.animating = false
      this.push()
      this.scheduleCommit()
      return
    }
    this.transition = { until: now() + length, length, from, projection: this.view.projection }
    this.animating = true
    this.tickSoon()
  }

  /* --------------------------------------------------------------- ticking */

  /** One step of damping. Returns true while there is more to do. */
  tick(timestamp = now()): boolean {
    if (!this.animating && !this.transition) return false
    const delta = this.lastTick === 0 ? 16 : Math.min(64, timestamp - this.lastTick)
    this.lastTick = timestamp
    if (this.transition) {
      const remaining = this.transition.until - timestamp
      if (remaining <= 0) {
        this.view = this.destination()
        this.transition = null
        this.animating = false
        this.push()
        this.scheduleCommit()
        return false
      }
      const t = 1 - remaining / this.transition.length
      const eased = t * t * (3 - 2 * t)
      const from = this.transition.from
      this.view = {
        ...this.view,
        yaw: from.yaw + wrapYaw(this.target.yaw - from.yaw) * eased,
        pitch: from.pitch + (this.target.pitch - from.pitch) * eased,
        distance: from.distance + (this.target.distance - from.distance) * eased,
        target: [
          from.centre[0] + (this.target.centre[0] - from.centre[0]) * eased,
          from.centre[1] + (this.target.centre[1] - from.centre[1]) * eased,
          from.centre[2] + (this.target.centre[2] - from.centre[2]) * eased,
        ],
      }
      this.push()
      return true
    }
    const yaw = dampAngle(this.view.yaw, this.target.yaw, ORBIT_TAU, delta)
    const pitch = damp(this.view.pitch, this.target.pitch, ORBIT_TAU, delta)
    const distance = damp(this.view.distance, this.target.distance, ORBIT_TAU, delta)
    const centre = dampVec3(this.view.target, this.target.centre, ORBIT_TAU, delta)
    // Close enough is when the difference is smaller than a pixel on screen: an exponential never
    // reaches its target, and a viewport that keeps asking for frames to close a hundredth of a
    // degree is a viewport whose fan never stops.
    const settled = Math.abs(wrapYaw(yaw - this.target.yaw)) < 0.02
      && Math.abs(pitch - this.target.pitch) < 0.02
      && Math.abs(distance - this.target.distance) / Math.max(this.target.distance, 1e-6) < 1e-3
      && centre.every((value, index) => Math.abs(value - this.target.centre[index]!) < Math.max(1e-4, this.target.distance * 1e-4))
    this.view = settled ? this.destination() : { ...this.view, yaw, pitch, distance, target: centre }
    this.push()
    if (settled) {
      this.animating = false
      this.lastTick = 0
      this.scheduleCommit()
      return false
    }
    return true
  }

  dispose(): void {
    this.clearCommit()
  }

  private push(): void {
    this.callbacks.apply(this.view)
  }

  private tickSoon(): void {
    // The owner drives the loop; this only makes sure the first frame after an input is asked for.
    this.callbacks.apply(this.view)
  }

  /**
   * What the document is told the view is: the destination, not the damped picture on its way
   * there. Storing an intermediate frame would be storing a camera position nobody asked for, and
   * the next thing to read the document back would travel to it.
   */
  private destination(): ViewState {
    return {
      ...this.view,
      yaw: this.target.yaw,
      pitch: this.target.pitch,
      distance: this.target.distance,
      target: [...this.target.centre],
    }
  }

  /** The document hears about the view a moment after the input stops, not sixty times a second. */
  private scheduleCommit(): void {
    this.clearCommit()
    this.commitTimer = setTimeout(() => {
      this.commitTimer = null
      this.callbacks.commit(this.destination())
    }, 120)
  }

  private clearCommit(): void {
    if (this.commitTimer) clearTimeout(this.commitTimer)
    this.commitTimer = null
  }

  private viewHeight(): number {
    return orthoHeight(this.target.distance, fovFromFocalLength(this.view.focalLength)) * 2
  }

  private viewportHeight(): number {
    return Math.max(1, this.callbacks.size().height)
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function aspectOf(size: { width: number; height: number }): number {
  return Math.max(1e-3, size.width) / Math.max(1e-3, size.height)
}

function basisOf(yaw: number, pitch: number): { right: Vec3; up: Vec3 } {
  const y = (yaw * Math.PI) / 180
  const p = (pitch * Math.PI) / 180
  const right: Vec3 = [Math.cos(y), Math.sin(y), 0]
  const forward: Vec3 = [-Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), -Math.sin(p)]
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ]
  return { right, up }
}
