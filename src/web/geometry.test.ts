import { expect, it } from 'vitest'
import { markPoints, pathForMark, storedPoint } from './geometry'
import type { WebMark, WebTarget } from './contracts'
const target: WebTarget = { key: 'id:title:', label: 'Title', selector: 'h1', fingerprint: 'h1', pageId: 'home', tag: 'h1', rect: { x: 100, y: 200, width: 200, height: 80 }, ancestors: [], status: 'resolved' }
const mark: WebMark = { id: 'mark', pageId: 'home', tool: 'rectangle', width: 2, color: '#ff0000', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], targetKey: target.key, viewport: { width: 1440, height: 900 } }
it('round-trips element coordinates independently from document scroll', () => {
  expect(storedPoint({ x: 200, y: 240 }, target, { x: 0, y: 800 })).toEqual({ x: .5, y: .5 })
  expect(markPoints(mark, [target], { x: 0, y: 800 })).toEqual([{ x: 100, y: 200 }, { x: 300, y: 280 }])
})
it('follows element resizing and nested scrolling through its live bounding box', () => {
  const moved = { ...target, rect: { x: 50, y: 20, width: 100, height: 40 } }
  expect(markPoints(mark, [moved], { x: 0, y: 0 })).toEqual([{ x: 50, y: 20 }, { x: 150, y: 60 }])
})
it('preserves page anchors and hides missing or ambiguous element anchors', () => {
  expect(markPoints({ ...mark, targetKey: undefined, points: [{ x: 100, y: 500 }] }, [], { x: 0, y: 300 })).toEqual([{ x: 100, y: 200 }])
  expect(markPoints(mark, [{ ...target, status: 'missing' }], { x: 0, y: 0 })).toBeNull()
  expect(markPoints(mark, [{ ...target, status: 'ambiguous' }], { x: 0, y: 0 })).toBeNull()
})
it('builds an arrow with a head and normalizes a rectangle drawn backwards', () => {
  expect(pathForMark(mark, [{ x: 300, y: 280 }, { x: 100, y: 200 }])).toBe('M100,200h200v80h-200Z')
  expect(pathForMark({ ...mark, tool: 'arrow' }, [{ x: 0, y: 0 }, { x: 30, y: 30 }])).toContain('L30,30M')
})
