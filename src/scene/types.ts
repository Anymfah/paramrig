import type { InspectorCategory, ParamGroup, ParameterDef } from '@/rigs/types'

export type Vec3 = [number, number, number]
export type Vec2 = [number, number]

/** Euler angles in degrees, applied in the order the object's `rotationMode` names. */
export type EulerOrder = 'XYZ' | 'XZY' | 'YXZ' | 'YZX' | 'ZXY' | 'ZYX'

export type Transform = {
  position: Vec3
  /** Degrees. Blender shows degrees, and a document a person can read should store them. */
  rotation: Vec3
  scale: Vec3
  rotationMode?: EulerOrder | 'quaternion'
  /** Only read when `rotationMode` is 'quaternion'; x, y, z, w. */
  quaternion?: [number, number, number, number]
}

export const IDENTITY_TRANSFORM: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }

/* ------------------------------------------------------------------ mesh */

/**
 * A polygon mesh with stable identifiers.
 *
 * `vertices` is a flat xyz array; a vertex's *slot* is its index in `vertexIds`, and its *id* is
 * `vertexIds[slot]` — an id is never reused, so a selection survives an edit that renumbers slots.
 * Edges are slot pairs, always `a < b`, never repeated. Faces are loops of slots wound
 * counter-clockwise seen from outside, of any length from three up.
 */
export type MeshData = {
  vertices: number[]
  vertexIds: number[]
  nextVertexId: number
  edges: Array<[number, number]>
  faces: number[][]
  faceIds: number[]
  nextFaceId: number
  attributes: MeshAttributes
  /** Face normals blend across an edge sharper than `angle` degrees only when disabled. */
  autoSmooth?: { enabled: boolean; angle: number }
}

export type MeshAttributes = {
  face: {
    smooth: boolean[]
    /** Index into the object's `materialSlots`. */
    material: number[]
  }
  edge: {
    seam?: boolean[]
    sharp?: boolean[]
    crease?: number[]
    bevelWeight?: number[]
  }
  vertex: {
    /** One [u, v] per face corner, addressed as `uv[face][corner]`; arrives with the UV prompt. */
    uv?: number[][]
    color?: number[]
  }
}

/** An edge is named by its two vertex ids, smallest first, so it survives renumbering. */
export type EdgeKey = string

/* ---------------------------------------------------------------- objects */

export type SceneObjectKind = 'mesh' | 'light' | 'camera' | 'empty' | 'curve' | 'text'

/** A mesh object points at a mesh in `SceneDocument.meshes`; two objects may point at the same one. */
export type MeshRef = { kind: 'mesh'; meshId: string }

export type LightKind = 'point' | 'sun' | 'spot' | 'area'
export type AreaShape = 'square' | 'rectangle' | 'disk' | 'ellipse'

export type LightData = {
  kind: 'light'
  light: LightKind
  color: string
  /** Watts for point, spot and area; irradiance in W/m² for a sun. */
  power: number
  /** Soft-shadow radius, in metres. */
  radius: number
  /** Spot cone, in degrees, and how much of it is falloff, 0 to 1. */
  spotAngle: number
  spotBlur: number
  /** Area light footprint, in metres. */
  areaShape: AreaShape
  areaSize: Vec2
  shadow: boolean
  /** How far the light reaches; 0 means unbounded. */
  distance?: number
}

export type CameraData = {
  kind: 'camera'
  projection: 'perspective' | 'orthographic'
  /** Millimetres, against `sensor`. */
  focalLength: number
  sensor: number
  orthoScale: number
  clipStart: number
  clipEnd: number
  /** Indicative depth of field: the viewport blurs nothing, the render pass reads it. */
  depthOfField?: { enabled: boolean; focusDistance: number; fStop: number }
  /** Whether this is the scene's active camera. At most one object carries it. */
  active?: boolean
}

export type EmptyDisplay = 'plain-axes' | 'arrows' | 'single-arrow' | 'cube' | 'sphere' | 'circle' | 'cone' | 'image'

export type EmptyData = {
  kind: 'empty'
  display: EmptyDisplay
  size: number
  /** An empty that stands in for a whole collection, drawn at the empty's origin. */
  instanceCollectionId?: string
}

export type ObjectData = MeshRef | LightData | CameraData | EmptyData

export type ModifierKind =
  | 'subsurf' | 'mirror' | 'array' | 'solidify' | 'bevel' | 'boolean' | 'decimate' | 'screw'
  | 'triangulate' | 'weld' | 'wireframe' | 'smooth' | 'simpleDeform' | 'cast' | 'edgeSplit' | 'displace'

export type Modifier = {
  id: string
  kind: ModifierKind
  name: string
  enabled: { viewport: boolean; render: boolean; editMode: boolean; onCage: boolean }
  params: Record<string, number | string | boolean | Vec3 | null>
}

export type ShapeKey = {
  name: string
  value: number
  min: number
  max: number
  /** Offsets from the basis, by vertex id. */
  offsets: Record<string, Vec3>
}

export type SceneObject = {
  id: string
  name: string
  kind: SceneObjectKind
  parentId?: string
  /** Kept when the parent is set from a moved object, so the child does not jump. */
  parentInverse?: number[]
  collectionId: string
  transform: Transform
  visible: boolean
  selectable: boolean
  renderable: boolean
  /** Where the object's origin sits inside its own data, applied when the data is read. */
  origin?: Vec3
  data: ObjectData
  modifiers: Modifier[]
  /** Material ids; a face's `material` attribute indexes into this list. */
  materialSlots: string[]
  shapeKeys?: ShapeKey[]
  displayAs?: 'textured' | 'solid' | 'wire' | 'bounds'
  /** Drawn in front of everything else, the way Blender's "in front" does. */
  inFront?: boolean
  color?: string
}

/* ------------------------------------------------------------ collections */

export type Collection = {
  id: string
  name: string
  parentId?: string
  /** Excluded from the view entirely, checkbox in the outliner. */
  excluded?: boolean
  hidden?: boolean
  selectable?: boolean
  color?: string
}

/* ------------------------------------------------------------- appearance */

export type TextureSlot = {
  /** Id of a resource in `src/state/resources.ts`, or null for none. */
  resourceId: string | null
  scale?: Vec2
  offset?: Vec2
}

export type Material = {
  id: string
  name: string
  baseColor: string
  metallic: number
  roughness: number
  specular: number
  ior: number
  transmission: number
  emission: string
  emissionStrength: number
  alpha: number
  normalStrength: number
  backfaceCulling: boolean
  blendMode: 'opaque' | 'blend' | 'clip'
  textures?: {
    baseColor?: TextureSlot
    roughness?: TextureSlot
    metallic?: TextureSlot
    normal?: TextureSlot
    emission?: TextureSlot
  }
}

export type World = {
  color: string
  strength: number
  /** Id of an environment image resource, when one is chosen. */
  environmentId?: string | null
}

/* ------------------------------------------------------------------- view */

export type ShadingMode = 'wireframe' | 'solid' | 'material' | 'rendered'
export type SelectMode = 'vertex' | 'edge' | 'face'
export type EditorMode = 'object' | 'edit' | 'sculpt'
export type PivotPoint = 'bounding-box' | 'cursor' | 'individual' | 'median' | 'active'
export type TransformOrientation = 'global' | 'local' | 'normal' | 'gimbal' | 'view' | 'cursor'
export type SnapMode = 'increment' | 'vertex' | 'edge' | 'face' | 'volume' | 'edge-center' | 'edge-perpendicular'
export type SnapTarget = 'closest' | 'center' | 'median' | 'active'

export type SceneTool =
  | 'select-box' | 'select-circle' | 'select-lasso' | 'cursor'
  | 'move' | 'rotate' | 'scale' | 'transform' | 'annotate' | 'measure'
  /*
   * The edit-mode tools. Each is the interactive half of an operator of the same name; the
   * variants of one — extrude along normals, extrude individual — are options of the tool rather
   * than tools of their own, and are set in the sidebar's Tool tab.
   */
  | 'extrude' | 'inset' | 'bevel' | 'loop-cut' | 'knife' | 'bisect' | 'poly-build'
  | 'spin' | 'smooth' | 'edge-slide' | 'shrink-fatten' | 'shear' | 'rip'

export type OverlayFlags = {
  /** The floor grid and its axis lines. */
  grid: boolean
  floor: boolean
  axisX: boolean
  axisY: boolean
  axisZ: boolean
  cursor: boolean
  outline: boolean
  extras: boolean
  /** Edit-mode overlays, read from the second prompt onwards. */
  wireframe: boolean
  faceOrientation: boolean
  normals: boolean
  statistics: boolean
  textInfo: boolean
}

export type GizmoFlags = {
  navigate: boolean
  move: boolean
  rotate: boolean
  scale: boolean
  /** The active object's own gizmos: the light's radius, the camera's focal length. */
  object: boolean
}

/** Where the view is, and everything about how the document is being looked at. */
export type ViewState = {
  /** Where the camera orbits around, in world units. */
  target: Vec3
  /** Turntable angles in degrees and the distance to the target: one unambiguous camera. */
  yaw: number
  pitch: number
  distance: number
  projection: 'perspective' | 'orthographic'
  /** Focal length of the viewport camera, in millimetres. */
  focalLength: number
  clipStart: number
  clipEnd: number
  shading: ShadingMode
  /** Solid shading's light: a fixed studio rig or a matcap. */
  studio?: string
  xray: boolean
  overlays: OverlayFlags
  gizmos: GizmoFlags
  mode: EditorMode
  /** Which of the three element kinds the edit mode selects; several may be on at once. */
  selectMode: SelectMode[]
  tool: SceneTool
  pivot: PivotPoint
  orientation: TransformOrientation
  snapEnabled: boolean
  snapMode: SnapMode
  snapTarget: SnapTarget
  proportional: boolean
  proportionalFalloff: 'smooth' | 'sphere' | 'root' | 'inverse-square' | 'sharp' | 'linear' | 'constant' | 'random'
  proportionalSize: number
  /** Objects hidden by "local view"; empty when the view is not local. */
  localObjectIds?: string[]
  /** The panels the person left open, so a document reopens the way it was closed. */
  panels?: { toolbar: boolean; sidebar: boolean; sidebarTab: 'item' | 'tool' | 'view' }
}

/* -------------------------------------------------------- notes and rules */

export type Annotation = {
  id: string
  color: string
  width: number
  /** World-space points of one freehand stroke. */
  points: Vec3[]
}

export type Measurement = {
  id: string
  from: Vec3
  to: Vec3
  /** A third point turns the ruler into a protractor. */
  apex?: Vec3
}

/* -------------------------------------------------------------------- rig */

/** A property a control can drive. See section 9 of the plan for the whole list. */
export type SceneBindingProperty = string

export type SceneBinding = {
  id: string
  objectId?: string
  property: SceneBindingProperty
  parameterId: string
  transform?: { multiply?: number; add?: number; clampMin?: number; clampMax?: number }
}

export type SceneRig = {
  groups: ParamGroup[]
  parameters: ParameterDef[]
  inspectorCategories?: InspectorCategory[]
  bindings: SceneBinding[]
}

/* --------------------------------------------------------------- document */

export type SceneVersion = {
  id: string
  name: string
  createdAt: string
  objects: SceneObject[]
  meshes: Record<string, MeshData>
  collections: Collection[]
  materials: Material[]
}

export type SceneUnits = {
  system: 'metric' | 'imperial' | 'none'
  /** How many metres one unit is. */
  scale: number
}

export type SceneDocument = {
  version: 1
  id: string
  name: string
  /** Flat list; the hierarchy is `parentId`, the collection is `collectionId`. */
  objects: SceneObject[]
  /** Every mesh in the document, by id. Two objects naming the same id are linked duplicates. */
  meshes: Record<string, MeshData>
  /** A tree by `parentId`, under one implicit root written as the first entry. */
  collections: Collection[]
  materials: Material[]
  world: World
  cursor: { position: Vec3; rotation: Vec3 }
  view: ViewState
  units: SceneUnits
  annotations?: Annotation[]
  measurements?: Measurement[]
  rig?: SceneRig
  versions?: SceneVersion[]
  createdAt: string
  updatedAt: string
}

/** One object's edit-mode selection, by stable id, as a document stores it. */
export type ElementIds = { vertices: string[]; edges: EdgeKey[]; faces: string[] }

/** An element, named the way a selection has to name one across a whole document. */
export type ElementRef = { kind: SelectMode; objectId: string; id: string }

/** What the editor has selected, in whichever mode it is in. */
export type SceneSelection = {
  /** Object ids, in the order they were picked; the last one is active. */
  objectIds: string[]
  activeObjectId: string | null
  /**
   * The objects Tab opened. Blender edits several at once, each keeping its own selection, and an
   * operator runs on every one of them — so the selection is a map rather than one set of ids.
   */
  editObjectIds?: string[]
  /** Edit-mode selection, by object id. */
  elements?: Record<string, ElementIds>
  /** The element picked last: the active pivot, the normal orientation and ⌃ path all read it. */
  active?: ElementRef | null
  /** Picks in order, newest last. Taking the active one out promotes the one before it. */
  elementHistory?: ElementRef[]
}

export const EMPTY_SELECTION: SceneSelection = { objectIds: [], activeObjectId: null }
