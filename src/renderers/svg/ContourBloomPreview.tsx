import type { BezierCurve, ParamValue } from '@/rigs/types'
import { sampleBezier } from '@/state/values'

type PreviewProps = {
  values: Record<string, ParamValue>
}

export function ContourBloomPreview({ values }: PreviewProps) {
  const lobes = Number(values.lobes) || 6
  const amplitude = Number(values.amplitude) || 0
  const twist = ((Number(values.twist) || 0) * Math.PI) / 180
  const layers = Math.max(4, Math.round(Number(values.layers) || 8))
  const depth = Number(values.depth) || 0.5
  const ink = String(values.ink ?? '#1C201C')
  const curve = values.edgeSoftness as BezierCurve
  const paths = buildBloom(lobes, amplitude, twist, layers, depth, curve)

  return (
    <svg className="bloom-svg" viewBox="0 0 800 600" role="img" aria-label="Contour bloom preview">
      <rect width="800" height="600" fill="#F4F3EB" />
      <g transform="translate(400 300)">
        {paths.map((d, index) => (
          <path key={index} d={d} fill="none" stroke={ink} strokeWidth={index === 0 ? 1.4 : 0.7} strokeOpacity={0.28 + (1 - index / layers) * 0.55} />
        ))}
      </g>
    </svg>
  )
}

export function ContourBloomMark() {
  const paths = buildBloom(6, 0.18, 0.42, 18, 0.72)
  return (
    <svg viewBox="0 0 800 600" aria-hidden="true">
      <rect width="800" height="600" fill="#F4F3EB" />
      <g transform="translate(400 300)">
        {paths.map((d, index) => (
          <path key={index} d={d} fill="none" stroke="#1C201C" strokeWidth="0.9" strokeOpacity={0.35 + (1 - index / 18) * 0.5} />
        ))}
      </g>
    </svg>
  )
}

function buildBloom(
  lobes: number,
  amplitude: number,
  twist: number,
  layers: number,
  depth: number,
  curve?: BezierCurve,
): string[] {
  const paths: string[] = []
  for (let layer = 0; layer < layers; layer += 1) {
    const t = layer / Math.max(1, layers - 1)
    const ease = curve ? sampleBezier(curve, t) : t
    const radius = 210 * (1 - depth * 0.72 * ease)
    const wobble = amplitude * (1 - t * 0.35)
    const rot = twist * t
    const steps = 180
    let d = ''
    for (let i = 0; i <= steps; i += 1) {
      const a = (i / steps) * Math.PI * 2
      const r = radius * (1 + wobble * Math.sin(lobes * a + rot))
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r * 0.92
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    }
    paths.push(`${d}Z`)
  }
  return paths
}
