import type { VectorElement, VectorGradientStop, VectorPaint } from '@/vector/types'

export const MAX_PAINTS = 8
export const MAX_IMAGE_BYTES = 512 * 1024

export function solidPaint(color: string, id: string = crypto.randomUUID()): VectorPaint {
  return { id, type: 'solid', color, opacity: 1, visible: true }
}

export function defaultStops(color: string): VectorGradientStop[] {
  return [{ t: 0, color }, { t: 1, color: color === '#FFFFFF' ? '#000000' : '#FFFFFF' }]
}

/** Fill layers of an element, synthesised from the legacy `fill` when the list is absent. */
export function fillsOf(element: Pick<VectorElement, 'fill' | 'fills'>): VectorPaint[] {
  if (element.fills) return element.fills
  return element.fill === 'none' ? [] : [solidPaint(element.fill, 'fill')]
}

export function strokesOf(element: Pick<VectorElement, 'stroke' | 'strokes'>): VectorPaint[] {
  if (element.strokes) return element.strokes
  return element.stroke === 'none' ? [] : [solidPaint(element.stroke, 'stroke')]
}

/** The legacy summary colour for a paint list: the topmost visible solid colour, else `'none'`. */
export function summaryColor(paints: VectorPaint[]): string {
  for (let index = paints.length - 1; index >= 0; index -= 1) {
    const paint = paints[index]!
    if (!paint.visible) continue
    if (paint.type === 'solid' && paint.color) return paint.color
    if ((paint.type === 'linear' || paint.type === 'radial') && paint.stops?.length) return paint.stops[0]!.color
    if (paint.type === 'image') return '#808080'
  }
  return 'none'
}

/** Element patch that stores a fill list and keeps the `fill` summary in sync. */
export function fillsPatch(paints: VectorPaint[]): Pick<VectorElement, 'fill' | 'fills'> {
  return { fill: summaryColor(paints), fills: paints.length === 1 && isPlainSolid(paints[0]!) ? undefined : paints }
}

export function strokesPatch(paints: VectorPaint[]): Pick<VectorElement, 'stroke' | 'strokes'> {
  return { stroke: summaryColor(paints), strokes: paints.length === 1 && isPlainSolid(paints[0]!) ? undefined : paints }
}

function isPlainSolid(paint: VectorPaint): boolean {
  return paint.type === 'solid' && paint.opacity === 1 && paint.visible
}

/** Whether any layer paints anything. */
export function hasVisiblePaint(paints: VectorPaint[]): boolean {
  return paints.some((paint) => paint.visible && paint.opacity > 0 && (paint.type !== 'solid' || (paint.color && paint.color !== 'none')))
}

export function sanitizePaints(value: unknown): VectorPaint[] | undefined {
  if (!Array.isArray(value)) return undefined
  const paints: VectorPaint[] = []
  for (const candidate of value.slice(0, MAX_PAINTS)) {
    if (!candidate || typeof candidate !== 'object') continue
    const source = candidate as Partial<VectorPaint>
    if (typeof source.id !== 'string' || !source.id) continue
    const type = source.type === 'linear' || source.type === 'radial' || source.type === 'image' ? source.type : 'solid'
    const opacity = typeof source.opacity === 'number' && Number.isFinite(source.opacity) ? Math.min(1, Math.max(0, source.opacity)) : 1
    const paint: VectorPaint = { id: source.id, type, opacity, visible: source.visible !== false }
    if (type === 'solid') {
      if (typeof source.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(source.color)) continue
      paint.color = source.color.toUpperCase()
    } else if (type === 'image') {
      if (typeof source.image !== 'string' || !source.image.startsWith('data:image/') || source.image.length > MAX_IMAGE_BYTES * 1.4) continue
      paint.image = source.image
      paint.imageMode = source.imageMode === 'fit' || source.imageMode === 'tile' ? source.imageMode : 'fill'
    } else {
      const stops = Array.isArray(source.stops) ? source.stops.flatMap((stop) => {
        if (!stop || typeof stop !== 'object') return []
        const item = stop as Partial<VectorGradientStop>
        if (typeof item.t !== 'number' || !Number.isFinite(item.t) || typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) return []
        return [{ t: Math.min(1, Math.max(0, item.t)), color: item.color.toUpperCase() }]
      }).sort((a, b) => a.t - b.t).slice(0, 8) : []
      if (stops.length < 2) continue
      paint.stops = stops
      if (type === 'linear') paint.angle = typeof source.angle === 'number' && Number.isFinite(source.angle) ? ((source.angle % 360) + 360) % 360 : 0
    }
    paints.push(paint)
  }
  return paints.length ? paints : []
}
