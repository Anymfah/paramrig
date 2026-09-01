import { describe, expect, it } from 'vitest'
import { createVectorDocument, createVectorElement, serializeVectorDocument } from '@/vector/document'
import { defsToSvg, layersToSvg, outlinePathData, renderModel } from '@/vector/render'
import { networkFromRuns, normalizeWorld } from '@/vector/network'
import type { VectorElement } from '@/vector/types'

const rect = (): VectorElement => createVectorElement('rectangle', { x: 10, y: 20, width: 100, height: 50 })

describe('render model', () => {
  it('paints stacked fills and strokes with per-layer opacity', () => {
    const element: VectorElement = {
      ...rect(),
      fills: [{ id: 'a', type: 'solid', color: '#112233', opacity: 1, visible: true }, { id: 'b', type: 'solid', color: '#FF0000', opacity: 0.5, visible: true }, { id: 'c', type: 'solid', color: '#00FF00', opacity: 1, visible: false }],
      strokeWidth: 4,
      strokes: [{ id: 's', type: 'solid', color: '#FFFFFF', opacity: 1, visible: true }],
      strokeCap: 'round',
      strokeDash: [6, 3],
    }
    const model = renderModel(element, 't')
    expect(model.layers.map((layer) => `${layer.kind}:${layer.paint}@${layer.opacity}`)).toEqual(['fill:#112233@1', 'fill:#FF0000@0.5', 'stroke:#FFFFFF@1'])
    expect(model.layers[2]).toMatchObject({ strokeWidth: 4, cap: 'round', dash: '6 3' })
    expect(model.defs).toEqual([])
  })

  it('emits gradient defs oriented by angle and references them', () => {
    const element: VectorElement = { ...rect(), fills: [{ id: 'g', type: 'linear', opacity: 1, visible: true, angle: 90, stops: [{ t: 0, color: '#000000' }, { t: 1, color: '#FFFFFF' }] }] }
    const model = renderModel(element, 't')
    expect(model.layers[0]!.paint).toBe(`url(#t-${element.id}-fill-0)`)
    expect(model.defs[0]).toMatchObject({ type: 'linearGradient', x1: 0.5, y1: 0, x2: 0.5, y2: 1 })
    expect(defsToSvg(model.defs)).toContain('<linearGradient id=')
    expect(defsToSvg(model.defs)).toContain('stop-color="#FFFFFF"')
  })

  it('doubles inside and outside strokes and clips or masks them', () => {
    const inside = renderModel({ ...rect(), stroke: '#FFFFFF', strokeWidth: 3, strokeAlign: 'inside' }, 't')
    expect(inside.layers[1]).toMatchObject({ strokeWidth: 6 })
    expect(inside.layers[1]!.clipPath).toMatch(/^url\(#/)
    expect(inside.defs[0]!.type).toBe('clipPath')
    const outside = renderModel({ ...rect(), stroke: '#FFFFFF', strokeWidth: 3, strokeAlign: 'outside' }, 't')
    expect(outside.layers[1]!.mask).toMatch(/^url\(#/)
    expect(outside.defs[0]!.type).toBe('mask')
  })

  it('strokes only the requested rectangle sides and adds arrowheads on paths', () => {
    const sides = renderModel({ ...rect(), stroke: '#FFFFFF', strokeWidth: 2, strokeSides: { top: true, right: false, bottom: false, left: false } }, 't')
    expect(sides.layers[1]!.d).toBe('M 10 20 L 110 20')
    const path = createVectorElement('path', { x: 0, y: 0, width: 100, height: 10 }, { network: { nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }], segments: [{ id: 's', a: 'a', b: 'b' }] } })
    const arrows = renderModel({ ...path, strokeArrowStart: 'circle', strokeArrowEnd: 'triangle' }, 't')
    expect(arrows.layers[0]!.markerEnd).toBe(`url(#t-${path.id}-arrow-end-0)`)
    expect(arrows.defs.map((def) => def.type)).toEqual(['marker', 'marker'])
    expect(defsToSvg(arrows.defs)).toContain('orient="auto-start-reverse"')
  })

  it('rounds rectangle corners in the outline and exports them as a path', () => {
    const rounded: VectorElement = { ...rect(), cornerRadius: 10 }
    expect(outlinePathData(rounded)).toMatch(/^M 10 30 C /)
    const document = createVectorDocument()
    document.elements = [rounded, { ...rect(), id: 'plain' }]
    const svg = serializeVectorDocument(document)
    expect(svg).toContain(`<g id="${rounded.id}"><path id="${rounded.id}" d="M 10 30 C`)
    expect(svg).toContain('<rect id="plain"')
    expect(layersToSvg(renderModel(rounded, 'x'), rounded.id)).toContain('fill-opacity="1"')
  })

  it('fills only regions that are switched on and strokes every chain', () => {
    const built = normalizeWorld(networkFromRuns([
      { points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }, { anchor: { x: 100, y: 100 } }, { anchor: { x: 0, y: 100 } }], closed: true },
      { points: [{ anchor: { x: -20, y: 50 } }, { anchor: { x: 120, y: 50 } }], closed: false },
    ]))
    const element = { ...createVectorElement('path', built, { network: built.network, fill: '#FF0000' }) }
    const model = renderModel(element, 't')
    const fill = model.layers.find((layer) => layer.kind === 'fill')!
    expect((fill.d.match(/Z/g) ?? []).length).toBe(2)
    expect(model.layers.filter((layer) => layer.kind === 'stroke')).toHaveLength(1)
    const key = renderModel(element, 't') && (fill.d ? 'ok' : '')
    expect(key).toBe('ok')
  })
})

describe('render model caching', () => {
  it('reuses the model of an element that has not changed', () => {
    const element: VectorElement = { id: 'cached', kind: 'rectangle', name: 'R', x: 0, y: 0, width: 40, height: 20, rotation: 0, fill: '#112233', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false }

    const first = renderModel(element, 'canvas')
    const second = renderModel({ ...element }, 'canvas')

    expect(second).toBe(first)
  })

  it('builds a new model once a property changes, and per prefix', () => {
    const element: VectorElement = { id: 'cached2', kind: 'rectangle', name: 'R', x: 0, y: 0, width: 40, height: 20, rotation: 0, fill: '#112233', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false }

    const first = renderModel(element, 'canvas')
    const widened = renderModel({ ...element, width: 80 }, 'canvas')
    const exported = renderModel(element, 'svg')

    expect(widened).not.toBe(first)
    expect(exported).not.toBe(first)
    expect(widened.d).not.toBe(first.d)
  })
})

describe('text models', () => {
  const text = (patch: Partial<VectorElement> = {}): VectorElement => ({
    id: 'txt', kind: 'text', name: 'Text', x: 10, y: 20, width: 200, height: 60, rotation: 0,
    fill: '#D4E7E1', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false,
    text: 'one\ntwo', fontSize: 20, lineHeight: 1.5, ...patch,
  })

  it('lays the lines out inside the box instead of emitting paths', () => {
    const model = renderModel(text(), 'canvas')

    expect(model.layers).toEqual([])
    expect(model.text?.lines.map((line) => line.text)).toEqual(['one', 'two'])
    expect(model.text?.anchor).toBe('start')
    expect(model.text?.fill).toBe('#D4E7E1')
    expect(model.text!.lines[1]!.y - model.text!.lines[0]!.y).toBe(30)
    expect(model.text!.lines[0]!.x).toBe(10)
  })

  it('gives the box to hit testing so a text is grabbed anywhere inside it', () => {
    const model = renderModel(text(), 'canvas')

    expect(model.d).toBe(model.fillD)
    expect(model.d).toContain('M 10 20')
    expect(model.d).toContain('210')
  })

  it('anchors centred and right-aligned text on the box', () => {
    expect(renderModel(text({ textAlign: 'center' }), 'canvas').text?.anchor).toBe('middle')
    expect(renderModel(text({ textAlign: 'right', textSizing: 'fixed' }), 'canvas').text?.lines[0]!.x).toBe(210)
  })

  it('carries a stroke onto the letters when there is one', () => {
    const model = renderModel(text({ stroke: '#112233', strokeWidth: 2 }), 'canvas')

    expect(model.text?.stroke).toBe('#112233')
    expect(model.text?.strokeWidth).toBe(2)
  })
})
