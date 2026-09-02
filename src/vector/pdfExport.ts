import { activeEffects } from '@/vector/effects'
import { localGeometry } from '@/vector/render'
import { fillsOf, strokesOf } from '@/vector/paints'
import { gradientCircle, gradientLine } from '@/vector/gradient'
import type { Run } from '@/vector/network'
import { pdfColor, pdfNumber, PdfWriter } from '@/vector/pdf'
import { outlineText } from '@/vector/textOutline'
import { leafElements } from '@/vector/tree'
import type { VectorDocument, VectorElement, VectorPaint, VectorPoint } from '@/vector/types'

export type PdfPage = { name: string; bounds: { x: number; y: number; width: number; height: number }; elements: VectorElement[] }

/** What the file could not say in vector terms, so the caller can be honest about it. */
export type PdfNotes = { rasterised: string[]; skipped: string[] }

type Resources = {
  states: Map<string, string>
  shadings: string[]
  images: string[]
  writer: PdfWriter
}

/** The pages an export covers: one per frame when the document has frames, else the page itself. */
export function pdfPages(document: VectorDocument, perFrame: boolean): PdfPage[] {
  const frames = document.elements.filter((element) => element.kind === 'frame' && element.visible)
  if (perFrame && frames.length > 0) {
    return frames.map((frame) => ({
      name: frame.name,
      bounds: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      elements: [frame, ...leafElements(document.elements, [frame.id])],
    }))
  }
  return [{
    name: document.name,
    bounds: { x: 0, y: 0, width: document.width, height: document.height },
    elements: document.elements,
  }]
}

/**
 * Writes the pages as a PDF.
 *
 * Shapes go in as paths, gradients as shadings, and anything the format cannot say — an effect, a
 * pattern, a mesh — is handed to `rasterise` and placed as an image. Text is drawn as outlines, so
 * no font has to be embedded; a text whose glyphs cannot be read is reported rather than dropped
 * silently.
 */
export async function exportPdf(
  pages: PdfPage[],
  options: { background?: string; rasterise?: (element: VectorElement) => Promise<{ data: Uint8Array; width: number; height: number } | null> } = {},
): Promise<{ bytes: Uint8Array; notes: PdfNotes }> {
  const writer = new PdfWriter()
  const catalog = writer.reserve()
  const pagesRef = writer.reserve()
  const notes: PdfNotes = { rasterised: [], skipped: [] }
  const pageRefs: number[] = []

  for (const page of pages) {
    const resources: Resources = { states: new Map(), shadings: [], images: [], writer }
    const content: string[] = []
    // PDF counts from the bottom left; the drawing counts from the top left.
    content.push('q', `1 0 0 -1 ${pdfNumber(-page.bounds.x)} ${pdfNumber(page.bounds.y + page.bounds.height)} cm`)
    if (options.background) {
      const [r, g, b] = pdfColor(options.background)
      content.push(`${pdfNumber(r)} ${pdfNumber(g)} ${pdfNumber(b)} rg`, `${pdfNumber(page.bounds.x)} ${pdfNumber(page.bounds.y)} ${pdfNumber(page.bounds.width)} ${pdfNumber(page.bounds.height)} re f`)
    }
    for (const element of page.elements) {
      if (!element.visible || element.kind === 'group' || element.kind === 'component' || element.kind === 'instance' || element.kind === 'frame') continue
      await drawElement(element, content, resources, notes, options.rasterise)
    }
    content.push('Q')

    const contentRef = writer.putStream({ dictionary: '', data: content.join('\n') })
    const pageRef = writer.reserve()
    const states = [...resources.states.entries()].map(([name, ref]) => `/${name} ${ref}`).join(' ')
    const resourceDictionary = [
      '/ProcSet [/PDF /ImageC]',
      states ? `/ExtGState << ${states} >>` : '',
      resources.shadings.length ? `/Shading << ${resources.shadings.join(' ')} >>` : '',
      resources.images.length ? `/XObject << ${resources.images.join(' ')} >>` : '',
    ].filter(Boolean).join(' ')
    writer.put(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${pdfNumber(page.bounds.width)} ${pdfNumber(page.bounds.height)}] /Resources << ${resourceDictionary} >> /Contents ${contentRef} 0 R >>`, pageRef)
    pageRefs.push(pageRef)
  }

  writer.put(`<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`, pagesRef)
  writer.put(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`, catalog)
  return { bytes: writer.build(catalog), notes }
}

async function drawElement(
  element: VectorElement,
  content: string[],
  resources: Resources,
  notes: PdfNotes,
  rasterise?: (element: VectorElement) => Promise<{ data: Uint8Array; width: number; height: number } | null>,
): Promise<void> {
  const fancy = activeEffects(element).length > 0
    || fillsOf(element).some((paint) => paint.type === 'pattern' || paint.type === 'mesh' || paint.type === 'image')
    || element.kind === 'image'
  if (fancy) {
    // Effects, patterns, meshes and pictures go in as a bitmap: the format has no words for them.
    const raster = rasterise ? await rasterise(element) : null
    if (raster) {
      placeImage(element, raster, content, resources)
      if (element.kind !== 'image') notes.rasterised.push(element.name)
      return
    }
    notes.skipped.push(element.name)
    return
  }
  if (element.kind === 'text') {
    const outlined = await outlineText(element)
    if (!outlined) {
      notes.skipped.push(element.name)
      return
    }
    await drawElement({ ...element, kind: 'path', rotation: 0, ...outlined, text: undefined }, content, resources, notes, rasterise)
    return
  }

  const geometry = localGeometry(element)
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  content.push('q')
  if (element.rotation) content.push(rotation(element.rotation, center))
  if (element.opacity < 1) content.push(`/${state(resources, element.opacity)} gs`)

  const fill = fillsOf(element).filter((paint) => paint.visible && paint.opacity > 0).at(-1)
  if (fill && geometry.fillRuns.length) {
    if (fill.type === 'solid' && fill.color && fill.color !== 'none') {
      const [r, g, b] = pdfColor(fill.color)
      content.push(...pathOperators(geometry.fillRuns), `${pdfNumber(r)} ${pdfNumber(g)} ${pdfNumber(b)} rg`, 'f*')
    } else if (fill.type === 'linear' || fill.type === 'radial') {
      // A shading paints through the shape rather than into it: clip, then fill the clip.
      content.push(...pathOperators(geometry.fillRuns), 'W* n', `/${shading(resources, fill, element)} sh`)
    }
  }

  const stroke = strokesOf(element).filter((paint) => paint.visible && paint.opacity > 0).at(-1)
  if (stroke?.type === 'solid' && stroke.color && stroke.color !== 'none' && element.strokeWidth > 0 && geometry.strokeRuns.length) {
    const [r, g, b] = pdfColor(stroke.color)
    content.push(
      ...pathOperators(geometry.strokeRuns),
      `${pdfNumber(r)} ${pdfNumber(g)} ${pdfNumber(b)} RG`,
      `${pdfNumber(element.strokeWidth)} w`,
      `${element.strokeCap === 'round' ? 1 : element.strokeCap === 'square' ? 2 : 0} J`,
      `${element.strokeJoin === 'round' ? 1 : element.strokeJoin === 'bevel' ? 2 : 0} j`,
      element.strokeDash ? `[${pdfNumber(element.strokeDash[0])} ${pdfNumber(element.strokeDash[1])}] 0 d` : '[] 0 d',
      'S',
    )
  }
  content.push('Q')
}

/** The runs as PDF path operators: `m` to start, `l` and `c` along, `h` to close. */
export function pathOperators(runs: Run[]): string[] {
  const operators: string[] = []
  for (const run of runs) {
    const points = run.points
    if (points.length < 2) continue
    operators.push(`${pdfNumber(points[0]!.anchor.x)} ${pdfNumber(points[0]!.anchor.y)} m`)
    const count = run.closed ? points.length : points.length - 1
    for (let index = 0; index < count; index += 1) {
      const from = points[index]!
      const to = points[(index + 1) % points.length]!
      if (from.out || to.in) {
        const a = from.out ?? from.anchor
        const b = to.in ?? to.anchor
        operators.push(`${pdfNumber(a.x)} ${pdfNumber(a.y)} ${pdfNumber(b.x)} ${pdfNumber(b.y)} ${pdfNumber(to.anchor.x)} ${pdfNumber(to.anchor.y)} c`)
      } else {
        operators.push(`${pdfNumber(to.anchor.x)} ${pdfNumber(to.anchor.y)} l`)
      }
    }
    if (run.closed) operators.push('h')
  }
  return operators
}

function rotation(degrees: number, center: VectorPoint): string {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const x = center.x - cos * center.x + sin * center.y
  const y = center.y - sin * center.x - cos * center.y
  return `${pdfNumber(cos)} ${pdfNumber(sin)} ${pdfNumber(-sin)} ${pdfNumber(cos)} ${pdfNumber(x)} ${pdfNumber(y)} cm`
}

function state(resources: Resources, opacity: number): string {
  const name = `GS${Math.round(opacity * 100)}`
  if (!resources.states.has(name)) {
    const ref = resources.writer.put(`<< /Type /ExtGState /ca ${pdfNumber(opacity)} /CA ${pdfNumber(opacity)} >>`)
    resources.states.set(name, `${ref} 0 R`)
  }
  return name
}

/** A gradient as a shading: type 2 along a line, type 3 between two circles. */
function shading(resources: Resources, paint: VectorPaint, element: VectorElement): string {
  const stops = paint.stops ?? []
  const functionRef = stitching(resources, stops)
  const name = `Sh${resources.shadings.length}`
  const coords = paint.type === 'linear'
    ? (() => {
        // The gradient is stated in the box's own fractions; the page wants document units.
        const line = gradientLine(paint)
        const from = { x: element.x + line.from.x * element.width, y: element.y + line.from.y * element.height }
        const to = { x: element.x + line.to.x * element.width, y: element.y + line.to.y * element.height }
        return `[${pdfNumber(from.x)} ${pdfNumber(from.y)} ${pdfNumber(to.x)} ${pdfNumber(to.y)}]`
      })()
    : (() => {
        const circle = gradientCircle(paint)
        const centre = { x: element.x + circle.center.x * element.width, y: element.y + circle.center.y * element.height }
        const radius = circle.radius * Math.max(element.width, element.height)
        return `[${pdfNumber(centre.x)} ${pdfNumber(centre.y)} 0 ${pdfNumber(centre.x)} ${pdfNumber(centre.y)} ${pdfNumber(radius)}]`
      })()
  const ref = resources.writer.put(`<< /ShadingType ${paint.type === 'linear' ? 2 : 3} /ColorSpace /DeviceRGB /Coords ${coords} /Function ${functionRef} 0 R /Extend [true true] >>`)
  resources.shadings.push(`/${name} ${ref} 0 R`)
  return name
}

/** One exponential function per pair of stops, stitched together over the whole run. */
function stitching(resources: Resources, stops: Array<{ t: number; color: string }>): number {
  const list = stops.length >= 2 ? stops : [{ t: 0, color: '#000000' }, { t: 1, color: '#FFFFFF' }]
  const pieces = list.slice(0, -1).map((stop, index) => {
    const next = list[index + 1]!
    const from = pdfColor(stop.color)
    const to = pdfColor(next.color)
    return resources.writer.put(`<< /FunctionType 2 /Domain [0 1] /C0 [${from.map(pdfNumber).join(' ')}] /C1 [${to.map(pdfNumber).join(' ')}] /N 1 >>`)
  })
  if (pieces.length === 1) return pieces[0]!
  const bounds = list.slice(1, -1).map((stop) => pdfNumber(stop.t)).join(' ')
  const encodeRanges = pieces.map(() => '0 1').join(' ')
  return resources.writer.put(`<< /FunctionType 3 /Domain [0 1] /Functions [${pieces.map((ref) => `${ref} 0 R`).join(' ')}] /Bounds [${bounds}] /Encode [${encodeRanges}] >>`)
}

function placeImage(element: VectorElement, raster: { data: Uint8Array; width: number; height: number }, content: string[], resources: Resources): void {
  const name = `Im${resources.images.length}`
  const ref = resources.writer.putStream({
    dictionary: `/Type /XObject /Subtype /Image /Width ${raster.width} /Height ${raster.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
    data: raster.data,
  })
  resources.images.push(`/${name} ${ref} 0 R`)
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  content.push('q')
  if (element.rotation) content.push(rotation(element.rotation, center))
  if (element.opacity < 1) content.push(`/${state(resources, element.opacity)} gs`)
  // The image is drawn into a unit square, flipped back the right way up.
  content.push(
    `${pdfNumber(element.width)} 0 0 ${pdfNumber(-element.height)} ${pdfNumber(element.x)} ${pdfNumber(element.y + element.height)} cm`,
    `/${name} Do`,
    'Q',
  )
}

