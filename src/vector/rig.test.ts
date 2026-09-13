import { describe, expect, it } from 'vitest'
import { createVectorElement } from '@/vector/document'
import {
  applyBinding, applyTransform, emptyRig, kindForProperty, parseBindableProperty,
  propertyLabel, resolveRigValues, rigDefaults, sanitizeParameter, sanitizeRig, type VectorBinding, type VectorRig,
} from '@/vector/rig'
import type { ParameterDef } from '@/rigs/types'
import type { VectorDocument, VectorElement } from '@/vector/types'
import { normalizeValue } from '@/state/parameter-values'

const rect = (id: string, patch: Partial<VectorElement> = {}): VectorElement => ({
  ...createVectorElement('rectangle', { x: 10, y: 20, width: 100, height: 80 }),
  id,
  ...patch,
})

const number = (id: string): ParameterDef => ({ kind: 'number', id, label: id, group: 'controls', min: 0, max: 400, step: 1, defaultValue: 100 })

function documentWith(elements: VectorElement[], rig?: VectorRig): VectorDocument {
  return {
    version: 1, id: 'vector-test', name: 'Test', background: '#151516', width: 800, height: 600,
    elements, guides: [], createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
    ...(rig ? { rig } : {}),
  }
}

const noResolve = () => { throw new Error('no parameters') }

describe('reading a property path', () => {
  it('lets a document-wide family be overridden by an individual text binding', () => {
    const a = rect('a', { kind: 'text', fontFamily: 'Public Sans', text: 'Aa' })
    const b = rect('b', { kind: 'text', fontFamily: 'Public Sans', text: 'Bb' })
    const rig = sanitizeRig({ groups: [{ id: 'controls', label: 'Controls' }], parameters: [
      { kind: 'select', id: 'font', label: 'Font family', group: 'controls', defaultValue: 'Space Grotesk', options: [{ value: 'Space Grotesk', label: 'Space Grotesk' }] },
      { kind: 'select', id: 'body', label: 'Body font', group: 'controls', defaultValue: 'Source Serif 4', options: [{ value: 'Source Serif 4', label: 'Source Serif 4' }] },
    ], bindings: [
      { id: 'all', elementId: '@document', property: 'fontFamily', parameterId: 'font' },
      { id: 'one', elementId: 'b', property: 'fontFamily', parameterId: 'body' },
    ] }, new Set(['a', 'b']))!
    expect(rig.bindings).toHaveLength(2)
    const result = resolveRigValues(documentWith([a, b, rect('c')], rig), rigDefaults(rig))
    expect(result.elements[0]).toMatchObject({ fontFamily: 'Space Grotesk', text: 'Aa' })
    expect(result.elements[1]).toMatchObject({ fontFamily: 'Source Serif 4', text: 'Bb' })
    expect(result.elements[2]).not.toHaveProperty('fontFamily')
  })
  it('keeps transparent workspace bindings through import and refuses unknown document properties', () => {
    const parameter: ParameterDef = { kind: 'color', id: 'bg', label: 'Background', group: 'controls', defaultValue: 'none', allowNone: true }
    const rig = sanitizeRig({ groups: [{ id: 'controls', label: 'Controls' }], parameters: [parameter], bindings: [
      { id: 'valid', elementId: '@document', property: 'background', parameterId: 'bg' },
      { id: 'invalid', elementId: '@document', property: 'width', parameterId: 'bg' },
    ] }, new Set())!
    expect(rig.parameters[0]).toEqual(parameter)
    expect(rig.bindings.map(binding => binding.id)).toEqual(['valid'])
    expect(normalizeValue(parameter, 'none')).toBe('none')
    expect(normalizeValue({ ...parameter, allowNone: false, defaultValue: '#FFFFFF' }, 'none')).toBe('#FFFFFF')
    expect(resolveRigValues(documentWith([], rig), { bg: '#ABCDEF' }).background).toBe('#ABCDEF')
    expect(resolveRigValues(documentWith([], rig), { bg: 'none' }).background).toBe('none')
  })
  it('knows the plain properties and their kinds', () => {
    expect(parseBindableProperty('width')).toEqual({ kind: 'simple', key: 'width', type: 'number' })
    expect(parseBindableProperty('fill')).toEqual({ kind: 'simple', key: 'fill', type: 'color' })
    expect(parseBindableProperty('visible')).toEqual({ kind: 'simple', key: 'visible', type: 'boolean' })
    expect(parseBindableProperty('blendMode')).toEqual({ kind: 'simple', key: 'blendMode', type: 'option' })
  })

  it('reads into the paint stack, the effects, the regions and the nodes', () => {
    expect(parseBindableProperty('fills[1].color')).toMatchObject({ kind: 'paint', list: 'fills', index: 1, field: 'color' })
    expect(parseBindableProperty('strokes[0].opacity')).toMatchObject({ kind: 'paint', list: 'strokes', index: 0, field: 'opacity' })
    expect(parseBindableProperty('effects[0].blur')).toMatchObject({ kind: 'effect', index: 0, field: 'blur', type: 'number' })
    expect(parseBindableProperty('regionsOff[face-1]')).toMatchObject({ kind: 'region', key: 'face-1' })
    expect(parseBindableProperty('network.nodes[n1].x')).toMatchObject({ kind: 'node', nodeId: 'n1', axis: 'x' })
  })

  it('refuses what it does not recognise rather than guessing', () => {
    expect(parseBindableProperty('somethingElse')).toBeNull()
    expect(parseBindableProperty('effects[0].nowhere')).toBeNull()
    expect(parseBindableProperty('fills[x].color')).toBeNull()
  })

  it('names a property the way a control should be named', () => {
    expect(propertyLabel('width')).toBe('Width')
    expect(propertyLabel('fills[0].color')).toBe('Fill 1 color')
    expect(kindForProperty('color')).toBe('color')
    expect(kindForProperty('boolean')).toBe('switch')
  })
})

describe('a control writing to a property', () => {
  const bind = (property: string, extra: Partial<VectorBinding> = {}): VectorBinding =>
    ({ id: 'b1', elementId: 'a', parameterId: 'p', property, ...extra })

  it('writes a number', () => {
    expect(applyBinding(rect('a'), bind('width'), 240, noResolve).width).toBe(240)
  })

  it('writes a colour to the summary and to the first paint layer', () => {
    const element = rect('a', { fills: [{ id: 'f', type: 'solid', color: '#000000', opacity: 1, visible: true }] })
    const next = applyBinding(element, bind('fill'), '#FF0000', noResolve)
    expect(next.fill).toBe('#FF0000')
    expect(next.fills?.[0]?.color).toBe('#FF0000')
  })

  it('writes a switch', () => {
    expect(applyBinding(rect('a'), bind('visible'), false, noResolve).visible).toBe(false)
  })

  it('writes a select onto the blend mode, and only a mode it knows', () => {
    expect(applyBinding(rect('a'), bind('blendMode'), 'multiply', noResolve).blendMode).toBe('multiply')
    expect(applyBinding(rect('a'), bind('blendMode'), 'nonsense', noResolve).blendMode).toBeUndefined()
  })

  it('writes text', () => {
    const text = { ...rect('a'), kind: 'text' as const, text: 'before' }
    expect(applyBinding(text, bind('text'), 'after', noResolve).text).toBe('after')
  })

  it('writes a gradient onto a paint layer', () => {
    const element = rect('a', { fills: [{ id: 'f', type: 'linear', stops: [{ t: 0, color: '#000' }, { t: 1, color: '#fff' }], opacity: 1, visible: true }] })
    const next = applyBinding(element, bind('fills[0].stops'), [{ t: 0, color: '#111111' }, { t: 1, color: '#222222' }], noResolve)
    expect(next.fills?.[0]?.stops).toEqual([{ t: 0, color: '#111111' }, { t: 1, color: '#222222' }])
  })

  it('writes a vector onto a number, taking its first axis', () => {
    expect(applyBinding(rect('a'), bind('x'), [64, 12], noResolve).x).toBe(64)
  })

  it('turns a region on and off, which is the opposite of regionsOff', () => {
    expect(applyBinding(rect('a'), bind('regionsOff[f1]'), false, noResolve).regionsOff).toEqual(['f1'])
    expect(applyBinding(rect('a', { regionsOff: ['f1'] }), bind('regionsOff[f1]'), true, noResolve).regionsOff).toBeUndefined()
  })

  it('moves a node of a network', () => {
    const element = rect('a', { network: { nodes: [{ id: 'n1', x: 0, y: 0 }], segments: [] } })
    expect(applyBinding(element, bind('network.nodes[n1].x'), 0.5, noResolve).network?.nodes[0]?.x).toBe(0.5)
  })

  it('leaves the object alone when the value is the wrong shape', () => {
    const element = rect('a')
    expect(applyBinding(element, bind('width'), 'wide', noResolve)).toBe(element)
    expect(applyBinding(element, bind('fill'), 42, noResolve)).toBe(element)
  })

  it('leaves the object alone when the property is out of reach', () => {
    const element = rect('a')
    expect(applyBinding(element, bind('effects[3].blur'), 4, noResolve)).toBe(element)
    expect(applyBinding(element, bind('fills[9].color'), '#fff', noResolve)).toBe(element)
  })
})

describe('the transform between a control and a property', () => {
  it('scales and offsets', () => {
    expect(applyTransform(2, { scale: 10, offset: 5 }, noResolve)).toBe(25)
  })

  it('clamps', () => {
    expect(applyTransform(1000, { max: 100 }, noResolve)).toBe(100)
    expect(applyTransform(-5, { min: 0 }, noResolve)).toBe(0)
  })

  it('evaluates an expression over the control value', () => {
    expect(applyTransform(3, { expression: 'value * value' }, noResolve)).toBe(9)
    expect(applyTransform(3, { expression: 'other + 1' }, (id) => (id === 'other' ? 10 : 0))).toBe(11)
  })

  it('leaves the value alone when the expression cannot be read', () => {
    expect(applyTransform(3, { expression: 'value +' }, noResolve)).toBe(3)
    expect(applyTransform(3, { expression: 'unknown' }, noResolve)).toBe(3)
  })
})

describe('resolving a document against its controls', () => {

  it('gives back the same document when there is no rig', () => {
    const document = documentWith([rect('a')])
    expect(resolveRigValues(document, {})).toBe(document)
  })

  it('applies every binding, and the editing document is left alone', () => {
    const rig: VectorRig = {
      groups: [{ id: 'controls', label: 'Controls' }],
      parameters: [number('w'), { kind: 'color', id: 'c', label: 'Colour', group: 'controls', defaultValue: '#D4E7E1' }],
      bindings: [
        { id: 'b1', elementId: 'a', parameterId: 'w', property: 'width' },
        { id: 'b2', elementId: 'a', parameterId: 'c', property: 'fill' },
      ],
    }
    const document = documentWith([rect('a')], rig)
    const resolved = resolveRigValues(document, { w: 320, c: '#FF0000' })
    expect(resolved.elements[0]).toMatchObject({ width: 320, fill: '#FF0000' })
    expect(document.elements[0]).toMatchObject({ width: 100 })
  })

  it('lets the last binding on a property win', () => {
    const rig: VectorRig = {
      groups: [{ id: 'controls', label: 'Controls' }],
      parameters: [number('a'), number('b')],
      bindings: [
        { id: 'b1', elementId: 'a', parameterId: 'a', property: 'width' },
        { id: 'b2', elementId: 'a', parameterId: 'b', property: 'width' },
      ],
    }
    expect(resolveRigValues(documentWith([rect('a')], rig), { a: 100, b: 200 }).elements[0]?.width).toBe(200)
  })

  it('keeps hosts independent and observes edits without a new persistence timestamp', () => {
    const rig: VectorRig = { groups: [{ id: 'controls', label: 'Controls' }], parameters: [number('w')], bindings: [{ id: 'b', elementId: 'a', parameterId: 'w', property: 'width' }] }
    const document = documentWith([rect('a')], rig)
    const first = resolveRigValues(document, { w: 200 })
    document.elements[0] = { ...document.elements[0]!, fill: '#123456' }
    expect(resolveRigValues(document, { w: 200 }).elements[0]!.fill).toBe('#123456')
    expect(first.elements[0]!.fill).not.toBe('#123456')
    const other = { ...document, background: '#fedcba' }
    expect(resolveRigValues(other, { w: 200 }).background).toBe('#fedcba')
  })

  it('reads another control inside a transform expression', () => {
    const rig: VectorRig = {
      groups: [{ id: 'controls', label: 'Controls' }],
      parameters: [number('w'), number('k')],
      bindings: [{ id: 'b', elementId: 'a', parameterId: 'w', property: 'width', transform: { expression: 'value * k' } }],
    }
    expect(resolveRigValues(documentWith([rect('a')], rig), { w: 10, k: 3 }).elements[0]?.width).toBe(30)
  })

  it('takes the defaults from the controls', () => {
    expect(rigDefaults({ ...emptyRig(), parameters: [number('w')] })).toEqual({ w: 100 })
  })
})

describe('reading a rig back from a file', () => {
  const groups = new Set(['controls'])

  it('keeps a number with its bounds', () => {
    expect(sanitizeParameter({ kind: 'number', id: 'w', label: 'Width', group: 'controls', min: 10, max: 200, step: 2, defaultValue: 50, unit: 'px' }, groups))
      .toEqual({ kind: 'number', id: 'w', label: 'Width', group: 'controls', min: 10, max: 200, step: 2, defaultValue: 50, unit: 'px' })
  })

  it('repairs a range the wrong way round', () => {
    expect(sanitizeParameter({ kind: 'number', id: 'w', group: 'controls', min: 100, max: 10 }, groups)).toMatchObject({ min: 100, max: 101 })
  })

  it('drops a control with no id, no kind, or a group nobody declared', () => {
    expect(sanitizeParameter({ kind: 'number', group: 'controls' }, groups)).toBeNull()
    expect(sanitizeParameter({ id: 'w', group: 'controls' }, groups)).toBeNull()
    expect(sanitizeParameter({ kind: 'number', id: 'w', group: 'elsewhere' }, groups)).toBeNull()
    expect(sanitizeParameter({ kind: 'gizmo3d', id: 'w', group: 'controls' }, groups)).toBeNull()
  })

  it('drops a select with no options', () => {
    expect(sanitizeParameter({ kind: 'select', id: 's', group: 'controls', options: [] }, groups)).toBeNull()
    expect(sanitizeParameter({ kind: 'select', id: 's', group: 'controls', options: [{ value: 'a' }] }, groups))
      .toMatchObject({ options: [{ value: 'a', label: 'a' }], defaultValue: 'a' })
  })

  it('drops a binding whose object or control is missing', () => {
    const rig = sanitizeRig({
      groups: [{ id: 'controls', label: 'Controls' }],
      parameters: [{ kind: 'number', id: 'w', group: 'controls', min: 0, max: 10 }],
      bindings: [
        { id: 'ok', elementId: 'a', parameterId: 'w', property: 'width' },
        { id: 'orphan-element', elementId: 'gone', parameterId: 'w', property: 'width' },
        { id: 'orphan-parameter', elementId: 'a', parameterId: 'gone', property: 'width' },
        { id: 'orphan-property', elementId: 'a', parameterId: 'w', property: 'nowhere' },
      ],
    }, new Set(['a']))
    expect(rig?.bindings.map((binding) => binding.id)).toEqual(['ok'])
  })

  it('refuses a rig that declares no group', () => {
    expect(sanitizeRig({ parameters: [], bindings: [] }, new Set())).toBeUndefined()
    expect(sanitizeRig(null, new Set())).toBeUndefined()
  })

  it('keeps only one control per id', () => {
    const rig = sanitizeRig({
      groups: [{ id: 'controls', label: 'Controls' }],
      parameters: [
        { kind: 'number', id: 'w', group: 'controls', min: 0, max: 10 },
        { kind: 'number', id: 'w', group: 'controls', min: 0, max: 20 },
      ],
      bindings: [],
    }, new Set())
    expect(rig?.parameters).toHaveLength(1)
  })
})
