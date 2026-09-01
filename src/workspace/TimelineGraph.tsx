import type { AnimTrack } from '@/rigs/types'
import type { Point } from '@/rigs/extended-types'
import type { RigSession } from '@/state/session'
import { interpolateNumber } from '@/state/values'
import { PointsController } from '@/ui/PointsController'

export function TimelineGraph({session,track}:{session:RigSession;track:AnimTrack}) {
  if(!track)return <p className="field__hint">Add a track to edit its curve.</p>
  const param=session.parameters.find(p=>p.id===track.paramId)
  if(param?.kind!=='number'||track.keyframes.length<2)return <p className="field__hint">Select a numeric track with at least two keys.</p>
  const points=track.keyframes.map(k=>({x:k.time/session.durationTime(),y:k.value}))
  const apply=(next:Point[])=>{
    const own=!session.isGesturing()
    if(own)session.beginGesture(`Edit ${param.label} curve`)
    try {
      if(next.length===points.length) next.forEach((p,i)=>session.updateKeyframe({paramId:param.id,id:track.keyframes[i]!.id!},{time:p.x*session.durationTime(),value:p.y}))
      else if(next.length>points.length) {
        const added=next.find(p=>!points.some(old=>old.x===p.x&&old.y===p.y))
        if(added)session.addKeyframe(param.id,added.x*session.durationTime(),added.y)
      } else {
        const removed=points.findIndex(p=>!next.some(old=>old.x===p.x&&old.y===p.y))
        if(removed>=0)session.deleteKeyframes([{paramId:param.id,id:track.keyframes[removed]!.id!}])
      }
    } finally {if(own)session.endGesture()}
  }
  return <div className="timeline-graph"><PointsController label={`${param.label} animation curve`} value={points} displayPoints={Array.from({length:100},(_,i)=>({x:i/99,y:interpolateNumber(track,i/99*session.durationTime(),session.durationTime(),false)}))} min={param.min} max={param.max} onChange={apply} onGestureStart={()=>session.beginGesture(`Edit ${param.label} curve`)} onGestureEnd={()=>session.endGesture()} onGestureCancel={()=>session.cancelGesture()}/><p className="field__hint">Position is normalized from 0 to 1 across the duration. Key positions are frame-snapped; interpolation stays editable in the key menu.</p></div>
}
