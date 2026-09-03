/**
 * The channel the viewport talks to its heads-up display through.
 *
 * A transform's readout changes on every pointer move. Putting it in React state would mean a
 * render of the editor's tree sixty times a second; putting it in the canvas would mean drawing
 * text with WebGL, which never matches the rest of the interface. So the numbers go through a
 * subscription that exactly one small leaf component listens to: the DOM is updated, and nothing
 * above that leaf is re-rendered.
 */

export type HudState = {
  visible: boolean
  /** The short readout beside the pointer. */
  text: string
  /** The line that replaces the status bar's hints while a modal tool is running. */
  header: string
  /** Where the pointer is, in viewport pixels. */
  x: number
  y: number
  /** Which side of the pointer the chip sits on, so it never runs off the edge. */
  side: 'right' | 'left'
}

const EMPTY: HudState = { visible: false, text: '', header: '', x: 0, y: 0, side: 'right' }

export class HudChannel {
  private state: HudState = EMPTY
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** `useSyncExternalStore` compares by identity, so a set that changes nothing must not allocate. */
  snapshot = (): HudState => this.state

  set(next: Partial<HudState>): void {
    const merged = { ...this.state, ...next }
    if (
      merged.visible === this.state.visible
      && merged.text === this.state.text
      && merged.header === this.state.header
      && merged.x === this.state.x
      && merged.y === this.state.y
      && merged.side === this.state.side
    ) return
    this.state = merged
    for (const listener of this.listeners) listener()
  }

  clear(): void {
    this.set(EMPTY)
  }
}

/** Which side of the pointer a chip of this width fits on, given the viewport's width. */
export function chipSide(x: number, width: number, chipWidth = 180, gap = 24): 'right' | 'left' {
  return x + gap + chipWidth > width ? 'left' : 'right'
}
