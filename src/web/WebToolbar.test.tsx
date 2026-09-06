import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import example from '../../examples/web/manifest.json'
import { parseManifest } from './contracts'
import { WebToolbar } from './WebToolbar'

function Toolbar({ initialMode = 'browse', ready = true, changes = { controls: 0, comments: 0 } }: { initialMode?: 'browse' | 'select' | 'annotate'; ready?: boolean; changes?: { controls: number; comments: number } }) {
  const [mode, setMode] = useState(initialMode)
  const noop = () => {}
  const waiting = changes.controls + changes.comments
  return <MemoryRouter><WebToolbar manifest={parseManifest(example)} pageId="home" onPage={noop}
    mode={mode} onMode={setMode} viewport={{ width: 1440, height: 900 }} fluid zoom="1" scale={1}
    onViewport={noop} onZoom={noop} previewMode="current" onPreviewMode={noop}
    undoLabel={undefined} redoLabel={undefined} onUndo={noop} onRedo={noop}
    onSnapshots={noop} onReload={noop} status="Saved to project" connected ready={ready}
    changes={changes} reviewDisabled={!waiting} onReview={noop} /></MemoryRouter>
}

describe('web selection toggle', () => {
  it('enters and exits selection with the same icon, including keyboard activation', async () => {
    const user = userEvent.setup()
    render(<Toolbar />)
    const select = screen.getByRole('button', { name: 'Select element' })
    expect(select.textContent).toBe('')
    expect(select).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(select)
    expect(select).toHaveAttribute('aria-pressed', 'true')
    await user.hover(select)
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Select element · Esc to leave'))
    await user.click(select)
    expect(select).toHaveAttribute('aria-pressed', 'false')
    await user.keyboard('{Enter}')
    expect(select).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard(' ')
    expect(select).toHaveAttribute('aria-pressed', 'false')
  })

  it('is inert while the preview has not answered', () => {
    // jsdom does not enforce inert, so what is checked here is the attribute the browser acts on.
    // `web-connect.e2e.mjs` is where the click is proved to go nowhere.
    render(<Toolbar ready={false} />)
    expect(screen.getByRole('button', { name: 'Select element' }).closest('[inert]')).not.toBeNull()
    render(<Toolbar />)
    expect(screen.getAllByRole('button', { name: 'Select element' })[1]!.closest('[inert]')).toBeNull()
  })

  it('also returns to normal interaction from a drawing tool', () => {
    render(<Toolbar initialMode="annotate" />)
    const select = screen.getByRole('button', { name: 'Select element' })
    fireEvent.click(select)
    expect(select).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('what is waiting to be reviewed', () => {
  it('rests quietly with nothing to say when there is nothing to send', async () => {
    const user = userEvent.setup()
    render(<Toolbar />)
    const review = screen.getByRole('button', { name: /Review/ })
    expect(review).toBeDisabled()
    expect(review.className).toContain('btn--quiet')
    expect(review.textContent).not.toMatch(/\d/)
    await user.hover(review)
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Nothing to review yet'))
  })

  it('asks for attention with a count, and says what the count is made of', async () => {
    const user = userEvent.setup()
    render(<Toolbar changes={{ controls: 2, comments: 1 }} />)
    const review = screen.getByRole('button', { name: /Review/ })
    expect(review).toBeEnabled()
    expect(review.className).toContain('btn--solid')
    expect(review.textContent).toContain('3')
    await user.hover(review)
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Review 2 controls · 1 comment'))
  })
})
