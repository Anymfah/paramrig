import { useSyncExternalStore } from 'react'
import { act,cleanup,fireEvent,render,screen } from '@testing-library/react'
import { afterEach,describe,expect,it } from 'vitest'
import { controllerManifest } from '@/rigs/controller-catalog'
import { RigSession } from '@/state/session'
import { TimelineGraph } from './TimelineGraph'

function Graph({session}:{session:RigSession}) {
  useSyncExternalStore(session.subscribe,()=>session.getRevision())
  return <TimelineGraph session={session} track={session.trackFor('angle')!}/>
}
afterEach(cleanup)
describe('timeline curve editor',()=>{
  it('edits real keyframes and restores the curve through undo',()=>{
    const session=new RigSession(controllerManifest)
    render(<Graph session={session}/>)
    fireEvent.keyDown(screen.getByRole('button',{name:'Circular angle animation curve point 2'}),{key:'ArrowDown'})
    expect(session.trackFor('angle')!.keyframes[1]!.value).toBeCloseTo(356.4)
    act(()=>session.undo());expect(session.trackFor('angle')!.keyframes[1]!.value).toBe(360)
    fireEvent.click(screen.getByRole('button',{name:'Add point'}))
    expect(session.trackFor('angle')!.keyframes.map(k=>k.time)).toEqual([0,4,8])
    fireEvent.click(screen.getByRole('button',{name:'Remove point'}))
    expect(session.trackFor('angle')!.keyframes).toHaveLength(2)
    act(()=>session.undo());expect(session.trackFor('angle')!.keyframes).toHaveLength(3)
  })
})
