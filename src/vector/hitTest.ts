import { HIT_TARGET_COARSE_PX, HIT_TARGET_PX } from '@/ui/hit-target'
import type { VectorElement } from '@/vector/types'

/** Screen-pixel width of the invisible outline that catches clicks on strokes and unfilled shapes. */
export function strokeHitWidth(strokeWidth: number, zoom: number, coarse = false): number {
  const minimum = (coarse ? HIT_TARGET_COARSE_PX : HIT_TARGET_PX) / 2
  return Math.max(strokeWidth * zoom, minimum)
}

/** Pointer-events value for the painted primitive: only filled shapes catch clicks on their interior. */
export function fillPointerEvents(element: Pick<VectorElement, 'fill' | 'locked' | 'visible'>): 'visiblePainted' | 'none' {
  if (element.locked || !element.visible || element.fill === 'none') return 'none'
  return 'visiblePainted'
}

/** Whether an element takes part in canvas hit testing at all. */
export function isHittable(element: Pick<VectorElement, 'locked' | 'visible' | 'kind'>): boolean {
  return element.visible && !element.locked && element.kind !== 'group'
}
