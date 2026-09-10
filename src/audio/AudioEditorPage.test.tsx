import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AudioEditorPage } from '@/audio/AudioEditorPage'
import { createAudioDocument, getAudioDocument, isBundledAudioDocument, saveAudioDocument } from '@/audio/document'
import { AudioRigPreview } from '@/renderers/audio/AudioRigPreview'
import { arcadeCoin } from '@/rigs/examples/arcade-coin'
import { PRESET_ORDER } from '@/audio/presets'

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
    for (const panel of ['Pitch', 'Oscillators', 'Noise', 'Insert', 'Filter', 'Amp', 'FX']) {
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
      for (const name of ['Pitch', 'Oscillators', 'Noise', 'Insert', 'Filter', 'Amp', 'FX', 'Amp envelope']) {
        expect(screen.getByRole('region', { name })).toBeInTheDocument()
      }
      expect(screen.queryByRole('region', { name: 'Modulator 2' })).toBeNull()
      // A source's name brings its modulator alone; the trio is the wide face's.
      fireEvent.click(screen.getByRole('button', { name: 'Show modulator L5' }))
      expect(screen.getByRole('region', { name: 'Modulator 5' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Modulator 4' })).toBeNull()
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
      expect(screen.queryByRole('region', { name: 'Modulator 3' })).toBeNull()
      expect(screen.getByRole('list', { name: 'Routing' })).toBeInTheDocument()
    } finally {
      globalThis.ResizeObserver = Real
    }
  })

  it('has the three performers in front of the envelopes, each with a row to draw and a bar to pick the row', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    // The plate opens on the envelopes; the performers are a click away, first in the bar.
    expect(screen.queryByRole('region', { name: 'Performer 1' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show modulator P1' }))
    for (const name of ['Performer 1', 'Performer 2', 'Performer 3']) expect(screen.getByRole('region', { name })).toBeInTheDocument()
    const panel = screen.getByRole('region', { name: 'Performer 1' })
    expect(within(panel).getByRole('combobox', { name: 'Target' })).toBeInTheDocument()
    expect(within(panel).getByRole('slider', { name: 'Performer 1 level' })).toBeInTheDocument()
    // A step drawn by the keyboard lands in the patch's row for the scene that plays.
    const steps = within(within(panel).getByRole('group', { name: 'Performer 1 row 1' })).getAllByRole('slider', { name: /^Step \d+$/ })
    expect(steps).toHaveLength(16)
    fireEvent.keyDown(steps[2]!, { key: 'PageUp' })
    expect(steps[2]).toHaveAttribute('aria-valuenow', '0.25')
    // The bar picks the row: row four, empty, becomes the one the performers play.
    expect(screen.getByRole('button', { name: 'Pattern 1' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Pattern 4' }))
    expect(screen.getByRole('button', { name: 'Pattern 4' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(panel).getByRole('group', { name: 'Performer 1 row 4' })).toBeInTheDocument()
    // Init starts the row from a shape rather than from nothing, and Flat is the old Init.
    fireEvent.keyDown(within(within(panel).getByRole('group', { name: 'Performer 1 row 4' })).getAllByRole('slider', { name: /^Step \d+$/ })[0]!, { key: 'End' })
    await user.click(within(panel).getByRole('button', { name: 'Start performer 1 row 4 from a shape' }))
    await user.click(screen.getByRole('menuitem', { name: 'Ramp up' }))
    const drawn = () => within(within(screen.getByRole('region', { name: 'Performer 1' })).getByRole('group', { name: 'Performer 1 row 4' })).getAllByRole('slider', { name: /^Step \d+$/ })
    expect(drawn()[0]).toHaveAttribute('aria-valuenow', '0')
    expect(drawn()[15]).toHaveAttribute('aria-valuenow', '1')
    await user.click(within(screen.getByRole('region', { name: 'Performer 1' })).getByRole('button', { name: 'Start performer 1 row 4 from a shape' }))
    await user.click(screen.getByRole('menuitem', { name: 'Flat' }))
    expect(drawn()[15]).toHaveAttribute('aria-valuenow', '0')
  })

  it('turns an oscillator into a wavetable, names the table, and gives the big dial to the position', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    const sources = screen.getByRole('radiogroup', { name: 'Oscillator 1 source' })
    // Four positions where there were three, and the fourth is the one the engine gained.
    expect(within(sources).getAllByRole('radio').map((choice) => choice.textContent)).toEqual(['Tone', 'Table', 'Noise', 'Off'])
    // The big dial sets the pitch while the source is a plain shape.
    expect(screen.getByRole('slider', { name: 'Pos1' })).toHaveAttribute('aria-valuemax', '12000')
    await user.click(within(sources).getByRole('radio', { name: 'Table' }))
    // The four wave names give way to the table's, and the dial now walks along it.
    expect(screen.getByRole('button', { name: 'Oscillator 1 wavetable' })).toHaveTextContent('Sweep')
    expect(screen.queryByRole('radiogroup', { name: 'Oscillator 1 wave' })).toBeNull()
    expect(screen.getByRole('slider', { name: 'Pos1' })).toHaveAttribute('aria-valuemax', '1')
  })

  it('lets one oscillator bend another one\'s phase, and drops the ratio that stops meaning anything', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    const panel = () => screen.getByRole('region', { name: 'Oscillators' })
    // Its own modulator to begin with, tuned by a ratio beside it.
    const word = () => within(panel()).getByRole('button', { name: /^Oscillator 1 phase modulator/ })
    expect(word()).toHaveTextContent('Self')
    expect(within(panel()).getByRole('slider', { name: 'Oscillator 1 modulator ratio' })).toBeInTheDocument()
    // Stepping past itself: a layer cannot name itself, so Oscillator 1 is not on its own list.
    await user.click(word())
    expect(word()).toHaveTextContent('Osc 2')
    expect(within(panel()).queryByRole('slider', { name: 'Oscillator 1 modulator ratio' })).toBeNull()
    await user.click(word())
    expect(word()).toHaveTextContent('Noise 1')
  })

  it('gives a layer three insert slots, each saying what it is and where it stands', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    const panel = () => screen.getByRole('region', { name: 'Insert' })
    // Nothing is in the first slot of this sound, and the panel says so rather than showing a hole.
    const slots = within(panel()).getByRole('tablist', { name: 'Insert slot' })
    expect(within(slots).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['A', 'B', 'C'])
    await user.click(within(panel()).getByRole('button', { name: 'Insert A kind' }))
    expect(screen.getAllByRole('menuitem').map((cell) => cell.getAttribute('aria-label'))).toEqual(
      ['Off', 'Drive', 'Crusher', 'Ring', 'Fold', 'Body', 'Comb'],
    )
    await user.click(screen.getByRole('menuitem', { name: 'Comb' }))
    // The kind brings its own controls, and the side of the amp it stands on is one click away.
    expect(within(panel()).getByRole('slider', { name: 'Time' })).toBeInTheDocument()
    expect(within(panel()).getByRole('slider', { name: 'Feedback' })).toBeInTheDocument()
    const place = within(panel()).getByRole('button', { name: /^Insert A stands/ })
    expect(place).toHaveTextContent('Before the amp')
    await user.click(place)
    expect(within(panel()).getByRole('button', { name: /^Insert A stands/ })).toHaveTextContent('After the amp')
    // The third slot is its own slot, and holds what it is given rather than what A was given.
    await user.click(within(slots).getByRole('tab', { name: 'Insert C' }))
    expect(within(panel()).getByRole('button', { name: 'Insert C kind' })).toHaveTextContent('Off')
    await user.click(within(panel()).getByRole('button', { name: 'Insert C kind' }))
    await user.click(screen.getByRole('menuitem', { name: 'Body' }))
    expect(within(panel()).getByRole('slider', { name: 'Freq' })).toBeInTheDocument()
    expect(within(panel()).queryByRole('slider', { name: 'Time' })).toBeNull()
    await user.click(within(slots).getByRole('tab', { name: 'Insert A' }))
    expect(within(panel()).getByRole('button', { name: 'Insert A kind' })).toHaveTextContent('Comb')
  })

  it('offers every filter the engine can run, and gives the choice to the one slot of the one layer', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    const model = () => within(screen.getByRole('region', { name: 'Filter' })).getByRole('button', { name: 'Filter model' })
    await user.click(model())
    // The engine has answered to nine models for a while; the plate offered three of them.
    expect(screen.getAllByRole('menuitem').map((cell) => cell.getAttribute('aria-label'))).toEqual(
      ['Off', 'Low', 'High', 'Band', 'Notch', 'Peak', 'Ladder', 'Comb', 'Vowel'],
    )
    await user.click(screen.getByRole('menuitem', { name: 'Ladder' }))
    expect(model()).toHaveTextContent('Ladder')
    // And the choice went to that layer's filter, not to something the whole patch shares.
    const layers = screen.getByRole('tablist', { name: 'Oscillator layer' })
    await user.click(within(layers).getByRole('tab', { name: 'Oscillator 2' }))
    expect(model()).not.toHaveTextContent('Ladder')
    await user.click(within(layers).getByRole('tab', { name: 'Oscillator 1' }))
    expect(model()).toHaveTextContent('Ladder')
  })

  it('lets a slot be an envelope or an oscillator, and the bar says which', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    // The bar numbers its slots once and the letter says what each holds, as the reference does.
    const routing = screen.getByRole('list', { name: 'Routing' })
    expect(within(routing).getAllByRole('listitem').map((entry) => entry.textContent)).toEqual(
      ['P1', 'P2', 'P3', 'E1', 'E2', 'E3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'],
    )
    await user.click(screen.getByRole('button', { name: 'Show modulator L4' }))
    const panel = screen.getByRole('region', { name: 'Modulator 4' })
    // An oscillator has a rate; the envelope it can become has stages instead.
    expect(within(panel).getByRole('slider', { name: 'Modulator 4 rate' })).toBeInTheDocument()
    expect(within(panel).queryByRole('slider', { name: 'Modulator 4 hold' })).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'Modulator 4 kind' }))
    await user.click(screen.getByRole('menuitem', { name: 'Envelope' }))
    expect(within(screen.getByRole('region', { name: 'Modulator 4' })).getByRole('slider', { name: 'Modulator 4 hold' })).toBeInTheDocument()
    expect(within(routing).getAllByRole('listitem')[6]).toHaveTextContent('E4')
  })

  it('says what a modulator is doing, and that it is doing it to nothing yet', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    // The plate opens on the envelopes; the LFOs are a page away, reached by their names.
    expect(screen.getByRole('region', { name: 'Modulator 2' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Modulator 4' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show modulator L4' }))
    for (const name of ['Modulator 4', 'Modulator 5', 'Modulator 6']) {
      const panel = screen.getByRole('region', { name })
      expect(within(panel).getByRole('combobox', { name: 'Target' })).toBeInTheDocument()
      expect(within(panel).getByRole('slider', { name: `${name} level` })).toBeInTheDocument()
    }
    // The routing bar lists the reference's nine sources, all of them this engine's: the amp
    // envelope, two free envelopes, six LFOs. A name shows its trio of panels.
    const routing = screen.getByRole('list', { name: 'Routing' })
    expect(within(routing).getAllByRole('listitem')).toHaveLength(12)
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
    expect(within(screen.getByRole('region', { name: 'Modulator 4' })).getByRole('combobox', { name: 'Target' })).toHaveTextContent('Layer 1 cutoff')
  })

  /** Four destinations was most of the reason a dropped modulator seemed to do nothing. */
  it('takes a modulator on the resonance, the pan and the phase depth as well as the four it had', () => {
    open(arcadeCoin().id)
    const where = (region: string, control: string) =>
      within(screen.getByRole('region', { name: region })).getByRole('slider', { name: control })
    expect(where('Filter', 'Reso')).toHaveAttribute('data-target', 'layers[0].resonance')
    expect(where('Oscillators', 'PM1')).toHaveAttribute('data-target', 'layers[0].pm')
    expect(where('Amp envelope', 'Pan')).toHaveAttribute('data-target', 'layers[0].pan')
    // And a dial that is not a destination says so by carrying no target at all.
    expect(where('Oscillators', 'Fall')).not.toHaveAttribute('data-target')
  })

  /** One arc said the first source was the only one, which was a picture that lied about the sound. */
  it('wears one ring a source when two are pointed at the same dial, and says so', () => {
    open(arcadeCoin().id)
    const cutoff = within(screen.getByRole('region', { name: 'Filter' })).getByRole('slider', { name: 'Cutoff' })
    const drop = (handle: string) => {
      const grab = screen.getByRole('button', { name: `Drag ${handle} onto a control to modulate it` })
      const under = document.elementFromPoint
      document.elementFromPoint = () => cutoff
      try {
        fireEvent.pointerDown(grab, { clientX: 10, clientY: 10 })
        fireEvent.pointerUp(grab, { clientX: 20, clientY: 20 })
      } finally {
        document.elementFromPoint = under
      }
    }
    drop('L4')
    expect(cutoff.querySelectorAll('.fp-knob__mod')).toHaveLength(1)
    drop('L5')
    expect(cutoff.querySelectorAll('.fp-knob__mod')).toHaveLength(2)
    expect(cutoff).toHaveAttribute('aria-valuetext', expect.stringContaining('modulated by 2 sources'))
  })

  it('lists every routing in the patch, and what is on one control when asked', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    const cutoff = within(screen.getByRole('region', { name: 'Filter' })).getByRole('slider', { name: 'Cutoff' })
    const grab = screen.getByRole('button', { name: 'Drag L4 onto a control to modulate it' })
    const under = document.elementFromPoint
    document.elementFromPoint = () => cutoff
    try {
      fireEvent.pointerDown(grab, { clientX: 10, clientY: 10 })
      fireEvent.pointerUp(grab, { clientX: 20, clientY: 20 })
    } finally {
      document.elementFromPoint = under
    }
    // The bar keeps the count, and the list names the source, the control and how far it swings.
    const overlay = screen.getByRole('button', { name: /routed$/ })
    expect(overlay).toHaveTextContent('1 routed')
    await user.click(overlay)
    expect(screen.getByRole('menuitem')).toHaveTextContent('Layer 1 cutoff')
    await user.keyboard('{Escape}')
    // And the control itself answers who is on it, and lets one of them go.
    fireEvent.contextMenu(cutoff, { clientX: 40, clientY: 40 })
    expect(await screen.findByRole('menuitem', { name: /Show L4/ })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Take L4 off it' }))
    expect(cutoff.querySelectorAll('.fp-knob__mod')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /routed$/ })).toHaveTextContent('Nothing routed')
  })

  /** A macro is a control of the rig: dropped on a dial, it exposes that dial to Tune and the SDK. */
  it('assigns a macro by dropping its number on a control, and that is the document rig', async () => {
    // A fresh document has no rig yet, so its macros are the default table.
    // Named so as not to shadow the global document, whose elementFromPoint the drop reads.
    const doc = createAudioDocument()
    open(doc.id)
    const filter = screen.getByRole('region', { name: 'Filter' })
    const cutoff = within(filter).getByRole('slider', { name: 'Cutoff' })
    // Cutoff wears macro 5 out of the box; the tenth macro will take it over.
    expect(within(cutoff).getByText('5')).toBeInTheDocument()
    const handle = screen.getByRole('button', { name: /^Macro 10/ })
    const under = document.elementFromPoint
    document.elementFromPoint = () => cutoff
    try {
      fireEvent.pointerDown(handle, { clientX: 10, clientY: 10 })
      fireEvent.pointerUp(handle, { clientX: 20, clientY: 20 })
    } finally {
      document.elementFromPoint = under
    }
    expect(within(cutoff).getByText('10')).toBeInTheDocument()
    expect(within(cutoff).queryByText('5')).toBeNull()
    const band = screen.getByRole('group', { name: 'Macros' })
    expect(within(band).getByRole('slider', { name: 'Cutoff 1' })).toBeInTheDocument()
    // The rig reaches storage with the patch, bound under the macro's number.
    await waitFor(() => {
      const saved = getAudioDocument(doc.id)
      expect(saved?.rig?.bindings.find((binding) => binding.id === 'macro-10')?.property).toBe('layers[0].filterA.cutoff')
      expect(saved?.rig?.bindings.some((binding) => binding.id === 'macro-5')).toBe(false)
    })
  })

  /**
   * The same two moves from the keyboard, which is the only route a rig has: a macro is what
   * exposes a control, and the Tune button only appears once something is exposed. Until this
   * existed, none of it could be reached without a pointer.
   */
  it('picks a macro up and puts it down with the keyboard', async () => {
    const user = userEvent.setup()
    const doc = createAudioDocument()
    open(doc.id)
    const reso = within(screen.getByRole('region', { name: 'Filter' })).getByRole('slider', { name: 'Reso' })
    const handle = screen.getByRole('button', { name: /^Macro 12/ })
    handle.focus()
    await user.keyboard('{Enter}')
    reso.focus()
    await user.keyboard('{Enter}')
    expect(within(reso).getByText('12')).toBeInTheDocument()
    await waitFor(() => {
      expect(getAudioDocument(doc.id)?.rig?.bindings.find((binding) => binding.id === 'macro-12')?.property)
        .toBe('layers[0].filterA.resonance')
    })
    // And Delete frees it again.
    screen.getByRole('button', { name: /^Macro 12/ }).focus()
    await user.keyboard('{Delete}')
    expect(within(reso).queryByText('12')).toBeNull()
  }, 15_000)

  it('keeps a second sound on the other side, and swaps between them', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    const ab = screen.getByRole('group', { name: 'A and B' })
    expect(within(ab).getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true')
    const cutoff = () => within(screen.getByRole('region', { name: 'Filter' })).getByRole('slider', { name: 'Cutoff' })
    const was = cutoff().getAttribute('aria-valuenow')
    // B starts as a copy of A, so the first change to it is the thing being compared.
    await user.click(within(ab).getByRole('button', { name: 'B' }))
    expect(within(ab).getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'true')
    cutoff().focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    const other = cutoff().getAttribute('aria-valuenow')
    expect(other).not.toBe(was)
    // And A is where it was left, not where B went.
    await user.click(within(ab).getByRole('button', { name: 'A' }))
    expect(cutoff().getAttribute('aria-valuenow')).toBe(was)
    await user.click(within(ab).getByRole('button', { name: 'B' }))
    expect(cutoff().getAttribute('aria-valuenow')).toBe(other)
  })

  it('finds a sound by name or by family, and says how many are left', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    await user.click(screen.getByRole('tab', { name: 'Sounds' }))
    const browser = screen.getByRole('tabpanel')
    const all = within(browser).getAllByRole('button').length
    await user.type(within(browser).getByRole('searchbox', { name: 'Find a sound' }), 'laser')
    expect(within(browser).getAllByRole('button').length).toBeLessThan(all)
    expect(within(browser).getByRole('button', { name: /Laser/ })).toBeInTheDocument()
    await user.clear(within(browser).getByRole('searchbox', { name: 'Find a sound' }))
    await user.type(within(browser).getByRole('searchbox', { name: 'Find a sound' }), 'nothing is called this')
    expect(within(browser).getByText(/Nothing here is called that/)).toBeInTheDocument()
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

  /** The length as the transport prints it, so a test can name a sound by what it reads. */
  const lengthOf = (at: number) => {
    const { duration } = PRESET_ORDER[at]!.build()
    return duration < 1 ? `${Math.round(duration * 1000)} ms` : `${duration.toFixed(2)} s`
  }

  /** Stepping is how these get used: you rarely know which sound you want, only that not this one. */
  it('steps through the sounds, one undoable step each', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    expect(screen.getByText('450 ms')).toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'Next sound' })
    await user.click(next)
    expect(screen.getByText(lengthOf(0))).toBeInTheDocument()
    await user.click(next)
    expect(screen.getByText(lengthOf(1))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText(lengthOf(0))).toBeInTheDocument()
  }, 15_000)

  it('steps backwards too, wrapping round the end of the list', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    await user.click(screen.getByRole('button', { name: 'Previous sound' }))
    // Read from the list rather than written down, so adding a preset does not silently make this
    // assert the wrong one — and from the order the arrows actually walk, which is the order every
    // list on screen shows rather than the order the file was written in.
    const last = PRESET_ORDER[PRESET_ORDER.length - 1]!.build()
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
    // The menu is still open, so this is the row going rather than the menu closing over it. It
    // used to be asserted with the menu shut, which passed for a while when the trash icon was
    // loading the sound instead of removing it.
    expect(screen.getByRole('menu', { name: /^Sound:/ })).toBeInTheDocument()
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
    // The curve dial is drawn with the reference's word, Shape; what it is called out loud says
    // which layer's it is, because three envelopes are on the plate at once.
    expect(within(layer).getByText('Shape')).toBeInTheDocument()
    expect(within(layer).getByRole('slider', { name: 'Layer 1 envelope shape' })).toBeInTheDocument()
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

/**
 * The history, and the two things that used to fall out of it.
 *
 * A step was only ever the patch, so an undo across a load left the bar naming a sound the patch
 * on screen did not come from — and Replace writes to whatever the bar names. And a kept sound
 * removed by a mis-aimed click on the small trash icon inside the row was gone, four hundred
 * milliseconds later on disk, with Undo still enabled and undoing something else.
 */
describe('the history', () => {
  it('redoes what it undid, and stops when there is nothing left', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    const next = screen.getByRole('button', { name: 'Next sound' })
    const { duration: first } = PRESET_ORDER[0]!.build()
    const { duration: second } = PRESET_ORDER[1]!.build()
    const shown = (seconds: number) => (seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`)
    await user.click(next)
    await user.click(next)
    expect(screen.getByText(shown(second))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText(shown(first))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByText(shown(second))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveAttribute('aria-disabled', 'true')
  }, 20_000)

  it('takes the name of the sound back with the sound', async () => {
    const user = userEvent.setup()
    open(arcadeCoin().id)
    const next = screen.getByRole('button', { name: 'Next sound' })
    await user.click(next)
    const first = screen.getByRole('button', { name: /^Sound:/ }).textContent
    await user.click(next)
    expect(screen.getByRole('button', { name: /^Sound:/ }).textContent).not.toBe(first)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: /^Sound:/ }).textContent).toBe(first)
  }, 20_000)

  it('gives a removed sound back while the notice is still up', async () => {
    const user = userEvent.setup()
    open(createAudioDocument().id)
    await user.click(screen.getByRole('button', { name: 'Keep this sound' }))
    await user.click(screen.getByRole('button', { name: /^Sound:/ }))
    const row = await screen.findByRole('menuitem', { name: /Sound 1/ })
    await user.click(within(row).getByRole('button', { name: /Remove/i }))
    // The menu stays open — removing one of several is not a reason to close it — and while it is
    // open the rest of the page is hidden from the accessibility tree, so it has to be let go of.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('status', { name: 'Editor notice' })).toHaveTextContent('Removed Sound 1')
    await user.click(within(screen.getByRole('status', { name: 'Editor notice' })).getByRole('button', { name: 'Undo' }))
    await user.click(screen.getByRole('button', { name: /^Sound:/ }))
    expect(await screen.findByRole('menuitem', { name: /Sound 1/ })).toBeInTheDocument()
  }, 20_000)
})
