/**
 * The lines a tool draws over the viewport before it has changed anything.
 *
 * A loop cut's yellow preview and a knife's path are both a run of points in viewport pixels that
 * moves with every pointer event. They go through a subscription for the same reason the HUD and
 * the marquee do: sixty of these a second through React's state would re-render the whole editor,
 * and none of them belongs in the document.
 */

export type ToolPathKind = 'loop-cut' | 'knife'

export type ToolPathState = {
  kind: ToolPathKind | null
  /** Closed or open runs of points, in the viewport's own pixels. */
  lines: Array<Array<[number, number]>>
  /** The points a person has placed, drawn as handles. */
  placed: Array<[number, number]>
  /** Where the line would snap to if it were confirmed here. */
  snap: [number, number] | null
}

const EMPTY: ToolPathState = { kind: null, lines: [], placed: [], snap: null }

export class ToolPathChannel {
  private state: ToolPathState = EMPTY
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot = (): ToolPathState => this.state

  set(next: Partial<ToolPathState> & { kind: ToolPathKind }): void {
    this.state = { ...EMPTY, ...next }
    for (const listener of this.listeners) listener()
  }

  clear(): void {
    if (this.state === EMPTY) return
    this.state = EMPTY
    for (const listener of this.listeners) listener()
  }
}
