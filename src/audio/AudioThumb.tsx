import { memo, useEffect, useReducer } from 'react'
import { monoSum, renderPatch } from '@/audio/dsp/render'
import { waveformBands, type WaveformBand } from '@/audio/waveform'
import type { AudioPatch } from '@/audio/types'

/**
 * A patch on a library card.
 *
 * Drawn as an SVG rather than a canvas because a library is a grid of these and a canvas apiece
 * would mean a context apiece.
 *
 * Rendered at the rate the sound is actually played at, which it was not. A card used to be
 * rendered at sixteen kilohertz on the reasoning that nobody is listening to it — but a modal body
 * is only alive while its partials fit under Nyquist, and this instrument builds its interface
 * family out of bodies at eight to thirteen kilohertz on purpose. Below the ceiling they are not
 * quiet, they are *gone*: twenty-seven of the hundred and six sounds drew at under half their real
 * height, five under a fifth, and a few as a flat line with the strike and no ring. A picture of a
 * sound that is missing the sound is not a cheaper picture, it is a wrong one.
 *
 * The cost that bought is paid once. The bands are kept in a module-level cache under the card's
 * own key — a shipped patch never changes, and a kept one changes only when it is written over —
 * so leaving the Sounds tab and coming back, or typing in the search and clearing it, costs
 * nothing at all. And the first pass is spread over idle time rather than run in one commit: a
 * card arrives as its baseline and fills in a moment later, instead of a hundred and six renders
 * blocking the tab for a second and a half.
 */

const RATE = 44100
const COLUMNS = 96

const drawn = new Map<string, WaveformBand[]>()

/** One card at a time, so opening the library does not synthesise a hundred sounds in one turn. */
const waiting: Array<() => void> = []
let pumping = false

function pump(): void {
  if (pumping) return
  const work = waiting.shift()
  if (!work) return
  pumping = true
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback
  const run = () => {
    work()
    pumping = false
    pump()
  }
  if (typeof idle === 'function') idle(run, { timeout: 2000 })
  else setTimeout(run, 0)
}

/** Idle time where the browser offers it, and the back of the queue where it does not. */
function soon(work: () => void): () => void {
  waiting.push(work)
  pump()
  return () => {
    const at = waiting.indexOf(work)
    if (at >= 0) waiting.splice(at, 1)
  }
}

export const AudioThumb = memo(function AudioThumb({ patch, id }: {
  patch: AudioPatch
  /**
   * What this card is, so its picture can be kept. A shipped preset's id is enough; a kept sound
   * needs the moment it was written too, because Replace puts a different patch under one name.
   */
  id: string
}) {
  const bands = drawn.get(id)
  const [, redraw] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    if (drawn.has(id)) return
    let alive = true
    return soon(() => {
      drawn.set(id, waveformBands(monoSum(renderPatch(patch, RATE)), COLUMNS))
      if (alive) redraw()
      alive = false
    })
  }, [id, patch])

  // Out along the peaks, back along the troughs, and closed: one filled shape rather than a
  // stroke, which stays legible at a card's size where a 1px line would break up.
  const top = (bands ?? []).map((band, index) => `${index === 0 ? 'M' : 'L'}${index},${(1 - band.max) * 50}`).join('')
  const bottom = [...(bands ?? [])].reverse().map((band, index) => `L${COLUMNS - 1 - index},${(1 - band.min) * 50}`).join('')

  return (
    <svg className="audio-thumb" viewBox={`0 0 ${COLUMNS - 1} 100`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="50" x2={COLUMNS - 1} y2="50" />
      {bands ? <path d={`${top}${bottom}Z`} /> : null}
    </svg>
  )
})
