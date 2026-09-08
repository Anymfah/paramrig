import type { CSSProperties } from 'react'
import type { InspectorCategory, ParameterDef, ParamValue } from '@/rigs/types'
import { ParameterField } from '@/ui/ParameterField'
import { boardGroups } from '@/audio/board'
import { AudioEnvelope } from '@/audio/AudioEnvelope'
import { LAYER_COLOURS } from '@/audio/profiles'

/**
 * The instrument as a signal path rather than as a filing cabinet.
 *
 * The arrangement is the one every hardware synthesiser and every plugin that copies them uses:
 * the signal runs left to right across the window, and each thing done to it is a panel standing
 * upright in the path. Three layer panels then the bus they feed, read in the order the samples
 * go through them. Nothing is behind a tab, because the whole argument of the layout is that
 * sound design is a tight loop of change and listen, and a control you have to go and find is a
 * control you stop using.
 *
 * Every number is a knob rather than a labelled row. A form is for entering values you know; an
 * instrument is for finding ones you do not, and a dial you can sweep with the pointer is the
 * difference between the two.
 *
 * A layer that is switched off collapses to its own switch. Three lanes of settings that make no
 * sound are three lanes of noise.
 */

const STAGE_LABELS: Record<string, string> = {
  root: 'Level',
  source: 'Source',
  pitch: 'Pitch',
  filter: 'Filter',
  shaper: 'Shaper',
  resonator: 'Body',
  amp: 'Envelope',
}

export function AudioRack({ categories, parameters, values, duration, onChange, onGestureStart, onGestureEnd }: {
  categories: InspectorCategory[]
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  duration: number
  onChange: (property: string, value: ParamValue) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const groups = boardGroups()
  return (
    <div className="audio-rack" role="group" aria-label="Signal path">
      {categories.map((category, index) => {
        const isLayer = category.id.startsWith('l') && category.id !== 'mix'
        const layer = isLayer ? index : null
        const enabled = layer === null || values[`layers[${layer}].enabled`] !== false
        const lanes = groups.filter((group) => group.tab === category.id)
        return (
          <section
            className="audio-lane"
            key={category.id}
            data-off={!enabled}
            data-bus={layer === null || undefined}
            aria-label={category.label}
            style={layer === null ? undefined : { '--section': LAYER_COLOURS[layer] } as CSSProperties}
          >
            <div className="audio-lane__spine">
              <span className="audio-lane__name">{category.label}</span>
            </div>
            <div className="audio-lane__stages">
              {lanes.map((group) => {
                const stage = group.id.split('.')[1] ?? ''
                const root = stage === 'root'
                if (!enabled && !root) return null
                const fields = parameters.filter((parameter) => parameter.group === group.id)
                if (fields.length === 0) return null
                // The envelope draws itself; the times and levels behind it are the shape, and the
                // shape is what a person is actually setting. Only the curve stays a field.
                const drawn = stage === 'amp' && layer !== null
                const shown = drawn ? fields.filter((parameter) => parameter.id.endsWith('.curve')) : fields
                return (
                  <div className="audio-stage" data-stage={stage} key={group.id}>
                    <h3 className="audio-stage__title">{STAGE_LABELS[stage] ?? group.label}</h3>
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
                    <div className="audio-stage__fields">
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
                  </div>
                )
              })}
              {enabled ? null : <p className="audio-lane__off">Switched off. Its settings make no sound.</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}
