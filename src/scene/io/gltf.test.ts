import { Mesh, PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import { createSceneDocument, DEFAULT_MATERIAL, ROOT_COLLECTION_ID } from '@/scene/document'
import { initializeBuiltinModifiers } from '@/scene/modifiers'
initializeBuiltinModifiers()
import { animationClips, buildScene, readScene } from '@/scene/io/gltf'
import { meshCounts } from '@/scene/mesh/data'
import { boxMesh } from '@/scene/mesh/primitives'
import type { Material, SceneDocument, SceneObject } from '@/scene/types'

/**
 * The exporter itself is three's, so what is worth testing is the scene handed to it: that it holds
 * the objects and no more, that the hierarchy survives, that a mesh of several materials arrives as
 * groups — and that a scene read back turns into a document with meshes an operator could edit.
 */

function meshObject(id: string, name: string, patch: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    name,
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: 'mesh-1' },
    modifiers: [],
    materialSlots: ['material-default'],
    ...patch,
  }
}

function scene(objects: SceneObject[], materials: Material[] = [{ ...DEFAULT_MATERIAL }]): SceneDocument {
  return { ...createSceneDocument(), objects, meshes: { 'mesh-1': boxMesh(2) }, materials }
}

describe('the scene handed to the exporter', () => {
  it('writes one node per object, named as the document names it', () => {
    const built = buildScene(scene([meshObject('object-1', 'Cube')]))
    expect(built.children).toHaveLength(1)
    expect(built.children[0]!.name).toBe('Cube')
  })

  it('keeps a parent and its child as a parent and its child', () => {
    const built = buildScene(scene([
      meshObject('object-1', 'Parent'),
      meshObject('object-2', 'Child', { parentId: 'object-1' }),
    ]))
    expect(built.children).toHaveLength(1)
    expect(built.children[0]!.children.map((node) => node.name)).toEqual(['Child'])
  })

  it('triangulates the mesh, since glTF has no n-gons', () => {
    const built = buildScene(scene([meshObject('object-1', 'Cube')]))
    const mesh = built.children[0] as Mesh
    // A cube of six quads is twelve triangles, three corners each.
    expect(mesh.geometry.getAttribute('position').count).toBe(36)
  })

  it('gives a mesh of two materials a group each, and the materials to match', () => {
    const document = scene(
      [meshObject('object-1', 'Cube', { materialSlots: ['material-default', 'material-red'] })],
      [{ ...DEFAULT_MATERIAL }, { ...DEFAULT_MATERIAL, id: 'material-red', name: 'Red', baseColor: '#ff0000' }],
    )
    const mesh = document.meshes['mesh-1']!
    for (let face = 0; face < mesh.faceIds.length; face += 1) mesh.attributes.face.material[face] = face % 2
    const built = buildScene(document)
    const node = built.children[0] as Mesh
    expect(Array.isArray(node.material)).toBe(true)
    expect((node.material as unknown[]).length).toBe(2)
    expect(node.geometry.groups.length).toBeGreaterThanOrEqual(2)
  })

  it('writes only what was asked for when a selection is given', () => {
    const built = buildScene(
      scene([meshObject('object-1', 'Cube'), meshObject('object-2', 'Other')]),
      { objectIds: ['object-2'] },
    )
    expect(built.children.map((node) => node.name)).toEqual(['Other'])
  })

  it('leaves a hidden object out unless it was named', () => {
    const built = buildScene(scene([meshObject('object-1', 'Cube', { visible: false })]))
    expect(built.children).toHaveLength(0)
  })

  it('writes the camera as a camera, with the focal length as a field of view', () => {
    const document = createSceneDocument()
    const camera = document.objects.find((object) => object.data.kind === 'camera')!
    const built = buildScene(document, { objectIds: [camera.id] })
    const node = built.children[0] as PerspectiveCamera
    expect(node.isCamera).toBe(true)
    // A 50 mm lens on a 36 mm sensor: about 39.6°.
    expect(node.fov).toBeCloseTo(39.6, 0)
  })

  it('applies the modifiers unless it is told not to', () => {
    const document = scene([meshObject('object-1', 'Cube', {
      modifiers: [{
        id: 'modifier-1',
        kind: 'subsurf',
        name: 'Subdivision',
        enabled: { viewport: true, render: true, editMode: true, onCage: false },
        params: { levels: 1 },
      }],
    })])
    const applied = buildScene(document).children[0] as Mesh
    const cage = buildScene(document, { applyModifiers: false }).children[0] as Mesh
    expect(applied.geometry.getAttribute('position').count).toBeGreaterThan(cage.geometry.getAttribute('position').count)
  })
})

describe('reading a scene back', () => {
  it('welds the triangles into a mesh that can be edited', () => {
    const built = buildScene(scene([meshObject('object-1', 'Cube')]))
    const read = readScene(built)
    expect(read.objects).toHaveLength(1)
    const mesh = Object.values(read.meshes)[0]!
    // Thirty-six corners in the file, eight vertices in the document.
    expect(meshCounts(mesh)).toMatchObject({ vertices: 8, faces: 12 })
  })

  it('brings the materials with it', () => {
    const built = buildScene(scene(
      [meshObject('object-1', 'Cube', { materialSlots: ['material-red'] })],
      [{ ...DEFAULT_MATERIAL, id: 'material-red', name: 'Red', baseColor: '#ff0000', roughness: 0.25 }],
    ))
    const read = readScene(built)
    expect(read.materials.map((material) => material.name)).toEqual(['Red'])
    expect(read.materials[0]!.baseColor).toBe('#ff0000')
    expect(read.materials[0]!.roughness).toBeCloseTo(0.25, 5)
  })

  it('keeps the hierarchy it was given', () => {
    const built = buildScene(scene([
      meshObject('object-1', 'Parent'),
      meshObject('object-2', 'Child', { parentId: 'object-1' }),
    ]))
    const read = readScene(built)
    const parent = read.objects.find((object) => object.name === 'Parent')!
    const child = read.objects.find((object) => object.name === 'Child')!
    expect(child.parentId).toBe(parent.id)
  })

  it('reads a node’s place, and says which Euler order the numbers are in', () => {
    const built = buildScene(scene([meshObject('object-1', 'Cube', {
      transform: { position: [1, 2, 3], rotation: [0, 0, 90], scale: [1, 1, 1] },
    })]))
    const read = readScene(built)
    expect(read.objects[0]!.transform.position).toEqual([1, 2, 3])
    expect(read.objects[0]!.transform.rotationMode).toBe('ZYX')
    expect(read.objects[0]!.transform.rotation[2]).toBeCloseTo(90, 4)
  })
})

describe('the animation the export carries', () => {
  /** A scene whose cube's X location is keyed from 0 to 4 over two seconds. */
  function keyed(): SceneDocument {
    const base = createSceneDocument()
    const cube = base.objects.find((object) => object.kind === 'mesh')!
    return {
      ...base,
      rig: {
        groups: [{ id: 'main', label: 'Main' }],
        parameters: [{ kind: 'number', id: 'slide', label: 'Slide', group: 'main', min: -10, max: 10, step: 0.1, defaultValue: 0 }],
        bindings: [{ id: 'binding-1', objectId: cube.id, property: 'transform.position.x', parameterId: 'slide' }],
        animation: {
          duration: 2,
          fps: 10,
          loop: false,
          tracks: [{
            paramId: 'slide',
            interpolation: 'linear',
            keyframes: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 2, value: 4 }],
          }],
        },
      },
    }
  }

  it('bakes a keyed control into a clip of node transforms', () => {
    const clips = animationClips(keyed())
    expect(clips).toHaveLength(1)
    expect(clips[0]!.duration).toBe(2)
    const position = clips[0]!.tracks.find((track) => track.name.endsWith('.position'))!
    expect(position).toBeTruthy()
    // Twenty-one samples for two seconds at ten a second, from nought to four.
    expect(position.times).toHaveLength(21)
    expect(position.values[0]).toBeCloseTo(0, 6)
    expect(position.values[position.values.length - 3]).toBeCloseTo(4, 6)
  })

  it('writes nothing for the objects that never move', () => {
    const clips = animationClips(keyed())
    const names = new Set(clips[0]!.tracks.map((track) => track.name.split('.')[0]))
    expect(names.size).toBe(1)
  })

  it('has no animation to write when nothing is keyed', () => {
    expect(animationClips(createSceneDocument())).toEqual([])
  })
})
