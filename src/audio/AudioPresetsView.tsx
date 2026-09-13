import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { AudioThumb } from '@/audio/AudioThumb'
import { PRESETS, PRESET_GROUPS } from '@/audio/presets'
import { moveSoundFocus } from '@/audio/sound-keys'
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
  const firstId = found[0]?.preset.id ?? kept[0]?.id
  const onKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement) return
    const cards = [...event.currentTarget.querySelectorAll<HTMLElement>('.sound-card')]
    const next = moveSoundFocus(event.nativeEvent, cards)
    if (next === null) return
    cards[next]?.click()
    cards[next]?.focus()
    cards[next]?.scrollIntoView?.({ block: 'nearest' })
  }

  return (
    <div className="sound-browser" onKeyDown={onKeys}>
      <div className="sound-browser__search">
        <label className="text-field" htmlFor={search}>
          <span className="text-field__label">Find a sound</span>
          <input
            id={search}
            type="search"
            className="text-field__input"
            placeholder="Name or family"
            autoComplete="off"
            spellCheck={false}
            value={look}
            onChange={(event) => setLook(event.target.value)}
          />
        </label>
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
                  tabIndex={preset.id === current || (current === '' && preset.id === firstId) ? 0 : -1}
                  onClick={() => onPatch(preset.build(), preset.id)}
                >
                  <AudioThumb patch={patch} id={preset.id} />
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
                  tabIndex={snapshot.id === current || (current === '' && snapshot.id === firstId) ? 0 : -1}
                  onClick={() => onPatch(snapshot.patch, snapshot.id)}
                >
                  <AudioThumb patch={snapshot.patch} id={`${snapshot.id}:${snapshot.createdAt}`} />
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
