import type { AmpSettings } from '../types.ts'

/**
 * An AHDSR fitted to a fixed life. A one-shot effect has no key release to wait for, so the stages
 * are laid against the layer's own duration: attack, hold, decay, then the sustain level held for
 * whatever is left, then release landing exactly on zero.
 *
 * The two guarantees that matter are that it starts at zero and ends at zero. An envelope that
 * stops anywhere else is a click, and a click is the one artefact nobody forgives in an interface
 * sound.
 */

export type FittedEnvelope = { attack: number; hold: number; decay: number; release: number }

/** Stages longer than the life are scaled down together rather than truncated, keeping their ratio. */
export function fitEnvelope(amp: AmpSettings, life: number): FittedEnvelope {
  const attack = Math.max(0, amp.attack)
  const hold = Math.max(0, amp.hold)
  const decay = Math.max(0, amp.decay)
  const release = Math.max(0, amp.release)
  const total = attack + hold + decay + release
  if (total <= life || total <= 0) return { attack, hold, decay, release }
  const k = life / total
  return { attack: attack * k, hold: hold * k, decay: decay * k, release: release * k }
}

export function envelopeAt(amp: AmpSettings, fitted: FittedEnvelope, t: number, life: number): number {
  if (t < 0 || t > life) return 0
  const curve = Math.max(0.1, amp.curve)
  const sustain = Math.min(1, Math.max(0, amp.sustain))
  const { attack, hold, decay, release } = fitted
  if (t < attack) return attack > 0 ? Math.pow(t / attack, 1 / curve) : 1
  if (t < attack + hold) return 1
  if (t < attack + hold + decay) {
    const x = decay > 0 ? (t - attack - hold) / decay : 1
    return sustain + (1 - sustain) * Math.pow(1 - x, curve)
  }
  const releaseStart = life - release
  if (t < releaseStart) return sustain
  if (release <= 0) return 0
  const x = (t - releaseStart) / release
  return sustain * Math.pow(1 - Math.min(1, x), curve)
}
