import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RigSession } from '@/state/session'
import { tidalPlanetManifest } from '@/rigs/examples/tidal-planet'
import { Timeline } from '@/workspace/Timeline'

function Editor({ session }: { session: RigSession }) {
  useSyncExternalStore(session.subscribe, () => session.getRevision())
  return <Timeline session={session} />
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('timeline interaction transactions', () => {
  it('discards uncommitted controller text on Escape without creating history', async () => {
    const session = new RigSession(tidalPlanetManifest)
    render(<Editor session={session} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Rotation Y keyframe at 2.40 s, value 108' }))
    const input = await screen.findByRole('spinbutton', { name: 'Rotation Y' })
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '170' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(session.trackFor('rotationY')!.keyframes[1]!.value).toBe(108)
    expect(session.canUndo()).toBe(false)
    expect(input).toHaveValue('108')
  })

  it('edits the clicked key through its controller and copies the updated value', async () => {
    const session = new RigSession(tidalPlanetManifest)
    session.setPlayhead(7)
    render(<Editor session={session} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Rotation Y keyframe at 2.40 s, value 108' }))
    const panel = await screen.findByRole('dialog', { name: 'Rotation Y keyframe controls' })
    const input = within(panel).getByRole('spinbutton', { name: 'Rotation Y' })
    expect(session.playheadTime()).toBe(2.4)
    expect(session.canUndo()).toBe(false)
    fireEvent.change(input, { target: { value: '150' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(session.trackFor('rotationY')!.keyframes.map(frame => frame.value)).toEqual([0, 150, 360])
    expect(input).toHaveAttribute('aria-valuenow', '150')
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy keyframe' }))
    const ruler = screen.getByRole('slider', { name: 'Playhead' })
    fireEvent.keyDown(ruler, { key: 'End' })
    fireEvent.keyDown(ruler, { key: 'v', metaKey: true })
    expect(session.trackFor('rotationY')!.keyframes.at(-1)!.value).toBe(150)
    act(() => { session.undo(); session.undo() })
    expect(session.trackFor('rotationY')!.keyframes.map(frame => frame.value)).toEqual([0, 108, 360])
  })

  it('groups controller dragging into one undo and cancels an interrupted gesture', async () => {
    const session = new RigSession(tidalPlanetManifest)
    const editor = render(<Editor session={session} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Rotation Y keyframe at 2.40 s, value 108' }))
    const field = await screen.findByRole('spinbutton', { name: 'Rotation Y' })
    const gauge = field.closest('.number-value')!
    fireEvent.pointerDown(gauge, { pointerId: 1, button: 0, clientX: 40 })
    fireEvent.pointerMove(gauge, { pointerId: 1, buttons: 1, clientX: 70 })
    fireEvent.pointerMove(gauge, { pointerId: 1, buttons: 1, clientX: 100 })
    fireEvent.pointerUp(gauge, { pointerId: 1, clientX: 100 })
    expect(session.history().labels).toEqual(['Session start', 'Adjust Rotation Y keyframe'])
    expect(session.trackFor('rotationY')!.keyframes[1]!.value).toBeGreaterThan(108)
    act(() => session.undo())
    expect(session.trackFor('rotationY')!.keyframes[1]!.value).toBe(108)
    fireEvent.pointerDown(gauge, { pointerId: 2, button: 0, clientX: 40 })
    fireEvent.pointerMove(gauge, { pointerId: 2, buttons: 1, clientX: 90 })
    editor.unmount()
    expect(session.trackFor('rotationY')!.keyframes[1]!.value).toBe(108)
    expect(session.isGesturing()).toBe(false)
    expect(session.canRedo()).toBe(true)
  })

  it('creates a key at the clicked row time only when its controller changes', async () => {
    const session = new RigSession(tidalPlanetManifest)
    render(<Editor session={session} />)
    const plane = document.querySelector('.tl-track .tl-plane')!
    vi.spyOn(plane, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 400 } as DOMRect)
    fireEvent.contextMenu(plane, { clientX: 300 })
    const field = await screen.findByRole('spinbutton', { name: 'Rotation Y' })
    expect(session.trackFor('rotationY')!.keyframes).toHaveLength(3)
    expect(session.canUndo()).toBe(false)
    expect(field).toHaveAttribute('aria-valuemin', '0')
    expect(field).toHaveAttribute('aria-valuemax', '360')
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    fireEvent.keyUp(field, { key: 'ArrowUp' })
    expect(session.trackFor('rotationY')!.keyframes.find(frame => frame.time === 4)?.value).toBe(181)
    fireEvent.click(screen.getByRole('button', { name: 'Delete track' }))
    expect(session.trackFor('rotationY')).toBeUndefined()
    act(() => session.undo())
    expect(session.trackFor('rotationY')!.keyframes).toHaveLength(4)
    act(() => session.undo())
    expect(session.trackFor('rotationY')!.keyframes).toHaveLength(3)
  })

  it('right-clicks a different key without deleting the old selection', async () => {
    const session = new RigSession(tidalPlanetManifest)
    render(<Editor session={session} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rotation Y keyframe at 0.00 s, value 0' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Rotation Y keyframe at 2.40 s, value 108' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete keyframe' }))
    expect(session.trackFor('rotationY')!.keyframes.map(frame => frame.time)).toEqual([0, 8])
    expect(session.isGesturing()).toBe(false)
    act(() => session.undo())
    expect(session.trackFor('rotationY')!.keyframes).toHaveLength(3)
  })

  it('preserves a multi-selection when opening its context menu', async () => {
    const session = new RigSession(tidalPlanetManifest)
    render(<Editor session={session} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rotation Y' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Rotation Y keyframe at 2.40 s, value 108' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete selected keyframes' }))
    expect(session.trackFor('rotationY')).toBeUndefined()
    expect(session.trackFor('keyDirection')).toBeDefined()
    expect(session.history().labels).toEqual(['Session start', 'Delete keyframes'])
    act(() => session.undo())
    expect(session.trackFor('rotationY')!.keyframes).toHaveLength(3)
  })

  it('inserts a key at the clicked row coordinate, not the playhead', async () => {
    const session = new RigSession(tidalPlanetManifest)
    render(<Editor session={session} />)
    const plane = document.querySelector('.tl-track .tl-plane')!
    vi.spyOn(plane, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 400 } as DOMRect)
    fireEvent.contextMenu(plane, { clientX: 300 })
    fireEvent.click(await screen.findByRole('button', { name: 'Add keyframe here' }))
    expect(session.trackFor('rotationY')!.keyframes.some(frame => frame.time === 4 && frame.value === 180)).toBe(true)
    expect(session.playheadTime()).toBe(4)
  })

  it('opens easing actions from the keyboard and undoes the change', async () => {
    const session = new RigSession(tidalPlanetManifest)
    render(<Editor session={session} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Rotation Y keyframe at 2.40 s, value 108' }), { key: 'F10', shiftKey: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Easing: Ease in' }))
    expect(session.trackFor('rotationY')!.keyframes[1]!.easing).toBe('ease-in')
    act(() => session.undo())
    expect(session.trackFor('rotationY')!.keyframes[1]!.easing).toBeUndefined()
  })

  it('uses the playhead for keyboard range actions and only hides the chosen group', async () => {
    const session = new RigSession(tidalPlanetManifest)
    session.setPlayhead(2)
    render(<Editor session={session} />)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Playhead' }), { key: 'F10', shiftKey: true })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Set range start here' }))
    expect(session.getSnapshot().loopRange).toEqual({ start: 2, end: 8 })
    fireEvent.contextMenu(screen.getByRole('button', { name: /Animation\s*1/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hide group tracks' }))
    expect(screen.queryByRole('button', { name: 'Rotation Y' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Light direction' })).toBeInTheDocument()
    expect(session.trackFor('rotationY')!.keyframes).toHaveLength(3)
  })
  it('finishes a drag outside the key after selecting it changes the layout', () => {
    const session = new RigSession(tidalPlanetManifest)
    render(<Editor session={session} />)
    const key = screen.getByRole('button', { name: 'Rotation Y keyframe at 2.40 s, value 108' })
    fireEvent.pointerDown(key, { pointerId: 1, button: 0, clientX: 100 })
    expect(screen.getByRole('textbox', { name: 'Time' })).toBeInTheDocument()
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 120 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 140 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 140 })
    expect(session.isGesturing()).toBe(false)
    expect(session.trackFor('rotationY')!.keyframes[1]!.time).toBeCloseTo(3.1666666667)
    expect(session.history().labels).toEqual(['Session start', 'Move keyframes'])
    act(() => session.undo())
    expect(session.trackFor('rotationY')!.keyframes[1]!.time).toBe(2.4)
  })

  it('cancels an interrupted drag without recording it or losing redo', () => {
    const session = new RigSession(tidalPlanetManifest)
    session.setValue('seed', 10)
    session.undo()
    render(<Editor session={session} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Rotation Y keyframe at 2.40 s, value 108' }), { pointerId: 1, button: 0, clientX: 100 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 130 })
    fireEvent.blur(window)
    expect(session.isGesturing()).toBe(false)
    expect(session.trackFor('rotationY')!.keyframes[1]!.time).toBe(2.4)
    expect(session.canRedo()).toBe(true)
  })

  it('copies and pastes selected keys by keyboard, then deletes them in one action', () => {
    const session = new RigSession(tidalPlanetManifest)
    render(<Editor session={session} />)
    const key = screen.getByRole('button', { name: 'Rotation Y keyframe at 2.40 s, value 108' })
    fireEvent.click(key, { detail: 0 })
    fireEvent.keyDown(key, { key: 'c', metaKey: true })
    const ruler = screen.getByRole('slider', { name: 'Playhead' })
    fireEvent.keyDown(ruler, { key: 'End' })
    fireEvent.keyDown(ruler, { key: 'v', metaKey: true })
    expect(session.trackFor('rotationY')!.keyframes.at(-1)!.value).toBe(108)
    expect(session.history().labels).toEqual(['Session start', 'Paste keyframes'])
    fireEvent.keyDown(ruler, { key: 'Delete' })
    expect(session.trackFor('rotationY')!.keyframes).toHaveLength(2)
    act(() => { session.undo(); session.undo() })
    expect(session.trackFor('rotationY')!.keyframes.at(-1)!.value).toBe(360)
  })
})
