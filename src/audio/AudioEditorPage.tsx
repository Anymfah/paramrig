import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ParamValue } from '@/rigs/types'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { Button, IconButton } from '@/ui/Button'
import { IconRedo, IconUndo } from '@/ui/icons'
import { StatusMessage } from '@/ui/StatusMessage'
import { Tooltip } from '@/ui/Tooltip'
import { AudioBoard } from '@/audio/AudioBoard'
import { AudioPresetRail } from '@/audio/AudioPresetRail'
import { AudioTransport } from '@/audio/AudioTransport'
import { boardParameters, boardValues, setBoardValue } from '@/audio/board'
import { getAudioDocument, saveAudioDocument, storageMessage, type AudioDocument } from '@/audio/document'
import { renderPatch } from '@/audio/dsp/render'
import { disposePlayback, playbackRate } from '@/audio/playback'
import { readAudioPrefs, withAutoPlay, writeAudioPrefs, type AudioMode } from '@/audio/prefs'
import { mutatePatch, randomPatch } from '@/audio/shuffle'
import type { AudioPatch } from '@/audio/types'

const HISTORY_LIMIT = 100

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
  const gestureRef = useRef(false)
  const capturedRef = useRef(false)

  const parameters = useMemo(() => boardParameters(), [])
  const values = useMemo(() => (patch ? boardValues(patch) : {}), [patch])
  const rate = useMemo(() => playbackRate(), [])
  const shown = useDeferredValue(patch)
  const samples = useMemo(() => (shown ? renderPatch(shown, rate) : new Float32Array(0)), [shown, rate])

  useEffect(() => () => disposePlayback(), [])

  useEffect(() => {
    if (!loaded || !patch || !dirty) return
    // Written on a delay so a drag lands once, not on every frame of itself.
    const timer = setTimeout(() => {
      const result = saveAudioDocument({ ...loaded, name, patch, updatedAt: new Date().toISOString() })
      setNotice(storageMessage(result) ?? '')
    }, 400)
    return () => clearTimeout(timer)
  }, [dirty, loaded, name, patch])

  /** One whole new patch, as one step. */
  const commit = useCallback((next: AudioPatch) => {
    setDirty(true)
    setPatch((current) => {
      if (current) setPast((stack) => [...stack, current].slice(-HISTORY_LIMIT))
      setFuture([])
      return next
    })
  }, [])

  const change = useCallback((property: string, value: ParamValue) => {
    setDirty(true)
    setPatch((current) => {
      if (!current) return current
      // One drag is one undo step: the patch is captured when the gesture opens, not per frame.
      if (!gestureRef.current || !capturedRef.current) {
        capturedRef.current = true
        setPast((stack) => [...stack, current].slice(-HISTORY_LIMIT))
        setFuture([])
      }
      return setBoardValue(current, property, value)
    })
  }, [])

  const undo = useCallback(() => {
    setDirty(true)
    setPast((stack) => {
      const previous = stack[stack.length - 1]
      if (!previous) return stack
      setPatch((current) => {
        if (current) setFuture((ahead) => [current, ...ahead].slice(0, HISTORY_LIMIT))
        return previous
      })
      return stack.slice(0, -1)
    })
  }, [])

  const redo = useCallback(() => {
    setDirty(true)
    setFuture((stack) => {
      const next = stack[0]
      if (!next) return stack
      setPatch((current) => {
        if (current) setPast((behind) => [...behind, current].slice(-HISTORY_LIMIT))
        return next
      })
      return stack.slice(1)
    })
  }, [])

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
      <AudioTransport samples={samples} sampleRate={rate} name={loaded.name} autoPlay={autoPlay} onAutoPlay={setAuto} />
      <div className="audio-body" id="main" tabIndex={-1}>
        <AudioPresetRail
          onPatch={(next) => commit({ ...next, seed: patch.seed })}
          onRandom={() => commit(randomPatch(Math.floor(Math.random() * 100000)))}
          onMutate={() => commit(mutatePatch(patch, Math.floor(Math.random() * 100000)))}
        />
        <AudioBoard
          parameters={parameters}
          values={values}
          onChange={change}
          onGestureStart={() => { gestureRef.current = true; capturedRef.current = false }}
          onGestureEnd={() => { gestureRef.current = false; capturedRef.current = false }}
        />
      </div>
      <div className="workspace-status">
        <span className="workspace-status__baseline">{parameters.length} fields</span>
        <span className="workspace-status__changes">{exposed > 0 ? `${exposed} exposed` : 'No controls exposed'}</span>
        <span className="workspace-status__notice" role="status">{notice}</span>
      </div>
    </WorkspaceShell>
  )
}
