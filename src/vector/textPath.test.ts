import { describe, expect, it } from 'vitest'
import { pathBounds, pathDataOf, pathLength, placeOnPath, runFromPathData, sanitizeTextPath, syncTextPaths } from '@/vector/textPath'
import { createVectorElement } from '@/vector/document'
import type { VectorElement } from '@/vector/types'

const circle: VectorElement = { ...createVectorElement('ellipse', { x: 0, y: 0, width: 200, height: 200 }), id: 'circle' }
const text: VectorElement = {
  ...createVectorElement('text', { x: 0, y: 0, width: 100, height: 20 }, { text: 'Hello' }),
  id: 'text',
  textPath: { elementId: 'circle', offset: 0, side: 'above', align: 'left' },
}

describe('reading a path off an object', () => {
  it('takes the first chain of the outline', () => {
    expect(pathDataOf(circle).startsWith('M ')).toBe(true)
    expect(pathDataOf({ ...createVectorElement('group', { x: 0, y: 0, width: 10, height: 10 }) })).toBe('')
  })

  it('reports the box the outline occupies', () => {
    const box = pathBounds(circle)!

    expect(Math.round(box.width)).toBe(200)
    expect(Math.round(box.height)).toBe(200)
  })
})

describe('keeping an attached text in step', () => {
  it('copies the path onto the text and takes its box', () => {
    const [, attached] = syncTextPaths([circle, text])

    expect(attached!.textPath!.d).toBe(pathDataOf(circle))
    expect(Math.round(attached!.width)).toBe(200)
  })

  it('follows the object when it moves', () => {
    const [moved, attached] = syncTextPaths([{ ...circle, x: 300 }, text])

    expect(attached!.textPath!.d).toBe(pathDataOf(moved!))
    expect(attached!.textPath!.d).not.toBe(pathDataOf(circle))
  })

  it('leaves the text with the shape it had when the object is gone', () => {
    const carried = { ...text, textPath: { ...text.textPath!, d: 'M 0 0 L 10 0' } }

    expect(syncTextPaths([carried])[0]!.textPath!.d).toBe('M 0 0 L 10 0')
  })

  it('does nothing at all when no text is attached', () => {
    const elements = [circle]

    expect(syncTextPaths(elements)).toBe(elements)
  })
})

describe('placing a glyph along a path', () => {
  const line = { points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false }

  it('walks the given distance and reports the angle there', () => {
    const place = placeOnPath(line, 40)!

    expect(place.point.x).toBeCloseTo(40, 1)
    expect(place.angle).toBeCloseTo(0, 1)
  })

  it('turns with the path', () => {
    const down = { points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 100 } }], closed: false }

    expect(placeOnPath(down, 50)!.angle).toBeCloseTo(90, 1)
  })

  it('stays on the path past its ends', () => {
    expect(placeOnPath(line, 1000)!.point.x).toBeCloseTo(100, 1)
    expect(placeOnPath(line, -50)!.point.x).toBeCloseTo(0, 1)
  })

  it('keeps a constant distance from the centre of a circle', () => {
    const run = runFromPathData(pathDataOf(circle))!
    const total = pathLength(run)
    const radii = [0, 0.1, 0.25, 0.4, 0.6, 0.9].map((fraction) => {
      const place = placeOnPath(run, total * fraction)!
      return Math.hypot(place.point.x - 100, place.point.y - 100)
    })

    // Every glyph on a circle sits the same distance from its centre, within the sampling error.
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1)
  })
})

describe('reading back the path data', () => {
  it('reads the lines and curves this module writes', () => {
    const run = runFromPathData('M 0 0 L 10 0 C 15 0 20 5 20 10 Z')!

    expect(run.closed).toBe(true)
    expect(run.points.map((point) => point.anchor)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }])
    expect(run.points[1]!.out).toEqual({ x: 15, y: 0 })
  })

  it('gives up on what it cannot read', () => {
    expect(runFromPathData('')).toBeNull()
    expect(runFromPathData('M 0 0')).toBeNull()
  })
})

describe('sanitising an attachment', () => {
  it('keeps what it understands and clamps the offset', () => {
    expect(sanitizeTextPath({ elementId: 'a', offset: 4, side: 'below', align: 'center' })).toEqual({ elementId: 'a', offset: 1, side: 'below', align: 'center' })
  })

  it('needs an object to attach to', () => {
    expect(sanitizeTextPath({ offset: 0.5 })).toBeUndefined()
    expect(sanitizeTextPath(null)).toBeUndefined()
  })
})
