/**
 * How long the pointer rests before a tooltip appears.
 *
 * It is a module value rather than a prop or a context because every tooltip in the application
 * shares it, and threading one number through several hundred call sites would be a worse cost
 * than this: the editor sets it once, when its preferences are read.
 */

const DEFAULT_OPEN_DELAY = 400

let openDelay = DEFAULT_OPEN_DELAY

export function setTooltipDelay(ms: number): void {
  openDelay = Math.max(0, Math.min(2000, ms))
}

export function tooltipDelay(): number {
  return openDelay
}
