import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Circle, Highlighter, Maximize, MessageSquare, Pencil, Plus, SlidersHorizontal, Square, Trash2, X } from 'lucide-react'
import { WorkspaceShell } from '../shell/WorkspaceShell'
import { listRigs } from '../rigs/registry'
import { updatePrefs } from '../state/workspace'
import { WebToolbar } from './WebToolbar'
import { WebAnnotations } from './WebAnnotations'
import { selectionControls } from './selection'
import { WebControls } from './WebControls'
import { FeedbackReview } from './FeedbackReview'
import { valuesEqual } from '../state/values'
import { ColorField } from '../ui/ColorField'
import { Button, IconButton } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { StatusMessage } from '../ui/StatusMessage'
import { envelope, isEnvelope, isEvent, WEB_PROTOCOL, type Capture, type FeedbackBatch, type HostCommand, type MarkTool, type SDKEvent, type WebContext, type WebProjectManifest, type WebTarget, type WebTicket } from './contracts'
import { listWebProjects, webRigId } from './projects'
import { useWebDocument } from './useWebDocument'
import { ScreenCapture } from './ScreenCapture'
import { captureScreen } from './capture'
import './web.css'

const tools = [
  { id: 'note', label: 'Note', icon: MessageSquare }, { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { id: 'rectangle', label: 'Rectangle', icon: Square }, { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'highlight', label: 'Highlight', icon: Highlighter }, { id: 'pen', label: 'Freehand', icon: Pencil },
] as const
const statusNames = { draft: 'Draft', todo: 'To do', review: 'Ready for review', validated: 'Validated', clarification: 'Needs clarification' }
type Mode = 'browse' | 'select' | 'annotate'

export function WebWorkspace({ rigId }: { rigId: string }) {
  const manifest = listWebProjects().find(p => webRigId(p.id) === rigId)
  if (!manifest) return <main className="web-connect"><h1>Connect this web project</h1><Link to="/web">Open connections</Link></main>
  return <ConnectedWebWorkspace key={manifest.id} initialManifest={manifest} />
}

function ConnectedWebWorkspace({ initialManifest }: { initialManifest: WebProjectManifest }) {
  const sync = useWebDocument(initialManifest)
  const { session, service, setError } = sync
  const doc = session.document
  const manifest = service?.manifest ?? initialManifest
  const [mode, setMode] = useState<Mode>('browse')
  const [tool, setTool] = useState<MarkTool>('note')
  const [pageAnchor, setPageAnchor] = useState(false)
  const [color, setColor] = useState('#df7757')
  const [mobile, setMobile] = useState<'nav' | 'main' | 'inspector'>('main')
  const [panel, setPanel] = useState<'controls' | 'feedback' | 'snapshots'>('controls')
  const [selected, setSelected] = useState<WebTarget[]>([])
  const [resolved, setResolved] = useState<WebTarget[]>([])
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null)
  const [reattachKey, setReattachKey] = useState<string | null>(null)
  const [context, setContext] = useState<WebContext | null>(null)
  const [connection, setConnection] = useState('Connecting to preview')
  const [readyRevision, setReadyRevision] = useState('')
  const [previewMode, setPreviewMode] = useState<'current' | 'reference' | 'source'>('current')
  const [fixedViewport, setFixedViewport] = useState<{ width: number; height: number } | null>(null)
  const [zoom, setZoom] = useState('1')
  const [available, setAvailable] = useState({ width: 960, height: 720 })
  const viewport = fixedViewport ?? { width: Math.max(320, Math.floor(available.width)), height: Math.max(240, Math.floor(available.height)) }
  const scale = zoom === 'fit' ? Math.max(.1, Math.min(1, available.width / viewport.width)) : Number(zoom)
  const [iframeKey, setIframeKey] = useState(0)
  const [previewEpoch, setPreviewEpoch] = useState(0)
  const [pagePath, setPagePath] = useState(initialManifest.pages[0]!.path)
  const [batch, setBatch] = useState<FeedbackBatch | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [screen, setScreen] = useState<{ image: string; ticketId: string } | null>(null)
  const [snapshotName, setSnapshotName] = useState('')
  const [responseNotes, setResponseNotes] = useState<string[]>([])
  const [pendingCapture, setPendingCapture] = useState(false)
  const commentInput = useRef<HTMLTextAreaElement>(null)
  const focusComment = useRef(false)
  const [addingTargets, setAddingTargets] = useState(false)
  const iframe = useRef<HTMLIFrameElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const sessionId = useRef(crypto.randomUUID())
  const lastReady = useRef(0)
  const sdkInstance = useRef('')
  const pendingContext = useRef<WebContext | null>(null)
  const requests = useRef(new Map<string, { ticketId: string; timer: number }>())
  const docRef = useRef(doc); docRef.current = doc
  const handler = useRef<(event: SDKEvent) => void>(() => {})
  const ticket = doc.tickets.find(t => t.id === activeTicketId)
  const targetList = useMemo(() => [...new Map([...doc.tickets.flatMap(t => t.targets), ...selected].map(t => [t.key, t])).values()], [doc.tickets, selected])
  const marks = useMemo(() => doc.tickets.filter(t => t.status !== 'validated').flatMap(t => t.marks), [doc.tickets])
  const send = useCallback((command: HostCommand) => iframe.current?.contentWindow?.postMessage(envelope(sessionId.current, command), manifest.origin), [manifest.origin])
  const run = (fn: () => Promise<unknown>) => { void fn().catch(e => setError(e instanceof Error ? e.message : String(e))) }

  const attachCapture = async (ticketId: string, capture: Capture) => {
    if (capture.dataUrl) {
      try { const result = await sync.upload(capture.id, capture.dataUrl); capture = { ...capture, file: result.file, dataUrl: undefined } }
      catch { capture.note += ' Saved in browser; reconnect before validating.' }
    }
    session.attachCapture(ticketId, capture)
  }
  const captureDOM = (ticketId: string) => {
    const id = crypto.randomUUID()
    const timer = window.setTimeout(() => {
      requests.current.delete(id); setPendingCapture(false)
      void attachCapture(ticketId, { id, kind: 'dom', status: 'failed', createdAt: new Date().toISOString(), note: 'DOM capture timed out. The feedback is preserved; try screen capture.' })
    }, 15000)
    requests.current.set(id, { ticketId, timer }); setPendingCapture(true); send({ type: 'capture', requestId: id })
  }
  const newTicket = (targets = selected): string | null => {
    if (!context) return null
    const id = session.addTicket(context, targets)
    updatePrefs({ inspectorCollapsed: false }); focusComment.current = true; setActiveTicketId(id); setPanel('feedback'); setMobile('inspector'); setMode('select'); setAddingTargets(false)
    captureDOM(id); return id
  }

  handler.current = (event: SDKEvent) => {
    if (event.type === 'ready') {
      if (event.manifest.id !== manifest.id || event.manifest.origin !== manifest.origin) return
      if (sdkInstance.current !== event.instanceId) { sdkInstance.current = event.instanceId; setPreviewEpoch(n => n + 1) }
      lastReady.current = Date.now(); setReadyRevision(event.manifest.revision); setContext(event.context)
      if (event.manifest.revision !== manifest.revision) { setConnection('Waiting for matching source revision'); return }
      setConnection('Connected'); session.replaceSource(event.manifest, event.sourceValues)
      if (pendingContext.current?.pageId === event.context.pageId) { send({ type: 'restore-context', context: pendingContext.current }); pendingContext.current = null }
    } else if (event.type === 'scene') { setContext(event.context); setResolved(event.targets) }
    else if (event.type === 'selection') {
      if (reattachKey && ticket) {
        const previous = ticket.targets.find(t => t.key === reattachKey)
        session.editTicket(ticket.id, t => {
          t.targets = [...t.targets.filter(old => old.key !== reattachKey), event.target]
          t.marks = t.marks.map(m => m.targetKey === reattachKey ? { ...m, targetKey: event.target.key, pageId: event.target.pageId } : m)
          if (previous?.pageId !== event.target.pageId && context) t.context = context
          t.status = 'draft'; delete t.batchId
        }, 'Reattach feedback')
        setReattachKey(null)
      }
      if (!reattachKey && !addingTargets) { setPanel('controls'); setActiveTicketId(null) }
      if (addingTargets && ticket) session.editTicket(ticket.id, t => { t.targets = [...new Map([...t.targets, event.target].map(target => [target.key, target])).values()]; t.status = 'draft'; delete t.batchId }, 'Add feedback target')
      setSelected(prev => event.additive ? [...new Map([...prev, event.target].map(t => [t.key, t])).values()] : [event.target])
    } else if (event.type === 'mark') {
      session.begin('Draw annotation')
      let id = docRef.current.tickets.find(t => t.marks.some(m => m.id === event.mark.id))?.id ?? activeTicketId
      if (!id || docRef.current.tickets.find(t => t.id === id)?.status === 'validated') {
        id = session.addTicket(event.context, event.target ? [event.target] : []); setActiveTicketId(id); captureDOM(id)
      }
      session.addMark(id, event.mark, event.target); session.end(); setActiveTicketId(id); setPanel('feedback')
      if (event.mark.tool === 'note') { focusComment.current = true; setMode('select'); setMobile('inspector') }
    } else if (event.type === 'capture') {
      const request = requests.current.get(event.requestId); if (!request) return
      clearTimeout(request.timer); requests.current.delete(event.requestId); setPendingCapture(false)
      void attachCapture(request.ticketId, { id: event.requestId, kind: 'dom', createdAt: new Date().toISOString(), status: event.dataUrl ? 'ready' : 'failed', dataUrl: event.dataUrl, note: event.error ? `DOM reconstruction failed: ${event.error}` : 'DOM reconstruction. Effects, external resources and live media may differ from the screen.' })
    } else if (event.type === 'exit-tool') { setMode('browse'); setAddingTargets(false); setReattachKey(null) }
    else if (event.type === 'comment') { newTicket([event.target]) }
    else if (event.type === 'error') setError(event.message)
    else if (event.type === 'history') session[event.direction]()
  }

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== manifest.origin || !isEnvelope(event.data) || event.data.sessionId !== sessionId.current) return
      if (event.data.version !== WEB_PROTOCOL) { setConnection('Incompatible preview protocol'); return }
      if (isEvent(event.data.payload)) handler.current(event.data.payload as SDKEvent)
    }
    window.addEventListener('message', receive)
    const hello = () => {
      send({ type: 'hello', projectId: manifest.id })
      if (lastReady.current && Date.now() - lastReady.current > 6500) setConnection('Preview connection interrupted')
    }
    hello(); const interval = window.setInterval(hello, 2000)
    const timeout = window.setTimeout(() => { if (!lastReady.current) setConnection('Preview unavailable or SDK missing. Check the page URL and frame permissions.') }, 8000)
    const captures = requests.current
    return () => { window.removeEventListener('message', receive); clearInterval(interval); clearTimeout(timeout); captures.forEach(r => clearTimeout(r.timer)); captures.clear() }
  }, [manifest.id, manifest.origin, send, iframeKey])

  useEffect(() => { send({ type: 'configure', mode, tool, color, targets: targetList, marks, activeTarget: pageAnchor ? undefined : selected[0]?.key ?? ticket?.targets[0]?.key, activeTargets: panel === 'feedback' && ticket ? ticket.targets.map(t => t.key) : selected.map(t => t.key), displayScale: scale }) }, [send, mode, tool, color, targetList, marks, selected, connection, iframeKey, readyRevision, previewEpoch, scale, panel, ticket, pageAnchor])
  useEffect(() => { send({ type: 'values', values: previewMode === 'reference' ? doc.sourceValues : doc.values, source: previewMode === 'source' }) }, [send, doc.values, doc.sourceValues, previewMode, connection, iframeKey, readyRevision, previewEpoch])
  useEffect(() => {
    const observer = new ResizeObserver(entries => { const r = entries[0]?.contentRect; if (r) setAvailable({ width: r.width, height: r.height }) })
    if (stage.current) observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (focusComment.current && panel === 'feedback' && ticket) { commentInput.current?.focus(); focusComment.current = false }
  }, [panel, ticket, mobile])
  useEffect(() => {
    if (selected[0]) send({ type: 'reveal-target', target: selected[0] })
    // Keep the selected element in view after a responsive layout change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target as Element)?.closest('input,textarea,[contenteditable=true],[role=dialog],[role=menu]')) { setMode('browse'); setAddingTargets(false); setReattachKey(null) }
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || !['z', 'y'].includes(event.key.toLowerCase()) || (event.target as Element)?.closest('input,textarea,[contenteditable=true]')) return
      event.preventDefault(); if (event.shiftKey || event.key.toLowerCase() === 'y') session.redo(); else session.undo()
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [session])
  useEffect(() => {
    const notes: string[] = []
    if (service && service.manifest.revision !== doc.sourceRevision) { setResponseNotes([]); return }
    for (const response of service?.responses ?? []) {
      const sourceBatch = service?.batches.find(b => b.id === response.batchId)
      if (!sourceBatch) { notes.push('An agent response has no matching feedback batch.'); continue }
      const note = session.response(response, sourceBatch)
      if (note) notes.push(note)
    }
    setResponseNotes([...new Set(notes)])
  }, [service, session, doc.sourceRevision])

  const liveTargets = targetList.map(t => resolved.find(r => r.key === t.key) ?? t)
  const currentSelection = selected.filter(target => target.pageId === context?.pageId)
  const boundParams = selectionControls(manifest, currentSelection, context?.pageId)
  const selection = liveTargets.find(target => target.key === currentSelection[0]?.key)
  const selectTarget = (t: WebTarget) => { setSelected([t]); send({ type: 'select', target: t }) }
  const openTicket = (t: WebTicket, restore = true) => {
    updatePrefs({ inspectorCollapsed: false }); setActiveTicketId(t.id); setPanel('feedback'); setMode('select'); setMobile('inspector'); setAddingTargets(false)
    if (t.status === 'review') setPreviewMode('source')
    const page = manifest.pages.find(p => p.id === t.context.pageId)
    setSelected(t.targets)
    if (!restore) return
    setFixedViewport({ width: t.context.viewport.width, height: t.context.viewport.height })
    if (page && context?.pageId !== page.id) { pendingContext.current = t.context; setPagePath(page.path); setIframeKey(n => n + 1); setConnection('Connecting to preview') }
    else send({ type: 'restore-context', context: t.context })
  }
  const prepare = () => {
    updatePrefs({ inspectorCollapsed: false }); setPanel('feedback'); setMobile('inspector')
    setBatch(session.batch(doc.tickets.filter(t => t.status === 'draft').map(t => t.id)))
  }
  const changeCount = doc.tickets.filter(t => t.status === 'draft').length + Object.keys(doc.values).filter(id => !valuesEqual(doc.values[id]!, doc.sourceValues[id]!)).length
  const hasFeedback = changeCount > 0
  const commentsCount = doc.tickets.filter(t => t.status !== 'validated').length
  const projectControls = () => { setSelected([]); setPanel('controls'); setActiveTicketId(null); setAddingTargets(false) }
  const startNote = () => { setActiveTicketId(null); setSelected([]); setMode('annotate'); setTool('note'); setMobile('main'); setPanel('feedback') }
  const closeInspector = () => { if (innerWidth < 1024) setMobile('main'); else updatePrefs({ inspectorCollapsed: true }) }
  const chooseAncestor = (ancestor: WebTarget['ancestors'][number]) => { if (selection) selectTarget({ ...selection, ...ancestor, ancestors: [], stable: ancestor.stable }) }
  const publish = async (approved: FeedbackBatch) => {
    if (!batch || readyRevision !== manifest.revision) return
    setPublishing(true)
    try {
      const ready = structuredClone(approved)
      for (const t of ready.tickets) for (const c of t.captures) if (c.dataUrl) { const result = await sync.upload(c.id, c.dataUrl); c.file = result.file; delete c.dataUrl }
      await sync.publish(ready); setBatch(null)
    } finally { setPublishing(false) }
  }

  return <WorkspaceShell rigs={listRigs()} activeId={webRigId(manifest.id)} mobilePanel={mobile} onMobilePanel={next => { setMobile(next); if (next === 'inspector') updatePrefs({ inspectorCollapsed: false }) }} mainLabel="Page" hideNavigation inspector={
    <aside className="inspector web-inspector" aria-label="Web inspector">
      <div className="inspector__head web-inspector-head">
        <strong>{batch ? 'Review changes' : screen ? 'Screen capture' : panel === 'snapshots' ? 'Snapshots' : panel === 'feedback' ? ticket ? `Comment ${doc.tickets.indexOf(ticket) + 1}` : 'Comments' : selection?.label ?? 'Project controls'}</strong>
        <div className="web-actions">
          {!batch && !screen ? <>
            <Tooltip content="Project controls"><IconButton label="Project controls" aria-pressed={panel === 'controls' && !selection} onClick={projectControls}><SlidersHorizontal size={16} /></IconButton></Tooltip>
            <Tooltip content="Comments"><IconButton label={`Comments${commentsCount ? ` (${commentsCount})` : ''}`} aria-pressed={panel === 'feedback'} onClick={() => { setPanel('feedback'); setActiveTicketId(null); setAddingTargets(false) }}><MessageSquare size={16} />{commentsCount ? <span className="web-icon-count">{commentsCount}</span> : null}</IconButton></Tooltip>
          </> : null}
          <Tooltip content="Hide inspector"><IconButton label="Hide inspector" onClick={closeInspector}><X size={15} /></IconButton></Tooltip>
        </div>
      </div>
      <div className="inspector__body web-inspector__body scroll-area" tabIndex={0} role="region" id={`web-panel-${panel}`} aria-label={batch ? 'Feedback review' : screen ? 'Screen capture' : panel}>
        {sync.error && !sync.recovered ? <StatusMessage tone="error">{sync.error}</StatusMessage> : null}
        {sync.recovered ? <section className="web-section"><h2>Draft changed elsewhere</h2><p>Which version should stay open?</p><Button variant="ghost" onClick={() => run(() => sync.chooseRecovery(true))}>Keep browser draft</Button><Button variant="quiet" onClick={() => run(() => sync.chooseRecovery(false))}>Use project draft</Button></section> : null}
        {responseNotes.map(n => <StatusMessage key={n}>{n}</StatusMessage>)}
        {doc.conflicts.map(c => <section className="web-section" key={c.id}><h2>{manifest.parameters.find(p => p.id === c.id)?.label ?? c.id}</h2><p>{c.removed ? 'Control removed.' : 'This value changed in the project.'}</p><code>Your choice: {JSON.stringify(c.chosen)}</code>{!c.removed ? <><code>Source: {JSON.stringify(c.source)}</code><Button variant="ghost" onClick={() => session.resolveConflict(c.id, true)}>Keep my value</Button></> : null}<Button variant="quiet" onClick={() => session.resolveConflict(c.id, false)}>{c.removed ? 'Acknowledge removal' : 'Use source value'}</Button></section>)}
        {batch ? <FeedbackReview key={batch.id} batch={batch} publishing={publishing} disabled={pendingCapture || !!sync.recovered || doc.conflicts.length > 0 || readyRevision !== manifest.revision} onPublish={approved => run(() => publish(approved))} onBack={() => setBatch(null)} /> : null}
        {screen ? <ScreenCapture image={screen.image} onCancel={() => setScreen(null)} onSave={async image => { await attachCapture(screen.ticketId, { id: crypto.randomUUID(), kind: 'screen', createdAt: new Date().toISOString(), status: 'ready', dataUrl: image, note: 'Screen capture, cropped and approved by the user.' }); setScreen(null) }} /> : null}
        {!batch && !screen && panel === 'controls' ? <>
          {selection ? <section className="web-section web-selection">
            <div className="web-ancestors">
              {selection.ancestors.filter(ancestor => ancestor.stable || !['div', 'body', 'html'].includes(ancestor.label)).slice(0, 2).map(ancestor => <button key={ancestor.key} type="button" onClick={() => chooseAncestor(ancestor)}>{ancestor.label}</button>)}
              {selection.ancestors.length ? <Menu.Root modal={false}><Menu.Trigger asChild><button type="button" aria-label="Element hierarchy"><ChevronDown size={13} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="menu" align="start" sideOffset={8} collisionPadding={8} aria-label="Element hierarchy">{selection.ancestors.map(ancestor => <Menu.Item key={ancestor.key} className="menu__item" onSelect={() => chooseAncestor(ancestor)}>{ancestor.label}</Menu.Item>)}</Menu.Content></Menu.Portal></Menu.Root> : null}
            </div>
            {mode !== 'select' ? <Button variant="ghost" size="sm" onClick={() => newTicket(currentSelection)}><MessageSquare size={14} />Comment</Button> : null}
          </section> : null}
          <WebControls session={session} controls={boundParams} values={previewMode === 'current' ? doc.values : doc.sourceValues} disabled={previewMode !== 'current'} />
          {!boundParams.length && !selection ? <StatusMessage>No controls on this page.</StatusMessage> : null}
        </> : null}
        {!batch && !screen && panel === 'feedback' ? <>
          <div className="web-actions">{ticket ? <Button size="sm" variant="quiet" onClick={() => { setActiveTicketId(null); setAddingTargets(false); setMode('select') }}><ChevronLeft size={14} />Comments</Button> : <Button variant="ghost" onClick={startNote} disabled={!context}><Plus size={14} />Comment on page</Button>}</div>
          {ticket || !doc.tickets.length ? null : <div className="web-ticket-list">{doc.tickets.map(t => <button type="button" aria-pressed={activeTicketId === t.id} key={t.id} onClick={() => openTicket(t)}><span><span className="web-list-number">{doc.tickets.indexOf(t) + 1}</span>{t.comment || t.targets[0]?.label || 'Visual feedback'}</span><small>{statusNames[t.status]}</small></button>)}</div>}
          {ticket ? <section className="web-section web-ticket-editor"><div className="web-section__head"><span className="web-scope">{statusNames[ticket.status]}</span><Tooltip content="Remove ticket"><IconButton label="Remove ticket" onClick={() => { session.change('Remove feedback', d => { d.tickets = d.tickets.filter(t => t.id !== ticket.id) }); setActiveTicketId(null) }}><Trash2 size={14} /></IconButton></Tooltip></div><label className="web-label"><span className="visually-hidden">Comment</span><textarea ref={commentInput} aria-label="Comment" value={ticket.comment} maxLength={20000} placeholder="What should change?" onFocus={() => session.begin('Edit comment')} onBlur={() => session.end()} onChange={e => session.editTicket(ticket.id, t => { t.comment = e.target.value; if (t.status !== 'draft') { t.status = 'draft'; delete t.batchId } })} /></label>
            <div className="web-actions">
              <Button variant="ghost" size="sm" aria-pressed={mode === 'annotate'} onClick={() => { setMode(mode === 'annotate' ? 'select' : 'annotate'); setTool('arrow'); setPageAnchor(false); setMobile('main'); setAddingTargets(false) }}><Pencil size={14} />Draw</Button>
              <Button variant="quiet" size="sm" aria-pressed={addingTargets} onClick={() => { setAddingTargets(!addingTargets); setMode('select'); setMobile('main') }}><Plus size={14} />{addingTargets ? 'Done selecting' : 'Add target'}</Button>
            </div>
            {ticket.targets.map(t => { const live = liveTargets.find(v => v.key === t.key) ?? t; return <div key={t.key} className="web-target-row"><button type="button" onClick={() => { setSelected([t]); send({ type: 'reveal-target', target: t }) }}>{t.label}{live.status !== 'resolved' ? <small>{live.status}</small> : null}</button>{live.status !== 'resolved' ? <Button variant="quiet" size="sm" onClick={() => { setReattachKey(t.key); setMode('select') }}>Reattach</Button> : null}</div> })}
            {reattachKey ? <p className="status-msg" role="status">Click the replacement element in the page. <button type="button" className="web-inline" onClick={() => setReattachKey(null)}>Cancel</button></p> : null}
            {ticket.marks.some(mark => mark.tool !== 'note') ? <details className="web-disclosure"><summary>Marks<span>{ticket.marks.filter(mark => mark.tool !== 'note').length}</span></summary>{ticket.marks.filter(mark => mark.tool !== 'note').map(mark => <div className="web-mark-row" key={mark.id}><span>{tools.find(tool => tool.id === mark.tool)?.label}</span><Button size="sm" variant="quiet" onClick={() => session.editTicket(ticket.id, t => { t.marks = t.marks.filter(item => item.id !== mark.id); t.status = 'draft'; delete t.batchId }, 'Remove annotation')}>Remove</Button></div>)}</details> : null}
            {ticket.status === 'review' && ticket.responseRevision !== doc.sourceRevision ? <StatusMessage>This correction belongs to an earlier source revision. Reopen it for a fresh review.</StatusMessage> : null}
            {ticket.response ? <blockquote className="web-response">{ticket.response}</blockquote> : null}
            <details className="web-disclosure"><summary>Captures{ticket.captures.length ? <span> {ticket.captures.length}</span> : null}</summary>
              <div className="web-actions"><Button variant="quiet" disabled={pendingCapture} onClick={() => captureDOM(ticket.id)}>Capture page</Button><Button variant="quiet" onClick={() => run(async () => setScreen({ image: await captureScreen(), ticketId: ticket.id }))}>Capture screen</Button></div>
              {pendingCapture ? <p role="status">Capturing…</p> : null}
              {ticket.captures.map(c => <figure className="web-capture" key={c.id}>{c.status === 'ready' && (c.file || c.dataUrl) ? <a href={c.dataUrl ?? `/api/web/${c.file}`} target="_blank" rel="noreferrer" aria-label="Open capture in a new tab"><img alt={c.kind === 'screen' ? 'Screen capture' : 'HTML reconstruction'} src={c.dataUrl ?? `/api/web/${c.file}`} /></a> : null}<figcaption>{c.status === 'ready' ? <Tooltip content={c.note}><span tabIndex={0}>{c.kind === 'screen' ? 'Screen capture' : 'HTML reconstruction'}</span></Tooltip> : c.note}</figcaption></figure>)}
            </details>
            <div className="web-actions">{ticket.status === 'review' && previewMode !== 'source' ? <Button variant="ghost" onClick={() => setPreviewMode('source')}>View correction</Button> : ticket.status === 'review' ? <><Button disabled={previewMode !== 'source' || readyRevision !== doc.sourceRevision || ticket.responseRevision !== doc.sourceRevision} onClick={() => session.editTicket(ticket.id, t => { t.status = 'validated' }, 'Validate correction')}>Validate correction</Button></> : null}{ticket.status !== 'draft' ? <Button variant="quiet" onClick={() => session.editTicket(ticket.id, t => { t.status = 'draft'; delete t.batchId }, 'Reopen feedback')}>Reopen</Button> : null}</div>
          <div className="web-ticket-navigation"><Button size="sm" variant="quiet" disabled={doc.tickets.indexOf(ticket) === 0} onClick={() => openTicket(doc.tickets[doc.tickets.indexOf(ticket) - 1]!)}><ChevronLeft size={14} />Previous</Button><Button size="sm" variant="quiet" disabled={doc.tickets.indexOf(ticket) === doc.tickets.length - 1} onClick={() => openTicket(doc.tickets[doc.tickets.indexOf(ticket) + 1]!)}>Next<ChevronRight size={14} /></Button></div>
          </section> : null}
        </> : null}
        {!batch && !screen && panel === 'snapshots' ? <section className="web-section"><label className="web-label">Snapshot name<input value={snapshotName} onChange={e => setSnapshotName(e.target.value)} placeholder="Name" /></label><Button variant="ghost" onClick={() => { session.snapshot(snapshotName.trim() || `Variation ${doc.snapshots.length + 1}`); setSnapshotName('') }}>Save snapshot</Button>{doc.snapshots.map(s => <div className="web-target-row" key={s.id}><span>{s.name}{s.revision !== doc.sourceRevision ? <small>Earlier revision</small> : null}</span><Button size="sm" variant="quiet" disabled={s.revision !== doc.sourceRevision} onClick={() => session.restoreSnapshot(s.id)}>Restore</Button><Button size="sm" variant="quiet" onClick={() => session.change('Remove snapshot', d => { d.snapshots = d.snapshots.filter(v => v.id !== s.id) })}>Remove</Button></div>)}</section> : null}
      </div>
    </aside>
  }>
    <h1 className="visually-hidden">{manifest.name} web workspace</h1>
    <WebToolbar manifest={manifest} pageId={context?.pageId ?? manifest.pages[0]!.id}
      onPage={id => { const page = manifest.pages.find(page => page.id === id); if (page) { setPagePath(page.path); setSelected([]); setConnection('Connecting to preview') } }}
      mode={mode} onMode={next => { setMode(next); setAddingTargets(false); setReattachKey(null) }} viewport={viewport} fluid={!fixedViewport}
      onViewport={size => { setFixedViewport(size); if (!size) setZoom('1') }} zoom={zoom} onZoom={setZoom}
      previewMode={previewMode} onPreviewMode={setPreviewMode} undoLabel={session.undoLabel} redoLabel={session.redoLabel} onUndo={() => session.undo()} onRedo={() => session.redo()}
      onSnapshots={() => { updatePrefs({ inspectorCollapsed: false }); setPanel('snapshots'); setMobile('inspector') }}
      onReload={() => { lastReady.current = 0; setIframeKey(n => n + 1); sync.reconnect(); setConnection('Connecting to preview') }}
      status={connection === 'Connected' ? sync.syncStatus : connection} connected={connection === 'Connected' && sync.syncStatus === 'Saved to project'}
      changeCount={changeCount} reviewDisabled={!context || pendingCapture || !hasFeedback || !!batch || !!screen} onReview={prepare} />
    <div className="web-preview-area">
      <div ref={stage} className="web-preview-stage" id="main" tabIndex={-1} data-mode={mode} data-fluid={!fixedViewport}>
        <div className="web-preview-size" style={{ width: viewport.width * scale, height: viewport.height * scale }}>
          <iframe key={iframeKey} ref={iframe} title={`${manifest.name} live preview`} src={new URL(pagePath, manifest.origin).href} width={viewport.width} height={viewport.height} style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" onLoad={() => { lastReady.current = 0; send({ type: 'hello', projectId: manifest.id }) }} />
          <WebAnnotations tickets={doc.tickets} targets={liveTargets} selected={selection} context={context} viewport={viewport} scale={scale} activeId={activeTicketId} canComment={mode === 'select' && panel === 'controls' && !batch} onComment={() => newTicket(currentSelection)} onOpen={ticket => openTicket(ticket, false)} />
        </div>
      </div>
      {mode === 'annotate' ? <div className="web-markup-toolbar" role="group" aria-label="Markup tools">
        {tools.map(t => <Tooltip key={t.id} content={t.label}><IconButton label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}><t.icon size={16} /></IconButton></Tooltip>)}
        <Tooltip content="Draw on page"><IconButton label="Draw on page" aria-pressed={pageAnchor} onClick={() => setPageAnchor(!pageAnchor)}><Maximize size={16} /></IconButton></Tooltip>
        <ColorField label="Color" value={color} onChange={setColor} />
        <Tooltip content="Finish drawing"><IconButton label="Finish drawing" onClick={() => setMode('select')}><X size={16} /></IconButton></Tooltip>
      </div> : null}
      {addingTargets ? <div className="web-context-action"><Button variant="ghost" size="sm" onClick={() => { setAddingTargets(false); setMobile('inspector') }}>Done selecting</Button></div> : null}
      {previewMode !== 'current' ? <div className="web-context-action"><Button variant="ghost" size="sm" onClick={() => setPreviewMode('current')}>{previewMode === 'source' ? 'Source result' : 'Reference'}<X size={14} /><span className="visually-hidden">Resume editing</span></Button></div> : null}
      {connection !== 'Connected' ? <div className="web-connection-notice" role="status">{connection}</div> : null}
    </div>
  </WorkspaceShell>
}
