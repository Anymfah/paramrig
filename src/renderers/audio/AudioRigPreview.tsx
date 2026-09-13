import { useEffect, useDeferredValue, useMemo, useState } from 'react'
import { useTransport } from '@/audio/useTransport'
import type { ParamValue } from '@/rigs/types'
import { StatusMessage } from '@/ui/StatusMessage'
import { AudioTransport } from '@/audio/AudioTransport'
import { getAudioDocument } from '@/audio/document'
import { restoreAudioAssets } from '@/audio/project'
import { renderPatch } from '@/audio/dsp/render'
import { resolveAudioValues } from '@/audio/rig'
import { playbackRate } from '@/audio/playback'

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
  const [assets, setAssets] = useState(0)
  const [assetError, setAssetError] = useState('')
  useEffect(() => {
    if (!document || !document.patch.layers.some((layer) => layer.source.table.startsWith('user:'))) return
    let cancelled = false
    void restoreAudioAssets(document).then((missing) => {
      if (cancelled) return
      setAssets((value) => value + 1)
      setAssetError(missing.length ? 'Some wavetables are missing. Open Edit to import them again.' : '')
    })
    return () => { cancelled = true }
  }, [document])
  const rate = useMemo(() => playbackRate(), [])
  const patch = useMemo(() => (document ? resolveAudioValues(document, values) : null), [document, values])
  const shown = useDeferredValue(patch)
  const samples = useMemo(() => { void assets; return shown ? renderPatch(shown, rate) : { left: new Float32Array(0), right: new Float32Array(0) } }, [shown, rate, assets])
  const transport = useTransport(samples, rate)

  if (!document) {
    return <StatusMessage>That patch is not in this browser. Open its project file to bring it back.</StatusMessage>
  }
  return (
    <div className="audio-tune">
      {assetError ? <StatusMessage>{assetError}</StatusMessage> : null}
      <AudioTransport transport={transport} samples={samples} sampleRate={rate} name={name} patch={shown ?? undefined} />
    </div>
  )
}
