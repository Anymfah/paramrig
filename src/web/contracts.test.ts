import { describe, expect, it } from 'vitest'
import example from '../../examples/web/manifest.json'
import { envelope, isBatch, isCommand, isDraft, isEnvelope, isEvent, isValues, parseManifest } from './contracts'
import { newDraft, WebSession } from './session'

describe('web integration boundaries', () => {
  it('accepts a complete agent manifest and the portable feedback format', () => {
    const manifest = parseManifest(example); expect(manifest.pages).toHaveLength(2)
    expect(isDraft(newDraft(manifest))).toBe(true); expect(isBatch(new WebSession(manifest).batch([]))).toBe(true)
  })
  it('rejects non-HTTP origins, off-origin page paths and duplicate IDs', () => {
    expect(() => parseManifest({ ...example, origin: 'javascript:alert(1)' })).toThrow()
    expect(() => parseManifest({ ...example, pages: [{ id: 'bad', name: 'Bad', path: '//other.example/page' }] })).toThrow()
    expect(() => parseManifest({ ...example, parameters: [example.parameters[0], example.parameters[0]] })).toThrow()
  })
  it('rejects malformed controls and bindings before the inspector can render', () => {
    expect(() => parseManifest({ ...example, parameters: [{ id: 'bad', kind: 'select', defaultValue: 'a', label: 'Bad', group: 'identity' }] })).toThrow()
    expect(() => parseManifest({ ...example, bindings: [{ ...example.bindings[0], paramId: 'missing' }] })).toThrow()
    expect(() => parseManifest({ ...example, bindings: [{ ...example.bindings[0], scope: 'element', target: null }] })).toThrow()
  })
  it('does not accept executable, prototype-polluting, non-finite or unbounded values', () => {
    expect(isValues({ fn: () => 1 })).toBe(false); expect(isValues({ n: Infinity })).toBe(false)
    expect(isValues(JSON.parse('{"__proto__":{"admin":true}}'))).toBe(false)
    expect(isValues({ a: Array(1001).fill(1) })).toBe(false)
  })
  it('validates message envelopes and their payload separately', () => {
    expect(isEnvelope(envelope('session-1', { type: 'values', values: {}, source: true }))).toBe(true)
    expect(isCommand({ type: 'values', values: 'bad', source: true })).toBe(false)
    expect(isCommand({ type: 'execute', code: 'arbitrary code' })).toBe(false)
    expect(isEvent({ type: 'scene', context: null, targets: [] })).toBe(false)
    expect(isEvent({ type: 'capture', requestId: 'capture-1', dataUrl: 'javascript:alert(1)' })).toBe(false)
  })
})
