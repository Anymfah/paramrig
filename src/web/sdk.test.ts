import { afterEach, describe, expect, it, vi } from 'vitest'
import example from '../../examples/web/manifest.json'
import { connectWeb } from './sdk'
import { envelope, isAnnouncement, parseManifest, type HostCommand, type SDKAnnouncement, type SDKEvent } from './contracts'

const hostOrigin = 'http://localhost:5174'
let connection: ReturnType<typeof connectWeb> | null = null
const ownParent = Object.getOwnPropertyDescriptor(window, 'parent')
afterEach(() => {
  connection?.dispose(); connection = null; vi.restoreAllMocks()
  if (ownParent) Object.defineProperty(window, 'parent', ownParent); else Reflect.deleteProperty(window, 'parent')
  document.body.replaceChildren(); document.documentElement.removeAttribute('style')
})

/*
 * The SDK only installs itself inside a frame, so the tests have to be inside one.
 *
 * jsdom answers `window.parent` with the window itself, which is the very case the SDK now declines
 * — and declining it is what these tests are here to hold. A stub in that slot both restores the
 * framed path and gives the posts somewhere honest to land: the announcement and every later
 * envelope are addressed to the parent, not broadcast at the page.
 */
function frame(posted: unknown[]) {
  const parent = { postMessage: (message: unknown) => { posted.push(message) } } as unknown as Window
  Object.defineProperty(window, 'parent', { configurable: true, get: () => parent })
  return parent
}
function setup({ pair = true, host }: { pair?: boolean; host?: string | readonly string[] } = {}) {
  const manifest = parseManifest({ ...example, origin: location.origin, pages: [{ id: 'home', name: 'Home', path: location.pathname }] })
  document.body.innerHTML = '<main><h1 data-paramrig-id="hero-title">Original</h1><article data-paramrig-id="story-card" data-paramrig-instance="coast"><button data-paramrig-id="action">Read coast</button></article><article data-paramrig-id="story-card" data-paramrig-instance="forest"><button data-paramrig-id="action">Read forest</button></article><button id="plain">Plain button</button></main>'
  const events: SDKEvent[] = []
  const posted: unknown[] = []
  const parent = frame(posted)
  vi.spyOn(parent, 'postMessage').mockImplementation(message => { posted.push(message); if ((message as { payload?: SDKEvent }).payload) events.push((message as { payload: SDKEvent }).payload) })
  if (!globalThis.CSS?.escape) vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch}`) })
  connection = connectWeb({ manifest, hostOrigin: host })
  const send = (payload: HostCommand, origin = hostOrigin, sessionId = 'test-session') => window.dispatchEvent(new MessageEvent('message', { origin, source: parent, data: envelope(sessionId, payload) }))
  if (pair) send({ type: 'hello', projectId: manifest.id })
  const announcements = () => posted.filter((m): m is SDKAnnouncement => isAnnouncement(m))
  return { manifest, events, send, posted, announcements, parent }
}
const configure = (mode: 'browse' | 'select' | 'annotate'): HostCommand => ({ type: 'configure', mode, tool: 'note', color: '#df7757', targets: [], marks: [] })

describe('page-side web integration', () => {
  it('announces itself the moment it listens, and does nothing else until the host answers', () => {
    const { manifest, events, send, announcements } = setup({ pair: false })
    expect(announcements().map(a => a.projectId)).toEqual([manifest.id])
    expect(events).toEqual([])
    // Announced is not paired: no overlay, no listener acting, nothing sent.
    expect(document.querySelector('paramrig-overlay')).toBeNull()
    const button = document.querySelector('#plain')!
    const clicked = vi.fn(); button.addEventListener('click', clicked)
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(events).toEqual([])
    expect(clicked).toHaveBeenCalledOnce()
    send({ type: 'hello', projectId: manifest.id })
    const ready = events.find(e => e.type === 'ready')
    expect(ready?.type).toBe('ready')
    if (ready?.type === 'ready') expect(ready.instanceId).toBe(announcements()[0]!.instanceId)
    expect(announcements()).toHaveLength(1)
  })

  it('names an element the way a person would, and never with a bare tag', () => {
    const { send, events } = setup(); send(configure('select'))
    document.body.insertAdjacentHTML('beforeend', '<section id="plain-box"><h2 data-paramrig-id="story-title" data-paramrig-label="The card heading">Coast</h2><h3 data-paramrig-id="hero-title">Ignored text</h3><nav aria-label="Fieldnotes navigation"><em>menu</em></nav><div id="bare"><i>x</i></div></section>')
    const named = (selector: string) => {
      document.querySelector(selector)!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
      return events.filter(e => e.type === 'selection').at(-1)!.target
    }
    expect(named('[data-paramrig-label]').label).toBe('The card heading')
    expect(named('#plain-box h3').label).toBe('Hero title')
    expect(named('#plain-box nav').label).toBe('Fieldnotes navigation')
    expect(named('#plain-box em').label).toBe('menu')
    expect(named('#bare').label).toBe('Unnamed div')
    // The count travels with the target, so the page can label its own outline with it.
    expect(named('#plain-box h3').controls).toBe(2)
    expect(named('#bare').controls).toBe(0)
  })

  it('labels the element under the pointer, and drops the outline when the pointer leaves', async () => {
    const { send } = setup()
    const title = document.querySelector('h1')!
    send(configure('select'))
    title.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }))
    const overlay = () => document.querySelector('paramrig-overlay') as HTMLElement
    await vi.waitFor(() => expect(overlay().dataset.hover).toBe('Hero title · 2 controls'))
    window.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
    await vi.waitFor(() => expect(overlay().dataset.hover).toBeUndefined())
    // Escape and a return to browsing clear it too.
    title.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }))
    await vi.waitFor(() => expect(overlay().dataset.hover).toBe('Hero title · 2 controls'))
    send(configure('browse'))
    await vi.waitFor(() => expect(overlay().dataset.hover).toBeUndefined())
  })

  it('accepts only the paired parent origin and session', () => {
    const { send } = setup()
    send({ type: 'values', values: { accent: '#123456' }, source: false }, 'https://untrusted.example')
    expect(document.documentElement.style.getPropertyValue('--fn-accent')).toBe('')
    send({ type: 'values', values: { accent: '#123456' }, source: false }, hostOrigin, 'wrong-session')
    expect(document.documentElement.style.getPropertyValue('--fn-accent')).toBe('')
    send({ type: 'values', values: { accent: '#123456' }, source: false })
    expect(document.documentElement.style.getPropertyValue('--fn-accent')).toBe('#123456')
  })
  it('restores original inline declarations before source review and on disposal', () => {
    document.documentElement.style.setProperty('--fn-accent', '#bc593d', 'important')
    const { send } = setup()
    send({ type: 'values', values: { accent: '#123456' }, source: false })
    send({ type: 'values', values: {}, source: true })
    expect(document.documentElement.style.getPropertyValue('--fn-accent')).toBe('#bc593d')
    expect(document.documentElement.style.getPropertyPriority('--fn-accent')).toBe('important')
    send({ type: 'values', values: { accent: '#123456' }, source: false }); connection!.dispose(); connection = null
    expect(document.documentElement.style.getPropertyValue('--fn-accent')).toBe('#bc593d')
  })
  it('selects repeated instances precisely and suppresses application clicks only in selection modes', () => {
    const { send, events } = setup(); const buttons = document.querySelectorAll('article button')
    const clicked = vi.fn(); buttons[0]!.addEventListener('click', clicked)
    send(configure('select'))
    buttons[0]!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    buttons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    buttons[1]!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, shiftKey: true }))
    const selected = events.filter(e => e.type === 'selection')
    expect(selected.map(e => e.target.stable?.instance)).toEqual(['coast', 'forest'])
    expect(selected[0]!.target.ancestors[0]!.label).toBe('Story card')
    expect(selected.every(e => e.target.status === 'resolved')).toBe(true); expect(clicked).not.toHaveBeenCalled()
    expect(document.activeElement?.tagName.toLowerCase()).toBe('paramrig-overlay')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    expect(events.filter(e => e.type === 'selection').at(-1)?.target.stable).toEqual({ id: 'story-card', instance: 'forest' })
    send(configure('browse')); buttons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(clicked).toHaveBeenCalledOnce()
  })
  it('does not reattach an uninstrumented target after it is replaced', async () => {
    const { send, events } = setup(); send(configure('select'))
    const plain = document.querySelector('#plain')!
    plain.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    const picked = events.find(e => e.type === 'selection'); expect(picked?.type).toBe('selection')
    if (picked?.type !== 'selection') return
    send({ ...configure('select'), targets: [picked.target] } as HostCommand)
    plain.outerHTML = '<button id="plain">Another item</button>'
    await vi.waitFor(() => { const scenes = events.filter(e => e.type === 'scene'); expect(scenes.at(-1)?.targets[0]?.status).toBe('missing') })
  })
  it('reapplies style controls to components replaced by the framework', async () => {
    const { send } = setup()
    send({ type: 'values', values: { 'card-radius': 20 }, source: false })
    document.querySelector('article')!.outerHTML = '<article data-paramrig-id="story-card" data-paramrig-instance="coast">Updated card</article>'
    await vi.waitFor(() => expect((document.querySelector('article') as HTMLElement).style.borderRadius).toBe('20px'))
    send({ type: 'values', values: {}, source: true })
    expect((document.querySelector('article') as HTMLElement).style.borderRadius).toBe('')
  })
  it('records one relative mark for a pointer gesture and retains it for the same target', () => {
    const { send, events } = setup()
    const el = document.querySelector('h1')!
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 40, width: 200, height: 100, top: 40, left: 20, right: 220, bottom: 140, toJSON: () => ({}) })
    send(configure('select')); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    const selection = events.find(e => e.type === 'selection'); if (selection?.type !== 'selection') throw new Error('Selection missing')
    send({ ...configure('annotate'), tool: 'rectangle', targets: [selection.target], activeTarget: selection.target.key } as HostCommand)
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 40, pointerId: 1 }))
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 220, clientY: 140, pointerId: 1 }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 220, clientY: 140, pointerId: 1 }))
    const marks = events.filter(e => e.type === 'mark')
    expect(marks).toHaveLength(1); expect(marks[0]!.mark.points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    expect(marks[0]!.mark.targetKey).toBe(selection.target.key)
  })
  it('comments on the keyboard selection and returns to browsing with Escape', () => {
    const { send, events } = setup(); send(configure('select'))
    const button = document.querySelector('#plain')!
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true }))
    expect(events.find(e => e.type === 'comment')?.target.label).toBe('Plain button')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(events.at(-1)?.type).toBe('exit-tool')
    const click = vi.fn(); button.addEventListener('click', click)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(click).toHaveBeenCalledOnce()
  })
  it('reveals a target after resizing without replacing the active comment with a selection event', () => {
    const { send, events } = setup(); send(configure('select'))
    const button = document.querySelector('#plain')!
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    const selection = events.find(e => e.type === 'selection')!
    const scroll = vi.fn(); button.scrollIntoView = scroll
    events.length = 0
    send({ type: 'reveal-target', target: selection.target })
    expect(scroll).toHaveBeenCalledOnce()
    expect(events.some(e => e.type === 'selection')).toBe(false)
  })

  it('grabs an endpoint only on the comment that is open', () => {
    const { send, events } = setup()
    const el = document.querySelector('h1')!
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, toJSON: () => ({}) })
    send(configure('select')); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    const target = events.find(e => e.type === 'selection')!.target
    const mark = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tool: 'arrow' as const, color: '#df7757', width: 2, points: [{ x: 0, y: 0 }, { x: .5, y: .5 }], targetKey: target.key, pageId: target.pageId, viewport: { width: 800, height: 600 } }
    const annotate = { ...configure('annotate'), tool: 'arrow', targets: [target], activeTarget: target.key, marks: [mark] } as HostCommand

    // Another comment owns it: the gesture starts a new mark instead of moving that one.
    send({ ...annotate, activeMarks: [] } as HostCommand)
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0, pointerId: 3 }))
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 80, clientY: 80, pointerId: 3 }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 80, clientY: 80, pointerId: 3 }))
    const drawn = events.filter(e => e.type === 'mark')
    expect(drawn).toHaveLength(1)
    expect(drawn[0]!.mark.id).not.toBe(mark.id)

    // The comment that owns it is open: the same gesture moves its endpoint.
    send({ ...annotate, activeMarks: [mark.id] } as HostCommand)
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0, pointerId: 4 }))
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 30, clientY: 30, pointerId: 4 }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 30, clientY: 30, pointerId: 4 }))
    const moved = events.filter(e => e.type === 'mark').at(-1)!
    expect(moved.mark.id).toBe(mark.id)
    expect(moved.mark.points[0]).toEqual({ x: .3, y: .3 })
  })

  it('cancels an unfinished drawing when returning to browse and releases page interaction', () => {
    const { send, events } = setup()
    const button = document.querySelector('#plain')!
    const release = vi.fn(); button.releasePointerCapture = release
    send({ ...configure('annotate'), tool: 'rectangle' } as HostCommand)
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7 }))
    expect(document.documentElement.style.touchAction).toBe('none')
    send(configure('browse'))
    expect(release).toHaveBeenCalledWith(7)
    expect(document.documentElement.style.touchAction).not.toBe('none')
    const click = vi.fn(); button.addEventListener('click', click)
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(click).toHaveBeenCalledOnce()
    send({ ...configure('annotate'), tool: 'rectangle' } as HostCommand)
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }))
    expect(events.some(e => e.type === 'mark')).toBe(false)
  })
})

describe('what the SDK does to a page that is not a workbench preview', () => {
  const page = () => { document.body.innerHTML = '<main><h1 data-paramrig-id="hero-title">Original</h1><button id="plain">Plain button</button></main>' }
  const manifest = () => parseManifest({ ...example, origin: location.origin, pages: [{ id: 'home', name: 'Home', path: location.pathname }] })

  it('installs nothing at all when the page is not in a frame', () => {
    page()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const posted = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const observe = vi.spyOn(MutationObserver.prototype, 'observe')
    const listen = vi.spyOn(window, 'addEventListener')
    connection = connectWeb({ manifest: manifest() })
    expect(posted).not.toHaveBeenCalled()
    expect(observe).not.toHaveBeenCalled()
    expect(listen).not.toHaveBeenCalled()
    expect(document.querySelector('paramrig-overlay')).toBeNull()
    expect([...warn.mock.calls, ...error.mock.calls, ...log.mock.calls]).toEqual([])
    // The page keeps its own clicks, and letting go of a connection that holds nothing is safe.
    const clicked = vi.fn(); document.querySelector('#plain')!.addEventListener('click', clicked)
    document.querySelector('#plain')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicked).toHaveBeenCalledOnce()
    expect(() => { connection?.dispose(); connection?.dispose() }).not.toThrow()
  })

  it('warns once and leaves the application standing when the origins disagree', () => {
    page()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const posted: unknown[] = []
    frame(posted)
    const elsewhere = parseManifest({ ...example, origin: 'http://127.0.0.1:5174', pages: [{ id: 'home', name: 'Home', path: '/' }] })
    expect(() => { connection = connectWeb({ manifest: elsewhere }) }).not.toThrow()
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]![0])).toContain(location.origin)
    expect(String(warn.mock.calls[0]![0])).toContain('http://127.0.0.1:5174')
    expect(posted).toEqual([])
    expect(document.querySelector('paramrig-overlay')).toBeNull()
  })

  it('warns and stands down when the host origin option is not an origin', () => {
    page()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const posted: unknown[] = []
    frame(posted)
    connection = connectWeb({ manifest: manifest(), hostOrigin: 'http://localhost:5174/workbench' })
    expect(warn).toHaveBeenCalledOnce()
    expect(posted).toEqual([])
    connection.dispose()
    connection = connectWeb({ manifest: manifest(), hostOrigin: [] })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(posted).toEqual([])
  })

  it('accepts a hello from any declared origin, and from no other', () => {
    page()
    const { manifest: m, events, send } = setup({ pair: false, host: ['http://localhost:5174', 'http://127.0.0.1:5174'] })
    send({ type: 'hello', projectId: m.id }, 'http://evil.example')
    expect(events).toEqual([])
    send({ type: 'hello', projectId: m.id }, 'http://127.0.0.1:5174')
    expect(events.filter(e => e.type === 'ready')).toHaveLength(1)
    // The origin that answered is the one every later message is checked against, in both
    // directions: the other declared origin is no longer heard once the session is open.
    send(configure('select'), 'http://localhost:5174', 'test-session')
    expect(events.some(e => e.type === 'scene')).toBe(false)
  })

  it('defaults to the workbench own two addresses when no host origin is given', () => {
    page()
    const { manifest: m, events, send } = setup({ pair: false })
    send({ type: 'hello', projectId: m.id }, 'http://127.0.0.1:5174')
    expect(events.filter(e => e.type === 'ready')).toHaveLength(1)
  })

  it('replaces a connection the caller forgot to dispose, rather than running two', () => {
    page()
    const { manifest: m, send } = setup()
    expect(document.querySelectorAll('paramrig-overlay')).toHaveLength(1)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const second = connectWeb({ manifest: m, hostOrigin })
    expect(warn).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('paramrig-overlay')).toHaveLength(0)
    send({ type: 'hello', projectId: m.id })
    expect(document.querySelectorAll('paramrig-overlay')).toHaveLength(1)
    second.dispose()
    expect(document.querySelectorAll('paramrig-overlay')).toHaveLength(0)
  })
})
