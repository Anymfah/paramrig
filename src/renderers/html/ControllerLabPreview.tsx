import type { ParamValue } from '@/rigs/types'
import type { CSSProperties } from 'react'
import { objectValue } from '@/state/parameter-values'

export function ControllerLabPreview({values}:{values:Record<string,ParamValue>}) {
  const xy=Array.isArray(values.position)?values.position as number[]:[0,0]
  const amount=typeof values.amount==='number'?values.amount:50
  const angle=typeof values.angle==='number'?values.angle:0
  const gizmo=objectValue(values.gizmo2d)
  const camera=objectValue(values.camera)
  const frame=objectValue(values.textureFrame)
  const position=Array.isArray(gizmo.position)?gizmo.position as number[]:[0,0]
  const rotation=typeof gizmo.rotation==='number'?gizmo.rotation:0
  const rect=Array.isArray(frame.rect)?frame.rect as number[]:[.15,.15,.85,.85]
  return <div className="controller-lab-preview" aria-label="Controller composition preview">
    <div className="controller-lab-preview__stage" style={{'--camera-angle':`${typeof camera.azimuth==='number'?camera.azimuth:0}deg`,'--frame-left':`${rect[0]!*100}%`,'--frame-top':`${rect[1]!*100}%`,'--frame-width':`${(rect[2]!-rect[0]!)*100}%`,'--frame-height':`${(rect[3]!-rect[1]!)*100}%`} as CSSProperties}>
      <div className="controller-lab-preview__frame"/>
      <div className="controller-lab-preview__shape" style={{width:48+amount,height:48+amount,background:String(values.ink??'#b8c5b2'),transform:`translate(${(xy[0]??0)*48+(position[0]??0)*48}px,${-(xy[1]??0)*48-(position[1]??0)*48}px) rotate(${angle+rotation}deg)`,borderRadius:values.material==='glass'?'50%':'24%'}}/>
    </div>
    <span>{String(values.title??'Make it move.')}</span>
  </div>
}
