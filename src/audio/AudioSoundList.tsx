import { memo } from 'react'
import { NavRailHead } from '@/shell/NavRailHead'
import { WaveformView } from '@/audio/WaveformView'
import { Tooltip } from '@/ui/Tooltip'
import type { RadialLayer } from '@/rigs/extended-types'
import { PRESETS, PRESET_GROUPS } from '@/audio/presets'
import type { AudioSnapshot } from '@/audio/document'
import type { AudioPatch } from '@/audio/types'

/**
 * The library, beside the instrument rather than instead of it.
 *
 * The other editors put the document's own parts in this column — the drawing's layers, the
 * scene's objects — and a patch's equivalent is the sound it currently is. Stepping through
 * ninety of them while watching the panels change is how anyone actually finds one, and that was
 * a whole view away: you picked a sound, switched back, and had already forgotten what the last
 * one did differently.
 *
 * The grid of waveform cards is still its own view. This is for reaching a sound you can name;
 * that is for not knowing and looking.
 *
 * Compact is a 48 px rail: full names do not fit, so each entry becomes a short mark with the
 * name in a tooltip — the same contract the outliner keeps when it shows icons alone.
 */
function SoundList({ current, snapshots, compact, inert, onPatch, onNavigate, wave }: {
  current: string
  snapshots: AudioSnapshot[]
  compact: boolean
  inert: boolean
  onPatch: (patch: AudioPatch, id: string) => void
  onNavigate: () => void
  /**
   * The waveform, at the foot of the rail. The reference keeps its top bar to one row and has no
   * picture of the sound at all; this one keeps the picture, but out of the bar and in the column
   * that belongs to the document, where it does not cost the face-plate a pixel of height.
   */
  wave?: { samples: Float32Array; head: number | null; profiles: RadialLayer[]; label: string }
}) {
  const choose = (patch: AudioPatch, id: string) => {
    onPatch(patch, id)
    onNavigate()
  }
  return (
    <nav className="nav-rail audio-library" aria-label="Sounds" data-compact={compact || undefined} inert={inert}>
      <NavRailHead compact={compact} noun="sounds" onNavigate={onNavigate} />
      <div className="audio-library__scroll scroll-area">
      {snapshots.length > 0 ? (
        <div className="audio-library__group">
          <h3 className="audio-library__title">Saved</h3>
          <ul className="audio-library__list">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <SoundItem
                  label={snapshot.name}
                  current={snapshot.id === current}
                  compact={compact}
                  onClick={() => choose(snapshot.patch, snapshot.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {PRESET_GROUPS.map((group) => (
        <div className="audio-library__group" key={group}>
          <h3 className="audio-library__title">{group}</h3>
          <ul className="audio-library__list">
            {PRESETS.filter((preset) => preset.group === group).map((preset) => (
              <li key={preset.id}>
                <SoundItem
                  label={preset.label}
                  current={preset.id === current}
                  compact={compact}
                  onClick={() => choose(preset.build(), preset.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
      </div>
      {wave && !compact ? (
        <div className="audio-library__wave" aria-label="Waveform">
          <WaveformView samples={wave.samples} label={wave.label} head={wave.head} profiles={wave.profiles} />
        </div>
      ) : null}
    </nav>
  )
}

/** One or two letters that fit the compact rail; the full name lives in the tooltip and aria-label. */
function compactMark(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    const a = parts[0]?.[0]
    const b = parts[1]?.[0]
    if (a && b) return (a + b).toUpperCase()
  }
  return (parts[0]?.[0] ?? '?').toUpperCase()
}

function SoundItem({ label, current, compact, onClick }: {
  label: string
  current: boolean
  compact: boolean
  onClick: () => void
}) {
  const button = (
    <button
      type="button"
      className="audio-library__item"
      aria-label={label}
      aria-current={current ? 'true' : undefined}
      onClick={onClick}
    >
      {compact ? <span className="audio-library__mark" aria-hidden="true">{compactMark(label)}</span> : label}
    </button>
  )
  if (!compact) return button
  return <Tooltip content={label} side="right">{button}</Tooltip>
}

/*
 * Memoised, because it is beside the instrument now rather than a view away: every knob turn
 * re-renders the editor, and ninety-two buttons rebuilt on each one is a cost the rail has no
 * reason to pay. Only `current` moves.
 */
export const AudioSoundList = memo(SoundList)
