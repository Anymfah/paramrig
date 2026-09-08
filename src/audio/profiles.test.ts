import { describe, expect, it } from 'vitest'
import { LAYER_COLOURS, layerProfiles, profileCeiling } from '@/audio/profiles'
import { makeLayer, makePatch, silentLayer } from '@/audio/patch'
import { coin, explosion } from '@/audio/presets'

describe('layerProfiles', () => {
  it('describes every layer, whether or not it is switched on', () => {
    const profiles = layerProfiles(coin())
    expect(profiles).toHaveLength(3)
    expect(profiles.map((profile) => profile.enabled)).toEqual([true, false, false])
    expect(profiles.map((profile) => profile.name)).toEqual(['Layer 1', 'Layer 2', 'Layer 3'])
    expect(profiles.map((profile) => profile.color)).toEqual(LAYER_COLOURS)
  })

  it('keeps every point inside the unit square, which is what the paths expect', () => {
    for (const profile of layerProfiles(explosion())) {
      for (const point of profile.points) {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(1)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(point.y)).toBe(true)
      }
    }
  })

  it('runs left to right, so a curve never doubles back on itself', () => {
    for (const profile of layerProfiles(explosion())) {
      for (let index = 1; index < profile.points.length; index += 1) {
        expect(profile.points[index]!.x).toBeGreaterThan(profile.points[index - 1]!.x)
      }
    }
  })

  /** When a layer starts is the whole reason the overlay exists, so it has to appear late. */
  it('holds a delayed layer at zero until it starts', () => {
    const patch = makePatch(1, [makeLayer({ offset: 0.5, amp: { attack: 0.01, hold: 0, decay: 0.2, sustain: 0, release: 0.1, curve: 2 } })])
    const points = layerProfiles(patch)[0]!.points
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points.filter((point) => point.x < 0.5).every((point) => point.y === 0)).toBe(true)
    expect(points.some((point) => point.x > 0.5 && point.y > 0)).toBe(true)
  })

  it('scales a layer by its gain, so a quiet layer looks quiet', () => {
    const loud = layerProfiles(makePatch(0.5, [makeLayer({ gain: 1 })]))[0]!
    const quiet = layerProfiles(makePatch(0.5, [makeLayer({ gain: 0.25 })]))[0]!
    expect(Math.max(...loud.points.map((point) => point.y))).toBeGreaterThan(Math.max(...quiet.points.map((point) => point.y)))
  })

  it('always gives a curve at least two points to be drawn through', () => {
    for (const profile of layerProfiles(makePatch(0.1, [silentLayer(), silentLayer(), silentLayer()]))) {
      expect(profile.points.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('profileCeiling', () => {
  it('is the tallest enabled layer, so nothing is flattened by one that is off', () => {
    const patch = makePatch(0.5, [makeLayer({ gain: 0.3 }), { ...makeLayer({ gain: 1.4 }), enabled: false }])
    expect(profileCeiling(layerProfiles(patch))).toBeLessThan(0.5)
  })

  it('never returns zero, so nothing is ever divided by it', () => {
    expect(profileCeiling([])).toBe(1)
    expect(profileCeiling(layerProfiles(makePatch(0.2, [silentLayer()])))).toBe(1)
  })
})
