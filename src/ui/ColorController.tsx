import { useState, type CSSProperties } from 'react'
import type { ColorParam } from '@/rigs/types'
import { ColorField } from './ColorField'
import { NumberField } from './NumberField'
import { SliderField } from './SliderField'
import { SelectField } from './SelectField'
import type { GestureProps } from './controller-gesture'

export function ColorController({param,value,onChange,...gesture}:GestureProps & {param:ColorParam;value:string;onChange:(v:string)=>void}) {
  const [mode,setMode]=useState('rgb')
  const hex=value.slice(0,7),alpha=value.length===9?parseInt(value.slice(7),16)/255:1
  const rgba=(rgb:string,a=alpha)=>onChange(rgb+(param.alpha?Math.round(a*255).toString(16).padStart(2,'0'):''))
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16))
  const [r,g,b]=rgb.map(v=>v/255),max=Math.max(r!,g!,b!),min=Math.min(r!,g!,b!),d=max-min,l=(max+min)/2
  const h=d===0?0:(((max===r?(g!-b!)/d+(g!<b!?6:0):max===g?(b!-r!)/d+2:(r!-g!)/d+4)*60)%360)
  const saturation=d===0?0:d/(1-Math.abs(2*l-1))
  const values=mode==='rgb'?rgb:[h,saturation*100,l*100]
  const change=(index:number,n:number)=>{
    const next=values.map((v,i)=>i===index?n:v)
    if(mode==='rgb'){rgba('#'+next.map(v=>Math.round(v).toString(16).padStart(2,'0')).join(''));return}
    const [hh,ss,ll]=[next[0]!,next[1]!/100,next[2]!/100]
    const a=ss*Math.min(ll,1-ll)
    const channel=(n:number)=>{const k=(n+hh/30)%12;return Math.round(255*(ll-a*Math.max(-1,Math.min(k-3,9-k,1))))}
    rgba('#'+[0,8,4].map(n=>channel(n).toString(16).padStart(2,'0')).join(''))
  }
  if(!param.alpha&&!param.channels)return <ColorField label={param.label} value={hex} onChange={onChange} {...gesture}/>
  return <div className="controller-stack"><ColorField label={param.label} value={hex} onChange={rgba} {...gesture}/>
    {param.alpha?<SliderField label="Opacity" value={alpha*100} min={0} max={100} step={1} unit="%" onChange={n=>rgba(hex,n/100)} {...gesture}/>:null}
    {param.channels?<><SelectField label="Channels" value={mode} options={[{value:'rgb',label:'RGB'},{value:'hsl',label:'HSL'}]} onChange={setMode}/><div className="controller-components" style={{'--component-count':3} as CSSProperties}>{(mode==='rgb'?['R','G','B']:['H','S','L']).map((label,i)=><NumberField key={label} label={label} value={values[i]!} min={0} max={mode==='rgb'?255:i===0?360:100} step={1} variant="field" onChange={n=>change(i,n)} {...gesture}/>)}</div></>:null}
  </div>
}
