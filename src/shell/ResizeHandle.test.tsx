import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResizeCol, ResizeRow } from '@/shell/ResizeHandle'
import { timelineSize } from '@/state/timeline-layout'
import { loadPrefs, savePrefs, defaultPrefs } from '@/state/persistence'

function Panel() {
  const [height, setHeight] = useState(280)
  return <ResizeRow ariaLabel="Resize timeline" value={height} min={180} max={700} onChange={setHeight} onCollapse={() => setHeight(180)} />
}

function SidePanel() {
  const [width, setWidth] = useState(240)
  return <ResizeCol ariaLabel="Resize navigation" value={width} min={184} max={360} onChange={setWidth} onCollapse={() => setWidth(184)} />
}

describe('timeline panel sizing', () => {
  it('resizes past 360px from the actual displayed height and cancels an interrupted drag', () => {
    render(<Panel />)
    const handle = screen.getByRole('separator', { name: 'Resize timeline' })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 330 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(handle).toHaveAttribute('aria-valuenow', '450')
    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientY: 330 })
    fireEvent.pointerMove(window, { pointerId: 2, clientY: 230 })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handle).toHaveAttribute('aria-valuenow', '450')
    fireEvent.pointerUp(window, { pointerId: 2 })
    expect(handle).toHaveAttribute('aria-valuenow', '450')
  })

  it('provides keyboard expansion and ignores the secondary pointer button', () => {
    render(<Panel />)
    const handle = screen.getByRole('separator', { name: 'Resize timeline' })
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 330 })
    expect(handle).toHaveAttribute('aria-valuenow', '280')
    fireEvent.keyDown(handle, { key: 'End' })
    expect(handle).toHaveAttribute('aria-valuenow', '700')
    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true })
    expect(handle).toHaveAttribute('aria-valuenow', '684')
  })

  it('keeps larger saved sizes and bounds them by the current viewport', () => {
    const storage = new Map<string, string>()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(key => storage.get(key) ?? null)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => { storage.set(key, value) })
    savePrefs({ ...defaultPrefs(), timelineHeight: 650 })
    expect(loadPrefs().timelineHeight).toBe(650)
    expect(timelineSize(650, 900, false).height).toBe(650)
    expect(timelineSize(650, 740, true).height).toBe(480)
    expect(timelineSize(232, 740, true, true).height).toBe(280)
    vi.restoreAllMocks()
  })
})

describe('side panel sizing', () => {
  it('keeps the resize cursor stable and restores the width when Escape cancels', () => {
    render(<SidePanel />)
    const handle = screen.getByRole('separator', { name: /^Resize navigation/ })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 240 })
    expect(document.documentElement).toHaveAttribute('data-resizing', 'column')
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 })
    expect(handle).toHaveAttribute('aria-valuenow', '300')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handle).toHaveAttribute('aria-valuenow', '240')
    expect(document.documentElement).not.toHaveAttribute('data-resizing')
  })

  it('ignores secondary buttons and commits a primary-button drag', () => {
    render(<SidePanel />)
    const handle = screen.getByRole('separator', { name: /^Resize navigation/ })
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 240 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 })
    expect(handle).toHaveAttribute('aria-valuenow', '240')
    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 240 })
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 280 })
    fireEvent.pointerUp(window, { pointerId: 2 })
    expect(handle).toHaveAttribute('aria-valuenow', '280')
    expect(document.documentElement).not.toHaveAttribute('data-resizing')
  })
})
