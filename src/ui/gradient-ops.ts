import type { GradientStop } from '@/rigs/types'
import { hexToRgb, rgbToHex } from '@/ui/color'

export const MAX_GRADIENT_STOPS = 8
export const DROP_STOP_PX = 28

export function mixHex(a: string, b: string, t: number): string {
  const from = hexToRgb(a) ?? { r: 0, g: 0, b: 0 }
  const to = hexToRgb(b) ?? from
  const u = Math.min(1, Math.max(0, t))
  return rgbToHex(
    from.r + (to.r - from.r) * u,
    from.g + (to.g - from.g) * u,
    from.b + (to.b - from.b) * u,
  )
}

export function sampleGradient(stops: GradientStop[], t: number): string {
  const sorted = [...stops].sort((a, b) => a.t - b.t)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (!first || !last) return '#000000'
  if (t <= first.t) return first.color
  if (t >= last.t) return last.color
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (!a || !b || t > b.t) continue
    const span = b.t - a.t
    return mixHex(a.color, b.color, span === 0 ? 0 : (t - a.t) / span)
  }
  return last.color
}

export function nearestStopIndex(stops: GradientStop[], t: number): number {
  let best = 0
  let bestDist = Infinity
  stops.forEach((stop, i) => {
    const dist = Math.abs(stop.t - t)
    if (dist < bestDist) {
      best = i
      bestDist = dist
    }
  })
  return best
}

export function insertGradientStop(stops: GradientStop[], t: number): GradientStop[] | null {
  if (stops.length >= MAX_GRADIENT_STOPS) return null
  const at = Math.min(1, Math.max(0, Math.round(t * 100) / 100))
  if (stops.some((stop) => Math.abs(stop.t - at) < 0.01)) return null
  return [...stops, { t: at, color: sampleGradient(stops, at) }].sort((a, b) => a.t - b.t)
}

export function removeGradientStop(stops: GradientStop[], index: number): GradientStop[] {
  if (stops.length <= 2 || index < 0 || index >= stops.length) return stops
  return stops.filter((_, i) => i !== index)
}
