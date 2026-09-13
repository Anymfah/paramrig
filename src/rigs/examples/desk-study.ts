import { DEFAULT_UNITS, DEFAULT_VIEW, ROOT_COLLECTION_ID, ROOT_COLLECTION_NAME } from '@/scene/model'
import {
  boxMesh,
  coneMesh,
  cylinderMesh,
  icoSphereMesh,
  paramRigMarkMesh,
  planeMesh,
  torusMesh,
} from '@/scene/mesh/primitives'
import type { Material, SceneDocument } from '@/scene/types'

/**
 * The second example scene: a desk lamp and two props on a ground plane, with six controls.
 *
 * `paper-lantern.ts` is one object that uses every family of binding exactly once, so that each of
 * them has a worked example. This one answers a different question: what the editor looks like on
 * a scene someone actually arranged. Ten objects, five materials, three modifiers, a framing that
 * holds the whole study, and controls that reach a transform, a modifier parameter and a light.
 * It is also the document the 3D editor is photographed on, which is why it ships here rather than
 * living in whichever browser drew it.
 *
 * Every solid is a default Add, with the parameters spelled out so the mesh cannot drift when the
 * menu's defaults move: a plane for the ground, a cylinder for the base, a cone turned over for
 * the shade, a cube drawn thin for the stem, a torus, an ico sphere and the house mark. What makes
 * it a desk is where they are put. The meshes are built rather than stored for the reason the
 * lantern gives: a stored mesh ages with the format.
 *
 * It is a document, not a template. Opening it and moving something saves a copy under the same id
 * in browser storage, and from then on the stored one is what is served.
 */

const GROUND = 'object-ground'
const BASE = 'object-base'
const SHADE = 'object-shade'
const STEM = 'object-stem'
const RING = 'object-ring'
const BEAD = 'object-bead'
const MARK = 'object-mark'
const KEY = 'object-key'
const FILL = 'object-fill'

const SHADE_SOLIDIFY = 'modifier-shade-solidify'
const BEAD_SUBSURF = 'modifier-bead-subsurf'

const PAPER = 'material-paper'
const INK = 'material-ink'
const CLAY = 'material-clay'
const SAGE = 'material-sage'
const FLOOR = 'material-floor'

/** Fixed, because a bundled document that changed every time it was read would never be the same. */
const MADE = '2026-09-07T00:00:00.000Z'

/** Everything a material needs, so the five below differ only where they mean to. */
function material(id: string, name: string, baseColor: string, roughness: number): Material {
  return {
    id,
    name,
    baseColor,
    metallic: 0,
    roughness,
    specular: 0.5,
    ior: 1.45,
    transmission: 0,
    emission: '#000000',
    emissionStrength: 0,
    alpha: 1,
    normalStrength: 1,
    backfaceCulling: false,
    blendMode: 'opaque',
  }
}

/**
 * The view the study is left in: back far enough to hold the ground plane, and the solid shading
 * the arrangement was judged under. `solid` is optional on `ViewState`, so it is filled in place
 * rather than spread, the way `createSceneDocument` does it.
 */
function framing(): SceneDocument['view'] {
  const view = structuredClone(DEFAULT_VIEW)
  view.target = [0, -0.1, 0.75]
  view.yaw = 34
  view.pitch = 19
  view.distance = 8.6
  if (view.solid) {
    view.solid.matcap = 'clay'
    view.solid.cavity = true
    view.solid.cavityStrength = 0.35
    view.solid.shadow = true
  }
  return view
}

export function deskStudy(): SceneDocument {
  return {
    version: 1,
    id: 'example-desk-study',
    name: 'Desk study',
    objects: [
      {
        id: FILL,
        name: 'Fill',
        kind: 'light',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [-3.2, 2.6, 3.4], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        selectable: true,
        renderable: true,
        data: {
          kind: 'light',
          light: 'point',
          color: '#ffffff',
          power: 1000,
          radius: 0.1,
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
        id: 'object-camera',
        name: 'Camera',
        kind: 'camera',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [7.36, -6.93, 4.96], rotation: [63.6, 0, 46.7], scale: [1, 1, 1] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'camera', projection: 'perspective', focalLength: 50, sensor: 36, orthoScale: 6, clipStart: 0.1, clipEnd: 100, active: true },
        modifiers: [],
        materialSlots: [],
      },
      {
        id: GROUND,
        name: 'Ground',
        kind: 'mesh',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [7, 7, 1] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'mesh', meshId: 'mesh-ground' },
        modifiers: [],
        materialSlots: [FLOOR],
      },
      {
        id: BASE,
        name: 'Base',
        kind: 'mesh',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [0, 0, 0.16], rotation: [0, 0, 0], scale: [0.62, 0.62, 0.16] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'mesh', meshId: 'mesh-base' },
        modifiers: [],
        materialSlots: [INK],
      },
      {
        // A cone points up; a shade is the same cone turned over and set above the stem.
        id: SHADE,
        name: 'Shade',
        kind: 'mesh',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [0, 0, 1.35], rotation: [180, 0, 0], scale: [1.1, 1.1, 0.52] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'mesh', meshId: 'mesh-shade' },
        modifiers: [
          {
            id: SHADE_SOLIDIFY,
            kind: 'solidify',
            name: 'Solidify',
            enabled: { viewport: true, render: true, editMode: true, onCage: false },
            params: { thickness: 0.1, offset: -1, even: true, rim: true, onlyRim: false, flipNormals: false, materialOffset: 0, crease: 0 },
          },
          {
            id: 'modifier-shade-bevel',
            kind: 'bevel',
            name: 'Bevel',
            enabled: { viewport: true, render: true, editMode: true, onCage: false },
            params: { width: 0.1, segments: 1, profile: 0.5, limitMethod: 'angle', angleLimit: 30, clampOverlap: true, harden: false, materialIndex: -1, markSeams: false, markSharp: false },
          },
        ],
        materialSlots: [PAPER],
      },
      {
        id: STEM,
        name: 'Stem',
        kind: 'mesh',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [0, 0, 0.78], rotation: [0, 0, 0], scale: [0.045, 0.045, 0.62] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'mesh', meshId: 'mesh-stem' },
        modifiers: [],
        materialSlots: [INK],
      },
      {
        id: RING,
        name: 'Ring',
        kind: 'mesh',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [2.25, -0.35, 0.16], rotation: [0, 0, 0], scale: [0.62, 0.62, 0.62] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'mesh', meshId: 'mesh-ring' },
        modifiers: [],
        materialSlots: [SAGE],
      },
      {
        id: BEAD,
        name: 'Bead',
        kind: 'mesh',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [-2.05, 0.95, 0.42], rotation: [0, 0, 0], scale: [0.42, 0.42, 0.42] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'mesh', meshId: 'mesh-bead' },
        modifiers: [
          {
            id: BEAD_SUBSURF,
            kind: 'subsurf',
            name: 'Subdivision',
            enabled: { viewport: true, render: true, editMode: true, onCage: false },
            params: { levels: 1, renderLevels: 2, simple: false, optimalDisplay: false, boundarySmooth: 'all', useCreases: true },
          },
        ],
        materialSlots: [CLAY],
      },
      {
        id: MARK,
        name: 'Mark',
        kind: 'mesh',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [-1.75, -1.85, 0.015], rotation: [0, 0, -12], scale: [0.6, 0.6, 0.6] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'mesh', meshId: 'mesh-mark' },
        modifiers: [],
        materialSlots: [SAGE],
      },
      {
        id: KEY,
        name: 'Key',
        kind: 'light',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [3.4, -3.2, 5.2], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        selectable: true,
        renderable: true,
        data: {
          kind: 'light',
          light: 'sun',
          color: '#ffffff',
          power: 5,
          radius: 0.526,
          spotAngle: 45,
          spotBlur: 0.15,
          areaShape: 'square',
          areaSize: [1, 1],
          shadow: true,
        },
        modifiers: [],
        materialSlots: [],
      },
    ],
    meshes: {
      'mesh-ground': planeMesh(2),
      'mesh-base': cylinderMesh({ vertices: 32, radius: 1, depth: 2, fill: 'ngon' }),
      'mesh-shade': coneMesh({ vertices: 32, radius1: 1, radius2: 0, depth: 2, fill: 'ngon' }),
      'mesh-stem': boxMesh(2),
      'mesh-ring': torusMesh({ majorSegments: 48, minorSegments: 12, majorRadius: 1, minorRadius: 0.25 }),
      'mesh-bead': icoSphereMesh({ subdivisions: 2, radius: 1 }),
      'mesh-mark': paramRigMarkMesh(),
    },
    collections: [{ id: ROOT_COLLECTION_ID, name: ROOT_COLLECTION_NAME }],
    materials: [
      material(PAPER, 'Paper', '#E8E3D8', 0.85),
      material(INK, 'Ink', '#22262A', 0.4),
      material(CLAY, 'Clay', '#C4633F', 0.5),
      material(SAGE, 'Sage', '#8FBFAE', 0.6),
      material(FLOOR, 'Floor', '#D8D3C7', 0.95),
    ],
    world: { color: '#3b3b3b', strength: 1 },
    cursor: { position: [0, 0, 0], rotation: [0, 0, 0] },
    // A framing that shows the whole study rather than whatever happens to be selected.
    view: framing(),
    units: { ...DEFAULT_UNITS },
    rig: {
      groups: [
        { id: 'lamp', label: 'Lamp' },
        { id: 'props', label: 'Props' },
        { id: 'light', label: 'Light' },
      ],
      parameters: [
        { kind: 'number', id: 'shadeWidth', label: 'Shade width', group: 'lamp', min: 0.4, max: 2.2, step: 0.01, defaultValue: 1.1 },
        { kind: 'number', id: 'shadeHeight', label: 'Shade height', group: 'lamp', min: 0.6, max: 2.2, step: 0.01, defaultValue: 1.35, unit: 'm' },
        { kind: 'number', id: 'shadeThickness', label: 'Shade thickness', group: 'lamp', min: 0.01, max: 0.4, step: 0.01, defaultValue: 0.1, unit: 'm' },
        { kind: 'number', id: 'ringTurn', label: 'Ring turn', group: 'props', min: 0, max: 360, step: 1, defaultValue: 0, unit: '°' },
        { kind: 'number', id: 'beadSmooth', label: 'Bead smoothing', group: 'props', min: 0, max: 3, step: 1, defaultValue: 1 },
        { kind: 'number', id: 'keyPower', label: 'Key power', group: 'light', min: 0, max: 20, step: 0.1, defaultValue: 5, unit: 'W' },
      ],
      bindings: [
        // One control widens the shade on both axes, which is what a shade does when it grows.
        { id: 'binding-shade-width-x', objectId: SHADE, property: 'transform.scale.x', parameterId: 'shadeWidth' },
        { id: 'binding-shade-width-y', objectId: SHADE, property: 'transform.scale.y', parameterId: 'shadeWidth' },
        { id: 'binding-shade-height', objectId: SHADE, property: 'transform.position.z', parameterId: 'shadeHeight' },
        { id: 'binding-shade-thickness', objectId: SHADE, property: `modifiers[${SHADE_SOLIDIFY}].thickness`, parameterId: 'shadeThickness' },
        { id: 'binding-ring-turn', objectId: RING, property: 'transform.rotation.z', parameterId: 'ringTurn' },
        { id: 'binding-bead-smooth', objectId: BEAD, property: `modifiers[${BEAD_SUBSURF}].levels`, parameterId: 'beadSmooth' },
        { id: 'binding-key-power', objectId: KEY, property: 'light.power', parameterId: 'keyPower' },
      ],
    },
    createdAt: MADE,
    updatedAt: MADE,
  }
}
