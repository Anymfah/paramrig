import { describe, expect, it } from 'vitest'
import { createSceneDocument, ROOT_COLLECTION_ID } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import {
  elementAnnouncement,
  modeAnnouncement,
  operatorAnnouncement,
  selectionAnnouncement,
  selectModeAnnouncement,
  toolAnnouncement,
} from '@/scene/announce'
import type { SceneDocument, SceneObject } from '@/scene/types'

/**
 * The sentences a screen reader is given. They are short and lead with the name, because a live
 * region is read from the beginning and interrupting it is the listener's own business.
 */

const MESH = 'mesh-1'

function object(id: string, name: string, position: [number, number, number] = [0, 0, 0]): SceneObject {
  return {
    id,
    name,
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: MESH },
    modifiers: [],
    materialSlots: [],
  }
}

function scene(objects: SceneObject[]): SceneDocument {
  return { ...createSceneDocument(), objects, meshes: { [MESH]: boxMesh(2) } }
}

describe('what the editor says about the selection', () => {
  it('names one object, its size and where it is', () => {
    const document = scene([object('a', 'Cube', [1, 0, 0.5])])
    expect(selectionAnnouncement(document, { objectIds: ['a'], activeObjectId: 'a' }))
      .toBe('Cube, 8 vertices, at 1, 0, 0.5')
  })

  it('counts several rather than reading them all out', () => {
    const document = scene([object('a', 'Cube'), object('b', 'Sphere')])
    expect(selectionAnnouncement(document, { objectIds: ['a', 'b'], activeObjectId: 'b' }))
      .toBe('2 objects selected')
  })

  it('says so when there is nothing', () => {
    expect(selectionAnnouncement(scene([]), { objectIds: [], activeObjectId: null })).toBe('Nothing selected')
  })

  it('rounds a position to the millimetre', () => {
    const document = scene([object('a', 'Cube', [1.23456, 0, 0])])
    expect(selectionAnnouncement(document, { objectIds: ['a'], activeObjectId: 'a' })).toContain('at 1.235, 0, 0')
  })
})

describe('what it says about the rest', () => {
  it('counts the elements of the kind being selected', () => {
    const counts = { vertices: 3, edges: 2, faces: 1 }
    expect(elementAnnouncement(counts, ['vertex'])).toBe('3 vertices selected')
    expect(elementAnnouncement(counts, ['edge'])).toBe('2 edges selected')
    expect(elementAnnouncement(counts, ['face'])).toBe('1 face selected')
    expect(elementAnnouncement({ vertices: 0, edges: 0, faces: 0 }, ['vertex'])).toBe('No vertex selected')
  })

  it('names the mode, the select mode and the tool', () => {
    expect(modeAnnouncement('edit')).toBe('Edit mode')
    expect(selectModeAnnouncement(['face'])).toBe('Face select')
    expect(selectModeAnnouncement(['vertex', 'edge'])).toBe('vertex and edge select')
    expect(toolAnnouncement('loop-cut')).toBe('Loop cut tool')
  })

  it('says what an operator did, and to how much', () => {
    expect(operatorAnnouncement('Extrude region')).toBe('Extrude region')
    expect(operatorAnnouncement('Delete', { objects: 2 })).toBe('Delete, 2 objects')
  })
})
