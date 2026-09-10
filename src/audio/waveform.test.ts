import { describe, expect, it } from 'vitest'
import { decibels, levels, meterAt, waveformBands } from '@/audio/waveform'

describe('waveformBands', () => {
  it('returns one band a column, whatever the sample count', () => {
    expect(waveformBands(new Float32Array(4000), 200)).toHaveLength(200)
    expect(waveformBands(new Float32Array(7), 200)).toHaveLength(200)
  })

  it('keeps the extremes of what fell in each column', () => {
    const samples = Float32Array.from([1, -1, 0, 0, 0.5, 0.25, -0.75, 0])
    const bands = waveformBands(samples, 2)
    expect(bands[0]).toEqual({ min: -1, max: 1 })
    expect(bands[1]).toEqual({ min: -0.75, max: 0.5 })
  })

  /** A peak that falls between two pixels is what gives a click its character; it must survive. */
  it('does not lose a lone peak when the buffer is far wider than the view', () => {
    const samples = new Float32Array(10000)
    samples[7777] = 1
    expect(waveformBands(samples, 100).some((band) => band.max === 1)).toBe(true)
  })

  it('reads an empty buffer as a flat line rather than failing', () => {
    expect(waveformBands(new Float32Array(0), 3)).toEqual([{ min: 0, max: 0 }, { min: 0, max: 0 }, { min: 0, max: 0 }])
  })

  it('never asks for fewer than one column', () => {
    expect(waveformBands(new Float32Array(10), 0)).toHaveLength(1)
    expect(waveformBands(new Float32Array(10), -5)).toHaveLength(1)
  })
})

describe('levels', () => {
  it('reports the loudest sample and the average power', () => {
    const { peak, rms } = levels(Float32Array.from([0.5, -0.9, 0.1, 0]))
    expect(peak).toBeCloseTo(0.9, 6)
    expect(rms).toBeCloseTo(Math.sqrt((0.25 + 0.81 + 0.01) / 4), 6)
  })

  it('reads silence as silence rather than dividing by nothing', () => {
    expect(levels(new Float32Array(0))).toEqual({ peak: 0, rms: 0 })
  })
})

describe('decibels', () => {
  it('writes full scale as zero and silence as a dash', () => {
    expect(decibels(1)).toBe('0.0 dB')
    expect(decibels(0)).toBe('—')
    expect(decibels(0.5)).toBe('-6.0 dB')
  })
})

/**
 * A meter that is a function of the buffer rather than of how many times it has been drawn.
 *
 * It used to be a ref carried from frame to frame and written during render, which React is
 * entitled to catch: a component rendered twice for the same playhead let the needle down twice,
 * and a re-render from anything else — a knob moved while a sound plays — let it down out of time.
 */
describe('meterAt', () => {
  const tone = (seconds: number, rate = 44100, amplitude = 1) => {
    const total = Math.round(seconds * rate)
    const left = new Float32Array(total)
    const right = new Float32Array(total)
    for (let i = 0; i < total; i += 1) {
      left[i] = Math.sin((2 * Math.PI * 200 * i) / rate) * amplitude
      right[i] = left[i]! * 0.5
    }
    return { left, right }
  }

  it('reads the same at the same instant, however many times it is asked', () => {
    const held = tone(0.2)
    const once = meterAt(held, 4000, 44100)
    for (let again = 0; again < 3; again += 1) expect(meterAt(held, 4000, 44100)).toEqual(once)
  })

  it('answers each channel on its own', () => {
    const level = meterAt(tone(0.2), 4000, 44100)
    expect(level.left).toBeCloseTo(1, 1)
    expect(level.right).toBeCloseTo(0.5, 1)
  })

  it('lets the needle down after the sound stops instead of dropping it', () => {
    const struck = tone(0.4)
    struck.left.fill(0, 4410)
    struck.right.fill(0, 4410)
    const at = (seconds: number) => meterAt(struck, seconds * 44100, 44100).left
    expect(at(0.1)).toBeCloseTo(1, 1)
    // One time constant later it is down to about a third; three of them later, to a twentieth;
    // and past the window the needle rests.
    expect(at(0.185)).toBeLessThan(0.4)
    expect(at(0.185)).toBeGreaterThan(0.25)
    expect(at(0.35)).toBeLessThan(0.07)
    expect(at(0.4)).toBe(0)
  })

  it('says nothing rather than throwing when the buffer is empty or the playhead is off the end', () => {
    expect(meterAt({ left: new Float32Array(0), right: new Float32Array(0) }, 0, 44100)).toEqual({ left: 0, right: 0 })
    const held = tone(0.05)
    expect(meterAt(held, 1e9, 44100).left).toBeGreaterThan(0)
    expect(meterAt(held, -50, 44100).left).toBeGreaterThanOrEqual(0)
  })
})
