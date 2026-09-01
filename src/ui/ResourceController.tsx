import { useEffect, useRef, useState } from 'react'
import type { ExtendedParameter,ResourceValue } from '@/rigs/extended-types'
import { loadResource,saveResource } from '@/state/resources'
import { Button } from './Button'

export function ResourceController({param,value,onChange}:{param:Extract<ExtendedParameter,{kind:'resource'}>;value:ResourceValue|null;onChange:(v:ResourceValue|null)=>void}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[url,setUrl]=useState('')
  const current=useRef(0)
  const resourceId=value?.id
  const formats=[...new Set(param.accept.split(',').map(raw=>{const format=raw.trim().replace(/^\./,'').replace(/^image\//,'').replace(/\+xml$/,'');return format==='jpeg'?'JPEG':format.toUpperCase()}))].join(' · ')
  useEffect(()=>{let cancelled=false,objectUrl='';setUrl('');setError('');if(resourceId)loadResource(resourceId).then(blob=>{if(cancelled)return;if(!blob){setError('This local resource is missing. Choose the file again.');return}objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)}).catch(e=>{if(!cancelled)setError(String(e.message))});return()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl)}},[resourceId])
  useEffect(()=>()=>{current.current++},[])
  const choose=async(file?:File)=>{if(!file)return;const request=++current.current;setBusy(true);setError('');try{const next=await saveResource(file,param.accept,param.maxMB);if(request===current.current)onChange(next)}catch(e){if(request===current.current)setError(e instanceof Error?e.message:'Could not load resource')}finally{if(request===current.current)setBusy(false)}}
  return <fieldset className="controller-stack controller-fieldset"><legend>{param.label}</legend>
    <label className="resource-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void choose(e.dataTransfer.files[0])}}>
      <input type="file" accept={param.accept} disabled={busy} aria-label={`Choose ${param.label}`} onChange={e=>{void choose(e.target.files?.[0]);e.target.value=''}}/>
      {url&&['image','texture','svg'].includes(param.view??'')?<img src={url} alt={value?.name??param.label}/>:null}
      <span>{busy?'Saving locally…':value?.name??'Choose or drop a file'}</span><small>{formats} · up to {param.maxMB??25} MB</small>
    </label>
    {error?<p className="field__error" role="alert">{error}</p>:null}
    {value?<div className="controller-actions"><Button size="sm" variant="quiet" disabled={busy} onClick={()=>onChange(null)}>Remove</Button>{url?<a className="text-link" href={url} download={value.name}>Download</a>:null}</div>:null}
    <p className="field__hint">Stored on this browser. JSON exports contain the reference, not the file.</p>
  </fieldset>
}
