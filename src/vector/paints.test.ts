import { describe, expect, it } from 'vitest'
import { fillsOf, fillsPatch, hasVisiblePaint, sanitizePaints, solidPaint, strokesPatch, summaryColor } from '@/vector/paints'
import { cornerRadii, rectangleNodes, roundCorners } from '@/vector/corners'

describe('paint layers', () => {
  it('synthesises a layer from the legacy colour and summarises lists back', () => {
    expect(fillsOf({ fill: '#112233' })).toEqual([{ id: 'fill', type: 'solid', color: '#112233', opacity: 1, visible: true }])
    expect(fillsOf({ fill: 'none' })).toEqual([])
    const stacked = [solidPaint('#000000', 'a'), { ...solidPaint('#FF0000', 'b'), opacity: 0.5 }]
    expect(summaryColor(stacked)).toBe('#FF0000')
    expect(fillsPatch(stacked)).toEqual({ fill: '#FF0000', fills: stacked })
    expect(fillsPatch([solidPaint('#ABCDEF', 'x')])).toEqual({ fill: '#ABCDEF', fills: undefined })
    expect(strokesPatch([])).toEqual({ stroke: 'none', strokes: [] })
    expect(hasVisiblePaint([{ ...solidPaint('#000000'), visible: false }])).toBe(false)
  })

  it('sanitises paints and rejects broken gradients and oversized images', () => {
    const result = sanitizePaints([
      { id: 'a', type: 'solid', color: '#abcdef', opacity: 2 },
      { id: 'b', type: 'linear', stops: [{ t: 0, color: '#000000' }], angle: 45 },
      { id: 'c', type: 'linear', stops: [{ t: 1, color: '#ffffff' }, { t: 0, color: '#000000' }], angle: 405 },
      { id: 'd', type: 'image', image: 'http://evil' },
      { id: 'e', type: 'image', image: 'data:image/png;base64,AAAA', imageMode: 'tile' },
      'junk',
    ])!
    expect(result.map((paint) => paint.id)).toEqual(['a', 'c', 'e'])
    expect(result[0]).toMatchObject({ color: '#ABCDEF', opacity: 1 })
    expect(result[1]).toMatchObject({ angle: 45, stops: [{ t: 0, color: '#000000' }, { t: 1, color: '#FFFFFF' }] })
    expect(result[2]).toMatchObject({ imageMode: 'tile' })
    expect(sanitizePaints(undefined)).toBeUndefined()
  })
})

describe('corner radius', () => {
  it('clamps radii to half the shortest side and expands them into arcs', () => {
    expect(cornerRadii({ cornerRadius: 80, width: 100, height: 60 })).toEqual([30, 30, 30, 30])
    expect(cornerRadii({ cornerRadius: [10, 0, 5, 0], width: 100, height: 60 })).toEqual([10, 0, 5, 0])
    const nodes = rectangleNodes({ x: 0, y: 0, width: 100, height: 60, cornerRadius: 10 })
    expect(nodes).toHaveLength(8)
    expect(nodes[0]!.anchor).toEqual({ x: 0, y: 10 })
    expect(nodes[1]!.anchor).toEqual({ x: 10, y: 0 })
    expect(nodes[0]!.out!.y).toBeCloseTo(10 - 10 * 0.5522847498)
    const plain = rectangleNodes({ x: 0, y: 0, width: 100, height: 60 })
    expect(plain).toHaveLength(4)
    expect(plain[0]).toEqual({ anchor: { x: 0, y: 0 } })
  })

  it('rounds only corner nodes with a radius and leaves open ends alone', () => {
    const nodes = roundCorners([{ anchor: { x: 0, y: 0 }, radius: 10 }, { anchor: { x: 100, y: 0 }, radius: 10 }, { anchor: { x: 100, y: 100 } }], false)
    expect(nodes).toHaveLength(4)
    expect(nodes[0]).toEqual({ anchor: { x: 0, y: 0 } })
    expect(nodes[1]!.anchor).toEqual({ x: 90, y: 0 })
    expect(nodes[2]!.anchor).toEqual({ x: 100, y: 10 })
    const smooth = rectangleNodes({ x: 0, y: 0, width: 100, height: 100, cornerRadius: 20, cornerSmoothing: 1 })
    expect(smooth[0]!.anchor.y).toBeGreaterThan(20)
  })
})
