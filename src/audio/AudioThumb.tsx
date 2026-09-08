import { useMemo } from 'react'
import { renderPatch } from '@/audio/dsp/render'
import { audioRigDefaults, resolveAudioValues } from '@/audio/rig'
import { waveformBands } from '@/audio/waveform'
import type { AudioDocument } from '@/audio/document'

/**
 * A patch on a library card.
 *
 * Rendered at a fraction of the playback rate: a card is eighty pixels of waveform and no one is
 * listening to it, so eight kilohertz says the same thing for a sixth of the work. It is drawn as
 * an SVG rather than a canvas because a library is a grid of these and a canvas apiece would mean
 * a context apiece.
 */

const THUMB_RATE = 8000
const COLUMNS = 96

export function AudioThumb({ document }: { document: AudioDocument }) {
  const path = useMemo(() => {
    // A rigged patch is shown the way its controls rest, which is what it sounds like new.
    const patch = document.rig ? resolveAudioValues(document, audioRigDefaults(document.rig)) : document.patch
    const bands = waveformBands(renderPatch(patch, THUMB_RATE), COLUMNS)
    const top = bands.map((band, index) => `${index === 0 ? 'M' : 'L'}${index},${(1 - band.max) * 50}`).join('')
    const bottom = bands.map((band, index) => `L${bands.length - 1 - index},${(1 - (bands[bands.length - 1 - index]?.min ?? 0)) * 50}`).join('')
    return `${top}${bottom}Z`
  }, [document])

  return (
    <svg className="audio-thumb" viewBox={`0 0 ${COLUMNS - 1} 100`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="50" x2={COLUMNS - 1} y2="50" />
      <path d={path} />
    </svg>
  )
}
