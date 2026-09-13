import { fitSmoothNodes } from '@/vector/pencil'
import { networkFromRuns, normalizeWorld, worldNetwork, type Run } from '@/vector/network'
import { computeFaces, holeFaceKeys } from '@/vector/planar'
import { createVectorElement } from '@/vector/model'
import { PREVIEW_SIDE, traceBitmap, type TraceLayer } from '@/vector/trace'
import type { VectorElement, VectorTraceOptions } from '@/vector/types'
import type { TraceRequest, TraceResponse } from '@/vector/traceWorker'

/** Decodes a picture into pixels, shrunk to at most `side` on its longest edge. */
export async function imagePixels(source: string, side = PREVIEW_SIDE): Promise<{ pixels: Uint8ClampedArray; width: number; height: number } | null> {
  if (typeof globalThis.document === 'undefined' || typeof Image === 'undefined') return null
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => resolve(null)
    element.src = source
  })
  if (!image) return null
  const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight, 1))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, width, height)
  return { pixels: context.getImageData(0, 0, width, height).data, width, height }
}

let worker: Worker | null = null
let nextRequest = 1

/** Traces off the main thread when the browser can; falls back to tracing here when it cannot. */
export async function traceOffThread(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: VectorTraceOptions,
): Promise<TraceLayer[]> {
  if (typeof Worker !== 'function') return traceBitmap(pixels, width, height, options)
  try {
    if (!worker) worker = new Worker(new URL('./traceWorker.ts', import.meta.url), { type: 'module' })
    const id = nextRequest++
    const copy = pixels.slice()
    const request: TraceRequest = { id, pixels: copy.buffer, width, height, options }
    return await new Promise<TraceLayer[]>((resolve, reject) => {
      const onMessage = (event: MessageEvent<TraceResponse>) => {
        if (event.data.id !== id) return
        worker?.removeEventListener('message', onMessage)
        resolve(event.data.layers)
      }
      worker!.addEventListener('message', onMessage)
      worker!.addEventListener('error', reject, { once: true })
      worker!.postMessage(request, [copy.buffer])
    })
  } catch {
    return traceBitmap(pixels, width, height, options)
  }
}

/**
 * The traced layers as elements, one path per layer, placed over the picture they came from.
 *
 * A layer's loops go into one network: its holes are faces of their own, switched off so a ring
 * reads as a ring rather than a disc, the same way an outlined letter keeps its counters.
 */
export function tracedElements(layers: TraceLayer[], image: VectorElement, size: { width: number; height: number }, smoothing: number): VectorElement[] {
  const scaleX = image.width / Math.max(1, size.width)
  const scaleY = image.height / Math.max(1, size.height)
  return layers.flatMap((layer, index): VectorElement[] => {
    const runs: Run[] = layer.loops.map((loop) => {
      const placed = loop.map((point) => ({ x: image.x + point.x * scaleX, y: image.y + point.y * scaleY }))
      const points = smoothing > 0 ? fitSmoothNodes(placed, true, 70) : placed.map((point) => ({ anchor: point }))
      return { points, closed: true }
    })
    const world = networkFromRuns(runs)
    if (world.segments.length === 0) return []
    const geometry = normalizeWorld(world)
    const element: VectorElement = {
      ...createVectorElement('path', geometry, {
        name: layers.length > 1 ? `Trace ${index + 1}` : 'Trace',
        fill: layer.color,
        stroke: 'none',
        strokeWidth: 0,
        network: geometry.network,
      }),
    }
    const off = holeFaceKeys(computeFaces(worldNetwork(element)))
    return [off.length ? { ...element, regionsOff: off } : element]
  })
}
