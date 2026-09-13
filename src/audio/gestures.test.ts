import { describe, expect, it } from 'vitest'
import { gestureAt, sanitizeGesture, sanitizeGestures, simplifyGesture, takeFromSamples } from '@/audio/gestures'
import { LINEAR } from '@/audio/dsp/curve'

describe('gestures', () => {
  it('keeps a rise, a rush, a retreat and a cut', () => {
    const times = [0, 0.2, 0.4, 0.55, 0.7, 0.85, 1]
    const values = [0, 0.2, 0.35, 0.8, 0.55, 0.1, 0]
    const points = takeFromSamples(times, values, 0, 1)
    expect(points[0]?.t).toBe(0)
    expect(points[points.length - 1]?.t).toBe(1)
    expect(points.length).toBeGreaterThan(4)
    const mid = gestureAt({
      id: 'take', macro: 0, enabled: true, start: 0, duration: 1, points,
      destinations: [{ property: 'layers[0].gain', from: 0, to: 1, invert: false, curve: LINEAR }],
    }, 0.55)
    expect(mid).toBeGreaterThan(0.6)
  })

  it('does not flatten a take down to sixteen points just because a performer is', () => {
    const times = Array.from({ length: 200 }, (_, i) => i / 199)
    const values = times.map((t) => Math.sin(t * Math.PI * 4) * 0.5 + 0.5)
    const points = simplifyGesture(times.map((t, i) => ({ t, v: values[i] ?? 0 })))
    expect(points.length).toBeGreaterThan(16)
    expect(points.length).toBeLessThan(200)
  })

  it('drops a take that cannot be read', () => {
    expect(sanitizeGestures([{ id: 'x' }])).toEqual([])
  })
})

it('sorts timestamps, merges duplicates and rejects malformed curves', () => {
  const gesture = sanitizeGesture({ id: 'safe', macro: 0, duration: 1, points: [{ t: 1, v: 1 }, { t: 0, v: 0 }, { t: 0, v: 0.2 }], destinations: [{ property: 'master.gain', from: 0, to: 1, curve: { type: 'cubic-bezier' } }] })!
  expect(gesture.points).toEqual([{ t: 0, v: 0.2 }, { t: 1, v: 1 }])
  expect(gesture.destinations[0]?.curve.p0).toEqual([0, 0])
  expect(gestureAt(gesture, 0.5)).toBeCloseTo(0.6)
})
