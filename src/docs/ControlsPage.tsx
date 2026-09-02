import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { DocsChrome } from '@/docs/DocsChrome'
import { controllerDefinitions, controllerExamples, controllerCategories, controllerManifest } from '@/rigs/controller-catalog'
import type { ParameterDef } from '@/rigs/types'
import { RigSession, describeValueSource } from '@/state/session'
import { loadDraft, saveDraft } from '@/state/persistence'
import { ParameterField } from '@/ui/ParameterField'
import { ValueSourceController } from '@/ui/BindingController'
import { Button, IconButton } from '@/ui/Button'
import { ContextMenuRoot, ContextTarget } from '@/ui/ContextMenu'
import { SelectField } from '@/ui/SelectField'
import { Tooltip } from '@/ui/Tooltip'
import { IconClose, IconCode } from '@/ui/icons'

export function ControlsPage() {
  // The catalog exercises each controller on its own: the lab keeps the timeline, so no card here is secretly animated.
  const [session]=useState(()=>{
    const draft=loadDraft('controller-catalog')
    return new RigSession({...controllerManifest,id:'controller-catalog',animation:controllerManifest.animation&&{...controllerManifest.animation,tracks:[]}},draft&&{...draft,tracks:[]})
  })
  useSyncExternalStore(session.subscribe,()=>session.getRevision())
  const [query,setQuery]=useState(''),[category,setCategory]=useState('numbers')
  const [inspectingId,setInspectingId]=useState<string|null>(null)
  const state=session.getSnapshot()
  const errors=session.driverErrors()
  const inspecting=inspectingId?controllerExamples.find(p=>p.id===inspectingId)??null:null
  useEffect(()=>{
    const save=()=>{if(!session.isGesturing())saveDraft(session.toDraft())}
    const unsubscribe=session.subscribe(save)
    return ()=>{unsubscribe();session.setPlaying(false);save()}
  },[session])
  const filtered=controllerExamples.filter(p=>(category==='all'||p.group===category)&&`${p.label} ${p.kind} ${p.group}`.toLowerCase().includes(query.toLowerCase()))
  return <DocsChrome>
    <h1>Controllers</h1>
    <p className="lede">One value contract, several instruments. Try every controller with undo, saved local state and the same fields used in the inspector.</p>
    <p className="field__hint">This page tests each controller independently. For a composed preview, history and timeline, <Link className="text-link" to="/r/controller-lab">open the full Controller lab</Link>.</p>
    <div className="catalog-toolbar">
      <label className="text-field catalog-search"><span className="text-field__label">Find a controller</span><input className="text-field__input" type="search" placeholder="Name or type…" autoComplete="off" spellCheck={false} value={query} onChange={e=>{setQuery(e.target.value);if(e.target.value)setCategory('all')}}/></label>
      <SelectField label="Family" value={category} options={[{value:'all',label:'All controllers'},...controllerCategories.map(c=>({value:c.id,label:c.label}))]} onChange={next=>{setCategory(next);setQuery('')}}/>
      <div className="controller-actions"><Button size="sm" variant="quiet" disabled={!session.canUndo()} onClick={()=>session.undo()}>Undo</Button><Button size="sm" variant="quiet" disabled={!session.canRedo()} onClick={()=>session.redo()}>Redo</Button><Button size="sm" variant="quiet" onClick={()=>session.resetAll()}>Reset examples</Button></div>
    </div>
    <ContextMenuRoot><div className="control-catalog">{filtered.map(param=><CatalogSlot key={param.id}><ContextTarget touchActions={false} label={`${param.label} actions`} items={[]} controller={param.kind==='number'&&!param.readOnly&&!param.role?<ValueSourceController label={param.label} target={param.id} value={session.sourceFor(param.id)??{mode:'local'}} sources={controllerDefinitions.filter(candidate=>candidate.kind==='number'&&!candidate.readOnly&&!candidate.role).map(candidate=>({id:candidate.id,label:candidate.label}))} animated={Boolean(session.trackFor(param.id))} min={param.min} max={param.max} onChange={source=>session.setValueSource(param.id,source)} forceExpanded/>:undefined}><article className="control-sample" aria-label={param.label}>
        <header className="control-sample__head">
          <div className="control-sample__titles">
            <h2>{param.label}</h2>
            <p>{controllerCategories.find(c=>c.id===param.group)?.label} · <code>{param.kind}</code></p>
          </div>
          <Tooltip content="Value & manifest">
            <IconButton
              label="Value & manifest"
              aria-expanded={inspectingId===param.id}
              aria-haspopup="dialog"
              aria-controls="controller-manifest"
              onClick={()=>setInspectingId(param.id)}
            >
              <IconCode/>
            </IconButton>
          </Tooltip>
        </header>
        <div className="control-sample__live"><ParameterField param={param.kind==='number'&&param.role==='playhead'?{...param,max:state.duration}:param} value={state.values[param.id]??param.defaultValue} onChange={next=>session.setValue(param.id,next)} onAction={id=>session.runAction(id)} onPreset={(id,next)=>session.applyPreset(id,next)} resolveNumber={id=>{const value=state.values[id];if(typeof value!=='number')throw new Error(`Not a numeric parameter: ${id}`);return value}} parameters={controllerDefinitions} animated={id=>Boolean(session.trackFor(id))} driven={id=>describeValueSource(session.sourceFor(id),controllerDefinitions)} onGestureStart={()=>session.beginGesture(`Adjust ${param.label}`)} onGestureEnd={()=>session.endGesture()} onGestureCancel={()=>session.cancelGesture()}/></div>
        {errors[param.id]?<p className="field__error" role="alert">{errors[param.id]}</p>:null}
      </article></ContextTarget></CatalogSlot>)}</div></ContextMenuRoot>
    {!filtered.length?<p>No controllers match this search. Try another name or family.</p>:null}
    <p><Link className="text-link" to="/docs">How to add a rig</Link></p>
    <ManifestDrawer
      open={Boolean(inspecting)}
      param={inspecting}
      value={inspecting?state.values[inspecting.id]??inspecting.defaultValue:undefined}
      onDismiss={()=>setInspectingId(null)}
    />
  </DocsChrome>
}

function ManifestDrawer({open,param,value,onDismiss}:{open:boolean;param:ParameterDef|null;value:unknown;onDismiss:()=>void}) {
  const dialogRef=useRef<HTMLDialogElement>(null)
  const titleId=useId()
  const held=useRef<{param:ParameterDef;value:unknown}|null>(null)
  if(param) held.current={param,value}
  const shown=param??held.current?.param??null
  const shownValue=param?value:held.current?.value
  useLayoutEffect(()=>{
    const dialog=dialogRef.current
    if(!dialog) return
    if(open && !dialog.open) dialog.showModal()
    else if(!open && dialog.open) dialog.close()
  },[open])
  useLayoutEffect(()=>{
    if(open) dialogRef.current?.focus()
  },[open,shown?.id])
  return <dialog
    ref={dialogRef}
    id="controller-manifest"
    className="manifest-drawer"
    tabIndex={-1}
    aria-labelledby={titleId}
    closedby="any"
    onClose={onDismiss}
  >
    {shown?<div className="manifest-drawer__panel">
      <header className="manifest-drawer__head">
        <div className="manifest-drawer__titles">
          <p className="manifest-drawer__eyebrow">Value & manifest</p>
          <h2 id={titleId}>{shown.label}</h2>
        </div>
        <Tooltip content="Close">
          <IconButton label="Close" onClick={()=>dialogRef.current?.close()}><IconClose/></IconButton>
        </Tooltip>
      </header>
      <div className="manifest-drawer__body">
        <section>
          <h3>Value</h3>
          <pre>{JSON.stringify(shownValue,null,2)}</pre>
        </section>
        <section>
          <h3>Manifest</h3>
          <pre>{JSON.stringify(shown,null,2)}</pre>
        </section>
      </div>
    </div>:null}
  </dialog>
}

const CATALOG_ROW_PX = 4
const CATALOG_GAP_PX = 24

function CatalogSlot({children}:{children:ReactNode}) {
  const ref=useRef<HTMLDivElement>(null)
  useLayoutEffect(()=>{
    const slot=ref.current
    const card=slot?.firstElementChild
    if(!slot||!(card instanceof HTMLElement))return
    const measure=()=>{
      const height=card.getBoundingClientRect().height
      const span=Math.max(1,Math.ceil((height+CATALOG_GAP_PX)/CATALOG_ROW_PX))
      slot.style.setProperty('--catalog-span',String(span))
    }
    const observer=new ResizeObserver(measure)
    observer.observe(card)
    measure()
    return ()=>observer.disconnect()
  },[])
  return <div className="catalog-slot" ref={ref}>{children}</div>
}
