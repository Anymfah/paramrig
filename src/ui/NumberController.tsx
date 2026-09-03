import { useRef, useState, type CSSProperties } from 'react'
import type { NumberParam } from '@/rigs/types'
import { NumberField } from './NumberField'
import { usesStepper, snapToStep, type UnitOption } from './numeric'
import { useControllerGesture, type GestureProps } from './controller-gesture'
import { IconButton } from './Button'
import { Tooltip } from './Tooltip'
import { IconDice } from './icons'

export type NumberControllerProps = GestureProps & {param:NumberParam;value:number;onChange:(value:number)=>void;driven?:string;mixed?:boolean}

export function NumberController({param,value,onChange,driven,mixed,...gesture}: NumberControllerProps) {
  const units=param.units?.filter(unit=>Number.isFinite(unit.factor)&&unit.factor>0)
  const [unitValue,setUnitValue]=useState(units?.[0]?.value??param.unit??'')
  const selected=units?.find(unit=>unit.value===unitValue)??units?.[0]
  if(!selected)return <BaseNumberController param={param} value={value} onChange={onChange} driven={driven} mixed={mixed} {...gesture}/>
  const factor=selected.factor
  const displayParam={...param,min:param.min/factor,max:param.max/factor,step:selected.step??param.step/factor,unit:selected.value,defaultValue:param.defaultValue/factor}
  return <BaseNumberController param={displayParam} value={value/factor} onChange={next=>onChange(next*factor)} units={units!.map(unit=>({value:unit.value,label:unit.label,factor:unit.factor}))} onUnitChange={setUnitValue} driven={driven} mixed={mixed} {...gesture}/>
}

function BaseNumberController({param,value,onChange,units,onUnitChange,driven,mixed,...gesture}: NumberControllerProps & {units?:UnitOption[];onUnitChange?:(unit:string)=>void}) {
  const drag=useControllerGesture(gesture)
  const origin=useRef({x:0,y:0,angle:0,value:0})
  const p={label:param.label,value,min:param.min,max:param.max,step:param.step,unit:param.unit,units,onUnitChange,onChange,defaultValue:param.defaultValue,driven,mixed,...gesture}
  const lo=param.sliderMin ?? param.min, hi=param.sliderMax ?? param.max
  const log=param.scale==='log' && lo>0 && hi>lo
  const fraction=log ? Math.log(Math.max(lo,value)/lo)/Math.log(hi/lo) : (value-lo)/(hi-lo||1)
  // A measured value reads as a filled field: one row instead of two. Only a discrete count keeps its stepper — a scale with stops or decades is not a count.
  const view=param.view ?? (usesStepper(param)&&!log&&!param.stops?.length?'stepper':'bar')
  const valueAt=(u:number)=>{
    let next=log ? lo*Math.pow(hi/lo,u) : lo+(hi-lo)*u
    if(param.stops?.length) next=param.stops.reduce((best,v)=>Math.abs(v-next)<Math.abs(best-next)?v:best,param.stops[0]!)
    else next=snapToStep(next,param.min,param.step)
    return Math.max(param.min,Math.min(param.max,next))
  }
  const convert=(u:number)=>onChange(valueAt(u))
  const stopFraction=(stop:number)=>Math.max(0,Math.min(1,log?Math.log(Math.max(lo,stop)/lo)/Math.log(hi/lo):(stop-lo)/(hi-lo||1)))
  // A log track shows its decades, so the eye knows why the middle is not the average.
  const decades:number[]=[]
  if(log)for(let d=Math.pow(10,Math.ceil(Math.log10(lo)));d<=hi;d*=10)if(d>lo)decades.push(d)
  const ticks=param.stops?.length?param.stops:decades
  // Where a scale decides the next value, the arrows follow the scale: the next stop, or a percent of the track.
  const stepScale=(direction:1|-1)=>{
    if(!param.stops?.length){convert(Math.max(0,Math.min(1,fraction+direction*0.01)));return}
    const sorted=[...param.stops].sort((a,b)=>a-b)
    const next=direction>0?sorted.find(v=>v>value):[...sorted].reverse().find(v=>v<value)
    onChange(next??(direction>0?sorted[sorted.length-1]!:sorted[0]!))
  }
  if(param.readOnly)return <div className="control control--field"><div className="number-value number-value--readonly"><span className="number-value__label">{param.label}</span><output className="number-value__readout">{value.toFixed(2)}</output>{param.unit?<span className="number-value__unit">{param.unit}</span>:null}</div></div>
  if(view==='seed') return <NumberField {...p} variant="stepper" trailing={<Tooltip content="New seed"><IconButton label="New seed" onClick={()=>onChange(param.min+Math.floor(Math.random()*(Math.floor((param.max-param.min)/param.step)+1))*param.step)}><IconDice/></IconButton></Tooltip>}/>
  if(view==='knob'||view==='angle') return <div className="controller-stack">
    <NumberField {...p} variant="field"/>
    <div className="dial-row"><Tooltip content={driven??(view==='angle'?'Drag around the dial · Shift for precision · Double-click to reset':'Drag up or down · Shift for precision · Double-click to reset')}><div className="controller-dial" role="slider" tabIndex={0} aria-label={`${param.label} dial`} aria-valuemin={param.min} aria-valuemax={param.max} aria-valuenow={value} aria-valuetext={`${value}${param.unit??''}`} aria-disabled={driven?true:undefined}
      style={{'--dial-angle':`${view==='angle'?fraction*360:fraction*270-135}deg`,'--dial-fraction':String(Math.min(1,Math.max(0,fraction))),'--dial-start':view==='angle'?'0deg':'-135deg','--dial-sweep':view==='angle'?'360deg':'270deg'} as CSSProperties}
      data-kind={view} data-driven={driven?'':undefined}
      onPointerDown={e=>{if(driven||!drag.start(e))return;const rect=e.currentTarget.getBoundingClientRect();origin.current={x:e.clientY,y:rect.top+rect.height/2,angle:Math.atan2(e.clientX-(rect.left+rect.width/2),-(e.clientY-(rect.top+rect.height/2))),value:fraction}}}
      onPointerMove={e=>{
        if(!drag.active.current)return
        if(view==='angle'){
          // The hand follows the pointer around the face; the value moves by the angle turned since the press.
          const rect=e.currentTarget.getBoundingClientRect()
          const angle=Math.atan2(e.clientX-(rect.left+rect.width/2),-(e.clientY-(rect.top+rect.height/2)))
          let delta=angle-origin.current.angle
          if(delta>Math.PI)delta-=2*Math.PI;if(delta<-Math.PI)delta+=2*Math.PI
          const turned=delta/(2*Math.PI)/(e.shiftKey?8:1)
          origin.current={...origin.current,angle:e.shiftKey?origin.current.angle+delta*(1-1/8):origin.current.angle}
          const next=origin.current.value+turned
          origin.current.value=e.shiftKey?next:origin.current.value
          convert(((e.shiftKey?next:origin.current.value+delta/(2*Math.PI))%1+1)%1)
          return
        }
        convert(Math.max(0,Math.min(1,origin.current.value+(origin.current.x-e.clientY)/(e.shiftKey?1200:240))))
      }}
      onDoubleClick={()=>{if(!driven)onChange(param.defaultValue)}}
      {...drag.handlers} onKeyDown={e=>{if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End'].includes(e.key)){e.preventDefault(); if(e.key==='Home')onChange(param.min);else if(e.key==='End')onChange(param.max);else onChange(Math.max(param.min,Math.min(param.max,value+(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1)*param.step)))}}}>
      <span className="controller-dial__ticks" aria-hidden/><span className="controller-dial__arc" aria-hidden/><span className="controller-dial__hand"/><span className="controller-dial__center"/></div></Tooltip></div>
  </div>
  if(view==='field'||view==='stepper') return <NumberField {...p} variant={view}/>
  return <NumberField {...p} variant="bar" fill={fraction} fromFraction={valueAt} origin={lo<0&&hi>0?-lo/(hi-lo):null} ticks={ticks.length?ticks.map(stopFraction):undefined} onNudge={log||param.stops?.length?stepScale:undefined}/>
}
