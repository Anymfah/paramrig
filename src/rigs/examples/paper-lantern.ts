import { DEFAULT_UNITS, DEFAULT_VIEW, ROOT_COLLECTION_ID, ROOT_COLLECTION_NAME } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import type { SceneDocument } from '@/scene/types'

/**
 * The example scene: a paper lantern whose shape, thickness, colour and spin are controls.
 *
 * It exists to be read as much as looked at. Every family of binding the resolver understands is
 * used exactly once — a modifier parameter, a material field, a transform channel, a light's power
 * — so that anyone building a rig, a person or a model, has one worked example of each rather than
 * a page of prose about them. The document is built in code rather than stored as JSON because it
 * has to keep working when the mesh format moves; `boxMesh` is the same primitive the editor adds.
 *
 * It is a document, not a template: opening it and moving something saves a copy under the same id
 * in browser storage, and from then on the stored one is what is served.
 *
 * It is built by a function rather than written as a constant because the store imports it and it
 * imports the store's own defaults: a constant would be evaluated while the store was still being
 * defined, and read a `DEFAULT_VIEW` that did not exist yet.
 */

const MESH_ID = 'mesh-lantern'
const OBJECT_ID = 'object-lantern'
const MATERIAL_ID = 'material-paper'
const LIGHT_ID = 'object-lamp'

/** Fixed, because a bundled document that changed every time it was read would never be the same. */
const MADE = '2026-09-04T00:00:00.000Z'

export function paperLantern(): SceneDocument {
  return {
    version: 1,
    id: 'example-paper-lantern',
    name: 'Paper lantern',
    objects: [
      {
        id: OBJECT_ID,
        name: 'Lantern',
        kind: 'mesh',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [0, 0, 1.1], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'mesh', meshId: MESH_ID },
        modifiers: [
          {
            id: 'modifier-round',
            kind: 'subsurf',
            name: 'Subdivision',
            enabled: { viewport: true, render: true, editMode: false, onCage: false },
            params: { levels: 2, renderLevels: 3, simple: false, optimalDisplay: true, boundarySmooth: 'all', useCreases: true },
          },
          {
            id: 'modifier-paper',
            kind: 'solidify',
            name: 'Solidify',
            enabled: { viewport: true, render: true, editMode: false, onCage: false },
            params: { thickness: 0.06, offset: -1, even: true, rim: true, onlyRim: false, flipNormals: false, materialOffset: 0, crease: 0 },
          },
        ],
        materialSlots: [MATERIAL_ID],
      },
      {
        id: LIGHT_ID,
        name: 'Lamp',
        kind: 'light',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [0, 0, 1.1], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        selectable: true,
        renderable: true,
        data: {
          kind: 'light',
          light: 'point',
          color: '#ffd9a0',
          power: 60,
          radius: 0.25,
          spotAngle: 45,
          spotBlur: 0.15,
          areaShape: 'square',
          areaSize: [1, 1],
          shadow: true,
        },
        modifiers: [],
        materialSlots: [],
      },
      {
        id: 'object-view',
        name: 'Camera',
        kind: 'camera',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [5.2, -4.9, 3.4], rotation: [66, 0, 46.7], scale: [1, 1, 1] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'camera', projection: 'perspective', focalLength: 50, sensor: 36, orthoScale: 6, clipStart: 0.1, clipEnd: 100, active: true },
        modifiers: [],
        materialSlots: [],
      },
    ],
    meshes: { [MESH_ID]: boxMesh(1.6) },
    collections: [{ id: ROOT_COLLECTION_ID, name: ROOT_COLLECTION_NAME }],
    materials: [{
      id: MATERIAL_ID,
      name: 'Paper',
      baseColor: '#f2e4cd',
      metallic: 0,
      roughness: 0.72,
      specular: 0.3,
      ior: 1.45,
      transmission: 0.35,
      emission: '#ffb45c',
      emissionStrength: 1.2,
      alpha: 1,
      normalStrength: 1,
      backfaceCulling: false,
      blendMode: 'opaque',
    }],
    world: { color: '#1b1b22', strength: 0.6 },
    cursor: { position: [0, 0, 0], rotation: [0, 0, 0] },
    view: { ...structuredClone(DEFAULT_VIEW), target: [0, 0, 1], distance: 7 },
    units: { ...DEFAULT_UNITS },
    rig: {
      groups: [
        { id: 'shape', label: 'Shape' },
        { id: 'light', label: 'Light' },
      ],
      parameters: [
        { kind: 'number', id: 'roundness', label: 'Roundness', group: 'shape', min: 0, max: 4, step: 1, defaultValue: 2 },
        { kind: 'number', id: 'paper', label: 'Paper thickness', group: 'shape', min: 0.01, max: 0.3, step: 0.01, defaultValue: 0.06, unit: 'm' },
        { kind: 'number', id: 'spin', label: 'Spin', group: 'shape', min: -180, max: 180, step: 1, defaultValue: 0, unit: '°' },
        { kind: 'color', id: 'glow', label: 'Glow', group: 'light', defaultValue: '#ffb45c' },
        { kind: 'number', id: 'brightness', label: 'Brightness', group: 'light', min: 0, max: 200, step: 1, defaultValue: 60, unit: 'W' },
      ],
      bindings: [
        { id: 'binding-roundness', objectId: OBJECT_ID, property: 'modifiers[modifier-round].levels', parameterId: 'roundness' },
        { id: 'binding-paper', objectId: OBJECT_ID, property: 'modifiers[modifier-paper].thickness', parameterId: 'paper' },
        { id: 'binding-spin', objectId: OBJECT_ID, property: 'transform.rotation.z', parameterId: 'spin' },
        { id: 'binding-glow', materialId: MATERIAL_ID, property: `materials[${MATERIAL_ID}].emission`, parameterId: 'glow' },
        { id: 'binding-brightness', objectId: LIGHT_ID, property: 'light.power', parameterId: 'brightness' },
      ],
    },
    createdAt: MADE,
    updatedAt: MADE,
  }
}

/** The scenes the app ships with. A stored document of the same id wins: it is the edited one. */
export const BUNDLED_SCENES: Array<() => SceneDocument> = [paperLantern]
