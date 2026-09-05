import { normalizeValue } from '../state/parameter-values'
import { valuesEqual } from '../state/values'
import type { ParamValue } from '../rigs/types'
import type { AgentResponse, Capture, FeedbackBatch, Values, WebContext, WebDraft, WebMark, WebProjectManifest, WebTarget, WebTicket } from './contracts'

function sameValue(manifest: WebProjectManifest, id: string, a: ParamValue | undefined, b: ParamValue | undefined) {
  return manifest.parameters.find(p => p.id === id)?.kind === 'color' && typeof a === 'string' && typeof b === 'string'
    ? a.toLowerCase() === b.toLowerCase() : valuesEqual(a as ParamValue, b as ParamValue)
}

export function newDraft(manifest: WebProjectManifest): WebDraft {
  const values = Object.fromEntries(manifest.parameters.map(p => [p.id, structuredClone(p.defaultValue)]))
  return { version: 1, projectId: manifest.id, sourceRevision: manifest.revision, sourceValues: values, values: structuredClone(values), tickets: [], snapshots: [], conflicts: [], handledResponses: [] }
}
export function reconcile(draft: WebDraft, manifest: WebProjectManifest, source: Values): WebDraft {
  const next = structuredClone(draft)
  const conflicts = [...next.conflicts]
  next.conflicts = []
  const ids = new Set(manifest.parameters.map(p => p.id))
  for (const [id, chosen] of Object.entries({ ...Object.fromEntries(conflicts.map(c => [c.id, c.chosen])), ...draft.values })) {
    const old = draft.sourceValues[id]
    const now = source[id]
    const prior = conflicts.find(c => c.id === id)
    if (sameValue(manifest, id, prior?.chosen ?? chosen, now)) { next.values[id] = now!; continue }
    if (sameValue(manifest, id, chosen, old) && !prior) { if (ids.has(id)) next.values[id] = now!; else delete next.values[id]; continue }
    if (!ids.has(id)) {
      next.conflicts.push({ id, before: prior?.before ?? old, chosen: prior?.chosen ?? chosen, removed: true }); delete next.values[id]
    } else if (!sameValue(manifest, id, old, now) || prior) {
      next.conflicts.push({ id, before: prior?.before ?? old, chosen: prior?.chosen ?? chosen, source: now, removed: false }); next.values[id] = now!
    }
  }
  for (const prior of conflicts.filter(c => c.removed && !ids.has(c.id))) if (!next.conflicts.some(c => c.id === prior.id)) next.conflicts.push(prior)
  for (const p of manifest.parameters) next.values[p.id] = normalizeValue(p, next.values[p.id] ?? source[p.id])
  next.sourceRevision = manifest.revision; next.sourceValues = structuredClone(source)
  return next
}

export class WebSession {
  document: WebDraft
  manifest: WebProjectManifest
  private listeners = new Set<() => void>()
  private revision = 0
  private past: { label: string; document: WebDraft }[] = []
  private future: { label: string; document: WebDraft }[] = []
  private gesture: { label: string; document: WebDraft } | null = null
  constructor(manifest: WebProjectManifest, draft?: WebDraft | null) { this.manifest = manifest; this.document = draft ? structuredClone(draft) : newDraft(manifest) }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getRevision = () => this.revision
  get undoLabel() { return this.past.at(-1)?.label }
  get redoLabel() { return this.future.at(-1)?.label }
  get isGesturing() { return !!this.gesture }
  private emit() { this.revision++; this.listeners.forEach(fn => fn()) }
  private push(label: string, before: WebDraft) { this.past = [...this.past.slice(-59), { label, document: before }]; this.future = [] }
  change(label: string, update: (draft: WebDraft) => void) {
    const before = this.document
    const next = structuredClone(before); update(next)
    if (JSON.stringify(before) === JSON.stringify(next)) return
    if (!this.gesture) this.push(label, before)
    this.document = next; this.emit()
  }
  begin(label: string) { if (!this.gesture) this.gesture = { label, document: this.document } }
  end() { if (!this.gesture) return; const before = this.gesture; this.gesture = null; if (JSON.stringify(before.document) !== JSON.stringify(this.document)) this.push(before.label, before.document); this.emit() }
  cancel() { if (!this.gesture) return; this.document = this.gesture.document; this.gesture = null; this.emit() }
  undo() { this.cancel(); const entry = this.past.pop(); if (!entry) return; this.future.push({ label: entry.label, document: this.document }); this.document = entry.document; this.emit() }
  redo() { this.cancel(); const entry = this.future.pop(); if (!entry) return; this.past.push({ label: entry.label, document: this.document }); this.document = entry.document; this.emit() }
  setValue(id: string, value: ParamValue) {
    const param = this.manifest.parameters.find(p => p.id === id); if (!param) return
    this.change(`Adjust ${param.label}`, d => { d.values[id] = normalizeValue(param, param.kind === 'color' && typeof value === 'string' ? value.toLowerCase() : value) })
  }
  reset(id?: string) { this.change('Reset controls', d => { if (id) d.values[id] = structuredClone(d.sourceValues[id]!); else d.values = structuredClone(d.sourceValues) }) }
  action(id: string) {
    const p = this.manifest.parameters.find(p => p.id === id)
    if (p?.kind !== 'action') return
    this.begin(p.label)
    if (p.action === 'trigger') this.setValue(id, Number(this.document.values[id] ?? 0) + 1)
    if (p.action === 'set') for (const [key, value] of Object.entries(p.values ?? {})) this.setValue(key, value)
    if (p.action === 'reset') for (const key of p.targets ?? this.manifest.parameters.filter(p => p.kind !== 'action').map(p => p.id)) this.reset(key)
    if (p.action === 'randomize') for (const target of this.manifest.parameters) if (target.kind === 'number' && p.targets?.includes(target.id)) this.setValue(target.id, target.min + Math.floor(Math.random() * ((target.max - target.min) / target.step + 1)) * target.step)
    this.end()
  }
  snapshot(name: string) { this.change('Save snapshot', d => { d.snapshots.push({ id: crypto.randomUUID(), name, revision: d.sourceRevision, values: structuredClone(d.values) }) }) }
  restoreSnapshot(id: string) {
    const snap = this.document.snapshots.find(s => s.id === id && s.revision === this.document.sourceRevision)
    if (snap) this.change(`Restore ${snap.name}`, d => { d.values = structuredClone(snap.values) })
  }
  replaceSource(manifest: WebProjectManifest, source: Values) {
    if (manifest.revision === this.document.sourceRevision && JSON.stringify(source) === JSON.stringify(this.document.sourceValues)) { this.manifest = manifest; return }
    this.end(); this.manifest = manifest
    const next = reconcile(this.document, manifest, source)
    if (JSON.stringify(next) === JSON.stringify(this.document)) return
    this.document = next; this.past = []; this.future = []; this.emit()
  }
  recover(document: WebDraft) { this.cancel(); this.document = structuredClone(document); this.past = []; this.future = []; this.emit() }
  resolveConflict(id: string, keep: boolean) {
    this.change('Resolve source change', d => { const conflict = d.conflicts.find(c => c.id === id); if (keep && conflict && !conflict.removed) d.values[id] = conflict.chosen; d.conflicts = d.conflicts.filter(c => c.id !== id) })
  }
  addTicket(context: WebContext, targets: WebTarget[] = []): string {
    const id = crypto.randomUUID()
    this.change('Add feedback', d => { d.tickets.push({ id, comment: '', status: 'draft', revision: d.sourceRevision, createdAt: new Date().toISOString(), context: structuredClone(context), targets: structuredClone(targets), marks: [], captures: [] }) })
    return id
  }
  editTicket(id: string, update: (ticket: WebTicket) => void, label = 'Edit feedback') { this.change(label, d => { const t = d.tickets.find(t => t.id === id); if (t) update(t) }) }
  attachCapture(id: string, capture: Capture) {
    // Async evidence must not insert an unrelated step ahead of the user's last gesture.
    const attach = (document: WebDraft) => {
      const next = structuredClone(document); const ticket = next.tickets.find(t => t.id === id)
      if (ticket && !ticket.captures.some(c => c.id === capture.id)) ticket.captures.push(structuredClone(capture))
      return next
    }
    this.document = attach(this.document)
    this.past = this.past.map(p => ({ ...p, document: attach(p.document) }))
    this.future = this.future.map(p => ({ ...p, document: attach(p.document) }))
    if (this.gesture) this.gesture.document = attach(this.gesture.document)
    this.emit()
  }
  addMark(id: string, mark: WebMark, target?: WebTarget) {
    this.editTicket(id, t => { t.marks = [...t.marks.filter(m => m.id !== mark.id), mark]; if (target && !t.targets.some(v => v.key === target.key)) t.targets.push(target); if (t.batchId) { t.status = 'draft'; delete t.batchId } }, 'Draw annotation')
  }
  batch(ticketIds: string[]): FeedbackBatch {
    const d = this.document
    return { version: 1, id: crypto.randomUUID(), projectId: d.projectId, sourceRevision: d.sourceRevision, createdAt: new Date().toISOString(), values: structuredClone(d.values),
      changes: this.manifest.parameters.filter(p => !sameValue(this.manifest, p.id, d.values[p.id], d.sourceValues[p.id])).map(p => ({ paramId: p.id, label: p.label, before: d.sourceValues[p.id]!, after: d.values[p.id]!, bindings: this.manifest.bindings.filter(b => b.paramId === p.id) })),
      tickets: structuredClone(d.tickets.filter(t => ticketIds.includes(t.id))).map(t => ({ ...t, status: 'todo' })) }
  }
  markPublished(batch: FeedbackBatch) {
    // Publication cannot be undone: the agent can already have read this immutable batch.
    this.cancel(); this.document = structuredClone(this.document)
    for (const t of this.document.tickets) {
      const published = batch.tickets.find(b => b.id === t.id)
      if (published && JSON.stringify([t.comment, t.marks, t.targets]) === JSON.stringify([published.comment, published.marks, published.targets])) { t.status = 'todo'; t.batchId = batch.id; t.captures = published.captures }
    }
    this.past = []; this.future = []; this.emit()
  }
  response(response: AgentResponse, batch: FeedbackBatch): string | null {
    if (this.document.handledResponses.includes(response.id)) return null
    if (response.projectId !== this.manifest.id || response.batchId !== batch.id || response.sourceRevision !== batch.sourceRevision) return 'This response does not match its feedback batch.'
    if (response.resultRevision !== this.document.sourceRevision) return 'This response belongs to another source revision.'
    if (response.tickets.some(r => !batch.tickets.some(t => t.id === r.id))) return 'This response names a ticket outside its feedback batch.'
    this.document = structuredClone(this.document)
    for (const reply of response.tickets) {
      const t = this.document.tickets.find(t => t.id === reply.id && t.batchId === response.batchId && t.status !== 'validated')
      if (t) { t.status = reply.status === 'implemented' ? 'review' : 'clarification'; t.response = reply.message; t.responseRevision = response.resultRevision }
    }
    this.document.handledResponses.push(response.id); this.past = []; this.future = []; this.emit(); return null
  }
}
