import { useState, type PointerEvent } from 'react'
import type { Point } from '@/rigs/extended-types'
import { NumberField } from './NumberField'
import { Button } from './Button'
import { useControllerGesture, type GestureProps } from './controller-gesture'

export function PointsController({label,value,onChange,min=0,max=1,path=false,displayPoints,...gesture}:GestureProps & {label:string;value:Point[];onChange:(value:Point[])=>void;min?:number;max?:number;path?:boolean;displayPoints?:Point[]}) {
  const [selected,setSelected]=useState(0)
  const index=Math.min(selected,value.length-1)
  const current=value[index]!
  const drag=useControllerGesture(gesture)
  const replace=(next:Point)=>onChange(value.map((p,i)=>i===index?next:p))
  const update=(i:number,e:PointerEvent<HTMLElement>)=>{
    const rect=e.currentTarget.parentElement!.getBoundingClientRect()
    const x=Math.max(path?0:(value[i-1]?.x??0),Math.min(path?1:(value[i+1]?.x??1),(e.clientX-rect.left)/rect.width))
    const y=Math.max(min,Math.min(max,max-(e.clientY-rect.top)/rect.height*(max-min)))
    onChange(value.map((p,j)=>i===j?{x,y}:p))
  }
  const add=()=>{
    if(path){onChange([...value,{x:0.5,y:(min+max)/2}]);setSelected(value.length);return}
    let gap=0,slot=0
    for(let i=0;i<value.length-1;i++){const width=value[i+1]!.x-value[i]!.x;if(width>gap){gap=width;slot=i}}
    if(gap<0.0001)return
    onChange([...value.slice(0,slot+1),{x:(value[slot]!.x+value[slot+1]!.x)/2,y:(value[slot]!.y+value[slot+1]!.y)/2},...value.slice(slot+1)])
    setSelected(slot+1)
  }
  return <fieldset className="controller-stack controller-fieldset"><legend>{label}</legend>
    <div className="points-controller" role="group" aria-label={`${label} graph`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={(displayPoints??value).map(p=>`${p.x*100},${(max-p.y)/(max-min)*100}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/></svg>
      {value.map((p,i)=><button type="button" key={i} className="controller-point" aria-label={`${label} point ${i+1}`} aria-description="Drag to move this point or use the arrow keys. Exact values are available below." aria-pressed={index===i} style={{left:`${p.x*100}%`,top:`${(max-p.y)/(max-min)*100}%`}}
        onClick={()=>setSelected(i)} onPointerDown={e=>{setSelected(i);drag.start(e)}} onPointerMove={e=>{if(drag.active.current)update(i,e)}} {...drag.handlers}
        onKeyDown={e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();setSelected(i);const next={...p};if(e.key==='ArrowLeft')next.x-=0.01;if(e.key==='ArrowRight')next.x+=0.01;if(e.key==='ArrowUp')next.y+=(max-min)/100;if(e.key==='ArrowDown')next.y-=(max-min)/100;next.x=Math.max(path?0:(value[i-1]?.x??0),Math.min(path?1:(value[i+1]?.x??1),next.x));next.y=Math.max(min,Math.min(max,next.y));onChange(value.map((v,j)=>j===i?next:v))}}/>)}</div>
    <div className="controller-components"><NumberField variant="field" label={path?'X':'Position'} value={current.x} min={path?0:(value[index-1]?.x??0)} max={path?1:(value[index+1]?.x??1)} step={0.01} onChange={x=>replace({...current,x})} {...gesture}/><NumberField variant="field" label={path?'Y':'Value'} value={current.y} min={min} max={max} step={(max-min)/100} onChange={y=>replace({...current,y})} {...gesture}/></div>
    <div className="controller-actions"><Button size="sm" variant="quiet" disabled={value.length>=128} onClick={add}>Add point</Button><Button size="sm" variant="quiet" disabled={value.length<=2} onClick={()=>{onChange(value.filter((_,i)=>i!==index));setSelected(Math.max(0,index-1))}}>Remove point</Button></div>
  </fieldset>
}
