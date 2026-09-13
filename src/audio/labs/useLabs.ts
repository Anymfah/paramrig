import type { LabThumbnail } from './thumbnail'
import { useCallback, useEffect, useRef, useState } from 'react'
import { audioContext, stopPlayback } from '../playback'
import { macroAmount } from '../macros'
import type { AudioPatch } from '@paramrig/audio'
import type { AudioRig } from '@paramrig/audio/bindings'
import { adjustReference, makeLabSound } from './design'
import { fusionCompatibility, type LabRender } from './generate'
import { LabPreviewCache, LabRunner } from './runner'
import { labDemo } from './demos'
import { currentSound, fingerprint, MAX_HISTORY, MAX_REFERENCES, MAX_RESERVE, type LabCriteria, type LabMode, type LabRequest, type LabSession, type LabSound } from './model'
import { playLabVoice, stopLabVoice, type LabVoice } from './labVoice'
import { clampSculpt, sculptSound, sculptValue, sculptValues, type SculptKind, type SculptValues } from './sculpt'
import { labCriteriaKey } from './selections'
import { validateLabCriteria } from './criteria'
import { discoveryCriteria, updatePaletteCriteria, type PaletteView } from './palette'

/** What is playing: while a gesture holds the voice in a loop, `period` is one pass with its gap. */
export type LabPlaying = { id: string; fingerprint: string; startedAt: number; duration: number; period?: number; looping?: boolean }
/** Where the voice is in its sound, 0 to 1, or -1 between passes and after the end. */
export function headOf(playing: LabPlaying, now: number): number {
  let at = now - playing.startedAt
  if (playing.looping && playing.period) at %= playing.period
  const head = at / Math.max(0.001, playing.duration)
  return head >= 0 && head <= 1 ? head : -1
}
export type LabMessage = { text: string; undo?: boolean }
export type LabsHandle = ReturnType<typeof useLabs>

const HISTORY_DEPTH = 30
/** Why the next sound cannot be made yet, in the words the button shows; null when it can. */
export function blockerOf(session: LabSession): string | null {
  if (session.mode === 'vary') {
    if (!session.reference) return 'Bring a sound to the bench and use it as the reference first.'
    if (!session.reference.controls.length && !session.varyDuration) return 'This sound has no compatible timbre controls. Let the duration vary, or choose another reference.'
    const free = session.reference.controls.some((_, i) => !session.locks[i])
    if (!free && !session.varyDuration) return 'Every control is locked. Unlock one, or let the duration vary.'
    return null
  }
  if (session.mode === 'fuse') {
    const a = session.reserve.find((s) => s.id === session.principal), b = session.reserve.find((s) => s.id === session.contributor)
    if (session.reserve.length < 2) return 'Keep two sounds in the reserve to fuse them.'
    if (!a || !b) return 'Choose a principal and a contributor from the reserve.'
    return fusionCompatibility(a, b, session.contribution)
  }
  try { validateLabCriteria(discoveryCriteria(session.criteria)) }
  catch (error) { return error instanceof Error ? error.message : 'Review the search selections.' }
  return null
}
const valuesOf = (sound: LabSound) => sound.controls.map((index) => macroAmount(sound.macros[index]!))
const parentOf = (sound: LabSound) => ({ id: sound.id, name: sound.name, patch: structuredClone(sound.patch), rig: structuredClone(sound.rig), roles: [...sound.roles] })

/**
 * The bench's state and everything that acts on it, in one place, so the palette in the left
 * column and the workbench in the middle move the same session and share one undo history, one
 * player and one pair of workers.
 *
 * There is exactly one voice. Playing anything stops whatever was playing; generating while a
 * render is in flight replaces the request rather than queueing behind it. The sound on the bench
 * stays where it is until the next one has actually arrived, so changing a criterion never leaves
 * the room silent.
 */
export function useLabs({ session, onChange, instrument, rig, name, rate, onOpen, onSave, onBeforePlay, active, onShowPalette }: {
  session: LabSession
  onChange: (next: LabSession) => void
  instrument: AudioPatch | null
  rig?: AudioRig
  name: string
  rate: number
  onOpen: (sound: LabSound) => void
  onSave: (sound: LabSound) => string | null
  onBeforePlay: () => void
  /** Whether Labs is the view on screen: shortcuts and the voice belong to it only then. */
  active: boolean
  onShowPalette?: () => void
}) {
  const current = useRef(session)
  current.current = session
  const past = useRef<LabSession[]>([])
  const future = useRef<LabSession[]>([])
  const generator = useRef(new LabRunner())
  const audition = useRef(new LabRunner())
  const cache = useRef(new LabPreviewCache())
  const waiters = useRef(new Map<string, (render: LabRender) => void>())
  /** Sounds the worker could not render: asked for again only on purpose, never by the bench alone. */
  const failed = useRef(new Set<string>())
  const [renderVersion, setRenderVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState<LabPlaying | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<LabMessage | null>(null)
  const [paletteView, setPaletteView] = useState<PaletteView>('source')
  const [paletteRevision, setPaletteRevision] = useState(0)
  const playToken = useRef(0)
  const generateToken = useRef(0)
  const gesture = useRef(false)
  const hearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const voice = useRef<{ voice: LabVoice; fingerprint: string } | null>(null)
  /** The gesture in progress on the Shape view, from its first touch to its release. */
  const shaping = useRef<{ kind: SculptKind; sound: LabSound; from: SculptValues; value: number; voice: LabVoice | null; future: LabSession[] } | null>(null)
  const shapeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [sculpting, setSculpting] = useState<SculptKind | null>(null)
  /** Counts the gestures that ended without a new sound: taken back, or let go where they began. */
  const [sculptResets, setSculptResets] = useState(0)
  const latest = useRef({ onChange, onOpen, onSave, onBeforePlay, instrument, rig, name, rate, playing, loading })
  latest.current = { onChange, onOpen, onSave, onBeforePlay, instrument, rig, name, rate, playing, loading }

  const remember = useCallback(() => {
    past.current = [...past.current, structuredClone(current.current)].slice(-HISTORY_DEPTH)
    future.current = []
  }, [])
  const write = useCallback((next: LabSession, record = true) => {
    if (record) remember()
    current.current = next
    latest.current.onChange(next)
  }, [remember])
  const edit = useCallback((update: Partial<LabSession>, record = true) => write({ ...current.current, ...update }, record), [write])

  const storePreview = useCallback((key: string, bins: number[], detail?: LabThumbnail) => {
    const state = current.current
    const missing = (entry: LabSound) => entry.fingerprint === key && (entry.preview?.fingerprint !== key || (!!detail && !entry.preview.detail))
    if (bins.length && [...state.history, ...state.reserve].some(missing)) {
      const fill = (entry: LabSound) => (missing(entry) ? { ...entry, preview: { fingerprint: key, bins: [...bins], ...(detail ? { detail: structuredClone(detail) } : {}) } } : entry)
      write({ ...state, history: state.history.map(fill), reserve: state.reserve.map(fill) }, false)
    }
  }, [write])
  const storeRender = useCallback((render: LabRender) => {
    cache.current.put(render)
    failed.current.delete(render.sound.fingerprint)
    setRenderVersion((value) => value + 1)
    // A preview is presentation metadata; it never edits the saved patch or undo history.
    storePreview(render.sound.fingerprint, render.preview, render.thumbnail)
    const waiting = waiters.current.get(render.sound.fingerprint)
    waiters.current.delete(render.sound.fingerprint)
    waiting?.(render)
  }, [storePreview])

  const stop = useCallback(() => {
    playToken.current++
    clearTimeout(hearTimer.current)
    stopLabVoice()
    stopPlayback()
    voice.current = null
    setPlaying(null)
  }, [])

  /** Renders a sound in the background so the bench can draw it; nothing is heard. */
  /**
   * Renders a sound in the background so the bench can draw it; nothing is heard.
   *
   * While a hand moves a control the sound changes many times a second. Rather than cancel the
   * render under way — which throws away the work and starts a whole worker again — the newest
   * sound waits its turn, and the one after it takes its place. The relief therefore follows the
   * hand as fast as the DSP can answer, which is a few hundredths of a second for a short sound.
   */
  const queued = useRef<LabSound | null>(null)
  const startRender = useCallback((sound: LabSound) => {
    setLoading(sound.fingerprint)
    audition.current.run({ kind: 'preview', sound, rate: latest.current.rate }, storeRender, (issue) => {
      setLoading((held) => (held === sound.fingerprint ? null : held))
      if (issue) { failed.current.add(sound.fingerprint); setMessage({ text: issue }) }
      const next = queued.current
      queued.current = null
      if (next && !cache.current.has(next.fingerprint) && !failed.current.has(next.fingerprint)) startRender(next)
    })
  }, [storeRender])
  const prepare = useCallback((sound: LabSound, chase = false) => {
    if (cache.current.has(sound.fingerprint) || latest.current.loading === sound.fingerprint || failed.current.has(sound.fingerprint)) return
    if (chase && audition.current.running) { queued.current = sound; setLoading(sound.fingerprint); return }
    startRender(sound)
  }, [startRender])

  const play = useCallback((sound: LabSound) => {
    stop()
    latest.current.onBeforePlay()
    const token = ++playToken.current
    const context = audioContext()
    if (!context) { setMessage({ text: 'Audio playback is unavailable in this browser.' }); return }
    void context.resume().catch(() => setMessage({ text: 'Allow audio playback in your browser and try again.' }))
    const start = (render: LabRender) => {
      if (token !== playToken.current) return
      setLoading(null)
      // The sound at its own level: the height pulled on the Shape view is the level heard,
      // and the level exported. No monitor compensation stands in between.
      const held = playLabVoice(render.samples, latest.current.rate, { onEnded: () => { if (token === playToken.current) { voice.current = null; setPlaying(null) } } })
      if (held) {
        voice.current = { voice: held, fingerprint: sound.fingerprint }
        setPlaying({ id: sound.id, fingerprint: sound.fingerprint, startedAt: held.startedAt, duration: held.duration, period: held.period })
      } else setMessage({ text: 'Audio playback could not start. Try again.' })
    }
    const stored = cache.current.get(sound.fingerprint)
    if (stored) { start(stored); return }
    waiters.current.set(sound.fingerprint, start)
    if (latest.current.loading === sound.fingerprint) return
    setLoading(sound.fingerprint)
    audition.current.run({ kind: 'preview', sound, rate: latest.current.rate }, storeRender, (issue) => {
      waiters.current.delete(sound.fingerprint)
      setLoading((held) => (held === sound.fingerprint ? null : held))
      if (issue) { failed.current.add(sound.fingerprint); if (token === playToken.current) setMessage({ text: issue }) }
    })
  }, [stop, storeRender])

  const toggle = useCallback((sound: LabSound) => {
    if (latest.current.playing?.fingerprint === sound.fingerprint || latest.current.loading === sound.fingerprint) stop()
    else play(sound)
  }, [play, stop])

  const undo = useCallback((redo = false) => {
    const from = redo ? future : past, to = redo ? past : future
    const next = from.current.at(-1)
    if (!next) return
    from.current = from.current.slice(0, -1)
    to.current = [...to.current, current.current].slice(-HISTORY_DEPTH)
    write(next, false)
    setMessage(null)
  }, [write])

  /**
   * The palette and the next-sound controls. A family that does not offer the chosen gesture
   * takes Auto instead. `record` is false while a dial is being turned: the turn began with one
   * undo step, and every position it passes through is not another.
   */
  const setCriteria = useCallback((update: Partial<LabCriteria>, record = true) => {
    const { criteria, adjustments } = updatePaletteCriteria(current.current.criteria, update)
    setMessage(adjustments.length ? { text: adjustments.join(' '), undo: true } : null)
    edit({ criteria }, record)
  }, [edit])
  /** Marks the start of a continuous edit, so the whole of it is one undo step. */
  const beginEdit = useCallback(() => remember(), [remember])

  /** Puts a sound on the bench and into the history, and plays it. */
  const bench = useCallback((sound: LabSound, hear = true) => {
    const state = current.current
    const known = state.history.some((entry) => entry.id === sound.id)
    write({ ...state, history: known ? state.history : [...state.history, sound].slice(-MAX_HISTORY), current: sound.id })
    setMessage(null)
    if (hear) play(sound)
  }, [play, write])

  /** Brings a sound that is already in the history, the reserve or the reference onto the bench. */
  const select = useCallback((sound: LabSound, hear = true) => {
    if (current.current.current !== sound.id) edit({ current: sound.id }, false)
    if (hear) play(sound)
  }, [edit, play])

  const adoptReference = useCallback((sound: LabSound) => {
    const state = current.current
    const held = structuredClone(sound)
    const duration = Math.round(sound.patch.duration * 1000)
    const previous = state.reference && state.reference.id !== sound.id ? state.reference : null
    write({
      ...state, reference: held, mode: 'vary', locks: [false, false, false, false],
      criteria: { ...state.criteria, avoid: [...sound.criteria.avoid], minMs: Math.min(state.criteria.minMs, duration), maxMs: Math.max(state.criteria.maxMs, duration) },
      references: previous ? [...state.references.filter((entry) => entry.id !== previous.id), previous].slice(-MAX_REFERENCES) : state.references,
      current: state.current ?? held.id,
    })
    setMessage({ text: `${sound.name} is the reference. Variations start from it.` })
  }, [write])

  const setMode = useCallback((mode: LabMode) => {
    const state = current.current
    if (mode === state.mode) return
    const sound = currentSound(state)
    // Variations of nothing is a dead end: the sound on the bench is what somebody wants to vary.
    if (mode === 'vary' && !state.reference && sound) { adoptReference(sound); return }
    edit({ mode })
  }, [edit, adoptReference])

  const blocked = blockerOf(session)

  const generate = useCallback(() => {
    const state = current.current
    const reason = blockerOf(state)
    if (reason) { setMessage({ text: reason }); return }
    const a = state.reserve.find((s) => s.id === state.principal), b = state.reserve.find((s) => s.id === state.contributor)
    const reference = state.mode === 'vary' ? state.reference ?? undefined : state.mode === 'fuse' ? a : undefined
    // The disabled search palette belongs to Explore. Fusion and variations inherit their anchor.
    const criteria = structuredClone(reference ? { ...reference.criteria, minMs: state.criteria.minMs, maxMs: state.criteria.maxMs, avoid: state.criteria.avoid } : discoveryCriteria(state.criteria))
    if (state.mode === 'vary' && reference) criteria.avoid = [...reference.criteria.avoid]
    const request: LabRequest = {
      mode: state.mode, criteria, seed: crypto.getRandomValues(new Uint32Array(1))[0]!, count: 1,
      recentRecipes: state.mode === 'create' ? state.history.filter((sound) => sound.origin.kind === 'generated'
        && labCriteriaKey(sound.criteria) === labCriteriaKey(criteria)).slice(-4).map((sound) => sound.origin.recipe) : undefined,
      reference, contributor: state.mode === 'fuse' ? b : undefined,
      locks: [...state.locks], amount: state.amount, varyDuration: state.varyDuration, contribution: state.contribution, influence: state.influence,
    }
    const token = ++generateToken.current
    setBusy(true)
    setMessage(null)
    generator.current.run({ kind: 'batch', request, rate: latest.current.rate }, (render) => {
      if (token !== generateToken.current) return
      storeRender(render)
      const now = current.current
      // Two sounds with one name are two things to point at with one word; the newer gets a numeral.
      const names = new Set([...now.history, ...now.reserve].map((entry) => entry.name))
      let name = render.sound.name
      for (let n = 2; names.has(name); n++) name = `${render.sound.name} ${n}`
      const sound = name === render.sound.name ? render.sound : { ...render.sound, name }
      write({ ...now, history: [...now.history, sound].slice(-MAX_HISTORY), current: sound.id })
      play(sound)
    }, (issue) => {
      if (token !== generateToken.current) return
      setBusy(false)
      if (issue) setMessage({ text: issue })
    })
  }, [play, storeRender, write])

  const cancel = useCallback(() => { generateToken.current++; generator.current.cancel(); setBusy(false) }, [])

  const keep = useCallback((sound: LabSound) => {
    const state = current.current
    if (state.reserve.some((s) => s.fingerprint === sound.fingerprint)) { setMessage({ text: `${sound.name} is already in the reserve.` }); return }
    if (state.reserve.length >= MAX_RESERVE) { setMessage({ text: `The reserve holds ${MAX_RESERVE} sounds. Remove one, or save it to Sounds, before keeping another.` }); return }
    // A kept sound is a snapshot with its own identity: renaming or adjusting it later touches
    // nothing in the history it came from.
    const held = { ...structuredClone(sound), id: `lab-kept-${crypto.randomUUID()}` }
    write({ ...state, reserve: [...state.reserve, held] })
    setMessage({ text: `Kept ${held.name} in the reserve.`, undo: true })
  }, [write])

  const remove = useCallback((id: string) => {
    const state = current.current
    const sound = state.reserve.find((s) => s.id === id)
    if (!sound) return
    // The bench keeps what it was showing: a removal is one click, so going back has to be one too.
    const onBench = state.current === id && !state.history.some((s) => s.id === id)
    write({
      ...state, reserve: state.reserve.filter((s) => s.id !== id),
      history: onBench ? [...state.history, sound].slice(-MAX_HISTORY) : state.history,
      principal: state.principal === id ? null : state.principal, contributor: state.contributor === id ? null : state.contributor,
    })
    setMessage({ text: `Removed ${sound.name} from the reserve.`, undo: true })
  }, [write])

  const rename = useCallback((id: string, next: string, record = false) => {
    const state = current.current
    const label = record ? next.trim() || 'Sound' : next
    write({ ...state, reserve: state.reserve.map((sound) => (sound.id === id ? { ...sound, name: label } : sound)) }, record)
  }, [write])

  /** Puts a kept sound on the bench as its own editable copy; the reserve stays immutable. */
  const detach = useCallback((): LabSound | null => {
    const state = current.current
    const sound = currentSound(state)
    if (!sound) return null
    if (state.history.some((s) => s.id === sound.id) || (state.reference?.id === sound.id && !state.reserve.some((s) => s.id === sound.id))) return sound
    const child: LabSound = {
      ...structuredClone(sound), id: `lab-adjusted-${crypto.randomUUID()}`,
      origin: { ...sound.origin, kind: 'variation', parentIds: [sound.id], settings: { values: valuesOf(sound), locks: [...state.locks], amount: 'subtle', varyDuration: false } },
      parents: [parentOf(sound)],
    }
    write({ ...state, history: [...state.history, child].slice(-MAX_HISTORY), current: child.id })
    return child
  }, [write])

  const adjust = useCallback((values: number[]) => {
    const sound = detach()
    if (!sound) return
    const next = adjustReference(sound, values)
    if (next === sound) return
    const state = current.current
    const swap = (entry: LabSound) => (entry.id === sound.id ? next : entry)
    write({ ...state, history: state.history.map(swap), reference: state.reference && state.reference.id === sound.id ? next : state.reference }, !gesture.current)
    if (gesture.current) return
    // A step from the keyboard is heard, but a run of steps is heard once.
    clearTimeout(hearTimer.current)
    hearTimer.current = setTimeout(() => play(next), 220)
  }, [detach, play, write])
  /*
   * A control held and moved — a knob, or the Bite grip on the relief. It is one undo step however
   * long it lasts, and Escape takes it back to exactly where it started. A hand that pauses hears
   * the sound as it now is; letting go plays it, unless that very sound was just heard.
   */
  const gestureStart = useRef<{ session: LabSession; past: LabSession[]; future: LabSession[] } | null>(null)
  const heardInGesture = useRef<string | null>(null)
  const beginGesture = useCallback(() => {
    gestureStart.current = { session: current.current, past: past.current, future: future.current }
    heardInGesture.current = null
    remember(); gesture.current = true; detach()
  }, [detach, remember])
  const endGesture = useCallback(() => {
    if (!gesture.current) return
    gesture.current = false
    gestureStart.current = null
    const sound = currentSound(current.current)
    if (sound && heardInGesture.current !== sound.fingerprint) play(sound)
  }, [play])
  const cancelGesture = useCallback(() => {
    const start = gestureStart.current
    if (!gesture.current || !start) return
    gesture.current = false
    gestureStart.current = null
    queued.current = null
    setLoading(null)
    stop()
    past.current = start.past
    future.current = start.future
    write(start.session, false)
  }, [stop, write])
  /** The sound on the bench as it now is, heard once while a hand is still on a control. */
  const hearCurrent = useCallback(() => {
    const sound = currentSound(current.current)
    if (!sound) return
    heardInGesture.current = sound.fingerprint
    play(sound)
  }, [play])

  /*
   * Shaping: the three handles of the Shape view. A gesture begins on the first touch and is one
   * undo step however long it lasts; Escape takes it back entirely. Width and height are heard
   * while the hand is still on them, on the voice that is already playing, looped with a breath
   * between passes; the length is heard when it is let go, because a new length is a new render.
   */
  const sculptBegin = useCallback((kind: SculptKind): boolean => {
    if (shaping.current) return shaping.current.kind === kind
    const state = current.current
    const sound = currentSound(state)
    if (!sound) return false
    const render = cache.current.get(sound.fingerprint) ?? null
    const from = sculptValues(sound, render?.shape ?? null)
    if (kind === 'level' && !Number.isFinite(from.levelDb)) return false
    let held: LabVoice | null = null
    if (kind !== 'duration' && render) {
      if (voice.current && voice.current.fingerprint === sound.fingerprint) held = voice.current.voice
      else {
        stop()
        latest.current.onBeforePlay()
        const token = ++playToken.current
        held = playLabVoice(render.samples, latest.current.rate, { loop: true, onEnded: () => { if (token === playToken.current) { voice.current = null; setPlaying(null) } } })
        if (held) voice.current = { voice: held, fingerprint: sound.fingerprint }
      }
      if (held) {
        held.setLoop(true)
        setPlaying({ id: sound.id, fingerprint: sound.fingerprint, startedAt: held.startedAt, duration: held.duration, period: held.period, looping: true })
      }
    }
    const saved = future.current
    remember()
    shaping.current = { kind, sound, from, value: sculptValue(from, kind), voice: held, future: saved }
    setSculpting(kind)
    return true
  }, [remember, stop])

  const sculptPreview = useCallback((value: number) => {
    const held = shaping.current
    if (!held) return
    held.value = clampSculpt(held.kind, value)
    if (held.voice && held.kind === 'level') held.voice.setGain(Math.pow(10, (held.value - held.from.levelDb) / 20))
    if (held.voice && held.kind === 'width' && held.from.width > 0) held.voice.setSide(held.value / held.from.width)
    if (held.kind === 'duration') {
      // A new length is a new render. When the hand pauses on one, it is rendered and heard once,
      // while the hand is still down; letting go there is then heard without waiting.
      clearTimeout(shapeTimer.current)
      const target = held.value
      shapeTimer.current = setTimeout(() => {
        if (shaping.current !== held || held.value !== target) return
        const next = sculptSound(held.sound, 'duration', target, Number.NaN)
        const hear = (render: LabRender) => {
          if (shaping.current !== held || held.value !== target) return
          stop()
          latest.current.onBeforePlay()
          const token = ++playToken.current
          const heard = playLabVoice(render.samples, latest.current.rate, { onEnded: () => { if (token === playToken.current) { voice.current = null; setPlaying(null) } } })
          if (!heard) return
          voice.current = { voice: heard, fingerprint: render.sound.fingerprint }
          setPlaying({ id: held.sound.id, fingerprint: render.sound.fingerprint, startedAt: heard.startedAt, duration: heard.duration, period: heard.period })
        }
        const stored = cache.current.get(next.fingerprint)
        if (stored) hear(stored)
        else audition.current.run({ kind: 'preview', sound: next, rate: latest.current.rate }, (render) => { storeRender(render); hear(render) }, () => undefined)
      }, 280)
    }
  }, [stop, storeRender])

  /** The loop lets go: the pass under way plays out, and the playhead keeps counting passes until it ends. */
  const settle = useCallback((held: NonNullable<typeof shaping.current>) => {
    held.voice?.setLoop(false)
  }, [])

  const sculptCancel = useCallback(() => {
    const held = shaping.current
    if (!held) return
    shaping.current = null
    clearTimeout(shapeTimer.current)
    clearTimeout(stepTimer.current)
    setSculpting(null)
    if (held.voice) { held.voice.setGain(1); held.voice.setSide(1) }
    settle(held)
    // The step taken on the first touch is given back, and the redo stack with it.
    past.current = past.current.slice(0, -1)
    future.current = held.future
    setSculptResets((count) => count + 1)
  }, [settle])

  /** Lets go of the gesture. True when it made a new sound, false when it ended where it began. */
  const sculptCommit = useCallback((): boolean => {
    const held = shaping.current
    if (!held) return false
    shaping.current = null
    clearTimeout(shapeTimer.current)
    clearTimeout(stepTimer.current)
    setSculpting(null)
    if (Math.abs(held.value - sculptValue(held.from, held.kind)) < (held.kind === 'width' ? 0.0005 : 0.05)) {
      settle(held)
      past.current = past.current.slice(0, -1)
      future.current = held.future
      setSculptResets((count) => count + 1)
      return false
    }
    const state = current.current
    let next = sculptSound(held.sound, held.kind, held.value, held.from.levelDb)
    // A kept sound stays as it was kept: shaping one puts a shaped copy on the bench.
    const inHistory = state.history.some((entry) => entry.id === held.sound.id)
    if (!inHistory) next = { ...next, id: `lab-shaped-${crypto.randomUUID()}`, origin: { ...held.sound.origin, kind: 'variation', parentIds: [held.sound.id] }, parents: [parentOf(held.sound)] }
    const place = (session: LabSession, sound: LabSound, id: string): LabSession => {
      const swap = (entry: LabSound) => (entry.id === id ? sound : entry)
      const history = session.history.some((entry) => entry.id === id) ? session.history.map(swap) : [...session.history, sound].slice(-MAX_HISTORY)
      return { ...session, history, current: sound.id, reference: session.reference && session.reference.id === id ? sound : session.reference }
    }
    const shaped = next
    const finish = (render: LabRender) => {
      // A level lands on its target through one more render; that render's gain is the patch.
      if (render.sound.fingerprint !== shaped.fingerprint) write(place(current.current, render.sound, shaped.id), false)
      storeRender(render)
      setLoading((wait) => (wait === shaped.fingerprint ? null : wait))
      // Width and height were heard on the voice already playing; a length is heard now, unless
      // the pause before letting go already started it.
      const hearing = voice.current?.fingerprint === render.sound.fingerprint
      if ((held.kind === 'duration' || !held.voice) && !hearing) play(render.sound)
    }
    // Marked as rendering before the session changes, so the bench does not start a second,
    // untargeted render of the same sound and cancel this one.
    setLoading(shaped.fingerprint)
    write(place(state, next, inHistory ? held.sound.id : next.id), false)
    settle(held)
    const stored = held.kind === 'level' ? undefined : cache.current.get(shaped.fingerprint)
    if (stored) { finish(stored); return true }
    audition.current.run({ kind: 'preview', sound: shaped, rate: latest.current.rate, targetPeakDb: held.kind === 'level' ? held.value : undefined }, finish, (issue) => {
      setLoading((wait) => (wait === shaped.fingerprint ? null : wait))
      if (issue) { failed.current.add(shaped.fingerprint); setMessage({ text: issue }); setSculptResets((count) => count + 1) }
    })
    return true
  }, [play, settle, storeRender, write])

  /** Keyboard steps: each press is heard, and a run of presses is one undo step. */
  const sculptStep = useCallback((kind: SculptKind, value: number): boolean => {
    if (shaping.current && shaping.current.kind !== kind) sculptCommit()
    if (!sculptBegin(kind)) return false
    sculptPreview(value)
    clearTimeout(stepTimer.current)
    stepTimer.current = setTimeout(() => sculptCommit(), 650)
    return true
  }, [sculptBegin, sculptCommit, sculptPreview])

  const toggleLock = useCallback((control: number) => edit({ locks: current.current.locks.map((value, i) => (i === control ? !value : value)) }), [edit])
  const setDuration = useCallback((minMs: number, maxMs: number) => setCriteria({ minMs, maxMs }), [setCriteria])
  const fromInstrument = useCallback(() => {
    const patch = latest.current.instrument
    if (!patch) return
    const state = current.current
    const known = [...state.reserve, ...state.history, ...state.references, ...(state.reference ? [state.reference] : [])].find((s) => s.fingerprint === fingerprint(patch))
    const sound = known
      ? { ...makeLabSound(patch, known.criteria, known.origin, known.name, latest.current.rig), id: known.id, roles: [...known.roles], parents: structuredClone(known.parents), preview: known.preview }
      : makeLabSound(patch, { ...state.criteria, minMs: Math.round(patch.duration * 1000), maxMs: Math.round(patch.duration * 1000) }, { kind: 'instrument', recipe: 'imported', version: 1, seed: Date.now() >>> 0, parentIds: [] }, latest.current.name.trim() || 'Instrument', latest.current.rig)
    bench(sound)
  }, [bench])
  const loadDemo = useCallback((id: string) => bench(labDemo(id)), [bench])
  const save = useCallback((sound: LabSound) => setMessage({ text: latest.current.onSave(sound) ?? `Saved ${sound.name} to Sounds.` }), [])
  const open = useCallback((sound: LabSound) => { stop(); cancel(); latest.current.onOpen(sound) }, [cancel, stop])
  const dismiss = useCallback(() => setMessage(null), [])

  useEffect(() => {
    const player = audition.current, maker = generator.current
    return () => { player.dispose(); maker.dispose(); stopLabVoice(); stopPlayback(); clearTimeout(hearTimer.current); clearTimeout(shapeTimer.current); clearTimeout(stepTimer.current) }
  }, [])
  // Leaving the view stops the voice and lets a render in flight go; the session itself stays.
  useEffect(() => { if (!active) { stop(); cancel() } }, [active, cancel, stop])

  const sound = currentSound(session)
  const render = sound ? cache.current.get(sound.fingerprint) ?? null : null
  useEffect(() => {
    if (active && sound && !render && loading !== sound.fingerprint) prepare(sound, gesture.current)
    // The render version is what says the cache has changed underneath the same sound.
  }, [active, sound, render, loading, prepare, renderVersion])

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target instanceof HTMLElement ? event.target : null
      // Fields, menus and the timbre popover keep their own keys, Escape included.
      const typing = !!target?.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"], [role="combobox"], [role="menuitem"], [role="menu"] *, [data-labs-popover] *')
      const meta = event.metaKey || event.ctrlKey
      if (meta && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
        if (typing) return
        event.preventDefault()
        undo(event.shiftKey || event.key.toLowerCase() === 'y')
        return
      }
      if (meta || event.altKey || typing) return
      const key = event.key
      const state = current.current
      const onBench = currentSound(state)
      if (key === 'Escape') {
        if (shaping.current) { event.preventDefault(); sculptCancel(); return }
        if (gesture.current) { event.preventDefault(); cancelGesture(); return }
        if (latest.current.playing || latest.current.loading || generator.current.running) { event.preventDefault(); stop(); cancel() }
        return
      }
      // Buttons, sliders and radios keep their own arrows and space.
      const owned = !!target?.matches('button, a, [role="slider"], [role="radio"], input, select, summary, [role="tab"], [role="option"]')
      if (key === ' ' && !owned) { event.preventDefault(); if (onBench) toggle(onBench); return }
      // Enter on a tile or a checkbox does nothing of its own, so it makes the next sound; on a
      // button, a link or a field it keeps its meaning.
      const ownsEnter = !!target?.matches('button, a, [role="slider"], summary, [role="tab"], [role="option"], textarea, select, [role="switch"]')
      if ((key === 'g' || key === 'G') || (key === 'Enter' && !ownsEnter)) { event.preventDefault(); generate(); return }
      if ((key === 'k' || key === 'K') && onBench) { event.preventDefault(); keep(onBench); return }
      if ((key === 'r' || key === 'R') && onBench) { event.preventDefault(); adoptReference(onBench); return }
      if ((key === 'ArrowLeft' || key === 'ArrowRight') && !owned) {
        const list = state.history
        if (!list.length) return
        const at = list.findIndex((s) => s.id === state.current)
        const next = list[Math.min(list.length - 1, Math.max(0, (at < 0 ? list.length - 1 : at) + (key === 'ArrowRight' ? 1 : -1)))]
        if (next && next.id !== state.current) { event.preventDefault(); select(next) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, cancel, generate, keep, select, stop, toggle, undo, adoptReference, sculptCancel, cancelGesture])

  const kept = (entry: LabSound) => session.reserve.some((s) => s.fingerprint === entry.fingerprint)

  return {
    session, sound, render, renderVersion, busy, playing, loading, message, blocked, rate, storePreview,
    paletteView, setPaletteView, paletteRevision,
    showPalette: (view: PaletteView) => { setPaletteView(view); setPaletteRevision((value) => value + 1); onShowPalette?.() },
    canUndo: past.current.length > 0, canRedo: future.current.length > 0,
    principal: session.reserve.find((s) => s.id === session.principal) ?? null,
    contributor: session.reserve.find((s) => s.id === session.contributor) ?? null,
    kept, valuesOf,
    setCriteria, beginEdit, setDuration, setMode, toggleLock,
    setAmount: (amount: LabSession['amount']) => edit({ amount }),
    setVaryDuration: (varyDuration: boolean) => edit({ varyDuration }),
    setContribution: (contribution: LabSession['contribution']) => edit({ contribution }),
    setInfluence: (influence: number) => edit({ influence }),
    setPrincipal: (principal: string | null) => edit({ principal }),
    setContributor: (contributor: string | null) => edit({ contributor }),
    generate, cancel, play, stop, toggle, select, bench, keep, remove, rename, adoptReference, adjust, beginGesture, endGesture, cancelGesture, hearCurrent,
    sculpting, sculptResets, sculptBegin, sculptPreview, sculptCommit, sculptCancel, sculptStep,
    undo: () => undo(false), redo: () => undo(true), save, open, fromInstrument, loadDemo, dismiss,
  }
}
