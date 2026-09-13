import { describe, expect, it } from 'vitest'
import { renderPatch } from '@paramrig/audio'
import { pmOrder } from '../dsp/engine'
import { LINEAR } from '@paramrig/audio/curves'
import { mulberry32 } from '@paramrig/audio/random'
import { performerAt } from '../dsp/performer'
import { makeLayer, makePatch } from '@paramrig/audio'
import type { AudioPatch, Stereo } from '@paramrig/audio'
import { fft } from './analysis'
import { adjustReference } from './design'
import { composeExploration } from './composition'
import { sanitizeLabSound } from './session'
import { generateSound, generateSignatureSound, renderCandidate, createLabBatch } from './generate'
import { DEFAULT_CRITERIA, LAB_CHARACTERS, LAB_MATERIALS, LAB_MOTIONS, LAB_TYPES } from './model'

const fixed = { ...DEFAULT_CRITERIA, minMs: 500, maxMs: 500 }

// This deliberately ignores pitch, seed, gain and continuous knob positions. A new noise
// seed or a transposition of the same patch is not a different synthesis construction.
function topology(patch: AudioPatch): string {
  return JSON.stringify(patch.layers.filter((l) => l.enabled).map((l) => [l.source.kind,
    l.source.kind === 'table' ? l.source.table : l.source.kind === 'tone' ? l.source.wave : l.source.colour,
    l.source.pmFrom, l.routing, l.filterA.kind, l.routing === 'single' ? 'off' : l.filterB.kind,
    ...[l.insertA, l.insertB, l.insertC].map((insert) => [insert.kind, insert.kind === 'body' ? insert.profile : '', insert.place])]))
}

// Broad spectral energy and the event envelope are measured from samples, independently of
// recipe names. Calibration below guards against a plausible-looking but broken probe.
function features(samples: Stereo, rate: number): number[] {
  const length = samples.left.length, size = 1024
  const bands = Array<number>(7).fill(0)
  const edges = [0, 160, 400, 1000, 2400, 5000, 9000, rate / 2 + 1]
  for (let start = 0; start + size <= length; start += size) {
    const re = new Float32Array(size), im = new Float32Array(size)
    for (let i = 0; i < size; i++) re[i] = (samples.left[start + i]! + samples.right[start + i]!) * 0.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)))
    fft(re, im)
    for (let k = 1; k < size / 2; k++) {
      const frequency = k * rate / size
      const band = edges.findIndex((edge, i) => i > 0 && frequency < edge) - 1
      if (band >= 0) bands[band]! += re[k]! ** 2 + im[k]! ** 2
    }
  }
  const sum = bands.reduce((a, b) => a + b, 0) || 1
  const envelope = Array.from({ length: 16 }, (_, bin) => {
    const from = Math.floor(bin * length / 16), to = Math.floor((bin + 1) * length / 16)
    let energy = 0
    for (let i = from; i < to; i++) energy += (samples.left[i]! ** 2 + samples.right[i]! ** 2) / 2
    return Math.sqrt(energy / Math.max(1, to - from))
  })
  const maximum = Math.max(...envelope, 1e-9)
  return [...bands.map((v) => v / sum), ...envelope.map((v) => v / maximum)]
}
const distance = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / a.length

describe('Labs exploration diversity', () => {
  it('calibrates topology and audio probes on known unchanged and different signals', () => {
    const a = makePatch(0.5, [makeLayer({ source: { wave: 'sine' } })])
    const b = structuredClone(a); b.seed += 17; b.layers[0]!.pitch.start *= 2; b.master.gain *= 0.25
    expect(topology(a)).toBe(topology(b))
    b.layers[0]!.source.kind = 'noise'
    expect(topology(a)).not.toBe(topology(b))
    const sine = (hz: number, gain = 1): Stereo => {
      const mono = Float32Array.from({ length: 24000 }, (_, i) => gain * Math.sin(i * hz * 2 * Math.PI / 48000))
      return { left: mono, right: mono }
    }
    // Bin-centred tones well inside each band avoid leakage across a band boundary.
    const low = features(sine(750), 48000), high = features(sine(3750), 48000)
    expect(low[2]).toBeGreaterThan(0.98); expect(high[4]).toBeGreaterThan(0.98)
    expect(distance(low, features(sine(750, 0.15), 48000))).toBeLessThan(1e-5)
    expect(distance(low, high)).toBeGreaterThan(0.08)
  })

  it('offers multiple actual source graphs in every family at fixed duration', () => {
    for (const type of LAB_TYPES) {
      const designs = Array.from({ length: 48 }, (_, i) => generateSound({ ...fixed, type }, i * 7919 + 171))
      expect(new Set(designs.map((s) => s.origin.recipe.split('/')[2])).size, type).toBeGreaterThanOrEqual(3)
      expect(new Set(designs.map((s) => topology(s.patch))).size, type).toBeGreaterThanOrEqual(24)
      for (const sound of designs) {
        const links = pmOrder(sound.patch.layers)
        for (const [i, layer] of sound.patch.layers.entries()) {
          if (!layer.enabled) continue
          expect(sound.roles[i]).not.toBe('unknown')
          if (layer.source.pmFrom !== 'internal') {
            const source = Number(layer.source.pmFrom.slice(5))
            expect(sound.patch.layers[source]?.enabled).toBe(true)
            expect(links.from[i]).toBe(source) // The engine must not have to break a cycle.
          }
        }
      }
    }
  })

  it('uses the source, wavetable, resonator, filter and insert palettes', () => {
    const tables = new Set(), sources = new Set(), profiles = new Set(), inserts = new Set(), filters = new Set()
    for (const type of LAB_TYPES) for (let seed = 0; seed < 40; seed++) {
      const sound = generateSound({ ...fixed, type, material: 'any', character: 'any' }, seed * 7919)
      for (const l of sound.patch.layers.filter((layer) => layer.enabled)) {
        sources.add(l.source.kind)
        if (l.source.kind === 'table') tables.add(l.source.table)
        filters.add(l.filterA.kind)
        if (l.routing !== 'single') filters.add(l.filterB.kind)
        for (const insert of [l.insertA, l.insertB, l.insertC]) {
          inserts.add(insert.kind)
          if (insert.kind === 'body') profiles.add(insert.profile)
        }
      }
    }
    expect(sources.size).toBe(3); expect(tables.size).toBe(13); expect(profiles.size).toBe(6)
    expect(filters.size).toBeGreaterThanOrEqual(8)
    expect(inserts).toEqual(new Set(['off', 'drive', 'fold', 'comb', 'body', 'ring', 'crusher']))
    // Explicit electrical material must continue to select electrical processing.
    const electric = Array.from({ length: 32 }, (_, seed) => generateSound({ ...fixed, material: 'electrical' }, seed))
    expect(electric.some((s) => s.patch.layers.some((l) => l.enabled && l.insertC.kind === 'crusher'))).toBe(true)
    expect(electric.some((s) => s.patch.layers.some((l) => l.enabled && l.insertC.kind === 'ring'))).toBe(true)
  })

  it('changes phrases while preserving requested motion and continuous bodies', () => {
    for (const motion of LAB_MOTIONS) {
      const sounds = Array.from({ length: 16 }, (_, seed) => generateSound({ ...fixed, motion }, seed))
      expect(new Set(sounds.map((s) => JSON.stringify(s.patch.performers[0]!.patterns[0]))).size, motion).toBeGreaterThan(12)
      for (const { patch } of sounds) {
        expect(patch.performers[0]!.bipolar).toBe(true)
        if (motion === 'continuous') {
          expect(patch.performers[0]!.target).not.toContain('.gain')
          expect(patch.layers[0]!.amp.hold).toBeGreaterThan(0.1)
        }
      }
    }
  })

  it('still varies the rendered timbre and envelope when pitch and duration cannot change', () => {
    const renderFixedPitch = (patch: AudioPatch) => {
      patch.layers.forEach((l) => { l.pitch = { ...l.pitch, start: 180, slide: 0, slideCurve: LINEAR, jitter: 0, vibratoDepth: 0, arpeggioRatio: 1 } })
      return features(renderPatch(patch, 24000), 24000)
    }
    const dispersion = [generateSignatureSound, generateSound].map((generate) => {
      const spectra = Array.from({ length: 12 }, (_, i) => renderFixedPitch(generate(fixed, 171 + i * 7919).patch))
      const spread = spectra.flatMap((a, i) => spectra.slice(i + 1).map((b) => distance(a, b)))
      return spread.reduce((a, b) => a + b, 0) / spread.length
    })
    expect(dispersion[1]).toBeGreaterThan(0.12)
    expect(dispersion[1]!).toBeGreaterThan(dispersion[0]! * 1.5)
  })

  it('renders crossed families and materials without relying on rejection to hide bad recipes', () => {
    const rejected: string[] = []
    for (const [n, type] of LAB_TYPES.entries()) for (const [i, material] of LAB_MATERIALS.entries()) {
      const sound = generateSound({ ...fixed, type, material, character: LAB_CHARACTERS[i]! }, 171 + n * 997 + i * 7919)
      const render = renderCandidate(sound, 24000)
      if (!render) { rejected.push(`${type}/${material}`); continue }
      expect(render.peak).toBeLessThan(0.99); expect(render.rms).toBeGreaterThan(0.001)
      expect(render.spectrum.values.every(Number.isFinite)).toBe(true)
      expect(render.samples.left).toHaveLength(12000)
      expect(Math.abs(render.samples.left.at(-1)!)).toBeLessThan(0.01)
    }
    expect(rejected).toEqual([])
  }, 60000)

  it('keeps both duration limits and exclusions renderable at playback rate', () => {
    for (const [i, type] of LAB_TYPES.entries()) {
      const ms = i % 3 === 0 ? 4000 : 20
      const result = createLabBatch({ mode: 'create', count: 1, criteria: { ...fixed, type, minMs: ms, maxMs: ms, avoid: ['sub', 'piercing', 'click', 'reverb'] }, seed: 171 + i * 997 }, 48000)
      expect(result.issue, type).toBe('')
      expect(result.results).toHaveLength(1)
      expect(result.results[0]!.samples.left.length).toBe(Math.round(ms * 48))
    }
  }, 60000)

  it('can vary the normalized discoveries actually delivered to the bench', () => {
    for (const seed of [17, 71, 171, 3626, 7802, 17141]) {
      const rendered = renderCandidate(generateSound(fixed, seed), 24000)
      expect(rendered).not.toBeNull()
      const reference = adjustReference(rendered!.sound, [0.51, 0.5, 0.5, 0.5])
      const result = createLabBatch({ mode: 'vary', criteria: fixed, seed: 5917, count: 1, reference, locks: [true, false, false, false], amount: 'subtle' }, 24000)
      expect(result.issue, `reference ${seed}`).toBe('')
      expect(result.results).toHaveLength(1)
      expect(result.results[0]!.sound.patch.master.gain).toBe(reference.patch.master.gain)
    }
  }, 30000)

  it('avoids the two recent engines without changing intent or mutating the request', () => {
    for (const type of LAB_TYPES) {
      const recent: string[] = []
      for (let i = 0; i < 12; i++) {
        const criteria = { ...fixed, type }
        const before = [...recent]
        const sound = generateSound(criteria, 17, recent)
        expect(sound.criteria).toEqual(criteria)
        expect(before.slice(-2).map((recipe) => recipe.split('/')[2])).not.toContain(sound.origin.recipe.split('/')[2])
        expect(generateSound(criteria, 17, recent)).toEqual(sound)
        expect(recent).toEqual(before)
        recent.push(sound.origin.recipe)
      }
    }
    const reference = generateSound(fixed, 17)
    expect(generateSound(fixed, 17, ['imported', 'explore-v3/impact/phase/strike'])).toEqual(reference)
    const request = { mode: 'create' as const, criteria: fixed, count: 4, seed: 17, recentRecipes: [reference.origin.recipe] }
    const before = structuredClone(request)
    const result = createLabBatch(request, 16000)
    expect(result.issue).toBe(''); expect(result.results).toHaveLength(4)
    const engines = [...request.recentRecipes, ...result.results.map((r) => r.sound.origin.recipe)].map((recipe) => recipe.split('/')[2])
    engines.forEach((engine, i) => expect(engines.slice(Math.max(0, i - 2), i)).not.toContain(engine))
    expect(request).toEqual(before)
  })

  it('moves foreground energy between unchanged oscillator sources', () => {
    const base = makePatch(1, [120, 960].map((frequency) => makeLayer({ gain: 0.35,
      source: { wave: 'sine', fmIndex: 0 }, pitch: { start: frequency },
      amp: { attack: 0.01, hold: 0.7, decay: 0.1, sustain: 0.8, release: 0.1 } })), {}, { gain: 0.5, limiter: 0 })
    const variants = new Map<string, AudioPatch>()
    for (let seed = 0; seed < 60; seed++) {
      const patch = structuredClone(base)
      const kind = composeExploration(patch, ['body', 'texture', 'unknown', 'unknown'], fixed, mulberry32(seed), 1)
      expect(patch.layers.map((layer) => layer.source)).toEqual(base.layers.map((layer) => layer.source))
      expect(patch.layers.map((layer) => layer.pitch)).toEqual(base.layers.map((layer) => layer.pitch))
      if (kind !== 'direct') for (const p of patch.performers.filter((p) => p.enabled)) {
        expect(performerAt(p, p.patterns[0]!, p.curves[0], 1, 1)).toBeCloseTo(p.patterns[0]!.at(-1)! * 2 - 1)
      }
      variants.set(kind, patch)
    }
    expect(variants.size).toBe(5)
    const spectra = [...variants.values()].map((patch) => features(renderPatch(patch, 24000), 24000))
    const differences = spectra.slice(1).map((f) => distance(f, spectra[0]!))
    expect(differences.filter((d) => d > 0.08).length).toBeGreaterThanOrEqual(3)
    const crossfade = renderPatch(variants.get('crossfade')!, 24000)
    const first = features({ left: crossfade.left.slice(0, 8000), right: crossfade.right.slice(0, 8000) }, 24000)
    const last = features({ left: crossfade.left.slice(16000), right: crossfade.right.slice(16000) }, 24000)
    // First voice is 120 Hz, answering voice is 960 Hz. This checks the audible handover.
    expect(first[0]).toBeGreaterThan(last[0]!)
    expect(last[2]).toBeGreaterThan(first[2]!)
  })

  it('uses distinct PM graphs without losing dependencies when a sound is kept and reloaded', () => {
    const graphs = new Set<string>()
    for (let seed = 0; seed < 120; seed++) {
      const sound = generateSound({ ...fixed, type: 'transformation' }, seed)
      const graph = sound.origin.recipe.split('/').at(-1)!
      graphs.add(graph)
      const restored = sanitizeLabSound(JSON.parse(JSON.stringify(sound)))!
      expect(restored.roles).toEqual(sound.roles)
      expect(restored.patch).toEqual(sound.patch)
      const order = pmOrder(sound.patch.layers)
      for (const [i, layer] of sound.patch.layers.entries()) if (layer.enabled && layer.source.pmFrom !== 'internal') {
        const from = Number(layer.source.pmFrom.slice(5))
        expect(from).toBeGreaterThan(i)
        expect(sound.patch.layers[from]?.enabled).toBe(true)
        expect(order.from[i]).toBe(from)
      }
    }
    expect(graphs).toEqual(new Set(['independent', 'pair', 'chain', 'fork']))
  })
})
