import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { RigSession } from '@/state/session'
import { interpolateNumber } from '@/state/values'
import { NumberController } from '@/ui/NumberController'

/** Subscribes independently because the floating panel outlives its opener's render. */
export function TimelineController({ session, paramId, time, keyId }: {
  session: RigSession
  paramId: string
  time: number
  keyId?: string
}) {
  useSyncExternalStore(session.subscribe, () => session.getRevision())
  const gesturing = useRef(false)
  useEffect(() => {
    session.setPlayhead(time)
    return () => { if (gesturing.current) { gesturing.current = false; session.cancelGesture() } }
  }, [session, time])
  const param = session.parameters.find(item => item.id === paramId)
  const track = session.trackFor(paramId)
  const frame = keyId ? track?.keyframes.find(item => item.id === keyId) : undefined
  if (param?.kind !== 'number' || (keyId && !frame)) return null
  const at = frame?.time ?? time
  const value = frame?.value ?? (track ? interpolateNumber(track, at, session.durationTime(), false) : session.liveNumber(paramId))
  const props = {
    label: param.label,
    value,
    min: param.min,
    max: param.max,
    step: param.step,
    unit: param.unit,
    onChange: (next: number) => {
      if (keyId) session.updateKeyframe({ paramId, id: keyId }, { value: next })
      else session.addKeyframe(paramId, at, next)
    },
    onGestureStart: () => { gesturing.current = true; session.beginGesture(`Adjust ${param.label} keyframe`) },
    onGestureEnd: () => { if (gesturing.current) { gesturing.current = false; session.endGesture() } },
    onGestureCancel: () => { if (gesturing.current) { gesturing.current = false; session.cancelGesture() } },
  }
  return <div className="timeline-controller">
    <p className="field__hint">{frame ? 'Keyframe' : 'Value'} at {at.toFixed(2)} s</p>
    <NumberController param={param} {...props} />
    {!frame ? <p className="field__hint">Changing this value sets a keyframe here.</p> : null}
  </div>
}
