/**
 * The numbers drawn over the mesh, in viewport pixels.
 *
 * They move with the camera, so they go through a subscription for the same reason the HUD and the
 * marquee do: a re-render of the editor for every frame of an orbit would cost more than the text
 * it is drawing.
 */

export type ViewportLabel = { x: number; y: number; text: string; kind: 'index' | 'length' | 'angle' | 'area' }

const EMPTY: ViewportLabel[] = []

export class LabelChannel {
  private state: ViewportLabel[] = EMPTY
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot = (): ViewportLabel[] => this.state

  set(next: ViewportLabel[]): void {
    if (next.length === 0 && this.state === EMPTY) return
    this.state = next.length === 0 ? EMPTY : next
    for (const listener of this.listeners) listener()
  }

  clear(): void {
    this.set([])
  }
}
