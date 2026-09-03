import { describe, expect, it } from 'vitest'
import { HANDLE_GLYPH_PX, handleRadii, hitLayerOf, layerRank, pickHit } from '@/vector/hitPriority'

const node = (attributes: Record<string, string>) => ({
  attributes,
  getAttribute: (name: string) => attributes[name] ?? null,
})

describe('reading the layer of a hit', () => {
  it('names each of the canvas layers', () => {
    expect(hitLayerOf(node({ 'data-vector-rotate': 'nw' }))).toBe('rotate')
    expect(hitLayerOf(node({ 'data-vector-handle': 'se' }))).toBe('handle')
    expect(hitLayerOf(node({ 'data-vector-handle': 'pivot' }))).toBe('pivot')
    expect(hitLayerOf(node({ 'data-vector-node': 'n1' }))).toBe('node')
    expect(hitLayerOf(node({ 'data-vector-control': 's1:a' }))).toBe('control')
    expect(hitLayerOf(node({ 'data-vector-segment': 's1' }))).toBe('segment')
    expect(hitLayerOf(node({ 'data-vector-element': 'e1' }))).toBe('element')
    expect(hitLayerOf(node({ 'data-vector-guide': 'g1' }))).toBe('guide')
    expect(hitLayerOf(node({ class: 'vector-artboard' }))).toBeNull()
    expect(hitLayerOf(null)).toBeNull()
  })
})

describe('who takes the click', () => {
  it('follows the stated order, most specific first', () => {
    expect(layerRank('handle')).toBeLessThan(layerRank('pivot'))
    expect(layerRank('pivot')).toBeLessThan(layerRank('node'))
    expect(layerRank('node')).toBeLessThan(layerRank('control'))
    expect(layerRank('control')).toBeLessThan(layerRank('segment'))
    expect(layerRank('segment')).toBeLessThan(layerRank('element'))
    expect(layerRank('element')).toBeLessThan(layerRank('guide'))
    expect(layerRank('guide')).toBeLessThan(layerRank('canvas'))
  })

  it('picks the handle over the object it belongs to', () => {
    const winner = pickHit([node({ 'data-vector-element': 'e1' }), node({ 'data-vector-handle': 'se' })])

    expect(winner!.attributes['data-vector-handle']).toBe('se')
  })

  it('picks a node over the segment it sits on', () => {
    const winner = pickHit([node({ 'data-vector-segment': 's1' }), node({ 'data-vector-node': 'n1' })])

    expect(winner!.attributes['data-vector-node']).toBe('n1')
  })

  it('picks the pivot over a node and a rotate zone over both', () => {
    expect(pickHit([node({ 'data-vector-node': 'n1' }), node({ 'data-vector-handle': 'pivot' })])!.attributes['data-vector-handle']).toBe('pivot')
    expect(pickHit([node({ 'data-vector-handle': 'pivot' }), node({ 'data-vector-rotate': 'nw' })])!.attributes['data-vector-rotate']).toBe('nw')
  })

  it('ignores what belongs to no layer, and gives up when nothing does', () => {
    expect(pickHit([node({ class: 'vector-artboard' })])).toBeNull()
    expect(pickHit([])).toBeNull()
  })
})

describe('handle sizes', () => {
  it('keep the same screen size whatever the zoom', () => {
    for (const zoom of [0.1, 1, 4, 16]) {
      const radii = handleRadii(zoom, false)

      expect(radii.hit * 2 * zoom).toBeCloseTo(32, 6)
      expect(radii.glyph * 2 * zoom).toBeCloseTo(HANDLE_GLYPH_PX, 6)
    }
  })

  it('grow for a finger', () => {
    expect(handleRadii(1, true).hit * 2).toBe(44)
  })
})
