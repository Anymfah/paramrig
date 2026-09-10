import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { IconDownload, IconPlay, IconStart } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'
import { WaveformView } from '@/audio/WaveformView'
import { decibels, meterAt, stereoLevels } from '@/audio/waveform'
import { monoSum, renderPatch } from '@/audio/dsp/render'
import { encodeWav } from '@/audio/dsp/wav'
import { usePlayKey, type Transport } from '@/audio/useTransport'
import { layerProfiles } from '@/audio/profiles'
import type { AudioPatch, Stereo } from '@/audio/types'

/**
 * The rate a file is written at, whatever the machine happens to play at.
 *
 * `playback.ts` says this in as many words — a file has to mean the same thing on a machine that is
 * not this one — and until now nothing in the application wrote one: the encoder existed, was
 * tested, and was reachable only from a Node script. A generator of sound effects that cannot hand
 * you the sound is missing its last step.
 */
const EXPORT_RATE = 44100

/** A file name from a sound's name: lower case, words joined by hyphens, nothing else. */
const fileName = (name: string) =>
  `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sound'}.wav`

function saveWav(patch: AudioPatch, name: string): void {
  const blob = new Blob([encodeWav(renderPatch(patch, EXPORT_RATE), EXPORT_RATE) as BlobPart], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName(name)
  link.click()
  // Freed on the next turn of the loop: revoking it in the same one races the click in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

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
  // Walks the whole buffer, and this component re-renders on every frame of the playhead.
  const { peak, rms } = useMemo(() => stereoLevels(samples), [samples])
  /**
   * The level at the playhead, a channel each, held and let down rather than followed exactly.
   *
   * It used to be a ref carried from frame to frame, written while rendering. That is a lie React
   * is entitled to catch: a component rendered twice for the same playhead let the needle down
   * twice, and a re-render from anything else — a knob moved during playback — let it down again
   * out of time. `meterAt` reads the fall out of the buffer instead, so the needle is a function
   * of where the playhead is and nothing else.
   */
  const live = playing && head !== null
    ? meterAt(samples, head * sampleRate, sampleRate)
    : { left: 0, right: 0 }

  // Space retriggers rather than toggling. These sounds are two hundred milliseconds long: nobody
  // needs to stop one, they need to hear it again, and waiting for the tail before the next press
  // does anything turns a comparison into a queue. The button still toggles, so there is a way to
  // stop a long tail.
  usePlayKey(play)

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
      {patch ? (
        <Tooltip content={`Save this sound as a ${EXPORT_RATE / 1000} kHz WAV`}>
          <IconButton label="Save as WAV" onClick={() => saveWav(patch, name)}><IconDownload /></IconButton>
        </Tooltip>
      ) : null}
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
