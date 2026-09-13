import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { inspectFont } from '@/vector/fontMetadata'
import { fontCapabilities, supportedWeight } from '@/vector/fontCapabilities'
import { sanitizeFonts } from '@/vector/fonts'
import { brandApplications, faviconIco, symbolMarkup } from '@/vector/brandApplications'
import { fieldFormBrandDocument } from '@/rigs/examples/field-form-brand'
import { rigDefaults, resolveRigValues } from '@/vector/rig'
import { sanitizeVectorDocument, serializeVectorMarkup, vectorManifest } from '@/vector/document'
import { RigSession } from '@/state/session'
import { zipFiles } from '@/vector/zip'

describe('extended brand controls', () => {
  it('calibrates shipped weight ranges against their actual font files', async () => {
    for (const [family, filename] of [['Public Sans', 'PublicSans'], ['Space Grotesk', 'SpaceGrotesk'], ['Source Serif 4', 'SourceSerif4']]) {
      const bytes = new Uint8Array(readFileSync(`public/fonts/${filename}.woff2`))
      const metadata = await inspectFont(bytes.buffer)
      expect(metadata.weights).toEqual(fontCapabilities(family).weights)
      expect(metadata.axes?.map(axis => axis.tag)).toEqual(['wght'])
    }
  })
  it('clamps variable weights and selects only real static faces', () => {
    expect(supportedWeight('Space Grotesk', 900)).toBe(700)
    expect(supportedWeight('Space Grotesk', 543)).toBe(543)
    expect(supportedWeight({ family: 'Static', source: 'file', weights: [400, 700] }, 600)).toBe(700)
    expect(supportedWeight({ family: 'Regular', source: 'file', weights: [400] }, 900)).toBe(400)
    expect(fontCapabilities('Unverified local font').verified).toBe(false)
  })
  it('applies a pairing in one undo without changing the palette or logo', () => {
    const document = sanitizeVectorDocument(fieldFormBrandDocument)!
    const session = new RigSession(vectorManifest(document))
    session.setValue('field', '#123456')
    const before = session.getSnapshot().values
    session.applyPreset('type-pairing', 'editorial')
    expect(session.getSnapshot().values).toMatchObject({ 'font-family': 'Source Serif 4', 'body-font-family': 'Public Sans', 'display-weight': 500, field: '#123456' })
    session.undo(); expect(session.getSnapshot().values).toEqual(before)
    session.redo(); expect(session.getSnapshot().values['font-family']).toBe('Source Serif 4')
  })
  it('carries axes and settings through sanitization, role binding and SVG', () => {
    const font = { family: 'Variable Example', source: 'file', weights: [300, 700], data: 'AQID', format: 'ttf', axes: [{ tag: 'wght', name: 'Weight', min: 300, max: 700, default: 400 }, { tag: 'wdth', name: 'Width', min: 75, max: 125, default: 100 }], variations: { wdth: 90 } }
    expect(sanitizeFonts([font])?.[0]).toEqual(font)
    const document = sanitizeVectorDocument(resolveRigValues(fieldFormBrandDocument, { ...rigDefaults(fieldFormBrandDocument.rig!), 'font-family': font, 'display-weight': 900 }))!
    const display = document.elements.find(element => element.id === 'type-display-sample')!
    expect(display).toMatchObject({ fontWeight: 700, fontVariations: { wdth: 90 } })
    expect(document.elements.find(element => element.id === 'type-body-sample')?.fontVariations).toBeUndefined()
    expect(serializeVectorMarkup([{ ...display, parentId: undefined }], { x: display.x, y: display.y, width: display.width, height: display.height })).toContain('font-variation-settings:')
  })
  it('derives delivery applications and tiny proofs from current artwork', () => {
    const document = resolveRigValues(fieldFormBrandDocument, { ...rigDefaults(fieldFormBrandDocument.rig!), 'brand-name': 'COMMON PLACE', campaign: 'Come together.', field: '#123456' })
    const assets = brandApplications(document)
    expect(assets.map(asset => [asset.name, asset.width, asset.height])).toEqual([['favicon', 32, 32], ['avatar', 1024, 1024], ['social-square', 1080, 1080], ['social-story', 1080, 1920], ['social-landscape', 1200, 630]])
    for (const asset of assets) expect(asset.markup).toContain('#123456')
    for (const asset of assets.filter(asset => asset.name.startsWith('social'))) {
      expect(asset.markup).toContain('COMMON PLACE')
      expect([...asset.markup.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(match => match[1]).join(' ')).toContain('Come together.')
    }
    expect(symbolMarkup(document, 16, '#000000')).toContain('viewBox="0 0 16 16"')
  })
  it('writes binary ZIP contents without transcoding and valid ICO offsets', () => {
    const raw = new Uint8Array([0, 255, 128, 1])
    const archive = zipFiles([{ name: 'a', content: raw }])
    expect(archive.slice(31, 35)).toEqual(raw)
    const ico = faviconIco([{ size: 16, bytes: raw }, { size: 32, bytes: raw }])
    const header = new DataView(ico.buffer)
    expect(header.getUint16(2, true)).toBe(1)
    expect(header.getUint16(4, true)).toBe(2)
    expect(header.getUint32(18, true)).toBe(38)
    expect(header.getUint32(34, true)).toBe(42)
    expect(ico.slice(38, 42)).toEqual(raw)
  })
})
