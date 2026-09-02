import { useRef, useState, type CSSProperties } from 'react'
import type { NumberParam } from '@/rigs/types'
import { NumberField } from './NumberField'
import { SliderField } from './SliderField'
import { usesStepper, snapToStep } from './numeric'
import { useControllerGesture, type GestureProps } from './controller-gesture'
import { Button } from './Button'
import { SelectField } from './SelectField'

export function NumberController({param,value,onChange,...gesture}: GestureProps & {param:NumberParam;value:number;onChange:(value:number)=>void}) {
  const units=param.units?.filter(unit=>Number.isFinite(unit.factor)&&unit.factor>0)
  const [unitValue,setUnitValue]=useState(units?.[0]?.value??param.unit??'')
  const selected=units?.find(unit=>unit.value===unitValue)??units?.[0]
  if(!selected)return <BaseNumberController param={param} value={value} onChange={onChange} {...gesture}/>
  const factor=selected.factor
  const displayParam={...param,min:param.min/factor,max:param.max/factor,step:selected.step??param.step/factor,unit:selected.value}
  return <div className="controller-stack">
    <BaseNumberController param={displayParam} value={value/factor} onChange={next=>onChange(next*factor)} {...gesture}/>
    <SelectField label="Display unit" value={selected.value} options={(units??[]).map(unit=>({value:unit.value,label:unit.label}))} onChange={setUnitValue}/>
  </div>
}

function BaseNumberController({param,value,onChange,...gesture}: GestureProps & {param:NumberParam;value:number;onChange:(value:number)=>void}) {
  const drag=useControllerGesture(gesture)
  const origin=useRef({x:0,value:0})
  const p={label:param.label,value,min:param.min,max:param.max,step:param.step,unit:param.unit,onChange,...gesture}
  const view=param.view ?? (usesStepper(param)?'stepper':'slider')
  const lo=param.sliderMin ?? param.min, hi=param.sliderMax ?? param.max
  const log=param.scale==='log' && lo>0 && hi>lo
  const fraction=log ? Math.log(Math.max(lo,value)/lo)/Math.log(hi/lo) : (value-lo)/(hi-lo||1)
  const convert=(u:number)=>{
    let next=log ? lo*Math.pow(hi/lo,u) : lo+(hi-lo)*u
    if(param.stops?.length) next=param.stops.reduce((best,v)=>Math.abs(v-next)<Math.abs(best-next)?v:best,param.stops[0]!)
    else next=snapToStep(next,param.min,param.step)
    onChange(Math.max(param.min,Math.min(param.max,next)))
  }
  if(param.readOnly)return <div className="control control--field"><div className="number-value number-value--readonly"><span className="number-value__label">{param.label}</span><output className="number-value__readout">{value.toFixed(2)}</output>{param.unit?<span className="number-value__unit">{param.unit}</span>:null}</div></div>
  if(view==='seed') return <div className="controller-stack"><NumberField {...p} variant="stepper"/><div className="controller-actions"><Button size="sm" variant="quiet" onClick={()=>onChange(param.min+Math.floor(Math.random()*(Math.floor((param.max-param.min)/param.step)+1))*param.step)}>New seed</Button></div></div>
  if(view==='knob'||view==='angle') return <div className="controller-stack">
    <NumberField {...p} variant="field"/>
    <div className="dial-row"><div className="controller-dial" role="slider" tabIndex={0} aria-label={`${param.label} dial`} aria-valuemin={param.min} aria-valuemax={param.max} aria-valuenow={value} aria-valuetext={`${value}${param.unit??''}`}
      style={{'--dial-angle':`${view==='angle'?fraction*360:fraction*270-135}deg`,'--dial-fraction':String(Math.min(1,Math.max(0,fraction))),'--dial-start':view==='angle'?'0deg':'-135deg','--dial-sweep':view==='angle'?'360deg':'270deg'} as CSSProperties}
      data-kind={view}
      onPointerDown={e=>{if(drag.start(e))origin.current={x:e.clientY,value:fraction}}}
      onPointerMove={e=>{if(drag.active.current)convert(Math.max(0,Math.min(1,origin.current.value+(origin.current.x-e.clientY)/(e.shiftKey?1200:240))))}}
      {...drag.handlers} onKeyDown={e=>{if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End'].includes(e.key)){e.preventDefault(); if(e.key==='Home')onChange(param.min);else if(e.key==='End')onChange(param.max);else onChange(Math.max(param.min,Math.min(param.max,value+(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1)*param.step)))}}}>
      <span className="controller-dial__ticks" aria-hidden/><span className="controller-dial__arc" aria-hidden/><span className="controller-dial__hand"/><span className="controller-dial__center"/></div>
      <span className="field__hint">Drag vertically.<br/>Shift for precision.</span></div>
  </div>
  if(view==='field'||view==='stepper') return <NumberField {...p} variant={view}/>
  if(!log&&!param.stops?.length) return <SliderField {...p} sliderMin={param.sliderMin} sliderMax={param.sliderMax}/>
  const stopFraction=(stop:number)=>Math.max(0,Math.min(1,log?Math.log(Math.max(lo,stop)/lo)/Math.log(hi/lo):(stop-lo)/(hi-lo||1)))
  return <div className="controller-stack"><NumberField {...p} variant="field"/><div className="slider-wrap" style={{'--p':String(fraction)} as CSSProperties}><span className="slider__track"><span className="slider__fill"/></span>
    {param.stops?.map(stop=><span key={stop} className="slider__stop" data-reached={stop<=value||undefined} style={{'--at':String(stopFraction(stop))} as CSSProperties} aria-hidden="true"/>)}
    <input type="range" className="slider" aria-label={`${param.label} slider`} aria-valuemin={param.min} aria-valuemax={param.max} aria-valuenow={value} aria-valuetext={`${value}${param.unit??''}`} min={0} max={1000} step={1} value={Math.max(0,Math.min(1000,fraction*1000))} onPointerDown={e=>{drag.start(e,true)}} {...drag.handlers} onKeyDown={e=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))return
      e.preventDefault()
      if(e.key==='Home'){convert(0);return}if(e.key==='End'){convert(1);return}
      const direction=['ArrowLeft','ArrowDown','PageDown'].includes(e.key)?-1:1
      if(param.stops?.length){const stops=[...param.stops].sort((a,b)=>a-b);onChange(direction>0?stops.find(v=>v>value)??stops[stops.length-1]!:stops.reverse().find(v=>v<value)??stops[stops.length-1]!)}
      else convert(Math.max(0,Math.min(1,fraction+direction*(e.key.startsWith('Page')?0.1:0.01))))
    }} onChange={e=>convert(Number(e.target.value)/1000)}/></div>
    {log?<p className="field__hint">Logarithmic scale</p>:null}</div>
}
