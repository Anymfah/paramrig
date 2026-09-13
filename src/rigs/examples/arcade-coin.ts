import { coin } from '@/audio/presets'
import type { AudioDocument } from '@/audio/document'

/**
 * The bundled sound, and the one place in the app that shows what a patch is for.
 *
 * It is an ordinary coin sound carrying four controls. That is the whole argument for the domain:
 * the person who made it worked with seventy fields, and the person who uses it gets four — pitch,
 * length, sparkle, tone — without being able to break the sound underneath.
 */

const created = '2026-09-08T00:00:00.000Z'

export function arcadeCoin(): AudioDocument {
  return {
    version: 1,
    id: 'audio-example-arcade-coin',
    name: 'Arcade coin',
    patch: coin(),
    createdAt: created,
    updatedAt: created,
    rig: {
      groups: [
        { id: 'voice', label: 'Voice' },
        { id: 'finish', label: 'Finish' },
      ],
      parameters: [
        {
          kind: 'number', id: 'pitch', label: 'Pitch', group: 'voice',
          min: 200, max: 4000, step: 1, unit: 'Hz', scale: 'log', defaultValue: 988,
        },
        {
          kind: 'number', id: 'length', label: 'Length', group: 'voice',
          min: 0.1, max: 1.2, step: 0.001, unit: 'ms', defaultValue: 0.45,
          units: [
            { value: 'ms', label: 'Milliseconds', factor: 0.001, step: 10 },
            { value: 's', label: 'Seconds', factor: 1, step: 0.01 },
          ],
        },
        {
          kind: 'number', id: 'sparkle', label: 'Sparkle', group: 'voice',
          min: 1, max: 2.5, step: 0.01, defaultValue: 1.5,
        },
        {
          kind: 'number', id: 'tone', label: 'Tone', group: 'finish',
          min: -1, max: 1, step: 0.01, view: 'bar', defaultValue: 0.2,
        },
      ],
      bindings: [
        { id: 'binding-pitch', property: 'layers[0].pitch.start', parameterId: 'pitch' },
        { id: 'binding-length', property: 'duration', parameterId: 'length' },
        { id: 'binding-sparkle', property: 'layers[0].pitch.arpeggioRatio', parameterId: 'sparkle' },
        { id: 'binding-tone', property: 'fx.tone', parameterId: 'tone' },
      ],
    },
  }
}

export const BUNDLED_PATCHES: Array<() => AudioDocument> = [arcadeCoin]
