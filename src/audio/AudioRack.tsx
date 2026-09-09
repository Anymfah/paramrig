import { useState, type CSSProperties } from 'react'
import type { InspectorCategory, ParameterDef, ParamValue } from '@/rigs/types'
import { ParameterField } from '@/ui/ParameterField'
import { boardGroups } from '@/audio/board'
import { AudioEnvelope } from '@/audio/AudioEnvelope'
import { LAYER_COLOURS } from '@/audio/profiles'
import { AudioFader } from '@/audio/AudioFader'
import { AudioKnob } from '@/audio/AudioKnob'

/**
 * The instrument as a signal path, arranged the way the plugins people already know arrange one.
 *
 * The mistake the previous version made was reading those plugins too literally. Their upright
 * panels are *stages* — oscillator, noise, filter, amplifier — laid across the window in the order
 * the signal passes through them. Copying the shape but filling each panel with a whole voice put
 * seven stages down every column, and one layer's controls summed to 1871 pixels in a rack 400
 * tall. Everything scrolled.
 *
 * So the columns are the stages. But a stage cannot hold three layers' worth of controls at a
 * legible size either — measured, ten rows of twenty-four still overflowed — and the reason those
 * plugins fit is that they have one voice, not three. Their upright panels are the stages of a
 * single path.
 *
 * The Level column therefore keeps all three layers, because which layers are on and how loud they
 * are against each other is the comparison anyone actually makes across a patch. Every other stage
 * shows the layer you are working on. Choosing a layer is a click on its level, so the selector is
 * the thing you were already looking at rather than another control to find.
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

const STAGE_ORDER = ['root', 'source', 'pitch', 'filter', 'shaper', 'resonator', 'amp']

/** Not every control deserves the same amount of face-plate. */
const HERO = ['pitch.start', 'filter.cutoff', 'resonator.frequency']
const SMALL = ['pan', 'spread', 'offset', 'jitter', 'phase', 'curve', 'partials', 'bitDepth', 'crush']
/** A level is a height, so what answers "how much" gets a fader rather than a dial. */
const FADERS = ['gain', 'mix', 'amount', 'depth', 'drive', 'resonance']

function sizeOf(id: string): 'lg' | 'md' | 'sm' {
  if (HERO.some((tail) => id.endsWith(tail))) return 'lg'
  if (SMALL.some((tail) => id.endsWith(tail))) return 'sm'
  return 'md'
}

function isFader(id: string): boolean {
  return FADERS.includes(id.split('.').pop() ?? '')
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
  const layers = categories.filter((category) => category.id !== 'mix')
  const bus = categories.find((category) => category.id === 'mix')
  const [active, setActive] = useState(0)

  const field = (parameter: ParameterDef) => {
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
    if (parameter.kind === 'number') {
      return (
        <div className="audio-slot" data-size={sizeOf(parameter.id)} key={parameter.id}>
          <AudioKnob
            param={parameter}
            value={typeof current === 'number' ? current : parameter.min}
            size={sizeOf(parameter.id)}
            onChange={(next) => onChange(parameter.id, next)}
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
          />
        </div>
      )
    }
    return (
      <div className="audio-slot" data-size="wide" key={parameter.id}>
        <ParameterField
          param={parameter}
          value={current}
          onChange={(next) => onChange(parameter.id, next)}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
      </div>
    )
  }

  return (
    <div className="audio-rack" role="group" aria-label="Signal path">
      {STAGE_ORDER.map((stage) => (
        <section className="audio-stage" data-stage={stage} key={stage} aria-label={STAGE_LABELS[stage] ?? stage}>
          <h2 className="audio-stage__title">{STAGE_LABELS[stage] ?? stage}</h2>
          {layers.map((category, index) => {
            if (stage !== 'root' && index !== active) return null
            const enabled = values[`layers[${index}].enabled`] !== false
            const group = groups.find((entry) => entry.tab === category.id && entry.id.endsWith(`.${stage}`))
            if (!group) return null
            const fields = parameters.filter((parameter) => parameter.group === group.id)
            if (fields.length === 0) return null
            // The envelope draws itself; the times and levels behind it are the shape, and the
            // shape is what a person is actually setting. Only the curve stays a field.
            const drawn = stage === 'amp'
            const shown = drawn ? fields.filter((parameter) => parameter.id.endsWith('.curve')) : fields
            return (
              <div
                className="audio-row"
                key={category.id}
                data-off={!enabled && stage !== 'root'}
                data-active={stage === 'root' && index === active ? '' : undefined}
                data-solo={stage !== 'root' || undefined}
                aria-label={`${category.label} · ${STAGE_LABELS[stage] ?? stage}`}
                role="group"
                style={{ '--section': LAYER_COLOURS[index] } as CSSProperties}
              >
                {stage === 'root' ? (
                  <button
                    type="button"
                    className="audio-row__pick"
                    aria-pressed={index === active}
                    aria-label={`Work on ${category.label}`}
                    onClick={() => setActive(index)}
                  >
                    {index + 1}
                  </button>
                ) : (
                  <span className="audio-row__tag" aria-hidden="true">{index + 1}</span>
                )}
                {!enabled && stage !== 'root' ? (
                  <p className="audio-row__off">Off</p>
                ) : (
                  <div className="audio-row__fields">
                    {drawn ? (
                      <AudioEnvelope
                        layer={index}
                        values={values}
                        duration={duration}
                        onChange={onChange}
                        onGestureStart={onGestureStart}
                        onGestureEnd={onGestureEnd}
                      />
                    ) : null}
                    {shown.map(field)}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      ))}
      {bus ? (
        <section className="audio-stage" data-stage="bus" aria-label={bus.label}>
          <h2 className="audio-stage__title">{bus.label}</h2>
          {groups.filter((group) => group.tab === bus.id).map((group) => {
            const fields = parameters.filter((parameter) => parameter.group === group.id)
            if (fields.length === 0) return null
            return (
              <div className="audio-row" key={group.id} role="group" aria-label={group.label}>
                <span className="audio-row__tag" aria-hidden="true">{group.label.slice(0, 3)}</span>
                <div className="audio-row__fields">{fields.map(field)}</div>
              </div>
            )
          })}
        </section>
      ) : null}
    </div>
  )
}
