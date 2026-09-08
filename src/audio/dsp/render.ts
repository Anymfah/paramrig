import type { AudioPatch, Layer } from '../types.ts'
import { createFilter, filterSample } from './filter.ts'
import { createNoise, waveAt } from './osc.ts'
import { createShaper, shapeSample } from './shaper.ts'
import { curveAt } from './curve.ts'
import { envelopeAt, fitEnvelope } from './envelope.ts'
import { applyFx } from './space.ts'
import { streamFor } from './rng.ts'

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

function renderLayer(layer: Layer, patch: AudioPatch, index: number, out: Float32Array, sampleRate: number): void {
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
  let phase = 0

  for (let i = start; i < end; i += 1) {
    const t = (i - start) / sampleRate
    const x = life > 0 ? Math.min(1, t / life) : 1

    const vibrato = layer.pitch.vibratoDepth * Math.sin(2 * Math.PI * layer.pitch.vibratoRate * t)
    const slide = layer.pitch.slide * curveAt(layer.pitch.slideCurve, x)
    const arpeggio = x >= layer.pitch.arpeggioAt ? layer.pitch.arpeggioRatio : 1
    const wanted = layer.pitch.start * Math.pow(2, (slide + vibrato) / 12) * arpeggio * detune
    const frequency = Math.min(nyquist * 0.98, Math.max(1, wanted))
    const dt = frequency / sampleRate

    const raw = layer.source.kind === 'noise'
      ? noise.next(dt)
      : waveAt(layer.source.wave, phase, dt, layer.source.pulseWidth)
    phase = (phase + dt) % 1

    const sweep = Math.pow(2, layer.filter.envAmount * curveAt(layer.filter.envCurve, x))
    const filtered = filterSample(filter, layer.filter.kind, raw, layer.filter.cutoff * sweep, layer.filter.resonance, sampleRate)
    const shaped = shapeSample(shaper, layer.shaper, filtered)
    const amplitude = envelopeAt(layer.amp, fitted, t, life)
    out[i] = (out[i] ?? 0) + shaped * amplitude * layer.gain
  }
}

export function renderPatch(patch: AudioPatch, sampleRate: number): Float32Array {
  const length = Math.max(1, Math.round(Math.max(0.001, patch.duration) * sampleRate))
  const dry = new Float32Array(length)
  patch.layers.forEach((layer, index) => renderLayer(layer, patch, index, dry, sampleRate))

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
