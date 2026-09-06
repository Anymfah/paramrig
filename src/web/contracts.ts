import type { ParameterDef, ParamGroup, ParamValue } from '../rigs/types.ts'

export const WEB_PROTOCOL = 1
export const WEB_CHANNEL = 'paramrig.web'
export type Values = Record<string, ParamValue>
export type Point = { x: number; y: number }
export type Rect = Point & { width: number; height: number }
export type TargetKey = { id: string; instance?: string }
export type WebBinding = {
  paramId: string
  scope: 'global' | 'page' | 'element'
  pageId?: string
  target?: TargetKey
  kind: 'css-variable' | 'style' | 'adapter'
  property: string
  unit?: string
  source?: string
}
export type WebProjectManifest = {
  version: 1
  id: string
  name: string
  revision: string
  origin: string
  pages: { id: string; name: string; path: string }[]
  groups: ParamGroup[]
  parameters: ParameterDef[]
  bindings: WebBinding[]
}
export type WebTarget = {
  key: string
  stable?: TargetKey
  selector: string
  fingerprint: string
  label: string
  tag: string
  source?: string
  pageId: string
  rect: Rect
  clip?: Rect
  ancestors: { key: string; label: string; stable?: TargetKey }[]
  status: 'resolved' | 'provisional' | 'missing' | 'ambiguous'
  /** How many of the manifest's controls reach this element. Absent means none were counted. */
  controls?: number
}
/** Colours the host hands the page so the overlay follows the workbench theme. */
export type WebChrome = { outline: string; chip: string; chipText: string }
export type WebContext = {
  pageId: string
  url: string
  viewport: { width: number; height: number; dpr: number }
  scroll: Point
  scrollers: { target: WebTarget; x: number; y: number }[]
}
export type MarkTool = 'note' | 'arrow' | 'rectangle' | 'ellipse' | 'highlight' | 'pen'
export type WebMark = {
  id: string
  tool: MarkTool
  color: string
  width: number
  points: Point[]
  /** Element marks use fractions of its box; free marks use document CSS pixels. */
  targetKey?: string
  pageId: string
  viewport: { width: number; height: number }
}
export type Capture = {
  id: string
  kind: 'dom' | 'screen'
  createdAt: string
  status: 'ready' | 'failed'
  file?: string
  note: string
  /** Offline recovery only; removed once the capture has been saved to disk. */
  dataUrl?: string
}
export type TicketStatus = 'draft' | 'todo' | 'review' | 'validated' | 'clarification'
export type WebTicket = {
  id: string
  comment: string
  status: TicketStatus
  revision: string
  createdAt: string
  context: WebContext
  targets: WebTarget[]
  marks: WebMark[]
  captures: Capture[]
  batchId?: string
  response?: string
  responseRevision?: string
}
export type ValueConflict = { id: string; before?: ParamValue; chosen: ParamValue; source?: ParamValue; removed: boolean }
export type WebSnapshot = { id: string; name: string; revision: string; values: Values }
export type WebDraft = {
  version: 1
  projectId: string
  sourceRevision: string
  sourceValues: Values
  values: Values
  tickets: WebTicket[]
  snapshots: WebSnapshot[]
  conflicts: ValueConflict[]
  handledResponses: string[]
}
export type FeedbackBatch = {
  version: 1
  id: string
  projectId: string
  sourceRevision: string
  createdAt: string
  values: Values
  changes: { paramId: string; label: string; before: ParamValue; after: ParamValue; bindings: WebBinding[] }[]
  tickets: WebTicket[]
}
export type AgentResponse = {
  version: 1
  id: string
  batchId: string
  projectId: string
  sourceRevision: string
  resultRevision: string
  createdAt: string
  tickets: { id: string; status: 'implemented' | 'needs-info'; message: string }[]
  summary: string
}
export type HostCommand =
  | { type: 'hello'; projectId: string }
  | { type: 'configure'; mode: 'browse' | 'select' | 'annotate'; tool: MarkTool; color: string; targets: WebTarget[]; marks: WebMark[]; activeTarget?: string; activeTargets?: string[]; displayScale?: number; chrome?: WebChrome }
  | { type: 'values'; values: Values; source: boolean }
  | { type: 'select'; target: WebTarget }
  | { type: 'reveal-target'; target: WebTarget }
  | { type: 'restore-context'; context: WebContext }
  | { type: 'navigate'; path: string }
  | { type: 'capture'; requestId: string }
export type SDKEvent =
  | { type: 'ready'; instanceId: string; manifest: WebProjectManifest; sourceValues: Values; context: WebContext }
  | { type: 'scene'; context: WebContext; targets: WebTarget[]; page?: WebTarget[] }
  | { type: 'selection'; target: WebTarget; additive: boolean }
  | { type: 'comment'; target: WebTarget }
  | { type: 'exit-tool' }
  | { type: 'mark'; mark: WebMark; target?: WebTarget; context: WebContext }
  | { type: 'capture'; requestId: string; dataUrl?: string; error?: string }
  | { type: 'error'; message: string }
  | { type: 'history'; direction: 'undo' | 'redo' }
export type Envelope<T> = { channel: typeof WEB_CHANNEL; version: number; sessionId: string; payload: T }
/**
 * The frame the SDK sends the moment it starts listening, before any session exists.
 * It carries no session ID, so it is deliberately not an envelope: the host answers it with
 * `hello` and every later message is checked against the session that handshake opened.
 */
export type SDKAnnouncement = { channel: typeof WEB_CHANNEL; version: number; type: 'sdk-present'; projectId: string; instanceId: string }

export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 2000 }
export function isValues(value: unknown): value is Values {
  if (!record(value)) return false
  const walk = (v: unknown, depth: number): boolean => depth < 12 && (v === null || typeof v === 'boolean' || typeof v === 'string' && v.length <= 100000 || typeof v === 'number' && Number.isFinite(v) || Array.isArray(v) && v.length <= 1000 && v.every(e => walk(e, depth + 1)) || record(v) && Object.keys(v).length <= 1000 && Object.entries(v).every(([k, e]) => !['__proto__', 'prototype', 'constructor'].includes(k) && walk(e, depth + 1)))
  return walk(value, 0)
}
export function parseManifest(value: unknown): WebProjectManifest {
  if (!record(value) || value.version !== 1 || !safeId(value.id) || !text(value.name) || !text(value.revision) || typeof value.origin !== 'string') throw new Error('Invalid web project manifest.')
  const origin = new URL(value.origin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value.origin || origin.username || origin.password) throw new Error('The project origin must be an HTTP or HTTPS origin.')
  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > 100 || !value.pages.every(p => record(p) && safeId(p.id) && text(p.name) && typeof p.path === 'string' && p.path.startsWith('/') && new URL(p.path, origin).origin === origin.origin)) throw new Error('Declare valid project pages.')
  if (!Array.isArray(value.groups) || !value.groups.every(g => record(g) && safeId(g.id) && text(g.label))) throw new Error('Invalid control groups.')
  if (!Array.isArray(value.parameters) || value.parameters.length > 500) throw new Error('Invalid controls.')
  const kinds = new Set(['number', 'color', 'select', 'curve', 'switch', 'gradient', 'text', 'vector', 'range', 'palette', 'points', 'radial', 'group', 'list', 'resource', 'gizmo2d', 'gizmo3d', 'camera', 'textureFrame', 'multiselect', 'action', 'preset'])
  const validParam = (p: unknown, depth = 0): boolean => {
    if (depth > 8 || !record(p) || !safeId(p.id) || !text(p.label) || typeof p.group !== 'string' || !kinds.has(String(p.kind)) || !isValues({ value: p.defaultValue })) return false
    if (p.kind === 'number' && !(typeof p.min === 'number' && typeof p.max === 'number' && p.min <= p.max && typeof p.step === 'number' && p.step > 0)) return false
    if (['select', 'preset', 'multiselect'].includes(String(p.kind)) && !(Array.isArray(p.options) && p.options.every(o => record(o) && typeof o.value === 'string' && text(o.label)))) return false
    if (p.kind === 'group' && !(Array.isArray(p.fields) && p.fields.every(f => validParam(f, depth + 1)))) return false
    if (p.kind === 'list' && !validParam(p.item, depth + 1)) return false
    return true
  }
  if (!value.parameters.every(p => validParam(p))) throw new Error('Invalid control definition.')
  const ids = value.parameters.map(p => (p as ParameterDef).id)
  if (new Set(ids).size !== ids.length || new Set(value.pages.map(p => p.id)).size !== value.pages.length) throw new Error('Control and page IDs must be unique.')
  const pages = value.pages as { id: string }[]
  if (!Array.isArray(value.bindings) || !value.bindings.every(b => record(b) && ids.includes(String(b.paramId)) && ['global', 'page', 'element'].includes(String(b.scope)) && ['css-variable', 'style', 'adapter'].includes(String(b.kind)) && text(b.property) && (b.scope !== 'element' || record(b.target) && text(b.target.id)) && (b.scope !== 'page' || pages.some(p => p.id === b.pageId)))) throw new Error('Invalid web bindings.')
  return structuredClone(value) as WebProjectManifest
}
function isRect(v: unknown): v is Rect { return record(v) && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(v[k])) && Number(v.width) >= 0 && Number(v.height) >= 0 }
export function isTarget(v: unknown): v is WebTarget {
  const stable = (key: unknown) => key === undefined || record(key) && text(key.id) && (key.instance === undefined || text(key.instance))
  return record(v) && text(v.key) && typeof v.tag === 'string' && stable(v.stable) && typeof v.selector === 'string' && typeof v.fingerprint === 'string' && typeof v.label === 'string' && typeof v.pageId === 'string' && Array.isArray(v.ancestors) && v.ancestors.every(a => record(a) && text(a.key) && typeof a.label === 'string' && stable(a.stable)) && isRect(v.rect) && (v.clip === undefined || isRect(v.clip)) && ['resolved', 'provisional', 'missing', 'ambiguous'].includes(String(v.status)) && (v.controls === undefined || Number.isInteger(v.controls) && Number(v.controls) >= 0 && Number(v.controls) <= 1000)
}
const hex = (v: unknown) => typeof v === 'string' && /^#[\da-f]{3,8}$/i.test(v)
export function isChrome(v: unknown): v is WebChrome { return record(v) && hex(v.outline) && hex(v.chip) && hex(v.chipText) }
export function isContext(v: unknown): v is WebContext {
  return record(v) && typeof v.pageId === 'string' && typeof v.url === 'string' && record(v.viewport) && ['width', 'height', 'dpr'].every(k => Number.isFinite((v.viewport as Record<string, unknown>)[k]) && Number((v.viewport as Record<string, unknown>)[k]) > 0) && record(v.scroll) && Number.isFinite(v.scroll.x) && Number.isFinite(v.scroll.y) && Array.isArray(v.scrollers) && v.scrollers.length <= 1000 && v.scrollers.every(s => record(s) && isTarget(s.target) && Number.isFinite(s.x) && Number.isFinite(s.y))
}
export function isMark(v: unknown): v is WebMark {
  return record(v) && safeId(v.id) && ['note', 'arrow', 'rectangle', 'ellipse', 'highlight', 'pen'].includes(String(v.tool)) && typeof v.color === 'string' && /^#[\da-f]{6}$/i.test(v.color) && typeof v.width === 'number' && v.width > 0 && v.width <= 32 && typeof v.pageId === 'string' && record(v.viewport) && Number.isFinite(v.viewport.width) && Number.isFinite(v.viewport.height) && Array.isArray(v.points) && v.points.length <= 10000 && v.points.every(p => record(p) && Number.isFinite(p.x) && Number.isFinite(p.y))
}
export function isTicket(v: unknown): v is WebTicket {
  return record(v) && safeId(v.id) && typeof v.comment === 'string' && v.comment.length <= 20000 && ['draft', 'todo', 'review', 'validated', 'clarification'].includes(String(v.status)) && text(v.revision) && text(v.createdAt) && isContext(v.context) && Array.isArray(v.targets) && v.targets.every(isTarget) && Array.isArray(v.marks) && v.marks.every(isMark) && Array.isArray(v.captures) && v.captures.every(c => record(c) && safeId(c.id) && ['dom', 'screen'].includes(String(c.kind)) && ['ready', 'failed'].includes(String(c.status)) && typeof c.note === 'string')
}
export function isDraft(v: unknown): v is WebDraft {
  return record(v) && v.version === 1 && safeId(v.projectId) && text(v.sourceRevision) && isValues(v.values) && isValues(v.sourceValues) && Array.isArray(v.tickets) && v.tickets.every(isTicket) && Array.isArray(v.snapshots) && v.snapshots.every(s => record(s) && safeId(s.id) && text(s.name) && text(s.revision) && isValues(s.values)) && Array.isArray(v.conflicts) && v.conflicts.every(c => record(c) && text(c.id) && typeof c.removed === 'boolean' && isValues({ chosen: c.chosen })) && Array.isArray(v.handledResponses) && v.handledResponses.every(safeId)
}
export function isBatch(v: unknown): v is FeedbackBatch {
  return record(v) && v.version === 1 && safeId(v.id) && safeId(v.projectId) && text(v.sourceRevision) && text(v.createdAt) && isValues(v.values) && Array.isArray(v.changes) && v.changes.every(c => record(c) && safeId(c.paramId) && typeof c.label === 'string' && isValues({ before: c.before, after: c.after }) && Array.isArray(c.bindings)) && Array.isArray(v.tickets) && v.tickets.every(isTicket)
}
export function isResponse(v: unknown): v is AgentResponse {
  return record(v) && v.version === 1 && safeId(v.id) && safeId(v.batchId) && safeId(v.projectId) && text(v.sourceRevision) && text(v.resultRevision) && typeof v.summary === 'string' && text(v.createdAt) && Array.isArray(v.tickets) && v.tickets.every(t => record(t) && safeId(t.id) && ['implemented', 'needs-info'].includes(String(t.status)) && typeof t.message === 'string')
}
export function envelope<T>(sessionId: string, payload: T): Envelope<T> { return { channel: WEB_CHANNEL, version: WEB_PROTOCOL, sessionId, payload } }
export function announcement(projectId: string, instanceId: string): SDKAnnouncement { return { channel: WEB_CHANNEL, version: WEB_PROTOCOL, type: 'sdk-present', projectId, instanceId } }
export function isAnnouncement(v: unknown): v is SDKAnnouncement { return record(v) && v.channel === WEB_CHANNEL && v.type === 'sdk-present' && typeof v.version === 'number' && safeId(v.projectId) && safeId(v.instanceId) }
export function isEnvelope(v: unknown): v is Envelope<Record<string, unknown>> { return record(v) && v.channel === WEB_CHANNEL && typeof v.version === 'number' && safeId(v.sessionId) && record(v.payload) && typeof v.payload.type === 'string' }
export function isCommand(p: Record<string, unknown>): boolean {
  switch (p.type) {
    case 'hello': return safeId(p.projectId)
    case 'values': return isValues(p.values) && typeof p.source === 'boolean'
    case 'select': return isTarget(p.target)
    case 'reveal-target': return isTarget(p.target)
    case 'restore-context': return isContext(p.context)
    case 'navigate': return typeof p.path === 'string'
    case 'capture': return safeId(p.requestId)
    case 'configure': return (p.chrome === undefined || isChrome(p.chrome)) && (p.activeTargets === undefined || Array.isArray(p.activeTargets) && p.activeTargets.every(key => typeof key === 'string' && key.length < 2000)) && (p.displayScale === undefined || typeof p.displayScale === 'number' && p.displayScale >= .05 && p.displayScale <= 4) && ['browse', 'select', 'annotate'].includes(String(p.mode)) && ['note', 'arrow', 'rectangle', 'ellipse', 'highlight', 'pen'].includes(String(p.tool)) && typeof p.color === 'string' && /^#[\da-f]{6}$/i.test(p.color) && Array.isArray(p.targets) && p.targets.every(isTarget) && Array.isArray(p.marks) && p.marks.every(isMark)
    default: return false
  }
}
export function isEvent(p: Record<string, unknown>): boolean {
  switch (p.type) {
    case 'ready': try { parseManifest(p.manifest); return safeId(p.instanceId) && isValues(p.sourceValues) && isContext(p.context) } catch { return false }
    case 'scene': return isContext(p.context) && Array.isArray(p.targets) && p.targets.every(isTarget) && (p.page === undefined || Array.isArray(p.page) && p.page.length <= 500 && p.page.every(isTarget))
    case 'selection': return isTarget(p.target) && typeof p.additive === 'boolean'
    case 'comment': return isTarget(p.target)
    case 'exit-tool': return true
    case 'mark': return isMark(p.mark) && isContext(p.context) && (!p.target || isTarget(p.target))
    case 'capture': return safeId(p.requestId) && (typeof p.error === 'string' || typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:image/png;base64,') && p.dataUrl.length < 16000000)
    case 'error': return typeof p.message === 'string'
    case 'history': return ['undo', 'redo'].includes(String(p.direction))
    default: return false
  }
}
