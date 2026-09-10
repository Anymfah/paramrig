import { useMemo } from 'react'
import { monoSum, renderPatch } from '@/audio/dsp/render'
import { waveformBands } from '@/audio/waveform'
import type { AudioPatch } from '@/audio/types'

/**
 * A patch on a library card.
 *
 * Rendered at a fraction of the playback rate: a card is eighty pixels of waveform and no one is
 * listening to it. It is drawn as an SVG rather than a canvas because a library is a grid of these
 * and a canvas apiece would mean a context apiece.
 *
 * Eight kilohertz was that fraction, and it was too low to be honest. Half the interface family
 * lives above four thousand hertz — a tick, a warning, anything with air in it — and at eight the
 * ceiling cuts it off: a third of the library drew at under a fifth of the level it plays at, and
 * one sound whose partials all sit high drew a flat line. Sixteen is twice the work and puts the
 * ceiling above everything the library actually makes.
 */

const THUMB_RATE = 16000
const COLUMNS = 96

export function AudioThumb({ patch }: { patch: AudioPatch }) {
  const path = useMemo(() => {
    const bands = waveformBands(monoSum(renderPatch(patch, THUMB_RATE)), COLUMNS)
    // Out along the peaks, back along the troughs, and closed: one filled shape rather than a
    // stroke, which stays legible at a card's size where a 1px line would break up.
    const top = bands.map((band, index) => `${index === 0 ? 'M' : 'L'}${index},${(1 - band.max) * 50}`).join('')
    const bottom = [...bands].reverse().map((band, index) => `L${bands.length - 1 - index},${(1 - band.min) * 50}`).join('')
    return `${top}${bottom}Z`
  }, [patch])

  return (
    <svg className="audio-thumb" viewBox={`0 0 ${COLUMNS - 1} 100`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="50" x2={COLUMNS - 1} y2="50" />
      <path d={path} />
    </svg>
  )
}
