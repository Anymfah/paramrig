import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ParamValue } from '@/rigs/types'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { Button, IconButton } from '@/ui/Button'
import { IconRedo, IconUndo } from '@/ui/icons'
import { StatusMessage } from '@/ui/StatusMessage'
import { Tooltip } from '@/ui/Tooltip'
import { AudioBoard } from '@/audio/AudioBoard'
import { AudioSoundBar } from '@/audio/AudioSoundBar'
import { AudioTransport } from '@/audio/AudioTransport'
import { BOARD_CATEGORIES, MODULATION_CATEGORIES, boardParameters, boardValues, setBoardValue } from '@/audio/board'
import { AudioPresetsView } from '@/audio/AudioPresetsView'
import { getAudioDocument, MAX_SNAPSHOTS, saveAudioDocument, storageMessage, type AudioDocument, type AudioSnapshot } from '@/audio/document'
import { renderPatch } from '@/audio/dsp/render'
import { disposePlayback, playbackRate } from '@/audio/playback'
import { readAudioPrefs, withAutoPlay, writeAudioPrefs, type AudioMode } from '@/audio/prefs'
import { PRESETS } from '@/audio/presets'
import { mutatePatch, randomPatch } from '@/audio/shuffle'
import type { AudioPatch } from '@/audio/types'

const HISTORY_LIMIT = 100

/**
 * Three ways of working on one sound, rather than three places to hunt in.
 *
 * Nothing is hidden inside a view — the layers show every field they have at once, and so do the
 * modulators. What the tabs separate is what you are doing: shaping a voice, giving it movement,
 * or looking for a different sound entirely.
 */
type ViewId = 'layers' | 'modulation' | 'sounds'
const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'layers', label: 'Layers' },
  { id: 'modulation', label: 'Modulation' },
  { id: 'sounds', label: 'Sounds' },
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
 */
export function AudioEditorPage({ documentId, mode, onMode }: {
  documentId: string
  mode: AudioMode
  onMode: (mode: AudioMode) => void
}) {
  const navigate = useNavigate()
  const [loaded] = useState<AudioDocument | null>(() => getAudioDocument(documentId))
  const [patch, setPatch] = useState<AudioPatch | null>(() => loaded?.patch ?? null)
  const [name, setName] = useState(loaded?.name ?? '')
  const [past, setPast] = useState<AudioPatch[]>([])
  const [future, setFuture] = useState<AudioPatch[]>([])
  const [notice, setNotice] = useState('')
  const [autoPlay, setAutoPlay] = useState(() => readAudioPrefs().autoPlay)
  // Nothing is written until something is changed, or opening a bundled example would stamp a new
  // updatedAt and quietly turn it into this browser's project.
  const [dirty, setDirty] = useState(false)
  const [preset, setPreset] = useState('')
  const [view, setView] = useState<ViewId>('layers')
  const [snapshots, setSnapshots] = useState<AudioSnapshot[]>(() => loaded?.snapshots ?? [])
  const [touched, setTouched] = useState(false)
  const gestureRef = useRef(false)
  const capturedRef = useRef(false)
  /** The patch as of the last write, so the end of a drag can hand it to the ear. */
  const latest = useRef<AudioPatch | null>(null)

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
  const samples = useMemo(() => (heard ? renderPatch(heard, rate) : new Float32Array(0)), [heard, rate])

  useEffect(() => () => disposePlayback(), [])

  useEffect(() => {
    if (!loaded || !patch || !dirty) return
    // Written on a delay so a drag lands once, not on every frame of itself.
    const timer = setTimeout(() => {
      const result = saveAudioDocument({ ...loaded, name, patch, snapshots, updatedAt: new Date().toISOString() })
      setNotice(storageMessage(result) ?? '')
    }, 400)
    return () => clearTimeout(timer)
  }, [dirty, loaded, name, patch, snapshots])

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
  const commit = useCallback((next: AudioPatch) => {
    const current = latest.current ?? patch
    if (!current) return
    setDirty(true)
    setPast((stack) => [...stack, current].slice(-HISTORY_LIMIT))
    setFuture([])
    latest.current = next
    setPatch(next)
    setHeard(next)
  }, [patch])

  const change = useCallback((property: string, value: ParamValue) => {
    const current = latest.current ?? patch
    if (!current) return
    setDirty(true)
    // The selection survives the edit — it is what an overwrite would write to — and `touched`
    // is what says the sound on screen is no longer the one under that name.
    setTouched(true)
    // One drag is one undo step: the patch is captured when the gesture opens, not per frame.
    if (!gestureRef.current || !capturedRef.current) {
      capturedRef.current = true
      setPast((stack) => [...stack, current].slice(-HISTORY_LIMIT))
      setFuture([])
    }
    const next = setBoardValue(current, property, value)
    latest.current = next
    setPatch(next)
    // Held back only while a pointer is down on a control; a typed value or an arrow key is
    // discrete and should be heard as soon as it lands.
    if (!gestureRef.current) setHeard(next)
  }, [patch])

  const undo = useCallback(() => {
    const previous = past[past.length - 1]
    const current = latest.current ?? patch
    if (!previous || !current) return
    setDirty(true)
    setPast((stack) => stack.slice(0, -1))
    setFuture((ahead) => [current, ...ahead].slice(0, HISTORY_LIMIT))
    latest.current = previous
    setPatch(previous)
    setHeard(previous)
  }, [past, patch])

  const redo = useCallback(() => {
    const next = future[0]
    const current = latest.current ?? patch
    if (!next || !current) return
    setDirty(true)
    setFuture((ahead) => ahead.slice(1))
    setPast((stack) => [...stack, current].slice(-HISTORY_LIMIT))
    latest.current = next
    setPatch(next)
    setHeard(next)
  }, [future, patch])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (event.defaultPrevented || !meta || !['z', 'y'].includes(event.key.toLowerCase())) return
      const target = event.target
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      if (event.shiftKey || event.key.toLowerCase() === 'y') redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  /** The sound you are on, kept aside under whatever it is currently called. */
  const keep = useCallback(() => {
    const current = latest.current ?? patch
    if (!current) return
    const from = PRESETS.find((entry) => entry.id === preset)?.label
    const name = from
      ? `${from} ${snapshots.filter((entry) => entry.name.startsWith(from)).length + 1}`
      : `Sound ${snapshots.length + 1}`
    const snapshot: AudioSnapshot = { id: `snap-${crypto.randomUUID()}`, name, createdAt: new Date().toISOString(), patch: current }
    setDirty(true)
    // The oldest gives way rather than the list growing past the point of being readable.
    setSnapshots((kept) => [...kept, snapshot].slice(-MAX_SNAPSHOTS))
    // You are on the thing you just kept, so the menu should say so.
    setPreset(snapshot.id)
    setTouched(false)
  }, [patch, preset, snapshots])

  const forget = useCallback((id: string) => {
    setDirty(true)
    setSnapshots((kept) => kept.filter((entry) => entry.id !== id))
  }, [])

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
      entry.id === preset ? { ...entry, patch: current, createdAt: new Date().toISOString() } : entry
    )))
  }, [patch, preset])

  const setAuto = useCallback((next: boolean) => {
    setAutoPlay(next)
    writeAudioPrefs(withAutoPlay(readAudioPrefs(), next))
  }, [])

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

  const exposed = loaded.rig?.parameters.length ?? 0

  return (
    <WorkspaceShell rigs={listRigs()} activeId={documentId} hideInspector mainLabel="Sound">
      <h1 className="visually-hidden">{loaded.name}</h1>
      <div className="workspace-toolbar">
        <div className="workspace-toolbar__group">
          <input
            className="audio-name"
            aria-label="Patch name"
            value={name}
            onChange={(event) => { setDirty(true); setName(event.target.value.slice(0, 120)) }}
          />
        </div>
        <div className="workspace-toolbar__group">
          <Tooltip content={past.length ? 'Undo (⌘Z / Ctrl+Z)' : 'Nothing to undo'}>
            <IconButton label="Undo" onClick={undo} disabled={past.length === 0}><IconUndo /></IconButton>
          </Tooltip>
          <Tooltip content={future.length ? 'Redo (⌘⇧Z / Ctrl+Shift+Z)' : 'Nothing to redo'}>
            <IconButton label="Redo" onClick={redo} disabled={future.length === 0}><IconRedo /></IconButton>
          </Tooltip>
        </div>
        {exposed > 0 ? (
          <div className="workspace-toolbar__group">
            <Button variant="quiet" size="sm" onClick={() => onMode(mode === 'edit' ? 'tune' : 'edit')}>Tune</Button>
          </div>
        ) : null}
      </div>
      <AudioTransport
        samples={samples}
        sampleRate={rate}
        name={loaded.name}
        patch={heard ?? patch}
        autoPlay={autoPlay}
        onAutoPlay={setAuto}
        tools={
          <AudioSoundBar
            current={preset}
            snapshots={snapshots}
            touched={touched}
            onPatch={(next, id) => { setPreset(id); setTouched(false); commit({ ...next, seed: patch.seed }) }}
            onRemove={forget}
            onSnapshot={keep}
            onOverwrite={overwrite}
            onRandom={() => { setPreset(''); setTouched(false); commit(randomPatch(Math.floor(Math.random() * 100000))) }}
            onMutate={() => { setTouched(true); commit(mutatePatch(patch, Math.floor(Math.random() * 100000))) }}
          />
        }
      />
      {/* Always in the tree so a screen reader keeps the live region, but no height until it has
          something to say. A permanent band reporting that nothing is wrong is a band of nothing. */}
      <p className="editor-notice" role="status" data-empty={notice.length === 0}>{notice}</p>
      <div className="audio-body" id="main" tabIndex={-1}>
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
              onClick={() => setView(entry.id)}
              onKeyDown={(event) => {
                const at = VIEWS.findIndex((item) => item.id === view)
                const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
                if (!step) return
                event.preventDefault()
                const next = VIEWS[(at + step + VIEWS.length) % VIEWS.length]!
                setView(next.id)
                queueMicrotask(() => window.document.getElementById(`audio-view-${next.id}`)?.focus())
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="audio-view" id="audio-view-panel" role="tabpanel" aria-labelledby={`audio-view-${view}`}>
          {view === 'sounds' ? (
            <AudioPresetsView
              current={preset}
              snapshots={snapshots}
              onPatch={(next, id) => { setPreset(id); setTouched(false); commit({ ...next, seed: patch.seed }) }}
              onRemove={forget}
            />
          ) : (
            <AudioBoard
              categories={view === 'layers' ? BOARD_CATEGORIES : MODULATION_CATEGORIES}
              parameters={parameters}
              values={values}
              duration={patch.duration}
              onChange={change}
              onGestureStart={() => { gestureRef.current = true; capturedRef.current = false }}
              onGestureEnd={() => {
                gestureRef.current = false
                capturedRef.current = false
                if (latest.current) setHeard(latest.current)
              }}
            />
          )}
        </div>
      </div>
    </WorkspaceShell>
  )
}
