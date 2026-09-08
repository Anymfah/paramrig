import { describe, expect, it } from 'vitest'
import { decibels, levels, waveformBands } from '@/audio/waveform'

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
