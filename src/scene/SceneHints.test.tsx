import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HINT_TEXT, readHintState, writeHintState } from '@/scene/hints'
import { SceneHints, SceneKeymapHint } from '@/scene/SceneHints'

/** How long the chip is given to fade before it leaves the tree. */
const FADE_MS = 200

/** The chip watches for a press on the viewport surface, so a test has to give it one to watch. */
function setup(props: { onDismiss?: () => void } = {}) {
  const view = render(
    <div className="scene-viewport">
      <div className="scene-surface" data-testid="surface" />
      <SceneHints {...props} />
    </div>,
  )
  return { ...view, surface: screen.getByTestId('surface') }
}

/** Let the fade run out, so what is asserted afterwards is the chip having actually gone. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(FADE_MS)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

describe('SceneHints', () => {
  it('shows the gestures to somebody who has never opened the editor', () => {
    setup()
    expect(screen.getByText(HINT_TEXT)).toBeInTheDocument()
  })

  it('stays away from somebody who has already waved it off', () => {
    writeHintState({ dismissed: true, seenAt: '2026-09-03T10:00:00.000Z' })
    setup()
    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is announced politely rather than as an alert', () => {
    setup()
    const chip = screen.getByRole('status')
    expect(chip).toHaveAttribute('aria-live', 'polite')
    expect(chip).toHaveTextContent(HINT_TEXT)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('records the sighting, so a person who reads it and walks away is offered it again', () => {
    setup()
    const state = readHintState()
    expect(state.dismissed).toBe(false)
    expect(state.seenAt).not.toBeNull()
  })

  it('takes the first key as proof the person is under way', () => {
    const onDismiss = vi.fn()
    setup({ onDismiss })
    fireEvent.keyDown(window, { key: 'g', code: 'KeyG' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(readHintState().dismissed).toBe(true)
  })

  it('ignores a pointer that is only crossing the viewport', () => {
    const onDismiss = vi.fn()
    const { surface } = setup({ onDismiss })
    fireEvent.pointerMove(surface, { clientX: 40, clientY: 40 })
    fireEvent.pointerMove(surface, { clientX: 90, clientY: 70 })
    settle()
    expect(screen.getByText(HINT_TEXT)).toBeInTheDocument()
    expect(onDismiss).not.toHaveBeenCalled()
    expect(readHintState().dismissed).toBe(false)
  })

  it('goes when the viewport itself is pressed', () => {
    const { surface } = setup()
    fireEvent.pointerDown(surface, { button: 0 })
    expect(readHintState().dismissed).toBe(true)
  })

  it('goes when the close button is used, and says so out loud only once', () => {
    const onDismiss = vi.fn()
    setup({ onDismiss })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the hint' }))
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(readHintState().dismissed).toBe(true)
  })

  it('fades before it leaves, so the chip does not blink out from under the eye', () => {
    setup()
    fireEvent.keyDown(window, { key: 'g', code: 'KeyG' })
    expect(screen.getByRole('status')).toHaveAttribute('data-leaving')
    settle()
    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument()
  })

  it('stops listening once it has gone, so nothing it watches outlives it', () => {
    const onDismiss = vi.fn()
    const { surface } = setup({ onDismiss })
    fireEvent.keyDown(window, { key: 'g', code: 'KeyG' })
    settle()
    fireEvent.pointerDown(surface, { button: 0 })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('SceneKeymapHint', () => {
  it('names the key that opens the sheet, and opens it when it is used', () => {
    const onOpen = vi.fn()
    render(<SceneKeymapHint onOpen={onOpen} />)
    const button = screen.getByRole('button', { name: 'Press F1 for the keys' })
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('can be reached by somebody who never learnt the shortcut it names', () => {
    render(<SceneKeymapHint onOpen={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Press F1 for the keys' })
    button.focus()
    expect(button).toHaveFocus()
    fireEvent.keyDown(button, { key: 'Enter' })
  })
})
