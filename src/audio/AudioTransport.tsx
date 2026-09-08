import { useEffect, useRef } from 'react'
import { IconPlay, IconStart } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { WaveformView } from '@/audio/WaveformView'
import { decibels, levels } from '@/audio/waveform'
import { usePlayKey, useTransport } from '@/audio/useTransport'

/**
 * The transport, and the one loud control on the page.
 *
 * The waveform lives here, at the size it deserves. A sound is judged by ear; the picture of it
 * only ever answers "did the shape come out the way I meant" — an attack that bites, a tail that
 * ends — and a strip answers that as well as a panel does. The room it used to take belongs to the
 * parameters, which are the thing you actually look at while working.
 */
export function AudioTransport({ samples, sampleRate, name, autoPlay, onAutoPlay }: {
  samples: Float32Array
  sampleRate: number
  name: string
  autoPlay: boolean
  onAutoPlay: (next: boolean) => void
}) {
  const { playing, head, silent, play, stop } = useTransport(samples, sampleRate)
  const seconds = samples.length / Math.max(1, sampleRate)
  const { peak, rms } = levels(samples)
  const first = useRef(true)

  usePlayKey(() => { if (playing) stop(); else play() })

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
        <WaveformView samples={samples} label={name} head={head} />
      </div>
      <dl className="audio-transport__figures">
        <div><dt>Length</dt><dd>{seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`}</dd></div>
        <div><dt>Peak</dt><dd>{decibels(peak)}</dd></div>
        <div><dt>RMS</dt><dd>{decibels(rms)}</dd></div>
        <div><dt>Rate</dt><dd>{Math.round(sampleRate / 1000)} kHz</dd></div>
      </dl>
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
