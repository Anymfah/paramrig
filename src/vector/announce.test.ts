import { describe, expect, it } from 'vitest'
import { nodeAnnouncement, selectionAnnouncement, toolAnnouncement } from '@/vector/announce'
import { createVectorElement } from '@/vector/document'

const rect = { ...createVectorElement('rectangle', { x: 100, y: 100, width: 200, height: 120 }), id: 'a', name: 'Rectangle' }
const other = { ...createVectorElement('ellipse', { x: 0, y: 0, width: 40, height: 40 }), id: 'b', name: 'Ellipse' }

describe('what the canvas announces', () => {
  it('reads one object with its size and its place', () => {
    expect(selectionAnnouncement([rect], ['a'])).toBe('Rectangle, 200 × 120 at 100, 100')
  })

  it('counts a bigger selection instead of listing it', () => {
    expect(selectionAnnouncement([rect, other], ['a', 'b'])).toBe('2 objects selected')
  })

  it('says so when nothing is selected', () => {
    expect(selectionAnnouncement([rect], [])).toBe('Nothing selected')
    expect(selectionAnnouncement([rect], ['gone'])).toBe('Nothing selected')
  })

  it('rounds to whole pixels, which is what a reader wants to hear', () => {
    expect(selectionAnnouncement([{ ...rect, x: 10.4, width: 33.6 }], ['a'])).toBe('Rectangle, 34 × 120 at 10, 100')
  })

  it('counts nodes and names tools', () => {
    expect(nodeAnnouncement(0)).toBe('No node selected')
    expect(nodeAnnouncement(1)).toBe('1 node selected')
    expect(nodeAnnouncement(4)).toBe('4 nodes selected')
    expect(toolAnnouncement('pen')).toBe('Pen tool')
    expect(toolAnnouncement('measure')).toBe('Measure tool')
  })
})
