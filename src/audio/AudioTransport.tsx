import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { IconPlay, IconStart } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { WaveformView } from '@/audio/WaveformView'
import { decibels, stereoLevels } from '@/audio/waveform'
import { monoSum } from '@/audio/dsp/render'
import { usePlayKey, type Transport } from '@/audio/useTransport'
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
export function AudioTransport({ samples, sampleRate, name, patch, autoPlay, onAutoPlay, tools, transport, compact = false }: {
  samples: Stereo
  sampleRate: number
  name: string
  /** Drawn over the sum as coloured envelopes, so the architecture of the sound is visible. */
  patch?: AudioPatch
  autoPlay: boolean
  onAutoPlay: (next: boolean) => void
  /** Whatever else belongs on the band: the preset menu and the two generators, in Edit. */
  tools?: ReactNode
  /**
   * The playback state, owned by whoever renders this. It used to be created here, which was fine
   * while the waveform lived here too; once the picture moved into the rail it needed the same
   * playhead, and two of these hooks would be two audio pipelines playing over each other.
   */
  transport: Transport
  /** One row and no picture: the reference's top bar, with the waveform drawn elsewhere. */
  compact?: boolean
}) {
  const { playing, head, silent, play, stop } = transport
  const seconds = samples.left.length / Math.max(1, sampleRate)
  // The picture and the numbers are of the sum: what is drawn is what the room hears, not one side.
  const mono = useMemo(() => monoSum(samples), [samples])
  const { peak, rms } = stereoLevels(samples)
  const first = useRef(true)

  /**
   * The level at the playhead, a channel each, held and let down rather than followed exactly.
   *
   * A window of a millisecond and a half is short enough to show a transient and long enough not
   * to flicker on a single sample. The fall is what makes it readable: a meter that tracked the
   * waveform would be a blur on a sound this short.
   */
  const held = useRef({ left: 0, right: 0 })
  const live = (() => {
    if (!playing || head === null) {
      held.current = { left: 0, right: 0 }
      return held.current
    }
    const at = Math.round(head * sampleRate)
    const window = Math.max(1, Math.round(sampleRate * 0.0015))
    let left = 0
    let right = 0
    for (let i = Math.max(0, at - window); i < Math.min(samples.left.length, at + 1); i += 1) {
      left = Math.max(left, Math.abs(samples.left[i] ?? 0))
      right = Math.max(right, Math.abs(samples.right[i] ?? 0))
    }
    held.current = {
      left: Math.max(left, held.current.left * 0.82),
      right: Math.max(right, held.current.right * 0.82),
    }
    return held.current
  })()

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
    <div className="audio-transport" data-compact={compact || undefined}>
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
      {compact ? null : <div className="audio-transport__wave">
        <WaveformView samples={mono} label={name} head={head} profiles={patch ? layerProfiles(patch) : []} />
      </div>}
      {/*
        * The meter: what is leaving the master at the playhead, both channels.
        *
        * Read out of the buffer that is playing rather than off an analyser node, because the
        * buffer is the truth — the same samples the exporter writes — and an analyser would be a
        * second account of them that could disagree. It falls back rather than snapping, the way
        * a meter does, so a two-hundred-millisecond sound leaves something to look at.
        */}
      <div className="audio-meter" role="img" aria-label={`Output level, peak ${decibels(peak)}`}>
        <span className="audio-meter__side" style={{ '--level': live.left } as CSSProperties} data-hot={live.left > 0.98 || undefined} />
        <span className="audio-meter__side" style={{ '--level': live.right } as CSSProperties} data-hot={live.right > 0.98 || undefined} />
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
        <p className="audio-transport__notice" role="status" aria-label="Playback notice">
          This browser gives the page no audio device, so nothing can be played here.
        </p>
      ) : null}
    </div>
  )
}
