import type { BezierCurve, Vec2 } from '@/rigs/types'
import { defaultCurve } from '@/state/values'

export type CurvePreset = {
  id: string
  label: string
  p1: Vec2
  p2: Vec2
}

export const CURVE_PRESETS: readonly CurvePreset[] = [
  { id: 'linear', label: 'Linear', p1: [0, 0], p2: [1, 1] },
  { id: 'ease-in', label: 'Ease in', p1: [0.42, 0], p2: [1, 1] },
  { id: 'ease-out', label: 'Ease out', p1: [0, 0], p2: [0.58, 1] },
  { id: 'ease-in-out', label: 'Ease in-out', p1: [0.42, 0], p2: [0.58, 1] },
]

export function applyCurvePreset(preset: CurvePreset): BezierCurve {
  return {
    type: 'cubic-bezier',
    p0: [0, 0],
    p1: preset.p1,
    p2: preset.p2,
    p3: [1, 1],
  }
}

export function matchingCurvePreset(curve: BezierCurve, epsilon = 0.02): CurvePreset | undefined {
  return CURVE_PRESETS.find(
    (preset) => near(curve.p1, preset.p1, epsilon) && near(curve.p2, preset.p2, epsilon),
  )
}

export function defaultHandle(which: 'p1' | 'p2'): Vec2 {
  return defaultCurve()[which]
}

function near(a: Vec2, b: Vec2, epsilon: number): boolean {
  return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon
}
