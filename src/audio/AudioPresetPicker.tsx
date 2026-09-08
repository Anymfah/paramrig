import { IconChevronRight, IconDice, IconWave } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { SelectField } from '@/ui/SelectField'
import { Tooltip } from '@/ui/Tooltip'
import { PRESETS } from '@/audio/presets'
import type { AudioPatch } from '@/audio/types'

/**
 * A sound in one click, in the width the transport already had spare.
 *
 * This was a column of its own down the left, which cost a fifth of the board to list eight names.
 * As a menu with a step either side it costs nothing, and stepping is how these get used: you
 * rarely know which preset you want, you want to hear the next one.
 */
export function AudioPresetPicker({ current, onPatch, onRandom, onMutate }: {
  current: string
  onPatch: (patch: AudioPatch, id: string) => void
  onRandom: () => void
  onMutate: () => void
}) {
  const options = PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))
  const load = (id: string) => {
    const preset = PRESETS.find((entry) => entry.id === id)
    if (preset) onPatch(preset.build(), preset.id)
  }
  const step = (by: number) => {
    const at = PRESETS.findIndex((preset) => preset.id === current)
    // Nothing loaded yet: forward lands on the first, back wraps round to the last.
    const from = at >= 0 ? at : by > 0 ? -1 : 0
    const next = PRESETS[(from + by + PRESETS.length) % PRESETS.length]
    if (next) onPatch(next.build(), next.id)
  }

  return (
    <div className="audio-presets">
      <Tooltip content="Previous preset">
        <IconButton label="Previous preset" onClick={() => step(-1)}>
          <span className="audio-presets__back"><IconChevronRight /></span>
        </IconButton>
      </Tooltip>
      <SelectField
        label="Preset"
        value={current}
        options={options}
        onChange={load}
        presentation="menu"
      />
      <Tooltip content="Next preset">
        <IconButton label="Next preset" onClick={() => step(1)}><IconChevronRight /></IconButton>
      </Tooltip>
      <Tooltip content="Randomize — a new sound, drawn from the ranges that make sounds">
        <IconButton label="Randomize" onClick={onRandom}><IconDice /></IconButton>
      </Tooltip>
      <Tooltip content="Mutate — this sound, moved a little">
        <IconButton label="Mutate" onClick={onMutate}><IconWave /></IconButton>
      </Tooltip>
    </div>
  )
}
