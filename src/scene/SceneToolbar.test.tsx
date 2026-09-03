import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SceneToolbar } from '@/scene/SceneToolbar'
import { HIT_TARGET_COARSE_PX, HIT_TARGET_PX } from '@/ui/hit-target'

type ToolbarProps = ComponentProps<typeof SceneToolbar>

function setup(overrides: Partial<ToolbarProps> = {}) {
  const props: ToolbarProps = {
    open: true,
    tool: 'select-box',
    mode: 'object',
    onTool: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  const view = render(<SceneToolbar {...props} />)
  return { ...view, props }
}

/** The press that opens a group's sub-menu, held past the threshold the bar waits for. */
function press(button: HTMLElement): void {
  fireEvent.pointerDown(button, { button: 0, pointerId: 1 })
  act(() => {
    vi.advanceTimersByTime(600)
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SceneToolbar', () => {
  it('draws nothing at all while it is closed, so opening it moves no layout', () => {
    const { container } = setup({ open: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('carries a button for every tool of this prompt, and names the mode it is showing', () => {
    setup()
    const bar = screen.getByRole('toolbar', { name: 'Object mode tools' })
    expect(bar).toBeInTheDocument()
    for (const name of ['Select box', 'Cursor', 'Move', 'Rotate', 'Scale', 'Transform', 'Annotate', 'Measure']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('says which mode it belongs to, so the bar is not two toolbars under one name', () => {
    setup({ mode: 'edit' })
    expect(screen.getByRole('toolbar', { name: 'Edit mode tools' })).toBeInTheDocument()
  })

  it('asks for the tool a button names, and marks the active one', () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }))
    expect(props.onTool).toHaveBeenCalledWith('rotate')
    expect(screen.getByRole('button', { name: 'Select box' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Rotate' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('opens the select group on a press that is held, and the press itself picks nothing', () => {
    vi.useFakeTimers()
    const { props } = setup()
    press(screen.getByRole('button', { name: 'Select box' }))

    expect(screen.getByRole('menu', { name: 'Select tools' })).toBeInTheDocument()
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
    expect(screen.getByRole('menuitemradio', { name: /Select circle/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /Select lasso/ })).toBeInTheDocument()

    // The click that ends the hold must not also activate the tool under the finger.
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Select box' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select box' }))
    expect(props.onTool).not.toHaveBeenCalled()
  })

  it('leaves the menu shut on a press that is let go in time', () => {
    vi.useFakeTimers()
    const { props } = setup()
    const button = screen.getByRole('button', { name: 'Select box' })
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 })
    act(() => {
      vi.advanceTimersByTime(120)
    })
    fireEvent.pointerUp(button)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(button)
    expect(props.onTool).toHaveBeenCalledWith('select-box')
  })

  it('picks another member of the group from the sub-menu, and shows it on the button after', () => {
    vi.useFakeTimers()
    const { props, rerender } = setup()
    press(screen.getByRole('button', { name: 'Select box' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Select lasso/ }))

    expect(props.onTool).toHaveBeenCalledWith('select-lasso')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // The button follows the document, so it names the lasso once the editor has switched to it.
    rerender(<SceneToolbar {...props} tool="select-lasso" />)
    expect(screen.getByRole('button', { name: 'Select lasso' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens the same sub-menu from the keyboard, and Escape shuts it again', () => {
    setup()
    const button = screen.getByRole('button', { name: 'Select box' })
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu', { name: 'Select tools' })
    expect(button).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select box' })).toHaveFocus()
  })

  it('sizes every tool from the shared hit target, at both pointer sizes', () => {
    setup()
    const bar = screen.getByRole('toolbar', { name: 'Object mode tools' })
    expect(bar.style.getPropertyValue('--scene-tool-size')).toBe(`${HIT_TARGET_PX}px`)
    expect(bar.style.getPropertyValue('--scene-tool-size-coarse')).toBe(`${HIT_TARGET_COARSE_PX}px`)
  })

  it('asks to be closed', () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Close toolbar' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })
})
