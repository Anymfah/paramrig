import { useEffect, useRef, useState } from 'react'
import type { ExtendedParameter,ResourceValue } from '@/rigs/extended-types'
import { Button } from './Button'

export type ControlResources = {
  load: (id: string, signal: AbortSignal) => Promise<Blob | null>
  save: (file: File, accept: string, maxMB?: number) => Promise<ResourceValue>
}

export function ResourceController({param,value,onChange,resources}:{param:Extract<ExtendedParameter,{kind:'resource'}>;value:ResourceValue|null;onChange:(v:ResourceValue|null)=>void;resources?:ControlResources}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[url,setUrl]=useState(''),[over,setOver]=useState(false)
  const describe=(item:ResourceValue)=>{const kind=item.mime?item.mime.split('/').pop()!.replace(/^x-/,'').replace('+xml','').toUpperCase():item.name.split('.').pop()?.toUpperCase()??'File';const size=item.size>=1024*1024?`${(item.size/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(item.size/1024))} KB`;return `${kind} · ${size}`}
  const current=useRef(0)
  const resourceId=value?.id
  const formats=[...new Set(param.accept.split(',').map(raw=>{const format=raw.trim().replace(/^\./,'').replace(/^image\//,'').replace(/\+xml$/,'');return format==='jpeg'?'JPEG':format.toUpperCase()}))].join(' · ')
  useEffect(()=>{const abort=new AbortController();let cancelled=false,objectUrl='';setUrl('');setError('');if(resourceId&&resources)resources.load(resourceId,abort.signal).then(blob=>{if(cancelled)return;if(!blob){setError('This resource is missing. Choose the file again.');return}objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)}).catch(e=>{if(!cancelled)setError(String(e.message))});return()=>{cancelled=true;abort.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)}},[resourceId,resources])
  useEffect(()=>()=>{current.current++},[])
  const choose=async(file?:File)=>{if(!file||!resources)return;const request=++current.current;setBusy(true);setError('');try{const next=await resources.save(file,param.accept,param.maxMB);if(request===current.current)onChange(next)}catch(e){if(request===current.current)setError(e instanceof Error?e.message:'Could not load resource')}finally{if(request===current.current)setBusy(false)}}
  return <div className="controller-stack">
    <label className="resource-drop" data-filled={value?'':undefined} data-over={over||undefined} onDragEnter={e=>{e.preventDefault();setOver(true)}} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';if(!over)setOver(true)}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOver(false)}} onDrop={e=>{e.preventDefault();setOver(false);void choose(e.dataTransfer.files[0])}}>
      <input type="file" accept={param.accept} disabled={busy||!resources} aria-label={`Choose ${param.label}`} onChange={e=>{void choose(e.target.files?.[0]);e.target.value=''}}/>
      <span className="resource-drop__label">{param.label}</span>
      {url&&['image','texture','svg'].includes(param.view??'')?<img src={url} alt={value?.name??param.label}/>:null}
      <span className="resource-drop__name">{busy?'Saving…':over?'Drop to use this file':value?.name??'Choose or drop a file'}</span><small>{value&&!busy?describe(value):`${formats} · up to ${param.maxMB??25} MB`}</small>
    </label>
    {error?<p className="field__error" role="alert">{error}</p>:null}
    {value?<div className="controller-actions"><Button size="sm" variant="quiet" disabled={busy} onClick={()=>onChange(null)}>Remove</Button>{url?<a className="text-link" href={url} download={value.name}>Download</a>:null}</div>:null}
  </div>
}
