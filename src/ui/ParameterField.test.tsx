import { useSyncExternalStore } from 'react'
import { fireEvent, render, screen, act, cleanup } from '@testing-library/react'
import { afterEach,describe,expect,it } from 'vitest'
import { ParameterField } from './ParameterField'
import { RigSession } from '@/state/session'
import { controllerDefinitions,controllerManifest } from '@/rigs/controller-catalog'

function Field({session,id}:{session:RigSession;id:string}) {
  useSyncExternalStore(session.subscribe,()=>session.getRevision())
  const param=controllerDefinitions.find(p=>p.id===id)!
  return <ParameterField param={param} value={session.storedValue(id)!} onChange={v=>session.setValue(id,v)} parameters={controllerDefinitions} animated={target=>Boolean(session.trackFor(target))} onGestureStart={()=>session.beginGesture()} onGestureEnd={()=>session.endGesture()} onGestureCancel={()=>session.cancelGesture()}/>
}
afterEach(cleanup)
describe('shared parameter instruments',()=>{
  it('renders every declared instrument without a missing renderer',()=>{
    const session=new RigSession(controllerManifest)
    for(const param of controllerDefinitions){const view=render(<Field session={session} id={param.id}/>);expect(view.container.textContent?.trim().length,param.id).toBeGreaterThan(0);view.unmount()}
  })
  it('keeps range handles ordered and restores a keyboard edit with undo',()=>{
    const s=new RigSession(controllerManifest);render(<Field session={s} id="range"/> )
    fireEvent.keyDown(screen.getByRole('slider',{name:'Minimum / maximum minimum'}),{key:'End'})
    expect(s.storedValue('range')).toEqual([80,80]);act(()=>s.undo());expect(s.storedValue('range')).toEqual([20,80])
  })
  it('moves XY with the keyboard and commits both coordinates together',()=>{
    const s=new RigSession(controllerManifest);render(<Field session={s} id="position"/> )
    fireEvent.keyDown(screen.getByRole('button',{name:'XY pad position'}),{key:'ArrowRight'})
    expect(s.storedValue('position')).toEqual([0.01,0]);act(()=>s.undo());expect(s.storedValue('position')).toEqual([0,0])
    fireEvent.keyDown(screen.getByRole('button',{name:'XY pad position'}),{key:'ArrowRight'})
    fireEvent.keyDown(screen.getByRole('button',{name:'XY pad position'}),{key:'Home'})
    expect(s.storedValue('position')).toEqual([0,0])
  })
  it('opens and closes one history transaction when dragging the XY handle',()=>{
    const s=new RigSession(controllerManifest);render(<Field session={s} id="position"/> )
    const pad=screen.getByRole('group',{name:'XY pad pad'})
    pad.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100,right:100,bottom:100,x:0,y:0,toJSON:()=>({})})
    fireEvent.pointerDown(screen.getByRole('button',{name:'XY pad position'}),{button:0,pointerId:1,clientX:60,clientY:40})
    expect(s.isGesturing()).toBe(true)
    expect(s.storedValue('position')).toEqual([0,0])
    fireEvent.pointerUp(pad,{pointerId:1})
    expect(s.isGesturing()).toBe(false)
    fireEvent.pointerDown(pad,{button:0,pointerId:1,clientX:60,clientY:40})
    fireEvent.pointerUp(pad,{pointerId:1})
    expect(s.storedValue('position')).toEqual([0.2,0.2])
  })
  it('keeps text drafts out of history until committed and discards Escape',()=>{
    const s=new RigSession(controllerManifest);render(<Field session={s} id="title"/> )
    const input=screen.getByRole('textbox',{name:'Text'})
    fireEvent.change(input,{target:{value:'Draft'}});expect(s.canUndo()).toBe(false)
    fireEvent.keyDown(input,{key:'Escape'});fireEvent.blur(input);expect(s.storedValue('title')).toBe('Make it move.')
    fireEvent.change(input,{target:{value:'Saved'}});fireEvent.blur(input);expect(s.storedValue('title')).toBe('Saved')
    act(()=>s.undo());expect(input).toHaveValue('Make it move.')
  })
  it('adds and reorders list entries with undo',()=>{
    const s=new RigSession(controllerManifest);render(<Field session={s} id="values"/> )
    expect(screen.getByRole('button',{name:'Value 1'})).toHaveAttribute('aria-expanded','true')
    expect(screen.getByRole('button',{name:'Move item 1 up'}).closest('.controller-list-item__tools')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Move item 2 up'}));expect(s.storedValue('values')).toEqual([50,25,75])
    fireEvent.click(screen.getByRole('button',{name:'Add value'}));expect(s.storedValue('values')).toEqual([50,25,75,50])
    act(()=>s.undo());expect(s.storedValue('values')).toEqual([50,25,75])
  })
  it('advances to the next allowed stop and makes logarithmic keyboard edits meaningful',()=>{
    const s=new RigSession(controllerManifest)
    const view=render(<Field session={s} id="steps"/>)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow','4')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax','16')
    fireEvent.keyDown(screen.getByRole('slider'),{key:'ArrowRight'});expect(s.storedValue('steps')).toBe(8)
    fireEvent.keyDown(screen.getByRole('slider'),{key:'ArrowLeft'});expect(s.storedValue('steps')).toBe(4)
    view.rerender(<Field session={s} id="frequency"/>)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow','440')
    fireEvent.keyDown(screen.getByRole('slider'),{key:'ArrowRight'});expect(Number(s.storedValue('frequency'))).toBeGreaterThan(440)
    act(()=>s.undo());expect(s.storedValue('frequency')).toBe(440)
  })
  it('moves focus and selection together in searchable radio choices',()=>{
    const s=new RigSession(controllerManifest);render(<Field session={s} id="search"/>)
    fireEvent.keyDown(screen.getByRole('radio',{name:'Circle'}),{key:'ArrowRight'})
    expect(s.storedValue('search')).toBe('square');expect(screen.getByRole('radio',{name:'Square'})).toHaveFocus()
    act(()=>s.undo());expect(screen.getByRole('radio',{name:'Circle'})).toHaveAttribute('aria-checked','true')
  })
  it('converts display units while preserving the stored base value',()=>{
    const s=new RigSession(controllerManifest);render(<Field session={s} id="exact"/>)
    expect(screen.getByRole('textbox',{name:'Exact value'})).toHaveValue('32.00')
    fireEvent.click(screen.getByRole('button',{name:'Unit: px. Switch unit'}))
    expect(screen.getByRole('textbox',{name:'Exact value'})).toHaveValue('2.00')
    fireEvent.change(screen.getByRole('textbox',{name:'Exact value'}),{target:{value:'3'}})
    fireEvent.blur(screen.getByRole('textbox',{name:'Exact value'}))
    expect(s.storedValue('exact')).toBe(48)
  })
  it('moves a radial profile point with the keyboard and keeps layers overlapping',()=>{
    const s=new RigSession(controllerManifest);render(<Field session={s} id="radial"/>)
    expect(screen.getByRole('tab',{name:'All'})).toHaveAttribute('aria-selected','true')
    const handle=screen.getByRole('button',{name:'Shell point 1'})
    fireEvent.keyDown(handle,{key:'ArrowRight'})
    const layers=s.storedValue('radial') as {name:string;points:{x:number;y:number}[]}[]
    expect(layers).toHaveLength(3)
    expect(layers[0]!.points[0]!.x).toBeCloseTo(0.09)
    act(()=>s.undo());expect((s.storedValue('radial') as {points:{x:number}[]}[])[0]!.points[0]!.x).toBe(0.08)
  })
})
