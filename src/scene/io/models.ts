import { sanitizeSceneDocument, uniqueName } from '@/scene/model'
import { exportGltf, importGltf, type ImportedScene } from '@/scene/io/gltf'
import { readObj, writeObj } from '@/scene/io/obj'
import { readStl, writeStl } from '@/scene/io/stl'
import { worldMatrix } from '@/scene/objects'
import { drawnMesh } from '@/scene/modifiers/stack'
import { DEFAULT_MATERIAL, ROOT_COLLECTION_ID } from '@/scene/model'
import type { Material, SceneDocument, SceneObject, Vec3 } from '@/scene/types'

/**
 * The formats, as the editor offers them.
 *
 * Each reader and writer lives in its own module and knows nothing about a document; this is where
 * a `File` becomes objects and a document becomes something to download. It is also the one place
 * that decides what an import means: everything arrives at the 3D cursor, selected and active, so
 * that the next thing a person does — move it, scale it — happens to what they just brought in.
 */

export type ModelFormat = 'gltf' | 'obj' | 'stl'

export type ExportOptions = {
  /** Only these objects; everything visible when it is not given. */
  objectIds?: string[]
  /** Write each mesh with its modifiers applied rather than the cage a person edits. */
  applyModifiers?: boolean
}

/** What a file's name says it is, or null for a name this editor has no reader for. */
export function formatOf(fileName: string): ModelFormat | null {
  const extension = fileName.toLowerCase().split('.').pop() ?? ''
  if (extension === 'glb' || extension === 'gltf') return 'gltf'
  if (extension === 'obj') return 'obj'
  if (extension === 'stl') return 'stl'
  return null
}

/** The accept list for a file input, which is the same list in the browser's own spelling. */
export const MODEL_ACCEPT = '.glb,.gltf,.obj,.stl'

/* ------------------------------------------------------------------ import */

export async function readModelFile(file: File): Promise<ImportedScene> {
  const format = formatOf(file.name)
  if (!format) throw new Error(`${file.name} is not a model this editor reads: glTF, OBJ or STL.`)
  if (format === 'gltf') return importGltf(await file.arrayBuffer())
  if (format === 'stl') {
    const mesh = readStl(await file.arrayBuffer())
    const meshId = `mesh-${crypto.randomUUID()}`
    return {
      objects: [meshObject(baseName(file.name), meshId, ['material-imported'])],
      meshes: { [meshId]: mesh },
      materials: [{ ...DEFAULT_MATERIAL, id: 'material-imported', name: baseName(file.name) }],
    }
  }
  const read = readObj(await file.text())
  const meshes: Record<string, ReturnType<typeof readStl>> = {}
  const materials: Material[] = []
  const objects = read.objects.map((entry) => {
    const meshId = `mesh-${crypto.randomUUID()}`
    meshes[meshId] = entry.mesh
    const slots = entry.materials.map((name) => {
      const seen = materials.find((material) => material.name === name)
      if (seen) return seen.id
      const material: Material = { ...DEFAULT_MATERIAL, id: `material-${crypto.randomUUID()}`, name }
      materials.push(material)
      return material.id
    })
    return meshObject(entry.name, meshId, slots.length > 0 ? slots : ['material-imported'])
  })
  if (materials.length === 0) materials.push({ ...DEFAULT_MATERIAL, id: 'material-imported', name: baseName(read.materialLibrary ?? 'Imported') })
  return { objects, meshes, materials }
}

/**
 * The imported scene put into a document, at the 3D cursor, selected.
 *
 * Names are made unique against what is already there rather than replacing it: importing the same
 * file twice gives Cube and Cube.001, which is what every other part of this editor does — and the
 * whole thing goes through the sanitiser, because a file from elsewhere is exactly the input the
 * sanitiser exists for.
 */
export function withImported(document: SceneDocument, imported: ImportedScene): { document: SceneDocument; objectIds: string[] } {
  const taken = document.objects.map((object) => object.name)
  const cursor = document.cursor.position
  const objects = imported.objects.map((object) => {
    const name = uniqueName(taken, object.name)
    taken.push(name)
    return {
      ...object,
      name,
      // Only the roots move to the cursor: a child is placed by its parent.
      transform: object.parentId
        ? object.transform
        : {
          ...object.transform,
          position: [
            object.transform.position[0] + cursor[0],
            object.transform.position[1] + cursor[1],
            object.transform.position[2] + cursor[2],
          ] as Vec3,
        },
    }
  })
  const next = sanitizeSceneDocument({
    ...document,
    objects: [...document.objects, ...objects],
    meshes: { ...document.meshes, ...imported.meshes },
    materials: [...document.materials, ...imported.materials],
  }) ?? document
  return { document: next, objectIds: objects.map((object) => object.id) }
}

/* ------------------------------------------------------------------ export */

export async function writeModel(
  document: SceneDocument,
  format: ModelFormat,
  options: ExportOptions = {},
): Promise<{ blob: Blob; fileName: string }> {
  const name = document.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'scene'
  const wanted = options.objectIds ? new Set(options.objectIds) : null
  const meshes = document.objects.filter((object) => (
    object.data.kind === 'mesh' && (wanted ? wanted.has(object.id) : object.visible)
  ))

  if (format === 'gltf') {
    const data = await exportGltf(document, { objectIds: options.objectIds, applyModifiers: options.applyModifiers })
    return {
      blob: new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' }),
      fileName: `${name}.glb`,
    }
  }

  if (format === 'stl') {
    const parts = meshes.flatMap((object) => {
      const mesh = meshFor(document, object, options)
      return mesh ? [{ mesh, matrix: worldMatrix(document, object).toArray() }] : []
    })
    return { blob: new Blob([writeStl(parts, { name })], { type: 'model/stl' }), fileName: `${name}.stl` }
  }

  const { obj } = writeObj(
    meshes.flatMap((object) => {
      const mesh = meshFor(document, object, options)
      return mesh
        ? [{
          name: object.name,
          mesh,
          materials: object.materialSlots.map((id) => document.materials.find((material) => material.id === id)),
          matrix: worldMatrix(document, object).toArray(),
        }]
        : []
    }),
    { materialLibrary: `${name}.mtl` },
  )
  return { blob: new Blob([obj], { type: 'model/obj' }), fileName: `${name}.obj` }
}

/** The .mtl beside an OBJ, written as its own file because that is how OBJ carries colour. */
export async function writeMaterialLibrary(document: SceneDocument, options: ExportOptions = {}): Promise<{ blob: Blob; fileName: string }> {
  const name = document.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'scene'
  const wanted = options.objectIds ? new Set(options.objectIds) : null
  const used = new Set<string>()
  for (const object of document.objects) {
    if (wanted ? !wanted.has(object.id) : !object.visible) continue
    for (const slot of object.materialSlots) used.add(slot)
  }
  const { writeMtl } = await import('@/scene/io/obj')
  const materials = document.materials.filter((material) => used.has(material.id))
  return { blob: new Blob([writeMtl(materials)], { type: 'model/mtl' }), fileName: `${name}.mtl` }
}

function meshFor(document: SceneDocument, object: SceneObject, options: ExportOptions) {
  if (object.data.kind !== 'mesh') return null
  return options.applyModifiers === false ? document.meshes[object.data.meshId] ?? null : drawnMesh(document, object)
}

function meshObject(name: string, meshId: string, materialSlots: string[]): SceneObject {
  return {
    id: `object-${crypto.randomUUID()}`,
    name,
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId },
    modifiers: [],
    materialSlots,
  }
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'Imported'
}

/** Hands a blob to the browser as a download, which is the only way a page can offer a file. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(href)
}
