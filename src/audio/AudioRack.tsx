import type { CSSProperties } from 'react'
import type { InspectorCategory, ParameterDef, ParamValue } from '@/rigs/types'
import { ParameterField } from '@/ui/ParameterField'
import { boardGroups } from '@/audio/board'
import { AudioEnvelope } from '@/audio/AudioEnvelope'
import { LAYER_COLOURS } from '@/audio/profiles'
import { AudioFader } from '@/audio/AudioFader'

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

/**
 * Not every control deserves the same amount of face-plate.
 *
 * A panel where everything is the same size is a panel with no hierarchy, and the eye has to read
 * all of it to find the one knob that matters. Every hardware synthesiser sizes its controls by
 * how often they are reached for: the frequency of a filter is a large dial, its resonance a
 * smaller one beside it. These are the four sizes and which fields get them.
 */
const HERO = ['pitch.start', 'filter.cutoff', 'resonator.frequency', 'source.wave', 'lfos.rate']
const SMALL = ['pan', 'spread', 'offset', 'jitter', 'phase', 'curve', 'partials', 'bitDepth', 'crush']

/** A level is a height, so the quantities that answer "how much" get a fader instead of a dial. */
const FADERS = ['gain', 'mix', 'amount', 'depth', 'drive', 'resonance']

function sizeOf(id: string): 'lg' | 'md' | 'sm' {
  if (HERO.some((tail) => id.endsWith(tail))) return 'lg'
  if (SMALL.some((tail) => id.endsWith(tail))) return 'sm'
  return 'md'
}

function isFader(id: string): boolean {
  const field = id.split('.').pop() ?? ''
  return FADERS.includes(field)
}

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
                      {shown.map((parameter) => {
                        const current = values[parameter.id] ?? parameter.defaultValue
                        if (parameter.kind === 'number' && isFader(parameter.id)) {
                          return (
                            <div className="audio-slot" data-size="fader" key={parameter.id}>
                              <AudioFader
                                param={parameter}
                                value={typeof current === 'number' ? current : parameter.min}
                                onChange={(next) => onChange(parameter.id, next)}
                                onGestureStart={onGestureStart}
                                onGestureEnd={onGestureEnd}
                              />
                            </div>
                          )
                        }
                        return (
                          <div className="audio-slot" data-size={sizeOf(parameter.id)} key={parameter.id}>
                            <ParameterField
                              param={parameter}
                              value={current}
                              onChange={(next) => onChange(parameter.id, next)}
                              onGestureStart={onGestureStart}
                              onGestureEnd={onGestureEnd}
                            />
                          </div>
                        )
                      })}
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
