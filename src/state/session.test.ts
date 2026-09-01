import { describe, expect, it } from 'vitest'
import { contourBloomManifest } from '@/rigs/examples/contour-bloom'
import { tidalPlanetManifest } from '@/rigs/examples/tidal-planet'
import { RigSession } from '@/state/session'
import { interpolateNumber, upsertKeyframe } from '@/state/values'

describe('RigSession', () => {
  it('resets a single parameter without touching the others', () => {
    const session = new RigSession(contourBloomManifest)
    session.setValue('lobes', 12)
    session.setValue('amplitude', 0.4)
    session.resetParam('lobes')
    const values = session.viewValues()
    expect(values.lobes).toBe(6)
    expect(values.amplitude).toBe(0.4)
  })

  it('groups a slider gesture into one undo step', () => {
    const session = new RigSession(contourBloomManifest)
    session.beginGesture()
    session.setValue('twist', 10)
    session.setValue('twist', 20)
    session.setValue('twist', 40)
    session.endGesture()
    expect(session.viewValues().twist).toBe(40)
    session.undo()
    expect(session.viewValues().twist).toBe(
      contourBloomManifest.parameters.find((p) => p.id === 'twist')?.defaultValue,
    )
    session.redo()
    expect(session.viewValues().twist).toBe(40)
  })

  it('cancels a gesture without pushing history', () => {
    const session = new RigSession(contourBloomManifest)
    session.setValue('amplitude', 0.4)
    session.beginGesture()
    session.setValue('amplitude', 0.1)
    session.setValue('amplitude', 0.55)
    session.cancelGesture()
    expect(session.viewValues().amplitude).toBe(0.4)
    expect(session.canUndo()).toBe(true)
    session.undo()
    expect(session.viewValues().amplitude).toBe(
      contourBloomManifest.parameters.find((p) => p.id === 'amplitude')?.defaultValue,
    )
    expect(session.canRedo()).toBe(true)
  })

  it('resets a section as a single undo step', () => {
    const session = new RigSession(contourBloomManifest)
    session.setValue('lobes', 12)
    session.setValue('amplitude', 0.4)
    session.setValue('layers', 10)
    session.resetParams(['lobes', 'amplitude'])
    expect(session.viewValues().lobes).toBe(6)
    expect(session.viewValues().amplitude).toBe(0.18)
    expect(session.viewValues().layers).toBe(10)
    session.undo()
    expect(session.viewValues().lobes).toBe(12)
    expect(session.viewValues().amplitude).toBe(0.4)
    expect(session.viewValues().layers).toBe(10)
  })

  it('keeps snapshots isolated from later edits', () => {
    const session = new RigSession(contourBloomManifest)
    session.setValue('lobes', 8)
    const snap = session.captureSnapshot('Study A')
    session.setValue('lobes', 11)
    expect(session.viewValues().lobes).toBe(11)
    expect(snap.values.lobes).toBe(8)
    session.setCompare('original')
    expect(session.previewValues().lobes).toBe(8)
    session.setCompare('current')
    expect(session.previewValues().lobes).toBe(11)
    session.restoreSnapshot(snap.id)
    expect(session.viewValues().lobes).toBe(8)
    expect(session.toExport().values.lobes).toBe(8)
  })

  it('does not mark a fresh animated rig as dirty at a later playhead', () => {
    const session = new RigSession(tidalPlanetManifest)
    expect(session.changedSinceBaseline()).toEqual([])
    session.setPlayhead(2.4)
    expect(session.changedSinceBaseline()).toEqual([])
  })

  it('marks a keyframe edit dirty and restores it from a snapshot', () => {
    const session = new RigSession(tidalPlanetManifest)
    session.captureSnapshot('Orbit')
    session.setPlayhead(2.4)
    session.setValue('rotationY', 120)
    expect(session.liveNumber('rotationY')).toBeCloseTo(120, 5)
    expect(session.changedSinceBaseline()).toContain('rotationY')
    const snap = session.getSnapshot().snapshots[0]
    expect(snap).toBeTruthy()
    session.restoreSnapshot(snap!.id)
    expect(session.liveNumber('rotationY')).toBeCloseTo(108, 5)
    expect(session.changedSinceBaseline()).toEqual([])
  })

  it('playback ticks the clock without bumping the structural revision', () => {
    const session = new RigSession(tidalPlanetManifest)
    let structural = 0
    let clock = 0
    session.subscribe(() => {
      structural += 1
    })
    session.subscribeClock(() => {
      clock += 1
    })
    const revision = session.getRevision()
    session.setPlayhead(1.2, true)
    expect(session.getRevision()).toBe(revision)
    expect(session.playheadTime()).toBeCloseTo(1.2, 10)
    expect(session.displayPlayhead()).toBeCloseTo(1.2, 5)
    expect(structural).toBe(0)
    expect(clock).toBe(1)
    expect(session.liveNumber('rotationY')).toBeCloseTo(54, 5)
    session.setPlayhead(2.4)
    expect(session.getRevision()).toBeGreaterThan(revision)
    expect(structural).toBe(1)
    expect(session.isPlaying()).toBe(false)
  })

  it('accumulates sub-frame playback deltas instead of snapping them away', () => {
    const session = new RigSession(tidalPlanetManifest)
    for (let i = 0; i < 10; i += 1) {
      session.setPlayhead(session.playheadTime() + 0.008, true)
    }
    expect(session.playheadTime()).toBeCloseTo(0.08, 5)
    expect(session.displayPlayhead()).toBeCloseTo(0.067, 3)
  })

  it('exports the live values and animation data, not hardcoded examples', () => {
    const session = new RigSession(tidalPlanetManifest)
    session.setValue('seed', 1234)
    session.setPlayhead(2.4)
    const doc = session.toExport()
    expect(doc.version).toBe(1)
    expect(doc.rigId).toBe('tidal-planet')
    expect(doc.values.seed).toBe(1234)
    expect(doc.animation?.playhead).toBe(2.4)
    expect(doc.animation?.tracks.some((track) => track.paramId === 'rotationY')).toBe(true)
    expect(typeof doc.values.rotationY).toBe('number')
  })

  it('compares the reference animation at the same playhead as the edited animation', () => {
    const session = new RigSession(tidalPlanetManifest)
    session.captureSnapshot('Baseline')
    session.setPlayhead(2.4)
    session.setCompare('original')
    expect(session.liveNumber('rotationY')).toBeCloseTo(108, 5)
    expect(session.previewNumber('rotationY')).toBe(108)
    expect(session.previewValues().rotationY).toBe(108)
    session.setCompare('current')
    expect(session.previewNumber('rotationY')).toBeCloseTo(108, 5)
  })
})

describe('timeline interpolation', () => {
  const track = {
    paramId: 'rotationY',
    interpolation: 'linear' as const,
    keyframes: [
      { time: 0, value: 0 },
      { time: 4, value: 180 },
      { time: 8, value: 360 },
    ],
  }

  it('lerps between keyframes and loops', () => {
    expect(interpolateNumber(track, 2, 8, true)).toBe(90)
    expect(interpolateNumber(track, 8, 8, true)).toBe(0)
    expect(interpolateNumber({ ...track, interpolation: 'step' }, 2, 8, false)).toBe(0)
  })

  it('updates a nearby keyframe instead of stacking duplicates', () => {
    const next = upsertKeyframe(track, 4.02, 200, 0.05)
    expect(next.keyframes).toHaveLength(3)
    expect(next.keyframes[1]?.value).toBe(200)
  })
})
