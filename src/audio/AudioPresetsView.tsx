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
 */
export function AudioPresetsView({ current, snapshots, onPatch, onRemove }: {
  current: string
  snapshots: AudioSnapshot[]
  onPatch: (patch: AudioPatch, id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="sound-browser">
      {PRESET_GROUPS.map((group) => (
        <section className="sound-browser__group" key={group} aria-label={group}>
          <h2 className="sound-browser__title">{group}</h2>
          <ul className="sound-browser__grid">
            {PRESETS.filter((preset) => preset.group === group).map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  className="sound-card"
                  aria-current={preset.id === current ? 'true' : undefined}
                  onClick={() => onPatch(preset.build(), preset.id)}
                >
                  <AudioThumb patch={preset.build()} />
                  <span className="sound-card__name">{preset.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="sound-browser__group" aria-label="Saved">
        <h2 className="sound-browser__title">Saved</h2>
        {snapshots.length === 0 ? (
          <p className="sound-browser__empty">
            Nothing saved yet. The camera in the band keeps whatever sound you are on.
          </p>
        ) : (
          <ul className="sound-browser__grid">
            {snapshots.map((snapshot) => (
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
