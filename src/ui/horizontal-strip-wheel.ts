/** Pixel delta to apply to `scrollLeft` on a horizontal-only strip.
 *
 * Trackpads emit `deltaX` for a two-finger pan; return 0 so overflow-x owns
 * that gesture. Mouse wheels (and vertical trackpad flicks) emit `deltaY` —
 * map those across so the strip moves instead of the panel behind it.
 */
export function horizontalStripWheel(
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>,
  pageSize: number,
): number {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageSize : 1
  const x = event.deltaX * unit
  const y = event.deltaY * unit
  if (Math.abs(x) >= Math.abs(y)) return 0
  return y
}
