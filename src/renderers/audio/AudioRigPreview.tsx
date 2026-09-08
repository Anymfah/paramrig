import { useDeferredValue, useMemo } from 'react'
import type { ParamValue } from '@/rigs/types'
import { StatusMessage } from '@/ui/StatusMessage'
import { AudioStage } from '@/audio/AudioStage'
import { getAudioDocument } from '@/audio/document'
import { renderPatch } from '@/audio/dsp/render'
import { resolveAudioValues } from '@/audio/rig'
import { playbackRate } from '@/audio/playback'

/**
 * A patch heard the way its controls say. The workbench asks for this the same way it asks for any
 * other renderer — values in, something to perceive out — except that what comes out is a buffer
 * rather than a picture, so the waveform stands in for it on screen and the ear does the rest.
 *
 * Nothing here can edit the patch: turning a knob writes a value, and the sound follows.
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
  const samples = useMemo(() => (shown ? renderPatch(shown, rate) : new Float32Array(0)), [shown, rate])

  if (!document) {
    return <StatusMessage>That patch is not in this browser. Open its project file to bring it back.</StatusMessage>
  }
  return <AudioStage samples={samples} sampleRate={rate} name={name} />
}
