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
  const span=param.max-param.min||1
  const at=(n:number)=>Math.max(0,Math.min(1,(n-param.min)/span))
  const update=(i:number,n:number)=>onChange(i===0?[Math.min(n,value[1]!),value[1]!]:[value[0]!,Math.max(n,value[0]!)])
  const bound=(fraction:number)=>Math.max(param.min,Math.min(param.max,snapToStep(param.min+span*fraction,param.min,param.step)))
  // Two gauges anchored to each other: each row carries its own number, and both paint the same window.
  return <fieldset className="controller-stack controller-fieldset"><legend>{param.label}</legend>
    {['Minimum','Maximum'].map((label,i)=><NumberField key={label} label={label} variant="bar" value={value[i]!} min={i===0?param.min:value[0]!} max={i===0?value[1]!:param.max} step={param.step} unit={param.unit}
      fill={at(value[i]!)} origin={at(value[i===0?1:0]!)} fromFraction={bound} defaultValue={param.defaultValue[i]} onChange={n=>update(i,n)} {...gesture}/>)}
  </fieldset>
}
