import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { IconDownload, IconHand, IconLoop, IconPlay, IconStart } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'
import { WaveformView } from '@/audio/WaveformView'
import { decibels, meterAt, stereoLevels } from '@/audio/waveform'
import { monoSum } from '@/audio/dsp/render'
import { usePlayKey, type Transport } from '@/audio/useTransport'
import { layerProfiles } from '@/audio/profiles'
import { EXPORT_RATE, saveWav } from '@/audio/wav-file'
import type { AudioPatch, Stereo } from '@/audio/types'

export type HearingMode = 'oneshot' | 'repeat' | 'hold'

/**
 * Play, and how the next press is heard. One-shot is the default: Repeat and Hold toggle off to it.
 * A tweak plays too, so this cluster is the whole of hearing.
 */
export function AudioHearing({ transport, live = false, hearing = 'oneshot', onHearing, recording = false, onRecord, side = 'top' }: {
  transport: Transport
  live?: boolean
  hearing?: HearingMode
  onHearing?: (next: HearingMode) => void
  recording?: boolean
  onRecord?: () => void
  side?: 'top' | 'right'
}) {
  const { playing, play, stop } = transport
  return (
    <div className="audio-transport__hearing" role="group" aria-label="Hearing">
      <Tooltip content={playing || live ? 'Stop (Space retriggers; the button stops)' : 'Play (Space retriggers; a tweak plays too)'} side={side}>
        <button
          type="button"
          className="btn btn--solid audio-transport__play"
          aria-label={playing || live ? 'Stop' : 'Play'}
          onClick={() => ((playing || live) ? stop() : play())}
        >
          {playing || live ? <IconStart /> : <IconPlay />}
        </button>
      </Tooltip>
      {onHearing ? (
        <div className="audio-transport__modes">
          <Tooltip content={hearing === 'repeat' ? 'Stop repeating' : 'Repeat the sound while you work'} side={side}>
            <button type="button" className="audio-transport__mode" aria-pressed={hearing === 'repeat'} aria-label="Repeat" onClick={() => onHearing(hearing === 'repeat' ? 'oneshot' : 'repeat')}>
              <IconLoop />
            </button>
          </Tooltip>
          <Tooltip content={hearing === 'hold' ? 'Release the hold' : 'Hold the source, then release'} side={side}>
            <button type="button" className="audio-transport__mode" aria-pressed={hearing === 'hold'} aria-label="Hold" onClick={() => onHearing(hearing === 'hold' ? 'oneshot' : 'hold')}>
              <IconHand />
            </button>
          </Tooltip>
          {onRecord ? (
            <Tooltip content={recording ? 'Stop recording this macro' : 'Record a gesture of the armed macro'} side={side}>
              <button type="button" className="audio-transport__mode" aria-pressed={recording} aria-label={recording ? 'Stop recording' : 'Record gesture'} onClick={onRecord}>
                <span className="audio-transport__rec" aria-hidden="true" />
              </button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function AudioTransport({ samples, sampleRate, name, patch, tools, transport, compact = false, hearing = 'oneshot', onHearing, live = false, livePeak = 0, liveLeft, liveRight, recording = false, onRecord, play = true }: {
  samples: Stereo
  sampleRate: number
  name: string
  /** Drawn over the sum as coloured envelopes, so the architecture of the sound is visible. */
  patch?: AudioPatch
  tools?: ReactNode
  transport: Transport
  compact?: boolean
  hearing?: HearingMode
  onHearing?: (next: HearingMode) => void
  /** True while the worklet is the source of what is heard. */
  live?: boolean
  livePeak?: number
  liveLeft?: number
  liveRight?: number
  recording?: boolean
  onRecord?: () => void
  /** False when play and hearing live on the library instead. Space still retriggers. */
  play?: boolean
}) {
  const { playing, head, silent } = transport
  const seconds = samples.left.length / Math.max(1, sampleRate)
  const mono = useMemo(() => monoSum(samples), [samples])
  const { peak, rms } = useMemo(() => stereoLevels(samples), [samples])
  const liveMeters = live
    ? { left: liveLeft ?? livePeak, right: liveRight ?? livePeak }
    : playing && head !== null
      ? meterAt(samples, head * sampleRate, sampleRate)
      : { left: 0, right: 0 }
  const shownPeak = live ? livePeak : peak
  const shownHead = live ? null : head

  // Space retriggers rather than toggling. These sounds are two hundred milliseconds long: nobody
  // needs to stop one, they need to hear it again, and waiting for the tail before the next press
  // does anything turns a comparison into a queue. The button still toggles, so there is a way to
  // stop a long tail.
  usePlayKey(transport.play)

  return (
    <div className="audio-transport" data-compact={compact || undefined} data-live={live || undefined}>
      {play ? (
        <AudioHearing
          transport={transport}
          live={live}
          hearing={hearing}
          onHearing={onHearing}
          recording={recording}
          onRecord={onRecord}
        />
      ) : null}
      {compact ? null : <div className="audio-transport__wave">
        <WaveformView samples={mono} label={name} head={shownHead} profiles={patch ? layerProfiles(patch) : []} />
      </div>}
      <div className="audio-meter" role="img" aria-label={`Output level, peak ${decibels(shownPeak)}`}>
        <span className="audio-meter__side" style={{ '--level': liveMeters.left } as CSSProperties} data-hot={liveMeters.left > 0.98 || undefined} />
        <span className="audio-meter__side" style={{ '--level': liveMeters.right } as CSSProperties} data-hot={liveMeters.right > 0.98 || undefined} />
      </div>
      <dl className="audio-transport__figures">
        <div><dt>Length</dt><dd>{seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`}</dd></div>
        <div data-live-meter={live || undefined}><dt>{live ? 'Live' : 'Peak'}</dt><dd>{decibels(shownPeak)}</dd></div>
        <div><dt>RMS</dt><dd>{live ? '—' : decibels(rms)}</dd></div>
        <div><dt>Rate</dt><dd>{Math.round(sampleRate / 1000)} kHz</dd></div>
      </dl>
      {tools}
      {play && patch ? (
        <Tooltip content={`Save this sound as a ${EXPORT_RATE / 1000} kHz WAV`}>
          <IconButton label="Save as WAV" onClick={() => saveWav(patch, name)}><IconDownload /></IconButton>
        </Tooltip>
      ) : null}
      {silent ? (
        <p className="audio-transport__notice" role="status" aria-label="Playback notice">
          This browser gives the page no audio device, so nothing can be played here.
        </p>
      ) : null}
    </div>
  )
}
