import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { ExtendedParameter } from '@/rigs/extended-types'
import { NumberField } from './NumberField'
import { IconButton } from './Button'
import { Tooltip } from './Tooltip'
import { IconLink } from './icons'
import { useControllerGesture, type GestureProps } from './controller-gesture'
import { snapToStep } from './numeric'

type VectorDef=Extract<ExtendedParameter,{kind:'vector'}>
const ANCHORS=['Top left','Top','Top right','Left','Center','Right','Bottom left','Bottom','Bottom right']

export function SpatialController({param,value,onChange,...gesture}: GestureProps & {param:VectorDef;value:number[];onChange:(value:number[])=>void}) {
  const [linked,setLinked]=useState(param.proportional ?? false)
  const labelId=useId()
  const drag=useControllerGesture(gesture)
  const pointRef=useRef<HTMLButtonElement>(null)
  const fine=useRef({x:0,y:0,value:[0,0]})
  const span=param.max-param.min||1
  const bound=(n:number)=>Math.max(param.min,Math.min(param.max,snapToStep(n,param.min,param.step)))
  const change=(i:number,n:number)=>onChange(value.map((v,j)=>i===j?bound(n):linked?bound(value[i] ? v*n/value[i]! : n):v))
  const fromPointer=(e:PointerEvent<HTMLElement>)=>{
    const rect=e.currentTarget.getBoundingClientRect()
    if(e.shiftKey){
      const scale=0.12
      const next=[bound(fine.current.value[0]!+(e.clientX-fine.current.x)/rect.width*span*scale),bound(fine.current.value[1]!-(e.clientY-fine.current.y)/rect.height*span*scale)]
      onChange(value.map((v,i)=>next[i]??v))
      return
    }
    fine.current={x:e.clientX,y:e.clientY,value:[value[0]??0,value[1]??0]}
    const point=[bound(param.min+(e.clientX-rect.left)/rect.width*span),bound(param.max-(e.clientY-rect.top)/rect.height*span)]
    onChange(value.map((v,i)=>point[i]??v))
  }
  const graphical=['xy','direction','anchor'].includes(param.view??'')
  const originX=`${Math.min(100,Math.max(0,(0-param.min)/span*100))}%`
  const originY=`${Math.min(100,Math.max(0,(param.max-0)/span*100))}%`
  const columns=param.axes.length===3?3:2
  const longLabels=param.axes.some(axis=>axis.length>2)
  const linkLabel=param.linkLabel??'Lock proportions'
  const anchorAt=(i:number)=>[param.min+(i%3)/2*span,param.max-Math.floor(i/3)/2*span] as const
  const near=(a:number,b:number)=>Math.abs(a-b)<=param.step/2
  return <div className="controller-stack" role="group" aria-labelledby={labelId}>
    <div className="control__head"><span className="control__label" id={labelId}>{param.label}</span>
      {param.view==='dimensions'?<div className="control__tools"><Tooltip content={`${linkLabel}: ${linked?'on':'off'}`}><IconButton label={linkLabel} aria-pressed={linked} onClick={()=>setLinked(v=>!v)}><IconLink/></IconButton></Tooltip></div>:null}
    </div>
    {graphical?<Tooltip content="Drag on the pad · Shift for precision · Double-click to reset" block><div className="controller-pad" data-view={param.view} role="group" aria-label={`${param.label} pad`} tabIndex={-1} style={{'--pad-origin-x':originX,'--pad-origin-y':originY} as CSSProperties}
      onPointerDown={e=>{if(!drag.start(e))return;fine.current={x:e.clientX,y:e.clientY,value:[value[0]??0,value[1]??0]};pointRef.current?.focus({preventScroll:true});if(e.target!==pointRef.current)fromPointer(e)}}
      onPointerMove={e=>{if(drag.active.current)fromPointer(e)}}
      onDoubleClick={()=>onChange(param.defaultValue.map(bound))}
      {...drag.handlers}>
      <div className="controller-pad__axes" aria-hidden="true"/>
      <button type="button" ref={pointRef} className="controller-point" aria-label={`${param.label} position`} aria-valuemin={param.min} aria-valuemax={param.max} aria-valuetext={`${value[0]}, ${value[1]}`} aria-description="Drag anywhere on the pad or use the arrow keys. Double-click the pad to reset. Exact values are available below." style={{left:`${(value[0]!-param.min)/span*100}%`,top:`${(param.max-value[1]!)/span*100}%`}} onKeyDown={e=>{
        if(e.key==='Home'){e.preventDefault();onChange(param.defaultValue.map(bound));return}
        const axis=e.key==='ArrowLeft'||e.key==='ArrowRight'?0:1;if(e.key.startsWith('Arrow')){e.preventDefault();change(axis,value[axis]!+(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1)*param.step)}
      }}/>
    </div></Tooltip>:null}
    <div className="controller-components" data-long={longLabels||undefined} style={{'--component-count':columns} as CSSProperties}>
      {param.axes.map((axis,i)=><NumberField key={axis} label={axis} variant="field" value={value[i]??0} min={param.min} max={param.max} step={param.step} unit={param.unit} defaultValue={param.defaultValue[i]} onChange={n=>change(i,n)} {...gesture}/>)}
    </div>
    {param.view==='anchor'?<div className="anchor-presets" role="group" aria-label={`${param.label} presets`}>{ANCHORS.map((label,i)=>{const [x,y]=anchorAt(i);const active=near(value[0]??0,x)&&near(value[1]??0,y);return <button type="button" key={label} aria-label={label} aria-pressed={active} data-center={i===4||undefined} onClick={()=>onChange([x,y])}/>})}</div>:null}
  </div>
}

export function RangeController({param,value,onChange,...gesture}:GestureProps & {param:Extract<ExtendedParameter,{kind:'range'}>;value:number[];onChange:(value:number[])=>void}) {
  const drag=useControllerGesture(gesture)
  const track=useRef<HTMLDivElement>(null)
  const handles=useRef<(HTMLButtonElement|null)[]>([])
  const active=useRef<number|'band'|null>(null)
  const band=useRef({x:0,lo:0,hi:0})
  const span=param.max-param.min||1
  const update=(i:number,n:number)=>onChange(i===0?[Math.min(n,value[1]!),value[1]!]:[value[0]!,Math.max(n,value[0]!)])
  const clampValue=(n:number)=>Math.max(param.min,Math.min(param.max,snapToStep(n,param.min,param.step)))
  const shift=(lo:number,hi:number,by:number)=>{const width=hi-lo;const start=Math.max(param.min,Math.min(param.max-width,snapToStep(lo+by,param.min,param.step)));onChange([start,start+width])}
  const valueAt=(clientX:number)=>{const rect=track.current!.getBoundingClientRect();return clampValue(param.min+(clientX-rect.left)/rect.width*span)}
  return <fieldset className="controller-stack controller-fieldset"><legend>{param.label}</legend>
    <div className="range-controller" ref={track}
      onPointerDown={e=>{
        const handle=(e.target as HTMLElement).closest<HTMLButtonElement>('.controller-point')
        const onBand=(e.target as HTMLElement).closest('.range-controller__fill')
        const next=valueAt(e.clientX)
        if(!drag.start(e))return
        if(onBand&&!handle){
          // Drag the band itself: the whole window slides, its width kept.
          active.current='band';band.current={x:e.clientX,lo:value[0]!,hi:value[1]!}
          handles.current[0]?.focus({preventScroll:true})
          return
        }
        // Press anywhere else on the track: the nearest handle comes to the pointer.
        const index=handle?Number(handle.dataset.index):Math.abs(next-value[0]!)<=Math.abs(next-value[1]!)?0:1
        active.current=index
        handles.current[index]?.focus({preventScroll:true})
        if(!handle)update(index,next)
      }}
      onPointerMove={e=>{
        if(!drag.active.current||active.current===null)return
        if(active.current==='band'){const rect=track.current!.getBoundingClientRect();shift(band.current.lo,band.current.hi,(e.clientX-band.current.x)/rect.width*span);return}
        update(active.current,valueAt(e.clientX))
      }}
      {...drag.handlers}>
      <Tooltip content="Drag the band to slide the window · Shift+arrows on a handle does the same" block><span className="range-controller__fill" style={{left:`${(value[0]!-param.min)/span*100}%`,right:`${(param.max-value[1]!)/span*100}%`}}/></Tooltip>
      {['Minimum','Maximum'].map((label,i)=><button key={label} ref={el=>{handles.current[i]=el}} data-index={i} type="button" role="slider" className="controller-point" aria-label={`${param.label} ${label.toLowerCase()}`} aria-description="Drag the handle, press the track, or use the arrow keys. Exact values are available below." aria-valuemin={i===0?param.min:value[0]} aria-valuemax={i===0?value[1]:param.max} aria-valuenow={value[i]} style={{left:`${(value[i]!-param.min)/span*100}%`}}
        onKeyDown={e=>{
          if(!['Home','End','ArrowLeft','ArrowDown','ArrowRight','ArrowUp'].includes(e.key))return
          e.preventDefault()
          const direction=['ArrowLeft','ArrowDown'].includes(e.key)?-1:1
          if(e.shiftKey&&e.key.startsWith('Arrow')){shift(value[0]!,value[1]!,direction*param.step);return}
          update(i,e.key==='Home'?param.min:e.key==='End'?param.max:clampValue(value[i]!+direction*param.step))
        }}/>)}</div>
    <div className="controller-components">{['Minimum','Maximum'].map((label,i)=><NumberField key={label} label={label} variant="field" value={value[i]!} min={i===0?param.min:value[0]!} max={i===0?value[1]!:param.max} step={param.step} unit={param.unit} defaultValue={param.defaultValue[i]} onChange={n=>update(i,n)} {...gesture}/>)}</div>
  </fieldset>
}
