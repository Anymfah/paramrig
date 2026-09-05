import { envelope, isCommand, isEnvelope, parseManifest, WEB_PROTOCOL, type HostCommand, type SDKEvent, type Values, type WebBinding, type WebContext, type WebMark, type WebProjectManifest, type WebTarget, type TargetKey, type Point } from './contracts.ts'
import { markPoints, pathForMark, storedPoint } from './geometry.ts'
import type { ParamValue } from '../rigs/types.ts'

export { parseManifest } from './contracts.ts'
export type { WebProjectManifest, WebBinding, WebTarget, FeedbackBatch, AgentResponse } from './contracts.ts'
export type { ParameterDef, ParamValue } from '../rigs/types.ts'

export type WebAdapter = { read: () => ParamValue; apply: (value: ParamValue) => void; restore: () => void }
export type ConnectWebOptions = { manifest: WebProjectManifest; hostOrigin: string; adapters?: Record<string, WebAdapter> }

/** Framework-neutral, development-only integration. No listeners become active before pairing. */
export function connectWeb({ manifest: rawManifest, hostOrigin, adapters = {} }: ConnectWebOptions) {
  const manifest = parseManifest(rawManifest)
  if (new URL(hostOrigin).origin !== hostOrigin || manifest.origin !== location.origin) throw new Error('Check the ParamRig host and project origins.')
  let sessionId = ''
  const instanceId = crypto.randomUUID()
  let mode: 'browse' | 'select' | 'annotate' = 'browse'
  let tool: WebMark['tool'] = 'note'
  let color = '#df7757'
  let displayScale = 1
  let activeTarget: string | undefined
  let activeTargets: string[] = []
  let targets: WebTarget[] = []
  let marks: WebMark[] = []
  let hover: WebTarget | null = null
  let selected: Element | null = null
  let draft: WebMark | null = null
  let dragTarget: WebTarget | undefined
  let dragIndex: number | undefined
  let pointerId: number | undefined
  let pointerOwner: Element | null = null
  let activeValues: Values | null = null
  let sourceMode = false
  let disposed = false
  let frame = 0
  let lastScene = ''
  let lastDrawing = ''
  const originalTouchAction = document.documentElement.style.touchAction
  const resolvedElements = new Map<string, Element>()
  const baselineStyles = new Map<Element, Map<string, { value: string; priority: string }>>()
  const sourceValues: Values = Object.fromEntries(manifest.parameters.map(p => [p.id, structuredClone(p.defaultValue)]))
  const svgNS = 'http://www.w3.org/2000/svg'
  const host = document.createElement('paramrig-overlay')
  host.tabIndex = -1
  host.setAttribute('aria-label', 'Page selection. Use arrow keys to select ancestors, children and siblings.')
  Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647', contain: 'strict', outline: 'none' })
  const shadow = host.attachShadow({ mode: 'closed' })
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); svg.style.overflow = 'visible'
  shadow.append(svg)
  const pageId = () => manifest.pages.find(p => new URL(p.path, manifest.origin).pathname === location.pathname)?.id ?? location.pathname
  const stableKey = (key: TargetKey) => `id:${encodeURIComponent(pageId())}:${encodeURIComponent(key.id)}:${encodeURIComponent(key.instance ?? '')}`
  const ownStable = (el: Element): TargetKey | undefined => {
    const id = el.getAttribute('data-paramrig-id')
    if (!id) return undefined
    const instance = el.getAttribute('data-paramrig-instance') ?? el.closest('[data-paramrig-instance]')?.getAttribute('data-paramrig-instance') ?? undefined
    return { id, ...(instance ? { instance } : {}) }
  }
  const elements = (key: TargetKey, exact = false): Element[] => [...document.querySelectorAll(`[data-paramrig-id="${CSS.escape(key.id)}"]`)].filter(el => !exact && key.instance === undefined || ownStable(el)?.instance === key.instance)
  function selector(el: Element) {
    const parts: string[] = []; let node: Element | null = el
    while (node && node !== document.documentElement) {
      if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) { parts.unshift(`#${CSS.escape(node.id)}`); break }
      const siblings = node.parentElement ? [...node.parentElement.children].filter(s => s.tagName === node!.tagName) : []
      parts.unshift(`${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`); node = node.parentElement
    }
    return parts.join(' > ') || 'html'
  }
  const fingerprint = (el: Element) => `${el.localName}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 160)}`
  const label = (el: Element) => {
    const declared = el.getAttribute('data-paramrig-label') || el.getAttribute('aria-label')
    if (declared) return declared.slice(0, 90)
    const content = el.matches('a,button,p,h1,h2,h3,h4,h5,h6,label,span,li') ? (el.textContent ?? '').trim().replace(/\s+/g, ' ') : ''
    return (content || el.getAttribute('data-paramrig-id')?.replace(/[-_]/g, ' ') || el.localName).slice(0, 60)
  }
  function describe(el: Element, ancestors = true): WebTarget {
    const stable = ownStable(el)
    const sel = selector(el)
    const key = stable ? stableKey(stable) : `dom:${pageId()}:${sel}`
    const r = el.getBoundingClientRect()
    let left = 0; let top = 0; let right = innerWidth; let bottom = innerHeight
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent); const box = parent.getBoundingClientRect()
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right) }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
    }
    const clip = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
    const source = el.closest('[data-paramrig-source]')?.getAttribute('data-paramrig-source')
    resolvedElements.set(key, el)
    const parents: WebTarget['ancestors'] = []
    if (ancestors) {
      let parent = el.parentElement
      while (parent && parents.length < 12) {
        const stable = ownStable(parent)
        const key = stable ? stableKey(stable) : `dom:${pageId()}:${selector(parent)}`
        resolvedElements.set(key, parent)
        parents.push({ key, label: label(parent), stable }); parent = parent.parentElement
      }
    }
    return { key, stable, selector: sel, fingerprint: fingerprint(el), label: label(el), tag: el.localName, ...(source ? { source } : {}), pageId: pageId(), rect: { x: r.x, y: r.y, width: r.width, height: r.height }, clip, ancestors: parents, status: stable ? elements(stable, true).length === 1 ? 'resolved' : 'ambiguous' : 'provisional' }
  }
  function resolve(target: WebTarget): { element?: Element; target: WebTarget } {
    if (target.pageId !== pageId()) return { target: { ...target, status: 'missing' } }
    if (target.stable) {
      const found = elements(target.stable, true)
      if (found.length !== 1) return { target: { ...target, status: found.length ? 'ambiguous' : 'missing' } }
      return { element: found[0], target: { ...describe(found[0]!), key: target.key } }
    }
    const previous = resolvedElements.get(target.key)
    if (previous?.isConnected) return { element: previous, target: { ...describe(previous), key: target.key } }
    // A positional selector alone never silently reattaches an annotation to a different element.
    return { target: { ...target, status: 'missing' } }
  }
  function context(): WebContext {
    const scrollers: WebContext['scrollers'] = []
    for (const el of document.querySelectorAll('[data-paramrig-id]')) if (el.scrollTop || el.scrollLeft) scrollers.push({ target: describe(el, false), x: el.scrollLeft, y: el.scrollTop })
    return { pageId: pageId(), url: location.href, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, scroll: { x: scrollX, y: scrollY }, scrollers }
  }
  function send(payload: SDKEvent) { if (sessionId && !disposed) window.parent.postMessage(envelope(sessionId, payload), hostOrigin) }
  function draw() {
    svg.replaceChildren()
    const clippedGroup = (target?: WebTarget) => {
      if (!target?.clip) return svg
      const clip = document.createElementNS(svgNS, 'clipPath'); const box = document.createElementNS(svgNS, 'rect')
      const id = `paramrig-clip-${svg.childElementCount}`; clip.id = id
      for (const key of ['x', 'y', 'width', 'height'] as const) box.setAttribute(key, String(target.clip[key]))
      clip.append(box); svg.append(clip)
      const group = document.createElementNS(svgNS, 'g'); group.setAttribute('clip-path', `url(#${id})`); svg.append(group); return group
    }
    const outlined = mode === 'browse' ? [] : [hover, ...targets.filter(t => activeTargets.includes(t.key))]
    for (const t of outlined.filter((t): t is WebTarget => !!t && !['missing', 'ambiguous'].includes(t.status))) {
      const rect = document.createElementNS(svgNS, 'rect')
      for (const key of ['x', 'y', 'width', 'height'] as const) rect.setAttribute(key, String(t.rect[key]))
      rect.setAttribute('fill', '#62aab714'); rect.setAttribute('stroke', '#488a99'); rect.setAttribute('stroke-width', '1.5'); clippedGroup(t).append(rect)
    }
    for (const m of [...marks.filter(m => m.id !== draft?.id), ...(draft ? [draft] : [])]) {
      if (m.pageId !== pageId()) continue
      const pts = markPoints(m, [...targets, ...(dragTarget ? [dragTarget] : [])], { x: scrollX, y: scrollY })
      if (!pts) continue
      const group = clippedGroup(m.targetKey ? [...targets, ...(dragTarget ? [dragTarget] : [])].find(t => t.key === m.targetKey) : undefined)
      const path = document.createElementNS(svgNS, 'path')
      path.setAttribute('d', pathForMark(m, pts)); path.setAttribute('stroke', m.color); path.setAttribute('stroke-width', String(m.width)); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('fill', m.tool === 'highlight' ? `${m.color}33` : m.tool === 'note' ? m.color : 'none'); group.append(path)
      if (mode === 'annotate') for (const p of [pts[0], pts.at(-1)].filter((p): p is Point => !!p)) {
        const dot = document.createElementNS(svgNS, 'circle'); dot.setAttribute('cx', String(p.x)); dot.setAttribute('cy', String(p.y)); dot.setAttribute('r', '3'); dot.setAttribute('fill', m.color); group.append(dot)
      }
    }
  }
  function refresh() {
    frame = 0
    if (!sessionId || disposed) return
    targets = targets.map(t => resolve(t).target)
    if (hover) { const el = resolvedElements.get(hover.key); hover = el?.isConnected ? describe(el) : null }
    const drawing = JSON.stringify([hover, targets, activeTargets, marks, draft, mode, scrollX, scrollY])
    if (drawing !== lastDrawing) { draw(); lastDrawing = drawing }
    const c = context(); const signature = JSON.stringify([c, targets])
    if (signature !== lastScene) { lastScene = signature; send({ type: 'scene', context: c, targets }) }
    if (!document.hidden && (mode !== 'browse' || marks.length > 0 || targets.length > 0)) schedule()
  }
  function schedule() { if (!frame && sessionId) frame = requestAnimationFrame(refresh) }
  function bindingElements(b: WebBinding) { return b.target ? elements(b.target) : [document.documentElement] }
  function applies(b: WebBinding) { return !b.pageId || b.pageId === pageId() }
  function restore() {
    for (const [el, properties] of baselineStyles) if (el instanceof HTMLElement || el instanceof SVGElement) for (const [p, before] of properties) {
      if (before.value) el.style.setProperty(p, before.value, before.priority)
      else el.style.removeProperty(p)
    }
    baselineStyles.clear()
    for (const adapter of Object.values(adapters)) adapter.restore()
  }
  function readSource() {
    for (const b of manifest.bindings.filter(applies)) {
      const p = manifest.parameters.find(p => p.id === b.paramId)!
      if (b.kind === 'adapter') { if (adapters[b.property]) sourceValues[b.paramId] = adapters[b.property]!.read(); continue }
      const el = bindingElements(b)[0]; if (!el) continue
      const raw = getComputedStyle(el).getPropertyValue(b.property).trim()
      if (!raw) continue
      if (p.kind === 'number') { const n = parseFloat(raw); if (Number.isFinite(n)) sourceValues[p.id] = n }
      else if (p.kind === 'color') {
        if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(raw)) { sourceValues[p.id] = raw.toLowerCase(); continue }
        const c = document.createElement('canvas').getContext('2d')
        if (c) { c.fillStyle = raw; c.fillRect(0, 0, 1, 1); const rgba = c.getImageData(0, 0, 1, 1).data; sourceValues[p.id] = `#${[...rgba].slice(0, p.alpha ? 4 : 3).map(v => v.toString(16).padStart(2, '0')).join('')}` }
      } else sourceValues[p.id] = raw
    }
  }
  function applyValues() {
    restore()
    if (!activeValues || sourceMode) { schedule(); return }
    for (const b of manifest.bindings.filter(applies)) {
      const value = activeValues[b.paramId]
      if (value === undefined || JSON.stringify(value) === JSON.stringify(sourceValues[b.paramId])) continue
      if (b.kind === 'adapter') {
        if (!adapters[b.property]) { send({ type: 'error', message: `Missing adapter: ${b.property}` }); continue }
        adapters[b.property]!.apply(value)
      }
    }
    applyStyles(); schedule()
  }
  function applyStyles() {
    if (!activeValues || sourceMode) return
    for (const [el] of baselineStyles) if (!el.isConnected) baselineStyles.delete(el)
    for (const b of manifest.bindings.filter(b => applies(b) && b.kind !== 'adapter')) {
      const value = activeValues[b.paramId]
      if (value === undefined || JSON.stringify(value) === JSON.stringify(sourceValues[b.paramId])) continue
      if (typeof value !== 'string' && typeof value !== 'number') continue
      for (const el of bindingElements(b)) if (el instanceof HTMLElement || el instanceof SVGElement) {
        const properties = baselineStyles.get(el) ?? new Map()
        if (!properties.has(b.property)) properties.set(b.property, { value: el.style.getPropertyValue(b.property), priority: el.style.getPropertyPriority(b.property) })
        baselineStyles.set(el, properties)
        const next = `${value}${b.unit ?? ''}`
        const declaration = document.createElement('span').style
        declaration.setProperty(b.property, next, 'important')
        const normalized = declaration.getPropertyValue(b.property)
        if (normalized && (el.style.getPropertyValue(b.property) !== normalized || el.style.getPropertyPriority(b.property) !== declaration.getPropertyPriority(b.property))) el.style.setProperty(b.property, normalized, 'important')
      }
    }
  }
  function ready() { send({ type: 'ready', instanceId, manifest, sourceValues, context: context() }); schedule() }
  function select(el: Element, additive = false) { selected = el; hover = describe(el); send({ type: 'selection', target: hover, additive }); schedule() }
  async function capture(requestId: string) {
    try {
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(document.documentElement, { filter: node => node !== host, pixelRatio: 1, width: innerWidth, height: innerHeight, style: { transform: `translate(${-scrollX}px, ${-scrollY}px)`, transformOrigin: '0 0' } })
      send({ type: 'capture', requestId, dataUrl })
    } catch (e) { send({ type: 'capture', requestId, error: e instanceof Error ? e.message : 'DOM capture is unavailable.' }) }
  }
  function message(event: MessageEvent) {
    if (event.source !== window.parent || event.origin !== hostOrigin || !isEnvelope(event.data)) return
    const msg = event.data
    if (msg.payload.type === 'hello') {
      if (msg.payload.projectId !== manifest.id) return
      if (msg.version !== WEB_PROTOCOL) { window.parent.postMessage(envelope(msg.sessionId, { type: 'error', message: 'Incompatible web protocol. Update the project integration.' }), hostOrigin); return }
      if (sessionId !== msg.sessionId) {
        sessionId = msg.sessionId
        try { restore(); readSource() } catch (e) { send({ type: 'error', message: `Cannot read the source controls: ${String(e)}` }); return }
        if (!host.isConnected) document.documentElement.append(host)
      }
      ready(); return
    }
    if (msg.sessionId !== sessionId || msg.version !== WEB_PROTOCOL || !isCommand(msg.payload)) return
    const p = msg.payload as HostCommand
    if (p.type === 'configure') {
      if (p.mode !== mode || p.tool !== tool) cancel()
      mode = p.mode; displayScale = p.displayScale ?? 1
      if (mode === 'browse') hover = null
      tool = p.tool; color = p.color; targets = p.targets; marks = p.marks; activeTarget = p.activeTarget
      activeTargets = p.activeTargets ?? (p.activeTarget ? [p.activeTarget] : [])
      document.documentElement.style.touchAction = mode === 'annotate' ? 'none' : originalTouchAction
      schedule()
    }
    if (p.type === 'values') { activeValues = p.values; sourceMode = p.source; try { applyValues() } catch (e) { send({ type: 'error', message: String(e) }) } }
    if (p.type === 'select') { const found = resolve(p.target); if (found.element) { found.element.scrollIntoView({ block: 'nearest', inline: 'nearest' }); select(found.element) } }
    if (p.type === 'reveal-target') resolve(p.target).element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (p.type === 'restore-context' && p.context.pageId === pageId()) {
      for (const scroller of p.context.scrollers) resolve(scroller.target).element?.scrollTo(scroller.x, scroller.y)
      window.scrollTo(p.context.scroll.x, p.context.scroll.y); schedule()
    }
    if (p.type === 'navigate') { const url = new URL(p.path, manifest.origin); if (url.origin === manifest.origin && manifest.pages.some(page => page.path === p.path)) location.assign(url) }
    if (p.type === 'capture') void capture(p.requestId)
  }
  function isEditing() { return sessionId && mode !== 'browse' }
  function hit(event: PointerEvent): Element | undefined { return event.composedPath().find((n): n is Element => n instanceof Element && n !== host && !host.contains(n)) }
  function down(event: PointerEvent) {
    if (!isEditing() || event.button !== 0) return
    event.preventDefault(); event.stopImmediatePropagation()
    const el = hit(event); if (!el) return
    host.focus({ preventScroll: true })
    if (mode === 'select') { select(el, event.shiftKey); return }
    const point = { x: event.clientX, y: event.clientY }
    dragIndex = undefined
    for (const m of [...marks].reverse().filter(m => m.pageId === pageId())) {
      const pts = markPoints(m, targets, { x: scrollX, y: scrollY }); if (!pts) continue
      const clip = targets.find(t => t.key === m.targetKey)?.clip
      if (clip && (point.x < clip.x || point.y < clip.y || point.x > clip.x + clip.width || point.y > clip.y + clip.height)) continue
      const radius = (event.pointerType === 'touch' ? 22 : 16) / displayScale
      const index = [0, pts.length - 1].find(i => Math.hypot(pts[i]!.x - point.x, pts[i]!.y - point.y) <= radius)
      if (index !== undefined) { draft = structuredClone(m); dragIndex = index; dragTarget = targets.find(t => t.key === m.targetKey); break }
    }
    if (!draft) {
      dragTarget = tool === 'note' ? describe(el) : targets.find(t => t.key === activeTarget && !['missing', 'ambiguous'].includes(t.status))
      const p = storedPoint(point, dragTarget, { x: scrollX, y: scrollY })
      draft = { id: crypto.randomUUID(), tool, color, width: 2, points: [p, p], targetKey: dragTarget?.key, pageId: pageId(), viewport: { width: innerWidth, height: innerHeight } }
    }
    pointerId = event.pointerId
    pointerOwner = el
    try { (el as HTMLElement).setPointerCapture(event.pointerId) } catch { /* document capture still receives the gesture */ }
    schedule()
  }
  function move(event: PointerEvent) {
    if (!isEditing()) return
    if (draft && event.pointerId === pointerId) {
      event.preventDefault(); event.stopImmediatePropagation()
      const p = storedPoint({ x: event.clientX, y: event.clientY }, dragTarget, { x: scrollX, y: scrollY })
      if (dragIndex !== undefined) draft.points[dragIndex] = p
      else if (draft.tool === 'pen') { if (draft.points.length < 10000) draft.points.push(p) }
      else draft.points[draft.points.length - 1] = p
    } else { const el = hit(event); hover = el ? describe(el) : null }
    schedule()
  }
  function end(event: PointerEvent) {
    if (!isEditing()) return
    event.preventDefault(); event.stopImmediatePropagation()
    if (draft && event.pointerId === pointerId) {
      send({ type: 'mark', mark: draft, target: dragTarget, context: context() }); marks = [...marks.filter(m => m.id !== draft!.id), draft]; cancel()
    }
  }
  function cancel() {
    if (pointerOwner && pointerId !== undefined) {
      try { pointerOwner.releasePointerCapture(pointerId) } catch { /* The browser may have already released it. */ }
    }
    draft = null; pointerId = undefined; pointerOwner = null; dragTarget = undefined; dragIndex = undefined
    schedule()
  }
  function click(event: MouseEvent) { if (isEditing()) { event.preventDefault(); event.stopImmediatePropagation() } }
  function key(event: KeyboardEvent) {
    if (!isEditing()) return
    if (event.key === 'Escape') { cancel(); hover = null; mode = 'browse'; document.documentElement.style.touchAction = originalTouchAction; send({ type: 'exit-tool' }); schedule(); event.preventDefault(); return }
    if (event.key.toLowerCase() === 'c' && !event.metaKey && !event.ctrlKey && !event.altKey && selected?.isConnected) { event.preventDefault(); event.stopImmediatePropagation(); send({ type: 'comment', target: describe(selected) }); return }
    if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopImmediatePropagation(); send({ type: 'history', direction: event.shiftKey || event.key === 'y' ? 'redo' : 'undo' }); return }
    const root = selected?.isConnected ? selected : document.body
    const next = event.key === 'ArrowUp' ? root.parentElement : event.key === 'ArrowDown' ? root.firstElementChild : event.key === 'ArrowRight' ? root.nextElementSibling : event.key === 'ArrowLeft' ? root.previousElementSibling : null
    if (next && next !== host) { event.preventDefault(); event.stopImmediatePropagation(); select(next) }
    if (event.key === 'Enter') { event.preventDefault(); select(root) }
  }
  const observer = new MutationObserver(records => {
    if (!sessionId || records.every(r => r.target === host || host.contains(r.target))) return
    applyStyles()
    schedule()
  })
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  const resize = new ResizeObserver(schedule); resize.observe(document.documentElement)
  window.addEventListener('message', message)
  window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule)
  window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', cancel, true)
  window.addEventListener('click', click, true); window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel)
  let previousPage = pageId()
  const heartbeat = setInterval(() => {
    if (!sessionId) return
    if (previousPage !== pageId()) { previousPage = pageId(); restore(); readSource(); applyValues(); ready() }
    schedule()
  }, 750)
  return {
    dispose() {
      disposed = true; cancel(); restore(); document.documentElement.style.touchAction = originalTouchAction; host.remove(); observer.disconnect(); resize.disconnect(); clearInterval(heartbeat); cancelAnimationFrame(frame)
      window.removeEventListener('message', message); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule)
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('click', click, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel)
    },
  }
}
