import { describe, expect, it } from 'vitest'
import { apertureMarkDocument, APERTURE_MARK_ID } from '@/rigs/examples/aperture-mark'
import { getVectorDocument, isBundledDocument, listVectorDocuments, saveVectorDocument, sanitizeVectorDocument, vectorManifest } from '@/vector/document'
import { getRig, listRigs } from '@/rigs/registry'
import { resolveRigValues, rigDefaults } from '@/vector/rig'

describe('the vector rig that ships with the app', () => {
  it('survives the reader it will be read by', () => {
    const clean = sanitizeVectorDocument(apertureMarkDocument)
    expect(clean?.rig?.parameters).toHaveLength(5)
    expect(clean?.rig?.bindings).toHaveLength(7)
  })

  it('is offered before this browser has ever stored it', () => {
    expect(getVectorDocument(APERTURE_MARK_ID)?.name).toBe('Aperture mark')
    expect(listVectorDocuments().some((document) => document.id === APERTURE_MARK_ID)).toBe(true)
  })

  it('appears in the library as an example, not as a project', () => {
    const manifest = vectorManifest(apertureMarkDocument)
    expect(manifest.collection).toBe('examples')
    expect(manifest.title).toBe('Examples/Vector')
    expect(manifest.summary).toBe('Vector · 5 controls')
    expect(manifest.sourceFile).toBe('src/rigs/examples/aperture-mark.ts')
    expect(manifest.tags).toContain('example')
    expect(listRigs().some((rig) => rig.id === APERTURE_MARK_ID)).toBe(true)
    expect(getRig(APERTURE_MARK_ID)?.parameters).toHaveLength(5)
  })

  it('stays an example until it is changed, then becomes this browser\'s own', () => {
    const shipped = getVectorDocument(APERTURE_MARK_ID)!
    expect(isBundledDocument(APERTURE_MARK_ID)).toBe(true)

    // Opening it saves it as it was found, which must not count as editing it.
    saveVectorDocument(shipped)
    expect(isBundledDocument(APERTURE_MARK_ID)).toBe(true)
    expect(vectorManifest(getVectorDocument(APERTURE_MARK_ID)!).title).toBe('Examples/Vector')

    saveVectorDocument({ ...shipped, name: 'Mine' })
    expect(getVectorDocument(APERTURE_MARK_ID)?.name).toBe('Mine')
    expect(isBundledDocument(APERTURE_MARK_ID)).toBe(false)
    const mine = vectorManifest(getVectorDocument(APERTURE_MARK_ID)!)
    expect(mine.collection).toBe('project')
    expect(mine.title).toBe('Projects/Vector')
    // Its source file no longer describes it, so it stops claiming one.
    expect(mine.sourceFile).toBe('Local document')
    expect(mine.tags).toContain('project')
    // And it is listed once, not twice.
    expect(listVectorDocuments().filter((entry) => entry.id === APERTURE_MARK_ID)).toHaveLength(1)
  })

  it('draws itself the way its controls rest', () => {
    const document = getVectorDocument(APERTURE_MARK_ID)!
    const resolved = resolveRigValues(document, rigDefaults(document.rig!))
    const ring = resolved.elements.find((element) => element.id === 'ring')!
    const core = resolved.elements.find((element) => element.id === 'core')!
    expect(ring).toMatchObject({ stroke: '#8CBDA8', strokeWidth: 24, arcSweep: 300 })
    expect(core).toMatchObject({ fill: '#D4E7E1', cornerRadius: 24 })
    // 160 − 24 × 1.5 = 124, through the binding's own expression.
    expect(core.width).toBe(124)
  })

  it('follows a control that is turned', () => {
    const document = getVectorDocument(APERTURE_MARK_ID)!
    const values = { ...rigDefaults(document.rig!), ink: '#FF0000', opening: 120, weight: 40 }
    const resolved = resolveRigValues(document, values)
    const ring = resolved.elements.find((element) => element.id === 'ring')!
    expect(ring).toMatchObject({ stroke: '#FF0000', arcSweep: 120, strokeWidth: 40 })
    expect(resolved.elements.find((element) => element.id === 'core')!.width).toBe(100)
  })
})
