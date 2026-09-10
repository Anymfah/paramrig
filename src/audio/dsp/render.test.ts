import { describe, expect, it } from 'vitest'
import { monoSum, renderPatch } from '@/audio/dsp/render'
import { PRESETS, coin, makeLayer, makePatch, silentLayer, uiClick } from '@/audio/presets'
import { makeMod, makePerformer } from '@/audio/patch'

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

  /**
   * And the same question of each channel on its own, which is not the same question.
   *
   * Equal-power panning puts a hard-left transient at full scale on the left and at 0.707 of it in
   * the sum, so everything above — which reads the sum — passes a preset that is sitting on the
   * clamp in one channel. Four of the seven Showpiece sounds did exactly that while they were being
   * written, at 1.0000 on one side and under 0.85 in the sum; the exporter found it and no test
   * did. The clamp is what stops it becoming a click, and a sound leaning on it has lost the top
   * of its transient whether or not anybody hears a click.
   *
   * At the rate a file is written at, and not the reduced one the sweeps above use, because
   * headroom is the one question where the rate is part of the answer: a high-Q body excited by
   * noise has a peak that is a draw rather than a number, and at 22 050 `ui-click` reaches the
   * clamp at any gain worth shipping. What a preset is levelled for is the export.
   */
  it('leaves each channel its headroom, not only the sum of the two', () => {
    for (const preset of PRESETS) {
      const stereo = renderPatch(preset.build(), SAMPLE_RATE)
      let pinned = 0
      for (const channel of [stereo.left, stereo.right]) {
        for (let i = 0; i < channel.length; i += 1) if (Math.abs(channel[i] ?? 0) >= 0.999) pinned += 1
      }
      expect(pinned, `${preset.id} is pinned to the clamp for ${pinned} samples of one channel`).toBe(0)
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

describe('a wavetable source', () => {
  const table = (over = {}) => makePatch(0.4, [makeLayer({
    gain: 0.6,
    source: { kind: 'table', table: 'sweep', position: 0.5, ...over },
    pitch: { start: 220 },
    amp: { attack: 0.002, hold: 0.3, decay: 0, sustain: 1, release: 0.02 },
  })])

  it('makes a sound, and the same one twice', () => {
    const first = render(table())
    expect(peak(first)).toBeGreaterThan(0.05)
    expect(Array.from(first)).toEqual(Array.from(render(table())))
  })

  it('changes timbre along the position, not level', () => {
    const loudness = (samples: Float32Array, from = 0, to = samples.length) => {
      let sum = 0
      for (let i = from; i < to; i += 1) sum += (samples[i] ?? 0) ** 2
      return Math.sqrt(sum / Math.max(1, to - from))
    }
    /**
     * How much of the sound sits high: the size of the change from sample to sample against the
     * size of the sound itself. A crossing count cannot read this — a wave with sixty harmonics
     * still crosses zero twice a cycle if its fundamental is what carries it across.
     */
    const brightness = (samples: Float32Array) => {
      let moved = 0
      for (let i = 2205; i < 13230; i += 1) moved += ((samples[i] ?? 0) - (samples[i - 1] ?? 0)) ** 2
      return Math.sqrt(moved / 11025) / Math.max(1e-9, loudness(samples, 2205, 13230))
    }
    const shut = render(table({ position: 0 }))
    const open = render(table({ position: 1 }))
    // The far end of the knob has harmonics the near end does not.
    expect(brightness(open)).toBeGreaterThan(brightness(shut) * 3)
    // And it does not get there by getting louder.
    expect(Math.abs(loudness(open) - loudness(shut))).toBeLessThan(0.25)
  })

  it('plays a different table as a different sound', () => {
    expect(Array.from(render(table({ table: 'bell' })))).not.toEqual(Array.from(render(table({ table: 'growl' }))))
  })

  it('takes an unknown table as the first one rather than falling silent', () => {
    expect(Array.from(render(table({ table: 'not-a-table' })))).toEqual(Array.from(render(table({ table: 'sweep' }))))
  })

  it('holds its harmonics under the rate however high it is played', () => {
    // Six kilohertz leaves room for three harmonics; anything folded down would show as a rise in
    // crossings well below the fundamental.
    const high = render(table({ position: 1 }), SAMPLE_RATE)
    expect(peak(high)).toBeLessThanOrEqual(1)
    const shrill = makePatch(0.3, [makeLayer({
      gain: 0.6,
      source: { kind: 'table', table: 'sweep', position: 1 },
      pitch: { start: 6000 },
      amp: { attack: 0.002, hold: 0.25, decay: 0, sustain: 1, release: 0.02 },
    })])
    expect(peak(render(shrill))).toBeLessThanOrEqual(1)
  })
})

describe('performers', () => {
  const tone = () => makePatch(1, [makeLayer({ gain: 0.5, source: { kind: 'tone', wave: 'sine' }, pitch: { start: 440 }, amp: { attack: 0.001, hold: 1, decay: 0, sustain: 1, release: 0.001 } })])
  const square = Array.from({ length: 16 }, (_, at) => (at < 8 ? 1 : 0))
  const flat = Array.from({ length: 16 }, () => 0)
  const rows = (first: number[]) => Array.from({ length: 12 }, (_, scene) => (scene === 0 ? first : flat))

  it('moves what it is pointed at by its row, over the length of the sound', () => {
    const still = render(tone())
    const drawn = render({ ...tone(), performers: [{ enabled: true, rate: 1, shape: 'step' as const, bipolar: false, depth: 1, target: 'layers[0].pitch', patterns: rows(square) }].map((one) => makePerformer(one)) })
    // The first half of the row is up: an octave. The second half is on the floor: no change.
    expect(pitchOf(drawn, SAMPLE_RATE, 0.1, 0.4) / pitchOf(still, SAMPLE_RATE, 0.1, 0.4)).toBeCloseTo(2, 0)
    expect(Math.abs(pitchOf(drawn, SAMPLE_RATE, 0.6, 0.9) - pitchOf(still, SAMPLE_RATE, 0.6, 0.9))).toBeLessThan(20)
  })

  it('plays the row the patch\'s scene names, and does nothing on an empty one', () => {
    const patch = { ...tone(), performers: [{ enabled: true, rate: 1, shape: 'step' as const, bipolar: false, depth: 1, target: 'layers[0].pitch', patterns: rows(square) }].map((one) => makePerformer(one)) }
    const still = render(tone())
    const other = render({ ...patch, scene: 3 })
    expect(Math.abs(pitchOf(other, SAMPLE_RATE, 0.1, 0.4) - pitchOf(still, SAMPLE_RATE, 0.1, 0.4))).toBeLessThan(20)
  })

  it('rests at half height when bipolar, and pulls down below it', () => {
    const half = Array.from({ length: 16 }, () => 0.5)
    const still = render(tone())
    const resting = render({ ...tone(), performers: [{ enabled: true, rate: 1, shape: 'step' as const, bipolar: true, depth: 1, target: 'layers[0].pitch', patterns: rows(half) }].map((one) => makePerformer(one)) })
    expect(Math.abs(pitchOf(resting, SAMPLE_RATE, 0.2, 0.8) - pitchOf(still, SAMPLE_RATE, 0.2, 0.8))).toBeLessThan(20)
    const down = render({ ...tone(), performers: [{ enabled: true, rate: 1, shape: 'step' as const, bipolar: true, depth: 1, target: 'layers[0].pitch', patterns: rows(flat) }].map((one) => makePerformer(one)) })
    expect(pitchOf(down, SAMPLE_RATE, 0.2, 0.8) / pitchOf(still, SAMPLE_RATE, 0.2, 0.8)).toBeCloseTo(0.5, 1)
  })
})

describe('modulation envelopes', () => {
  const tone = () => makePatch(1, [makeLayer({ gain: 0.5, source: { kind: 'tone', wave: 'sine' }, pitch: { start: 440 }, amp: { attack: 0.001, hold: 1, decay: 0, sustain: 1, release: 0.001 } })])

  it('lifts a pitch it is pointed at while it is up, and not before its delay', () => {
    const still = render(tone())
    const swept = render({ ...tone(), mods: [{ ...makeMod(), kind: 'envelope', enabled: true, delay: 0.5, attack: 0.001, hold: 1, decay: 0, sustain: 1, release: 0.001, curve: 2, depth: 1, target: 'layers[0].pitch' }] })
    // Before the delay the two agree; after it the envelope holds the pitch an octave up.
    expect(Math.abs(pitchOf(swept, SAMPLE_RATE, 0.1, 0.4) - pitchOf(still, SAMPLE_RATE, 0.1, 0.4))).toBeLessThan(20)
    expect(pitchOf(swept, SAMPLE_RATE, 0.6, 0.9) / pitchOf(still, SAMPLE_RATE, 0.6, 0.9)).toBeCloseTo(2, 0)
  })

  it('pulls the other way at a negative depth', () => {
    const still = render(tone())
    const down = render({ ...tone(), mods: [{ ...makeMod(), kind: 'envelope', enabled: true, delay: 0, attack: 0.001, hold: 1, decay: 0, sustain: 1, release: 0.001, curve: 2, depth: -1, target: 'layers[0].pitch' }] })
    expect(pitchOf(down, SAMPLE_RATE, 0.2, 0.8) / pitchOf(still, SAMPLE_RATE, 0.2, 0.8)).toBeCloseTo(0.5, 1)
  })

  it('adds up with another source on the same destination', () => {
    const one = { ...makeMod(), kind: 'envelope' as const, enabled: true, delay: 0, attack: 0.001, hold: 1, decay: 0, sustain: 1, release: 0.001, curve: 2, depth: 0.5, target: 'layers[0].pitch' }
    const single = render({ ...tone(), mods: [one] })
    const both = render({ ...tone(), mods: [one, { ...one }] })
    const still = render(tone())
    expect(pitchOf(single, SAMPLE_RATE, 0.2, 0.8) / pitchOf(still, SAMPLE_RATE, 0.2, 0.8)).toBeCloseTo(Math.SQRT2, 1)
    expect(pitchOf(both, SAMPLE_RATE, 0.2, 0.8) / pitchOf(still, SAMPLE_RATE, 0.2, 0.8)).toBeCloseTo(2, 1)
  })

  it('does nothing while it is off, or pointed at nothing', () => {
    const still = render(tone())
    const off = render({ ...tone(), mods: [{ ...makeMod(), kind: 'envelope', enabled: false, hold: 1, decay: 0, sustain: 1, depth: 1, target: 'layers[0].pitch' }] })
    const nowhere = render({ ...tone(), mods: [{ ...makeMod(), kind: 'envelope', enabled: true, hold: 1, decay: 0, sustain: 1, depth: 1, target: 'off' }] })
    expect(off).toEqual(still)
    expect(nowhere).toEqual(still)
  })
})

/**
 * The things the engine was found doing that it should not have been.
 *
 * Each of these is a measurement of a bug that shipped: a control that moved the level instead of
 * the image, an image that leaned to one side, a modulator whose position retuned its carrier, a
 * layer that opened on a step. They are here so that the fix is not one somebody can undo by
 * accident, since none of them fails any of the sweeps above.
 */
describe('the shape of a layer in the field', () => {
  const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length))
  const held = (over: object = {}, mods: object[] = []) => makePatch(
    0.3,
    [makeLayer({
      gain: 1,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 200 },
      filterA: { kind: 'off' },
      amp: { attack: 0.001, hold: 0.25, decay: 0.01, sustain: 1, release: 0.01, curve: 1 },
      ...over,
    }), silentLayer(), silentLayer()],
    { reverbMix: 0, delayMix: 0, flangerMix: 0 },
    { gain: 1, limiter: 0, fadeOut: 0.001 },
    1,
    mods,
  )
  const panLfo = (depth: number) => [{ ...makeMod(), kind: 'lfo' as const, enabled: true, shape: 'sine' as const, rate: 4, depth, target: 'layers[0].pan' }]

  it('turns a layer without changing how loud it is, wherever it already sits', () => {
    for (const pan of [0, 0.5, 1]) {
      const flat = renderPatch(held({ pan }), SAMPLE_RATE)
      const moved = renderPatch(held({ pan }, panLfo(1)), SAMPLE_RATE)
      const before = Math.hypot(rms(flat.left), rms(flat.right))
      const after = Math.hypot(rms(moved.left), rms(moved.right))
      expect(after / before, `pan ${pan}`).toBeCloseTo(1, 2)
    }
  })

  it('lets a hard-panned layer cross the field, which is what the depth says it does', () => {
    const still = renderPatch(held({ pan: 1 }), SAMPLE_RATE)
    const swept = renderPatch(held({ pan: 1 }, panLfo(1)), SAMPLE_RATE)
    expect(rms(still.left)).toBeCloseTo(0, 5)
    expect(rms(swept.left)).toBeGreaterThan(rms(swept.right) * 0.2)
  })

  it('keeps a spread noise layer in the middle at every width', () => {
    const noise = (spread: number) => renderPatch(held({ spread, source: { kind: 'noise', colour: 'white' } }), SAMPLE_RATE)
    for (const spread of [0, 0.25, 0.5, 0.75, 1]) {
      const out = noise(spread)
      expect(rms(out.right) / rms(out.left), `spread ${spread}`).toBeCloseTo(1, 1)
    }
  })

  it('hands a phase modulator on at full amplitude, whatever that layer is panned to', () => {
    const carrier = (pan: number) => renderPatch(makePatch(
      0.3,
      [
        makeLayer({ gain: 0, pan, source: { kind: 'tone', wave: 'sine' }, pitch: { start: 200 }, filterA: { kind: 'off' }, amp: { attack: 0.001, hold: 0.25, decay: 0.01, sustain: 1, release: 0.01, curve: 1 } }),
        makeLayer({ gain: 1, source: { kind: 'tone', wave: 'sine', pmFrom: 'layer0', fmIndex: 6, fmFall: 0 }, pitch: { start: 200 }, filterA: { kind: 'off' }, amp: { attack: 0.001, hold: 0.25, decay: 0.01, sustain: 1, release: 0.01, curve: 1 } }),
        silentLayer(),
      ],
      { reverbMix: 0, delayMix: 0, flangerMix: 0 },
      { gain: 1, limiter: 0, fadeOut: 0.001 },
      1,
    ), SAMPLE_RATE)
    // A layer at gain zero is inaudible; moving it should not be able to change the sound at all.
    expect(Array.from(carrier(1).left)).toEqual(Array.from(carrier(0).left))
    expect(Array.from(carrier(-0.5).left)).toEqual(Array.from(carrier(0).left))
  })

  it('opens a delayed layer on a ramp rather than on a step', () => {
    const late = renderPatch(makePatch(
      0.5,
      [makeLayer({
        gain: 1,
        offset: 0.25,
        source: { kind: 'tone', wave: 'square' },
        pitch: { start: 60 },
        filterA: { kind: 'off' },
        amp: { attack: 0, hold: 0.1, decay: 0.01, sustain: 1, release: 0.01, curve: 1 },
      }), silentLayer(), silentLayer()],
      { reverbMix: 0, delayMix: 0, flangerMix: 0 },
      { gain: 1, limiter: 0, fadeOut: 0.001 },
      1,
    ), SAMPLE_RATE)
    const at = Math.round(0.25 * SAMPLE_RATE)
    let step = 0
    for (let i = at - 4; i < at + 4; i += 1) step = Math.max(step, Math.abs((late.left[i] ?? 0) - (late.left[i - 1] ?? 0)))
    expect(step).toBeLessThan(0.05)
  })

  it('hears which side of the amplifier an insert stands on', () => {
    // A strike three milliseconds long, so what is left afterwards is the body and nothing else.
    const struck = { gain: 0.4, amp: { attack: 0.0005, hold: 0.002, decay: 0.008, sustain: 0, release: 0.004, curve: 2 } }
    const body = { kind: 'body' as const, amount: 1, frequency: 900, spread: 0.4, decay: 0.25, partials: 3 }
    const before = render(held({ ...struck, insertA: { ...body, place: 'pre' as const } }))
    const after = render(held({ ...struck, insertA: { ...body, place: 'post' as const } }))
    expect(Array.from(before)).not.toEqual(Array.from(after))
    // A body after the amplifier rings past the envelope; before it, the envelope cuts it off.
    const tail = (samples: Float32Array) => peak(samples.slice(Math.round(0.1 * SAMPLE_RATE)))
    expect(tail(after)).toBeGreaterThan(tail(before) * 4)
  })
})
