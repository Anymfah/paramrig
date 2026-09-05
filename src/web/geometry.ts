import type { Point, Rect, WebMark, WebTarget } from './contracts.ts'

export function markPoints(mark: WebMark, targets: WebTarget[], scroll: Point): Point[] | null {
  if (!mark.targetKey) return mark.points.map(p => ({ x: p.x - scroll.x, y: p.y - scroll.y }))
  const target = targets.find(t => t.key === mark.targetKey)
  if (!target || target.status === 'missing' || target.status === 'ambiguous') return null
  return mark.points.map(p => ({ x: target.rect.x + p.x * target.rect.width, y: target.rect.y + p.y * target.rect.height }))
}
export function storedPoint(point: Point, target: WebTarget | undefined, scroll: Point): Point {
  return target ? { x: (point.x - target.rect.x) / Math.max(1, target.rect.width), y: (point.y - target.rect.y) / Math.max(1, target.rect.height) } : { x: point.x + scroll.x, y: point.y + scroll.y }
}
export function bounds(points: Point[]): Rect {
  const xs = points.map(p => p.x); const ys = points.map(p => p.y)
  const x = Math.min(...xs); const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
export function pathForMark(mark: WebMark, points: Point[]): string {
  const a = points[0]; const b = points.at(-1)
  if (!a || !b) return ''
  const box = bounds([a, b])
  if (mark.tool === 'rectangle' || mark.tool === 'highlight') return `M${box.x},${box.y}h${box.width}v${box.height}h${-box.width}Z`
  if (mark.tool === 'ellipse') return `M${box.x},${box.y + box.height / 2}a${box.width / 2},${box.height / 2} 0 1 0 ${box.width},0a${box.width / 2},${box.height / 2} 0 1 0 ${-box.width},0`
  if (mark.tool === 'note') return `M${a.x - 6},${a.y}a6,6 0 1 0 12,0a6,6 0 1 0 -12,0`
  if (mark.tool === 'arrow') {
    const angle = Math.atan2(b.y - a.y, b.x - a.x); const size = 12
    return `M${a.x},${a.y}L${b.x},${b.y}M${b.x - Math.cos(angle - .5) * size},${b.y - Math.sin(angle - .5) * size}L${b.x},${b.y}L${b.x - Math.cos(angle + .5) * size},${b.y - Math.sin(angle + .5) * size}`
  }
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
}
