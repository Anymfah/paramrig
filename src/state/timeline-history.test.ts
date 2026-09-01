import { describe, expect, it } from 'vitest'
import { RigSession } from '@/state/session'
import { tidalPlanetManifest } from '@/rigs/examples/tidal-planet'
import { contourBloomManifest } from '@/rigs/examples/contour-bloom'
import { interpolateNumber } from '@/state/values'

const create = () => new RigSession(tidalPlanetManifest)

describe('timeline editing and history', () => {
  it('samples inserted keys at their requested time and keeps track order and easing', () => {
    const session = create()
    const order = session.getSnapshot().tracks.map(track => track.paramId)
    const ref = session.addKeyframe('rotationY', 4)!
    expect(session.trackFor('rotationY')!.keyframes.find(frame => frame.id === ref.id)!.value).toBeCloseTo(180)
    session.updateKeyframe(ref, { easing: 'ease-out' })
    session.addKeyframe('rotationY', 4)
    expect(session.trackFor('rotationY')!.keyframes.find(frame => frame.id === ref.id)!.easing).toBe('ease-out')
    session.resetParam('rotationY')
    expect(session.getSnapshot().tracks.map(track => track.paramId)).toEqual(order)
  })
  it('can select the final frame with loop enabled without wrapping to zero', () => {
    const session=create()
    session.setPlayhead(8)
    expect(session.playheadTime()).toBe(8)
    expect(session.liveNumber('rotationY')).toBe(360)
    expect(session.toExport().values.rotationY).toBe(360)
    session.setPlayhead(8.1,true)
    expect(session.playheadTime()).toBeCloseTo(0.1)
  })

  it('moves a selection from its original times with a single undo and stable IDs', () => {
    const session=create()
    const track=session.trackFor('rotationY')!
    const ref={paramId:track.paramId,id:track.keyframes[1]!.id!}
    session.beginGesture('Move keyframes')
    session.moveKeyframes([ref],0.4)
    session.moveKeyframes([ref],0.6)
    session.endGesture()
    expect(session.trackFor('rotationY')!.keyframes[1]!.time).toBe(3)
    expect(session.history().labels).toEqual(['Session start','Move keyframes'])
    session.undo()
    expect(session.trackFor('rotationY')!.keyframes[1]).toMatchObject({id:ref.id,time:2.4,value:108})
    session.redo()
    expect(session.trackFor('rotationY')!.keyframes[1]!.time).toBe(3)
  })

  it('cancels a drag, preserving redo and the original keys', () => {
    const session=create()
    session.setValue('seed',12);session.undo()
    const frame=session.trackFor('rotationY')!.keyframes[1]!
    session.beginGesture('Move keyframes')
    session.moveKeyframes([{paramId:'rotationY',id:frame.id!}],1)
    session.cancelGesture()
    expect(session.trackFor('rotationY')!.keyframes[1]!.time).toBe(2.4)
    expect(session.canRedo()).toBe(true)
  })

  it('preserves group spacing at the edge and refuses collisions', () => {
    const session=create()
    const frames=session.trackFor('rotationY')!.keyframes
    session.moveKeyframes([{paramId:'rotationY',id:frames[1]!.id!}],-2.4)
    expect(session.trackFor('rotationY')!.keyframes).toHaveLength(3)
    expect(session.trackFor('rotationY')!.keyframes[1]!.time).toBe(2.4)
    session.moveKeyframes(frames.slice(0,2).map(frame=>({paramId:'rotationY',id:frame.id!})), -1)
    expect(session.trackFor('rotationY')!.keyframes.map(frame=>frame.time)).toEqual([0,2.4,8])
    expect(session.canUndo()).toBe(false)
  })

  it('adds adjacent frame keys without the old broad time tolerance', () => {
    const session=create()
    session.setPlayhead(1/30)
    session.setValue('rotationY',4)
    expect(session.trackFor('rotationY')!.keyframes).toHaveLength(4)
    expect(session.trackFor('rotationY')!.keyframes[0]!.value).toBe(0)
    session.undo()
    expect(session.trackFor('rotationY')!.keyframes).toHaveLength(3)
  })

  it('deleting the last keys keeps the visible value and is reversible', () => {
    const session=create()
    session.setPlayhead(2.4)
    const refs=session.trackFor('rotationY')!.keyframes.map(frame=>({paramId:'rotationY',id:frame.id!}))
    session.deleteKeyframes(refs)
    expect(session.trackFor('rotationY')).toBeUndefined()
    expect(session.liveNumber('rotationY')).toBe(108)
    expect(session.changedSinceBaseline()).toContain('rotationY')
    session.undo()
    expect(session.trackFor('rotationY')!.keyframes).toHaveLength(3)
  })

  it('pastes with relative timing and restores overwritten keys with one undo', () => {
    const session=create()
    const before=session.toExport()
    const frame=session.trackFor('rotationY')!.keyframes[1]!
    session.setPlayhead(8)
    session.pasteKeyframes([{paramId:'rotationY',frame}])
    expect(session.trackFor('rotationY')!.keyframes.at(-1)!.value).toBe(108)
    expect(session.history().index).toBe(1)
    session.undo()
    expect(session.toExport().animation!.tracks).toEqual(before.animation!.tracks)
  })

  it('resets an animated parameter and global interpolation as complete transactions', () => {
    const session=create()
    const original=session.toExport().animation!.tracks
    session.setPlayhead(2.4);session.setValue('rotationY',120)
    session.setValue('interpolation','step')
    session.resetParams(['rotationY','interpolation'])
    expect(session.trackFor('rotationY')!.keyframes[1]!.value).toBe(108)
    expect(session.getSnapshot().tracks.every(track=>track.interpolation==='linear')).toBe(true)
    session.undo()
    expect(session.trackFor('rotationY')!.keyframes[1]!.value).toBe(120)
    expect(session.getSnapshot().tracks.every(track=>track.interpolation==='step')).toBe(true)
    session.resetAll()
    expect(session.toExport().animation!.tracks).toEqual(original)
  })

  it('loops inside the playback range and retains it through reload and undo', () => {
    const session=create()
    session.setLoopRange({start:2,end:4})
    session.setPlayhead(4.25,true)
    expect(session.playheadTime()).toBeCloseTo(2.25)
    expect(new RigSession(tidalPlanetManifest,session.toDraft()).getSnapshot().loopRange).toEqual({start:2,end:4})
    session.undo()
    expect(session.getSnapshot().loopRange).toBeNull()
    session.redo()
    expect(session.toExport().animation!.loopRange).toEqual({start:2,end:4})
  })

  it('nested gestures produce one step and a no-op does not destroy redo', () => {
    const session=create()
    session.beginGesture('Two values');session.beginGesture()
    session.setValue('seed',1);session.endGesture();session.setValue('terrainScale',1);session.endGesture()
    expect(session.history().index).toBe(1)
    session.undo();session.beginGesture();session.endGesture()
    expect(session.canRedo()).toBe(true)
    session.redo();expect(session.storedValue('seed')).toBe(1)
  })

  it('animates numeric controls on rigs that had no predefined tracks', () => {
    const session=new RigSession(contourBloomManifest)
    session.addKeyframe('lobes',0,6);session.addKeyframe('lobes',4,10)
    session.setPlayhead(2)
    expect(session.liveNumber('lobes')).toBe(8)
    expect(session.toExport().animation!.tracks).toHaveLength(1)
  })
})

describe('snapshots and history navigation', () => {
  it('bounds retained history and labels the earliest retained state honestly', () => {
    const session = create()
    for (let i = 1; i <= 105; i++) session.setValue('seed', i)
    expect(session.history().labels).toHaveLength(101)
    expect(session.history().labels[0]).toBe('Earlier state')
    session.goToHistory(0)
    expect(session.storedValue('seed')).toBe(5)
    session.goToHistory(100)
    expect(session.storedValue('seed')).toBe(105)
  })
  it('restoring the active reference can be undone without changing the reference', () => {
    const session=create()
    const a=session.captureSnapshot('Orbit A')
    session.setValue('seed',100)
    session.restoreSnapshot(a.id)
    expect(session.storedValue('seed')).toBe(4817)
    session.undo()
    expect(session.storedValue('seed')).toBe(100)
    expect(session.getSnapshot().activeSnapshotId).toBe(a.id)
  })

  it('undoing a different snapshot restore restores its prior reference too', () => {
    const session=create()
    const a=session.captureSnapshot('A')
    session.setValue('seed',50)
    const b=session.captureSnapshot('B')
    session.restoreSnapshot(a.id);session.undo()
    expect(session.baselineName()).toBe('B')
    expect(session.getSnapshot().activeSnapshotId).toBe(b.id)
    expect(session.storedValue('seed')).toBe(50)
  })

  it('snapshot capture, rename and removal are reversible', () => {
    const session=create()
    const a=session.captureSnapshot('A')
    session.renameSnapshot(a.id,'B');session.removeSnapshot(a.id)
    expect(session.getSnapshot().snapshots).toHaveLength(0)
    session.undo();expect(session.baselineName()).toBe('B')
    session.undo();expect(session.baselineName()).toBe('A')
    session.undo();expect(session.getSnapshot().snapshots).toHaveLength(0)
    session.redo();expect(session.baselineName()).toBe('A')
  })

  it('replays history in both directions and forks after new edits', () => {
    const session=create()
    session.setValue('seed',10);session.setValue('seed',20);session.setValue('seed',30)
    session.goToHistory(1);expect(session.storedValue('seed')).toBe(10)
    session.goToHistory(3);expect(session.storedValue('seed')).toBe(30)
    session.goToHistory(1);session.setValue('seed',40)
    expect(session.canRedo()).toBe(false)
    expect(session.history().index).toBe(2)
  })

  it('compares animated values at the same time, not the first frame', () => {
    const session=create()
    session.captureSnapshot('Orbit')
    session.setPlayhead(2.4);session.setValue('rotationY',150);session.setCompare('original')
    expect(session.previewNumber('rotationY')).toBe(108)
    expect(session.liveNumber('rotationY')).toBe(150)
    expect(session.toExport().values.rotationY).toBe(150)
  })

  it('holds a key value until the next key, including its exact boundary', () => {
    const track={paramId:'x',interpolation:'linear' as const,keyframes:[{time:0,value:0,easing:'step' as const},{time:1,value:10},{time:2,value:20}]}
    expect(interpolateNumber(track,0.9,2,false)).toBe(0)
    expect(interpolateNumber(track,1,2,false)).toBe(10)
    const ease={...track,keyframes:[{time:0,value:0,easing:'ease-in' as const},{time:2,value:20}]}
    expect(interpolateNumber(ease,1,2,false)).toBe(5)
  })
})
