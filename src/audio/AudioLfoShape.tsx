import { useMemo } from 'react'
import type { ParamValue } from '@/rigs/types'
import { createLfoState, lfoAt } from '@/audio/dsp/lfo'
import { mulberry32 } from '@/audio/dsp/rng'
import type { Lfo, LfoShape } from '@/audio/types'

/**
 * What the modulator is doing, drawn over the length of the sound.
 *
 * Rate is the parameter nobody can read as a number: five hertz means one thing on a coin and
 * seven cycles on a warp. Against the patch's own duration you see how many times it goes round
 * before the sound is over, which is the only form of the question anyone actually has.
 */
const SAMPLES = 160

export function AudioLfoShape({ index, values, duration }: {
  index: number
  values: Record<string, ParamValue>
  duration: number
}) {
  const lfo = useMemo<Lfo>(() => {
    const read = (field: string) => values[`lfos[${index}].${field}`]
    return {
      enabled: read('enabled') !== false,
      shape: (typeof read('shape') === 'string' ? read('shape') : 'sine') as LfoShape,
      rate: typeof read('rate') === 'number' ? (read('rate') as number) : 5,
      depth: typeof read('depth') === 'number' ? (read('depth') as number) : 0.3,
      phase: typeof read('phase') === 'number' ? (read('phase') as number) : 0,
      target: typeof read('target') === 'string' ? (read('target') as string) : 'off',
    }
  }, [index, values])

  const path = useMemo(() => {
    const random = mulberry32(index + 1)
    const state = createLfoState(random)
    return Array.from({ length: SAMPLES + 1 }, (_, step) => {
      const at = (step / SAMPLES) * Math.max(0.02, duration)
      const value = lfoAt(lfo, at, state, random) * lfo.depth
      return `${step === 0 ? 'M' : 'L'}${((step / SAMPLES) * 100).toFixed(2)},${(50 - value * 46).toFixed(2)}`
    }).join('')
    // The whole shape depends on every field of it, so the object is the dependency.
  }, [duration, index, lfo])

  const idle = !lfo.enabled || lfo.target === 'off'
  return (
    <div className="lfo-shape" data-idle={idle || undefined}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line className="lfo-shape__mid" x1="0" y1="50" x2="100" y2="50" />
        <path className="lfo-shape__line" d={path} />
      </svg>
      <p className="lfo-shape__read">
        {idle ? 'Not assigned' : `${(lfo.rate * duration).toFixed(1)} cycles over the sound`}
      </p>
    </div>
  )
}
