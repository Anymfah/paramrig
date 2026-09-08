import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AudioEditorPage } from '@/audio/AudioEditorPage'
import { createAudioDocument, getAudioDocument, saveAudioDocument } from '@/audio/document'
import { AudioRigPreview } from '@/renderers/audio/AudioRigPreview'
import { arcadeCoin } from '@/rigs/examples/arcade-coin'

/**
 * The page in a browser that has no audio device — which jsdom is, and which some real browsers
 * are too. Everything except the sound itself has to keep working there: the board, the waveform,
 * the history, the writing back to storage.
 */

beforeEach(() => {
  localStorage.clear()
})

const open = (id: string) => render(
  <MemoryRouter>
    <AudioEditorPage documentId={id} mode="edit" onMode={() => undefined} />
  </MemoryRouter>,
)

describe('AudioEditorPage', () => {
  it('opens on the first layer with the board beside the waveform', () => {
    const document = createAudioDocument()
    open(document.id)
    expect(screen.getByRole('img', { name: /waveform/i })).toBeInTheDocument()
    const board = screen.getByRole('complementary', { name: 'Sound board' })
    expect(within(board).getByRole('tab', { name: 'Layer 1', selected: true })).toBeInTheDocument()
    expect(within(board).getByRole('tab', { name: 'Mix' })).toBeInTheDocument()
  })

  it('says how many fields there are and that nothing is exposed yet', () => {
    const document = createAudioDocument()
    open(document.id)
    expect(screen.getByText(/\d+ fields/)).toBeInTheDocument()
    expect(screen.getByText('No controls exposed')).toBeInTheDocument()
  })

  it('counts the controls a patch exposes', () => {
    open(arcadeCoin().id)
    expect(screen.getByText('4 exposed')).toBeInTheDocument()
  })

  // The buttons carry aria-disabled rather than the attribute, so they stay focusable and a
  // screen reader can still find them. Asserting the attribute keeps that choice honest.
  it('has nothing to undo before anything is touched', () => {
    const document = createAudioDocument()
    open(document.id)
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('renames the patch and writes it back to storage', async () => {
    const user = userEvent.setup()
    const document = createAudioDocument()
    open(document.id)
    const name = screen.getByLabelText('Patch name')
    await user.clear(name)
    await user.type(name, 'Door chime')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(getAudioDocument(document.id)?.name).toBe('Door chime')
  })

  it('says so plainly when the patch is not in this browser', () => {
    open('audio-nothing-here')
    expect(screen.getByText(/not in this browser/i)).toBeInTheDocument()
  })

  it('offers Tune only once a patch has controls to tune', () => {
    const plain = createAudioDocument()
    const { unmount } = open(plain.id)
    expect(screen.queryByRole('button', { name: 'Tune' })).toBeNull()
    unmount()
    open(arcadeCoin().id)
    expect(screen.getByRole('button', { name: 'Tune' })).toBeInTheDocument()
  })
})

describe('AudioRigPreview', () => {
  it('draws the patch a rig resolves to', () => {
    render(<AudioRigPreview documentId={arcadeCoin().id} values={{ pitch: 1200, length: 0.3, sparkle: 1.5, tone: 0 }} name="Arcade coin" />)
    expect(screen.getByRole('img', { name: 'Arcade coin waveform' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('says so plainly when the patch has gone', () => {
    render(<AudioRigPreview documentId="audio-nothing-here" values={{}} name="Missing" />)
    expect(screen.getByText(/not in this browser/i)).toBeInTheDocument()
  })

  it('keeps working when a stored patch has been edited under it', () => {
    const document = getAudioDocument(arcadeCoin().id)
    if (!document) throw new Error('the example should be there')
    saveAudioDocument({ ...document, patch: { ...document.patch, duration: 0.8 } })
    render(<AudioRigPreview documentId={document.id} values={{}} name="Arcade coin" />)
    // Under a second, a duration reads in milliseconds: this is the edited 0.8 s, not the 0.45 s
    // the example ships with.
    expect(screen.getByText('800 ms')).toBeInTheDocument()
  })
})
