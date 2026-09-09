import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { useTransport } from '@/audio/useTransport'
import type { ParamValue } from '@/rigs/types'
import { StatusMessage } from '@/ui/StatusMessage'
import { AudioTransport } from '@/audio/AudioTransport'
import { getAudioDocument } from '@/audio/document'
import { renderPatch } from '@/audio/dsp/render'
import { resolveAudioValues } from '@/audio/rig'
import { playbackRate } from '@/audio/playback'
import { readAudioPrefs, withAutoPlay, writeAudioPrefs } from '@/audio/prefs'

/**
 * A patch heard the way its controls say. The workbench asks for this like any other renderer —
 * values in, something to perceive out — except that what comes out is a buffer, so the transport
 * stands in for it on screen and the ear does the rest.
 *
 * Tune has room the board does not need here, and it still does not go to the waveform: four
 * exposed controls and a strip is the whole of what this mode is for.
 */
export function AudioRigPreview({ documentId, values, name }: {
  documentId: string
  values: Record<string, ParamValue>
  name: string
}) {
  const document = useMemo(() => getAudioDocument(documentId), [documentId])
  const rate = useMemo(() => playbackRate(), [])
  const patch = useMemo(() => (document ? resolveAudioValues(document, values) : null), [document, values])
  const shown = useDeferredValue(patch)
  const samples = useMemo(() => (shown ? renderPatch(shown, rate) : { left: new Float32Array(0), right: new Float32Array(0) }), [shown, rate])
  const transport = useTransport(samples, rate)
  const [autoPlay, setAutoPlay] = useState(() => readAudioPrefs().autoPlay)

  const setAuto = useCallback((next: boolean) => {
    setAutoPlay(next)
    writeAudioPrefs(withAutoPlay(readAudioPrefs(), next))
  }, [])

  if (!document) {
    return <StatusMessage>That patch is not in this browser. Open its project file to bring it back.</StatusMessage>
  }
  return (
    <div className="audio-tune">
      <AudioTransport transport={transport} samples={samples} sampleRate={rate} name={name} patch={shown ?? undefined} autoPlay={autoPlay} onAutoPlay={setAuto} />
    </div>
  )
}
