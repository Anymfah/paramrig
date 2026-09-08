import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { IconPlay, IconStart } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { WaveformView } from '@/audio/WaveformView'
import { decibels, stereoLevels } from '@/audio/waveform'
import { monoSum } from '@/audio/dsp/render'
import { usePlayKey, useTransport } from '@/audio/useTransport'
import { layerProfiles } from '@/audio/profiles'
import type { AudioPatch, Stereo } from '@/audio/types'

/**
 * The transport, and the one loud control on the page.
 *
 * The waveform lives here, at the size it deserves. A sound is judged by ear; the picture of it
 * only ever answers "did the shape come out the way I meant" — an attack that bites, a tail that
 * ends — and a strip answers that as well as a panel does. The room it used to take belongs to the
 * parameters, which are the thing you actually look at while working.
 */
export function AudioTransport({ samples, sampleRate, name, patch, autoPlay, onAutoPlay, tools }: {
  samples: Stereo
  sampleRate: number
  name: string
  /** Drawn over the sum as coloured envelopes, so the architecture of the sound is visible. */
  patch?: AudioPatch
  autoPlay: boolean
  onAutoPlay: (next: boolean) => void
  /** Whatever else belongs on the band: the preset menu and the two generators, in Edit. */
  tools?: ReactNode
}) {
  const { playing, head, silent, play, stop } = useTransport(samples, sampleRate)
  const seconds = samples.left.length / Math.max(1, sampleRate)
  // The picture and the numbers are of the sum: what is drawn is what the room hears, not one side.
  const mono = useMemo(() => monoSum(samples), [samples])
  const { peak, rms } = stereoLevels(samples)
  const first = useRef(true)

  // Space retriggers rather than toggling. These sounds are two hundred milliseconds long: nobody
  // needs to stop one, they need to hear it again, and waiting for the tail before the next press
  // does anything turns a comparison into a queue. The button still toggles, so there is a way to
  // stop a long tail.
  usePlayKey(play)

  useEffect(() => {
    // Not on arrival: a workspace that starts making noise the moment it opens is a workspace
    // people turn off. Auto-play answers a change, and there has not been one yet.
    if (first.current) {
      first.current = false
      return
    }
    if (autoPlay) play()
  }, [samples, autoPlay, play])

  return (
    <div className="audio-transport">
      <Tooltip content={playing ? 'Stop (Space)' : 'Play (Space)'}>
        <button
          type="button"
          className="btn btn--solid audio-transport__play"
          aria-label={playing ? 'Stop' : 'Play'}
          onClick={() => (playing ? stop() : play())}
        >
          {playing ? <IconStart /> : <IconPlay />}
        </button>
      </Tooltip>
      <div className="audio-transport__wave">
        <WaveformView samples={mono} label={name} head={head} profiles={patch ? layerProfiles(patch) : []} />
      </div>
      <dl className="audio-transport__figures">
        <div><dt>Length</dt><dd>{seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`}</dd></div>
        <div><dt>Peak</dt><dd>{decibels(peak)}</dd></div>
        <div><dt>RMS</dt><dd>{decibels(rms)}</dd></div>
        <div><dt>Rate</dt><dd>{Math.round(sampleRate / 1000)} kHz</dd></div>
      </dl>
      {tools}
      <Tooltip content={autoPlay ? 'Every change plays itself' : 'Changes are silent until you press play'}>
        <button
          type="button"
          className="btn btn--quiet btn--sm audio-transport__auto"
          aria-pressed={autoPlay}
          onClick={() => onAutoPlay(!autoPlay)}
        >
          Auto
        </button>
      </Tooltip>
      {silent ? (
        <p className="audio-transport__notice" role="status">
          This browser gives the page no audio device, so nothing can be played here.
        </p>
      ) : null}
    </div>
  )
}
