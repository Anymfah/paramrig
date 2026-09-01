import { lazy, Suspense, useRef, type CSSProperties, type PointerEvent } from 'react'
import type { CameraValue, Gizmo2DValue, Gizmo3DValue, TextureFrameValue } from '@/rigs/extended-types'
import { NumberField } from './NumberField'
import { useControllerGesture, type GestureProps } from './controller-gesture'

const Gizmo3DScene=lazy(()=>import('@/renderers/three/Gizmo3DScene').then(module=>({default:module.Gizmo3DScene})))

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value))
const point=(event:PointerEvent<HTMLElement>)=>{
  const rect=event.currentTarget.getBoundingClientRect()
  return [clamp((event.clientX-rect.left)/rect.width,0,1),clamp((event.clientY-rect.top)/rect.height,0,1)] as const
}
function Handle({label,onKeyDown,onPointerDown,onPointerMove,style}:{label:string;onKeyDown:(event:React.KeyboardEvent<HTMLButtonElement>)=>void;onPointerDown:(event:PointerEvent<HTMLButtonElement>)=>void;onPointerMove:(event:PointerEvent<HTMLButtonElement>)=>void;style:CSSProperties}) {
  return <button type="button" className="controller-point visual-handle" aria-label={label} aria-description="Drag the handle or use arrow keys. Exact values are available below." style={style} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove}/>
}
export function Gizmo2DController({value,onChange,...gesture}:GestureProps&{value:Gizmo2DValue;onChange:(value:Gizmo2DValue)=>void}) {
  const drag=useControllerGesture(gesture)
  const update=(position:Gizmo2DValue['position'])=>onChange({...value,position})
  return <fieldset className="controller-stack controller-fieldset"><legend>2D transform gizmo</legend>
    <div className="visual-gizmo visual-gizmo--2d" onPointerDown={event=>{if(!drag.start(event))return;const [x,y]=point(event);update([x*2-1,1-y*2])}} onPointerMove={event=>{if(drag.active.current){const [x,y]=point(event);update([x*2-1,1-y*2])}}} {...drag.handlers}>
      <div className="visual-gizmo__box" style={{'--x':`${(value.position[0]+1)*50}%`,'--y':`${(1-value.position[1])*50}%`,'--rotation':`${value.rotation}deg`,'--width':`${value.size[0]*32}%`,'--height':`${value.size[1]*32}%`} as CSSProperties}/>
      <Handle label="2D transform position" style={{left:`${(value.position[0]+1)*50}%`,top:`${(1-value.position[1])*50}%`}} onPointerDown={event=>drag.start(event)} onPointerMove={event=>{if(drag.active.current){const [x,y]=point(event);update([x*2-1,1-y*2])}}} onKeyDown={event=>{const movement=({ArrowLeft:[-.01,0],ArrowRight:[.01,0],ArrowUp:[0,.01],ArrowDown:[0,-.01]} as Record<string,[number,number]>)[event.key];if(movement){event.preventDefault();update([clamp(value.position[0]+movement[0],-1,1),clamp(value.position[1]+movement[1],-1,1)])}}}/>
    </div>
    <div className="controller-components"><NumberField label="Rotation" variant="field" value={value.rotation} min={-180} max={180} step={1} unit="°" onChange={rotation=>onChange({...value,rotation})}/><NumberField label="Scale" variant="field" value={value.size[0]} min={.1} max={2} step={.01} onChange={scale=>onChange({...value,size:[scale,scale]})}/></div>
  </fieldset>
}
export function Gizmo3DController({value,onChange,...gesture}:GestureProps&{value:Gizmo3DValue;onChange:(value:Gizmo3DValue)=>void}) {
  return <fieldset className="controller-stack controller-fieldset"><legend>3D transform gizmo</legend>
    <div className="controller-actions visual-mode" role="group" aria-label="3D transform mode">{(['translate','rotate','scale'] as const).map(mode=><button type="button" key={mode} aria-pressed={value.mode===mode} onClick={()=>onChange({...value,mode})}>{mode}</button>)}</div>
    <Suspense fallback={<div className="three-gizmo-stage">Starting 3D transform preview…</div>}><Gizmo3DScene value={value} onChange={onChange} {...gesture}/></Suspense>
    <div className="controller-components"><NumberField label="X" variant="field" value={value.position[0]} min={-1} max={1} step={.01} onChange={x=>onChange({...value,position:[x,value.position[1],value.position[2]]})}/><NumberField label="Y" variant="field" value={value.position[1]} min={-1} max={1} step={.01} onChange={y=>onChange({...value,position:[value.position[0],y,value.position[2]]})}/></div>
  </fieldset>
}
export function TextureFrameController({value,onChange,...gesture}:GestureProps&{value:TextureFrameValue;onChange:(value:TextureFrameValue)=>void}) {
  const drag=useControllerGesture(gesture),active=useRef<number|null>(null)
  const move=(event:PointerEvent<HTMLElement>)=>{if(!drag.active.current||active.current===null)return;const [x,y]=point(event);const rect=[...value.rect] as TextureFrameValue['rect'];const index=active.current;rect[index]=index===0||index===2?x:y;onChange({...value,rect:[Math.min(rect[0],rect[2]-.05),Math.min(rect[1],rect[3]-.05),Math.max(rect[2],rect[0]+.05),Math.max(rect[3],rect[1]+.05)]})}
  const [left,top,right,bottom]=value.rect
  const corners:[[number,number],[number,number],[number,number],[number,number]]=[[left,top],[right,top],[right,bottom],[left,bottom]]
  return <fieldset className="controller-stack controller-fieldset"><legend>Texture frame</legend><div className="texture-frame" onPointerMove={move} {...drag.handlers}><div className="texture-frame__crop" style={{left:`${left*100}%`,top:`${top*100}%`,width:`${(right-left)*100}%`,height:`${(bottom-top)*100}%`,transform:`rotate(${value.rotation}deg)`}}/>{corners.map((position,index)=><Handle key={index} label={`Texture crop corner ${index+1}`} style={{left:`${position[0]*100}%`,top:`${position[1]*100}%`}} onPointerDown={event=>{active.current=index;drag.start(event)}} onPointerMove={move} onKeyDown={()=>{}}/>)}</div><div className="controller-components"><NumberField label="Rotation" variant="field" value={value.rotation} min={-180} max={180} step={1} unit="°" onChange={rotation=>onChange({...value,rotation})}/><NumberField label="Width" variant="field" value={right-left} min={.05} max={1} step={.01} onChange={width=>onChange({...value,rect:[left,top,clamp(left+width,.05,1),bottom]})}/></div></fieldset>
}
export function CameraController({value,onChange,...gesture}:GestureProps&{value:CameraValue;onChange:(value:CameraValue)=>void}) {
  const drag=useControllerGesture(gesture)
  const move=(event:PointerEvent<HTMLElement>)=>{const [x,y]=point(event);onChange({...value,azimuth:x*360-180,elevation:(1-y)*160-80})}
  return <fieldset className="controller-stack controller-fieldset"><legend>Camera rig</legend><div className="visual-gizmo visual-camera" onPointerDown={event=>{if(drag.start(event))move(event)}} onPointerMove={event=>{if(drag.active.current)move(event)}} {...drag.handlers}><div className="visual-camera__frustum" style={{'--azimuth':`${value.azimuth}deg`,'--elevation':`${value.elevation}deg`} as CSSProperties}/><span>Orbit target</span></div><div className="controller-components"><NumberField label="Distance" variant="field" value={value.distance} min={1} max={20} step={.1} onChange={distance=>onChange({...value,distance})}/><NumberField label="Field of view" variant="field" value={value.fov} min={20} max={100} step={1} unit="°" onChange={fov=>onChange({...value,fov})}/></div></fieldset>
}
