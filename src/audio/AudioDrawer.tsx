import type { ParameterDef, ParamValue } from '@/rigs/types'
import { ParameterField } from '@/ui/ParameterField'
import { AudioLfoShape } from '@/audio/AudioLfoShape'
import { LFO_COUNT } from '@/audio/fields'
import { boardGroups } from '@/audio/board'

/**
 * The modulators, always on screen.
 *
 * They used to be a view of their own, which meant that giving a sound movement and shaping the
 * voice it moves were two places you could not be at once — you set a rate, switched tabs, and
 * guessed at what it was doing to the layer you could no longer see. Every synthesiser worth
 * copying keeps its modulators in a drawer under the instrument for exactly that reason.
 *
 * The bar above the panels is the routing: one chip a modulator, saying where it is pointed and
 * carrying the colour of the layer it lands on. It is the answer to the only question the drawer
 * is asked from across the room, which is "what is moving?".
 */
export function AudioDrawer({ parameters, values, duration, onChange, onGestureStart, onGestureEnd }: {
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  duration: number
  onChange: (property: string, value: ParamValue) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const groups = boardGroups()
  const slots = Array.from({ length: LFO_COUNT }, (_, index) => index)

  const targetOf = (index: number) => {
    const raw = values[`lfos[${index}].target`]
    return typeof raw === 'string' ? raw : 'off'
  }
  const targetLabel = (target: string) => {
    if (target === 'off') return 'not assigned'
    const match = /^layers\[(\d+)\]\.(\w+)$/.exec(target)
    return match ? `Layer ${Number(match[1]) + 1} · ${match[2]}` : target
  }
  const targetLayer = (target: string) => {
    const match = /^layers\[(\d+)\]\./.exec(target)
    return match ? Number(match[1]) : null
  }

  return (
    <section className="audio-drawer" aria-label="Modulation">
      <div className="audio-routing" role="list" aria-label="Routing">
        {slots.map((index) => {
          const on = values[`lfos[${index}].enabled`] !== false
          const target = targetOf(index)
          const layer = targetLayer(target)
          return (
            <a
              className="audio-route"
              key={index}
              role="listitem"
              href={`#audio-mod-${index}`}
              data-off={!on || target === 'off'}
              data-layer={layer ?? undefined}
            >
              <span className="audio-route__slot">LFO {index + 1}</span>
              <span className="audio-route__arrow" aria-hidden="true">→</span>
              <span className="audio-route__target">{targetLabel(target)}</span>
            </a>
          )
        })}
      </div>
      <div className="audio-drawer__panels">
        {slots.map((index) => {
          const fields = parameters.filter((parameter) => parameter.group === `lfo${index}.all`)
          const group = groups.find((entry) => entry.id === `lfo${index}.all`)
          return (
            <div className="audio-mod" key={index} id={`audio-mod-${index}`} data-off={values[`lfos[${index}].enabled`] === false}>
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
