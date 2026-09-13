import { useId } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { IconClose, IconDice, IconDownload, IconGesture, IconSave, IconSnapshot, IconWave } from '@/ui/icons'
import { Button, IconButton } from '@/ui/Button'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'
import { FieldReset } from '@/ui/FieldReset'
import { Tooltip } from '@/ui/Tooltip'
import { AudioHearing, type HearingMode } from '@/audio/AudioTransport'
import { EXPORT_RATE, saveWav } from '@/audio/wav-file'
import {
  MUTATE_AMOUNT_PREFS, MUTATE_TARGET_PREFS, RANDOM_FAMILIES, type ShufflePrefs,
} from '@/audio/prefs'
import type { Transport } from '@/audio/useTransport'
import type { AudioSnapshot } from '@/audio/document'
import type { AudioPatch, MacroGesture } from '@/audio/types'

const FAMILY_LABELS: Record<ShufflePrefs['family'], string> = {
  any: 'Any',
  mechanical: 'Mechanical',
  metallic: 'Metallic',
  digital: 'Digital',
  organic: 'Organic',
  atmospheric: 'Atmospheric',
  impact: 'Impact',
}

const AMOUNT_LABELS: Record<ShufflePrefs['amount'], string> = {
  subtle: 'Subtle',
  medium: 'Medium',
  strong: 'Strong',
}

const TARGET_LABELS: Record<ShufflePrefs['target'], string> = {
  balanced: 'Balanced',
  timbre: 'Timbre',
  motion: 'Motion',
  space: 'Space',
}

/**
 * Hearing and keeping, in the sub-header above the names they act on.
 *
 * Play used to live in the top bar, a row away from the list you are auditioning. The next sound
 * is in this column: the press that starts it belongs here too, with the ways of holding it and
 * the two ways of keeping it.
 */
export function AudioLibraryDeck({ compact, transport, live, hearing, onHearing, recording, onRecord, patch, name, current, snapshots, touched, gestures, gestureLabels, onToggleGesture, onRemoveGesture, onSnapshot, onOverwrite, onRandom, onMutate, shuffle, onShuffle, generating }: {
  compact: boolean
  transport: Transport
  live: boolean
  hearing: HearingMode
  onHearing: (next: HearingMode) => void
  recording: boolean
  onRecord: () => void
  patch?: AudioPatch
  name: string
  current: string
  snapshots: AudioSnapshot[]
  /** Whether the sound on screen has moved away from the one under the selected name. */
  touched: boolean
  gestures: MacroGesture[]
  gestureLabels: string[]
  onToggleGesture: (id: string) => void
  onRemoveGesture: (id: string) => void
  onSnapshot: () => void
  onOverwrite: () => void
  onRandom: () => void
  onMutate: () => void
  shuffle: ShufflePrefs
  onShuffle: (next: ShufflePrefs) => void
  generating: boolean
}) {
  const saved = snapshots.find((snapshot) => snapshot.id === current)
  const side = compact ? 'right' : 'top'
  const count = gestures.length
  const familyId = useId()
  return (
    <div className="audio-library__deck" role="toolbar" aria-label="Sound actions">
      <AudioHearing
        transport={transport}
        live={live}
        hearing={hearing}
        onHearing={onHearing}
        recording={recording}
        onRecord={onRecord}
        side={side}
      />
      <div className="audio-library__gestures">
      <Popover.Root>
        <Tooltip content={count ? `Gestures (${count})` : 'No gestures on this sound'} side={side}>
          <Popover.Trigger className="icon-btn icon-btn--ghost" aria-label={count ? `Gestures (${count})` : 'Gestures'} aria-pressed={count > 0 || undefined}>
            <IconGesture />
          </Popover.Trigger>
        </Tooltip>
        <Popover.Portal>
          <Popover.Content className="popover popover--menu audio-gestures" side={side === 'right' ? 'right' : 'bottom'} align="start" sideOffset={8} collisionPadding={8} aria-label="Gestures">
            {count === 0 ? (
              <p className="audio-gestures__empty">No gestures on this sound. Record one from an armed macro.</p>
            ) : (
              gestures.map((take, index) => (
                <div key={take.id} className="audio-gestures__take">
                  <Button size="sm" variant="quiet" aria-pressed={take.enabled} onClick={() => onToggleGesture(take.id)}>
                    {index + 1} · {gestureLabels[take.macro] || `Macro ${take.macro + 1}`} · {take.duration.toFixed(2)} s
                  </Button>
                  <Tooltip content="Remove gesture">
                    <IconButton label={`Remove gesture ${index + 1}`} onClick={() => onRemoveGesture(take.id)}>
                      <IconClose />
                    </IconButton>
                  </Tooltip>
                </div>
              ))
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      </div>
      <div className="audio-library__make" role="group" aria-label="This sound">
        <Tooltip content="Keep this sound — it joins the menu, and travels with the patch" side={side}>
          <IconButton label="Keep this sound" onClick={onSnapshot}><IconSnapshot /></IconButton>
        </Tooltip>
        <Tooltip content={saved
          ? `Replace ${saved.name} with what you have now`
          : 'Nothing to replace — this sound is not one of the saved ones'} side={side}>
          <IconButton label="Replace the saved sound" onClick={onOverwrite} disabled={!saved || !touched}>
            <IconSave />
          </IconButton>
        </Tooltip>
        <Popover.Root>
          <Tooltip content="Randomize — a new sound from the chosen family" side={side}>
            <Popover.Trigger
              className="icon-btn icon-btn--ghost"
              aria-label="Randomize"
              aria-haspopup="dialog"
              aria-busy={generating || undefined}
            >
              <IconDice />
            </Popover.Trigger>
          </Tooltip>
          <Popover.Portal>
            <Popover.Content className="popover audio-shuffle" role="dialog" side={side === 'right' ? 'right' : 'bottom'} align="start" sideOffset={8} collisionPadding={8} aria-label="Randomize">
              <div className="control control--select control--segmented">
                <div className="segment-field">
                  <span className="control__label segment-field__label" id={familyId}>Family</span>
                  {shuffle.family !== 'any' ? (
                    <FieldReset label="Family" defaultLabel="Any" onReset={() => onShuffle({ ...shuffle, family: 'any' })} />
                  ) : null}
                  <div className="segment audio-shuffle__families" role="radiogroup" aria-labelledby={familyId}>
                    {RANDOM_FAMILIES.map((value) => (
                      <label key={value} className="segment__opt">
                        <input
                          type="radio"
                          name={familyId}
                          value={value}
                          checked={shuffle.family === value}
                          onChange={() => onShuffle({ ...shuffle, family: value })}
                        />
                        <span>{FAMILY_LABELS[value]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <Button className="audio-shuffle__go" aria-busy={generating || undefined} onClick={onRandom}>
                Randomize
              </Button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Popover.Root>
          <Tooltip content="Mutate — this sound, moved a little" side={side}>
            <Popover.Trigger
              className="icon-btn icon-btn--ghost"
              aria-label="Mutate"
              aria-haspopup="dialog"
              aria-busy={generating || undefined}
            >
              <IconWave />
            </Popover.Trigger>
          </Tooltip>
          <Popover.Portal>
            <Popover.Content className="popover audio-shuffle" role="dialog" side={side === 'right' ? 'right' : 'bottom'} align="start" sideOffset={8} collisionPadding={8} aria-label="Mutate">
              <SelectField
                label="Amount"
                value={shuffle.amount}
                defaultValue="subtle"
                options={MUTATE_AMOUNT_PREFS.map((value) => ({ value, label: AMOUNT_LABELS[value] }))}
                onChange={(amount) => onShuffle({ ...shuffle, amount: amount as ShufflePrefs['amount'] })}
              />
              <SelectField
                label="Target"
                value={shuffle.target}
                defaultValue="balanced"
                options={MUTATE_TARGET_PREFS.map((value) => ({ value, label: TARGET_LABELS[value] }))}
                onChange={(target) => onShuffle({ ...shuffle, target: target as ShufflePrefs['target'] })}
              />
              <SwitchField
                label="Keep reference"
                checked={shuffle.keepReference}
                defaultValue={false}
                onChange={(keepReference) => onShuffle({ ...shuffle, keepReference })}
              />
              <Button className="audio-shuffle__go" aria-busy={generating || undefined} onClick={onMutate}>
                Mutate
              </Button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {patch ? (
          <Tooltip content={`Save this sound as a ${EXPORT_RATE / 1000} kHz WAV`} side={side}>
            <IconButton label="Save as WAV" onClick={() => saveWav(patch, name)}><IconDownload /></IconButton>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}
