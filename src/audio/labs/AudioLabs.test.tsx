import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioLabs } from './AudioLabs'
import { LabsPalette } from './LabsPalette'
import { DurationRange } from './DurationRange'
import { createLabBatch, generateSound, measureRender, renderCandidate } from './generate'
import { renderPatch } from '@paramrig/audio'
import { makeLayer, makeMod, makePatch } from '@paramrig/audio'
import { makeLabSound } from './design'
import { DURATION_MIN, emptyLabSession, DEFAULT_CRITERIA, type LabSession } from './model'
import { sanitizeLabSession } from './session'
import { describeLabRecipe } from './discovery'
import { useLabs } from './useLabs'
import type { WorkerInput, WorkerOutput } from './worker'

const played = vi.fn<(samples: { left: Float32Array }, rate: number, onEnded?: () => void) => boolean>(() => true)
vi.mock('../playback', () => ({
  audioContext: () => ({ currentTime: 12, resume: () => Promise.resolve() }),
  playSamples: (...args: [{ left: Float32Array }, number, (() => void)?]) => played(...args),
  stopPlayback: () => undefined,
}))
// The bench's own voice, with the speakers taken out: it reports what it was asked to play.
vi.mock('./labVoice', () => ({
  playLabVoice: (samples: { left: Float32Array }, rate: number, options: { onEnded?: () => void } = {}) => {
    played(samples, rate, options.onEnded)
    const duration = samples.left.length / rate
    return { startedAt: 12, duration, period: duration + 0.18, setGain: () => undefined, setSide: () => undefined, setLoop: () => undefined, stop: () => undefined }
  },
  stopLabVoice: () => undefined,
}))

/** The worker, run in this thread: the same generator the real one calls, delivered the same way. */
class InlineWorker {
  static count = 0
  static requests: WorkerInput[] = []
  onmessage: ((event: MessageEvent<WorkerOutput>) => void) | null = null
  onerror: (() => void) | null = null
  terminate = vi.fn()
  constructor() { InlineWorker.count += 1 }
  postMessage(input: WorkerInput) {
    InlineWorker.requests.push(input)
    const emit = (data: WorkerOutput) => this.onmessage?.({ data } as MessageEvent<WorkerOutput>)
    if (input.kind === 'preview') {
      const { finite: _finite, ...measured } = measureRender(renderPatch(input.sound.patch, input.rate), input.rate)
      emit({ kind: 'candidate', candidate: { sound: input.sound, ...measured } })
      emit({ kind: 'done', issue: '' })
      return
    }
    const result = createLabBatch(input.request, input.rate, (candidate) => emit({ kind: 'candidate', candidate }))
    emit({ kind: 'done', issue: result.issue })
  }
}

const RATE = 16000
// The real bench receives gain-calibrated renders, never the raw synthesis design.
const original = renderCandidate(generateSound(DEFAULT_CRITERIA, 17), RATE)!.sound
const second = { ...renderCandidate(generateSound(DEFAULT_CRITERIA, 71), RATE)!.sound, name: 'Second candidate' }

function open(initial: LabSession = { ...emptyLabSession(), history: [original, second], current: second.id }) {
  const saved = { state: initial }
  const onOpen = vi.fn(), onSave = vi.fn(() => null)
  function Harness() {
    const [session, setSession] = useState(initial)
    const lab = useLabs({ session, onChange: (next) => { saved.state = next; setSession(next) }, instrument: original.patch, name: 'Instrument', rate: RATE, onOpen, onSave, onBeforePlay: () => undefined, active: true })
    return <>
      <LabsPalette lab={lab} compact={false} inert={false} onNavigate={() => undefined} snapshots={[]} instrumentName="Instrument" />
      <AudioLabs lab={lab} />
    </>
  }
  return { ...render(<MemoryRouter><Harness /></MemoryRouter>), saved, onOpen, onSave }
}
beforeEach(() => { vi.stubGlobal('Worker', InlineWorker); InlineWorker.count = 0; InlineWorker.requests = []; played.mockClear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('the bench', () => {
  it('fills only visible reserve thumbnails without playing, selecting or editing saved audio', async () => {
    vi.useFakeTimers()
    const first = { ...original, preview: undefined }, other = { ...second, preview: undefined }
    class Observer {
      constructor(private receive: (entries: { target: Element; isIntersecting: boolean }[]) => void) {}
      observe(target: Element) { this.receive([{ target, isIntersecting: target.getAttribute('data-thumbnail') === first.fingerprint }]) }
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Observer)
    try {
      const initial = { ...emptyLabSession(), reserve: [first, other] }
      const app = open(initial)
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(InlineWorker.requests).toHaveLength(1)
      expect(InlineWorker.requests[0]).toMatchObject({ kind: 'preview', sound: { fingerprint: first.fingerprint } })
      expect(app.saved.state.reserve[0]!.preview!.bins.length).toBeGreaterThan(0)
      expect(app.saved.state.reserve[1]!.preview).toBeUndefined()
      expect(app.saved.state.reserve.map((sound) => sound.patch)).toEqual(initial.reserve.map((sound) => sound.patch))
      expect(app.saved.state.history).toEqual([])
      expect(app.saved.state.current).toBeNull()
      expect(app.saved.state.criteria).toEqual(initial.criteria)
      expect(played).not.toHaveBeenCalled()
      app.unmount()
    } finally { vi.useRealTimers() }
  })
  it('upgrades a legacy history preview once, including its reserve copy, without adding an undo step', async () => {
    vi.useFakeTimers()
    const legacy = { ...original, preview: { fingerprint: original.fingerprint, bins: original.preview!.bins } }
    class Observer {
      constructor(private receive: (entries: { target: Element; isIntersecting: boolean }[]) => void) {}
      observe(target: Element) { this.receive([{ target, isIntersecting: !!target.closest('.labs-row') }]) }
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Observer)
    try {
      const initial = { ...emptyLabSession(), history: [legacy], reserve: [legacy] }
      const app = open(initial)
      await act(async () => { await vi.advanceTimersByTimeAsync(800) })
      expect(InlineWorker.requests).toHaveLength(1)
      expect(app.saved.state.history[0]!.preview?.detail?.max).toHaveLength(384)
      expect(app.saved.state.reserve[0]!.preview).toEqual(app.saved.state.history[0]!.preview)
      expect(app.saved.state.history[0]!.patch).toEqual(legacy.patch)
      expect(app.saved.state.current).toBeNull()
      expect(played).not.toHaveBeenCalled()
      fireEvent.keyDown(window, { key: 'z', metaKey: true })
      expect(app.saved.state.history[0]!.preview?.detail?.version).toBe(1)
      app.unmount()
    } finally { vi.useRealTimers() }
  })
  it('generates one sound per press, plays it at once, and keeps the last twenty', async () => {
    const user = userEvent.setup(), app = open({ ...emptyLabSession(), criteria: { ...DEFAULT_CRITERIA, minMs: 120, maxMs: 300 } })
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing on the bench yet' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Generate & play' }))
    expect(app.saved.state.history).toHaveLength(1)
    expect(app.saved.state.current).toBe(app.saved.state.history[0]!.id)
    expect(played).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { level: 2, name: app.saved.state.history[0]!.name })).toBeInTheDocument()
    // Bench and history row both show the voice; nothing else does.
    expect(screen.getAllByRole('button', { name: `Stop ${app.saved.state.history[0]!.name}`, pressed: true })).toHaveLength(2)
    await user.keyboard('g')
    expect(app.saved.state.history).toHaveLength(2)
    expect(played).toHaveBeenCalledTimes(2)
    const request = InlineWorker.requests.filter((input) => input.kind === 'batch').at(-1)!
    expect(request.request.recentRecipes).toEqual([app.saved.state.history[0]!.origin.recipe])
    expect(app.saved.state.history[1]!.origin.recipe.split('/')[2]).not.toBe(app.saved.state.history[0]!.origin.recipe.split('/')[2])
    // One voice: the first sound is no longer the one playing.
    expect(screen.getAllByRole('button', { pressed: true }).filter((button) => button.classList.contains('labs-play'))).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /^Stop / })).toHaveLength(2)
    for (let i = 0; i < 20; i++) await user.keyboard('g')
    expect(app.saved.state.history).toHaveLength(20)
    expect(screen.getAllByRole('listitem').filter((item) => item.classList.contains('labs-row'))).toHaveLength(20)
    expect(screen.getByText('Last 20')).toBeInTheDocument()
    // The worker is kept between presses rather than rebooted.
    expect(InlineWorker.count).toBe(1)
  })
  it('brings a passed sound back from the history, by click and by arrow', async () => {
    const user = userEvent.setup(), app = open()
    expect(screen.getByRole('heading', { level: 2, name: 'Second candidate' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `${original.name}, ${Math.round(original.patch.duration * 1000)} milliseconds` }))
    expect(app.saved.state.current).toBe(original.id)
    expect(played).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { level: 2, name: original.name })).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(app.saved.state.current).toBe(second.id)
    await user.keyboard('{ArrowLeft}')
    expect(app.saved.state.current).toBe(original.id)
    expect(played).toHaveBeenCalledTimes(3)
  })
  it('prepares the next sound from the palette without touching the one on the bench', async () => {
    const user = userEvent.setup(), app = open()
    await user.click(screen.getByRole('radio', { name: 'Impact' }))
    await user.click(screen.getByRole('tab', { name: 'Timbre' }))
    await user.click(screen.getByRole('radio', { name: 'Glass' }))
    await user.click(screen.getByRole('radio', { name: 'Alien' }))
    await user.click(screen.getByRole('checkbox', { name: 'Sub bass' }))
    await user.click(screen.getByRole('tab', { name: 'Behaviour' }))
    await user.click(screen.getByRole('radio', { name: 'Pulsed' }))
    await user.click(screen.getByRole('radio', { name: 'Heavy' }))
    expect(app.saved.state.criteria).toMatchObject({ type: 'impact', material: 'glass', character: 'alien', avoid: ['sub'], motion: 'pulsed', mass: 'heavy' })
    expect(app.saved.state.current).toBe(second.id)
    expect(played).not.toHaveBeenCalled()
    await user.keyboard('{Meta>}z{/Meta}')
    expect(app.saved.state.criteria.mass).toBeUndefined()
    await user.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}')
    expect(app.saved.state.criteria.mass).toBe('heavy')
  })
  it('sends the gesture, the ending, the texture, the register and the two dials with the next sound', async () => {
    const user = userEvent.setup(), app = open()
    await user.click(screen.getByRole('radio', { name: 'Transform' }))
    await user.click(screen.getByRole('tab', { name: 'Behaviour' }))
    const gestures = within(screen.getByRole('radiogroup', { name: 'Gesture' }))
    expect(gestures.getAllByRole('radio').map((radio) => radio.closest('label')!.textContent)).toEqual(['Auto', 'Assemble → Lock', 'Deploy', 'Retract', 'Break apart', 'Charge → Impact'])
    await user.click(gestures.getByRole('radio', { name: 'Assemble → Lock' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Ending' })).getByRole('radio', { name: 'Cut' }))
    await user.click(screen.getByRole('tab', { name: 'Timbre' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Texture' })).getByRole('radio', { name: 'Friction' }))
    await user.click(screen.getByRole('tab', { name: 'Pitch' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Register' })).getByRole('radio', { name: 'Low' }))
    const intensity = screen.getByRole('slider', { name: 'Intensity' })
    expect(intensity).toHaveAttribute('aria-valuetext', 'Auto')
    fireEvent.keyDown(intensity, { key: 'ArrowUp' })
    fireEvent.keyDown(intensity, { key: 'PageUp' })
    expect(app.saved.state.criteria).toMatchObject({ type: 'transformation', gesture: 'assemble-lock', ending: 'cut', texture: 'friction', register: 'low', intensity: 0.6 })
    fireEvent.keyDown(intensity, { key: 'Delete' })
    expect(app.saved.state.criteria.intensity).toBeNull()
    // A family that does not offer the gesture takes Auto instead.
    await user.click(screen.getByRole('tab', { name: 'Source' }))
    await user.click(screen.getByRole('radio', { name: 'Growl' }))
    expect(app.saved.state.criteria.gesture).toBe('auto')
    // A gesture longer than the range allows says so on the button rather than failing silently.
    await user.click(screen.getByRole('radio', { name: 'Transform' }))
    await user.click(screen.getByRole('tab', { name: 'Behaviour' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Gesture' })).getByRole('radio', { name: 'Assemble → Lock' }))
    const min = screen.getByRole('textbox', { name: 'Minimum duration in milliseconds' })
    await user.clear(min); await user.type(min, '100'); await user.tab()
    const max = screen.getByRole('textbox', { name: 'Maximum duration in milliseconds' })
    await user.clear(max); await user.type(max, '200'); await user.tab()
    expect(app.saved.state.criteria).toMatchObject({ minMs: 100, maxMs: 200, gesture: 'assemble-lock' })
    expect(screen.getByRole('button', { name: 'Generate & play' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('the full palette', () => {
  it('finds a subtype and generates it with new timbre, motion and diversity choices', async () => {
    const user = userEvent.setup(), app = open()
    const before = structuredClone(app.saved.state.history)
    await user.type(screen.getByRole('searchbox'), 'turbine')
    await user.click(screen.getByRole('button', { name: 'Turbine Engine' }))
    expect(app.saved.state.criteria).toMatchObject({ type: 'engine', subtype: 'turbine' })
    await user.click(screen.getByRole('tab', { name: 'Timbre' }))
    await user.click(screen.getByRole('radio', { name: 'Wood' }))
    await user.click(screen.getByRole('radio', { name: 'Acoustic' }))
    await user.click(screen.getByRole('radio', { name: 'Gritty' }))
    await user.click(screen.getByRole('tab', { name: 'Behaviour' }))
    await user.click(screen.getByRole('radio', { name: 'Decelerating' }))
    await user.click(screen.getByRole('radio', { name: 'Wild' }))
    expect(app.saved.state.history).toEqual(before)
    await user.click(screen.getByRole('button', { name: 'Generate & play' }))
    expect(played).toHaveBeenCalledTimes(1)
    const sound = app.saved.state.history.at(-1)!
    expect(sound.criteria).toMatchObject({ type: 'engine', subtype: 'turbine', material: 'wood', character: 'acoustic', texture: 'gritty', motion: 'decelerating', diversity: 'wild' })
    expect(describeLabRecipe(sound.origin.recipe)).toMatchObject({ family: 'engine', subtype: 'turbine', material: 'wood', character: 'acoustic' })
  })
  it('draws from multiple dimensions across domains and keeps the choices after saving and restoring', async () => {
    const user = userEvent.setup(), app = open()
    await user.click(screen.getByRole('radio', { name: 'Any' }))
    await user.click(screen.getByRole('button', { name: 'Select multiple families' }))
    await user.click(screen.getByRole('button', { name: 'Nature' }))
    await user.click(screen.getByRole('checkbox', { name: 'Water' }))
    await user.click(screen.getByRole('button', { name: 'Music' }))
    await user.click(screen.getByRole('checkbox', { name: 'Keys' }))
    await user.click(screen.getByRole('tab', { name: 'Timbre' }))
    await user.click(screen.getByRole('button', { name: 'Select multiple materials' }))
    await user.click(screen.getByRole('checkbox', { name: 'Glass' }))
    await user.click(screen.getByRole('button', { name: 'Select multiple characters' }))
    await user.click(screen.getByRole('checkbox', { name: 'Clean' }))
    expect(app.saved.state.criteria.pool).toEqual({ families: ['water', 'keys'], materials: ['metal', 'glass'], characters: ['futuristic', 'clean'] })
    await user.click(screen.getByRole('button', { name: 'Generate & play' }))
    const first = app.saved.state.history.at(-1)!
    const recipe = describeLabRecipe(first.origin.recipe)!
    expect(['water', 'keys']).toContain(recipe.family)
    expect(['metal', 'glass']).toContain(recipe.material)
    expect(['futuristic', 'clean']).toContain(recipe.character)
    await user.click(screen.getByRole('button', { name: 'Keep in the reserve (K)' }))
    await user.click(screen.getByRole('button', { name: 'Generate & play' }))
    expect(describeLabRecipe(app.saved.state.history.at(-1)!.origin.recipe)!.family).not.toBe(recipe.family)
    const restored = sanitizeLabSession(JSON.parse(JSON.stringify(app.saved.state)))
    expect(restored.criteria.pool).toEqual(app.saved.state.criteria.pool)
    expect(screen.getByRole('article', { name: `${first.name}, kept sound 1` })).not.toHaveTextContent('Any · Any')
    expect(restored.reserve[0]!.patch).toEqual(first.patch)
    expect(restored.reserve[0]!.criteria).toEqual(first.criteria)
  })
  it('generates an exact musical chord and makes dependent resets undoable', async () => {
    const user = userEvent.setup(), app = open()
    await user.type(screen.getByRole('searchbox'), 'organ')
    await user.click(screen.getByRole('button', { name: 'Organ Pad' }))
    await user.click(screen.getByRole('tab', { name: 'Pitch' }))
    await user.click(screen.getByRole('button', { name: 'Higher octave' }))
    await user.click(screen.getByRole('radio', { name: 'C4' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Scale' })).getByRole('radio', { name: 'Minor' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Chord' })).getByRole('radio', { name: 'Minor' }))
    await user.click(screen.getByRole('radio', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Generate & play' }))
    const sound = app.saved.state.history.at(-1)!
    expect(sound.criteria).toMatchObject({ type: 'pad', subtype: 'organ', rootNote: 60, register: 'auto', scale: 'minor', chord: 'minor', voicing: 'open' })
    expect(describeLabRecipe(sound.origin.recipe)).toMatchObject({ family: 'pad', subtype: 'organ', chord: 'minor', voicing: 'open', layout: 'chord' })
    expect(played).toHaveBeenCalledTimes(1)
    const criteria = structuredClone(app.saved.state.criteria)
    await user.click(screen.getByRole('button', { name: /^Edit Source:/ }))
    await user.click(screen.getByRole('button', { name: 'Effects' }))
    await user.click(screen.getByRole('radio', { name: 'Impact' }))
    expect(app.saved.state.criteria).toMatchObject({ subtype: 'auto', chord: 'none' })
    const notice = screen.getByRole('status', { name: 'Labs notice' })
    expect(notice).toHaveTextContent('Chord cleared')
    await user.click(within(notice).getByRole('button', { name: 'Undo' }))
    expect(app.saved.state.criteria).toEqual(criteria)
    expect(app.saved.state.history.at(-1)!.patch).toEqual(sound.patch)
    const restored = sanitizeLabSession(JSON.parse(JSON.stringify(app.saved.state)))
    expect(restored.history.at(-1)!.patch).toEqual(sound.patch)
    expect(restored.criteria).toEqual(JSON.parse(JSON.stringify(criteria)))
  })
  it('opens summaries out of search and leaves navigation keys with the palette', async () => {
    const user = userEvent.setup(), app = open()
    await user.type(screen.getByRole('searchbox'), 'glassy')
    expect(played).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('searchbox')).toHaveValue('')
    await user.click(screen.getByRole('tab', { name: 'Source' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Timbre', selected: true })).toHaveFocus()
    expect(app.saved.state.current).toBe(second.id)
    await user.type(screen.getByRole('searchbox'), 'wood')
    await user.click(screen.getByRole('button', { name: /^Edit Pitch:/ }))
    expect(screen.getByRole('tab', { name: 'Pitch', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getByRole('radiogroup', { name: 'Chord' })).toBeInTheDocument()
    expect(played).not.toHaveBeenCalled()
  })
})

describe('the reserve', () => {
  it('keeps, renames, removes and restores a snapshot without opening Instrument', async () => {
    const user = userEvent.setup(), app = open()
    await user.click(screen.getByRole('button', { name: `Keep ${original.name}` }))
    expect(app.saved.state.reserve).toHaveLength(1)
    expect(app.onOpen).not.toHaveBeenCalled()
    const name = screen.getByRole('textbox', { name: 'Reserve sound 1 name' })
    await user.clear(name); await user.type(name, 'My keeper')
    expect(app.saved.state.reserve[0]!.name).toBe('My keeper')
    expect(app.saved.state.history[0]!.name).toBe(original.name)
    await user.click(screen.getByRole('button', { name: 'Remove My keeper from the reserve' }))
    expect(app.saved.state.reserve).toHaveLength(0)
    expect(screen.getByRole('status', { name: 'Labs notice' })).toHaveTextContent('Removed My keeper')
    await user.click(within(screen.getByRole('status', { name: 'Labs notice' })).getByRole('button', { name: 'Undo' }))
    expect(app.saved.state.reserve[0]!.name).toBe('My keeper')
    const restored = sanitizeLabSession(JSON.parse(JSON.stringify(app.saved.state)))
    expect(restored.reserve[0]!.patch).toEqual(original.patch)
  })
  it('refuses to evict a full reserve and leaves the sound on the bench', async () => {
    const reserve = Array.from({ length: 24 }, (_, i) => ({ ...second, id: `kept-${i}`, fingerprint: `kept-${i}` }))
    const user = userEvent.setup(), app = open({ ...emptyLabSession(), reserve, history: [original], current: original.id })
    await user.click(screen.getByRole('button', { name: 'Keep in the reserve (K)' }))
    expect(app.saved.state.reserve).toHaveLength(24)
    expect(screen.getByRole('status', { name: 'Labs notice' })).toHaveTextContent('holds 24 sounds')
    expect(app.saved.state.current).toBe(original.id)
  })
})

describe('variations and fusion', () => {
  it.each(['texture', 'attack', 'motion', 'resonance'] as const)('fuses and plays %s using the principal intent after a different Explore search', async (contribution) => {
    const user = userEvent.setup()
    const principal = makeLabSound(makePatch(0.8, [makeLayer({ pitch: { start: 70 } })]), DEFAULT_CRITERIA, { kind: 'generated', recipe: 'growl', version: 1, seed: 11, parentIds: [] }, 'Fusion principal')
    const patch = makePatch(0.5, [makeLayer({ pitch: { start: 300 } }), makeLayer({ source: { kind: 'noise' } })])
    patch.mods[0] = makeMod({ enabled: true, target: 'layers[0].cutoff', targetB: 'layers[1].cutoff', depth: 0.2, depthB: 0.1 })
    const donor = makeLabSound(patch, { ...DEFAULT_CRITERIA, type: 'impact' }, { kind: 'generated', recipe: 'impact', version: 1, seed: 12, parentIds: [] }, 'Fusion donor')
    const app = open({ ...emptyLabSession(), mode: 'fuse', principal: principal.id, contributor: donor.id, contribution, reserve: [principal, donor], criteria: { ...DEFAULT_CRITERIA, type: 'any', pool: { families: ['pad', 'keys'] }, subtype: 'auto', rootNote: 60, scale: 'minor', chord: 'minor', voicing: 'open', diversity: 'wild', material: 'electrical', character: 'industrial', motion: 'accelerating', texture: 'vocal', minMs: 700, maxMs: 1200 } })
    await user.click(screen.getByRole('button', { name: 'Fuse & play' }))
    expect(app.saved.state.history).toHaveLength(1)
    const result = app.saved.state.history[0]!
    expect(result.origin.kind).toBe('fusion')
    expect(result.origin.contribution).toBe(contribution)
    expect(result.criteria).toEqual({ ...principal.criteria, minMs: 700, maxMs: 1200 })
    expect(played).toHaveBeenCalledTimes(1)
    expect(app.saved.state.reserve).toEqual([principal, donor])
    const restored = sanitizeLabSession(JSON.parse(JSON.stringify(app.saved.state)))
    expect(restored.history[0]!.patch).toEqual(result.patch)
    expect(restored.history[0]!.roles).toEqual(result.roles)
    await user.click(screen.getByRole('tab', { name: 'Explore' }))
    expect(screen.getByRole('button', { name: 'Generate & play' })).toBeInTheDocument()
  })
  it('varies a reference after Explore selections have changed', async () => {
    const user = userEvent.setup()
    const app = open({ ...emptyLabSession(), mode: 'vary', reference: original, criteria: { ...DEFAULT_CRITERIA, type: 'drone', material: 'electrical', texture: 'vocal' } })
    await user.click(screen.getByRole('button', { name: 'Vary & play' }))
    expect(app.saved.state.history).toHaveLength(1)
    expect(app.saved.state.history[0]!.origin.kind).toBe('variation')
    expect(app.saved.state.history[0]!.criteria).toEqual(original.criteria)
    expect(played).toHaveBeenCalledTimes(1)
  })
  it('anchors variations to an explicit reference, adjusts it with locks, and varies from it', async () => {
    const user = userEvent.setup(), app = open()
    await user.keyboard('r')
    expect(app.saved.state.mode).toBe('vary')
    expect(app.saved.state.reference?.id).toBe(second.id)
    expect(screen.getByRole('tab', { name: 'Variations', selected: true })).toBeInTheDocument()
    const before = structuredClone(app.saved.state.reference!.patch)
    await user.click(screen.getByRole('button', { name: 'Timbre controls' }))
    const grain = await screen.findByRole('slider', { name: 'Grain' })
    fireEvent.keyDown(grain, { key: 'ArrowUp' })
    expect(app.saved.state.reference!.patch).not.toEqual(before)
    expect(app.saved.state.history.find((s) => s.id === second.id)!.patch).toEqual(app.saved.state.reference!.patch)
    await user.click(screen.getByRole('button', { name: 'Lock Grain for variations' }))
    expect(app.saved.state.locks[0]).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Vary & play' }))
    expect(app.saved.state.history).toHaveLength(3)
    const child = app.saved.state.history[2]!
    expect(child.origin.kind).toBe('variation'); expect(child.parents[0]!.id).toBe(second.id)
    expect(app.saved.state.reference!.id).toBe(second.id)
    // Auditioning another sound leaves the reference where it is.
    await user.click(screen.getByRole('button', { name: `Play ${original.name}` }))
    expect(app.saved.state.reference!.id).toBe(second.id)
  })
  it('switches modes with the arrows and explains what fusion still needs', async () => {
    const user = userEvent.setup()
    open({ ...emptyLabSession(), reserve: [original, second] })
    await user.click(screen.getByRole('tab', { name: 'Explore' }))
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Fusion', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Principal' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Contributor' })).toBeInTheDocument()
    const fuse = screen.getByRole('button', { name: 'Fuse & play' })
    expect(fuse).toHaveAttribute('aria-disabled', 'true')
    await user.click(fuse)
    expect(screen.getByRole('status', { name: 'Labs notice' })).toHaveTextContent('Choose a principal and a contributor')
  })
  it('opens a kept sound in Instrument with its rig', async () => {
    const user = userEvent.setup(), app = open({ ...emptyLabSession(), reserve: [original], history: [original], current: original.id })
    const reserve = within(screen.getByRole('complementary', { name: 'Sound reserve' }))
    await user.click(reserve.getByRole('button', { name: `More for ${original.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open in Instrument' }))
    expect(app.onOpen).toHaveBeenCalledWith(expect.objectContaining({ patch: original.patch }))
  })
})

describe('duration interval', () => {
  it('allows equal endpoints, corrects crossing inputs and accepts keyboard editing', async () => {
    const onChange = vi.fn(), user = userEvent.setup()
    const view = render(<DurationRange min={400} max={900} onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Minimum duration in milliseconds' })
    await user.clear(input); await user.type(input, '900'); await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(900, 900)
    view.rerender(<DurationRange min={900} max={900} onChange={onChange} />)
    const max = screen.getByRole('textbox', { name: 'Maximum duration in milliseconds' })
    await user.clear(max); await user.type(max, '100'); await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(900, 900)
    act(() => { fireEvent.change(screen.getByRole('slider', { name: 'Minimum duration' }), { target: { value: 0 } }) })
    expect(onChange).toHaveBeenLastCalledWith(DURATION_MIN, 900)
  })
})
