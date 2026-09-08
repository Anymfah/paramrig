import { IconChevronRight, IconDice, IconSnapshot, IconWave } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'
import { AudioSoundMenu } from '@/audio/AudioSoundMenu'
import { PRESETS } from '@/audio/presets'
import type { AudioSnapshot } from '@/audio/document'
import type { AudioPatch } from '@/audio/types'

/**
 * Everything to do with *which* sound, in the width the transport already had spare.
 *
 * Stepping is how these get used — you rarely know which sound you want, only that it is not this
 * one — so the arrows walk the whole list, the ones that ship and the ones you kept, in one order.
 */
export function AudioSoundBar({ current, snapshots, onPatch, onRemove, onSnapshot, onRandom, onMutate }: {
  current: string
  snapshots: AudioSnapshot[]
  onPatch: (patch: AudioPatch, id: string) => void
  onRemove: (id: string) => void
  onSnapshot: () => void
  onRandom: () => void
  onMutate: () => void
}) {
  const all = [
    ...PRESETS.map((preset) => ({ id: preset.id, patch: preset.build })),
    ...snapshots.map((snapshot) => ({ id: snapshot.id, patch: () => snapshot.patch })),
  ]
  const step = (by: number) => {
    if (all.length === 0) return
    const at = all.findIndex((entry) => entry.id === current)
    // Nothing loaded yet: forward lands on the first, back wraps round to the last.
    const from = at >= 0 ? at : by > 0 ? -1 : 0
    const next = all[(from + by + all.length) % all.length]
    if (next) onPatch(next.patch(), next.id)
  }

  return (
    <div className="audio-sounds">
      <Tooltip content="Previous sound">
        <IconButton label="Previous sound" onClick={() => step(-1)}>
          <span className="audio-sounds__back"><IconChevronRight /></span>
        </IconButton>
      </Tooltip>
      <AudioSoundMenu current={current} snapshots={snapshots} onPatch={onPatch} onRemove={onRemove} />
      <Tooltip content="Next sound">
        <IconButton label="Next sound" onClick={() => step(1)}><IconChevronRight /></IconButton>
      </Tooltip>
      <Tooltip content="Keep this sound — it joins the menu, and travels with the patch">
        <IconButton label="Keep this sound" onClick={onSnapshot}><IconSnapshot /></IconButton>
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
