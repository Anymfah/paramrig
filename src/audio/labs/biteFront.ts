import { macroAmount, type MacroSlot } from '../macros'
import { currentAudioValue } from '@paramrig/audio/bindings'
import type { LabSound } from './model'

/**
 * Bite, read as a place on the relief.
 *
 * Bite opens and closes the filters of the sound, and the relief's depth is frequency: the control
 * therefore has a frequency of its own, the geometric mean of the cutoffs it carries. That is where
 * the relief lights one of its lines, and moving that line is moving the control.
 *
 * The frequency is read from the patch itself, so the line stands where the sound really cuts. The
 * slope — how many log-hertz one whole turn of the control is worth — comes from the macro's own
 * range, so a line dropped at a frequency asks for the amount that puts the cutoffs there.
 */
export type BiteFront = {
  /** The Bite control's index among the sound's four, and its amount, 0 to 1. */
  control: number
  value: number
  /** Where the filters cut now, in hertz. */
  hz: number
  /** The frequency that amount would give, and the amount that would reach a frequency. */
  hzAt: (amount: number) => number
  amountAt: (hz: number) => number
}

const isCutoff = (property: string) => property.endsWith('.cutoff')

export function biteFront(sound: LabSound): BiteFront | null {
  const control = sound.controls.findIndex((index) => sound.macros[index]?.label === 'Bite')
  if (control < 0) return null
  const slot: MacroSlot = sound.macros[sound.controls[control]!]!
  const cutoffs = slot.destinations.filter((destination) => isCutoff(destination.property) && destination.from > 0 && destination.to > 0)
  if (!cutoffs.length) return null
  let logHz = 0, kept = 0
  for (const destination of cutoffs) {
    const current = currentAudioValue(sound.patch, destination.property)
    if (typeof current !== 'number' || !(current > 0)) continue
    logHz += Math.log(current); kept += 1
  }
  if (!kept) return null
  const hz = Math.exp(logHz / kept)
  // One whole turn of the control moves every cutoff by this much in log hertz.
  const slope = cutoffs.reduce((sum, destination) => sum + Math.log(destination.to / destination.from), 0) / cutoffs.length
  if (!(slope > 1e-6)) return null
  const value = macroAmount(slot)
  return {
    control, value, hz,
    hzAt: (amount) => hz * Math.exp((amount - value) * slope),
    amountAt: (target) => Math.min(1, Math.max(0, value + Math.log(Math.max(1e-6, target) / hz) / slope)),
  }
}
