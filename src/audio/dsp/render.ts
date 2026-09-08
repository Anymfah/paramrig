import type { AudioPatch, Layer } from '../types.ts'
import { createFilter, filterSample } from './filter.ts'
import { createNoise, waveAt } from './osc.ts'
import { createShaper, shapeSample } from './shaper.ts'
import { curveAt } from './curve.ts'
import { envelopeAt, fitEnvelope } from './envelope.ts'
import { applyFx } from './space.ts'
import { streamFor } from './rng.ts'
import { createLfoState, LFO_RANGE, lfoAt, readLfoTarget, type LfoDestination, type LfoState } from './lfo.ts'
import { MAX_VOICES } from '../fields.ts'

/**
 * The whole synthesiser, as one pure function.
 *
 * This is the audio twin of `resolveRigValues`: a patch and a sample rate in, a buffer out, no
 * clock, no context, no device. Everything downstream is a consumer of that buffer — playback
 * hands it to Web Audio, the waveform view draws it, the exporter encodes it. One code path means
 * what you hear while tuning and what lands in the file cannot drift apart.
 *
 * It is also why the tests need no browser: this file runs in Node.
 */

/** Two milliseconds of ramp in, so a layer that opens on a full-amplitude sample does not tick. */
const FADE_IN_SECONDS = 0.002

type Modulator = { lfo: AudioPatch['lfos'][number]; destination: LfoDestination; state: LfoState; random: () => number }

function renderLayer(layer: Layer, patch: AudioPatch, index: number, out: Float32Array, sampleRate: number, modulators: Modulator[]): void {
  if (!layer.enabled) return
  const offset = Math.max(0, layer.offset)
  const life = patch.duration - offset
  if (life <= 0) return

  const random = streamFor(patch.seed, index)
  const cents = (random() * 2 - 1) * layer.pitch.jitter
  const detune = Math.pow(2, cents / 1200)
  const noise = createNoise(layer.source.colour, random)
  const filter = createFilter()
  const shaper = createShaper()
  const fitted = fitEnvelope(layer.amp, life)
  const nyquist = sampleRate * 0.5

  const start = Math.round(offset * sampleRate)
  const end = Math.min(out.length, Math.round(patch.duration * sampleRate))

  /**
   * One oscillator is one oscillator: thin, because there is nothing for it to beat against, and
   * no envelope repairs that. The copies are spread evenly across the detune and summed at
   * 1/sqrt(n), which holds the loudness while they drift in and out of phase with each other.
   */
  const voices = Math.min(MAX_VOICES, Math.max(1, Math.round(layer.source.voices)))
  const spread = layer.source.detune / 1200
  const ratios = Array.from({ length: voices }, (_, voice) => (
    voices === 1 ? 1 : Math.pow(2, (voice / (voices - 1) - 0.5) * spread)
  ))
  const phases = ratios.map(() => 0)
  const balance = 1 / Math.sqrt(voices)

  const find = (destination: LfoDestination) => modulators.find((entry) => entry.destination === destination)
  const pitchLfo = find('pitch')
  const cutoffLfo = find('cutoff')
  const widthLfo = find('pulseWidth')
  const gainLfo = find('gain')

  for (let i = start; i < end; i += 1) {
    const t = (i - start) / sampleRate
    const x = life > 0 ? Math.min(1, t / life) : 1

    const vibrato = layer.pitch.vibratoDepth * Math.sin(2 * Math.PI * layer.pitch.vibratoRate * t)
    const slide = layer.pitch.slide * curveAt(layer.pitch.slideCurve, x)
    const arpeggio = x >= layer.pitch.arpeggioAt ? layer.pitch.arpeggioRatio : 1
    // Modulators run on the patch's clock, so two layers pointed at one of them move together
    // even when one of them starts late.
    const clock = i / sampleRate
    const swing = (entry: Modulator | undefined) => (entry ? lfoAt(entry.lfo, clock, entry.state, entry.random) * entry.lfo.depth : 0)

    const wobble = swing(pitchLfo) * LFO_RANGE.pitch
    const wanted = layer.pitch.start * Math.pow(2, (slide + vibrato) / 12 + wobble) * arpeggio * detune
    const frequency = Math.min(nyquist * 0.98, Math.max(1, wanted))
    const dt = frequency / sampleRate

    let raw = 0
    if (layer.source.kind === 'noise') {
      raw = noise.next(dt)
    } else {
      const width = Math.min(0.95, Math.max(0.05, layer.source.pulseWidth + swing(widthLfo) * LFO_RANGE.pulseWidth))
      for (let voice = 0; voice < voices; voice += 1) {
        const step = dt * (ratios[voice] ?? 1)
        const at = ((phases[voice] ?? 0) + step) % 1
        phases[voice] = at
        raw += waveAt(layer.source.wave, at, step, width)
      }
      raw *= balance
    }

    const sweep = Math.pow(2, layer.filter.envAmount * curveAt(layer.filter.envCurve, x) + swing(cutoffLfo) * LFO_RANGE.cutoff)
    const filtered = filterSample(filter, layer.filter.kind, raw, layer.filter.cutoff * sweep, layer.filter.resonance, sampleRate)
    const shaped = shapeSample(shaper, layer.shaper, filtered)
    const amplitude = envelopeAt(layer.amp, fitted, t, life)
    const tremolo = Math.max(0, 1 + swing(gainLfo) * LFO_RANGE.gain)
    out[i] = (out[i] ?? 0) + shaped * amplitude * layer.gain * tremolo
  }
}

export function renderPatch(patch: AudioPatch, sampleRate: number): Float32Array {
  const length = Math.max(1, Math.round(Math.max(0.001, patch.duration) * sampleRate))
  const dry = new Float32Array(length)
  const wired = patch.lfos.flatMap((lfo, index) => {
    const target = lfo.enabled ? readLfoTarget(lfo.target) : null
    if (!target) return []
    // Its own stream, so a noise modulator is reproducible and independent of the layers'.
    const random = streamFor(patch.seed, 100 + index)
    return [{ ...target, lfo, state: createLfoState(random), random }]
  })
  patch.layers.forEach((layer, index) => renderLayer(
    layer, patch, index, dry, sampleRate,
    wired.filter((entry) => entry.layer === index).map(({ lfo, destination, state, random }) => ({ lfo, destination, state, random })),
  ))

  const wet = applyFx(dry, patch.fx, sampleRate)

  const limiter = Math.min(1, Math.max(0, patch.master.limiter))
  const fadeIn = Math.max(1, Math.round(FADE_IN_SECONDS * sampleRate))
  const fadeOut = Math.max(1, Math.round(Math.max(0, patch.master.fadeOut) * sampleRate))

  for (let i = 0; i < length; i += 1) {
    let value = (wet[i] ?? 0) * patch.master.gain
    // tanh is the limiter here because its slope at zero is exactly one: quiet material passes
    // through untouched and only the peaks bend. A cubic clipper would lift the whole sound.
    if (limiter > 0) value = value * (1 - limiter) + Math.tanh(value) * limiter
    if (i < fadeIn) value *= i / fadeIn
    const fromEnd = length - 1 - i
    if (fromEnd < fadeOut) value *= fromEnd / fadeOut
    // A non-finite sample is a full-scale click and would be the loudest thing in the file.
    // Whatever produced it, silence is the honest answer for that one sample.
    wet[i] = Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0
  }

  return wet
}
