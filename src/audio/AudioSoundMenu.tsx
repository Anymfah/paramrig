import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { IconChevron, IconTrash } from '@/ui/icons'
import { PRESETS } from '@/audio/presets'
import type { AudioSnapshot } from '@/audio/document'
import type { AudioPatch } from '@/audio/types'

/**
 * One menu for every sound you can reach: the ones that ship, and the ones you kept.
 *
 * They belong together because they answer the same question — "give me a different sound" — and
 * separating them would mean learning which list a thing was in before you could go and get it.
 * The saved ones can be thrown away from the row they sit on; a list you cannot prune stops being
 * a list you look at.
 */
export function AudioSoundMenu({ current, snapshots, onPatch, onRemove }: {
  current: string
  snapshots: AudioSnapshot[]
  onPatch: (patch: AudioPatch, id: string) => void
  onRemove: (id: string) => void
}) {
  // Nothing matches once a knob has been turned, and saying so is the useful thing: it is the
  // difference between a sound you can get back to and one you are about to lose.
  const label = PRESETS.find((preset) => preset.id === current)?.label
    ?? snapshots.find((snapshot) => snapshot.id === current)?.name
    ?? 'Unsaved'

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="audio-sounds__trigger" aria-label={`Sound: ${label}`}>
        <span>{label}</span>
        <IconChevron />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu audio-sounds__menu" align="end" sideOffset={6} collisionPadding={8}>
          <DropdownMenu.Label className="menu__label">Presets</DropdownMenu.Label>
          {PRESETS.map((preset) => (
            <DropdownMenu.Item
              key={preset.id}
              className="menu__item"
              aria-current={preset.id === current ? 'page' : undefined}
              onSelect={() => onPatch(preset.build(), preset.id)}
            >
              {preset.label}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="menu__sep" />
          <DropdownMenu.Label className="menu__label">Saved</DropdownMenu.Label>
          {snapshots.length === 0 ? (
            <p className="menu__empty">Nothing saved yet. The camera keeps the sound you are on.</p>
          ) : snapshots.map((snapshot) => (
            <DropdownMenu.Item
              key={snapshot.id}
              className="menu__item audio-sounds__saved"
              aria-current={snapshot.id === current ? 'page' : undefined}
              onSelect={() => onPatch(snapshot.patch, snapshot.id)}
            >
              <span className="audio-sounds__name">{snapshot.name}</span>
              {/* Inside the row rather than beside it, and it has to stop the row from also
                  firing — selecting a sound you meant to delete is the worst of both. */}
              <button
                type="button"
                className="audio-sounds__remove"
                aria-label={`Remove ${snapshot.name}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onRemove(snapshot.id)
                }}
              >
                <IconTrash />
              </button>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
