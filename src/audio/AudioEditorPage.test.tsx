import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AudioEditorPage } from '@/audio/AudioEditorPage'
import { createAudioDocument, getAudioDocument, isBundledAudioDocument, saveAudioDocument } from '@/audio/document'
import { AudioRigPreview } from '@/renderers/audio/AudioRigPreview'
import { arcadeCoin } from '@/rigs/examples/arcade-coin'
import { PRESETS } from '@/audio/presets'

/**
 * The page in a browser with no audio device — which jsdom is, and which some real browsers are.
 * Everything except the sound itself has to keep working: the board, the transport, the rail, the
 * history, the writing back to storage.
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
  /** The whole argument of the layout: nothing is behind a tab, so nothing has to be found. */
  it('lays the stages across the window in the order the signal goes through them', () => {
    open(arcadeCoin().id)
    const rack = screen.getByRole('group', { name: 'Signal path' })
    for (const stage of ['Level', 'Source', 'Pitch', 'Filter', 'Shaper', 'Body', 'Envelope', 'Mix']) {
      expect(within(rack).getByRole('region', { name: stage })).toBeInTheDocument()
    }
    expect(within(rack).queryAllByRole('tab')).toHaveLength(0)
  })

  it('keeps all three levels, and gives the stages the layer being worked on', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    const level = screen.getByRole('region', { name: 'Level' })
    // Which layers are on and how loud they are against each other is the comparison worth
    // keeping, so the level column holds all three.
    for (const layer of ['Layer 1', 'Layer 2', 'Layer 3']) {
      expect(within(level).getByRole('group', { name: `${layer} · Level` })).toBeInTheDocument()
    }
    const filter = screen.getByRole('region', { name: 'Filter' })
    expect(within(filter).getByRole('group', { name: 'Layer 1 · Filter' })).toBeInTheDocument()
    expect(within(filter).queryByRole('group', { name: 'Layer 2 · Filter' })).toBeNull()

    await user.click(within(level).getByRole('button', { name: 'Work on Layer 2' }))
    expect(within(filter).getByRole('group', { name: 'Layer 2 · Filter' })).toBeInTheDocument()
    expect(within(filter).queryByRole('group', { name: 'Layer 1 · Filter' })).toBeNull()
  })

  /**
   * The tabs separate what you are doing, not what you can see: nothing is hidden inside a view.
   * The layers show every field they have at once, and so do the modulators.
   */
  it('keeps the routing beside the instrument even though the modulators moved out', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    const tabs = screen.getByRole('tablist', { name: 'Views' })
    expect(within(tabs).getByRole('tab', { name: 'Instrument', selected: true })).toBeInTheDocument()

    // The panels have their own view; the one line saying what is moving does not go with them.
    expect(screen.getByRole('region', { name: 'Filter' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Routing' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Modulation' })).toBeNull()

    await user.click(within(tabs).getByRole('tab', { name: 'Sounds' }))
    const browser = screen.getByRole('tabpanel')
    expect(within(browser).getByRole('region', { name: 'Impact' })).toBeInTheDocument()
    expect(within(browser).getByRole('button', { name: /Sub drop/ })).toBeInTheDocument()

    await user.click(within(tabs).getByRole('tab', { name: 'Instrument' }))
    expect(screen.getByRole('region', { name: 'Filter' })).toBeInTheDocument()
  })

  it('says what a modulator is doing, and that it is doing it to nothing yet', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    await user.click(screen.getByRole('tab', { name: 'Modulation' }))
    const drawer = screen.getByRole('region', { name: 'Modulation' })
    // Both modulators are on screen now rather than one at a time, so both say it.
    expect(within(drawer).getAllByText('Not assigned')).toHaveLength(2)
    expect(within(drawer).getAllByText('Target')).toHaveLength(2)
    expect(within(drawer).getAllByText('Depth')).toHaveLength(2)
    // The routing bar answers the across-the-room question without opening anything.
    const routing = within(drawer).getByRole('list', { name: 'Routing' })
    expect(within(routing).getAllByRole('listitem')).toHaveLength(2)
    expect(within(routing).getAllByText('not assigned')).toHaveLength(2)
  })

  it('picks a sound from the browser', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    await user.click(screen.getByRole('tab', { name: 'Sounds' }))
    // The name is in the rail as well now, so the browser has to be named.
    const browser = screen.getByRole('tabpanel')
    await user.click(within(browser).getByRole('button', { name: /Sub drop/ }))
    expect(screen.getByText('1.50 s')).toBeInTheDocument()
  })

  it('says a stage is off rather than showing settings that make no sound', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    const filter = screen.getByRole('region', { name: 'Filter' })
    expect(within(filter).getByText('Cutoff')).toBeInTheDocument()
    await user.click(within(screen.getByRole('region', { name: 'Level' })).getByRole('button', { name: 'Work on Layer 2' }))
    expect(within(filter).getByText('Off')).toBeInTheDocument()
    expect(within(filter).queryByText('Cutoff')).toBeNull()
  })

  it('puts the waveform in the transport with the numbers that describe it', () => {
    open(arcadeCoin().id)
    expect(screen.getByRole('img', { name: /waveform/i })).toBeInTheDocument()
    expect(screen.getByText('Length')).toBeInTheDocument()
    expect(screen.getByText('450 ms')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('offers a sound menu with a step either side, and the three generators', () => {
    open(arcadeCoin().id)
    for (const label of ['Previous sound', 'Next sound', 'Keep this sound', 'Randomize', 'Mutate']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /^Sound:/ })).toBeInTheDocument()
  })

  /** Stepping is how these get used: you rarely know which sound you want, only that not this one. */
  it('steps through the sounds, one undoable step each', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    expect(screen.getByText('450 ms')).toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'Next sound' })
    await user.click(next)
    expect(screen.getByText('450 ms')).toBeInTheDocument()
    await user.click(next)
    expect(screen.getByText('350 ms')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('450 ms')).toBeInTheDocument()
  }, 15_000)

  it('steps backwards too, wrapping round the end of the list', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    await user.click(screen.getByRole('button', { name: 'Previous sound' }))
    // Read from the list rather than written down, so adding a preset does not silently make this
    // assert the wrong one.
    const last = PRESETS[PRESETS.length - 1]!.build()
    const shown = last.duration < 1 ? `${Math.round(last.duration * 1000)} ms` : `${last.duration.toFixed(2)} s`
    expect(screen.getByText(shown)).toBeInTheDocument()
  })

  /** The whole point of keeping one: getting back to somewhere you had already reached. */
  it('keeps a sound, finds it again, and lets it go', async () => {
    const user = userEvent.setup()
    const document = createAudioDocument()
    open(document.id)
    await user.click(screen.getByRole('button', { name: 'Keep this sound' }))
    await user.click(screen.getByRole('button', { name: /^Sound:/ }))
    const saved = await screen.findByRole('menuitem', { name: /Sound 1/ })
    await user.click(within(saved).getByRole('button', { name: 'Remove Sound 1' }))
    expect(screen.queryByRole('menuitem', { name: /Sound 1/ })).toBeNull()
  })

  /** Without it, every experiment on a saved sound leaves a near-identical copy behind. */
  it('replaces a saved sound instead of leaving a copy beside it', async () => {
    const user = userEvent.setup()
    const document = createAudioDocument()
    open(document.id)
    await user.click(screen.getByRole('button', { name: 'Keep this sound' }))

    const replace = screen.getByRole('button', { name: 'Replace the saved sound' })
    // Nothing has moved yet, so there is nothing to replace.
    expect(replace).toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByRole('button', { name: 'Mutate' }))
    expect(screen.getByRole('button', { name: /^Sound: Sound 1 · edited/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace the saved sound' })).not.toHaveAttribute('aria-disabled')

    await user.click(screen.getByRole('button', { name: 'Replace the saved sound' }))
    await new Promise((resolve) => setTimeout(resolve, 550))
    const stored = getAudioDocument(document.id)
    expect(stored?.snapshots).toHaveLength(1)
    expect(stored?.snapshots?.[0]?.patch).toEqual(stored?.patch)
    expect(screen.getByRole('button', { name: /^Sound: Sound 1$/ })).toBeInTheDocument()
  }, 15_000)

  it('writes what it kept back to the document, so it survives a reload', async () => {
    const user = userEvent.setup()
    const document = createAudioDocument()
    open(document.id)
    await user.click(screen.getByRole('button', { name: 'Keep this sound' }))
    await new Promise((resolve) => setTimeout(resolve, 550))
    const stored = getAudioDocument(document.id)
    expect(stored?.snapshots).toHaveLength(1)
    expect(stored?.snapshots?.[0]?.patch.duration).toBe(document.patch.duration)
  })

  it('draws the envelope rather than listing its five times', () => {
    open(arcadeCoin().id)
    const layer = screen.getByRole('region', { name: 'Envelope' })
    for (const handle of ['Attack, layer 1', 'Hold, layer 1', 'Decay and sustain, layer 1', 'Release, layer 1']) {
      expect(within(layer).getByRole('slider', { name: handle })).toBeInTheDocument()
    }
    expect(within(layer).queryByLabelText('Attack')).toBeNull()
    expect(within(layer).getByLabelText('Envelope curve')).toBeInTheDocument()
  })

  it('reads the envelope out in numbers beside the shape', () => {
    open(arcadeCoin().id)
    const layer = screen.getByRole('region', { name: 'Envelope' })
    expect(within(layer).getByText('D 260 ms')).toBeInTheDocument()
    expect(within(layer).getByText('S 0.00')).toBeInTheDocument()
  })

  /**
   * There used to be a permanent band across the foot of the window whose usual content was a
   * report that nothing had gone wrong. The live region stays, and takes no room until it does.
   */
  it('keeps no permanent band across the foot of the window', () => {
    open(arcadeCoin().id)
    expect(screen.getByRole('status', { name: 'Editor notice' })).toHaveAttribute('data-empty', 'true')
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

  /**
   * Found by opening the example in a browser and going back to the library, where it had moved
   * from Examples to Projects. The page wrote on mount, which stamped a new updatedAt and defeated
   * the guard that keeps a bundled patch bundled.
   */
  it('does not turn a bundled example into a project by being opened', async () => {
    open(arcadeCoin().id)
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(isBundledAudioDocument(arcadeCoin().id)).toBe(true)
    expect(localStorage.getItem('paramrig.audio-documents.v1')).toBeNull()
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
  it('gives Tune the transport and nothing it does not need', () => {
    render(<AudioRigPreview documentId={arcadeCoin().id} values={{ pitch: 1200, length: 0.3, sparkle: 1.5, tone: 0 }} name="Arcade coin" />)
    expect(screen.getByRole('img', { name: 'Arcade coin waveform' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Sound board' })).toBeNull()
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
