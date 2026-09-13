import * as Popover from '@radix-ui/react-popover'
import { LockKeyhole, LockKeyholeOpen, SlidersHorizontal } from 'lucide-react'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'
import { AudioKnob } from '../AudioKnob'
import type { LabSound } from './model'
import type { LabsHandle } from './useLabs'

/**
 * The four timbre controls of the sound on the bench, one press away instead of under the
 * picture. Turning one reshapes the current sound; a lock holds it still while variations are
 * drawn. The popover leaves the bench visible, so the change is seen as it is heard.
 */
export function TimbreControls({ lab, sound }: { lab: LabsHandle; sound: LabSound }) {
  const values = lab.valuesOf(sound)
  const locked = sound.controls.filter((_, control) => lab.session.locks[control]).length
  return (
    <Popover.Root>
      <Tooltip content={locked ? `Timbre · ${locked} locked` : 'Timbre'}>
        <Popover.Trigger asChild>
          <button type="button" className="icon-btn icon-btn--ghost labs-timbre__trigger" aria-label="Timbre controls" data-locked={locked || undefined}>
            <SlidersHorizontal />
            {locked ? <span className="labs-timbre__count" aria-hidden="true">{locked}</span> : null}
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content className="labs-timbre" side="bottom" align="end" sideOffset={8} collisionPadding={12} data-labs-popover aria-label={`Timbre of ${sound.name}`}>
          <header className="labs-timbre__head">
            <h3>Timbre</h3>
            <p>Turning a control changes the current sound. A lock keeps it for variations.</p>
          </header>
          {sound.controls.length ? (
            <div className="labs-macros" role="group" aria-label="Timbre controls">
              {sound.controls.map((index, control) => {
                const slot = sound.macros[index]!
                const isLocked = lab.session.locks[control] ?? false
                const label = `${isLocked ? 'Unlock' : 'Lock'} ${slot.label} for variations`
                return (
                  <div className="labs-macro" key={`${sound.id}-${index}`} data-locked={isLocked || undefined}>
                    <span className="labs-macro__label">{slot.label}</span>
                    <AudioKnob size="std" param={{ id: `labs-macro-${control}`, group: 'Labs', kind: 'number', label: slot.label, min: 0, max: 1, step: 0.01, defaultValue: sound.origin.kind === 'instrument' ? values[control]! : 0.5 }} value={values[control] ?? 0.5}
                      onGestureStart={lab.beginGesture} onGestureEnd={lab.endGesture}
                      onChange={(value) => lab.adjust(values.map((v, i) => (i === control ? value : v)))} />
                    <output className="labs-macro__value" aria-hidden="true">{Math.round((values[control] ?? 0.5) * 100)}%</output>
                    <Tooltip content={label}><IconButton label={label} aria-pressed={isLocked} className="labs-macro__lock" onClick={() => lab.toggleLock(control)}>{isLocked ? <LockKeyhole /> : <LockKeyholeOpen />}</IconButton></Tooltip>
                  </div>
                )
              })}
            </div>
          ) : <p className="labs-help">This sound has no compatible timbre controls. Add macro mappings in Instrument, or generate a Labs sound.</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
