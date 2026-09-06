import { describe, expect, it } from 'vitest'
import example from '../../examples/web/manifest.json'
import { parseManifest, type AgentResponse, type WebContext, type Values } from './contracts'
import { newDraft, reconcile, ticketNumber, WebSession } from './session'

const manifest = parseManifest(example)
const context: WebContext = { pageId: 'home', url: manifest.origin + manifest.pages[0]!.path, viewport: { width: 1440, height: 900, dpr: 1 }, scroll: { x: 0, y: 0 }, scrollers: [] }

describe('web decisions and source revisions', () => {
  it('keeps an in-progress gesture across repeated SDK heartbeats', () => {
    const s = new WebSession(manifest)
    s.begin('Resize'); s.setValue('content-width', 900)
    s.replaceSource(manifest, s.document.sourceValues)
    expect(s.document.values['content-width']).toBe(900); expect(s.isGesturing).toBe(true)
    s.setValue('content-width', 1000); s.end(); s.undo()
    expect(s.document.values['content-width']).toBe(1120)
  })
  it('groups a continuous control gesture, and cancels without adding an undo step', () => {
    const s = new WebSession(manifest)
    s.begin('Resize'); s.setValue('content-width', 900); s.setValue('content-width', 1000); s.end()
    s.undo(); expect(s.document.values['content-width']).toBe(1120); expect(s.undoLabel).toBeUndefined()
    s.redo(); expect(s.document.values['content-width']).toBe(1000)
    s.begin('Cancelled'); s.setValue('content-width', 800); s.cancel(); expect(s.document.values['content-width']).toBe(1000)
  })
  it('gives a comment a number it keeps whatever happens to the others', () => {
    const s = new WebSession(manifest)
    const [first, second, third] = [s.addTicket(context), s.addTicket(context), s.addTicket(context)]
    const numbered = () => s.document.tickets.map(t => [t.id, ticketNumber(s.document.tickets, t)] as const)
    expect(numbered()).toEqual([[first, 1], [second, 2], [third, 3]])
    // Removing the first one does not renumber the two a person has already talked about.
    s.change('Remove feedback', d => { d.tickets = d.tickets.filter(t => t.id !== first) })
    expect(numbered()).toEqual([[second, 2], [third, 3]])
    // Nor does validating one, and the next comment takes a number nobody has used.
    s.editTicket(second, t => { t.status = 'validated' })
    const fourth = s.addTicket(context)
    expect(numbered()).toEqual([[second, 2], [third, 3], [fourth, 4]])
    // A draft written before numbers existed still reads in order.
    const legacy = structuredClone(s.document.tickets).map(t => { delete t.number; return t })
    expect(legacy.map(t => ticketNumber(legacy, t))).toEqual([1, 2, 3])
  })
  it('shares one undo sequence between controls and annotations', () => {
    const s = new WebSession(manifest); s.setValue('accent', '#223344')
    const id = s.addTicket(context); s.editTicket(id, t => { t.comment = 'Reduce the visual weight.' })
    s.undo(); expect(s.document.tickets[0]!.comment).toBe(''); s.undo(); expect(s.document.tickets).toHaveLength(0)
    s.undo(); expect(s.document.values.accent).toBe('#bc593d')
  })
  it('keeps automatic capture evidence without changing the next undo action', () => {
    const s = new WebSession(manifest); const id = s.addTicket(context)
    s.editTicket(id, t => { t.comment = 'A longer heading' })
    s.attachCapture(id, { id: 'capture-one', kind: 'dom', status: 'failed', note: 'Unavailable', createdAt: '2026-09-05' })
    s.undo(); expect(s.document.tickets[0]!.comment).toBe(''); expect(s.document.tickets[0]!.captures).toHaveLength(1)
    s.redo(); expect(s.document.tickets[0]!.comment).toBe('A longer heading')
  })
  it('recognizes the same color regardless of hex case', () => {
    const d = newDraft(manifest); d.values.accent = '#ABCDEF'
    const next = reconcile(d, { ...manifest, revision: 'study-2' }, { ...d.sourceValues, accent: '#abcdef' })
    expect(next.conflicts).toEqual([]); expect(next.values.accent).toBe('#abcdef')
  })
  it('does not overwrite new source values with stale unedited defaults', () => {
    const d = newDraft(manifest); const next = reconcile(d, { ...manifest, revision: 'study-2' }, { ...d.sourceValues, accent: '#123456' })
    expect(next.values.accent).toBe('#123456'); expect(next.conflicts).toEqual([])
  })
  it('recognizes approved values already applied by the agent', () => {
    const d = newDraft(manifest); d.values.accent = '#123456'
    const next = reconcile(d, { ...manifest, revision: 'study-2' }, { ...d.sourceValues, accent: '#123456' })
    expect(next.values.accent).toBe(next.sourceValues.accent); expect(next.conflicts).toEqual([])
  })
  it('retains pending values only when the source stayed unchanged', () => {
    const d = newDraft(manifest); d.values.accent = '#123456'
    const next = reconcile(d, { ...manifest, revision: 'study-2' }, d.sourceValues)
    expect(next.values.accent).toBe('#123456'); expect(next.conflicts).toEqual([])
  })
  it('makes divergent edits visible, including removed controls after another handshake', () => {
    const d = newDraft(manifest); d.values.accent = '#123456'; d.values['hero-copy'] = 'Approved title'
    const updated = { ...manifest, revision: 'study-2', parameters: manifest.parameters.filter(p => p.id !== 'hero-copy') }
    const source: Values = { ...d.sourceValues, accent: '#654321' }; delete source['hero-copy']
    const next = reconcile(d, updated, source)
    expect(next.values.accent).toBe('#654321'); expect(next.conflicts.map(c => c.id)).toEqual(['accent', 'hero-copy'])
    const again = reconcile(next, updated, source)
    expect(again.conflicts.find(c => c.id === 'hero-copy')?.chosen).toBe('Approved title')
    expect(again.conflicts.find(c => c.id === 'accent')?.chosen).toBe('#123456')
    const restored = reconcile(again, manifest, d.sourceValues)
    expect(restored.conflicts.find(c => c.id === 'hero-copy')?.chosen).toBe('Approved title')
  })
  it('freezes a batch and requires a matching agent response before human validation', () => {
    const s = new WebSession(manifest); const id = s.addTicket(context)
    s.editTicket(id, t => { t.comment = 'Make the primary action calmer.' }); s.setValue('accent', '#123456')
    const batch = s.batch([id]); s.markPublished(batch)
    s.editTicket(id, t => { t.comment = 'A later draft' }); expect(batch.tickets[0]!.comment).toBe('Make the primary action calmer.')
    const response: AgentResponse = { version: 1, id: 'response-1', projectId: manifest.id, batchId: batch.id, sourceRevision: batch.sourceRevision, resultRevision: 'study-2', createdAt: new Date().toISOString(), summary: 'Updated', tickets: [{ id, status: 'implemented', message: 'Check the new color.' }] }
    expect(s.response(response, batch)).toContain('another source revision')
    s.replaceSource({ ...manifest, revision: 'study-2' }, { ...s.document.sourceValues, accent: '#123456' })
    expect(s.response(response, batch)).toBeNull(); expect(s.document.tickets[0]!.status).toBe('review')
    expect(s.document.tickets[0]!.status).not.toBe('validated')
    const revision = s.getRevision(); s.response(response, batch); expect(s.getRevision()).toBe(revision)
  })
  it('does not restore a snapshot from a different source revision', () => {
    const s = new WebSession(manifest); s.setValue('accent', '#123456'); s.snapshot('Version A')
    const id = s.document.snapshots[0]!.id
    s.replaceSource({ ...manifest, revision: 'study-2' }, { ...s.document.sourceValues, accent: '#654321' })
    s.restoreSnapshot(id); expect(s.document.values.accent).toBe('#654321')
  })
})
