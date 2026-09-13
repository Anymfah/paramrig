import { afterEach, describe, expect, it, vi } from 'vitest'
import { fieldFormBrandDocument } from '@/rigs/examples/field-form-brand'
import { resolveRigValues, rigDefaults } from '@/vector/rig'
import { normalizeValue } from '@/state/parameter-values'
import { sanitizeVectorDocument } from '@/vector/document'
import { brandContrast, checkBrand } from '@/vector/brandChecks'
import { brandKitFiles } from '@/vector/brandKit'
import { crc32, zipFiles } from '@/vector/zip'
import { RigSession } from '@/state/session'
import { vectorManifest } from '@/vector/document'

afterEach(() => vi.unstubAllGlobals())
const defaults = rigDefaults(fieldFormBrandDocument.rig!)

describe('brand typography and handoff', () => {
  it('keeps headline and body families independent, including small wordmarks', () => {
    const doc = resolveRigValues(fieldFormBrandDocument, { ...defaults, 'font-family': 'Space Grotesk', 'body-font-family': 'Georgia' })
    const get = (id: string) => doc.elements.find(element => element.id === id)!
    expect(get('type-display-sample').fontFamily).toBe('Space Grotesk')
    expect(get('type-body-sample').fontFamily).toBe('Georgia')
    expect(get('lockup-reverse-name').fontFamily).toBe('Space Grotesk')
    expect(get('type-body-family').text).toBe('Georgia')
  })
  it('preserves font sources and imported bytes through values, undo and document sanitization', () => {
    const param = fieldFormBrandDocument.rig!.parameters.find(p => p.id === 'body-font-family')!
    const imported = { family: 'Studio Serif', source: 'file', format: 'ttf', weights: [400], data: 'AQID' }
    expect(normalizeValue(param, imported)).toEqual(imported)
    expect(normalizeValue(param, { ...imported, data: '' })).toBe('Public Sans')
    const session = new RigSession(vectorManifest(fieldFormBrandDocument))
    session.setValue(param.id, imported)
    session.undo(); expect(session.getSnapshot().values[param.id]).toBe('Public Sans')
    session.redo(); expect(session.getSnapshot().values[param.id]).toEqual(imported)
    const restored = new RigSession(vectorManifest(fieldFormBrandDocument), session.toDraft())
    const doc = sanitizeVectorDocument(resolveRigValues(fieldFormBrandDocument, restored.getSnapshot().values))!
    expect(doc.fonts).toContainEqual(imported)
    expect(doc.elements.find(e => e.id === 'type-body-sample')?.fontFamily).toBe('Studio Serif')
  })
  it('calibrates contrast on known black/white and identical colours', () => {
    expect(brandContrast('#000000', '#ffffff')).toBe(21)
    expect(brandContrast('#254E3D', '#254E3D')).toBe(1)
    const doc = sanitizeVectorDocument(resolveRigValues(fieldFormBrandDocument, { ...defaults, ink: '#F2EFE7' }))!
    expect(checkBrand(doc, text => text.length * 5).issues.some(issue => issue.kind === 'contrast' && issue.elementId === 'mark-title')).toBe(true)
  })
  it('detects deliberately overflowing content without modifying it', () => {
    const doc = structuredClone(fieldFormBrandDocument)
    const sample = doc.elements.find(e => e.id === 'type-body-sample')!
    sample.text = Array(20).fill('Too many lines').join('\n')
    expect(checkBrand(doc, text => text.length * 5).issues.some(issue => issue.kind === 'overflow' && issue.elementId === sample.id)).toBe(true)
    expect(sample.text.split('\n')).toHaveLength(20)
  })
  it('exports current colours, two type roles, eight pages and five logo variants', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, text: async () => 'SIL OPEN FONT LICENSE' }))
    const doc = resolveRigValues(fieldFormBrandDocument, { ...defaults, 'brand-name': 'COMMON PLACE', ink: '#334455', 'font-family': 'Space Grotesk', 'body-font-family': 'Source Serif 4' })
    const files = await brandKitFiles(doc)
    expect(files.filter(f => f.name.startsWith('guidelines/'))).toHaveLength(8)
    expect(files.filter(f => f.name.startsWith('logos/'))).toHaveLength(5)
    const tokens = JSON.parse(files.find(f => f.name === 'tokens.json')!.content)
    expect(tokens).toMatchObject({ name: 'COMMON PLACE', colors: { ink: '#334455' }, typography: { display: { family: 'Space Grotesk' }, body: { family: 'Source Serif 4' } } })
    expect(files.find(f => f.name === 'logos/lockup-ink.svg')!.content).toContain('COMMON PLACE')
    expect(files.find(f => f.name === 'guidelines/page-4.svg')!.content).toContain('data:font/woff2;base64,')
    expect(files.find(f => f.name === 'logos/symbol-ink.svg')!.content).toContain('#334455')
    expect(files.find(f => f.name === 'licenses/SpaceGrotesk-OFL.txt')!.content).toContain('SIL OPEN FONT LICENSE')
  })
  it('does not silently deliver a kit when a required font is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    await expect(brandKitFiles(resolveRigValues(fieldFormBrandDocument, defaults))).rejects.toThrow('Could not embed')
  })
  it('writes a ZIP with calibrated CRCs, UTF-8 filenames and valid directory offsets', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    const zip = zipFiles([{ name: 'é.txt', content: 'hello' }, { name: 'tokens.json', content: '{}' }])
    const view = new DataView(zip.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    const end = zip.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    expect(view.getUint32(view.getUint32(end + 16, true), true)).toBe(0x02014b50)
  })
})
