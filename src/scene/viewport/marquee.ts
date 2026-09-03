/**
 * The shape a region selection is drawing right now.
 *
 * Same reasoning as the HUD: it changes on every pointer move, so it goes through a subscription
 * that one leaf component listens to rather than through the editor's state.
 */

export type MarqueeKind = 'box' | 'lasso' | 'circle'

export type MarqueeState = {
  kind: MarqueeKind | null
  /** Box: the two corners. Lasso: the path so far. Circle: the centre, once. */
  points: Array<[number, number]>
  radius: number
}

const EMPTY: MarqueeState = { kind: null, points: [], radius: 0 }

export class MarqueeChannel {
  private state: MarqueeState = EMPTY
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot = (): MarqueeState => this.state

  set(next: MarqueeState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  clear(): void {
    if (this.state === EMPTY) return
    this.state = EMPTY
    for (const listener of this.listeners) listener()
  }
}

/** Whether a point is inside a lasso, by the even-odd rule. */
export function insidePolygon(polygon: Array<[number, number]>, x: number, y: number): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]!
    const b = polygon[previous]!
    if ((a[1] > y) === (b[1] > y)) continue
    if (x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

/** The box a set of points fits in, with a little slack so a one-pixel lasso still reads a pixel. */
export function boundsOfPoints(points: Array<[number, number]>): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}
