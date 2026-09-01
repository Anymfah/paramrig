import type { VectorGuide, VectorPoint } from '@/vector/types'

const MAX_GUIDES = 200
const MAX_POSITION = 100000

export function sanitizeGuides(value: unknown): VectorGuide[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const guides: VectorGuide[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const source = candidate as Partial<VectorGuide>
    if (typeof source.id !== 'string' || !source.id || seen.has(source.id)) continue
    if (source.axis !== 'x' && source.axis !== 'y') continue
    if (typeof source.position !== 'number' || !Number.isFinite(source.position) || Math.abs(source.position) > MAX_POSITION) continue
    seen.add(source.id)
    guides.push({ id: source.id, axis: source.axis, position: round(source.position) })
    if (guides.length >= MAX_GUIDES) break
  }
  return guides
}

export function createGuide(axis: VectorGuide['axis'], position: number): VectorGuide {
  return { id: crypto.randomUUID(), axis, position: round(position) }
}

export function addGuide(guides: VectorGuide[], guide: VectorGuide): VectorGuide[] {
  if (guides.length >= MAX_GUIDES) return guides
  return [...guides, guide]
}

export function moveGuide(guides: VectorGuide[], id: string, position: number): VectorGuide[] {
  return guides.map((guide) => guide.id === id ? { ...guide, position: round(position) } : guide)
}

export function removeGuide(guides: VectorGuide[], id: string): VectorGuide[] {
  return guides.filter((guide) => guide.id !== id)
}

/** The nearest guide within `threshold` document units of a point, if any. */
export function guideAtPoint(guides: VectorGuide[], point: VectorPoint, threshold: number): VectorGuide | null {
  let best: VectorGuide | null = null
  let bestDistance = threshold
  for (const guide of guides) {
    const distance = Math.abs((guide.axis === 'x' ? point.x : point.y) - guide.position)
    if (distance <= bestDistance) {
      best = guide
      bestDistance = distance
    }
  }
  return best
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
