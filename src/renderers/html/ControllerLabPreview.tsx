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

/**
 * The library card. The lab has no single picture — it is every controller family at once — so the
 * mark shows the controls rather than the shape they drive: a slider part-way along, a row of
 * swatches, a switch that is on, and a curve.
 */
export function ControllerMark() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true">
      <rect width="320" height="200" fill="#E8EBE2" />
      <rect x="36" y="52" width="176" height="4" rx="2" fill="#C8CCC0" />
      <rect x="36" y="52" width="104" height="4" rx="2" fill="#1C201C" />
      <circle cx="140" cy="54" r="9" fill="#1C201C" />
      {['#F4F3EB', '#8CBDA8', '#1C201C'].map((color, i) => (
        <rect key={color} x={36 + i * 32} y={88} width="24" height="24" rx="6" fill={color} stroke="#C8CCC0" />
      ))}
      <rect x="152" y="88" width="44" height="24" rx="12" fill="#8CBDA8" />
      <circle cx="184" cy="100" r="9" fill="#F4F3EB" />
      <path d="M36 160c44 0 44-32 88-32s88 16 132 16" stroke="#1C201C" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  )
}
