import { memo } from 'react'
import { NavRailHead } from '@/shell/NavRailHead'
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
 */
function SoundList({ current, snapshots, compact, inert, onPatch, onNavigate }: {
  current: string
  snapshots: AudioSnapshot[]
  compact: boolean
  inert: boolean
  onPatch: (patch: AudioPatch, id: string) => void
  onNavigate: () => void
}) {
  const choose = (patch: AudioPatch, id: string) => {
    onPatch(patch, id)
    onNavigate()
  }
  return (
    <nav className="nav-rail audio-library scroll-area" aria-label="Sounds" data-compact={compact || undefined} inert={inert}>
      <NavRailHead compact={compact} noun="sounds" onNavigate={onNavigate} />
      {snapshots.length > 0 ? (
        <div className="audio-library__group">
          <h3 className="audio-library__title">Saved</h3>
          <ul className="audio-library__list">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <button
                  type="button"
                  className="audio-library__item"
                  aria-current={snapshot.id === current ? 'true' : undefined}
                  onClick={() => choose(snapshot.patch, snapshot.id)}
                >
                  {snapshot.name}
                </button>
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
                <button
                  type="button"
                  className="audio-library__item"
                  aria-current={preset.id === current ? 'true' : undefined}
                  onClick={() => choose(preset.build(), preset.id)}
                >
                  {preset.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/*
 * Memoised, because it is beside the instrument now rather than a view away: every knob turn
 * re-renders the editor, and ninety-two buttons rebuilt on each one is a cost the rail has no
 * reason to pay. Only `current` moves.
 */
export const AudioSoundList = memo(SoundList)
