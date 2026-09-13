import { syncBooleanGroups } from './booleanGroups'
import { fontCapabilities } from './fontCapabilities'
import type { ParamValue } from '@paramrig/core'
import type { VectorDocument } from './types'
import type { VectorResources } from './resources'
import { resolveRigValues } from './rig'
import { createFontLoader } from './fontRuntime'
import { TEXT_FACES } from './text'
import { embedFonts, exportMarkup, rasterize, type ExportSettings, type ExportSelection } from './exportRuntime'

export type VectorRendererOptions = {
  container: HTMLElement
  document: VectorDocument
  values?: Record<string, ParamValue>
  resources?: VectorResources
}

/** An SVG view with explicit resource ownership; no React, editor tools or storage. */
export function createVectorRenderer(options: VectorRendererOptions) {
  const host = document.createElement('div')
  host.style.cssText = 'width:100%;height:100%;overflow:hidden'
  options.container.append(host)
  const fonts = createFontLoader(options.resources?.font)
  let source = options.document
  let values = options.values ?? {}
  let rendered: VectorDocument | null = null
  let abort = new AbortController()
  let generation = 0
  let destroyed = false
  const selection: ExportSelection = { frameId: null, selectedIds: [] }
  const settings: ExportSettings = { target: 'document', format: 'svg', scale: 1, transparent: false }

  const performUpdate = async (next = source, nextValues = values): Promise<void> => {
    if (destroyed) throw new Error('This vector renderer has been destroyed.')
    source = next; values = nextValues
    abort.abort(); abort = new AbortController()
    const signal = abort.signal, ticket = ++generation
    const candidate = structuredClone(resolveRigValues(source, values))
    candidate.elements = syncBooleanGroups(candidate.elements)
    if (options.resources?.image) {
      await Promise.all(candidate.elements.map(async element => {
        if (!element.image || element.image.startsWith('data:')) return
        const image = await options.resources!.image!(element.image, signal)
        if (!image?.startsWith('data:image/')) throw new Error(`Image is unavailable: ${element.image}`)
        element.image = image
      }))
    }
    const carried = candidate.fonts ?? []
    const families = new Set(candidate.elements.filter(element => element.kind === 'text').map(element => element.fontFamily ?? 'Public Sans'))
    const shipped = TEXT_FACES.filter(face => face.webFont && families.has(face.value) && !carried.some(font => font.family === face.value))
      .map(face => ({ family: face.value, source: 'system' as const, weights: face.weights ?? [400], axes: fontCapabilities(face.value).axes }))
    await fonts.ensureFonts([...carried, ...shipped])
    if (destroyed || ticket !== generation) return
    const markup = exportMarkup(candidate, settings, selection)
    if (!markup) throw new Error('The vector document has no exportable bounds.')
    // The engine serializes and escapes document content; no host markup is interpolated.
    host.innerHTML = markup
    const svg = host.querySelector('svg')
    svg?.setAttribute('width', '100%'); svg?.setAttribute('height', '100%')
    rendered = candidate
  }
  let ready: Promise<void>
  const update = (next = source, nextValues = values) => (ready = performUpdate(next, nextValues))
  ready = update()
  void ready.catch(() => {})
  return {
    get ready() { return ready }, update,
    async exportSvg(): Promise<string> {
      await ready
      if (destroyed || !rendered) throw new Error('The vector renderer is unavailable.')
      const markup = exportMarkup(rendered, settings, selection)!
      return embedFonts(markup, rendered.fonts, true, options.resources?.font)
    },
    async exportPng(scale = 1): Promise<Blob> {
      const markup = await this.exportSvg()
      const result = await rasterize(markup, { x: 0, y: 0, width: rendered!.width, height: rendered!.height }, scale, 'image/png', rendered!.colorSpace)
      if (!result) throw new Error('The browser could not rasterize this document.')
      return result
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true; generation++; abort.abort(); fonts.destroy(); host.remove(); rendered = null
    },
  }
}

export type VectorRenderer = ReturnType<typeof createVectorRenderer>
