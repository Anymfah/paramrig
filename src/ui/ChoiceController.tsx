import { useId, useState } from 'react'
import type { Option } from '@/rigs/extended-types'

export function ChoiceController({label,options,value,onChange,multiple=false,visual=false,font=false,searchable=false}:{label:string;options:Option[];value:string|string[];onChange:(v:string|string[])=>void;multiple?:boolean;visual?:boolean;font?:boolean;searchable?:boolean}) {
  const [query,setQuery]=useState('')
  const labelId=useId()
  const choices=options.filter(o=>o.label.toLowerCase().includes(query.toLowerCase()))
  const selected=Array.isArray(value)?value:[value]
  return <div className="control control--field">
    <div className="choice-box" data-visual={visual||undefined}>
      <div className="choice-box__head">
        <span className="choice-box__label" id={labelId}>{label}</span>
        {searchable?<input className="choice-box__search" type="search" aria-label={`Search ${label}`} placeholder="Search…" autoComplete="off" spellCheck={false} value={query} onChange={e=>setQuery(e.target.value)}/>:null}
      </div>
      <div className={`choice-controller ${visual?'choice-controller--visual':''}`} role={multiple?'group':'radiogroup'} aria-labelledby={labelId}>
        {choices.map((o,index)=><button key={o.value} type="button" role={multiple?'checkbox':'radio'} aria-checked={selected.includes(o.value)} tabIndex={multiple||selected.includes(o.value)||(!choices.some(c=>selected.includes(c.value))&&index===0)?0:-1} className="choice-controller__option" onKeyDown={e=>{
          if(multiple||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return
          e.preventDefault()
          const next=e.key==='Home'?0:e.key==='End'?choices.length-1:(index+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)+choices.length)%choices.length
          onChange(choices[next]!.value)
          e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
        }} onClick={()=>onChange(multiple?(selected.includes(o.value)?selected.filter(v=>v!==o.value):[...selected,o.value]):o.value)}>
          {visual?<span className="choice-controller__preview" style={{background:o.preview??'var(--surface-raised)'}} aria-hidden="true"/>:null}
          <span className="choice-controller__text" style={font?{fontFamily:o.value}:undefined}>{o.label}</span><span className="choice-controller__mark" aria-hidden="true">{selected.includes(o.value)?'✓':''}</span></button>)}
        {choices.length===0?<p className="choice-controller__empty" role="status">No matching options.</p>:null}
      </div>
    </div>
  </div>
}
