import { describe, expect, it, vi } from 'vitest'
import { BufferGeometry, Mesh, MeshPhysicalMaterial, PerspectiveCamera } from 'three'
import { createSceneDocument } from './model'
import { createSceneInstance } from './engine'
import { createOutlineFontRegistry, type OutlineFont } from './curve/font'
import { createMaterialLibrary } from './viewport/materials'

describe('standalone scene instances', () => {
  it('selects the active document camera and returns to the host orbit view', () => {
    const document = createSceneDocument()
    const active = document.objects.find(object => object.data.kind === 'camera' && object.data.active)!
    document.view.camera = { looking: true }
    const instance = createSceneInstance({ document })
    expect(instance.camera).toBe(instance.cameras.get(active.id))
    instance.setView({ ...document.view, camera: { looking: false } })
    expect(instance.camera).not.toBe(instance.cameras.get(active.id))
    instance.destroy()
  })
  it('shares Three.js identity without installing picking on host prototypes or changing the document', () => {
    const document = createSceneDocument()
    const before = JSON.stringify(document)
    const raycast = Mesh.prototype.raycast
    const bounds = BufferGeometry.prototype.computeBoundsTree
    const first = createSceneInstance({ document })
    const second = createSceneInstance({ document })
    expect(first.camera).toBeInstanceOf(PerspectiveCamera)
    const meshes: Mesh[] = []
    first.scene.traverse(object => { if (object instanceof Mesh) meshes.push(object) })
    expect(meshes.length).toBeGreaterThan(0)
    expect(meshes.every(mesh => mesh.geometry.boundsTree === undefined)).toBe(true)
    expect(Mesh.prototype.raycast).toBe(raycast)
    expect(BufferGeometry.prototype.computeBoundsTree).toBe(bounds)
    first.destroy()
    expect(first.scene.children).toHaveLength(0)
    expect(second.scene.children.length).toBeGreaterThan(0)
    expect(() => first.setTime(1)).toThrow('destroyed')
    expect(JSON.stringify(document)).toBe(before)
    second.destroy()
  })

  it('uses the actual viewport physical materials in material preview', () => {
    const document = createSceneDocument()
    document.view.shading = 'material'
    const source = document.materials[0]!
    source.transmission = 0.6; source.specular = 0.3; source.ior = 1.8
    const instance = createSceneInstance({ document })
    const reference = createMaterialLibrary()
    const expected = reference.materialFor(source)
    const actual: MeshPhysicalMaterial[] = []
    instance.scene.traverse(object => { if (object instanceof Mesh && object.material instanceof MeshPhysicalMaterial) actual.push(object.material) })
    expect(actual.length).toBeGreaterThan(0)
    for (const material of actual) {
      expect(material.transmission).toBe(expected.transmission)
      expect(material.specularIntensity).toBe(expected.specularIntensity)
      expect(material.ior).toBe(expected.ior)
      expect(material.color.getHex()).toBe(expected.color.getHex())
    }
    instance.destroy(); reference.dispose()
  })

  it('removes obsolete geometry and retains a host view while values and time change', () => {
    const document = createSceneDocument()
    const instance = createSceneInstance({ document })
    const view = { ...document.view, yaw: 1.25 }
    instance.setView(view)
    instance.setValues({})
    instance.setTime(1)
    expect(instance.document.view.yaw).toBe(1.25)
    const before: Mesh[] = []
    instance.scene.traverse(object => { if (object instanceof Mesh) before.push(object) })
    const disposed = before.map(mesh => vi.spyOn(mesh.geometry, 'dispose'))
    instance.update({ ...document, objects: document.objects.map(object => ({ ...object, kind: 'empty', data: { kind: 'empty', display: 'plain-axes', size: 1 } })) })
    const after: Mesh[] = []
    instance.scene.traverse(object => { if (object instanceof Mesh) after.push(object) })
    expect(after).toHaveLength(0)
    expect(disposed.every(spy => spy.mock.calls.length > 0)).toBe(true)
    instance.destroy()
  })

  it('waits for texture reads and reports a missing host resource', async () => {
    const document = createSceneDocument()
    document.view.shading = 'material'
    document.materials[0]!.textures = { baseColor: { resourceId: 'missing' } }
    let finish: ((blob: Blob | null) => void) | undefined
    const onError = vi.fn()
    const instance = createSceneInstance({ document, onError, resources: { resource: () => new Promise(resolve => { finish = resolve }) } })
    let ready = false
    void instance.ready.then(() => { ready = true })
    await Promise.resolve()
    expect(ready).toBe(false)
    finish!(null)
    await instance.ready
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Scene resource is unavailable: missing' }))
    expect(instance.errors).toHaveLength(1)
    instance.destroy()
  })

  it('cancels font requests and keeps two same-named fonts independent', async () => {
    const a = createOutlineFontRegistry(), b = createOutlineFontRegistry()
    const font = { getPath: () => ({ commands: [] }), getAdvanceWidth: () => 12 } satisfies OutlineFont
    let finish: ((font: OutlineFont) => void) | undefined
    let signal: AbortSignal | undefined
    const request = a.ensure('Custom', (_family, abort) => { signal = abort; return new Promise(resolve => { finish = resolve }) })
    await Promise.resolve()
    b.register('Custom', font); a.dispose(); finish!(font)
    expect(await request).toBeNull()
    expect(signal?.aborted).toBe(true)
    expect(a.get('Custom')).toBeNull()
    expect(b.get('Custom')).toBe(font)
    b.dispose()
  })
})
