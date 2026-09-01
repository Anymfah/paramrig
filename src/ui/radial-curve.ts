import type { Point } from '@/rigs/extended-types'

function sorted(points: Point[]): Point[] {
  return [...points].sort((a, b) => a.x - b.x)
}

/** Tangent-based Hermite slopes used by Helios Ray's radial profile editor. */
export function radialTangents(points: Point[]): number[] {
  const pts = sorted(points)
  if (pts.length < 2) return []
  if (pts.length === 2) {
    const dx = pts[1]!.x - pts[0]!.x || 1
    const slope = (pts[1]!.y - pts[0]!.y) / dx
    return [slope, slope]
  }
  const slopes = pts.slice(1).map((point, index) => {
    const prev = pts[index]!
    return (point.y - prev.y) / (point.x - prev.x || 1)
  })
  const tangents = pts.map(() => 0)
  tangents[0] = slopes[0]!
  tangents[tangents.length - 1] = slopes[slopes.length - 1]!
  for (let i = 1; i < pts.length - 1; i++) {
    const left = slopes[i - 1]!
    const right = slopes[i]!
    if (left === 0 || right === 0 || left * right < 0) {
      tangents[i] = 0
      continue
    }
    const leftDx = pts[i]!.x - pts[i - 1]!.x
    const rightDx = pts[i + 1]!.x - pts[i]!.x
    const w1 = 2 * rightDx + leftDx
    const w2 = rightDx + 2 * leftDx
    tangents[i] = (w1 + w2) / (w1 / left + w2 / right)
  }
  return tangents
}

function cubic(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

/** Dense (x, y) samples of one radial profile, sorted by radius. */
export function sampleRadialCurve(points: Point[], samplesPerSegment = 32): Point[] {
  const pts = sorted(points)
  if (pts.length < 2) return pts[0] ? [{ x: pts[0].x, y: pts[0].y }] : []
  const tangents = radialTangents(pts)
  const out: Point[] = []
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]!
    const p3 = pts[i]!
    const dx = p3.x - p0.x
    if (dx <= 0) continue
    const cp1y = p0.y + (tangents[i - 1]! * dx) / 3
    const cp2y = p3.y - (tangents[i]! * dx) / 3
    for (let k = 0; k < samplesPerSegment; k++) {
      const t = k / samplesPerSegment
      out.push({
        x: cubic(t, p0.x, p0.x + dx / 3, p3.x - dx / 3, p3.x),
        y: cubic(t, p0.y, cp1y, cp2y, p3.y),
      })
    }
  }
  out.push({ x: pts.at(-1)!.x, y: pts.at(-1)!.y })
  return out
}

export function sampleRadialAt(points: Point[], radius: number): number {
  const samples = sampleRadialCurve(points)
  if (!samples.length) return 0
  const x = Math.max(samples[0]!.x, Math.min(samples.at(-1)!.x, radius))
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!
    const b = samples[i + 1]!
    if (x >= a.x && x <= b.x) {
      const span = b.x - a.x || 1
      return a.y + ((b.y - a.y) * (x - a.x)) / span
    }
  }
  return samples.at(-1)!.y
}

export function radialStrokePath(points: Point[]): string {
  const samples = sampleRadialCurve(points)
  if (!samples.length) return ''
  return samples.map((p, i) => `${i ? 'L' : 'M'}${p.x * 100},${(1 - p.y) * 100}`).join(' ')
}

export function radialFillPath(points: Point[]): string {
  const samples = sampleRadialCurve(points)
  if (!samples.length) return ''
  const first = samples[0]!
  const last = samples.at(-1)!
  return `${radialStrokePath(points)} L${last.x * 100},100 L${first.x * 100},100 Z`
}
