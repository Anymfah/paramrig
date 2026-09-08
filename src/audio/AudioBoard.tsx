import type { CSSProperties } from 'react'
import type { ParameterDef, ParamValue } from '@/rigs/types'
import { ParameterField } from '@/ui/ParameterField'
import { BOARD_CATEGORIES, boardGroups } from '@/audio/board'
import { AudioEnvelope } from '@/audio/AudioEnvelope'
import { LAYER_COLOURS } from '@/audio/profiles'

/**
 * The whole synthesiser, at once.
 *
 * Every field is on screen: three layer columns and the mix, no tabs and nothing folded away. That
 * is the argument of the layout — sound design is a tight loop of change and listen, and a control
 * you have to go and find is a control you stop using. The room this needs came from the waveform,
 * which is a gauge and does not need a canvas.
 *
 * A layer that is switched off collapses to its own switch. Three columns of settings that make no
 * sound are three columns of noise.
 */
export function AudioBoard({ parameters, values, duration, onChange, onGestureStart, onGestureEnd }: {
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  duration: number
  onChange: (property: string, value: ParamValue) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const groups = boardGroups()
  return (
    <div className="audio-board" role="group" aria-label="Sound board">
      {BOARD_CATEGORIES.map((category, index) => {
        const layer = category.id.startsWith('l') ? index : null
        const enabled = layer === null || values[`layers[${layer}].enabled`] !== false
        const columnGroups = groups.filter((group) => group.tab === category.id)
        return (
          <section
            className="audio-column"
            key={category.id}
            data-off={!enabled}
            data-pinned={layer === null || undefined}
            aria-label={category.label}
            // Colour identifies the layer, here and in the overlay above, and the two read the
            // same list so they cannot drift apart.
            style={layer === null ? undefined : { '--section': LAYER_COLOURS[layer] } as CSSProperties}
          >
            <h2 className="audio-column__title">{category.label}</h2>
            {columnGroups.map((group) => {
              const root = group.id.endsWith('.root')
              if (!enabled && !root) return null
              const fields = parameters.filter((parameter) => parameter.group === group.id)
              if (fields.length === 0) return null
              const section = group.id.split('.')[1] ?? ''
              // The envelope draws itself; the five times and levels behind it are the shape, and
              // the shape is what a person is actually setting. Only the curve stays a field.
              const drawn = section === 'amp' && layer !== null
              const shown = drawn ? fields.filter((parameter) => parameter.id.endsWith('.curve')) : fields
              return (
                <div className="audio-group" data-section={section} key={group.id}>
                  {root ? null : <h3 className="audio-group__title">{group.label}</h3>}
                  {drawn ? (
                    <AudioEnvelope
                      layer={layer}
                      values={values}
                      duration={duration}
                      onChange={onChange}
                      onGestureStart={onGestureStart}
                      onGestureEnd={onGestureEnd}
                    />
                  ) : null}
                  {shown.map((parameter) => (
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
              )
            })}
            {enabled ? null : <p className="audio-column__off">Switched off. Its settings make no sound.</p>}
          </section>
        )
      })}
    </div>
  )
}
