import type { ParamValue } from '@/rigs/types'
import { LFO_COUNT } from '@/audio/fields'

/**
 * The line that says what the modulators are doing.
 *
 * The modulator panels that used to live beside this are on the face-plate now, in the reference's
 * second and third modulator slots, and the view that showed them a second time is gone. This bar
 * stayed: it is a single line, it answers "what is moving, and onto what?", and that is a question
 * asked while working on the voice rather than while editing the modulator.
 */

function targetLabel(target: string): string {
  if (target === 'off') return 'not assigned'
  const match = /^layers\[(\d+)\]\.(\w+)$/.exec(target)
  return match ? `Layer ${Number(match[1]) + 1} · ${match[2]}` : target
}

function targetLayer(target: string): number | null {
  const match = /^layers\[(\d+)\]\./.exec(target)
  return match ? Number(match[1]) : null
}

const slots = () => Array.from({ length: LFO_COUNT }, (_, index) => index)

/** One chip a modulator, carrying the colour of the layer it lands on. */
export function AudioRouting({ values }: { values: Record<string, ParamValue> }) {
  return (
    <div className="audio-routing" role="list" aria-label="Routing">
      {slots().map((index) => {
        const raw = values[`lfos[${index}].target`]
        const target = typeof raw === 'string' ? raw : 'off'
        const on = values[`lfos[${index}].enabled`] !== false
        const layer = targetLayer(target)
        return (
          <span
            className="audio-route"
            key={index}
            role="listitem"
            data-off={!on || target === 'off' || undefined}
            data-layer={layer ?? undefined}
          >
            <span className="audio-route__slot">LFO {index + 1}</span>
            <span className="audio-route__arrow" aria-hidden="true">→</span>
            <span className="audio-route__target">{targetLabel(target)}</span>
          </span>
        )
      })}
    </div>
  )
}
