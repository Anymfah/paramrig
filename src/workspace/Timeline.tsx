import type { AnimTrack } from '@/rigs/types'
import { IconKeyframe, IconPause, IconPlay } from '@/ui/icons'
import { Button, IconButton } from '@/ui/Button'
import { SwitchField } from '@/ui/SwitchField'
import { Tooltip } from '@/ui/Tooltip'
import type { RigSession } from '@/state/session'
import { updatePrefs, usePlayhead, useWorkspace } from '@/state/workspace'
import { interpolateNumber } from '@/state/values'

type TimelineProps = {
  session: RigSession
}

function formatTime(value: number): string {
  if (value < 60) return value.toFixed(2).padStart(5, '0')
  const minutes = Math.floor(value / 60)
  const seconds = value % 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`
}

export function Timeline({ session }: TimelineProps) {
  const playhead = usePlayhead(session)
  const { prefs } = useWorkspace()
  const snapshot = session.getSnapshot()
  const { duration, playing, loop, fps, tracks } = snapshot

  if (prefs.timelineCollapsed) {
    return (
      <section className="timeline timeline--stub" aria-label="Timeline">
        <button type="button" className="timeline-stub" onClick={() => updatePrefs({ timelineCollapsed: false })}>
          Show timeline
        </button>
      </section>
    )
  }

  return (
    <section className="timeline" aria-label="Timeline" style={{ height: 'var(--timeline-height)' }}>
      <div className="timeline__head">
        <div className="timeline__title">
          <strong>Timeline</strong>
          <Tooltip content="Hide timeline">
            <Button variant="quiet" size="sm" aria-label="Hide timeline" onClick={() => updatePrefs({ timelineCollapsed: true })}>
              Hide
            </Button>
          </Tooltip>
        </div>
        <div className="timeline__controls">
          <Tooltip content={playing ? 'Pause' : 'Play'}>
            <IconButton label={playing ? 'Pause' : 'Play'} onClick={() => session.setPlaying(!playing)}>
              {playing ? <IconPause /> : <IconPlay />}
            </IconButton>
          </Tooltip>
          <span className="timeline__time">
            {formatTime(playhead)} / {formatTime(duration)} s
          </span>
          <SwitchField label="Loop" checked={loop} onChange={(next) => session.setLoop(next)} />
          <span className="timeline__fps">{fps} fps</span>
        </div>
      </div>
      <div className="ruler" aria-hidden="true">
        {Array.from({ length: Math.floor(duration) + 1 }, (_, i) => (
          <span key={i}>{i}s</span>
        ))}
      </div>
      <div className="scrubber-row">
        <input
          className="slider scrubber"
          type="range"
          min={0}
          max={duration}
          step={1 / fps}
          value={playhead}
          aria-label="Playhead"
          aria-valuetext={`${playhead.toFixed(2)} seconds`}
          onChange={(event) => session.setPlayhead(Number(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === 'Home') {
              event.preventDefault()
              session.setPlayhead(0)
            }
            if (event.key === 'End') {
              event.preventDefault()
              session.setPlayhead(duration)
            }
          }}
        />
        <span className="playhead-cap" style={{ left: `${duration ? (playhead / duration) * 100 : 0}%` }} aria-hidden="true" />
      </div>
      <div className="timeline__tracks scroll-area">
        <div className="timeline__labels">
          {tracks.map((track) => (
            <div className="timeline-row" key={track.paramId}>
              <span>
                <IconKeyframe /> {labelFor(track.paramId, session)}
              </span>
              <span className="timeline__time">
                {formatTrackValue(track, playhead, duration, loop, session)}
              </span>
            </div>
          ))}
        </div>
        <div>
          {tracks.map((track) => (
            <div className="timeline-lane" key={track.paramId}>
              {track.keyframes.map((frame) => (
                <Tooltip key={frame.time} content={`${labelFor(track.paramId, session)} at ${frame.time.toFixed(2)}s`}>
                  <button
                    type="button"
                    className="timeline-key"
                    style={{ left: `${(frame.time / duration) * 100}%` }}
                    aria-label={`${labelFor(track.paramId, session)} keyframe at ${frame.time.toFixed(2)} seconds, value ${frame.value}`}
                    onClick={() => session.setPlayhead(frame.time)}
                  >
                    <IconKeyframe />
                  </button>
                </Tooltip>
              ))}
              <span className="playhead" style={{ left: `${(playhead / duration) * 100}%` }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function labelFor(id: string, session: RigSession): string {
  return session.parameters.find((param) => param.id === id)?.label ?? id
}

function formatTrackValue(
  track: AnimTrack,
  playhead: number,
  duration: number,
  loop: boolean,
  session: RigSession,
): string {
  const value = interpolateNumber(track, playhead, duration, loop)
  const param = session.parameters.find((item) => item.id === track.paramId)
  const unit = param && param.kind === 'number' ? param.unit : undefined
  if (unit === '°') return `${Math.round(value)}${unit}`
  if (unit) return `${value.toFixed(2)} ${unit}`
  return value.toFixed(2)
}
