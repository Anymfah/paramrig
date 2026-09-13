import { describe, expect, it } from 'vitest'
import { makeLayer, makePatch, sanitizeAudioPatch } from '../patch'
import { renderPatch } from './render'

/** A patch with a real stereo image: two layers panned apart. */
function stereo(width?: number) {
  const patch = makePatch(0.25, [makeLayer({ pitch: { start: 220 }, pan: -0.8 }), makeLayer({ pitch: { start: 330 }, pan: 0.8 })])
  // Quiet and unlimited, so doubling the sides never reaches the output clamp.
  patch.master.limiter = 0
  patch.master.gain = 0.2
  if (width !== undefined) patch.master.width = width
  return patch
}
const energy = (samples: { left: Float32Array; right: Float32Array }) => {
  let mid = 0, side = 0
  for (let i = 0; i < samples.left.length; i++) {
    const m = (samples.left[i]! + samples.right[i]!) / 2, s = (samples.left[i]! - samples.right[i]!) / 2
    mid += m * m; side += s * s
  }
  return { mid, side }
}

describe('master stereo width', () => {
  it('is absent until set, so older patches serialise and sound exactly as they did', () => {
    expect('width' in stereo().master).toBe(false)
    const once = sanitizeAudioPatch(JSON.parse(JSON.stringify(stereo())))
    expect('width' in once.master).toBe(false)
    expect(JSON.stringify(sanitizeAudioPatch(JSON.parse(JSON.stringify(once))))).toBe(JSON.stringify(once))
    expect(sanitizeAudioPatch(JSON.parse(JSON.stringify(stereo(1.4)))).master.width).toBe(1.4)
    expect(sanitizeAudioPatch(JSON.parse(JSON.stringify(stereo(9)))).master.width).toBe(2)
    const a = renderPatch(stereo(), 16000), b = renderPatch(stereo(1), 16000)
    expect(Array.from(b.left)).toEqual(Array.from(a.left))
  })
  it('folds to mono at 0 and scales the sides without touching the middle', () => {
    const base = energy(renderPatch(stereo(1), 16000))
    const mono = renderPatch(stereo(0), 16000)
    for (let i = 0; i < mono.left.length; i++) expect(mono.left[i]).toBeCloseTo(mono.right[i]!, 6)
    const wide = energy(renderPatch(stereo(2), 16000))
    expect(base.side).toBeGreaterThan(0)
    expect(wide.side / base.side).toBeCloseTo(4, 1)
    expect(wide.mid / base.mid).toBeCloseTo(1, 2)
  })
})
