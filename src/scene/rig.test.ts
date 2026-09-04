import { beforeEach, describe, expect, it } from 'vitest'
import { createSceneDocument, DEFAULT_MATERIAL, ROOT_COLLECTION_ID, sanitizeSceneDocument } from '@/scene/document'
import { bezierCircleData, DEFAULT_TEXT } from '@/scene/curve/data'
import { boxMesh } from '@/scene/mesh/primitives'
import '@/scene/modifiers'
import { clearModifierCache, drawnMesh, modifierCacheSize } from '@/scene/modifiers/stack'
import {
  clearSceneRigCache,
  currentSceneValue,
  emptySceneRig,
  parameterForSceneProperty,
  parseSceneProperty,
  resolveSceneValues,
  sanitizeSceneRig,
  sceneRigDefaults,
  sceneRigTargets,
  scenePropertyLabel,
  scenePropertyType,
  SCENE_PROPERTY_PATHS,
  type SceneBinding,
  type SceneRig,
} from '@/scene/rig'
import type { ParamValue } from '@/rigs/types'
import type { Material, SceneDocument, SceneObject } from '@/scene/types'

/**
 * A scene as a rig.
 *
 * Three things are worth testing and the rest follows from them: that a path is read or refused
 * rather than guessed, that resolving writes what the path names and leaves the raw document
 * alone, and that a file's bindings are dropped when what they name is not there.
 */

const MESH = 'mesh-1'

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
    data: { kind: 'mesh', meshId: MESH },
    modifiers: [],
    materialSlots: ['material-default'],
    ...patch,
  }
}

function scene(objects: SceneObject[], rig?: SceneRig, materials: Material[] = [{ ...DEFAULT_MATERIAL }]): SceneDocument {
  return { ...createSceneDocument(), objects, meshes: { [MESH]: boxMesh(2) }, materials, ...(rig ? { rig } : {}) }
}

function rigWith(bindings: SceneBinding[], parameters: SceneRig['parameters'] = []): SceneRig {
  return { ...emptySceneRig(), parameters, bindings }
}

function numberParameter(id: string, defaultValue = 0): SceneRig['parameters'][number] {
  return { kind: 'number', id, label: id, group: 'main', min: -100, max: 100, step: 0.1, defaultValue }
}

/** A document with a rig of its own, for the families whose objects the startup scene already has. */
function rigged(document: SceneDocument, rig: Pick<SceneRig, 'parameters' | 'bindings'>): SceneDocument {
  return { ...document, rig: { ...emptySceneRig(), ...rig } }
}

function binding(patch: Partial<SceneBinding> & { property: string; parameterId: string }): SceneBinding {
  return { id: `binding-${patch.property}`, ...patch }
}

beforeEach(() => {
  clearSceneRigCache()
})

describe('reading a property path', () => {
  it('reads the paths the plan names', () => {
    expect(parseSceneProperty('transform.position.x')).toMatchObject({ kind: 'transform', channel: 'position', axis: 0 })
    expect(parseSceneProperty('transform.rotation.z')).toMatchObject({ kind: 'transform', channel: 'rotation', axis: 2 })
    expect(parseSceneProperty('transform.scale')).toMatchObject({ kind: 'uniformScale' })
    expect(parseSceneProperty('visible')).toMatchObject({ kind: 'visible', type: 'boolean' })
    expect(parseSceneProperty('modifiers[modifier-1].levels')).toMatchObject({ kind: 'modifier', modifierId: 'modifier-1', param: 'levels' })
    expect(parseSceneProperty('materials[material-red].baseColor')).toMatchObject({ kind: 'material', materialId: 'material-red', field: 'baseColor', type: 'color' })
    expect(parseSceneProperty('light.power')).toMatchObject({ kind: 'light', field: 'power' })
    expect(parseSceneProperty('camera.focalLength')).toMatchObject({ kind: 'camera', field: 'focalLength' })
    expect(parseSceneProperty('mesh.vertices[7].y')).toMatchObject({ kind: 'vertex', vertexId: 7, axis: 1 })
    expect(parseSceneProperty('world.strength')).toMatchObject({ kind: 'world', field: 'strength' })
    expect(parseSceneProperty('cursor.position.z')).toMatchObject({ kind: 'cursor', axis: 2 })
  })

  it('says which paths belong to an object and which to the scene', () => {
    expect(parseSceneProperty('transform.position.x')?.scoped).toBe(true)
    expect(parseSceneProperty('light.power')?.scoped).toBe(true)
    expect(parseSceneProperty('world.color')?.scoped).toBe(false)
    expect(parseSceneProperty('materials[m].alpha')?.scoped).toBe(false)
  })

  it('refuses what it does not recognise, rather than guessing', () => {
    expect(parseSceneProperty('transform.position.w')).toBeNull()
    expect(parseSceneProperty('transform.wobble.x')).toBeNull()
    expect(parseSceneProperty('materials[m].shininess')).toBeNull()
    expect(parseSceneProperty('light.wattage')).toBeNull()
    expect(parseSceneProperty('camera.sensor')).toBeNull()
    expect(parseSceneProperty('mesh.vertices[x].y')).toBeNull()
    expect(parseSceneProperty('constructor')).toBeNull()
    expect(parseSceneProperty('')).toBeNull()
  })

  it('reads a shape key by name, and refuses one addressed any other way', () => {
    expect(parseSceneProperty('shapeKeys[Smile].value')).toEqual({ kind: 'shapeKey', name: 'Smile', type: 'number', scoped: true })
    // A name may hold spaces and dots, as Blender's do; what it may not hold is the bracket.
    expect(parseSceneProperty('shapeKeys[Mouth open.001].value')).toMatchObject({ name: 'Mouth open.001' })
    expect(parseSceneProperty('shapeKeys[Smile].min')).toBeNull()
    expect(parseSceneProperty('shapeKeys[].value')).toBeNull()
  })

  it('accepts every path the documentation lists', () => {
    // The docs page renders this table; if a row here stopped parsing, the page would be a lie.
    for (const row of SCENE_PROPERTY_PATHS) {
      const path = row.path
        .replace('<id>', 'thing')
        .replace('<index>', '3')
        .replace('<param>', 'levels')
        .replace('<nodeId>', 'noise-1')
        .replace('<setting>', 'noiseDetail')
      const parsed = parseSceneProperty(path)
      expect(parsed, row.path).not.toBeNull()
      expect(parsed!.scoped, row.path).toBe(row.scope === 'object')
      if (row.takes !== 'its own' && parsed!.type !== null) expect(parsed!.type, row.path).toBe(row.takes)
    }
  })

  it('takes Blender’s spelling of a spot’s blend as well as the document’s', () => {
    expect(parseSceneProperty('light.spotBlend')).toMatchObject({ kind: 'light', field: 'spotBlend' })
    expect(parseSceneProperty('light.spotBlur')).toMatchObject({ kind: 'light', field: 'spotBlur' })
  })

  it('reads a shader node’s own setting, by the node and the setting', () => {
    expect(parseSceneProperty('materials[m-1].nodes[noise-1].noiseDetail')).toMatchObject({
      kind: 'shaderNode',
      materialId: 'm-1',
      nodeId: 'noise-1',
      setting: 'noiseDetail',
      scoped: false,
    })
    // The plain material path still reads as one: the two cannot be confused.
    expect(parseSceneProperty('materials[m-1].roughness')).toMatchObject({ kind: 'material', field: 'roughness' })
  })

  it('drives a node’s setting inside the material’s graph', () => {
    const graph = { version: 2, nodes: [{ id: 'noise-1', type: 'noise-texture', x: 0, y: 0, settings: { noiseDetail: 4 } }], edges: [], frames: [] }
    const document = scene([meshObject('object-1', 'Cube')], undefined, [{ ...DEFAULT_MATERIAL, id: 'm-1', graph }])
    const property = 'materials[m-1].nodes[noise-1].noiseDetail'
    expect(currentSceneValue(document, { objectId: 'object-1', property })).toBe(4)
    const resolved = resolveSceneValues(
      rigged(document, { parameters: [numberParameter('detail', 4)], bindings: [binding({ property, parameterId: 'detail' })] }),
      { detail: 7 },
    )
    const written = resolved.materials[0]!.graph as { nodes: Array<{ settings: { noiseDetail: number } }> }
    expect(written.nodes[0]!.settings.noiseDetail).toBe(7)
    // The graph it was given is not written into: the resolved document is a new one.
    expect(graph.nodes[0]!.settings.noiseDetail).toBe(4)
  })

  it('says nothing about a node the graph has not got', () => {
    const document = scene([meshObject('object-1', 'Cube')], undefined, [{ ...DEFAULT_MATERIAL, id: 'm-1' }])
    expect(currentSceneValue(document, { objectId: 'object-1', property: 'materials[m-1].nodes[ghost].noiseDetail' })).toBeNull()
  })

  it('reads the shape of a curve and what a text object says', () => {
    expect(parseSceneProperty('curve.extrude')).toMatchObject({ kind: 'curve', field: 'extrude', type: 'number' })
    expect(parseSceneProperty('curve.bevelDepth')).toMatchObject({ kind: 'curve', field: 'bevelDepth' })
    expect(parseSceneProperty('curve.bevelResolution')).toMatchObject({ kind: 'curve', field: 'bevelResolution' })
    expect(parseSceneProperty('curve.resolution')).toMatchObject({ kind: 'curve', field: 'resolution' })
    expect(parseSceneProperty('text.text')).toMatchObject({ kind: 'text', field: 'text', type: 'text' })
    expect(parseSceneProperty('text.size')).toMatchObject({ kind: 'text', field: 'size', type: 'number' })
    expect(parseSceneProperty('curve.splines')).toBeNull()
  })
})

describe('driving a curve and a text object', () => {
  function curveObject(): SceneObject {
    return { ...meshObject('curve-1', 'Circle'), kind: 'curve', data: { ...bezierCircleData(), extrude: 0.1 } }
  }

  function textObject(): SceneObject {
    return { ...meshObject('text-1', 'Text'), kind: 'text', data: { ...DEFAULT_TEXT, body: 'One' } }
  }

  it('writes a number into the curve and reads it back', () => {
    const document = scene([curveObject()])
    const resolved = resolveSceneValues(
      rigged(document, { parameters: [numberParameter('depth', 0)], bindings: [binding({ property: 'curve.bevelDepth', parameterId: 'depth', objectId: 'curve-1' })] }),
      { depth: 0.3 },
    )
    expect(resolved.objects[0]!.data).toMatchObject({ kind: 'curve', bevelDepth: 0.3 })
    expect(currentSceneValue(document, { objectId: 'curve-1', property: 'curve.extrude' })).toBe(0.1)
  })

  it('rounds the counts, because half a span is not a span', () => {
    const document = scene([curveObject()])
    const resolved = resolveSceneValues(
      rigged(document, { parameters: [numberParameter('steps', 12)], bindings: [binding({ property: 'curve.resolution', parameterId: 'steps', objectId: 'curve-1' })] }),
      { steps: 7.6 },
    )
    expect(resolved.objects[0]!.data).toMatchObject({ resolution: 8 })
  })

  it('writes what a text object says', () => {
    const document = scene([textObject()])
    const resolved = resolveSceneValues(
      rigged(document, { parameters: [{ kind: 'text', id: 'words', label: 'Words', group: 'main', defaultValue: '' }], bindings: [binding({ property: 'text.text', parameterId: 'words', objectId: 'text-1' })] }),
      { words: 'Two' },
    )
    expect(resolved.objects[0]!.data).toMatchObject({ kind: 'text', body: 'Two' })
    expect(currentSceneValue(document, { objectId: 'text-1', property: 'text.text' })).toBe('One')
  })

  it('leaves an object of the wrong kind alone', () => {
    const document = scene([meshObject('object-1', 'Cube')])
    const resolved = resolveSceneValues(
      rigged(document, { parameters: [numberParameter('depth', 0)], bindings: [binding({ property: 'curve.bevelDepth', parameterId: 'depth', objectId: 'object-1' })] }),
      { depth: 0.3 },
    )
    expect(resolved.objects[0]!.data).toEqual({ kind: 'mesh', meshId: MESH })
  })

  it('names them in a list', () => {
    const document = scene([curveObject(), textObject()])
    expect(scenePropertyLabel(document, { objectId: 'curve-1', property: 'curve.bevelDepth' })).toBe('Circle · Bevel depth')
    expect(scenePropertyLabel(document, { objectId: 'text-1', property: 'text.size' })).toBe('Text · Size')
  })
})

describe('resolving a document', () => {
  it('gives the document straight back when nothing is bound', () => {
    const document = scene([meshObject('object-1', 'Cube')])
    expect(resolveSceneValues(document, {})).toBe(document)
  })

  it('writes a number into a transform, and leaves the raw document alone', () => {
    const document = scene(
      [meshObject('object-1', 'Cube')],
      rigWith([binding({ objectId: 'object-1', property: 'transform.position.z', parameterId: 'height' })], [numberParameter('height')]),
    )
    const resolved = resolveSceneValues(document, { height: 2.5 })
    expect(resolved.objects[0]!.transform.position).toEqual([0, 0, 2.5])
    expect(document.objects[0]!.transform.position).toEqual([0, 0, 0])
  })

  it('scales all three axes from one control', () => {
    const document = scene(
      [meshObject('object-1', 'Cube')],
      rigWith([binding({ objectId: 'object-1', property: 'transform.scale', parameterId: 'size' })], [numberParameter('size', 1)]),
    )
    expect(resolveSceneValues(document, { size: 3 }).objects[0]!.transform.scale).toEqual([3, 3, 3])
  })

  it('puts a control through its transform on the way', () => {
    const document = scene(
      [meshObject('object-1', 'Cube')],
      rigWith(
        [binding({ objectId: 'object-1', property: 'transform.position.x', parameterId: 'slide', transform: { scale: 2, offset: 1, max: 4 } })],
        [numberParameter('slide')],
      ),
    )
    expect(resolveSceneValues(document, { slide: 1 }).objects[0]!.transform.position[0]).toBe(3)
    // The clamp is the last word: two times three plus one is seven, and the maximum is four.
    expect(resolveSceneValues(document, { slide: 3 }).objects[0]!.transform.position[0]).toBe(4)
  })

  it('reads an expression over the control’s own value', () => {
    const document = scene(
      [meshObject('object-1', 'Cube')],
      rigWith(
        [binding({ objectId: 'object-1', property: 'transform.rotation.z', parameterId: 'turn', transform: { expression: 'value * 90' } })],
        [numberParameter('turn')],
      ),
    )
    expect(resolveSceneValues(document, { turn: 2 }).objects[0]!.transform.rotation[2]).toBe(180)
  })

  it('writes a modifier’s parameter in the shape its own schema declares', () => {
    const object = meshObject('object-1', 'Cube', {
      modifiers: [{
        id: 'modifier-1',
        kind: 'subsurf',
        name: 'Subdivision',
        enabled: { viewport: true, render: true, editMode: true, onCage: false },
        params: { levels: 1 },
      }],
    })
    const document = scene(
      [object],
      rigWith([binding({ objectId: 'object-1', property: 'modifiers[modifier-1].levels', parameterId: 'detail' })], [numberParameter('detail', 1)]),
    )
    const resolved = resolveSceneValues(document, { detail: 3 })
    expect(resolved.objects[0]!.modifiers[0]!.params.levels).toBe(3)
    // A switch takes a boolean rather than the number a slider would send.
    const simple = resolveSceneValues(
      scene([object], rigWith([binding({ objectId: 'object-1', property: 'modifiers[modifier-1].simple', parameterId: 'flat' })], [{ kind: 'switch', id: 'flat', label: 'Flat', group: 'main', defaultValue: false }])),
      { flat: true },
    )
    expect(simple.objects[0]!.modifiers[0]!.params.simple).toBe(true)
  })

  it('writes a material, which every object that names it then wears', () => {
    const document = scene(
      [meshObject('object-1', 'Cube'), meshObject('object-2', 'Other')],
      rigWith([binding({ property: 'materials[material-default].baseColor', parameterId: 'tint' })], [{ kind: 'color', id: 'tint', label: 'Tint', group: 'main', defaultValue: '#ffffff' }]),
    )
    expect(resolveSceneValues(document, { tint: '#ff0000' }).materials[0]!.baseColor).toBe('#ff0000')
  })

  it('moves one vertex of a mesh without touching the others', () => {
    const document = scene([meshObject('object-1', 'Cube')])
    const vertexId = document.meshes[MESH]!.vertexIds[0]!
    const rigged = { ...document, rig: rigWith([binding({ objectId: 'object-1', property: `mesh.vertices[${vertexId}].z`, parameterId: 'lift' })], [numberParameter('lift')]) }
    const resolved = resolveSceneValues(rigged, { lift: 5 })
    expect(resolved.meshes[MESH]!.vertices[2]).toBe(5)
    expect(document.meshes[MESH]!.vertices[2]).not.toBe(5)
    expect(resolved.meshes[MESH]!.vertices[5]).toBe(document.meshes[MESH]!.vertices[5])
  })

  it('writes the world and the cursor, which belong to no object', () => {
    const document = scene(
      [meshObject('object-1', 'Cube')],
      rigWith(
        [
          binding({ property: 'world.strength', parameterId: 'sky' }),
          binding({ property: 'cursor.position.x', parameterId: 'here' }),
        ],
        [numberParameter('sky', 1), numberParameter('here')],
      ),
    )
    const resolved = resolveSceneValues(document, { sky: 4, here: -2 })
    expect(resolved.world.strength).toBe(4)
    expect(resolved.cursor.position[0]).toBe(-2)
  })

  it('writes a light’s watts and a camera’s focal length', () => {
    const document = createSceneDocument()
    const light = document.objects.find((object) => object.kind === 'light')!
    const camera = document.objects.find((object) => object.kind === 'camera')!
    const resolved = resolveSceneValues(rigged(document, {
      parameters: [
        { kind: 'number', id: 'watts', label: 'Watts', group: 'main', min: 0, max: 2000, step: 1, defaultValue: 100 },
        { kind: 'number', id: 'lens', label: 'Lens', group: 'main', min: 10, max: 200, step: 1, defaultValue: 50 },
      ],
      bindings: [
        { id: 'b1', objectId: light.id, property: 'light.power', parameterId: 'watts' },
        { id: 'b2', objectId: camera.id, property: 'camera.focalLength', parameterId: 'lens' },
      ],
    }), { watts: 250, lens: 85 })
    const lit = resolved.objects.find((object) => object.id === light.id)!
    const seen = resolved.objects.find((object) => object.id === camera.id)!
    expect(lit.data.kind === 'light' && lit.data.power).toBe(250)
    expect(seen.data.kind === 'camera' && seen.data.focalLength).toBe(85)
  })

  it('turns an object off with a switch', () => {
    const document = createSceneDocument()
    const cube = document.objects[0]!
    const rig = rigged(document, {
      parameters: [{ kind: 'switch', id: 'shown', label: 'Shown', group: 'main', defaultValue: true }],
      bindings: [{ id: 'b1', objectId: cube.id, property: 'visible', parameterId: 'shown' }],
    })
    expect(resolveSceneValues(rig, { shown: false }).objects[0]!.visible).toBe(false)
    expect(resolveSceneValues(rig, { shown: true }).objects[0]!.visible).toBe(true)
  })

  it('lets the last binding on a property win', () => {
    const document = scene(
      [meshObject('object-1', 'Cube')],
      rigWith(
        [
          binding({ id: 'binding-a', objectId: 'object-1', property: 'transform.position.x', parameterId: 'first' }),
          binding({ id: 'binding-b', objectId: 'object-1', property: 'transform.position.x', parameterId: 'second' }),
        ],
        [numberParameter('first'), numberParameter('second')],
      ),
    )
    expect(resolveSceneValues(document, { first: 1, second: 9 }).objects[0]!.transform.position[0]).toBe(9)
  })

  it('skips a binding whose control is not in the rig', () => {
    const document = scene(
      [meshObject('object-1', 'Cube')],
      rigWith([binding({ objectId: 'object-1', property: 'transform.position.x', parameterId: 'gone' })], []),
    )
    expect(resolveSceneValues(document, { gone: 5 }).objects[0]!.transform.position[0]).toBe(0)
  })

  it('re-uses the evaluated mesh when a control comes back to a value it has held', () => {
    // A control dragged out and back is the common case, and it must not re-subdivide on the way.
    const object = meshObject('object-1', 'Cube', {
      modifiers: [{
        id: 'modifier-1',
        kind: 'subsurf',
        name: 'Subdivision',
        enabled: { viewport: true, render: true, editMode: true, onCage: false },
        params: { levels: 1, renderLevels: 2, simple: false, optimalDisplay: false, boundarySmooth: 'all', useCreases: true },
      }],
    })
    const document = scene([object], rigWith(
      [binding({ objectId: 'object-1', property: 'modifiers[modifier-1].levels', parameterId: 'detail' })],
      [numberParameter('detail', 1)],
    ))
    clearModifierCache()
    const at = (levels: number) => {
      const resolved = resolveSceneValues(document, { detail: levels })
      return drawnMesh(resolved, resolved.objects[0]!)
    }
    const one = at(1)
    const two = at(2)
    expect(modifierCacheSize()).toBe(2)
    expect(two!.vertices.length).toBeGreaterThan(one!.vertices.length)
    // Back to one: the same mesh object, and no third entry in the cache.
    expect(at(1)).toBe(one)
    expect(modifierCacheSize()).toBe(2)
  })

  it('answers the same object for the same values, so a drag costs one evaluation', () => {
    const document = scene(
      [meshObject('object-1', 'Cube')],
      rigWith([binding({ objectId: 'object-1', property: 'transform.position.x', parameterId: 'slide' })], [numberParameter('slide')]),
    )
    const first = resolveSceneValues(document, { slide: 1 })
    expect(resolveSceneValues(document, { slide: 1 })).toBe(first)
    expect(resolveSceneValues(document, { slide: 2 })).not.toBe(first)
  })
})

describe('what a control starts at', () => {
  it('reads the value the scene has today', () => {
    const document = scene([meshObject('object-1', 'Cube', { transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } })])
    expect(currentSceneValue(document, { objectId: 'object-1', property: 'transform.position.y' })).toBe(2)
    expect(currentSceneValue(document, { objectId: 'object-1', property: 'visible' })).toBe(true)
    expect(currentSceneValue(document, { property: 'world.color' })).toBe(document.world.color)
  })

  it('builds a control whose bounds come from the modifier’s own schema', () => {
    const object = meshObject('object-1', 'Cube', {
      modifiers: [{
        id: 'modifier-1',
        kind: 'subsurf',
        name: 'Subdivision',
        enabled: { viewport: true, render: true, editMode: true, onCage: false },
        params: { levels: 2 },
      }],
    })
    const document = scene([object])
    const parameter = parameterForSceneProperty({
      id: 'detail',
      label: 'Detail',
      group: 'main',
      document,
      binding: { objectId: 'object-1', property: 'modifiers[modifier-1].levels' },
    })
    expect(parameter).toMatchObject({ kind: 'number', min: 0, max: 6, step: 1, defaultValue: 2 })
  })

  it('names a control after what it drives', () => {
    const object = meshObject('object-1', 'Cube', {
      modifiers: [{
        id: 'modifier-1',
        kind: 'subsurf',
        name: 'Subdivision',
        enabled: { viewport: true, render: true, editMode: true, onCage: false },
        params: {},
      }],
    })
    const document = scene([object])
    expect(scenePropertyLabel(document, { objectId: 'object-1', property: 'modifiers[modifier-1].levels' }))
      .toBe('Cube · Subdivision levels viewport')
    expect(scenePropertyLabel(document, { objectId: 'object-1', property: 'transform.position.x' })).toBe('Cube · Location X')
    expect(scenePropertyLabel(document, { property: 'world.strength' })).toBe('World strength')
  })

  it('knows a modifier parameter’s type from the module rather than from the path', () => {
    const object = meshObject('object-1', 'Cube', {
      modifiers: [{
        id: 'modifier-1',
        kind: 'subsurf',
        name: 'Subdivision',
        enabled: { viewport: true, render: true, editMode: true, onCage: false },
        params: {},
      }],
    })
    const document = scene([object])
    expect(scenePropertyType(document, { objectId: 'object-1', property: 'modifiers[modifier-1].levels' })).toBe('number')
    expect(scenePropertyType(document, { objectId: 'object-1', property: 'modifiers[modifier-1].simple' })).toBe('boolean')
    expect(scenePropertyType(document, { objectId: 'object-1', property: 'modifiers[modifier-1].nothing' })).toBeNull()
  })
})

describe('reading a rig from a file', () => {
  const targets = (document: SceneDocument) => sceneRigTargets(document)

  it('keeps a binding whose ends both exist', () => {
    const document = scene([meshObject('object-1', 'Cube')])
    const rig = sanitizeSceneRig({
      groups: [{ id: 'main', label: 'Main' }],
      parameters: [numberParameter('slide')],
      bindings: [{ id: 'b1', objectId: 'object-1', property: 'transform.position.x', parameterId: 'slide' }],
    }, targets(document))
    expect(rig?.bindings).toHaveLength(1)
  })

  it('drops one whose object, control, modifier or vertex is not there', () => {
    const document = scene([meshObject('object-1', 'Cube')])
    const rig = sanitizeSceneRig({
      groups: [{ id: 'main', label: 'Main' }],
      parameters: [numberParameter('slide')],
      bindings: [
        { objectId: 'object-elsewhere', property: 'transform.position.x', parameterId: 'slide' },
        { objectId: 'object-1', property: 'transform.position.x', parameterId: 'nothing' },
        { objectId: 'object-1', property: 'modifiers[modifier-gone].levels', parameterId: 'slide' },
        { objectId: 'object-1', property: 'mesh.vertices[9999].x', parameterId: 'slide' },
        { objectId: 'object-1', property: 'transform.wobble', parameterId: 'slide' },
        { property: 'materials[material-elsewhere].alpha', parameterId: 'slide' },
      ],
    }, targets(document))
    expect(rig?.bindings).toEqual([])
  })

  it('refuses a rig with no group to put a control in', () => {
    const document = scene([meshObject('object-1', 'Cube')])
    expect(sanitizeSceneRig({ parameters: [numberParameter('slide')], bindings: [] }, targets(document))).toBeUndefined()
  })

  it('fills in a material binding’s own id from its path', () => {
    const document = scene([meshObject('object-1', 'Cube')])
    const rig = sanitizeSceneRig({
      groups: [{ id: 'main', label: 'Main' }],
      parameters: [{ kind: 'color', id: 'tint', label: 'Tint', group: 'main', defaultValue: '#ffffff' }],
      bindings: [{ property: 'materials[material-default].baseColor', parameterId: 'tint' }],
    }, targets(document))
    expect(rig?.bindings[0]).toMatchObject({ materialId: 'material-default' })
  })

  it('lets the richer control kinds through, which a scene needs and a drawing does not', () => {
    const document = scene([meshObject('object-1', 'Cube')])
    const rig = sanitizeSceneRig({
      groups: [{ id: 'main', label: 'Main' }],
      parameters: [{ kind: 'gizmo3d', id: 'place', label: 'Place', group: 'main', defaultValue: { position: [0, 0, 0] } }],
      bindings: [],
    }, targets(document))
    expect(rig?.parameters[0]).toMatchObject({ kind: 'gizmo3d', id: 'place' })
  })

  it('survives the document sanitiser, bindings and all', () => {
    const document = scene(
      [meshObject('object-1', 'Cube')],
      rigWith([binding({ objectId: 'object-1', property: 'transform.position.x', parameterId: 'slide' })], [numberParameter('slide')]),
    )
    const read = sanitizeSceneDocument(JSON.parse(JSON.stringify(document)))
    expect(read?.rig?.bindings).toHaveLength(1)
    expect(read?.rig?.parameters).toHaveLength(1)
  })
})

describe('the defaults a rig starts from', () => {
  it('answers every control’s own default', () => {
    const rig = rigWith([], [numberParameter('slide', 3), { kind: 'color', id: 'tint', label: 'Tint', group: 'main', defaultValue: '#123456' }])
    expect(sceneRigDefaults(rig)).toEqual({ slide: 3, tint: '#123456' } satisfies Record<string, ParamValue>)
  })
})
