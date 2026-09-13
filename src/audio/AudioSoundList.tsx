import { memo, type KeyboardEvent, type ReactNode } from 'react'
import { NavRailHead } from '@/shell/NavRailHead'
import { WaveformView } from '@/audio/WaveformView'
import { Tooltip } from '@/ui/Tooltip'
import type { RadialLayer } from '@/rigs/extended-types'
import { PRESETS, PRESET_GROUPS } from '@/audio/presets'
import { compactMark } from '@/audio/marks'
import { moveSoundFocus } from '@/audio/sound-keys'
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
function SoundList({ current, snapshots, compact, inert, onPatch, onNavigate, wave, deck }: {
  current: string
  snapshots: AudioSnapshot[]
  compact: boolean
  inert: boolean
  onPatch: (patch: AudioPatch, id: string) => void
  onNavigate: () => void
  /**
   * The waveform, at the foot of the rail. The reference keeps its top bar to one row and has no
   * picture of the sound at all; this one keeps the picture, but out of the column
   * that belongs to the document, where it does not cost the face-plate a pixel of height.
   */
  wave?: { samples: Float32Array; head: number | null; profiles: RadialLayer[]; label: string }
  /** Hearing and keeping, in a sub-header above the names they act on. */
  deck?: ReactNode
}) {
  const catalog = [
    ...snapshots.map((snapshot) => ({ id: snapshot.id, label: snapshot.name, patch: () => snapshot.patch })),
    ...PRESET_GROUPS.flatMap((group) => PRESETS.filter((preset) => preset.group === group).map((preset) => ({
      id: preset.id,
      label: preset.label,
      patch: () => preset.build(),
    }))),
  ]
  const choose = (patch: AudioPatch, id: string) => {
    onPatch(patch, id)
    onNavigate()
  }
  const onKeys = (event: KeyboardEvent<HTMLElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('.audio-library__item')]
    const next = moveSoundFocus(event.nativeEvent, items, 1)
    if (next === null) return
    const entry = catalog[next]
    if (!entry) return
    choose(entry.patch(), entry.id)
    const button = items[next]
    button?.focus()
    button?.scrollIntoView?.({ block: 'nearest' })
  }
  return (
    <nav className="nav-rail audio-library" aria-label="Sounds" data-compact={compact || undefined} inert={inert} onKeyDown={onKeys}>
      <NavRailHead compact={compact} noun="sounds" onNavigate={onNavigate} />
      {deck}
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
                  tabIndex={snapshot.id === current || (current === '' && snapshot.id === catalog[0]?.id) ? 0 : -1}
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
                  tabIndex={preset.id === current || (current === '' && preset.id === catalog[0]?.id) ? 0 : -1}
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

function SoundItem({ label, current, compact, tabIndex, onClick }: {
  label: string
  current: boolean
  compact: boolean
  tabIndex: number
  onClick: () => void
}) {
  const button = (
    <button
      type="button"
      className="audio-library__item"
      aria-label={label}
      aria-current={current ? 'true' : undefined}
      tabIndex={tabIndex}
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
