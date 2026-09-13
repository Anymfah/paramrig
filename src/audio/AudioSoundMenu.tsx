import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { IconChevron, IconTrash } from '@/ui/icons'
import { PRESETS, PRESET_GROUPS } from '@/audio/presets'
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
export function AudioSoundMenu({ current, snapshots, touched, onPatch, onRemove }: {
  current: string
  snapshots: AudioSnapshot[]
  touched: boolean
  onPatch: (patch: AudioPatch, id: string) => void
  onRemove: (id: string) => void
}) {
  // Nothing matches once a knob has been turned, and saying so is the useful thing: it is the
  // difference between a sound you can get back to and one you are about to lose.
  const name = PRESETS.find((preset) => preset.id === current)?.label
    ?? snapshots.find((snapshot) => snapshot.id === current)?.name
  // Nothing selected, or selected and since moved: either way this sound is not one you can get
  // back to, and that is the useful thing to say.
  const label = !name ? 'Unsaved' : touched ? `${name} · edited` : name

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="audio-sounds__trigger" aria-label={`Sound: ${label}`}>
        <span>{label}</span>
        <IconChevron />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu audio-sounds__menu" align="end" sideOffset={6} collisionPadding={8}>
          {/* Grouped by what a sound is for, which is how anyone looks for one. Twenty in a flat
              list is a wall you read from the top every time. */}
          {PRESET_GROUPS.map((group) => (
            <DropdownMenu.Group key={group}>
              <DropdownMenu.Label className="menu__label">{group}</DropdownMenu.Label>
              {PRESETS.filter((preset) => preset.group === group).map((preset) => (
                <DropdownMenu.Item
                  key={preset.id}
                  className="menu__item"
                  aria-current={preset.id === current ? 'page' : undefined}
                  onSelect={() => onPatch(preset.build(), preset.id)}
                >
                  {preset.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
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
              {/*
                * Inside the row rather than beside it, and it has to stop the row from also firing
                * — selecting a sound you meant to delete is the worst of both.
                *
                * Both ends of the gesture, which is the part that was missing. A menu item sets a
                * flag on pointer down and, if it never saw one, synthesises a click on itself at
                * pointer up — the way a menu opened by a press-and-drag selects what you let go
                * over. Stopping only the pointer down left that flag unset, so letting go over the
                * trash icon clicked the *row*: the sound loaded, the menu closed, and the remove
                * handler never ran at all. Stopping the pointer up as well leaves the button's own
                * click the only thing that happens.
                */}
              <button
                type="button"
                className="audio-sounds__remove"
                aria-label={`Remove ${snapshot.name}`}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
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
