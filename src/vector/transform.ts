import type { VectorElement } from '@/vector/types'

export type VectorTransformMode = 'move' | 'rotate' | 'scale'
export type VectorTransformAxis = 'x' | 'y' | null
export type VectorPoint = { x: number; y: number }

export function transformElement(
  mode: VectorTransformMode,
  axis: VectorTransformAxis,
  element: VectorElement,
  start: VectorPoint,
  current: VectorPoint,
): Partial<VectorElement> {
  if (mode === 'move') {
    const dx = axis === 'y' ? 0 : current.x - start.x
    const dy = axis === 'x' ? 0 : current.y - start.y
    return { x: round(element.x + dx), y: round(element.y + dy) }
  }

  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  if (mode === 'rotate') {
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
    const currentAngle = Math.atan2(current.y - center.y, current.x - center.x)
    let delta = currentAngle - startAngle
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2
    return { rotation: round(element.rotation + delta * 180 / Math.PI) }
  }

  const startVector = { x: start.x - center.x, y: start.y - center.y }
  const currentVector = { x: current.x - center.x, y: current.y - center.y }
  const factor = scaleFactor(axis, element, startVector, currentVector)
  const width = axis === 'y' ? element.width : Math.max(1, element.width * factor)
  const height = axis === 'x' ? element.height : Math.max(1, element.height * factor)
  return {
    x: round(center.x - width / 2),
    y: round(center.y - height / 2),
    width: round(width),
    height: round(height),
  }
}

export function transformElements(
  mode: VectorTransformMode,
  axis: VectorTransformAxis,
  elements: VectorElement[],
  start: VectorPoint,
  current: VectorPoint,
  origin?: VectorPoint,
): Array<{ id: string; patch: Partial<VectorElement> }> {
  if (elements.length === 1 && !origin) {
    const element = elements[0]!
    return [{ id: element.id, patch: transformElement(mode, axis, element, start, current) }]
  }
  const bounds = groupBounds(elements)
  const center = origin ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  if (mode === 'move') {
    const dx = axis === 'y' ? 0 : current.x - start.x
    const dy = axis === 'x' ? 0 : current.y - start.y
    return elements.map((element) => ({ id: element.id, patch: { x: round(element.x + dx), y: round(element.y + dy) } }))
  }
  if (mode === 'rotate') {
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
    const currentAngle = Math.atan2(current.y - center.y, current.x - center.x)
    let delta = currentAngle - startAngle
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2
    const cos = Math.cos(delta)
    const sin = Math.sin(delta)
    return elements.map((element) => {
      const elementCenter = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
      const dx = elementCenter.x - center.x
      const dy = elementCenter.y - center.y
      const nextCenter = { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
      return {
        id: element.id,
        patch: {
          x: round(nextCenter.x - element.width / 2),
          y: round(nextCenter.y - element.height / 2),
          rotation: round(element.rotation + delta * 180 / Math.PI),
        },
      }
    })
  }
  const startVector = { x: start.x - center.x, y: start.y - center.y }
  const currentVector = { x: current.x - center.x, y: current.y - center.y }
  const uniform = Math.max(0.01, Math.hypot(currentVector.x, currentVector.y) / Math.max(1, Math.hypot(startVector.x, startVector.y)))
  const factorX = axis === 'y' ? 1 : axis === 'x' ? ratio(currentVector.x, startVector.x, currentVector, startVector) : uniform
  const factorY = axis === 'x' ? 1 : axis === 'y' ? ratio(currentVector.y, startVector.y, currentVector, startVector) : uniform
  return elements.map((element) => {
    const elementCenter = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
    const width = Math.max(1, element.width * Math.abs(factorX))
    const height = Math.max(1, element.height * Math.abs(factorY))
    const nextCenter = {
      x: center.x + (elementCenter.x - center.x) * factorX,
      y: center.y + (elementCenter.y - center.y) * factorY,
    }
    return { id: element.id, patch: { x: round(nextCenter.x - width / 2), y: round(nextCenter.y - height / 2), width: round(width), height: round(height) } }
  })
}

function groupBounds(elements: VectorElement[]) {
  const left = Math.min(...elements.map((element) => element.x))
  const top = Math.min(...elements.map((element) => element.y))
  const right = Math.max(...elements.map((element) => element.x + element.width))
  const bottom = Math.max(...elements.map((element) => element.y + element.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function ratio(value: number, base: number, current: VectorPoint, start: VectorPoint): number {
  if (Math.abs(base) > 0.01) return Math.max(0.01, value / base)
  return Math.max(0.01, Math.hypot(current.x, current.y) / Math.max(1, Math.hypot(start.x, start.y)))
}

function scaleFactor(axis: VectorTransformAxis, element: VectorElement, start: VectorPoint, current: VectorPoint): number {
  if (axis === 'x') {
    const denominator = Math.abs(start.x) > 0.01 ? start.x : Math.max(1, element.width / 2)
    return Math.max(0.01, current.x / denominator)
  }
  if (axis === 'y') {
    const denominator = Math.abs(start.y) > 0.01 ? start.y : Math.max(1, element.height / 2)
    return Math.max(0.01, current.y / denominator)
  }
  const startDistance = Math.hypot(start.x, start.y)
  const currentDistance = Math.hypot(current.x, current.y)
  return Math.max(0.01, currentDistance / Math.max(1, startDistance))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Maps elements from one bounding box to another. Each element's axes are scaled by their
 * projection through the affine map, so rotated children keep their rotation and never shear.
 */
export function scaleElementsToBounds(
  elements: VectorElement[],
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
): Array<{ id: string; patch: Partial<VectorElement> }> {
  const sx = from.width > 0 ? to.width / from.width : 1
  const sy = from.height > 0 ? to.height / from.height : 1
  const map = (point: VectorPoint): VectorPoint => ({ x: to.x + (point.x - from.x) * sx, y: to.y + (point.y - from.y) * sy })
  return elements.map((element) => {
    const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
    const radians = element.rotation * Math.PI / 180
    const axisX = { x: Math.cos(radians), y: Math.sin(radians) }
    const axisY = { x: -Math.sin(radians), y: Math.cos(radians) }
    const mappedCenter = map(center)
    const right = map({ x: center.x + axisX.x * element.width / 2, y: center.y + axisX.y * element.width / 2 })
    const bottom = map({ x: center.x + axisY.x * element.height / 2, y: center.y + axisY.y * element.height / 2 })
    const width = Math.max(1, Math.hypot(right.x - mappedCenter.x, right.y - mappedCenter.y) * 2)
    const height = Math.max(1, Math.hypot(bottom.x - mappedCenter.x, bottom.y - mappedCenter.y) * 2)
    const rotation = element.rotation === 0 && sx > 0 && sy > 0 ? 0 : round(Math.atan2(right.y - mappedCenter.y, right.x - mappedCenter.x) * 180 / Math.PI)
    return {
      id: element.id,
      patch: {
        x: round(mappedCenter.x - width / 2),
        y: round(mappedCenter.y - height / 2),
        width: round(width),
        height: round(height),
        ...(rotation !== element.rotation ? { rotation } : {}),
      },
    }
  })
}
