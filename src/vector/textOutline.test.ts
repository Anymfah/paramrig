import { describe, expect, it } from 'vitest'
import { commandsToRuns } from '@/vector/textOutline'

describe('glyph commands', () => {
  it('turns a closed straight contour into one run', () => {
    const runs = commandsToRuns([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 10, y: 0 },
      { type: 'L', x: 10, y: 10 },
      { type: 'Z' },
    ])

    expect(runs).toHaveLength(1)
    expect(runs[0]!.closed).toBe(true)
    expect(runs[0]!.points.map((point) => point.anchor)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
  })

  it('keeps a counter as its own run', () => {
    const runs = commandsToRuns([
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: 20, y: 0 }, { type: 'L', x: 20, y: 20 }, { type: 'Z' },
      { type: 'M', x: 5, y: 5 }, { type: 'L', x: 10, y: 5 }, { type: 'L', x: 10, y: 10 }, { type: 'Z' },
    ])

    expect(runs).toHaveLength(2)
    expect(runs[1]!.points[0]!.anchor).toEqual({ x: 5, y: 5 })
  })

  it('raises a quadratic to the equivalent cubic handles', () => {
    const runs = commandsToRuns([
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x: 30, y: 0, x1: 15, y1: 30 },
      { type: 'Z' },
    ])

    expect(runs[0]!.points[0]!.out).toEqual({ x: 10, y: 20 })
    expect(runs[0]!.points[1]!.in).toEqual({ x: 20, y: 20 })
  })

  it('keeps cubic handles as they come', () => {
    const runs = commandsToRuns([
      { type: 'M', x: 0, y: 0 },
      { type: 'C', x: 30, y: 0, x1: 5, y1: 10, x2: 25, y2: 10 },
      { type: 'Z' },
    ])

    expect(runs[0]!.points[0]!.out).toEqual({ x: 5, y: 10 })
    expect(runs[0]!.points[1]!.in).toEqual({ x: 25, y: 10 })
  })

  it('drops a contour with nothing in it', () => {
    expect(commandsToRuns([{ type: 'M', x: 0, y: 0 }, { type: 'Z' }])).toEqual([])
    expect(commandsToRuns([{ type: 'L', x: 5, y: 5 }])).toEqual([])
  })
})
