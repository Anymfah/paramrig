import { IconDice, IconWave } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { PRESETS } from '@/audio/presets'
import type { AudioPatch } from '@/audio/types'

/**
 * A sound in one click, which is the difference between a synthesiser and a generator.
 *
 * Nobody arrives wanting to set an envelope; they arrive wanting a coin. The presets are ordinary
 * patches, so the first gesture after one is to change it — the rail is a starting point, not a
 * library of finished goods. Randomize and Mutate sit under them because they answer the same
 * question by a different route: Randomize when nothing here is close, Mutate when this is nearly
 * it.
 */
export function AudioPresetRail({ onPatch, onRandom, onMutate }: {
  onPatch: (patch: AudioPatch, label: string) => void
  onRandom: () => void
  onMutate: () => void
}) {
  return (
    <nav className="audio-rail" aria-label="Starting points">
      <p className="audio-rail__title">Presets</p>
      <ul className="audio-rail__list">
        {PRESETS.map((preset) => (
          <li key={preset.id}>
            <button type="button" className="audio-rail__item" onClick={() => onPatch(preset.build(), preset.label)}>
              {preset.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="audio-rail__actions">
        <Tooltip content="A new sound, drawn from the ranges that make sounds">
          <button type="button" className="btn btn--outline btn--sm" onClick={onRandom}>
            <IconDice /> Randomize
          </button>
        </Tooltip>
        <Tooltip content="This sound, moved a little">
          <button type="button" className="btn btn--outline btn--sm" onClick={onMutate}>
            <IconWave /> Mutate
          </button>
        </Tooltip>
      </div>
    </nav>
  )
}
