import type { Bounds } from '@/vector/geometry'
import type { VectorElement } from '@/vector/types'
import { inkSelectionBounds } from '@/vector/ink'

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'
export type DistributeAxis = 'x' | 'y'
export type ElementPatch = { id: string; patch: Partial<VectorElement> }

/** Moves each element so its rotated bounding box lines up with `target` on `mode`. */
export function alignElements(elements: VectorElement[], mode: AlignMode, target: Bounds): ElementPatch[] {
  return elements.flatMap((element) => {
    const bounds = inkSelectionBounds([element])
    let dx = 0
    let dy = 0
    switch (mode) {
      case 'left': dx = target.x - bounds.x; break
      case 'centerX': dx = target.x + target.width / 2 - (bounds.x + bounds.width / 2); break
      case 'right': dx = target.x + target.width - (bounds.x + bounds.width); break
      case 'top': dy = target.y - bounds.y; break
      case 'centerY': dy = target.y + target.height / 2 - (bounds.y + bounds.height / 2); break
      case 'bottom': dy = target.y + target.height - (bounds.y + bounds.height); break
    }
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return []
    return [{ id: element.id, patch: { x: round(element.x + dx), y: round(element.y + dy) } }]
  })
}

/** Spaces three or more elements so the gaps between their bounding boxes are equal; outer elements stay put. */
export function distributeElements(elements: VectorElement[], axis: DistributeAxis): ElementPatch[] {
  if (elements.length < 3) return []
  const items = elements.map((element) => ({ element, bounds: inkSelectionBounds([element]) }))
  const start = axis === 'x' ? 'x' : 'y'
  const size = axis === 'x' ? 'width' : 'height'
  items.sort((a, b) => (a.bounds[start] + a.bounds[size] / 2) - (b.bounds[start] + b.bounds[size] / 2))
  const first = items[0]!
  const last = items[items.length - 1]!
  const total = last.bounds[start] + last.bounds[size] - first.bounds[start]
  const occupied = items.reduce((sum, item) => sum + item.bounds[size], 0)
  const gap = (total - occupied) / (items.length - 1)
  let cursor = first.bounds[start] + first.bounds[size] + gap
  const patches: ElementPatch[] = []
  for (const item of items.slice(1, -1)) {
    const delta = cursor - item.bounds[start]
    if (Math.abs(delta) > 1e-6) {
      patches.push({ id: item.element.id, patch: { [start]: round(item.element[start] + delta) } })
    }
    cursor += item.bounds[size] + gap
  }
  return patches
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
