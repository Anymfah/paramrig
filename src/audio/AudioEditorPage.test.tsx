import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  it('lays the panels across the window in the reference order', () => {
    open(arcadeCoin().id)
    const plate = screen.getByRole('group', { name: 'Face-plate' })
    for (const panel of ['Pitch', 'Oscillators', 'Noise', 'Body', 'Filter', 'Amp', 'FX']) {
      expect(within(plate).getByRole('region', { name: panel })).toBeInTheDocument()
    }
    expect(within(plate).getByRole('group', { name: 'Macros' })).toBeInTheDocument()
    expect(within(plate).getByRole('list', { name: 'Routing' })).toBeInTheDocument()
  })

  it('filters the layer chosen at the panel head, since this engine filters per layer', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    // The layer badges in the oscillator and noise heads choose which layer Comb, Filter and the
    // amp envelope show; the reference's own badges, given a job.
    const oscillators = screen.getByRole('tablist', { name: 'Oscillator layer' })
    expect(within(oscillators).getByRole('tab', { name: 'Oscillator 1', selected: true })).toBeInTheDocument()
    const filter = screen.getByRole('region', { name: 'Filter' })
    const cutoff = () => within(filter).getByRole('slider', { name: 'Cutoff' })
    const before = cutoff().getAttribute('aria-valuenow')
    await user.click(within(oscillators).getByRole('tab', { name: 'Oscillator 2' }))
    expect(within(oscillators).getByRole('tab', { name: 'Oscillator 2', selected: true })).toBeInTheDocument()
    // An edit made now lands on the second layer, and the first still reads as it did.
    cutoff().focus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(cutoff().getAttribute('aria-valuenow')).not.toBe(before)
    await user.click(within(oscillators).getByRole('tab', { name: 'Oscillator 1' }))
    expect(cutoff().getAttribute('aria-valuenow')).toBe(before)
    // One selector moves every per-layer panel together, so the noise badges take over the same way.
    const noise = screen.getByRole('tablist', { name: 'Noise layer' })
    await user.click(within(noise).getByRole('tab', { name: 'Noise 1' }))
    expect(within(oscillators).queryByRole('tab', { selected: true })).toBeNull()
    expect(within(noise).getByRole('tab', { name: 'Noise 1', selected: true })).toBeInTheDocument()
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

  /** jsdom measures nothing; a stand-in observer reports a room of the given size the moment it is asked to watch. */
  const roomOf = (width: number, height: number) => class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  }

  it('folds the plate to its medium face in a laptop room that would shrink it past reading', () => {
    const Real = globalThis.ResizeObserver
    globalThis.ResizeObserver = roomOf(1046, 835) as unknown as typeof ResizeObserver
    try {
      open(arcadeCoin().id)
      expect(window.document.querySelector('.fp-stage')).toHaveAttribute('data-layout', 'medium')
      // Every panel is still there, and the amp envelope is the one modulator on show.
      for (const name of ['Pitch', 'Oscillators', 'Noise', 'Body', 'Filter', 'Amp', 'FX', 'Amp envelope']) {
        expect(screen.getByRole('region', { name })).toBeInTheDocument()
      }
      expect(screen.queryByRole('region', { name: 'Envelope 2' })).toBeNull()
      // A source's name brings its modulator alone; the trio is the wide face's.
      fireEvent.click(screen.getByRole('button', { name: 'Show modulator L5' }))
      expect(screen.getByRole('region', { name: 'LFO 2' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'LFO 1' })).toBeNull()
      expect(screen.queryByRole('region', { name: 'Amp envelope' })).toBeNull()
    } finally {
      globalThis.ResizeObserver = Real
    }
  })

  it('folds the plate to its narrow face in a room taller than it is wide, at the reference\'s own size', () => {
    const Real = globalThis.ResizeObserver
    globalThis.ResizeObserver = roomOf(695, 1100) as unknown as typeof ResizeObserver
    try {
      open(arcadeCoin().id)
      const stage = window.document.querySelector('.fp-stage')
      expect(stage).toHaveAttribute('data-layout', 'narrow')
      expect(stage).toHaveStyle({ '--fp-scale': '1' })
      expect(screen.getByRole('region', { name: 'Amp envelope' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Envelope 3' })).toBeNull()
      expect(screen.getByRole('list', { name: 'Routing' })).toBeInTheDocument()
    } finally {
      globalThis.ResizeObserver = Real
    }
  })

  it('says what a modulator is doing, and that it is doing it to nothing yet', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    // The plate opens on the envelopes; the LFOs are a page away, reached by their names.
    expect(screen.getByRole('region', { name: 'Envelope 2' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'LFO 1' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show modulator L4' }))
    for (const name of ['LFO 1', 'LFO 2', 'LFO 3']) {
      const panel = screen.getByRole('region', { name })
      expect(within(panel).getByRole('combobox', { name: 'Target' })).toBeInTheDocument()
      expect(within(panel).getByRole('slider', { name: 'LFO Level' })).toBeInTheDocument()
    }
    // The routing bar lists the reference's nine sources, all of them this engine's: the amp
    // envelope, two free envelopes, six LFOs. A name shows its trio of panels.
    const routing = screen.getByRole('list', { name: 'Routing' })
    expect(within(routing).getAllByRole('listitem')).toHaveLength(9)
    for (const live of ['E1', 'E2', 'E3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9']) expect(within(routing).getByText(live)).toBeInTheDocument()
  })

  /**
   * The reference's way of routing: pick a modulator's handle up in the routing bar and drop it
   * on a control. jsdom cannot say what is under a pointer, so the drop is answered for it.
   */
  it('assigns a modulator by dropping its handle on a control', () => {
    open(arcadeCoin().id)
    const filter = screen.getByRole('region', { name: 'Filter' })
    const cutoff = within(filter).getByRole('slider', { name: 'Cutoff' })
    expect(cutoff).toHaveAttribute('data-target', 'layers[0].cutoff')
    expect(cutoff.querySelector('.fp-knob__mod')).toBeNull()
    const handle = screen.getByRole('button', { name: 'Drag L4 onto a control to modulate it' })
    const under = document.elementFromPoint
    document.elementFromPoint = () => cutoff
    try {
      fireEvent.pointerDown(handle, { clientX: 10, clientY: 10 })
      fireEvent.pointerUp(handle, { clientX: 20, clientY: 20 })
    } finally {
      document.elementFromPoint = under
    }
    expect(cutoff).toHaveAttribute('aria-valuetext', expect.stringContaining('modulated'))
    fireEvent.click(screen.getByRole('button', { name: 'Show modulator L4' }))
    expect(within(screen.getByRole('region', { name: 'LFO 1' })).getByRole('combobox', { name: 'Target' })).toHaveTextContent('Layer 1 cutoff')
  })

  /** A macro is a control of the rig: dropped on a dial, it exposes that dial to Tune and the SDK. */
  it('assigns a macro by dropping its number on a control, and that is the document rig', async () => {
    // A fresh document has no rig yet, so its macros are the default table.
    // Named so as not to shadow the global document, whose elementFromPoint the drop reads.
    const doc = createAudioDocument()
    open(doc.id)
    const filter = screen.getByRole('region', { name: 'Filter' })
    const drive = within(filter).getByRole('slider', { name: 'Drive' })
    // Drive wears macro 9 out of the box; the tenth macro will take it over.
    expect(within(drive).getByText('9')).toBeInTheDocument()
    const handle = screen.getByRole('button', { name: /^Drag macro 10 onto a control/ })
    const under = document.elementFromPoint
    document.elementFromPoint = () => drive
    try {
      fireEvent.pointerDown(handle, { clientX: 10, clientY: 10 })
      fireEvent.pointerUp(handle, { clientX: 20, clientY: 20 })
    } finally {
      document.elementFromPoint = under
    }
    expect(within(drive).getByText('10')).toBeInTheDocument()
    expect(within(drive).queryByText('9')).toBeNull()
    const band = screen.getByRole('group', { name: 'Macros' })
    expect(within(band).getByRole('slider', { name: 'Drive 1' })).toBeInTheDocument()
    // The rig reaches storage with the patch, bound under the macro's number.
    await waitFor(() => {
      const saved = getAudioDocument(doc.id)
      expect(saved?.rig?.bindings.find((binding) => binding.id === 'macro-10')?.property).toBe('layers[0].shaper.drive')
      expect(saved?.rig?.bindings.some((binding) => binding.id === 'macro-9')).toBe(false)
    })
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

  it('switches a source on and off from its own panel head', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    // The source column: a tone, noise, or nothing at all.
    const second = screen.getByRole('radiogroup', { name: 'Oscillator 2 source' })
    expect(within(second).getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(second).getByRole('radio', { name: 'Tone' }))
    expect(within(second).getByRole('radio', { name: 'Tone' })).toHaveAttribute('aria-checked', 'true')
    expect(within(second).getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'false')
  })

  it('puts the waveform in the transport with the numbers that describe it', () => {
    open(arcadeCoin().id)
    expect(screen.getByRole('img', { name: /waveform/i })).toBeInTheDocument()
    expect(screen.getByText('Length', { selector: 'dt' })).toBeInTheDocument()
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
    const layer = screen.getByRole('region', { name: 'Amp envelope' })
    for (const handle of ['Attack, layer 1', 'Hold, layer 1', 'Decay and sustain, layer 1', 'Release, layer 1']) {
      expect(within(layer).getByRole('slider', { name: handle })).toBeInTheDocument()
    }
    // The curve dial wears the reference's name, Shape, rather than the field's.
    expect(within(layer).getByRole('slider', { name: 'Shape' })).toBeInTheDocument()
  })

  it('reads the envelope out in numbers beside the shape', () => {
    open(arcadeCoin().id)
    const layer = screen.getByRole('region', { name: 'Amp envelope' })
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
