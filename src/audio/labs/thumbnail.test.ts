import { describe, expect, it } from 'vitest'
import { makeLayer, makePatch } from '@paramrig/audio'
import { makeLabSound } from './design'
import { DEFAULT_CRITERIA } from './model'
import { sanitizeLabSound } from './session'
import { measureThumbnail, readThumbnail, THUMBNAIL_COLUMNS } from './thumbnail'

describe('audio thumbnail data', () => {
  it('retains signed stereo transients, RMS energy and true silent gaps', () => {
    const left = new Float32Array(THUMBNAIL_COLUMNS * 4)
    const right = new Float32Array(left.length)
    left[4] = 0.8; right[5] = -0.4
    left[8] = 0.5; left[9] = -0.5; right[8] = -0.5; right[9] = 0.5
    const detail = measureThumbnail({ left, right })
    expect(detail.max[1]).toBe(0.8)
    expect(detail.min[1]).toBe(-0.4)
    expect(detail.rms[1]).toBeCloseTo(Math.sqrt((0.8 ** 2 + 0.4 ** 2) / 8), 5)
    // Opposite stereo phase does not disappear as it would in a mono sum.
    expect(detail.rms[2]).toBeCloseTo(Math.sqrt(0.125), 5)
    expect(detail.max.slice(3)).toEqual(Array(THUMBNAIL_COLUMNS - 3).fill(0))
    expect(detail.min.slice(3)).toEqual(Array(THUMBNAIL_COLUMNS - 3).fill(0))
    expect(detail.rms.slice(3)).toEqual(Array(THUMBNAIL_COLUMNS - 3).fill(0))
  })

  it('keeps empty, sub-column and invalid sample inputs finite and bounded', () => {
    for (const values of [[], [0.25], [NaN, Infinity, -3, 2]]) {
      const detail = measureThumbnail({ left: Float32Array.from(values), right: Float32Array.from(values) })
      expect(readThumbnail(detail)).toEqual(detail)
    }
  })

  it('round-trips the optional detail without changing the saved patch, and still accepts legacy previews', () => {
    const sound = sanitizeLabSound(makeLabSound(makePatch(0.3, [makeLayer()]), DEFAULT_CRITERIA, { kind: 'instrument', recipe: 'imported', version: 1, seed: 0, parentIds: [] }, 'A saved sound'))!
    const bins = Array(112).fill(0.3)
    const legacy = { ...sound, preview: { fingerprint: sound.fingerprint, bins } }
    const detail = measureThumbnail({ left: Float32Array.of(0.25), right: Float32Array.of(-0.5) })
    const restored = sanitizeLabSound(JSON.parse(JSON.stringify({ ...legacy, preview: { ...legacy.preview, detail } })))!
    expect(restored.patch).toEqual(sound.patch)
    expect(restored.fingerprint).toBe(sound.fingerprint)
    expect(restored.preview?.detail).toEqual(detail)
    expect(sanitizeLabSound(legacy)?.preview?.bins).toEqual(bins)
    expect(sanitizeLabSound({ ...legacy, preview: { ...legacy.preview, detail: { ...detail, min: [NaN] } } })?.preview?.detail).toBeUndefined()
    expect(sanitizeLabSound({ ...legacy, preview: { ...legacy.preview, fingerprint: 'stale', detail } })?.preview).toBeUndefined()
  })
})
