import type { ParamValue } from '@/rigs/types'

export function SurfaceStudiesPreview({ values }: { values: Record<string, ParamValue> }) {
  const azimuth = Number(values.azimuth ?? 210)
  const elevation = Number(values.elevation ?? 42)
  const softness = Number(values.softness ?? 0.35)
  const radius = Number(values.radius ?? 20)
  const gap = Number(values.gap ?? 24)
  const hairline = Boolean(values.hairline)
  const x = Math.cos((azimuth * Math.PI) / 180) * 18
  const y = Math.sin((elevation * Math.PI) / 180) * 10
  const blur = 8 + softness * 28
  const plates = ['#F4F3EB', '#C8CCC0', '#1C201C']

  return (
    <div className="html-preview">
      <div className="plates" style={{ gap }}>
        {plates.map((color) => (
          <div
            key={color}
            className="plate"
            style={{
              background: color,
              borderRadius: radius,
              boxShadow: hairline
                ? `${x}px ${y}px ${blur}px rgb(28 32 28 / ${0.18 + softness * 0.2}), inset 0 0 0 1px rgb(28 32 28 / 0.08)`
                : `${x}px ${y}px ${blur}px rgb(28 32 28 / ${0.2 + softness * 0.2})`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function SurfaceMark() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true">
      <rect width="320" height="200" fill="#E8EBE2" />
      {['#F4F3EB', '#C8CCC0', '#1C201C'].map((color, i) => (
        <rect key={color} x={36 + i * 88} y={56} width="72" height="72" rx="16" fill={color} />
      ))}
    </svg>
  )
}
