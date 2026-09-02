import { describe, expect, it } from 'vitest'
import { pastedBindings, readClipboardPayload, writeClipboardPayload } from '@/vector/clipboard'
import { createVectorElement } from '@/vector/document'
import type { VectorDocument } from '@/vector/types'

class FakeTransfer {
  private data = new Map<string, string>()
  setData(type: string, value: string) { this.data.set(type, value) }
  getData(type: string) { return this.data.get(type) ?? '' }
}

const element = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 40, height: 40 }), id: 'a' }

const document: VectorDocument = {
  version: 1, id: 'vector-source', name: 'Source', background: '#151516', width: 400, height: 400,
  elements: [element], guides: [], createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
  rig: {
    groups: [{ id: 'main', label: 'Main' }],
    parameters: [{ kind: 'number', id: 'w', label: 'Width', group: 'main', min: 0, max: 100, step: 1, defaultValue: 40 }],
    bindings: [{ id: 'b', elementId: 'a', property: 'width', parameterId: 'w' }],
  },
}

describe('a copy that carries its bindings', () => {
  it('writes the bindings of what was copied, and reads them back', () => {
    const transfer = new FakeTransfer() as unknown as DataTransfer
    writeClipboardPayload(transfer, [element], document)
    const payload = readClipboardPayload(transfer)
    expect(payload?.source).toBe('internal')
    expect(payload?.bindings).toEqual([{ id: 'b', elementId: 'a', property: 'width', parameterId: 'w' }])
  })

  it('keeps a binding only when the document it lands in knows the control', () => {
    const bindings = [{ id: 'b', elementId: 'a', property: 'width', parameterId: 'w' }]
    expect(pastedBindings(bindings, { a: 'copy-1' }, new Set(['w']))).toMatchObject([{ elementId: 'copy-1', parameterId: 'w', property: 'width' }])
    expect(pastedBindings(bindings, { a: 'copy-1' }, new Set(['other']))).toEqual([])
    expect(pastedBindings(bindings, {}, new Set(['w']))).toEqual([])
  })

  it('gives a fresh id to each pasted binding', () => {
    const [pasted] = pastedBindings([{ id: 'b', elementId: 'a', property: 'width', parameterId: 'w' }], { a: 'copy-1' }, new Set(['w']))
    expect(pasted?.id).not.toBe('b')
  })
})
