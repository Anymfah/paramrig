import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { ExtendedParameter } from '@/rigs/extended-types'
import { NumberField } from './NumberField'
import { SwitchField } from './SwitchField'
import { useControllerGesture, type GestureProps } from './controller-gesture'
import { snapToStep } from './numeric'

type VectorDef=Extract<ExtendedParameter,{kind:'vector'}>
export function SpatialController({param,value,onChange,...gesture}: GestureProps & {param:VectorDef;value:number[];onChange:(value:number[])=>void}) {
  const [linked,setLinked]=useState(param.proportional ?? false)
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
  return <fieldset className="controller-stack controller-fieldset"><legend>{param.label}</legend>
    {graphical?<><div className="controller-pad" data-view={param.view} role="group" aria-label={`${param.label} pad`} tabIndex={-1} style={{'--pad-origin-x':originX,'--pad-origin-y':originY} as CSSProperties}
      onPointerDown={e=>{if(!drag.start(e))return;fine.current={x:e.clientX,y:e.clientY,value:[value[0]??0,value[1]??0]};pointRef.current?.focus({preventScroll:true});if(e.target!==pointRef.current)fromPointer(e)}}
      onPointerMove={e=>{if(drag.active.current)fromPointer(e)}}
      onDoubleClick={()=>onChange(param.defaultValue.map(bound))}
      {...drag.handlers}>
      <div className="controller-pad__axes" aria-hidden="true"/>
      <button type="button" ref={pointRef} className="controller-point" aria-label={`${param.label} position`} aria-valuemin={param.min} aria-valuemax={param.max} aria-valuetext={`${value[0]}, ${value[1]}`} aria-description="Drag anywhere on the pad or use the arrow keys. Double-click the pad to reset. Exact values are available below." style={{left:`${(value[0]!-param.min)/span*100}%`,top:`${(param.max-value[1]!)/span*100}%`}} onKeyDown={e=>{
        if(e.key==='Home'){e.preventDefault();onChange(param.defaultValue.map(bound));return}
        const axis=e.key==='ArrowLeft'||e.key==='ArrowRight'?0:1;if(e.key.startsWith('Arrow')){e.preventDefault();change(axis,value[axis]!+(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1)*param.step)}
      }}/>
    </div>
    <p className="field__hint">Drag on the pad.<br/>Shift for precision. Double-click to reset.</p></>:null}
    <div className="controller-components" style={{'--component-count':param.axes.length===3?3:2} as CSSProperties}>{param.axes.map((axis,i)=><NumberField key={axis} label={axis} variant="field" value={value[i]??0} min={param.min} max={param.max} step={param.step} unit={param.unit} onChange={n=>change(i,n)} {...gesture}/>)}</div>
    {param.view==='dimensions'?<SwitchField label={param.linkLabel??'Lock proportions'} checked={linked} onChange={setLinked}/>:null}
    {param.view==='anchor'?<div className="anchor-presets" role="group" aria-label={`${param.label} presets`}>{['Top left','Top','Top right','Left','Center','Right','Bottom left','Bottom','Bottom right'].map((label,i)=><button type="button" key={label} aria-label={label} onClick={()=>onChange([param.min+(i%3)/2*(param.max-param.min),param.max-Math.floor(i/3)/2*(param.max-param.min)])}>{i===4?'●':'·'}</button>)}</div>:null}
  </fieldset>
}

export function RangeController({param,value,onChange,...gesture}:GestureProps & {param:Extract<ExtendedParameter,{kind:'range'}>;value:number[];onChange:(value:number[])=>void}) {
  const drag=useControllerGesture(gesture)
  const update=(i:number,n:number)=>onChange(i===0?[Math.min(n,value[1]!),value[1]!]:[value[0]!,Math.max(n,value[0]!)])
  const fromPointer=(e:PointerEvent<HTMLElement>,i:number)=>{const rect=e.currentTarget.parentElement!.getBoundingClientRect();update(i,Math.max(param.min,Math.min(param.max,snapToStep(param.min+(e.clientX-rect.left)/rect.width*(param.max-param.min),param.min,param.step))))}
  return <fieldset className="controller-stack controller-fieldset"><legend>{param.label}</legend>
    <div className="range-controller"><span className="range-controller__fill" style={{left:`${(value[0]!-param.min)/(param.max-param.min)*100}%`,right:`${(param.max-value[1]!)/(param.max-param.min)*100}%`}}/>
      {['Minimum','Maximum'].map((label,i)=><button key={label} type="button" role="slider" className="controller-point" aria-label={`${param.label} ${label.toLowerCase()}`} aria-description="Drag the handle or use the arrow keys. Exact values are available below." aria-valuemin={i===0?param.min:value[0]} aria-valuemax={i===0?value[1]:param.max} aria-valuenow={value[i]} style={{left:`${(value[i]!-param.min)/(param.max-param.min)*100}%`}}
        onPointerDown={e=>{drag.start(e)}} onPointerMove={e=>{if(drag.active.current)fromPointer(e,i)}} {...drag.handlers}
        onKeyDown={e=>{if(['Home','End','ArrowLeft','ArrowDown','ArrowRight','ArrowUp'].includes(e.key)){e.preventDefault();update(i,e.key==='Home'?param.min:e.key==='End'?param.max:Math.max(param.min,Math.min(param.max,value[i]!+(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1)*param.step)))}}}/>)}</div>
    <div className="controller-components">{['Minimum','Maximum'].map((label,i)=><NumberField key={label} label={label} variant="field" value={value[i]!} min={i===0?param.min:value[0]!} max={i===0?value[1]!:param.max} step={param.step} unit={param.unit} onChange={n=>update(i,n)} {...gesture}/>)}</div>
  </fieldset>
}
