import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ParamValue } from '@/rigs/types'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { useViewport } from '@/shell/useLayout'
import { updatePrefs } from '@/state/workspace'
import { Button, IconButton } from '@/ui/Button'
import { IconExport, IconRedo, IconSliders, IconUndo } from '@/ui/icons'
import { StatusMessage } from '@/ui/StatusMessage'
import { SelectField } from '@/ui/SelectField'
import { Tooltip } from '@/ui/Tooltip'
import { AudioFacePlate } from '@/audio/AudioFacePlate'
import { AudioSoundBar } from '@/audio/AudioSoundBar'
import { AudioSoundList } from '@/audio/AudioSoundList'
import { AudioLibraryDeck } from '@/audio/AudioLibraryDeck'
import { AudioTransport, type HearingMode } from '@/audio/AudioTransport'
import { boardParameters, boardValues, setBoardValue } from '@/audio/board'
import { AudioPresetsView } from '@/audio/AudioPresetsView'
import { getAudioDocument, MAX_SNAPSHOTS, saveAudioDocument, storageMessage, type AudioDocument, type AudioSnapshot } from '@/audio/document'
import type { AudioRig } from '@/audio/rig'
import { inspectWavetable, importWavetableFile, serializeAudioProject, restoreAudioAssets, MAX_IMPORT_BYTES, type WavetablePreview } from '@/audio/project'
import { decodeWav } from '@/audio/dsp/wav'
import { MAX_GESTURES, takeFromSamples } from '@/audio/gestures'
import { macroAmount, macrosOf, syncMacrosToPatch, writeMacros } from '@/audio/macros'
import { type AudioMode, readShufflePrefs, writeShufflePrefs, type ShufflePrefs } from '@/audio/prefs'
import { PRESETS } from '@/audio/presets'
import { mutateSound, randomPatch } from '@/audio/shuffle'
import { monoSum, renderPatch } from '@/audio/dsp/render'
import { gateLive, isLive, startLive, stopLive, triggerLive, updateLive, watchLiveMeter } from '@/audio/live'
import { useTransport } from '@/audio/useTransport'
import { layerProfiles } from '@/audio/profiles'
import { disposePlayback, playbackRate, audioContext } from '@/audio/playback'
import type { AudioPatch } from '@/audio/types'
import type { VoiceGate } from '@/audio/dsp/engine'
const AudioLabs = lazy(() => import('./labs/AudioLabs').then(module => ({ default: module.AudioLabs })))
import { LabsPalette } from './labs/LabsPalette'
import { useLabs } from './labs/useLabs'
import { emptyLabSession, fingerprint, labSources, type LabSound } from './labs/model'

const HISTORY_LIMIT = 100

/** What there is to play before a patch has loaded. */
const EMPTY = { left: new Float32Array(0), right: new Float32Array(0) }

/**
 * Instrument, Sounds and Labs: editing, browsing and procedural research.
 *
 * Modulation used to be a view of its own, which put giving a sound movement and shaping the voice
 * it moves in two places you could not occupy at once. It is a drawer under the instrument now, on
 * screen while you work, the way every synthesiser worth copying arranges it.
 */
type ViewId = 'instrument' | 'sounds' | 'labs'
const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'instrument', label: 'Instrument' },
  { id: 'sounds', label: 'Sounds' },
  { id: 'labs', label: 'Labs' },
]

/**
 * Edit mode: the instrument.
 *
 * The layout follows from what a sound is. A drawing earns the big canvas because looking at it is
 * the work; a sound does not, because the work is listening. So the parameters take the room and
 * the waveform takes a strip, and the loop the whole screen is arranged around — reach for a
 * control, hear the result — never has to go and find anything.
 *
 * The buffer is deferred rather than re-synthesised on every frame of a drag. Turning a knob has
 * to feel like turning a knob, and the ear is not listening mid-drag anyway.
 *
 * The column on the left holds the library rather than the rig list, on the pattern the drawing
 * and scene editors set: that column belongs to the document you have open, not to the ones you
 * do not. Stepping through sounds while watching the panels change is how anyone finds one.
 */
type Step = { patch: AudioPatch; preset: string; touched: boolean; rig?: AudioRig; reference: AudioPatch }

export function AudioEditorPage({ documentId, mode, onMode }: {
  documentId: string
  mode: AudioMode
  onMode: (mode: AudioMode) => void
}) {
  const navigate = useNavigate()
  const [loaded] = useState<AudioDocument | null>(() => getAudioDocument(documentId))
  // The macro band is the document's rig; it is edited on the plate and saved with the patch.
  const [rig, setRig] = useState<AudioRig | undefined>(() => getAudioDocument(documentId)?.rig)
  const [patch, setPatch] = useState<AudioPatch | null>(() => loaded?.patch ?? null)
  const [name, setName] = useState(loaded?.name ?? '')
  /**
   * One step of the history: the sound, and which saved sound the bar was naming when it was taken.
   *
   * The selection used to be left out, so an undo put a patch on screen under somebody else's name
   * with no "· edited" beside it — and Replace writes to whatever the name says, so one press
   * afterwards overwrote a saved sound with a patch that never came from it. A step has to carry
   * everything the step changed.
   */
  const [past, setPast] = useState<Step[]>([])
  const [future, setFuture] = useState<Step[]>([])
  const [notice, setNotice] = useState('')
  const [hearing, setHearing] = useState<HearingMode>('oneshot')
  const [liveOn, setLiveOn] = useState(false)
  const [liveMeter, setLiveMeter] = useState({ peak: 0, left: 0, right: 0 })
  const [recording, setRecording] = useState(false)
  const playRequest = useRef(0)
  const [assetRevision, setAssetRevision] = useState(0)
  const [tableImport, setTableImport] = useState<{ file: File; layer: number; preview: WavetablePreview; size: number } | null>(null)
  const takeRef = useRef<{ times: number[]; values: number[]; started: number; macro: number; before: Step; past: Step[]; future: Step[] } | null>(null)
  // Nothing is written until something is changed, or opening a bundled example would stamp a new
  // updatedAt and quietly turn it into this browser's project.
  const [dirty, setDirty] = useState(false)
  const [preset, setPreset] = useState('')
  const [view, setView] = useState<ViewId>('instrument')
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')
  const [snapshots, setSnapshots] = useState<AudioSnapshot[]>(() => loaded?.snapshots ?? [])
  const [labs, setLabs] = useState(() => loaded?.labs ?? emptyLabSession())
  // The palette takes a fifth of the window, as the mockup gives it, within bounds its tiles read at.
  const windowWidth = useViewport().width
  const [touched, setTouched] = useState(false)
  const gestureRef = useRef(false)
  const capturedRef = useRef(false)
  /** The patch as of the last write, so the end of a drag can hand it to the ear. */
  const latest = useRef<AudioPatch | null>(null)
  const mutateRef = useRef<AudioPatch | null>(loaded?.patch ?? null)
  const genToken = useRef(0)
  const [generating, setGenerating] = useState(false)
  const [shuffle, setShuffle] = useState<ShufflePrefs>(readShufflePrefs)
  const generatingRef = useRef(false)

  const parameters = useMemo(() => boardParameters(), [])
  const values = useMemo(() => (patch ? boardValues(patch) : {}), [patch])
  const rate = useMemo(() => playbackRate(), [])
  /**
   * The patch the ear is on. It follows the board immediately for anything discrete — a sound
   * loaded, a dice, a typed value — and holds still through a drag, because re-synthesising a
   * second and a half of audio sixty times a second is what makes a knob feel like treacle.
   *
   * This used to be a `useDeferredValue`, which deferred the wrong thing: it made the audio wait
   * on a re-render of a hundred and two fields, so changing sound took a visible moment to be
   * heard. Only the drag needs holding back, and a drag is something we already know about.
   */
  const [heard, setHeard] = useState<AudioPatch | null>(() => loaded?.patch ?? null)
  const samples = useMemo(() => { void assetRevision; return heard ? renderPatch(heard, rate) : EMPTY }, [heard, rate, assetRevision])
  // Playback is owned here rather than in the transport, because the waveform in the rail needs
  // the same playhead and two of these would be two audio pipelines. Above the early return, as
  // every hook must be.
  const transport = useTransport(samples, rate, false)
  const autoHeard = useRef(heard)
  const pendingSave = useRef<AudioDocument | null>(null)
  pendingSave.current = loaded && patch && dirty ? { ...loaded, name, patch: recording && takeRef.current ? takeRef.current.before.patch : patch, snapshots, labs, rig: recording && takeRef.current ? takeRef.current.before.rig : rig, updatedAt: new Date().toISOString() } : null
  useEffect(() => {
    const flush = () => {
      if (pendingSave.current && saveAudioDocument(pendingSave.current).ok) pendingSave.current = null
    }
    // A browser reload does not unmount React. Flush the synchronous draft store before leaving.
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [])
  const mono = useMemo(() => monoSum(samples), [samples])

  useEffect(() => () => { playRequest.current += 1; stopLive(); disposePlayback() }, [])
  useEffect(() => {
    if (!loaded || ![loaded.patch, ...(loaded.snapshots ?? []).map((entry) => entry.patch), ...labSources(loaded.labs).map((entry) => entry.patch), ...(loaded.snapshots ?? []).flatMap((entry) => entry.lab?.parents.map((parent) => parent.patch) ?? [])].some((one) => one.layers.some((layer) => layer.source.table.startsWith('user:')))) return
    let cancelled = false
    void restoreAudioAssets(loaded).then((missing) => {
      if (cancelled) return
      setAssetRevision((value) => value + 1)
      if (missing.length) setNotice(`Missing wavetables: ${missing.join(', ')}. Import them again to restore those layers.`)
    })
    return () => { cancelled = true }
  }, [loaded])

  useEffect(() => {
    if (!loaded || !patch || !dirty || recording) return
    // Written on a delay so a drag lands once, not on every frame of itself.
    const timer = setTimeout(() => {
      const result = saveAudioDocument({ ...loaded, name, patch, snapshots, rig, labs, updatedAt: new Date().toISOString() })
      if (result.ok) { pendingSave.current = null; setDirty(false) }
      setNotice(storageMessage(result) ?? '')
    }, 400)
    return () => clearTimeout(timer)
  }, [dirty, loaded, name, patch, rig, snapshots, labs, recording])

  /**
   * Every one of these writes state from the callback rather than from inside another updater.
   *
   * Updaters have to be pure: React invokes them twice under StrictMode to catch exactly this, and
   * a `setPreset` nested in a `setSnapshots` updater ran twice with a fresh uuid each time, so the
   * id that was remembered belonged to a snapshot that was never kept and the menu read Unsaved
   * straight after saving. The same shape was in undo and redo, where it pushed the redo stack
   * twice. `latest` carries the newest patch so a drag — many writes before one render — still has
   * something current to build on without reaching for an updater.
   */
  const commit = useCallback((next: AudioPatch, nextRig?: AudioRig) => {
    const current = latest.current ?? patch
    if (!current) return
    setDirty(true)
    setPast((stack) => [...stack, { patch: current, preset, touched, rig, reference: mutateRef.current ?? current }].slice(-HISTORY_LIMIT))
    setFuture([])
    latest.current = next
    setPatch(next)
    setHeard(next)
    if (nextRig !== undefined) setRig(nextRig)
    if (isLive()) updateLive(next)
  }, [patch, preset, touched, rig])

  const change = useCallback((property: string, value: ParamValue) => {
    const current = latest.current ?? patch
    if (!current) return
    setDirty(true)
    setTouched(true)
    if (!gestureRef.current || !capturedRef.current) {
      capturedRef.current = true
      setPast((stack) => [...stack, { patch: current, preset, touched, rig, reference: mutateRef.current ?? current }].slice(-HISTORY_LIMIT))
      setFuture([])
    }
    const next = setBoardValue(current, property, value)
    latest.current = next
    mutateRef.current = next
    setPatch(next)
    if (!gestureRef.current) setHeard(next)
    if (isLive()) updateLive(next)
  }, [patch, preset, touched, rig])

  /**
   * A performer's row redrawn: one drag is one undo step, as a knob's is.
   *
   * `which` says which of the two grids a performer keeps is being written — the levels or the
   * joinings — because they are drawn one above the other by the same gesture and go back into
   * the patch the same way.
   */
  const redraw = useCallback((which: 'patterns' | 'curves') => (performer: number, scene: number, steps: number[]) => {
    const current = latest.current ?? patch
    if (!current) return
    setDirty(true)
    setTouched(true)
    if (!gestureRef.current || !capturedRef.current) {
      capturedRef.current = true
      setPast((stack) => [...stack, { patch: current, preset, touched, rig, reference: mutateRef.current ?? current }].slice(-HISTORY_LIMIT))
      setFuture([])
    }
    const next: AudioPatch = {
      ...current,
      performers: current.performers.map((entry, at) => (at === performer
        ? { ...entry, [which]: entry[which].map((row, index) => (index === scene ? steps : row)) }
        : entry)),
    }
    latest.current = next
    mutateRef.current = next
    setPatch(next)
    if (!gestureRef.current) setHeard(next)
    if (isLive()) updateLive(next)
  }, [patch, preset, touched, rig])
  /**
   * The other side of the A/B — its sound and its history both — and which side is on screen.
   *
   * A side owns its own past. When only the patch was kept, flipping went through `commit`, which
   * pushes an undo step: one Undo after a flip wrote the sound you had just left onto the side you
   * had just arrived at, and both sides ended up holding the same patch. Flipping is not an edit,
   * and the past you can walk back through is the past of the side you are standing on.
   */
  const [spare, setSpare] = useState<Step & { past: Step[]; future: Step[] } | null>(null)
  const [side, setSide] = useState<'a' | 'b'>('a')
  const paint = useMemo(() => redraw('patterns'), [redraw])
  const joinUp = useMemo(() => redraw('curves'), [redraw])

  const step = useCallback((to: Step) => {
    latest.current = to.patch
    mutateRef.current = to.reference
    setPatch(to.patch)
    setHeard(to.patch)
    setPreset(to.preset)
    setTouched(to.touched)
    setRig(to.rig)
    if (isLive()) updateLive(to.patch)
  }, [])

  const undo = useCallback(() => {
    const previous = past[past.length - 1]
    const current = latest.current ?? patch
    if (!previous || !current) return
    setDirty(true)
    setPast((stack) => stack.slice(0, -1))
    setFuture((ahead) => [{ patch: current, preset, touched, rig, reference: mutateRef.current ?? current }, ...ahead].slice(0, HISTORY_LIMIT))
    step(previous)
  }, [past, patch, preset, touched, rig, step])

  const redo = useCallback(() => {
    const next = future[0]
    const current = latest.current ?? patch
    if (!next || !current) return
    setDirty(true)
    setFuture((ahead) => ahead.slice(1))
    setPast((stack) => [...stack, { patch: current, preset, touched, rig, reference: mutateRef.current ?? current }].slice(-HISTORY_LIMIT))
    step(next)
  }, [future, patch, preset, touched, rig, step])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (view === 'labs' || event.defaultPrevented || !meta || !['z', 'y'].includes(event.key.toLowerCase())) return
      const target = event.target
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      if (event.shiftKey || event.key.toLowerCase() === 'y') redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, view])

  /** The sound you are on, kept aside under whatever it is currently called. */
  const keep = useCallback(() => {
    const current = latest.current ?? patch
    if (!current) return
    const from = PRESETS.find((entry) => entry.id === preset)?.label
    const name = from
      ? `${from} ${snapshots.filter((entry) => entry.name.startsWith(from)).length + 1}`
      : `Sound ${snapshots.length + 1}`
    const snapshot: AudioSnapshot = { id: `snap-${crypto.randomUUID()}`, name, createdAt: new Date().toISOString(), patch: current, rig }
    setDirty(true)
    // The oldest gives way rather than the list growing past the point of being readable.
    setSnapshots((kept) => [...kept, snapshot].slice(-MAX_SNAPSHOTS))
    // You are on the thing you just kept, so the menu should say so.
    setPreset(snapshot.id)
    setTouched(false)
  }, [patch, preset, snapshots, rig])

  /**
   * A kept sound removed, and a way back for as long as the notice is on screen.
   *
   * Snapshots are not in the undo history — the history is patches — so a mis-aimed click on the
   * small trash icon *inside* the row you load a sound from used to be final, four hundred
   * milliseconds later on disk, with Undo still enabled and undoing something else entirely.
   * Removing is still one click, because confirming every delete is worse; it is the going back
   * that was missing.
   */
  const [removed, setRemoved] = useState<{ at: number; entry: AudioSnapshot } | null>(null)
  const forget = useCallback((id: string) => {
    // Read from the list rather than from inside an updater, as everything else here does: an
    // updater has to be pure, and StrictMode runs it twice to make sure of it.
    const at = snapshots.findIndex((entry) => entry.id === id)
    const entry = snapshots[at]
    if (!entry) return
    setDirty(true)
    setSnapshots((kept) => kept.filter((one) => one.id !== id))
    setRemoved({ at, entry })
    setNotice(`Removed ${entry.name}.`)
  }, [snapshots])

  const putBack = useCallback(() => {
    if (!removed) return
    setDirty(true)
    setSnapshots((kept) => [...kept.slice(0, removed.at), removed.entry, ...kept.slice(removed.at)].slice(-MAX_SNAPSHOTS))
    setRemoved(null)
    setNotice('')
  }, [removed])

  /**
   * The same sound kept again under the name it already has. Without it every experiment on a
   * saved sound leaves a copy behind, and a list of near-identical sounds is a list nobody reads.
   */
  const overwrite = useCallback(() => {
    const current = latest.current ?? patch
    if (!current) return
    setDirty(true)
    setTouched(false)
    setSnapshots((kept) => kept.map((entry) => (
      entry.id === preset ? { ...entry, patch: current, createdAt: new Date().toISOString(), rig } : entry
    )))
  }, [patch, preset, rig])

  /*
   * Everything below is held still on purpose.
   *
   * The playhead is state on this component, so the whole page re-renders sixty times a second
   * while a sound is playing. The face-plate is a hundred absolutely positioned controls with an
   * SVG apiece and the rail is ninety-two rows; both are memoised, and a memo only bails out if
   * every prop it is handed is the same object as last time. A callback written inline in the JSX
   * is a new object every frame, and defeats it silently.
   */
  const began = useCallback(() => { gestureRef.current = true; capturedRef.current = false }, [])
  const ended = useCallback(() => {
    gestureRef.current = false
    capturedRef.current = false
    if (latest.current) {
      setHeard(latest.current)
      if (isLive()) updateLive(latest.current)
    }
  }, [])
  const writeRig = useCallback((next: AudioRig) => {
    const current = latest.current ?? patch
    if (!current) return
    setPast((stack) => [...stack, { patch: current, preset, touched, rig, reference: mutateRef.current ?? current }].slice(-HISTORY_LIMIT))
    setFuture([])
    setRig(next)
    setTouched(true)
    setDirty(true)
  }, [patch, preset, touched, rig])
  const writeMacrosTogether = useCallback((nextRig: AudioRig, nextPatch: AudioPatch, macroIndex?: number) => {
    const current = latest.current ?? patch
    if (!current) return
    setDirty(true)
    setTouched(true)
    if (!takeRef.current && (!gestureRef.current || !capturedRef.current)) {
      capturedRef.current = true
      setPast((stack) => [...stack, { patch: current, preset, touched, rig, reference: mutateRef.current ?? current }].slice(-HISTORY_LIMIT))
      setFuture([])
    }
    latest.current = nextPatch
    mutateRef.current = nextPatch
    setPatch(nextPatch)
    setRig(nextRig)
    if (!gestureRef.current) setHeard(nextPatch)
    if (isLive()) updateLive(nextPatch)
    const take = takeRef.current
    if (take && macroIndex !== undefined) {
      const slots = macrosOf(nextRig, nextPatch)
      if (take.macro < 0) {
        take.macro = macroIndex
        take.started = performance.now()
        const request = ++playRequest.current
        void startLive(nextPatch, 'oneshot').then((ok) => {
          if (request !== playRequest.current) return
          setLiveOn(ok)
        })
        const initialSlot = macrosOf(take.before.rig, take.before.patch)[macroIndex]
        const initial = initialSlot ? macroAmount(initialSlot) : 0
        take.times.push(0)
        take.values.push(initial)
        setNotice(`Recording ${slots[macroIndex]?.label || `macro ${macroIndex + 1}`}. Escape cancels.`)
      }
      if (take.macro === macroIndex && take.times.length < 8192) {
        take.times.push(Math.min(current.duration, (performance.now() - take.started) / 1000))
        take.values.push(slots[macroIndex] ? macroAmount(slots[macroIndex]!) : 0)
      }
    }
  }, [patch, preset, touched, rig])
  const seed = patch?.seed ?? 0
  const wantBuffer = useRef(false)
  const cutVoice = useCallback(() => {
    playRequest.current += 1
    stopLive()
    setLiveOn(false)
    transport.stop()
  }, [transport])
  const hearNow = useCallback((next: AudioPatch) => {
    cutVoice()
    if (hearing === 'hold') setHearing('oneshot')
    autoHeard.current = next
    const gate: VoiceGate = hearing === 'repeat' ? 'repeat' : 'oneshot'
    if (!audioContext()?.audioWorklet) {
      wantBuffer.current = true
      if (latest.current === next) transport.play()
      return
    }
    const request = playRequest.current
    void startLive(next, gate).then((ok) => {
      if (request !== playRequest.current) return
      setLiveOn(ok)
      if (ok) transport.stop()
      else wantBuffer.current = true
    })
  }, [cutVoice, hearing, transport])
  const load = useCallback((next: AudioPatch, id: string) => {
    if (id === preset && !touched) {
      hearNow(latest.current ?? next)
      return
    }
    const bundled = PRESETS.find((entry) => entry.id === id)
    const snap = snapshots.find((entry) => entry.id === id)
    const applied = snap || bundled?.group === 'Labs' ? next : { ...next, seed }
    setPreset(id)
    setTouched(false)
    setRig(bundled?.rig?.(applied) ?? snap?.rig)
    mutateRef.current = applied
    hearNow(applied)
    commit(applied)
  }, [commit, seed, snapshots, preset, touched, hearNow])

  const hearingGate = (mode: HearingMode): VoiceGate => (mode === 'hold' ? 'hold' : mode === 'repeat' ? 'repeat' : 'oneshot')

  const stopSound = useCallback(() => {
    playRequest.current += 1
    const take = takeRef.current
    if (take) { step(take.before); setPast(take.past); setFuture(take.future) }
    if (hearing === 'hold') {
      if (isLive()) gateLive('release')
      else {
        stopLive()
        setLiveOn(false)
        transport.stop()
      }
      setHearing('oneshot')
      setRecording(false)
      takeRef.current = null
      return
    }
    stopLive()
    setLiveOn(false)
    setHearing('oneshot')
    transport.stop()
    setRecording(false)
    takeRef.current = null
  }, [hearing, transport, step])

  const playSound = useCallback(async () => {
    const current = latest.current ?? patch
    if (!current) return
    const gate = hearingGate(hearing)
    if (isLive()) {
      triggerLive(gate)
      return
    }
    const request = ++playRequest.current
    const ok = await startLive(current, gate)
    if (request !== playRequest.current) return
    setLiveOn(ok)
    if (ok) transport.stop()
    else { setHearing('oneshot'); setNotice('Real-time playback is unavailable. Playing the rendered one-shot.'); transport.play() }
  }, [patch, hearing, transport])

  useEffect(() => {
    if (autoHeard.current === heard) return
    autoHeard.current = heard
    if (!recording) void playSound()
  }, [heard, recording, playSound])

  useEffect(() => {
    if (!wantBuffer.current) return
    wantBuffer.current = false
    if (!isLive()) transport.play()
  }, [samples, transport])

  const hearingTransport = useMemo(() => ({
    ...transport,
    playing: transport.playing || liveOn,
    play: () => { void playSound() },
    stop: stopSound,
  }), [transport, liveOn, playSound, stopSound])

  useEffect(() => {
    watchLiveMeter((meter) => { setLiveMeter({ peak: meter.peak, left: meter.left ?? meter.peak, right: meter.right ?? meter.peak }); if (meter.ended) setLiveOn(false) })
    return () => watchLiveMeter(null)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (tableImport) { event.preventDefault(); setTableImport(null); return }
      if (mobilePanel === 'nav') {
        event.preventDefault()
        setMobilePanel('main')
        document.querySelector<HTMLButtonElement>('.mobile-dock button')?.focus()
        return
      }
      if (recording) {
        event.preventDefault()
        playRequest.current += 1
        const take = takeRef.current
        setRecording(false)
        takeRef.current = null
        if (take) { step(take.before); setPast(take.past); setFuture(take.future) }
        stopLive(); setLiveOn(false)
        setNotice('Recording cancelled.')
        return
      }
      if (hearing !== 'oneshot' || liveOn) {
        event.preventDefault()
        stopSound()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recording, hearing, liveOn, stopSound, step, tableImport, mobilePanel])

  const changeHearing = useCallback((next: HearingMode) => {
    setHearing(next)
    if (isLive()) {
      if (next === 'oneshot' && hearing === 'hold') gateLive('release')
      else gateLive(hearingGate(next))
    }
  }, [hearing])

  const toggleRecord = useCallback(() => {
    const current = latest.current ?? patch
    if (!current) return
    if (recording) {
      const take = takeRef.current
      setRecording(false)
      takeRef.current = null
      if (!take || take.times.length < 2) {
        if (take) { step(take.before); setPast(take.past); setFuture(take.future) }
        stopLive(); setLiveOn(false)
        setNotice('Nothing was recorded.')
        return
      }
      const duration = Math.max(0.05, Math.min(current.duration, (performance.now() - take.started) / 1000))
      take.times.push(duration)
      take.values.push(take.values[take.values.length - 1] ?? 0)
      const points = takeFromSamples(take.times, take.values, 0, duration)
      const slot = macrosOf(rig, current)[take.macro]
      if (!slot || slot.destinations.length === 0) return
      const gesture = {
        id: `gesture-${crypto.randomUUID()}`, macro: take.macro, enabled: true, start: 0,
        duration, points, destinations: slot.destinations,
      }
      setPast([...take.past, take.before].slice(-HISTORY_LIMIT))
      setFuture([])
      step({ ...take.before, touched: true, patch: { ...take.before.patch, gestures: [...(take.before.patch.gestures ?? []), gesture] } })
      setDirty(true)
      stopLive(); setLiveOn(false)
      setNotice(`Kept a take of ${slot.label || `macro ${take.macro + 1}`}.`)

      return
    }
    if ((current.gestures?.length ?? 0) >= MAX_GESTURES) {
      setNotice('This patch already has 16 gestures. Remove a take before recording another.')
      return
    }
    setHearing('oneshot')
    setRecording(true)
    takeRef.current = { times: [], values: [], started: performance.now(), macro: -1, before: { patch: current, preset, touched, rig, reference: mutateRef.current ?? current }, past, future }
    stopLive()
    const request = ++playRequest.current
    void startLive(current, 'oneshot').then((ok) => {
      if (request !== playRequest.current) return
      setLiveOn(ok)
      if (ok) { transport.stop(); if (takeRef.current) takeRef.current.started = performance.now() }
      else { setRecording(false); takeRef.current = null; setNotice('Recording needs real-time audio, which is unavailable in this browser.') }
    })
    setNotice('Move the macro you want to record. Escape cancels.')
  }, [recording, patch, rig, preset, touched, past, future, step, transport])

  const importTable = useCallback(async (layer: number) => {
    const picker = window.document.createElement('input')
    picker.type = 'file'
    picker.accept = 'audio/wav,audio/wave,.wav'
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0]
      if (!file) return
      if (file.size > MAX_IMPORT_BYTES) { setNotice('That wavetable is larger than 8 MB.'); return }
      try {
      const buffer = await file.arrayBuffer()
      const wav = decodeWav(buffer)
      if ('error' in wav) { setNotice(wav.error); return }
      const preview = inspectWavetable(wav)
      if ('error' in preview) { setNotice(preview.error); return }
      if (preview.ambiguous) {
        setTableImport({ file, layer, preview, size: preview.candidates.includes(1024) ? 1024 : preview.frameSize })
        return
      }
      const result = await importWavetableFile(file, preview.frameSize)
      if ('error' in result) { setNotice(result.error); return }
      change(`layers[${layer}].source.table`, result.tableName)
      setNotice(`Imported ${result.name}.`)
      } catch { setNotice('That wavetable could not be read or stored.') }
    })
    picker.click()
  }, [change])

  const exportProject = useCallback(async () => {
    if (!loaded || !patch) return
    try {
    await restoreAudioAssets({ ...loaded, patch, snapshots, labs })
    const blob = new Blob([serializeAudioProject({ ...loaded, name, patch, snapshots, rig, labs })], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sound'}.paramrig.audio.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The project could not be exported.') }
  }, [loaded, name, patch, snapshots, rig, labs])
  /*
   * The research bench. Its state is part of the document and its controls live in two columns of
   * the shell — the palette on the left, the bench in the middle — so the hook sits here, where
   * both can reach it, rather than inside either.
   */
  const lab = useLabs({
    session: labs,
    onChange: (next) => { setLabs(next); setDirty(true) },
    instrument: patch, rig, name, rate,
    active: view === 'labs',
    onBeforePlay: cutVoice,
    onShowPalette: () => {
      updatePrefs({ navCompact: false, navCollapsed: false })
      if (windowWidth < 1024) setMobilePanel('nav')
    },
    onOpen: (sound: LabSound) => {
      cutVoice()
      const next = structuredClone(sound.patch)
      commit(next, sound.rig)
      mutateRef.current = next
      setPreset(''); setTouched(true); setView('instrument')
    },
    onSave: (sound: LabSound) => {
      if (snapshots.some((snapshot) => snapshot.name === sound.name && fingerprint(snapshot.patch) === sound.fingerprint && JSON.stringify(snapshot.rig) === JSON.stringify(sound.rig))) return 'This sound is already saved.'
      if (snapshots.length >= MAX_SNAPSHOTS) return 'Saved sounds are full. Remove a saved sound in Sounds before adding another.'
      setSnapshots([...snapshots, { id: `snap-${crypto.randomUUID()}`, name: sound.name, createdAt: new Date().toISOString(), patch: structuredClone(sound.patch), rig: structuredClone(sound.rig), lab: structuredClone(sound) }])
      setDirty(true)
      return null
    },
  })
  const patterns = useMemo(() => patch?.performers.map((performer) => performer.patterns) ?? [], [patch])
  const curves = useMemo(() => patch?.performers.map((performer) => performer.curves) ?? [], [patch])
  const shownPatch = heard ?? patch
  const profiles = useMemo(() => (shownPatch ? layerProfiles(shownPatch) : []), [shownPatch])
  const wave = useMemo(
    () => ({ samples: mono, head: liveOn ? null : transport.head, profiles, label: name ?? '' }),
    [mono, transport.head, profiles, name, liveOn],
  )

  if (!loaded || !patch) {
    return (
      <WorkspaceShell rigs={listRigs()} hideInspector>
        <div className="preview-stage preview-stage--audio" id="main" tabIndex={-1}>
          <StatusMessage>That patch is not in this browser. Open its project file to bring it back.</StatusMessage>
          <Button onClick={() => navigate('/')}>Back to library</Button>
        </div>
      </WorkspaceShell>
    )
  }

  const exposed = rig?.parameters.length ?? 0

  return (
    <WorkspaceShell
      rigs={listRigs()}
      activeId={documentId}
      hideInspector
      mobilePanel={mobilePanel}
      onMobilePanel={(next) => setMobilePanel((current) => next === current ? 'main' : next)}
      mainLabel="Sound"
      navLabel={view === 'labs' ? 'Palette' : 'Sounds'}
      minNavWidth={view === 'labs' ? Math.round(Math.min(328, Math.max(272, windowWidth * 0.196))) : undefined}
      renderNavigation={({ compact, inert, onNavigate }) => view === 'labs' ? (
        <LabsPalette lab={lab} compact={compact} inert={inert} onNavigate={onNavigate} snapshots={snapshots} instrumentName={name} />
      ) : (
        <AudioSoundList
          current={preset}
          snapshots={snapshots}
          compact={compact}
          inert={inert}
          onNavigate={onNavigate}
          onPatch={load}
          wave={wave}
          deck={
            <AudioLibraryDeck
              compact={compact}
              transport={hearingTransport}
              live={liveOn}
              hearing={hearing}
              onHearing={changeHearing}
              recording={recording}
              onRecord={toggleRecord}
              patch={shownPatch ?? undefined}
              name={name}
              current={preset}
              snapshots={snapshots}
              touched={touched}
              gestures={patch.gestures ?? []}
              gestureLabels={macrosOf(rig, patch).map((macro) => macro.label)}
              onToggleGesture={(id) => {
                commit({ ...patch, gestures: patch.gestures?.map((entry) => entry.id === id ? { ...entry, enabled: !entry.enabled } : entry) })
                setTouched(true)
              }}
              onRemoveGesture={(id) => {
                commit({ ...patch, gestures: patch.gestures?.filter((entry) => entry.id !== id) })
                setTouched(true)
              }}
              onSnapshot={keep}
              onOverwrite={overwrite}
              shuffle={shuffle}
              generating={generating}
              onShuffle={(next) => {
                if (next.keepReference && !shuffle.keepReference) {
                  mutateRef.current = latest.current ?? patch
                }
                setShuffle(next)
                writeShufflePrefs(next)
              }}
              onRandom={() => {
                if (generatingRef.current) return
                generatingRef.current = true
                setGenerating(true)
                const token = ++genToken.current
                const family = shuffle.family
                window.setTimeout(() => {
                  try {
                    if (token !== genToken.current) return
                    const next = randomPatch(Math.floor(Math.random() * 100000), rate, { family })
                    if (token !== genToken.current) return
                    const current = latest.current ?? patch
                    const table = rig ? syncMacrosToPatch(macrosOf(rig, current), next) : undefined
                    const nextRig = table ? writeMacros(rig, table, next) : rig
                    mutateRef.current = next
                    setPreset('')
                    setTouched(false)
                    hearNow(next)
                    commit(next, nextRig)
                  } finally {
                    if (token === genToken.current) {
                      generatingRef.current = false
                      setGenerating(false)
                    }
                  }
                }, 0)
              }}
              onMutate={() => {
                const current = latest.current ?? patch
                if (!current || generatingRef.current) return
                generatingRef.current = true
                setGenerating(true)
                const token = ++genToken.current
                const source = shuffle.keepReference ? (mutateRef.current ?? current) : current
                const amount = shuffle.amount
                const target = shuffle.target
                const currentRig = rig
                window.setTimeout(() => {
                  try {
                    if (token !== genToken.current) return
                    const macros = currentRig ? macrosOf(currentRig, source) : undefined
                    const result = mutateSound(source, Math.floor(Math.random() * 100000), { amount, target, macros }, rate)
                    if (token !== genToken.current) return
                    const table = result.macros
                      ? syncMacrosToPatch(result.macros, result.patch)
                      : (currentRig ? syncMacrosToPatch(macrosOf(currentRig, source), result.patch) : undefined)
                    const nextRig = table ? writeMacros(currentRig, table, result.patch) : currentRig
                    setTouched(true)
                    if (!shuffle.keepReference) mutateRef.current = result.patch
                    hearNow(result.patch)
                    commit(result.patch, nextRig)
                  } finally {
                    if (token === genToken.current) {
                      generatingRef.current = false
                      setGenerating(false)
                    }
                  }
                }, 0)
              }}
            />
          }
        />
      )}
    >
      <h1 className="visually-hidden">{loaded.name}</h1>
      {/*
        One row, as the reference keeps its top bar. The name, the transport with the sound menu
        as its tools, the two views, the history, and Tune — where there had been a toolbar, a
        transport with the waveform in it, and a tab strip, stacked, at a hundred and eighty pixels
        that the face-plate below needed more than they did.
      */}
      <div className="audio-bar">
        <input
          className="audio-name"
          aria-label="Patch name"
          value={name}
          onChange={(event) => { setDirty(true); setName(event.target.value.slice(0, 120)) }}
        />
        {view !== 'labs' ? <AudioTransport
          compact
          play={false}
          transport={hearingTransport}
          samples={samples}
          sampleRate={rate}
          name={name}
          live={liveOn}
          livePeak={liveMeter.peak}
          liveLeft={liveMeter.left}
          liveRight={liveMeter.right}
          tools={
            <>
            {/*
              * A and B: the same page, two sounds, one keystroke apart.
              *
              * Judging a change to a two-hundred-millisecond sound by memory does not work — by the
              * time the second one has played, the first is a feeling rather than a sound. B starts
              * as a copy of A, so the first thing anybody does with it is change one number and
              * flip back and forth.
              */}
            <div className="audio-ab" role="group" aria-label="A and B">
              {(['a', 'b'] as const).map((which) => (
                <Tooltip key={which} content={which === side ? `${which.toUpperCase()} is the sound you are on` : `Switch to ${which.toUpperCase()}`}>
                  <button
                    type="button"
                    className="btn btn--quiet btn--sm audio-ab__side"
                    aria-pressed={which === side}
                    onClick={() => {
                      const current = latest.current ?? patch
                      if (which === side || !current) return
                      const mine = { patch: current, past, future, rig, preset, touched, reference: mutateRef.current ?? current }
                      const other = spare ?? mine
                      setSpare(mine)
                      setPast(other.past)
                      setFuture(other.future)
                      setSide(which)
                      setTouched(other.touched)
                      setPreset(other.preset)
                      setDirty(true)
                      latest.current = other.patch
                      mutateRef.current = other.reference
                      setPatch(other.patch)
                      setHeard(other.patch)
                      setRig(other.rig)
                      if (isLive()) updateLive(other.patch)
                    }}
                  >
                    {which.toUpperCase()}
                  </button>
                </Tooltip>
              ))}
              <Tooltip content={`Copy ${side.toUpperCase()} onto the other side`}>
                <button
                  type="button"
                  className="btn btn--quiet btn--sm"
                  // The other side becomes this sound, and starts its own history there: the steps
                  // it had led to a sound it no longer holds.
                  onClick={() => { const current = latest.current ?? patch; if (current) setSpare({ patch: current, past: [], future: [], rig, preset, touched, reference: mutateRef.current ?? current }) }}
                >
                  Copy
                </button>
              </Tooltip>
            </div>
            <AudioSoundBar
              current={preset}
              snapshots={snapshots}
              touched={touched}
              onPatch={load}
              onRemove={forget}
            />
            </>
          }
        /> : null}
        <div className="audio-views" role="tablist" aria-label="Views">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`audio-view-${entry.id}`}
              aria-selected={view === entry.id}
              aria-controls="audio-view-panel"
              tabIndex={view === entry.id ? 0 : -1}
              onClick={() => { if (entry.id === 'labs') { cutVoice(); if (recording) toggleRecord() } setView(entry.id) }}
              onKeyDown={(event) => {
                const at = VIEWS.findIndex((item) => item.id === view)
                const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
                if (!step) return
                event.preventDefault()
                const next = VIEWS[(at + step + VIEWS.length) % VIEWS.length]!
                if (next.id === 'labs') { cutVoice(); if (recording) toggleRecord() }
                setView(next.id)
                queueMicrotask(() => window.document.getElementById(`audio-view-${next.id}`)?.focus())
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {view !== 'labs' ? <div className="audio-bar__history">
          <Tooltip content={past.length ? 'Undo (⌘Z / Ctrl+Z)' : 'Nothing to undo'}>
            <IconButton label="Undo" onClick={undo} disabled={past.length === 0}><IconUndo /></IconButton>
          </Tooltip>
          <Tooltip content={future.length ? 'Redo (⌘⇧Z / Ctrl+Shift+Z)' : 'Nothing to redo'}>
            <IconButton label="Redo" onClick={redo} disabled={future.length === 0}><IconRedo /></IconButton>
          </Tooltip>
        </div> : <div className="audio-bar__history">
          <Tooltip content={lab.canUndo ? 'Undo Labs change (⌘Z / Ctrl+Z)' : 'Nothing to undo in Labs'}>
            <IconButton label="Undo Labs change" onClick={lab.undo} disabled={!lab.canUndo}><IconUndo /></IconButton>
          </Tooltip>
          <Tooltip content={lab.canRedo ? 'Redo Labs change (⌘⇧Z / Ctrl+Shift+Z)' : 'Nothing to redo in Labs'}>
            <IconButton label="Redo Labs change" onClick={lab.redo} disabled={!lab.canRedo}><IconRedo /></IconButton>
          </Tooltip>
        </div>}
        <Tooltip content="Save this patch, its macros and its wavetables as a project file">
          <IconButton label="Export project" onClick={exportProject}><IconExport /></IconButton>
        </Tooltip>
        {exposed > 0 && view !== 'labs' ? (
          <Tooltip content={mode === 'tune' ? 'Back to the instrument' : 'Tune the exposed controls'}>
            <IconButton label="Tune" aria-pressed={mode === 'tune'} onClick={() => onMode(mode === 'edit' ? 'tune' : 'edit')}>
              <IconSliders />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
      {/* Always in the tree so a screen reader keeps the live region, but no height until it has
          something to say. A permanent band reporting that nothing is wrong is a band of nothing. */}
      <p className="editor-notice" role="status" aria-label="Editor notice" data-empty={notice.length === 0}>
        {notice}
        {removed ? <Button size="sm" variant="quiet" onClick={putBack}>Undo</Button> : null}
      </p>
      {tableImport ? (
        <div className="audio-import" role="region" aria-label="Wavetable import">
          <span>{tableImport.file.name} · {tableImport.preview.channels} ch · {tableImport.preview.sampleRate} Hz</span>
          <SelectField label="Frame size" value={String(tableImport.size)} presentation="menu"
            options={tableImport.preview.candidates.map((size) => ({ value: String(size), label: `${size} samples · ${tableImport.preview.samples / size} frames` }))}
            onChange={(size) => setTableImport({ ...tableImport, size: Number(size) })} />
          <Button size="sm" onClick={async () => {
            const chosen = tableImport
            setTableImport(null)
            let result
            try { result = await importWavetableFile(chosen.file, chosen.size) } catch { setNotice('That wavetable could not be read or stored.'); return }
            if ('error' in result) { setNotice(result.error); return }
            change(`layers[${chosen.layer}].source.table`, result.tableName)
            setNotice(`Imported ${result.name}.`)
          }}>Import</Button>
          <Button size="sm" variant="quiet" onClick={() => setTableImport(null)}>Cancel</Button>
        </div>
      ) : null}
      <div className="audio-body" id="main" tabIndex={-1}>
        <div className="audio-view" id="audio-view-panel" role="tabpanel" aria-labelledby={`audio-view-${view}`}>
          {view === 'labs' ? (
            <Suspense fallback={<p className="status-msg" role="status">Opening Sound Labs</p>}><AudioLabs lab={lab} /></Suspense>
          ) : view === 'sounds' ? (
            <AudioPresetsView
              current={preset}
              snapshots={snapshots}
              onPatch={load}
              onRemove={forget}
            />
          ) : (
            <div className="audio-instrument">
              <AudioFacePlate
                parameters={parameters}
                values={values}
                duration={patch.duration}
                patch={patch}
                onChange={change}
                onGestureStart={began}
                onGestureEnd={ended}
                rig={rig}
                onRig={writeRig}
                onMacros={writeMacrosTogether}
                onImportTable={importTable}
                patterns={patterns}
                onPattern={paint}
                curves={curves}
                onCurves={joinUp}
              />
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  )
}
