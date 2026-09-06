import { announcement, envelope, isCommand, isEnvelope, parseManifest, WEB_PROTOCOL, type HostCommand, type SDKEvent, type Values, type WebBinding, type WebContext, type WebMark, type WebProjectManifest, type WebTarget, type WebChrome, type TargetKey, type Point } from './contracts.ts'
import { markPoints, pathForMark, storedPoint } from './geometry.ts'
import type { ParamValue } from '../rigs/types.ts'

export { parseManifest } from './contracts.ts'
export type { WebProjectManifest, WebBinding, WebTarget, FeedbackBatch, AgentResponse } from './contracts.ts'
export type { ParameterDef, ParamValue } from '../rigs/types.ts'

export type WebAdapter = { read: () => ParamValue; apply: (value: ParamValue) => void; restore: () => void }
export type ConnectWebOptions = { manifest: WebProjectManifest; hostOrigin?: string | readonly string[]; adapters?: Record<string, WebAdapter> }

/** Where the workbench runs by default. Both aliases, because a browser reaches it by either. */
export const DEFAULT_HOST_ORIGINS: readonly string[] = ['http://localhost:5174', 'http://127.0.0.1:5174']

/** A bare origin and nothing else: no path, no query, no trailing slash. */
const isOrigin = (value: unknown) => { try { return typeof value === 'string' && new URL(value).origin === value } catch { return false } }

/** A connection that holds nothing, for every case where the SDK declines to install itself. */
const idle = () => ({ dispose() { /* Nothing was installed, so nothing has to be taken down. */ } })

/*
 * The live connection of this document, if any.
 *
 * A hot reload that replaces a module without running its cleanup calls `connectWeb` again while
 * the previous one is still listening. Two connections mean two overlays, two sets of capturing
 * listeners and two answers to every command. The newer call wins: its adapters close over the
 * component state that has just been rebuilt, whereas the older ones write into a tree that is
 * gone. Refusing the second call would keep the dead one instead, which looks like a workbench
 * that has stopped responding.
 */
let active: { dispose: () => void } | null = null

/** Framework-neutral, development-only integration. No listeners become active before pairing. */
export function connectWeb({ manifest: rawManifest, hostOrigin = DEFAULT_HOST_ORIGINS, adapters = {} }: ConnectWebOptions) {
  const manifest = parseManifest(rawManifest)
  /*
   * Three reasons not to install, and none of them removes the application from the screen.
   *
   * A development integration that throws takes the page down with it — an origin typed one way
   * rather than another left a project blank, which is a far worse day than an unavailable
   * workbench. Each reason says what to correct, once, and hands back a connection that holds
   * nothing. `parseManifest` still throws: an invalid manifest is a programming error, and the
   * integrator calls it themselves.
   */
  const allowed = typeof hostOrigin === 'string' ? [hostOrigin] : [...hostOrigin]
  if (!allowed.length || allowed.some(origin => !isOrigin(origin))) {
    console.warn(`ParamRig: hostOrigin must be one or more workbench origins such as "http://localhost:5174", but is ${JSON.stringify(hostOrigin)}. The page is left untouched.`)
    return idle()
  }
  if (manifest.origin !== location.origin) {
    console.warn(`ParamRig: this page is at ${location.origin} and .paramrig/manifest.json declares ${manifest.origin}. Open the page at the manifest origin, or set the manifest's "origin" to ${location.origin}. The page is left untouched.`)
    return idle()
  }
  // Outside a frame there is no workbench to answer, so the SDK installs nothing at all: no
  // listener, no observer, no overlay, and not one line in the console. A developer opening their
  // own page has no reason to know this module is in the bundle.
  if (window.parent === window) return idle()
  if (active) {
    console.warn('ParamRig: connectWeb was called again before the previous connection was disposed. The previous one is replaced; call dispose() in the effect cleanup and in the hot-reload handler.')
    active.dispose()
  }
  let sessionId = ''
  let pairedOrigin = ''
  const instanceId = crypto.randomUUID()
  let mode: 'browse' | 'select' | 'annotate' = 'browse'
  let tool: WebMark['tool'] = 'note'
  let color = '#df7757'
  let displayScale = 1
  let activeTarget: string | undefined
  let activeTargets: string[] = []
  let activeMarks: string[] = []
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
  let lastInstrumented = ''
  let instrumented: WebTarget[] = []
  let chrome: WebChrome = { outline: '#488a99', chip: '#1e2423', chipText: '#eef2f1' }
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
  /** `story-card` reads as `Story card`: a declared identifier is a name, not a slug. */
  const named = (id: string) => { const words = id.replace(/[-_]+/g, ' ').trim(); return words ? words[0]!.toUpperCase() + words.slice(1) : '' }
  /*
   * What a person calls this element. The declared label wins, then the identifier the integration
   * chose, then the accessible name, then the words on screen. The last resort still says which
   * element it is: an inspector headed `div` names nothing.
   */
  const label = (el: Element) => {
    const declared = el.getAttribute('data-paramrig-label')
    if (declared) return declared.slice(0, 90)
    const id = el.getAttribute('data-paramrig-id')
    if (id && named(id)) return named(id).slice(0, 60)
    const aria = el.getAttribute('aria-label')
    if (aria) return aria.slice(0, 90)
    // Leaf-ish elements only: a container's text is its whole subtree, which names nothing.
    const content = el.matches('a,button,p,h1,h2,h3,h4,h5,h6,label,span,li,em,strong,small,figcaption,summary,td,th,dt,dd,legend') ? (el.textContent ?? '').trim().replace(/\s+/g, ' ') : ''
    return (content || `Unnamed ${el.localName}`).slice(0, 60)
  }
  /** How many of the manifest's controls reach this element, counted where the manifest lives. */
  const controlCount = (el: Element) => {
    const stable = ownStable(el)
    if (!stable) return 0
    return new Set(manifest.bindings.filter(b => applies(b) && b.scope === 'element' && b.target?.id === stable.id
      && (b.target.instance === undefined || b.target.instance === stable.instance)).map(b => b.paramId)).size
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
    return { key, stable, selector: sel, fingerprint: fingerprint(el), label: label(el), tag: el.localName, ...(source ? { source } : {}), pageId: pageId(), rect: { x: r.x, y: r.y, width: r.width, height: r.height }, clip, ancestors: parents, controls: controlCount(el), status: stable ? elements(stable, true).length === 1 ? 'resolved' : 'ambiguous' : 'provisional' }
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
  /*
   * Every instrumented element on the page, so the workspace can say where the controls are without
   * a person having to guess which element to click. Rebuilt only when the cast changes: the boxes
   * in it go stale as the page scrolls, and nothing reads them — a target is reselected through its
   * stable key, which is re-described at that moment.
   */
  function pageTargets(): WebTarget[] {
    const els = [...document.querySelectorAll('[data-paramrig-id]')].slice(0, 200)
    const signature = `${pageId()}|${els.map(el => `${el.getAttribute('data-paramrig-id')}/${ownStable(el)?.instance ?? ''}`).join(',')}`
    if (signature !== lastInstrumented) { lastInstrumented = signature; instrumented = els.map(el => describe(el, false)) }
    return instrumented
  }
  function context(): WebContext {
    const scrollers: WebContext['scrollers'] = []
    for (const el of document.querySelectorAll('[data-paramrig-id]')) if (el.scrollTop || el.scrollLeft) scrollers.push({ target: describe(el, false), x: el.scrollLeft, y: el.scrollTop })
    return { pageId: pageId(), url: location.href, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, scroll: { x: scrollX, y: scrollY }, scrollers }
  }
  function send(payload: SDKEvent) { if (sessionId && pairedOrigin && !disposed) window.parent.postMessage(envelope(sessionId, payload), pairedOrigin) }
  function draw() {
    svg.replaceChildren()
    delete host.dataset.hover
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
      const group = clippedGroup(t)
      const rect = document.createElementNS(svgNS, 'rect')
      for (const key of ['x', 'y', 'width', 'height'] as const) rect.setAttribute(key, String(t.rect[key]))
      rect.setAttribute('fill', `${chrome.outline.slice(0, 7)}14`); rect.setAttribute('stroke', chrome.outline); rect.setAttribute('stroke-width', '1.5'); group.append(rect)
      if (t === hover) caption(group, t)
    }
    for (const m of [...marks.filter(m => m.id !== draft?.id), ...(draft ? [draft] : [])]) {
      if (m.pageId !== pageId()) continue
      const pts = markPoints(m, [...targets, ...(dragTarget ? [dragTarget] : [])], { x: scrollX, y: scrollY })
      if (!pts) continue
      const group = clippedGroup(m.targetKey ? [...targets, ...(dragTarget ? [dragTarget] : [])].find(t => t.key === m.targetKey) : undefined)
      const path = document.createElementNS(svgNS, 'path')
      const own = mode !== 'annotate' || activeMarks.includes(m.id)
      path.setAttribute('d', pathForMark(m, pts)); path.setAttribute('stroke', m.color); path.setAttribute('stroke-width', String(m.width)); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('fill', m.tool === 'highlight' ? `${m.color}33` : m.tool === 'note' ? m.color : 'none'); group.append(path)
      // Another comment's marks stay visible while drawing, but faintly, because they cannot be
      // grabbed: a handle that answers the pointer and then edits someone else's comment is worse
      // than one that is plainly out of reach.
      if (!own) path.setAttribute('opacity', '.35')
      if (mode === 'annotate' && own) for (const p of [pts[0], pts.at(-1)].filter((p): p is Point => !!p)) {
        const dot = document.createElementNS(svgNS, 'circle'); dot.setAttribute('cx', String(p.x)); dot.setAttribute('cy', String(p.y)); dot.setAttribute('r', '3'); dot.setAttribute('fill', m.color); group.append(dot)
      }
    }
  }
  /*
   * The name of the element under the pointer, and how many controls reach it. Without it an
   * instrumented element looks exactly like every other one, and the only way to find the controls
   * is to click around until the inspector fills. Drawn in the page's own coordinates, so it is
   * divided by the display scale to stay the same size on the workbench's screen.
   */
  function caption(group: Element, t: WebTarget) {
    const scale = 1 / Math.max(.05, displayScale)
    const size = 11 * scale
    const height = 18 * scale
    const pad = 6 * scale
    const words = t.controls ? `${t.label} · ${t.controls} control${t.controls === 1 ? '' : 's'}` : t.label
    // The overlay's root is closed, so what it says about the element under the pointer is readable
    // from its own host element and nowhere else.
    host.dataset.hover = words
    const box = document.createElementNS(svgNS, 'rect')
    const text = document.createElementNS(svgNS, 'text')
    text.textContent = words
    text.setAttribute('font-family', 'system-ui, -apple-system, Segoe UI, sans-serif')
    text.setAttribute('font-size', String(size)); text.setAttribute('fill', chrome.chipText); text.setAttribute('dominant-baseline', 'central')
    group.append(box, text)
    // jsdom has no text metrics; the estimate keeps the unit tests able to draw an overlay.
    const width = Math.min((text.getComputedTextLength?.() ?? words.length * size * .55) + pad * 2, innerWidth)
    const x = Math.max(0, Math.min(innerWidth - width, t.rect.x))
    const y = t.rect.y - height - 2 * scale >= 0 ? t.rect.y - height - 2 * scale : Math.min(innerHeight - height, t.rect.y + 2 * scale)
    for (const [key, value] of [['x', x], ['y', y], ['width', width], ['height', height], ['rx', 3 * scale]] as const) box.setAttribute(key, String(value))
    box.setAttribute('fill', chrome.chip); box.setAttribute('stroke', chrome.outline); box.setAttribute('stroke-width', String(scale))
    text.setAttribute('x', String(x + pad)); text.setAttribute('y', String(y + height / 2))
  }
  function refresh() {
    frame = 0
    if (!sessionId || disposed) return
    targets = targets.map(t => resolve(t).target)
    if (hover) { const el = resolvedElements.get(hover.key); hover = el?.isConnected ? describe(el) : null }
    const drawing = JSON.stringify([hover, targets, activeTargets, marks, draft, mode, scrollX, scrollY])
    if (drawing !== lastDrawing) { draw(); lastDrawing = drawing }
    const c = context(); const page = pageTargets(); const signature = JSON.stringify([c, targets, lastInstrumented])
    if (signature !== lastScene) { lastScene = signature; send({ type: 'scene', context: c, targets, page }) }
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
    if (event.source !== window.parent || !isEnvelope(event.data)) return
    // Until a workbench has been accepted, any of the declared origins may speak; the `hello` that
    // opens the session pins the one that sent it, and nothing else is heard from afterwards.
    if (pairedOrigin ? event.origin !== pairedOrigin : !allowed.includes(event.origin)) return
    const msg = event.data
    if (msg.payload.type === 'hello') {
      if (msg.payload.projectId !== manifest.id) return
      if (msg.version !== WEB_PROTOCOL) { window.parent.postMessage(envelope(msg.sessionId, { type: 'error', message: 'Incompatible web protocol. Update the project integration.' }), event.origin); return }
      pairedOrigin = event.origin
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
      if (p.chrome) chrome = p.chrome
      if (mode === 'browse') hover = null
      tool = p.tool; color = p.color; targets = p.targets; marks = p.marks; activeTarget = p.activeTarget
      activeTargets = p.activeTargets ?? (p.activeTarget ? [p.activeTarget] : [])
      activeMarks = p.activeMarks ?? marks.map(m => m.id)
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
    for (const m of [...marks].reverse().filter(m => m.pageId === pageId() && activeMarks.includes(m.id))) {
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
  /*
   * The pointer left the page. Without this the last outline stays drawn for good — usually the one
   * around the whole document — and follows the workspace into review, snapshots and every capture
   * taken afterwards.
   */
  function leave(event: PointerEvent) {
    if (!isEditing() || event.relatedTarget || !hover) return
    hover = null; schedule()
  }
  function blur() { cancel(); if (hover) { hover = null; schedule() } }
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
  window.addEventListener('click', click, true); window.addEventListener('keydown', key, true); window.addEventListener('blur', blur)
  window.addEventListener('pointerout', leave, true); window.addEventListener('pointerleave', leave, true)
  /*
   * The host cannot know when the application finished booting, so the SDK says so itself. Until
   * this frame arrives the host is guessing, and a guess costs a whole retry interval.
   *
   * Where to address it. `location.ancestorOrigins` names the parent outright in Chrome and Safari;
   * Firefox has no such list, and `document.referrer` is the next best hint. When either answers,
   * the announcement goes to that exact origin and the browser has nothing to warn about — which
   * is what a workbench reached by either of its aliases needs, since the frame cannot know in
   * advance which one a person typed. Otherwise it goes to '*'. That is the one relaxation here,
   * and it is narrow: the announcement carries the project identifier and a random instance
   * identifier, nothing secret, and it grants nothing. The session is opened by the `hello` that
   * answers, whose origin has to be one of the declared ones, and every message after it — in
   * either direction — is checked against that single pinned origin.
   *
   * It is deliberately posted even when the parent turns out not to be a declared origin, so that
   * a workbench opened at an address the project has not listed can say so instead of timing out.
   */
  const framedBy = (): string | undefined => {
    const ancestor = location.ancestorOrigins?.[0]
    if (isOrigin(ancestor)) return ancestor
    try { return document.referrer ? new URL(document.referrer).origin : undefined } catch { return undefined }
  }
  window.parent.postMessage(announcement(manifest.id, instanceId), framedBy() ?? '*')
  let previousPage = pageId()
  const heartbeat = setInterval(() => {
    if (!sessionId) return
    if (previousPage !== pageId()) { previousPage = pageId(); restore(); readSource(); applyValues(); ready() }
    schedule()
  }, 750)
  const connection = {
    dispose() {
      if (active === connection) active = null
      disposed = true; cancel(); restore(); document.documentElement.style.touchAction = originalTouchAction; host.remove(); observer.disconnect(); resize.disconnect(); clearInterval(heartbeat); cancelAnimationFrame(frame)
      window.removeEventListener('message', message); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule)
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('click', click, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur)
      window.removeEventListener('pointerout', leave, true); window.removeEventListener('pointerleave', leave, true)
    },
  }
  active = connection
  return connection
}
