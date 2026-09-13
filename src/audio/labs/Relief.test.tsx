import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { Relief } from './Relief'
import { ReliefGrips } from './ReliefGrips'
import { reliefLayout } from './reliefLayout'
import { reliefMarks } from './marks'
import { generateSound, type LabRender } from './generate'
import { DEFAULT_CRITERIA } from './model'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps a reserve grip alive through detaching, successive edits and Escape before new audio arrives', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 930, 420))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.stubGlobal('PointerEvent', MouseEvent)
  const original = generateSound(DEFAULT_CRITERIA, 17)
  const measured: LabRender = {
    sound: original, samples: { left: new Float32Array(64), right: new Float32Array(64) },
    peak: 0.5, rms: 0.1, preview: [], wave: new Float32Array(64), shape: { topDb: -6, spreadAll: 0 },
    spectrum: { columns: 64, rows: 32, values: new Float32Array(64 * 32).fill(0.5), minHz: 40, maxHz: 20000 },
  }
  const changed = vi.fn(), cancelled = vi.fn()
  function Harness() {
    const [sound, setSound] = useState(original)
    const [pending, setPending] = useState(false)
    return <Relief render={pending ? null : measured} sound={sound} playing={null} loading={false}
      view="spectrum" onView={() => undefined} durationMs={700} empty={false} name="Kept sound"
      grips={{
        begin: () => { setSound({ ...original, id: 'editable-copy' }); setPending(true) },
        change: (control, value) => { changed(control, value); setSound((was) => ({ ...was, fingerprint: `edited-${value}` })) },
        cancel: () => { cancelled(); setSound(original); setPending(false) },
        end: () => undefined, hear: () => undefined, step: () => undefined,
      }} />
  }
  const app = render(<Harness />)
  const space = screen.getByRole('slider', { name: 'Space' })
  Object.assign(space, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
  fireEvent.pointerDown(space, { clientY: 300, button: 0, pointerId: 1 })
  // A click is harmless; detachment only begins when the pointer actually moves.
  expect(app.container.querySelector('.labs-marks')).not.toHaveAttribute('data-held')
  fireEvent.pointerMove(space, { clientY: 260, pointerId: 1 })
  expect(screen.getByRole('slider', { name: 'Space' })).toBe(space)
  expect(app.container.querySelector('.labs-marks')).toHaveAttribute('data-held', 'space')
  const firstValue = changed.mock.lastCall![1]
  // The first edit changes the fingerprint while the worker has supplied no replacement image.
  expect(screen.getByRole('slider', { name: 'Space' })).toBe(space)
  fireEvent.pointerMove(space, { clientY: 220, pointerId: 1 })
  expect(changed.mock.lastCall![1]).toBeGreaterThan(firstValue)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(cancelled).toHaveBeenCalledOnce()
  expect(app.container.querySelector('.labs-marks')).not.toHaveAttribute('data-held')
  expect(screen.getByRole('slider', { name: 'Space' })).toBeInTheDocument()
})

function controls(width = 930) {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const sound = generateSound(DEFAULT_CRITERIA, 17)
  const spectrum = { columns: 64, rows: 32, values: new Float32Array(64 * 32).fill(0.5), minHz: 40, maxHz: 20000 }
  const marks = reliefMarks(sound, spectrum, 700, null).marks.map((mark) => ({ ...mark, value: 0.5 }))
  const handlers = { begin: vi.fn(), change: vi.fn(), end: vi.fn(), cancel: vi.fn(), hear: vi.fn(), step: vi.fn() }
  const app = render(<ReliefGrips marks={marks} spectrum={spectrum} layout={reliefLayout(width, 420, 'spectrum')} handlers={handlers} drawn={false} />)
  const grip = screen.getByRole('slider', { name: 'Grain' })
  Object.assign(grip, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
  return { app, grip, handlers }
}

it('does not edit on a click and cancels a captured drag on pointer cancellation', () => {
  const { grip, handlers } = controls()
  fireEvent.pointerDown(grip, { clientY: 300, button: 0, pointerId: 1 })
  fireEvent.pointerUp(grip, { clientY: 300, pointerId: 1 })
  expect(handlers.begin).not.toHaveBeenCalled()
  expect(handlers.end).not.toHaveBeenCalled()
  fireEvent.pointerDown(grip, { clientY: 300, button: 0, pointerId: 1 })
  fireEvent.pointerMove(grip, { clientY: 260, pointerId: 1 })
  expect(handlers.change.mock.lastCall![1]).toBe(0.7)
  fireEvent.pointerCancel(grip, { pointerId: 1 })
  fireEvent.lostPointerCapture(grip, { pointerId: 1 })
  expect(handlers.cancel).toHaveBeenCalledOnce()
  expect(handlers.end).not.toHaveBeenCalled()
})

it('keeps the same sensitivity on a narrow relief, switches fine mode without a jump and commits once', () => {
  const { grip, handlers } = controls(350)
  fireEvent.pointerDown(grip, { clientY: 300, button: 0, pointerId: 1 })
  fireEvent.pointerMove(grip, { clientY: 260, pointerId: 1 })
  expect(handlers.change.mock.lastCall![1]).toBe(0.7)
  fireEvent.pointerMove(grip, { clientY: 260, shiftKey: true, pointerId: 1 })
  expect(handlers.change).toHaveBeenCalledTimes(1)
  fireEvent.pointerMove(grip, { clientY: 220, shiftKey: true, pointerId: 1 })
  expect(handlers.change.mock.lastCall![1]).toBe(0.75)
  fireEvent.pointerUp(grip, { pointerId: 1 })
  fireEvent.lostPointerCapture(grip, { pointerId: 1 })
  expect(handlers.begin).toHaveBeenCalledOnce()
  expect(handlers.end).toHaveBeenCalledOnce()
})

it('accepts an exact value, rejects blank/out-of-range input, and Escape returns focus without editing', () => {
  const { grip, handlers } = controls()
  fireEvent.doubleClick(grip)
  const input = screen.getByRole('textbox', { name: 'Grain percent' })
  expect(input).toHaveFocus()
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(handlers.step).not.toHaveBeenCalled()
  expect(input).toHaveAttribute('aria-invalid', 'true')
  fireEvent.change(input, { target: { value: '120' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(handlers.step).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: '63' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(handlers.step).toHaveBeenCalledWith(expect.any(Number), 0.63)
  expect(grip).toHaveFocus()
  fireEvent.keyDown(grip, { key: 'Enter' })
  const again = screen.getByRole('textbox', { name: 'Grain percent' })
  fireEvent.change(again, { target: { value: '20' } })
  fireEvent.keyDown(again, { key: 'Escape' })
  expect(handlers.step).toHaveBeenCalledOnce()
  expect(grip).toHaveFocus()
  fireEvent.keyDown(grip, { key: 'ArrowUp' })
  expect(handlers.step.mock.lastCall![1]).toBe(0.51)
})
