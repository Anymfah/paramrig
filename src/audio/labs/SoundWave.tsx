import { memo, useId, useMemo } from 'react'
import type { LabSound } from './model'

/** Smooth only the thumbnail's silhouette: audio samples and persisted peaks stay untouched. */
function soften(values: number[]): number[] {
  const weights = [1, 3, 6, 8, 6, 3, 1]
  return values.map((value, i) => {
    // Keep genuine gaps, including short stutters, clear of neighbouring energy.
    if (value === 0) return 0
    let sum = 0, total = 0
    for (let k = -3; k <= 3; k++) {
      const at = i + k
      if (at < 0 || at >= values.length) continue
      sum += values[at]! * weights[k + 3]!; total += weights[k + 3]!
    }
    return sum / total
  })
}

/** A small audio portrait: continuous envelopes around the sound's measured energy. */
export const SoundWave = memo(function SoundWave({ sound }: { sound: LabSound }) {
  const id = useId()
  const preview = sound.preview?.fingerprint === sound.fingerprint ? sound.preview : undefined
  const paths = useMemo(() => {
    const detail = preview?.detail
    const peaks = preview?.bins ?? []
    const upper = soften(detail?.max ?? peaks)
    const lower = soften(detail?.min.map((value) => -value) ?? peaks)
    const peak = Math.max(...upper, ...lower, 0.001)
    // Shared vertical scale preserves the sound's dynamics and lets quiet tails remain readable.
    const height = (value: number) => 34 * Math.pow(Math.max(0, Math.min(1, value / peak)), 0.8)
    const coords = (values: number[], side: number) => values.map((value, i) => [i * 768 / Math.max(1, values.length - 1), 40 + side * height(value)] as const)
    const point = (p: readonly number[]) => `${p[0]!.toFixed(2)},${p[1]!.toFixed(2)}`
    const curve = (points: (readonly [number, number])[]) => points.slice(0, -1).map((p, i) => {
      const next = points[i + 1]!
      return `Q${point(p)} ${point([(p[0] + next[0]) / 2, (p[1] + next[1]) / 2])}`
    }).join('') + `L${point(points[points.length - 1]!)}`
    const area = (top: number[], bottom: number[]) => {
      if (!top.length) return ''
      const up = coords(top, -1), down = coords(bottom, 1).reverse()
      return `M${point(up[0]!)}${curve(up)}L${point(down[0]!)}${curve(down)}Z`
    }
    const core = soften(detail?.rms ?? [])
    const coreUpper = core.map((value, i) => Math.min(value, upper[i]!))
    const coreLower = core.map((value, i) => Math.min(value, lower[i]!))
    return { body: area(upper, lower), core: area(coreUpper, coreLower) }
  }, [preview])
  return <svg className="labs-wave" viewBox="0 0 768 80" preserveAspectRatio="none" aria-hidden="true" data-thumbnail={preview?.detail ? undefined : sound.fingerprint}>
    <defs>
      <linearGradient id={`${id}-color`} x1="0" y1="0" x2="1" y2="0">
        <stop stopColor="var(--labs-wave-green)" />
        <stop offset=".48" stopColor="var(--labs-wave-edge)" />
        <stop offset="1" stopColor="var(--labs-wave-blue)" />
      </linearGradient>
      <linearGradient id={`${id}-opacity`} x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="white" stopOpacity=".1" />
        <stop offset=".38" stopColor="white" stopOpacity=".55" />
        <stop offset=".5" stopColor="white" stopOpacity=".85" />
        <stop offset=".62" stopColor="white" stopOpacity=".55" />
        <stop offset="1" stopColor="white" stopOpacity=".1" />
      </linearGradient>
      <linearGradient id={`${id}-light`} x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="var(--labs-wave-light)" stopOpacity="0" />
        <stop offset=".32" stopColor="var(--labs-wave-light)" stopOpacity=".12" />
        <stop offset=".5" stopColor="var(--labs-wave-light)" stopOpacity=".8" />
        <stop offset=".68" stopColor="var(--labs-wave-light)" stopOpacity=".12" />
        <stop offset="1" stopColor="var(--labs-wave-light)" stopOpacity="0" />
      </linearGradient>
      <mask id={`${id}-body`} maskUnits="userSpaceOnUse" x="0" y="0" width="768" height="80">
        <rect width="768" height="80" fill={`url(#${id}-opacity)`} />
      </mask>
    </defs>
    <path className="labs-wave__axis" d="M0 40H768" />
    <path className="labs-wave__halo" d={paths.core || paths.body} stroke={`url(#${id}-color)`} />
    <path className="labs-wave__body" d={paths.body} fill={`url(#${id}-color)`} mask={`url(#${id}-body)`} />
    <path className="labs-wave__core" d={paths.core} fill={`url(#${id}-color)`} />
    <path className="labs-wave__light" d={paths.core} fill={`url(#${id}-light)`} />
    <path className="labs-wave__crest" d={paths.body} stroke={`url(#${id}-color)`} />
  </svg>
})
