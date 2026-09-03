import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/ui/Button'
import { SelectField } from '@/ui/SelectField'
import { BarField } from '@/ui/BarField'
import { StatusMessage } from '@/ui/StatusMessage'
import { VectorModal } from '@/vector/VectorModal'
import { DEFAULT_TRACE, MAX_TRACE_COLORS, MIN_TRACE_COLORS, PREVIEW_SIDE, traceBitmap, type TraceLayer } from '@/vector/trace'
import { imagePixels, traceOffThread } from '@/vector/traceImage'
import type { VectorElement, VectorTraceOptions } from '@/vector/types'

/**
 * Turns a picture into paths.
 *
 * The preview traces a reduced copy on every change, which is fast enough to follow a slider; the
 * button traces the picture at its own size, off the main thread, so a big photograph does not
 * freeze the canvas while it is being worked out.
 */
export function VectorTraceDialog({ image, open, onClose, onTrace }: {
  image: VectorElement | null
  open: boolean
  onClose: () => void
  onTrace: (layers: TraceLayer[], size: { width: number; height: number }, options: VectorTraceOptions) => void
}) {
  const [options, setOptions] = useState<VectorTraceOptions>(DEFAULT_TRACE)
  const [preview, setPreview] = useState<{ layers: TraceLayer[]; width: number; height: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pixels = useRef<{ pixels: Uint8ClampedArray; width: number; height: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setOptions(DEFAULT_TRACE)
      setPreview(null)
      setError(null)
      pixels.current = null
    }
  }, [open])

  // The reduced copy is decoded once, then traced again on every change of the settings.
  useEffect(() => {
    if (!open || !image?.image) return
    let cancelled = false
    void (async () => {
      const small = pixels.current ?? await imagePixels(image.image!, PREVIEW_SIDE)
      if (cancelled) return
      if (!small) {
        setError('That picture could not be read.')
        return
      }
      pixels.current = small
      setPreview({ layers: traceBitmap(small.pixels, small.width, small.height, options), width: small.width, height: small.height })
    })()
    return () => { cancelled = true }
  }, [open, image, options])

  const paths = useMemo(() => (preview?.layers ?? []).map((layer) => ({
    color: layer.color,
    d: layer.loops.map((loop) => `M ${loop.map((point) => `${round(point.x)} ${round(point.y)}`).join(' L ')} Z`).join(' '),
  })), [preview])

  const trace = async () => {
    if (!image?.image) return
    setBusy(true)
    setError(null)
    try {
      // The full-size picture, not the preview copy: the paths land at the detail it really has.
      const full = await imagePixels(image.image, Math.max(image.imageWidth ?? 2048, image.imageHeight ?? 2048, 2048))
      if (!full) {
        setError('That picture could not be read.')
        return
      }
      const layers = await traceOffThread(full.pixels, full.width, full.height, options)
      if (layers.length === 0) {
        setError('Nothing came out of that. Try moving the threshold.')
        return
      }
      onTrace(layers, { width: full.width, height: full.height }, options)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const loops = preview?.layers.reduce((total, layer) => total + layer.loops.length, 0) ?? 0

  return (
    <VectorModal label="Trace image" open={open && !!image} onClose={onClose}>
      <div className="vector-trace">
        <h2 className="vector-trace__title">Trace image</h2>
        <div className="vector-trace__preview">
          {image?.image ? <img src={image.image} alt="" /> : null}
          {preview ? (
            <svg viewBox={`0 0 ${preview.width} ${preview.height}`} role="img" aria-label="Trace preview">
              {paths.map((path, index) => <path key={index} d={path.d} fill={path.color} fillRule="evenodd" />)}
            </svg>
          ) : null}
        </div>
        <p className="vector-trace__count">{loops} {loops === 1 ? 'outline' : 'outlines'} in {preview?.layers.length ?? 0} {preview?.layers.length === 1 ? 'layer' : 'layers'}</p>
        <SelectField
          label="Mode"
          value={options.mode}
          options={[{ value: 'silhouette', label: 'Silhouette' }, { value: 'colors', label: 'Colour bands' }]}
          onChange={(mode) => setOptions((current) => ({ ...current, mode: mode as VectorTraceOptions['mode'] }))}
        />
        {options.mode === 'colors' ? (
          <BarField label="Bands" value={options.colors} min={MIN_TRACE_COLORS} max={MAX_TRACE_COLORS} step={1} onChange={(colors) => setOptions((current) => ({ ...current, colors }))} />
        ) : null}
        <BarField label="Threshold" value={Math.round(options.threshold * 100)} min={0} max={100} step={1} unit="%" onChange={(value) => setOptions((current) => ({ ...current, threshold: value / 100 }))} />
        <BarField label="Smoothing" value={Math.round(options.smoothing * 100)} min={0} max={100} step={1} unit="%" onChange={(value) => setOptions((current) => ({ ...current, smoothing: value / 100 }))} />
        <BarField label="Ignore under" value={Math.round(options.minArea)} min={0} max={400} step={1} unit="px²" onChange={(minArea) => setOptions((current) => ({ ...current, minArea }))} />
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        <div className="vector-trace__actions">
          <Button variant="quiet" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="solid" size="sm" data-action="trace" disabled={busy || loops === 0} onClick={() => void trace()}>{busy ? 'Tracing…' : 'Trace'}</Button>
        </div>
      </div>
    </VectorModal>
  )
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
