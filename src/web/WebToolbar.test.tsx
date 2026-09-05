import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import example from '../../examples/web/manifest.json'
import { parseManifest } from './contracts'
import { WebToolbar } from './WebToolbar'

function Toolbar({ initialMode = 'browse' }: { initialMode?: 'browse' | 'select' | 'annotate' }) {
  const [mode, setMode] = useState(initialMode)
  const noop = () => {}
  return <MemoryRouter><WebToolbar manifest={parseManifest(example)} pageId="home" onPage={noop}
    mode={mode} onMode={setMode} viewport={{ width: 1440, height: 900 }} fluid zoom="1"
    onViewport={noop} onZoom={noop} previewMode="current" onPreviewMode={noop}
    undoLabel={undefined} redoLabel={undefined} onUndo={noop} onRedo={noop}
    onSnapshots={noop} onReload={noop} status="Saved to project" connected
    changeCount={0} reviewDisabled onReview={noop} /></MemoryRouter>
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
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Stop selecting (Esc)'))
    await user.click(select)
    expect(select).toHaveAttribute('aria-pressed', 'false')
    await user.keyboard('{Enter}')
    expect(select).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard(' ')
    expect(select).toHaveAttribute('aria-pressed', 'false')
  })

  it('also returns to normal interaction from a drawing tool', () => {
    render(<Toolbar initialMode="annotate" />)
    const select = screen.getByRole('button', { name: 'Select element' })
    fireEvent.click(select)
    expect(select).toHaveAttribute('aria-pressed', 'false')
  })
})
