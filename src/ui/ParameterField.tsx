import { useId, useState } from 'react'
import type { ParameterDef,ParamValue,BezierCurve,GradientStop } from '@/rigs/types'
import type { CameraValue,Gizmo2DValue,Gizmo3DValue,Point,RadialLayer,ResourceValue,TextureFrameValue } from '@/rigs/extended-types'
import { objectValue } from '@/state/parameter-values'
import { NumberController } from './NumberController'
import { ColorController } from './ColorController'
import { ColorField } from './ColorField'
import { CurveField } from './CurveField'
import { GradientField } from './GradientField'
import { SwitchField } from './SwitchField'
import { SelectField } from './SelectField'
import { SpatialController,RangeController } from './SpatialController'
import { PointsController } from './PointsController'
import { RadialController } from './RadialController'
import { TextController } from './TextController'
import { ChoiceController } from './ChoiceController'
import { ResourceController } from './ResourceController'
import { CameraController, Gizmo2DController, Gizmo3DController, TextureFrameController } from './VisualControllers'
import { Button, IconButton } from './Button'
import { IconChevron, IconChevronRight, IconChevronUp, IconPlus, IconTrash } from './icons'
import { Tooltip } from './Tooltip'
import type { GestureProps } from './controller-gesture'

export type ParameterFieldProps=GestureProps & {
  param:ParameterDef;value:ParamValue;onChange:(v:ParamValue)=>void
  onAction?:(id:string)=>void;onPreset?:(id:string,value:string)=>void
  resolveNumber?:(id:string)=>number
  parameters?: ParameterDef[]
  animated?: (id:string)=>boolean
}
export function ParameterField({param,value,onChange,onAction,onPreset,resolveNumber,parameters=[],animated,...gesture}:ParameterFieldProps) {
  const common={...gesture}
  switch(param.kind){
    case 'number': return <NumberController param={param} value={Number(value)} onChange={onChange} {...common}/>
    case 'color': return <ColorController param={param} value={String(value)} onChange={onChange} {...common}/>
    case 'switch': return <SwitchField label={param.label} checked={Boolean(value)} onChange={onChange}/>
    case 'select': return param.view?<ChoiceController label={param.label} options={param.options} value={String(value)} onChange={onChange} visual={param.view==='visual'} font={param.view==='font'} searchable={param.view==='search'||param.options.length>8}/>:<SelectField label={param.label} value={String(value)} options={param.options} onChange={onChange}/>
    case 'curve': return <CurveField label={param.label} value={value as BezierCurve} onChange={onChange} {...common}/>
    case 'gradient': return <GradientField label={param.label} value={value as GradientStop[]} onChange={onChange} {...common}/>
    case 'vector': return <SpatialController param={param} value={value as number[]} onChange={onChange} {...common}/>
    case 'range': return <RangeController param={param} value={value as number[]} onChange={onChange} {...common}/>
    case 'text': return <TextController label={param.label} value={String(value)} multiline={param.multiline} maxLength={param.maxLength} onChange={onChange}/>
    case 'multiselect': return <ChoiceController label={param.label} options={param.options} value={value as string[]} multiple searchable={param.options.length>8} onChange={onChange}/>
    case 'points': return <PointsController label={param.label} value={value as Point[]} path={param.view==='path'} min={param.min} max={param.max} onChange={onChange} {...common}/>
    case 'radial': return <RadialController label={param.label} value={value as RadialLayer[]} zones={param.zones} maxLayers={param.maxLayers} onChange={onChange} {...common}/>
    case 'resource': return <ResourceController param={param} value={value as ResourceValue|null} onChange={onChange}/>
    case 'gizmo2d': return <Gizmo2DController value={value as Gizmo2DValue} onChange={onChange} {...common}/>
    case 'gizmo3d': return <Gizmo3DController value={value as Gizmo3DValue} onChange={onChange} {...common}/>
    case 'textureFrame': return <TextureFrameController value={value as TextureFrameValue} onChange={onChange} {...common}/>
    case 'camera': return <CameraController value={value as CameraValue} onChange={onChange} {...common}/>
    case 'palette': {const colors=value as string[];const full=colors.length>=(param.maxItems??16);return <div className="controller-stack" role="group" aria-label={param.label}><div className="control__head"><span className="control__label">{param.label}</span><div className="control__tools"><Tooltip content={full?'Palette is full':'Add color'}><IconButton label="Add color" disabled={full} onClick={()=>onChange([...colors,'#808080'])}><IconPlus/></IconButton></Tooltip></div></div>{colors.map((color,i)=><div className="controller-list-row" key={i}><ColorField label={`Color ${i+1}`} value={color} onChange={next=>onChange(colors.map((v,j)=>i===j?next:v))} {...common}/><Tooltip content={colors.length<=1?'Keep at least one color':`Remove color ${i+1}`}><IconButton label={`Remove color ${i+1}`} disabled={colors.length<=1} onClick={()=>onChange(colors.filter((_,j)=>j!==i))}><IconTrash/></IconButton></Tooltip></div>)}</div>}
    case 'group': return <fieldset className="controller-stack controller-fieldset controller-group"><legend>{param.label}</legend>{param.fields.filter(field=>!field.hidden).map(field=><ParameterField key={field.id} param={field} value={objectValue(value)[field.id]??field.defaultValue} onChange={next=>onChange({...objectValue(value),[field.id]:next})} onAction={onAction} onPreset={onPreset} resolveNumber={resolveNumber} parameters={parameters} animated={animated} {...common}/>)}</fieldset>
    case 'list': return <ListController param={param} value={value as ParamValue[]} onChange={onChange} onAction={onAction} onPreset={onPreset} resolveNumber={resolveNumber} parameters={parameters} animated={animated} {...common}/>
    case 'action': {const hint=param.action==='set'?'Apply a declared group of values in one undo step.':param.action==='randomize'?'Randomize only the explicitly allowed numeric values.':param.action==='reset'?'Restore only the declared targets.':'Emit a repeatable counter for the renderer.';return <div className="controller-stack"><Button variant="ghost" onClick={()=>onAction?.(param.id)} disabled={!onAction}>{param.label}</Button><p className="field__hint">{hint}</p>{param.action==='trigger'?<output className="field__hint">Triggered {Number(value)} times</output>:null}</div>}
    case 'preset': return <SelectField label={param.label} value={String(value)} options={param.options} onChange={next=>onPreset?onPreset(param.id,next):onChange(next)}/>
  }
}

function ListController({param,value,onChange,onAction,onPreset,resolveNumber,parameters,animated,...gesture}:GestureProps & {param:Extract<ParameterDef,{kind:'list'}>;value:ParamValue[];onChange:(v:ParamValue[])=>void;onAction?:ParameterFieldProps['onAction'];onPreset?:ParameterFieldProps['onPreset'];resolveNumber?:ParameterFieldProps['resolveNumber'];parameters?:ParameterDef[];animated?:ParameterFieldProps['animated']}) {
  const listId=useId()
  const [open,setOpen]=useState<number|null>(0)
  const move=(i:number,d:number)=>{const next=[...value];[next[i],next[i+d]]=[next[i+d]!,next[i]!];onChange(next);setOpen(i+d)}
  return <fieldset className="controller-stack controller-fieldset controller-list"><legend>{param.label}</legend>{value.map((v,i)=>{const expanded=open===i;const itemLabel=`${param.item.label} ${i+1}`;const bodyId=`${listId}-item-${i}`;return <div className="controller-list-item" data-expanded={expanded||undefined} key={i}>
    <div className="controller-list-item__header">
      <button type="button" className="controller-list-item__toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={()=>setOpen(expanded?null:i)}><span>{itemLabel}</span><IconChevronRight/></button>
      <div className="controller-list-item__tools">
        {value.length>1?<><Tooltip content={i===0?'Already first':`Move ${itemLabel.toLowerCase()} up`}><IconButton label={`Move item ${i+1} up`} disabled={i===0} onClick={()=>move(i,-1)}><IconChevronUp/></IconButton></Tooltip>
        <Tooltip content={i===value.length-1?'Already last':`Move ${itemLabel.toLowerCase()} down`}><IconButton label={`Move item ${i+1} down`} disabled={i===value.length-1} onClick={()=>move(i,1)}><IconChevron/></IconButton></Tooltip></>:null}
        <Tooltip content={`Remove ${itemLabel.toLowerCase()}`}><IconButton label={`Remove item ${i+1}`} onClick={()=>{onChange(value.filter((_,j)=>i!==j));setOpen(null)}}><IconTrash/></IconButton></Tooltip>
      </div>
    </div>
    {expanded?<div className="controller-list-item__body" id={bodyId}><ParameterField param={param.item} value={v} onChange={next=>onChange(value.map((old,j)=>i===j?next:old))} onAction={onAction} onPreset={onPreset} resolveNumber={resolveNumber} parameters={parameters} animated={animated} {...gesture}/></div>:null}
  </div>})}{!value.length?<p className="controller-list__empty">No items yet.</p>:null}<Button className="controller-list__add" size="sm" variant="quiet" disabled={value.length>=(param.maxItems??32)} onClick={()=>{onChange([...value,structuredClone(param.item.defaultValue)]);setOpen(value.length)}}>Add {param.item.label.toLowerCase()}</Button></fieldset>
}

