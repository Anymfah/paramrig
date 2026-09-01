import type { VectorElement } from '@/vector/types'

export type DirectResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export type DirectPoint = { x: number; y: number }

export function resizeElement(
  element: VectorElement,
  handle: DirectResizeHandle,
  pointer: DirectPoint,
  options: { lockRatio?: boolean; fromCenter?: boolean } = {},
): Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> {
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const local = rotatePoint(pointer, center, -element.rotation)
  const affectsX = handle.includes('e') || handle.includes('w')
  const affectsY = handle.includes('n') || handle.includes('s')
  let left = element.x
  let right = element.x + element.width
  let top = element.y
  let bottom = element.y + element.height

  if (options.fromCenter) {
    if (affectsX) {
      const halfWidth = Math.max(0.5, Math.abs(local.x - center.x))
      left = center.x - halfWidth
      right = center.x + halfWidth
    }
    if (affectsY) {
      const halfHeight = Math.max(0.5, Math.abs(local.y - center.y))
      top = center.y - halfHeight
      bottom = center.y + halfHeight
    }
  } else {
    if (handle.includes('w')) left = Math.min(local.x, right - 1)
    if (handle.includes('e')) right = Math.max(local.x, left + 1)
    if (handle.includes('n')) top = Math.min(local.y, bottom - 1)
    if (handle.includes('s')) bottom = Math.max(local.y, top + 1)
  }

  if (options.lockRatio) {
    const ratio = element.width / Math.max(1, element.height)
    let width = right - left
    let height = bottom - top
    if (affectsX && !affectsY) height = width / ratio
    else if (!affectsX && affectsY) width = height * ratio
    else if (width / height > ratio) height = width / ratio
    else width = height * ratio

    if (options.fromCenter || !affectsX) {
      left = center.x - width / 2
      right = center.x + width / 2
    } else if (handle.includes('w')) left = right - width
    else right = left + width

    if (options.fromCenter || !affectsY) {
      top = center.y - height / 2
      bottom = center.y + height / 2
    } else if (handle.includes('n')) top = bottom - height
    else bottom = top + height
  }

  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const localCenter = { x: left + width / 2, y: top + height / 2 }
  const worldCenter = rotatePoint(localCenter, center, element.rotation)
  return {
    x: round(worldCenter.x - width / 2),
    y: round(worldCenter.y - height / 2),
    width: round(width),
    height: round(height),
  }
}

export function resizeCursor(handle: DirectResizeHandle, rotation: number): string {
  const baseAngle: Record<DirectResizeHandle, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 }
  const direction = ((Math.round((baseAngle[handle] + rotation) / 45) % 8) + 8) % 8
  if (direction === 0 || direction === 4) return 'ew-resize'
  if (direction === 1 || direction === 5) return 'nwse-resize'
  if (direction === 2 || direction === 6) return 'ns-resize'
  return 'nesw-resize'
}

export function rotatePoint(value: DirectPoint, center: DirectPoint, degrees: number): DirectPoint {
  const radians = degrees * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = value.x - center.x
  const dy = value.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** Resizes a plain box (used for multi-selection and group frames). */
export function resizeBounds(
  bounds: { x: number; y: number; width: number; height: number },
  handle: DirectResizeHandle,
  pointer: DirectPoint,
  options: { lockRatio?: boolean; fromCenter?: boolean } = {},
): { x: number; y: number; width: number; height: number } {
  return resizeElement({ ...bounds, rotation: 0 } as VectorElement, handle, pointer, options)
}
