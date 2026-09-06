import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { move, resize } from './crop'
import { ScreenCapture } from './ScreenCapture'

const image = 'data:image/png;base64,cropme'

/** A frame 200 × 100 on screen, so a percentage and a pixel are easy to tell apart. */
function frameBox() {
  vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, toJSON: () => ({}) })
}

describe('the crop rectangle', () => {
  it('never lets an edge cross the one opposite it, or leave the frame', () => {
    const full = { x: 0, y: 0, width: 100, height: 100 }
    expect(resize(full, 'e', { x: 40, y: 50 })).toEqual({ x: 0, y: 0, width: 40, height: 100 })
    expect(resize(full, 'w', { x: 30, y: 50 })).toEqual({ x: 30, y: 0, width: 70, height: 100 })
    expect(resize(full, 'se', { x: 60, y: 70 })).toEqual({ x: 0, y: 0, width: 60, height: 70 })
    // Dragging an edge past its opposite stops at the smallest rectangle rather than inverting.
    expect(resize({ x: 20, y: 0, width: 40, height: 100 }, 'e', { x: 0, y: 50 })).toEqual({ x: 20, y: 0, width: 5, height: 100 })
    expect(resize(full, 'n', { x: 0, y: -40 })).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('moves as one piece and stops at the frame', () => {
    const box = { x: 10, y: 10, width: 20, height: 20 }
    expect(move(box, { x: 5, y: -5 })).toEqual({ x: 15, y: 5, width: 20, height: 20 })
    expect(move(box, { x: 500, y: 500 })).toEqual({ x: 80, y: 80, width: 20, height: 20 })
    expect(move(box, { x: -500, y: -500 })).toEqual({ x: 0, y: 0, width: 20, height: 20 })
  })
})

describe('cropping a captured frame', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('offers the eight grips and the exact numbers behind a fold', () => {
    render(<ScreenCapture image={image} onSave={async () => {}} onCancel={() => {}} />)
    expect(screen.getAllByRole('button', { name: /edge$/ })).toHaveLength(8)
    expect(screen.getByText('Exact crop').closest('details')).not.toBeNull()
  })

  it('follows a drag on a corner', () => {
    frameBox()
    render(<ScreenCapture image={image} onSave={async () => {}} onCancel={() => {}} />)
    const handle = screen.getByRole('button', { name: 'Bottom right edge' })
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(document.querySelector('.web-capture-crop')!, { clientX: 100, clientY: 50, pointerId: 1 })
    const box = document.querySelector('.web-crop-box') as HTMLElement
    expect(box.style.width).toBe('50%')
    expect(box.style.height).toBe('50%')
  })

  it('moves the rectangle with the arrow keys', () => {
    render(<ScreenCapture image={image} onSave={async () => {}} onCancel={() => {}} />)
    const box = document.querySelector('.web-crop-box') as HTMLElement
    fireEvent.keyDown(box, { key: 'ArrowRight' })
    // A full-frame rectangle has nowhere to go; one shrunk by a corner does.
    expect(box.style.left).toBe('0%')
  })

  it('cuts the same pixels the four fields used to cut', async () => {
    const drawImage = vi.fn()
    // jsdom has neither decode() nor intrinsic sizes; the crop maths is what is under test.
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, writable: true, value: () => Promise.resolve() })
    Object.defineProperty(HTMLImageElement.prototype, 'width', { configurable: true, get: () => 800 })
    Object.defineProperty(HTMLImageElement.prototype, 'height', { configurable: true, get: () => 600 })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,cropped')
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ScreenCapture image={image} onSave={onSave} onCancel={() => {}} />)
    // 25 / 10 / 50 / 40 in percent is the frame the numeric fields describe, and the arithmetic
    // behind the saved image has not moved: 800 × 600 cut at those percentages.
    for (const [label, value] of [['X', 25], ['Y', 10], ['Width', 50], ['Height', 40]] as const) {
      fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value: String(value) } })
      fireEvent.blur(screen.getByLabelText(label, { exact: false }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save capture' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('data:image/png;base64,cropped'))
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 200, 60, 400, 240, 0, 0, 400, 240)
  })
})
