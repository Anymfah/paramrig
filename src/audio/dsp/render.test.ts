import { describe, expect, it } from 'vitest'
import { monoSum, renderPatch } from '@/audio/dsp/render'
import { PRESETS, coin, makeLayer, makePatch, silentLayer, uiClick } from '@/audio/presets'

const SAMPLE_RATE = 44100
/**
 * The sweeps over every sample of every preset are about shape, not fidelity, and they cost twice
 * what they did before two channels and a delay network, so they run below the rate a file is
 * written at. Not far below: a resonant body tuned to nine kilohertz has nothing to ring with
 * under a rate of sixteen, and the preset would read as silent for a reason that is about the
 * measurement rather than about the sound.
 */
const SCAN_RATE = 32000

/** The engine renders two channels; what is measured here is what the room hears. */
const render = (patch: Parameters<typeof renderPatch>[0], rate = SAMPLE_RATE) => monoSum(renderPatch(patch, rate))
const peak = (samples: Float32Array) => samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0)

describe('renderPatch', () => {
  it('gives back the same buffer for the same patch, every time', () => {
    const first = render(uiClick())
    const second = render(uiClick())
    expect(Array.from(first)).toEqual(Array.from(second))
  })

  it('moves when the seed moves, which is the point of the seed', () => {
    const one = render({ ...uiClick(), seed: 1 })
    const two = render({ ...uiClick(), seed: 2 })
    expect(Array.from(one)).not.toEqual(Array.from(two))
  })

  it('is exactly as long as the patch says', () => {
    const patch = { ...coin(), duration: 0.25 }
    expect(render(patch)).toHaveLength(Math.round(0.25 * SAMPLE_RATE))
    expect(render(patch, 48000)).toHaveLength(Math.round(0.25 * 48000))
  })

  /*
   * The three sweeps below render every preset in the library, so their cost grows with it — they
   * went past the default five seconds when the library reached ninety-four. The timeout is
   * explicit rather than global because these are the only tests that scale with the catalogue,
   * and a sweep quietly taking a minute should still be a failure.
   */
  it('opens and closes on silence, so nothing clicks at either end', () => {
    for (const preset of PRESETS) {
      const samples = render(preset.build(), SCAN_RATE)
      expect(Math.abs(samples[0] ?? 1)).toBe(0)
      expect(Math.abs(samples[samples.length - 1] ?? 1)).toBe(0)
    }
  }, 30_000)

  /**
   * Scanned in a plain loop and asserted once a preset. Written with an `expect` a sample it made
   * over a million assertion calls and timed out — the cost was the assertions, not the audio.
   */
  it('never leaves full scale and never goes non-finite', () => {
    for (const preset of PRESETS) {
      const samples = render(preset.build(), SCAN_RATE)
      let loudest = 0
      let broken = 0
      for (let i = 0; i < samples.length; i += 1) {
        const value = samples[i] ?? 0
        if (!Number.isFinite(value)) broken += 1
        else if (Math.abs(value) > loudest) loudest = Math.abs(value)
      }
      expect(broken, `${preset.id} has non-finite samples`).toBe(0)
      expect(loudest, `${preset.id} goes past full scale`).toBeLessThanOrEqual(1)
    }
  }, 30_000)

  it('makes a sound for every preset', () => {
    for (const preset of PRESETS) {
      expect(peak(render(preset.build(), SCAN_RATE))).toBeGreaterThan(0.05)
    }
  }, 30_000)

  it('renders silence when every layer is off', () => {
    const patch = { ...coin(), layers: [silentLayer(), silentLayer(), silentLayer()] }
    expect(peak(render(patch))).toBe(0)
  })

  it('ignores a layer whose offset lands past the end rather than failing', () => {
    const patch = { ...coin(), duration: 0.2, layers: [makeLayer({ offset: 5 }), silentLayer(), silentLayer()] }
    const samples = render(patch)
    expect(samples).toHaveLength(Math.round(0.2 * SAMPLE_RATE))
    expect(peak(samples)).toBe(0)
  })

  /** Two channels, and they have to be able to differ or none of the width means anything. */
  describe('in two channels', () => {
    const rms = (samples: Float32Array) => {
      let sum = 0
      for (let i = 0; i < samples.length; i += 1) sum += (samples[i] ?? 0) ** 2
      return Math.sqrt(sum / Math.max(1, samples.length))
    }
    const held = (over = {}) => makePatch(0.3, [makeLayer({
      gain: 0.7,
      source: { kind: 'tone', wave: 'saw' },
      pitch: { start: 300 },
      amp: { attack: 0.004, hold: 0.24, decay: 0.02, sustain: 0.9, release: 0.03, curve: 1.5 },
      ...over,
    })], { reverbMix: 0, delayMix: 0, flangerMix: 0 }, { limiter: 0 })

    it('gives both channels the same length', () => {
      const stereo = renderPatch(coin(), SAMPLE_RATE)
      expect(stereo.left).toHaveLength(stereo.right.length)
      expect(stereo.left.length).toBe(Math.round(0.45 * SAMPLE_RATE))
    })

    it('is the same on both sides while nothing is panned or spread', () => {
      const stereo = renderPatch(held({ pan: 0, spread: 0 }), SAMPLE_RATE)
      expect(Array.from(stereo.left)).toEqual(Array.from(stereo.right))
    })

    it('moves a layer across the field', () => {
      const stereo = renderPatch(held({ pan: -0.9, spread: 0 }), SAMPLE_RATE)
      expect(rms(stereo.left)).toBeGreaterThan(rms(stereo.right) * 3)
    })

    /** Equal power: a sound in the middle is as loud as the same sound hard over. */
    it('does not dip in the middle', () => {
      const middle = renderPatch(held({ pan: 0, spread: 0 }), SAMPLE_RATE)
      const side = renderPatch(held({ pan: -1, spread: 0 }), SAMPLE_RATE)
      const power = (stereo: { left: Float32Array; right: Float32Array }) => rms(stereo.left) ** 2 + rms(stereo.right) ** 2
      expect(power(middle)).toBeCloseTo(power(side), 2)
    })

    it('pulls the unison voices apart when they are given spread', () => {
      const tight = renderPatch(held({ source: { kind: 'tone', wave: 'saw', voices: 3, detune: 20 }, spread: 0 }), SAMPLE_RATE)
      const wide = renderPatch(held({ source: { kind: 'tone', wave: 'saw', voices: 3, detune: 20 }, spread: 1 }), SAMPLE_RATE)
      expect(Array.from(tight.left)).toEqual(Array.from(tight.right))
      expect(Array.from(wide.left)).not.toEqual(Array.from(wide.right))
    })

    it('decorrelates a noise layer rather than copying one side to the other', () => {
      const wide = renderPatch(held({ source: { kind: 'noise', colour: 'white' }, spread: 1 }), SAMPLE_RATE)
      expect(Array.from(wide.left)).not.toEqual(Array.from(wide.right))
    })
  })

  /**
   * The thing subtractive synthesis cannot do. Everything else in the engine takes a harmonic wave
   * and removes from it; this makes partials that are multiples of nothing.
   */
  describe('phase modulation', () => {
    const tone = (over = {}) => makePatch(0.3, [makeLayer({
      gain: 0.7,
      source: { kind: 'tone', wave: 'sine', ...over },
      pitch: { start: 400 },
      amp: { attack: 0.004, hold: 0.24, decay: 0.02, sustain: 0.9, release: 0.03, curve: 1.5 },
    })], { reverbMix: 0, delayMix: 0, flangerMix: 0 }, { limiter: 0 })

    it('is a true bypass at no depth', () => {
      const plain = monoSum(renderPatch(tone({ fmIndex: 0, fmRatio: 3.5 }), SAMPLE_RATE))
      const other = monoSum(renderPatch(tone({ fmIndex: 0, fmRatio: 7 }), SAMPLE_RATE))
      expect(Array.from(plain)).toEqual(Array.from(other))
    })

    it('changes the sound once it has depth', () => {
      const plain = monoSum(renderPatch(tone({ fmIndex: 0 }), SAMPLE_RATE))
      const bright = monoSum(renderPatch(tone({ fmIndex: 5, fmRatio: 3.5, fmFall: 0 }), SAMPLE_RATE))
      expect(Array.from(bright)).not.toEqual(Array.from(plain))
    })

    /** A bell loses its clang: the start is not the end, which a static index cannot give. */
    it('falls away across the layer when it is asked to', () => {
      const samples = monoSum(renderPatch(tone({ fmIndex: 7, fmRatio: 5.4, fmFall: 1 }), SAMPLE_RATE))
      const band = (from: number, to: number) => {
        let crossings = 0
        for (let i = from + 1; i < to; i += 1) {
          if (((samples[i] ?? 0) >= 0) !== ((samples[i - 1] ?? 0) >= 0)) crossings += 1
        }
        return crossings
      }
      const early = band(500, 3000)
      const late = band(samples.length - 3500, samples.length - 1000)
      // Zero crossings stand in for brightness: a falling index means fewer of them by the end.
      expect(early).toBeGreaterThan(late * 1.3)
    })

    it('stays finite at the deepest it goes', () => {
      const samples = monoSum(renderPatch(tone({ fmIndex: 10, fmRatio: 12, fmFall: 0 }), SAMPLE_RATE))
      let worst = 0
      let broken = 0
      for (let i = 0; i < samples.length; i += 1) {
        const value = samples[i] ?? 0
        if (!Number.isFinite(value)) broken += 1
        else if (Math.abs(value) > worst) worst = Math.abs(value)
      }
      expect(broken).toBe(0)
      expect(worst).toBeLessThanOrEqual(1)
    })
  })

  it('survives a patch built out of nonsense', () => {
    const patch = {
      ...coin(),
      duration: 0,
      seed: -1,
      layers: [makeLayer({ gain: 1e6, pitch: { start: -50, slide: 900 }, amp: { attack: -1, decay: -1, release: -1 } })],
    }
    const samples = render(patch)
    for (let i = 0; i < samples.length; i += 1) expect(Number.isFinite(samples[i] ?? 0)).toBe(true)
  })

  it('holds its level when the rate changes, so a preset sounds the same at 48k', () => {
    const at44 = peak(render(coin(), 44100))
    const at48 = peak(render(coin(), 48000))
    expect(Math.abs(at44 - at48)).toBeLessThan(0.12)
  })
})

/** Zero crossings a second over a stretch of the sound: a stand-in for its pitch. */
function pitchOf(samples: Float32Array, rate: number, from: number, to: number): number {
  let crossings = 0
  for (let i = Math.round(from * rate) + 1; i < Math.round(to * rate); i += 1) {
    if (((samples[i] ?? 0) >= 0) !== ((samples[i - 1] ?? 0) >= 0)) crossings += 1
  }
  return crossings / (to - from) / 2
}

describe('modulation envelopes', () => {
  const tone = () => makePatch(1, [makeLayer({ gain: 0.5, source: { kind: 'tone', wave: 'sine' }, pitch: { start: 440 }, amp: { attack: 0.001, hold: 1, decay: 0, sustain: 1, release: 0.001 } })])

  it('lifts a pitch it is pointed at while it is up, and not before its delay', () => {
    const still = render(tone())
    const swept = render({ ...tone(), envelopes: [{ enabled: true, delay: 0.5, attack: 0.001, hold: 1, decay: 0, sustain: 1, release: 0.001, curve: 2, depth: 1, target: 'layers[0].pitch' }] })
    // Before the delay the two agree; after it the envelope holds the pitch an octave up.
    expect(Math.abs(pitchOf(swept, SAMPLE_RATE, 0.1, 0.4) - pitchOf(still, SAMPLE_RATE, 0.1, 0.4))).toBeLessThan(20)
    expect(pitchOf(swept, SAMPLE_RATE, 0.6, 0.9) / pitchOf(still, SAMPLE_RATE, 0.6, 0.9)).toBeCloseTo(2, 0)
  })

  it('pulls the other way at a negative depth', () => {
    const still = render(tone())
    const down = render({ ...tone(), envelopes: [{ enabled: true, delay: 0, attack: 0.001, hold: 1, decay: 0, sustain: 1, release: 0.001, curve: 2, depth: -1, target: 'layers[0].pitch' }] })
    expect(pitchOf(down, SAMPLE_RATE, 0.2, 0.8) / pitchOf(still, SAMPLE_RATE, 0.2, 0.8)).toBeCloseTo(0.5, 1)
  })

  it('adds up with another source on the same destination', () => {
    const one = { enabled: true, delay: 0, attack: 0.001, hold: 1, decay: 0, sustain: 1, release: 0.001, curve: 2, depth: 0.5, target: 'layers[0].pitch' }
    const single = render({ ...tone(), envelopes: [one] })
    const both = render({ ...tone(), envelopes: [one, { ...one }] })
    const still = render(tone())
    expect(pitchOf(single, SAMPLE_RATE, 0.2, 0.8) / pitchOf(still, SAMPLE_RATE, 0.2, 0.8)).toBeCloseTo(Math.SQRT2, 1)
    expect(pitchOf(both, SAMPLE_RATE, 0.2, 0.8) / pitchOf(still, SAMPLE_RATE, 0.2, 0.8)).toBeCloseTo(2, 1)
  })

  it('does nothing while it is off, or pointed at nothing', () => {
    const still = render(tone())
    const off = render({ ...tone(), envelopes: [{ enabled: false, delay: 0, attack: 0.001, hold: 1, decay: 0, sustain: 1, release: 0.001, curve: 2, depth: 1, target: 'layers[0].pitch' }] })
    const nowhere = render({ ...tone(), envelopes: [{ enabled: true, delay: 0, attack: 0.001, hold: 1, decay: 0, sustain: 1, release: 0.001, curve: 2, depth: 1, target: 'off' }] })
    expect(off).toEqual(still)
    expect(nowhere).toEqual(still)
  })
})
