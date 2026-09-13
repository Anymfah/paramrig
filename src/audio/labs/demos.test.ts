import { describe, expect, it } from 'vitest'
import { LAB_DEMOS, labDemo } from './demos'
import { probePatch, probeStereo } from '../shuffle-draw'
import { renderPatch } from '@paramrig/audio'
import { mappedPatch } from './design'

describe('Labs showcase', () => {
  it('calibrates the stereo probe with known samples', () => {
    const probe = probeStereo({ left: Float32Array.of(-0.5, 0.5), right: Float32Array.of(0.25, -0.25) })
    expect(probe.peak).toBe(0.5); expect(probe.rms).toBe(0.5); expect(probe.mono).toBe(0.125); expect(probe.finite).toBe(true)
  })
  it('ships five editable examples including one guided fusion', () => {
    expect(LAB_DEMOS).toHaveLength(5)
    for (const { id } of LAB_DEMOS) {
      const sound = labDemo(id)
      expect(sound.controls).toHaveLength(4)
      expect(mappedPatch(sound)).toEqual(sound.patch)
      const probe = probePatch(sound.patch, 48000)
      const measured = probeStereo(renderPatch(sound.patch, 48000))
      expect(probe.peak * sound.patch.master.gain).toBeLessThan(0.81)
      expect(measured.peak).toBeGreaterThan(0.2)
      expect(measured.peak).toBeLessThan(0.9)
      expect(measured.rms).toBeGreaterThan(0.015)
      expect(measured.finite).toBe(true)
    }
    expect(labDemo('titan-splice').parents).toHaveLength(2)
  })
})
