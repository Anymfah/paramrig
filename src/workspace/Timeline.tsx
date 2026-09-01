import { Fragment, memo, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { AnimTrack, Keyframe, KeyframeRef } from '@/rigs/types'
import { IconChevronRight, IconClose, IconCopy, IconExpand, IconKeyframe, IconLoop, IconMinus, IconMore, IconPaste, IconPause, IconPlay, IconPlus, IconStart, IconTrash } from '@/ui/icons'
import { Button, IconButton } from '@/ui/Button'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'
import { Tooltip } from '@/ui/Tooltip'
import { ContextMenuRoot, ContextTarget, type ContextMenuItem } from '@/ui/ContextMenu'
import type { RigSession } from '@/state/session'
import { updatePrefs, usePlayhead, useWorkspace } from '@/state/workspace'
import { interpolateNumber } from '@/state/values'
import { ResizeRow } from '@/shell/ResizeHandle'
import { useViewport } from '@/shell/useLayout'
import { timelineSize } from '@/state/timeline-layout'
import { TimelineGraph } from '@/workspace/TimelineGraph'
import { TimelineController } from '@/workspace/TimelineController'

const EASING = [
  { value: 'linear', label: 'Linear' }, { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' }, { value: 'ease-in-out', label: 'Ease in out' }, { value: 'step', label: 'Hold' },
]
const keyOf = (ref: KeyframeRef) => `${ref.paramId}:${ref.id}`
const timeText = (time: number) => `${time.toFixed(2)} s`
type ClipboardKey = { paramId: string; frame: Keyframe }
type Drag = { x: number; refs: KeyframeRef[]; time: number; delta: number; moved: boolean; target: HTMLElement; pointerId: number; pixelsPerSecond: number }

export function Timeline({ session }: { session: RigSession }) {
  const playhead = usePlayhead(session)
  const { prefs } = useWorkspace()
  const state = session.getSnapshot()
  const { tracks, duration, playing, fps, loop, loopRange } = state
  const [selection, setSelection] = useState<KeyframeRef[]>([])
  const [clipboard, setClipboard] = useState<ClipboardKey[]>([])
  const [graph,setGraph]=useState(false)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(640)
  const [hidden, setHidden] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [marquee, setMarquee] = useState<{ x: number; y: number; endX: number; endY: number } | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const scrollObserver = useRef<ResizeObserver | null>(null)
  const drag = useRef<Drag | null>(null)
  const root = useRef<HTMLElement>(null)
  const marqueeBase = useRef<KeyframeRef[]>([])
  const visibleTracks = tracks.filter(track => !hidden.includes(track.paramId))
  const groups = [...new Set(visibleTracks.map(track => session.parameters.find(param=>param.id===track.paramId)?.group ?? 'animation'))]
  const railWidth = width < 500 ? 128 : 184
  const laneWidth = Math.max(160, width - railWidth - 32) * zoom
  const pixelsPerSecond = laneWidth / duration
  const selected = tracks.flatMap(track => track.keyframes.filter(frame => selection.some(ref=>ref.paramId===track.paramId && ref.id===frame.id)).map(frame=>({paramId:track.paramId,frame})))
  const active = selected.length===1 ? selected[0] : undefined
  const activeParam = active && session.parameters.find(param=>param.id===active.paramId)
  const viewport = useViewport()
  const size = timelineSize(prefs.timelineHeight, viewport.height, viewport.width < 1024, selected.length > 0)
  const expanded = size.height === size.max

  const observeScroll = useCallback((element: HTMLDivElement | null) => {
    scrollObserver.current?.disconnect()
    scroll.current = element
    if (!element) return
    const measure = () => { if (element.clientWidth > 0) setWidth(element.clientWidth) }
    scrollObserver.current = new ResizeObserver(measure)
    measure()
    scrollObserver.current.observe(element)
  }, [])

  useEffect(() => () => { if (drag.current) session.cancelGesture() }, [session])

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return
      const gesture = drag.current
      drag.current = null
      session.cancelGesture()
      gesture.target.focus()
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [session])

  const copy = () => { if (!selected.length) return; setClipboard(structuredClone(selected)); setMessage(`${selected.length} keyframe${selected.length===1?'':'s'} copied`) }
  const paste = () => { setSelection(session.pasteKeyframes(clipboard)); setMessage('Keyframes pasted at the playhead; undo to restore replaced keys') }
  const remove = () => { session.deleteKeyframes(selection); setSelection([]) }
  const refsFor = (track: AnimTrack) => (session.trackFor(track.paramId)?.keyframes ?? []).map(frame => ({ paramId: track.paramId, id: frame.id! }))
  const copyRefs = (refs: KeyframeRef[]) => {
    const frames = session.getSnapshot().tracks.flatMap(track => track.keyframes.filter(frame => refs.some(ref => ref.paramId === track.paramId && ref.id === frame.id)).map(frame => ({ paramId: track.paramId, frame })))
    setClipboard(structuredClone(frames))
    setMessage(`${frames.length} keyframes copied`)
  }
  const deleteRefs = (refs: KeyframeRef[]) => { session.deleteKeyframes(refs); setSelection([]) }
  const changeEasing = (refs: KeyframeRef[], easing: Keyframe['easing']) => {
    session.beginGesture('Change keyframe easing')
    for (const ref of refs) session.updateKeyframe(ref, { easing })
    session.endGesture()
  }
  const timeAt = (event: { clientX: number; currentTarget: Element; keyboard?: boolean }) => {
    if (event.keyboard) return playhead
    const plane = event.currentTarget.querySelector('.tl-plane')
    const rect = plane?.getBoundingClientRect()
    return rect?.width ? session.snapTime((event.clientX - rect.left) / rect.width * duration) : playhead
  }
  const trackItems = (track: AnimTrack, time = playhead): ContextMenuItem[] => [
    { label: 'Add keyframe here', onSelect: () => { const ref = session.addKeyframe(track.paramId, time); if (ref) setSelection([ref]) } },
    { label: 'Select track keyframes', onSelect: () => setSelection(refsFor(track)) },
    { label: 'Copy track keyframes', onSelect: () => copyRefs(refsFor(track)) },
    { label: 'Paste keyframes here', disabled: !clipboard.length, onSelect: () => { session.setPlayhead(time); paste() } },
    { label: 'Hide track', onSelect: () => setHidden([...hidden, track.paramId]) },
    { label: `Reset ${session.labelFor(track.paramId)}`, onSelect: () => session.resetParam(track.paramId) },
    { label: 'Delete track', onSelect: () => deleteRefs(refsFor(track)) },
  ]
  const select = (ref: KeyframeRef, additive: boolean) => {
    const exists = selection.some(item=>keyOf(item)===keyOf(ref))
    const next = additive ? exists ? selection.filter(item=>keyOf(item)!==keyOf(ref)) : [...selection,ref] : exists ? selection : [ref]
    setSelection(next)
    return next
  }
  const beginDrag = (event: PointerEvent<HTMLButtonElement>, ref: KeyframeRef, time: number) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.focus()
    const refs = select(ref, event.shiftKey || event.metaKey || event.ctrlKey)
    if (!refs.some(item=>keyOf(item)===keyOf(ref))) return
    event.currentTarget.setPointerCapture(event.pointerId)
    session.beginGesture('Move keyframes')
    drag.current = { x:event.clientX, refs, time, delta:0, moved:false, target:event.currentTarget, pointerId:event.pointerId, pixelsPerSecond }
  }
  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const gesture = drag.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (!gesture.moved && Math.abs(event.clientX-gesture.x)<3) return
      gesture.moved=true
      gesture.delta=(event.clientX-gesture.x)/gesture.pixelsPerSecond
      session.moveKeyframes(gesture.refs,gesture.delta)
    }
    const end = (event: globalThis.PointerEvent) => {
      const gesture=drag.current
      if (!gesture || event.pointerId!==gesture.pointerId) return
      drag.current=null
      session.endGesture()
      if (!gesture.moved) session.setPlayhead(gesture.time)
    }
    const cancel = () => { if (!drag.current) return; drag.current=null; session.cancelGesture() }
    window.addEventListener('pointermove',move)
    window.addEventListener('pointerup',end)
    window.addEventListener('pointercancel',cancel)
    window.addEventListener('blur',cancel)
    return () => {
      window.removeEventListener('pointermove',move)
      window.removeEventListener('pointerup',end)
      window.removeEventListener('pointercancel',cancel)
      window.removeEventListener('blur',cancel)
    }
  }, [session])
  const scrub = (event: PointerEvent<HTMLElement>) => {
    const rect=event.currentTarget.getBoundingClientRect()
    session.setPlayhead((event.clientX-rect.left)/rect.width*duration)
  }
  const step = pixelsPerSecond > 240 ? 0.25 : pixelsPerSecond > 100 ? 0.5 : pixelsPerSecond < 35 ? 2 : 1
  const times = Array.from({length:Math.floor(duration/step)+1},(_,i)=>i*step)

  if (prefs.timelineCollapsed) return <section className="timeline timeline--stub" aria-label="Timeline"><button type="button" className="timeline-stub" onClick={()=>updatePrefs({timelineCollapsed:false})}>Show timeline · {tracks.length} tracks</button></section>

  return (
    <section ref={root} className={`timeline timeline--editor ${graph?'timeline--graph':''}`} aria-label="Timeline" style={{height:size.height,'--tl-rail':`${railWidth}px`,'--tl-lane':`${laneWidth}px`,'--tl-second':`${pixelsPerSecond}px`} as CSSProperties}
      onKeyDown={event=>{
        const target=event.target as HTMLElement
        if (target.matches('input,textarea,[role="combobox"]') || target.isContentEditable || event.defaultPrevented) return
        const meta=event.ctrlKey||event.metaKey
        if (meta && event.key.toLowerCase()==='c' && selected.length) { event.preventDefault();copy() }
        if (meta && event.key.toLowerCase()==='v' && clipboard.length) { event.preventDefault();paste() }
        if (meta && event.key.toLowerCase()==='a') { event.preventDefault();setSelection(visibleTracks.flatMap(track=>track.keyframes.map(frame=>({paramId:track.paramId,id:frame.id!})))) }
        if ((event.key==='Delete'||event.key==='Backspace') && selected.length) { event.preventDefault();remove() }
        if (event.key==='Escape' && !drag.current) { setSelection([]);setMarquee(null) }
        if (event.key===' ' && target===scroll.current) { event.preventDefault();session.setPlaying(!playing) }
      }}>
      <ResizeRow ariaLabel="Resize timeline" value={size.height} min={size.min} max={size.max}
        onChange={timelineHeight => updatePrefs({ timelineHeight })} onCollapse={() => updatePrefs({ timelineCollapsed: true })} />
      <div className="tl-toolbar">
        <div className="tl-transport">
          <Tooltip content="Go to start"><IconButton label="Go to start" onClick={()=>session.setPlayhead(loopRange?.start??0)}><IconStart /></IconButton></Tooltip>
          <Tooltip content={playing?'Pause':'Play'}><IconButton label={playing?'Pause':'Play'} onClick={()=>session.setPlaying(!playing)}><>{playing?<IconPause/>:<IconPlay/>}</></IconButton></Tooltip>
          <div className="tl-title"><strong>Timeline</strong><span className="tl-time">{timeText(playhead)} / {timeText(duration)}</span></div>
        </div>
        <div className="tl-tools">
          <Popover.Root><Tooltip content="Playback range"><Popover.Trigger asChild><IconButton label="Playback range" aria-pressed={Boolean(loopRange)}><IconLoop/></IconButton></Popover.Trigger></Tooltip>
            <Popover.Portal><Popover.Content className="popover tl-popover" sideOffset={8} align="end" aria-label="Playback range">
              <SwitchField label="Loop playback" checked={loop} onChange={next=>session.setLoop(next)}/>
              <NumberField variant="field" label="In" value={loopRange?.start??0} min={0} max={(loopRange?.end??duration)-1/fps} step={1/fps} unit="s" onChange={start=>session.setLoopRange({start,end:loopRange?.end??duration})}/>
              <NumberField variant="field" label="Out" value={loopRange?.end??duration} min={(loopRange?.start??0)+1/fps} max={duration} step={1/fps} unit="s" onChange={end=>session.setLoopRange({start:loopRange?.start??0,end})}/>
              <div className="tl-actions"><Button size="sm" variant="quiet" onClick={()=>session.setLoopRange({start:playhead,end:loopRange?.end??duration})}>In at cursor</Button><Button size="sm" variant="quiet" onClick={()=>session.setLoopRange({start:loopRange?.start??0,end:playhead})}>Out at cursor</Button></div>
              <Button size="sm" variant="quiet" onClick={()=>session.setLoopRange(null)}>Use full timeline</Button>
            </Popover.Content></Popover.Portal>
          </Popover.Root>
          <div className="tl-zoom"><Tooltip content="Zoom out"><IconButton label="Zoom timeline out" disabled={zoom<=1} onClick={()=>setZoom(Math.max(1,zoom/1.5))}><IconMinus/></IconButton></Tooltip><button className="tl-fit" type="button" onClick={()=>{setZoom(1);scroll.current?.scrollTo({left:0})}} aria-label="Fit timeline">{Math.round(zoom*100)}%</button><Tooltip content="Zoom in"><IconButton label="Zoom timeline in" disabled={zoom>=8} onClick={()=>setZoom(Math.min(8,zoom*1.5))}><IconPlus/></IconButton></Tooltip></div>
          <Popover.Root><Tooltip content="Timeline actions"><Popover.Trigger asChild><IconButton label="Timeline actions"><IconMore/></IconButton></Popover.Trigger></Tooltip><Popover.Portal><Popover.Content className="popover tl-popover" sideOffset={8} align="end" aria-label="Timeline actions">
            <Button size="sm" variant="quiet" disabled={!selected.length} onClick={copy}><IconCopy/> Copy selected keys</Button>
            <Button size="sm" variant="quiet" disabled={!clipboard.length} onClick={paste}><IconPaste/> Paste at playhead</Button>
            <Button size="sm" variant="quiet" disabled={!selected.length} onClick={remove}><IconTrash/> Delete selected keys</Button>
            <Button size="sm" variant="quiet" disabled={!hidden.length} onClick={()=>setHidden([])}>Show hidden tracks ({hidden.length})</Button>
            <p className="field__hint">Shift-click to select multiple keys. Drag to move; Esc cancels. ⌘ / Ctrl+C, V and Z work here.</p>
          </Popover.Content></Popover.Portal></Popover.Root>
          <Tooltip content={expanded ? 'Compact timeline' : 'Expand timeline'}><IconButton label={expanded ? 'Compact timeline' : 'Expand timeline'} aria-pressed={expanded} onClick={() => updatePrefs({ timelineHeight: expanded ? 232 : size.max })}><IconExpand/></IconButton></Tooltip>
          <Tooltip content="Hide timeline"><IconButton label="Hide timeline" onClick={()=>updatePrefs({timelineCollapsed:true})}><IconClose/></IconButton></Tooltip>
        </div>
      </div>
      <div className="tl-view-switch"><Button size="sm" variant="quiet" aria-pressed={graph} onClick={()=>setGraph(!graph)}>{graph?'Hide curve editor':'Curve editor'}</Button></div>
      {graph?<TimelineGraph session={session} track={tracks.find(t=>t.paramId===selection[0]?.paramId)??tracks[0]!}/>:null}
      <ContextMenuRoot>
        <div className="tl-scroll scroll-area" tabIndex={0} ref={observeScroll} aria-label="Animation tracks" onPointerDown={event=>{
          if (event.button!==0 || event.pointerType==='touch' || !(event.target as HTMLElement).classList.contains('tl-plane')) return
          const rect=event.currentTarget.getBoundingClientRect()
          const x=event.clientX-rect.left+event.currentTarget.scrollLeft, y=event.clientY-rect.top+event.currentTarget.scrollTop
          marqueeBase.current=event.shiftKey?selection:[]
          setMarquee({x,y,endX:x,endY:y});event.currentTarget.setPointerCapture(event.pointerId)
        }} onPointerMove={event=>{
          if (!marquee || !event.currentTarget.hasPointerCapture(event.pointerId)) return
          const box=event.currentTarget.getBoundingClientRect()
          const endX=event.clientX-box.left+event.currentTarget.scrollLeft,endY=event.clientY-box.top+event.currentTarget.scrollTop
          const left=Math.min(marquee.x,endX)-event.currentTarget.scrollLeft+box.left, right=Math.max(marquee.x,endX)-event.currentTarget.scrollLeft+box.left
          const top=Math.min(marquee.y,endY)-event.currentTarget.scrollTop+box.top, bottom=Math.max(marquee.y,endY)-event.currentTarget.scrollTop+box.top
          const refs=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-key-id]')).filter(el=>{const r=el.getBoundingClientRect();return r.left+r.width/2>=left&&r.left+r.width/2<=right&&r.top+r.height/2>=top&&r.top+r.height/2<=bottom}).map(el=>({paramId:el.dataset.trackId!,id:el.dataset.keyId!}))
          setSelection([...new Map([...marqueeBase.current,...refs].map(ref=>[keyOf(ref),ref])).values()]);setMarquee({...marquee,endX,endY})
        }} onPointerUp={()=>setMarquee(null)} onPointerCancel={()=>setMarquee(null)}>
          <div className="tl-content">
            <div className="tl-label tl-ruler-label">Tracks <span>{fps} fps</span></div>
            <ContextTarget className="tl-ruler" touchActions={false} items={event => {
              const time = timeAt(event)
              return [
                { label: 'Move playhead here', onSelect: () => session.setPlayhead(time) },
                { label: 'Set range start here', disabled: time >= (loopRange?.end ?? duration), onSelect: () => session.setLoopRange({ start: time, end: loopRange?.end ?? duration }) },
                { label: 'Set range end here', disabled: time <= (loopRange?.start ?? 0), onSelect: () => session.setLoopRange({ start: loopRange?.start ?? 0, end: time }) },
                { label: 'Use full timeline', disabled: !loopRange, onSelect: () => session.setLoopRange(null) },
                { label: 'Paste keyframes here', disabled: !clipboard.length, onSelect: () => { session.setPlayhead(time); paste() } },
              ]
            }}><div className="tl-plane" role="slider" tabIndex={0} aria-label="Playhead" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={playhead} aria-valuetext={timeText(playhead)}
              onPointerDown={event=>{if(event.button!==0)return;event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);scrub(event)}}
              onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))scrub(event)}}
              onKeyDown={event=>{const delta=event.shiftKey?1:1/fps;if(event.key==='Home'){event.preventDefault();session.setPlayhead(0)}if(event.key==='End'){event.preventDefault();session.setPlayhead(duration)}if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();session.setPlayhead(playhead+(event.key==='ArrowRight'?delta:-delta))}}}>
              {times.map(time=><span className="tl-tick" key={time} style={{left:`${time/duration*100}%`}}>{time}s</span>)}
              {loopRange?<span className="tl-range" style={{left:`${loopRange.start/duration*100}%`,width:`${(loopRange.end-loopRange.start)/duration*100}%`}}><span>In</span><span>Out</span></span>:null}
              <span className="tl-cursor tl-cursor--head" style={{transform:`translateX(${playhead*pixelsPerSecond}px)`}}/>
            </div></ContextTarget>
            {groups.map(group=><Fragment key={group}>
              <ContextTarget className="tl-group-context" touchActions={false} items={[
                { label: 'Select group keyframes', onSelect: () => setSelection(visibleTracks.filter(track => (session.parameters.find(param => param.id === track.paramId)?.group ?? 'animation') === group).flatMap(refsFor)) },
                { label: 'Hide group tracks', onSelect: () => setHidden([...hidden, ...visibleTracks.filter(track => (session.parameters.find(param => param.id === track.paramId)?.group ?? 'animation') === group).map(track => track.paramId)]) },
              ]}><button type="button" className="tl-label tl-group" aria-expanded={!collapsed.includes(group)} onClick={()=>setCollapsed(collapsed.includes(group)?collapsed.filter(id=>id!==group):[...collapsed,group])}><IconChevronRight/><span>{group[0]?.toUpperCase()+group.slice(1)}</span><span>{visibleTracks.filter(track=>session.parameters.find(param=>param.id===track.paramId)?.group===group).length}</span></button></ContextTarget>
              <div className="tl-group-lane"/>
              {!collapsed.includes(group)?visibleTracks.filter(track=>(session.parameters.find(param=>param.id===track.paramId)?.group??'animation')===group).map(track=><Fragment key={track.paramId}>
                <div className="tl-label">
                  <ContextTarget label={`${session.labelFor(track.paramId)} track actions`} items={trackItems(track)} controller={<TimelineController session={session} paramId={track.paramId} time={playhead} />}>
                    <button className="tl-track-name" type="button" onClick={()=>setSelection(track.keyframes.map(frame=>({paramId:track.paramId,id:frame.id!})))}>{session.labelFor(track.paramId)}</button>
                  </ContextTarget>
                  <Tooltip content={`Add ${session.labelFor(track.paramId)} keyframe`}><IconButton label={`Add ${session.labelFor(track.paramId)} keyframe`} onClick={()=>{const ref=session.addKeyframe(track.paramId);if(ref)setSelection([ref])}}><IconPlus/></IconButton></Tooltip>
                </div>
                <ContextTarget className="tl-track" label={`${session.labelFor(track.paramId)} track actions`} touchActions={false} items={event => trackItems(track, timeAt(event))} controller={event => <TimelineController session={session} paramId={track.paramId} time={timeAt(event)} />}><div className="tl-plane" onDoubleClick={event=>{if(event.target!==event.currentTarget)return;const rect=event.currentTarget.getBoundingClientRect();const ref=session.addKeyframe(track.paramId,(event.clientX-rect.left)/rect.width*duration);if(ref)setSelection([ref])}}>
                  <TrackCurve track={track} duration={duration}/>
                  {track.keyframes.map(frame=>{
                    const ref={paramId:track.paramId,id:frame.id!}
                    const picked=selection.some(item=>keyOf(item)===keyOf(ref))
                    const refs = picked ? selection : [ref]
                    return <ContextTarget key={frame.id} className="tl-key-target" label={`${session.labelFor(track.paramId)} keyframe controls`} style={{left:`${frame.time/duration*100}%`}} touchActions={false} onOpen={() => setSelection(refs)} controller={<TimelineController session={session} paramId={track.paramId} time={frame.time} keyId={frame.id} />} items={[
                      { label: 'Go to keyframe', onSelect: () => session.setPlayhead(frame.time) },
                      { label: refs.length > 1 ? 'Copy selected keyframes' : 'Copy keyframe', onSelect: () => copyRefs(refs) },
                      ...EASING.map((option, index) => ({ label: `Easing: ${option.label}`, separatorBefore: index === 0, onSelect: () => changeEasing(refs, option.value as Keyframe['easing']) })),
                      { label: refs.length > 1 ? 'Delete selected keyframes' : 'Delete keyframe', onSelect: () => deleteRefs(refs) },
                    ]}><button type="button" className="tl-key" data-key-id={frame.id} data-track-id={track.paramId}
                      aria-label={`${session.labelFor(track.paramId)} keyframe at ${timeText(frame.time)}, value ${frame.value}`} aria-description="Drag horizontally to move this keyframe. Use the arrow keys for frame changes, hold Shift for ten frames, or right-click for all keyframe actions." aria-pressed={picked}
                      onPointerDown={event=>beginDrag(event,ref,frame.time)}
                      onClick={event=>{if(event.detail===0){select(ref,event.shiftKey);session.setPlayhead(frame.time)}}}
                      onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();session.moveKeyframes(picked?selection:[ref],(event.key==='ArrowRight'?1:-1)*(event.shiftKey?10:1)/fps)}}}>
                      <IconKeyframe/>
                    </button></ContextTarget>
                  })}
                  <span className="tl-cursor" style={{transform:`translateX(${playhead*pixelsPerSecond}px)`}}/>
                </div></ContextTarget>
              </Fragment>):null}
            </Fragment>)}
            {!visibleTracks.length?<div className="tl-empty">{hidden.length?<Button variant="quiet" size="sm" onClick={()=>setHidden([])}>Show hidden tracks</Button>:<p>No animated tracks. Use a numeric control’s actions to add a keyframe.</p>}</div>:null}
            {marquee?<span className="tl-marquee" style={{left:Math.min(marquee.x,marquee.endX),top:Math.min(marquee.y,marquee.endY),width:Math.abs(marquee.endX-marquee.x),height:Math.abs(marquee.endY-marquee.y)}}/>:null}
          </div>
        </div>
      </ContextMenuRoot>
      {active && activeParam?.kind==='number'?<div className="tl-key-editor">
        <span className="tl-selection-name">{session.labelFor(active.paramId)}</span>
        <NumberField variant="field" label="Time" value={active.frame.time} min={0} max={duration} step={1/fps} unit="s" onChange={time=>session.updateKeyframe({paramId:active.paramId,id:active.frame.id!},{time})} onGestureStart={()=>session.beginGesture('Move keyframe')} onGestureEnd={()=>session.endGesture()} onGestureCancel={()=>session.cancelGesture()}/>
        <NumberField variant="field" label="Value" value={active.frame.value} min={activeParam.min} max={activeParam.max} step={activeParam.step} unit={activeParam.unit} onChange={value=>session.updateKeyframe({paramId:active.paramId,id:active.frame.id!},{value})} onGestureStart={()=>session.beginGesture('Edit keyframe value')} onGestureEnd={()=>session.endGesture()} onGestureCancel={()=>session.cancelGesture()}/>
        <SelectField label="Easing" value={active.frame.easing??session.trackFor(active.paramId)?.interpolation??'linear'} options={EASING} onChange={easing=>session.updateKeyframe({paramId:active.paramId,id:active.frame.id!},{easing:easing as Keyframe['easing']})}/>
      </div>:selected.length>1?<div className="tl-key-editor"><span>{selected.length} keyframes selected</span><SelectField label="Easing" value={selected[0]!.frame.easing??'linear'} options={EASING} onChange={easing=>{session.beginGesture('Change keyframe easing');for(const item of selected)session.updateKeyframe({paramId:item.paramId,id:item.frame.id!},{easing:easing as Keyframe['easing']});session.endGesture()}}/><Button size="sm" variant="quiet" onClick={copy}>Copy</Button><Button size="sm" variant="quiet" onClick={remove}>Delete</Button></div>:null}
      <div className="tl-footer"><span>{selected.length?`${selected.length} selected`:'Click a key to edit · Shift-click to select more'}</span><span role="status">{message}</span></div>
    </section>
  )
}

const TrackCurve = memo(function TrackCurve({ track, duration }: { track: AnimTrack; duration: number }) {
  const values=track.keyframes.map(frame=>frame.value)
  const min=Math.min(...values), span=Math.max(...values)-min || 1
  const points=Array.from({length:121},(_,i)=>{const time=i/120*duration;return `${i/120*1000},${26-(interpolateNumber(track,time,duration,false)-min)/span*18}`}).join(' ')
  return <svg className="tl-curve" viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden="true"><polyline points={points}/></svg>
})
