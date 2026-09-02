import { traceBitmap, type TraceLayer } from '@/vector/trace'
import type { VectorTraceOptions } from '@/vector/types'

export type TraceRequest = { id: number; pixels: ArrayBuffer; width: number; height: number; options: VectorTraceOptions }
export type TraceResponse = { id: number; layers: TraceLayer[] }

/**
 * Tracing a full-size picture takes long enough to freeze a canvas, so it happens here instead.
 * The pixels arrive as a transferred buffer, which costs nothing to hand over.
 */
self.onmessage = (event: MessageEvent<TraceRequest>) => {
  const { id, pixels, width, height, options } = event.data
  const layers = traceBitmap(new Uint8ClampedArray(pixels), width, height, options)
  const response: TraceResponse = { id, layers }
  self.postMessage(response)
}
