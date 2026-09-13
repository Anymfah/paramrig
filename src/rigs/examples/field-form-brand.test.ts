import { describe, expect, it } from 'vitest'
import { FIELD_FORM_BRAND_ID, FIELD_FORM_MARK, fieldFormBrandDocument } from '@/rigs/examples/field-form-brand'
import { getVectorDocument, sanitizeVectorDocument, vectorManifest } from '@/vector/document'
import { resolveRigValues, rigDefaults } from '@/vector/rig'
import { DEFAULT_EXPORT, exportBounds, exportElements, exportMarkup } from '@/vector/export'

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  const channels = [value >> 16 & 255, value >> 8 & 255, value & 255].map((channel) => {
    const srgb = channel / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

describe('the bundled graphic charter rig', () => {
  it('survives the same reader as an imported vector project', () => {
    const clean = sanitizeVectorDocument(fieldFormBrandDocument)
    const cleanIds = new Set(clean?.elements.map((element) => element.id))
    expect(fieldFormBrandDocument.elements.filter((element) => !cleanIds.has(element.id)).map((element) => element.id)).toEqual([])
    expect(clean?.rig?.parameters).toHaveLength(27)
    expect(clean?.rig?.bindings).toEqual(fieldFormBrandDocument.rig!.bindings)
    expect(clean?.exportPresets).toHaveLength(3)
    expect(clean?.elements.filter((element) => element.kind === 'frame')).toHaveLength(8)
    expect(clean?.rig?.groups.every((group) => !group.tab)).toBe(true)
  })

  it('ships in the library as a vector example', () => {
    const document = getVectorDocument(FIELD_FORM_BRAND_ID)
    expect(document?.name).toBe('Field / Form brand system')
    expect(vectorManifest(document!).summary).toBe('Vector · 27 controls')
    expect(vectorManifest(document!).sourceFile).toBe('src/rigs/examples/field-form-brand.ts')
  })

  it('propagates identity decisions across the whole charter', () => {
    const values = {
      ...rigDefaults(fieldFormBrandDocument.rig!),
      'brand-name': 'COMMON PLACE',
      tagline: 'Built with the people who live there.',
      campaign: 'Come together.',
      field: '#244B7A',
      lime: '#E29A3A',
    }
    const resolved = resolveRigValues(fieldFormBrandDocument, values)
    const byId = (id: string) => resolved.elements.find((element) => element.id === id)

    for (const id of ['cover-wordmark', 'lockup-name', 'card-name', 'letter-name', 'social-name', 'mobile-name']) {
      expect(byId(id)).toMatchObject({ text: 'COMMON PLACE' })
    }
    expect(byId('cover-tagline')).toMatchObject({ text: 'Built with the people who live there.' })
    for (const id of ['poster-headline', 'social-headline', 'mobile-headline']) {
      expect(byId(id)).toMatchObject({ text: 'Come together.' })
    }
    expect(byId('page-1')).toMatchObject({ fill: '#244B7A' })
    expect(byId('field-swatch')).toMatchObject({ fill: '#244B7A' })
    expect(byId('field-hex')).toMatchObject({ text: '#244B7A' })
    expect(byId('cover-mark')).toMatchObject({ fill: '#E29A3A', network: FIELD_FORM_MARK })
    expect(byId('web-action')).toMatchObject({ fill: '#E29A3A' })
  })

  it('makes every exposed control effective after reading, with no default appearance jump', () => {
    const document = sanitizeVectorDocument(fieldFormBrandDocument)!
    const defaults = rigDefaults(document.rig!)
    const baseline = resolveRigValues(document, defaults)
    // Proportional transforms may differ by machine epsilon (56 × 1 becomes 56.00000000000001).
    for (const element of document.elements) {
      const actual = baseline.elements.find(item => item.id === element.id)!
      for (const key of Object.keys(element) as (keyof typeof element)[]) {
        if (typeof element[key] === 'number') expect(actual[key], `${element.id}.${key}`).toBeCloseTo(element[key] as number, 10)
        else expect(actual[key], `${element.id}.${key}`).toEqual(element[key])
      }
    }
    for (const parameter of document.rig!.parameters) {
      const value = parameter.kind === 'number' ? parameter.min : parameter.kind === 'select' ? parameter.options[1]!.value : parameter.kind === 'color' ? '#875A45' : 'New wording'
      const changed = resolveRigValues(document, { ...defaults, [parameter.id]: value, ...(parameter.kind === 'preset' ? parameter.options[1]!.values : {}) })
      expect(changed, parameter.id).not.toEqual(baseline)
      if (parameter.kind === 'color' && parameter.id !== 'workspace-background') {
        expect(changed.elements.find((element) => element.id === `${parameter.id}-swatch`)?.fill).toBe(value)
        expect(changed.elements.find((element) => element.id === `${parameter.id}-hex`)?.text).toBe(value)
      }
    }
  })

  it('changes every text and the specimen name without changing the mark or the saved colours', () => {
    const document = sanitizeVectorDocument(fieldFormBrandDocument)!
    const defaults = rigDefaults(document.rig!)
    for (const family of ['Space Grotesk', 'Source Serif 4']) {
      const changed = resolveRigValues(document, { ...defaults, 'font-family': family, 'body-font-family': family, field: '#0C0D17' })
      expect(changed.elements.filter(element => element.kind === 'text').every(element => element.fontFamily === family)).toBe(true)
      expect(changed.elements.find(element => element.id === 'type-family')?.text).toBe(family)
      expect(changed.elements.find(element => element.id === 'cover-mark')?.network).toEqual(FIELD_FORM_MARK)
      expect(changed.elements.find(element => element.id === 'page-1')?.fill).toBe('#0C0D17')
      const markup = exportMarkup(changed, DEFAULT_EXPORT, { selectedIds: [], frameId: null })!
      expect(markup).toContain(family)
      expect(sanitizeVectorDocument(changed)?.elements.filter(element => element.kind === 'text').every(element => element.fontFamily === family)).toBe(true)
    }
  })

  it('keeps the workspace transparent through import and makes its colour independent of pages', () => {
    const document = sanitizeVectorDocument(fieldFormBrandDocument)!
    expect(document.background).toBe('none')
    const values = rigDefaults(document.rig!)
    const coloured = resolveRigValues(document, { ...values, 'workspace-background': '#875A45' })
    expect(coloured.background).toBe('#875A45')
    expect(coloured.elements).toEqual(resolveRigValues(document, values).elements)
    expect(exportMarkup(document, DEFAULT_EXPORT, { selectedIds: [], frameId: null })).not.toContain('fill="none"/>\n')
  })

  it('updates the printed type specification and scales applications without deforming the master', () => {
    const document = sanitizeVectorDocument(fieldFormBrandDocument)!
    const changed = resolveRigValues(document, { ...rigDefaults(document.rig!), 'display-weight': 700, 'display-leading': 1.2, 'symbol-scale': 80 })
    const byId = (id: string) => changed.elements.find(element => element.id === id)
    expect(byId('type-display-weight')?.text).toBe('700')
    expect(byId('type-heading-leading')?.text).toBe('1.2')
    expect(byId('type-display-sample')).toMatchObject({ fontWeight: 700, lineHeight: 1.2 })
    expect(byId('cover-mark')).toMatchObject({ width: 288, height: 288, network: FIELD_FORM_MARK })
    expect(byId('construction-mark')).toMatchObject({ width: 240, height: 240 })
    expect(FIELD_FORM_MARK.nodes).toHaveLength(20)
  })

  it('preserves the same open silhouette in positive, reversed and 16 px uses', () => {
    const document = sanitizeVectorDocument(fieldFormBrandDocument)!
    const marks = document.elements.filter((element) => element.kind === 'path' && !element.id.startsWith('misuse-'))
    expect(marks.length).toBeGreaterThan(15)
    for (const element of marks) {
      expect(element.network).toEqual(FIELD_FORM_MARK)
      expect(element.width).toBe(element.height)
      expect(element.stroke).toBe('none')
    }
    expect(marks.find((element) => element.id === 'minimum-16')?.width).toBe(16)
  })

  it('exports each independent page without including neighbouring pages', () => {
    const document = sanitizeVectorDocument(JSON.parse(JSON.stringify(fieldFormBrandDocument)))!
    for (const frame of document.elements.filter((element) => element.kind === 'frame')) {
      const selection = { frameId: frame.id, selectedIds: [frame.id] }
      expect(exportBounds(document, 'frame', selection)).toEqual({ x: frame.x, y: frame.y, width: 1280, height: 900 })
      const members = exportElements(document, 'frame', selection)
      expect(members.some((element) => element.kind === 'text')).toBe(true)
      expect(members.some((element) => element.kind === 'path')).toBe(frame.id !== 'page-3' && frame.id !== 'page-4')
      expect(members.every((element) => element.id === frame.id || element.parentId === frame.id)).toBe(true)
      const markup = exportMarkup(document, { ...DEFAULT_EXPORT, target: 'frame' }, selection)!
      expect(markup).toContain(`viewBox="${frame.x} ${frame.y} 1280 900"`)
      for (const other of document.elements.filter((element) => element.kind === 'frame' && element.id !== frame.id)) {
        expect(markup).not.toContain(`id="${other.id}"`)
      }
    }
  })

  it('starts with readable foreground and surface pairs', () => {
    // Calibrates the same formula against the known WCAG black/white result before using it.
    expect(contrast('#000000', '#FFFFFF')).toBe(21)
    const defaults = rigDefaults(fieldFormBrandDocument.rig!) as Record<string, string>
    for (const [a, b] of [['ink', 'paper'], ['paper', 'field'], ['ink', 'lime'], ['lime', 'field']]) {
      expect(contrast(defaults[a!]!, defaults[b!]!)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
