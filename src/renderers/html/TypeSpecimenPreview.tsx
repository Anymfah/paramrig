import type { ParamValue } from '@/rigs/types'

export function TypeSpecimenPreview({ values }: { values: Record<string, ParamValue> }) {
  const display = Number(values.display) || 56
  const body = Number(values.body) || 18
  const tracking = Number(values.tracking) || -0.03
  const leading = Number(values.leading) || 1.5
  const measureCh = Number(values.measureCh) || 42
  const weight = Number(values.weight) || 600

  return (
    <div className="type-preview">
      <article style={{ maxWidth: `${measureCh}ch` }}>
        <p
          style={{
            fontSize: display,
            fontWeight: weight,
            letterSpacing: `${tracking}em`,
            lineHeight: 1.05,
            margin: 0,
          }}
        >
          Aa
        </p>
        <p style={{ fontSize: body, lineHeight: leading, margin: 0 }}>
          Make it your own. Type, space, rhythm. The agent built the specimen; you decide the measure.
        </p>
      </article>
    </div>
  )
}

export function TypeMark() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true">
      <rect width="320" height="200" fill="#E8EBE2" />
      <text x="36" y="108" fontSize="72" fontFamily="Public Sans, sans-serif" fill="#1C201C">
        Aa
      </text>
      <text x="140" y="92" fontSize="13" fontFamily="Public Sans, sans-serif" fill="#1C201C">
        Make it your own.
      </text>
      <text x="140" y="112" fontSize="13" fontFamily="Public Sans, sans-serif" fill="#62695E">
        Type, space, rhythm.
      </text>
    </svg>
  )
}
