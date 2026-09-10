import { useId, useMemo, useState } from 'react'
import { AudioThumb } from '@/audio/AudioThumb'
import { PRESETS, PRESET_GROUPS } from '@/audio/presets'
import type { AudioSnapshot } from '@/audio/document'
import type { AudioPatch } from '@/audio/types'

/**
 * The sounds, as things you can see.
 *
 * The menu in the band is for reaching a sound you already have in mind. This is for the other
 * half of the job — not knowing, and looking. A waveform on each card is enough to tell a knock
 * from a swell before you play it, which is the difference between browsing and auditioning
 * twenty things in a row.
 *
 * Ninety of them is past the point where looking is the fast way, so there is a search as well —
 * over the names and the group each sits in, since half of what anybody types is the family.
 */
export function AudioPresetsView({ current, snapshots, onPatch, onRemove }: {
  current: string
  snapshots: AudioSnapshot[]
  onPatch: (patch: AudioPatch, id: string) => void
  onRemove: (id: string) => void
}) {
  const built = useMemo(() => PRESETS.map((preset) => ({ preset, patch: preset.build() })), [])
  const [look, setLook] = useState('')
  const search = useId()
  const wanted = look.trim().toLowerCase()
  const found = wanted
    ? built.filter(({ preset }) => `${preset.label} ${preset.group}`.toLowerCase().includes(wanted))
    : built
  const kept = wanted
    ? snapshots.filter((snapshot) => snapshot.name.toLowerCase().includes(wanted))
    : snapshots
  const groups = PRESET_GROUPS.filter((group) => found.some(({ preset }) => preset.group === group))

  return (
    <div className="sound-browser">
      <div className="sound-browser__search">
        <label className="sound-browser__label" htmlFor={search}>Find a sound</label>
        <input
          id={search}
          type="search"
          className="field"
          placeholder="Name or family"
          value={look}
          onChange={(event) => setLook(event.target.value)}
        />
        <output className="sound-browser__count" aria-live="polite">
          {wanted ? `${found.length + kept.length} of ${built.length + snapshots.length}` : `${built.length + snapshots.length} sounds`}
        </output>
      </div>
      {wanted && found.length + kept.length === 0 ? (
        <p className="sound-browser__empty">Nothing here is called that. The families are {PRESET_GROUPS.join(', ')}.</p>
      ) : null}
      {groups.map((group) => (
        <section className="sound-browser__group" key={group} aria-label={group}>
          <h2 className="sound-browser__title">{group}</h2>
          <ul className="sound-browser__grid">
            {found.filter(({ preset }) => preset.group === group).map(({ preset, patch }) => (
              <li key={preset.id}>
                <button
                  type="button"
                  className="sound-card"
                  aria-current={preset.id === current ? 'true' : undefined}
                  onClick={() => onPatch(preset.build(), preset.id)}
                >
                  <AudioThumb patch={patch} />
                  <span className="sound-card__name">{preset.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="sound-browser__group" aria-label="Saved">
        <h2 className="sound-browser__title">Saved</h2>
        {kept.length === 0 ? (
          <p className="sound-browser__empty">
            {wanted ? 'Nothing saved is called that.' : 'Nothing saved yet. The camera in the band keeps whatever sound you are on.'}
          </p>
        ) : (
          <ul className="sound-browser__grid">
            {kept.map((snapshot) => (
              <li key={snapshot.id}>
                <button
                  type="button"
                  className="sound-card"
                  aria-current={snapshot.id === current ? 'true' : undefined}
                  onClick={() => onPatch(snapshot.patch, snapshot.id)}
                >
                  <AudioThumb patch={snapshot.patch} />
                  <span className="sound-card__name">{snapshot.name}</span>
                </button>
                <button
                  type="button"
                  className="sound-card__remove"
                  aria-label={`Remove ${snapshot.name}`}
                  onClick={() => onRemove(snapshot.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
