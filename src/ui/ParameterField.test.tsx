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
  it('keeps range bounds ordered and paints the window on both gauges',()=>{
    const s=new RigSession(controllerManifest);render(<Field session={s} id="range"/> )
    const minimum=screen.getByRole('spinbutton',{name:'Minimum'}),maximum=screen.getByRole('spinbutton',{name:'Maximum'})
    for(const field of [minimum,maximum]){
      const gauge=field.closest('.number-value') as HTMLElement
      expect(gauge.style.getPropertyValue('--fill-start')).toBe('0.2')
      expect(gauge.style.getPropertyValue('--fill-span')).toBe('0.6000000000000001')
    }
    // The minimum cannot pass the maximum: it stops there instead.
    fireEvent.change(minimum,{target:{value:'95'}});fireEvent.blur(minimum)
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
    const stepped=screen.getByRole('spinbutton',{name:'Stepped scale'})
    expect(stepped).toHaveAttribute('aria-valuenow','4');expect(stepped).toHaveAttribute('aria-valuemax','16')
    // The gauge carries the scale's own marks, so the allowed values stay visible.
    expect(stepped.closest('.number-value')!.querySelectorAll('.number-value__mark')).toHaveLength(5)
    fireEvent.keyDown(stepped,{key:'ArrowUp'});fireEvent.keyUp(stepped,{key:'ArrowUp'});expect(s.storedValue('steps')).toBe(8)
    fireEvent.keyDown(stepped,{key:'ArrowDown'});fireEvent.keyUp(stepped,{key:'ArrowDown'});expect(s.storedValue('steps')).toBe(4)
    view.rerender(<Field session={s} id="frequency"/>)
    const logarithmic=screen.getByRole('spinbutton',{name:'Logarithmic scale'})
    expect(logarithmic).toHaveAttribute('aria-valuenow','440')
    expect(logarithmic.closest('.number-value')!.querySelectorAll('.number-value__mark')).toHaveLength(3)
    fireEvent.keyDown(logarithmic,{key:'ArrowUp'});fireEvent.keyUp(logarithmic,{key:'ArrowUp'});expect(Number(s.storedValue('frequency'))).toBeGreaterThan(440)
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
  it('makes a measured field its own track, range and level included',()=>{
    const s=new RigSession(controllerManifest);render(<Field session={s} id="amount"/>)
    const field=screen.getByRole('spinbutton',{name:'Number bar'})
    expect(field).toHaveAttribute('aria-valuenow','50');expect(field).toHaveAttribute('aria-valuemax','100')
    expect(field.closest('.number-value')).toHaveAttribute('data-bar')
    expect((field.closest('.number-value') as HTMLElement).style.getPropertyValue('--p')).toBe('0.5')
    expect(screen.queryByRole('slider')).toBeNull()
    fireEvent.keyDown(field,{key:'ArrowUp'});fireEvent.keyUp(field,{key:'ArrowUp'})
    expect(s.storedValue('amount')).toBe(50.01)
    expect((field.closest('.number-value') as HTMLElement).style.getPropertyValue('--p')).toBe('0.5001')
    act(()=>s.undo());expect(s.storedValue('amount')).toBe(50)
  })
  it('moves a gauge at the pointer\'s pace, not the scrub\'s',()=>{
    const s=new RigSession(controllerManifest);render(<Field session={s} id="amount"/>)
    const gauge=screen.getByRole('spinbutton',{name:'Number bar'}).closest('.number-value') as HTMLElement
    gauge.getBoundingClientRect=()=>({width:200,height:32,x:0,y:0,top:0,left:0,right:200,bottom:32,toJSON:()=>({})}) as DOMRect
    fireEvent.pointerDown(gauge,{button:0,pointerId:3,clientX:100})
    fireEvent.pointerMove(gauge,{buttons:1,pointerId:3,clientX:150})
    fireEvent.pointerUp(gauge,{pointerId:3,clientX:150})
    expect(s.storedValue('amount')).toBe(75)
    expect(gauge.style.getPropertyValue('--p')).toBe('0.75')
    expect(s.history().labels).toEqual(['Session start','Adjust parameters'])
    act(()=>s.undo());expect(s.storedValue('amount')).toBe(50)
  })
  it('gives an undeclared numeric view the bar rather than a second row',()=>{
    render(<ParameterField param={{kind:'number',id:'softness',label:'Softness',group:'light',min:0,max:1,step:0.01,defaultValue:0.5}} value={0.25} onChange={()=>undefined}/>)
    const field=screen.getByRole('spinbutton',{name:'Softness'})
    expect((field.closest('.number-value') as HTMLElement).style.getPropertyValue('--p')).toBe('0.25')
    expect(screen.queryByRole('slider')).toBeNull()
  })
  it('grows a bipolar rig gauge out of its zero',()=>{
    render(<ParameterField param={{kind:'number',id:'shift',label:'Shift',group:'form',min:-100,max:100,step:1,unit:'%',defaultValue:0}} value={-40} onChange={()=>undefined}/>)
    const gauge=screen.getByRole('spinbutton',{name:'Shift'}).closest('.number-value') as HTMLElement
    expect(gauge).toHaveAttribute('data-bipolar')
    expect(gauge.style.getPropertyValue('--fill-start')).toBe('0.3')
    expect(gauge.style.getPropertyValue('--fill-span')).toBe('0.2')
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
