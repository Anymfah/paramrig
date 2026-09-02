import { describe, expect, it } from 'vitest'
import { adjustmentPrimitives, backdropBlur, elementFilter, filterPrimitives } from '@/vector/filters'
import { createEffect } from '@/vector/effects'
import { createVectorElement } from '@/vector/document'
import { defsToSvg, renderModel } from '@/vector/render'
import type { VectorEffect } from '@/vector/types'

const shadow = (patch: Partial<VectorEffect> = {}): VectorEffect => ({ ...createEffect('dropShadow', 'e1'), ...patch })
const tags = (primitives: Array<{ tag: string }>) => primitives.map((primitive) => primitive.tag)

describe('building a filter chain', () => {
  it('drops a shadow behind the shape and merges it under the source', () => {
    const primitives = filterPrimitives([shadow({ dx: 2, dy: 4, blur: 8, spread: 0 })])

    expect(tags(primitives)).toEqual(['feOffset', 'feGaussianBlur', 'feFlood', 'feComposite', 'feMerge'])
    expect(primitives.at(-1)!.children!.map((node) => node.attrs.in)).toEqual(['f0s', 'SourceGraphic'])
    expect(primitives[1]!.attrs.stdDeviation).toBe(4)
  })

  it('fattens the shadow with a morphology when it has a spread', () => {
    expect(tags(filterPrimitives([shadow({ spread: 3 })]))[0]).toBe('feMorphology')
    expect(filterPrimitives([shadow({ spread: 3 })])[0]!.attrs).toMatchObject({ operator: 'dilate', radius: 3 })
    expect(filterPrimitives([shadow({ spread: -3 })])[0]!.attrs).toMatchObject({ operator: 'erode', radius: 3 })
  })

  it('cuts an inner shadow out of the shape and paints it on top', () => {
    const primitives = filterPrimitives([{ ...createEffect('innerShadow', 'i'), dx: 0, dy: 2, blur: 4, spread: 0 }])

    expect(tags(primitives)).toContain('feComposite')
    const cut = primitives.find((primitive) => primitive.attrs.operator === 'out')!
    expect(cut.attrs.in).toBe('SourceAlpha')
    expect(primitives.at(-1)!.children!.map((node) => node.attrs.in)).toEqual(['SourceGraphic', 'f0s'])
  })

  it('blurs the layer itself, and later effects work from the blurred result', () => {
    const primitives = filterPrimitives([{ ...createEffect('layerBlur', 'b'), blur: 10 }, shadow({ blur: 0, dx: 1, dy: 1, spread: 0 })])

    expect(primitives[0]!.attrs).toMatchObject({ in: 'SourceGraphic', stdDeviation: 5, result: 'f0' })
    expect(primitives.at(-1)!.children!.map((node) => node.attrs.in)).toEqual(['f1s', 'f0'])
  })

  it('leaves the background blur out: SVG has no backdrop to blur', () => {
    expect(filterPrimitives([{ ...createEffect('backgroundBlur', 'g'), blur: 12 }])).toEqual([])
    expect(backdropBlur({ effects: [{ ...createEffect('backgroundBlur', 'g'), blur: 12 }] })).toBe(12)
    expect(backdropBlur({ effects: [shadow()] })).toBe(0)
  })

  it('stacks several shadows in the order they are listed', () => {
    const primitives = filterPrimitives([shadow({ id: 'a', dy: 2 }), { ...shadow({ id: 'b', dy: 20 }), id: 'b' }])

    expect(primitives.at(-1)!.children!.map((node) => node.attrs.in)).toEqual(['f0s', 'f1s', 'SourceGraphic'])
  })
})

describe('picture corrections', () => {
  it('bends the ramp for the tone controls and names the last result', () => {
    const primitives = adjustmentPrimitives({ exposure: 0.2, saturation: 0.5 }, 'SourceGraphic', 'adj')

    expect(tags(primitives)).toEqual(['feComponentTransfer', 'feColorMatrix'])
    expect(primitives[0]!.children!.map((child) => child.tag)).toEqual(['feFuncR', 'feFuncG', 'feFuncB'])
    expect(primitives.at(-1)!.attrs).toMatchObject({ type: 'saturate', values: 1.5, result: 'adj' })
  })

  it('trades red against blue for the temperature', () => {
    const [matrix] = adjustmentPrimitives({ temperature: 1 }, 'SourceGraphic', 'adj')

    expect(String(matrix!.attrs.values).startsWith('1.25 0 0 0 0')).toBe(true)
  })

  it('returns nothing when every correction is at rest', () => {
    expect(adjustmentPrimitives({}, 'SourceGraphic', 'adj')).toEqual([])
  })
})

describe('the filter def on an element', () => {
  const element = { ...createVectorElement('rectangle', { x: 100, y: 100, width: 50, height: 50 }), id: 'r1' }

  it('sizes its region so the blur is not cut off', () => {
    const def = elementFilter({ ...element, effects: [shadow({ dx: 0, dy: 0, blur: 10, spread: 0 })] }, { x: 100, y: 100, width: 50, height: 50 }, 'f')

    expect(def).toMatchObject({ x: 85, y: 85, width: 80, height: 80 })
  })

  it('is absent when nothing needs filtering', () => {
    expect(elementFilter(element, element, 'f')).toBeNull()
    expect(elementFilter({ ...element, effects: [shadow({ visible: false })] }, element, 'f')).toBeNull()
  })

  it('reaches the render model, its defs and its markup', () => {
    const model = renderModel({ ...element, effects: [shadow()], blendMode: 'multiply' }, 'test')

    expect(model.filter).toBe('url(#test-r1-filter)')
    expect(model.blend).toBe('multiply')
    const markup = defsToSvg(model.defs)
    expect(markup).toContain('<filter id="test-r1-filter" filterUnits="userSpaceOnUse"')
    expect(markup).toContain('<feMerge><feMergeNode in="f0s"/><feMergeNode in="SourceGraphic"/></feMerge>')
  })

  it('changes the model as soon as an effect changes, cache or no cache', () => {
    const first = renderModel({ ...element, effects: [shadow({ blur: 4 })] }, 'cache')
    const second = renderModel({ ...element, effects: [shadow({ blur: 40 })] }, 'cache')

    expect(defsToSvg(first.defs)).not.toBe(defsToSvg(second.defs))
  })
})
