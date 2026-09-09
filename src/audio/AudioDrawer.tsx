import type { ParameterDef, ParamValue } from '@/rigs/types'
import { ParameterField } from '@/ui/ParameterField'
import { AudioLfoShape } from '@/audio/AudioLfoShape'
import { LFO_COUNT } from '@/audio/fields'
import { boardGroups } from '@/audio/board'

/**
 * The modulators, and the line that says what they are doing.
 *
 * The two are separable and are separated. With four layers the stages need the whole window
 * height, so the panels have a view of their own; the routing bar does not go with them. It is a
 * single line, it answers "what is moving, and onto what?", and that is a question asked while
 * working on the voice rather than while editing the modulator.
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

export function AudioDrawer({ parameters, values, duration, onChange, onGestureStart, onGestureEnd }: {
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  duration: number
  onChange: (property: string, value: ParamValue) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const groups = boardGroups()
  return (
    <section className="audio-drawer" aria-label="Modulation">
      <AudioRouting values={values} />
      <div className="audio-drawer__panels">
        {slots().map((index) => {
          const fields = parameters.filter((parameter) => parameter.group === `lfo${index}.all`)
          const group = groups.find((entry) => entry.id === `lfo${index}.all`)
          return (
            <div className="audio-mod" key={index} data-off={values[`lfos[${index}].enabled`] === false || undefined}>
              <h3 className="audio-mod__title">{group?.label ?? `LFO ${index + 1}`}</h3>
              <AudioLfoShape index={index} values={values} duration={duration} />
              <div className="audio-mod__fields">
                {fields.map((parameter) => (
                  <ParameterField
                    key={parameter.id}
                    param={parameter}
                    value={values[parameter.id] ?? parameter.defaultValue}
                    onChange={(next) => onChange(parameter.id, next)}
                    onGestureStart={onGestureStart}
                    onGestureEnd={onGestureEnd}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
