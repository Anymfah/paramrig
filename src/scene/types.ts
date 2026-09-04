
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
    /** Three floats a vertex, or four when a file brought an alpha; `paint/attribute` reads which. */
    color?: number[]
    /**
     * The sculpt mask: 0 where a brush has its full say and 1 where it has none.
     *
     * A vertex attribute rather than a group, as Blender's is, so that it survives a save and can
     * be shown in the overlay; a mesh nobody has masked carries none at all.
     */
    mask?: number[]
  }
  /**
   * The corner domain, which Blender calls a loop: one value per corner of every face, in face
   * order then corner order. It is where UVs live, because two faces meeting at a vertex may want
   * two different points of the same image — that is what a seam is.
   */
  loop: {
    /**
     * Colour on the corner domain: three floats a corner, in face order then corner order.
     *
     * The domain is a choice a person makes, as it is in Blender. A colour on a vertex is the same
     * from every face that meets there; a colour on a corner can be red on one face and blue on the
     * next, which is the difference a hard edge between two painted parts needs.
     */
    color?: number[]
    /** Every UV map the mesh carries. The active one is `uvMaps[activeUv]`. */
    uvMaps?: UvMap[]
    /** Which map the viewport samples and the editor edits. */
    activeUv?: number
    /**
     * Corners an unwrap must leave where they are, one flag per corner.
     *
     * Pins belong to the mesh rather than to a map, as Blender's do: a corner pinned to a place in
     * the image is pinned there whichever map is being solved. They are dropped when an operator
     * changes the faces, because a corner that has been cut in two has no one place to be pinned to
     * — a pin is a hint, and a wrong hint is worse than none.
     */
    pinned?: boolean[]
  }
}

/**
 * One UV map: two floats per face corner, in loop order, so `data[loop * 2]` is u.
 *
 * A flat array rather than pairs, because that is what a `BufferAttribute` wants and what a file
 * holds most compactly; the helpers in `@/scene/mesh/uv` are how it is read a corner at a time.
 */
export type UvMap = {
  name: string
  data: number[]
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
  /** Blender's lens shift, in widths of the frame: the frame moves, the camera does not turn. */
  shiftX?: number
  shiftY?: number
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

/* ----------------------------------------------------------------- curves */

/**
 * What holds a Bézier handle, exactly as Blender names them.
 *
 * `free` is wherever it was put; `aligned` keeps the two handles of a knot on one line, so the
 * curve passes through smoothly; `vector` points at the neighbouring knot, which gives a corner
 * with straight sides; `auto` is computed from the neighbours and moves when they do.
 */
export type CurveHandleType = 'free' | 'aligned' | 'vector' | 'auto'

/** One knot of a spline, with its two handles held in the object's own space, as Blender holds them. */
export type CurvePoint = {
  co: Vec3
  left: Vec3
  right: Vec3
  leftType: CurveHandleType
  rightType: CurveHandleType
  /** Turns the bevel profile about the curve here, in degrees. */
  tilt?: number
  /** Scales the bevel profile here; 1 is the bevel's own size. */
  radius?: number
}

/**
 * A spline: Bézier, whose knots carry handles, or poly, whose knots are joined by straight lines.
 * NURBS is deliberately absent — it is a different evaluator and a different edit mode, and the
 * roadmap says so.
 */
export type CurveSpline = {
  id: string
  kind: 'bezier' | 'poly'
  cyclic: boolean
  points: CurvePoint[]
}

export type CurveFill = 'none' | 'front' | 'back' | 'both'

export type CurveData = {
  kind: 'curve'
  splines: CurveSpline[]
  /** A 2D curve is flattened onto its own XY plane and can be filled; a 3D one is left in space. */
  dimensions: '2D' | '3D'
  /** How many straight pieces each Bézier span is drawn with. Blender's resolution_u. */
  resolution: number
  fill: CurveFill
  /** Half the depth of the solid a filled curve becomes: Blender extrudes both ways. */
  extrude: number
  /** A round profile swept along the curve. Non-zero, it is what the curve becomes. */
  bevelDepth: number
  bevelResolution: number
  /** Another curve object read as a thickness profile along the length. */
  taperObjectId?: string
}

export type TextAlign = 'left' | 'center' | 'right'

export type TextData = {
  kind: 'text'
  body: string
  /** A family the font registry can find an outline file for; Public Sans is the one shipped. */
  font: string
  size: number
  align: TextAlign
  /** Extra room between characters and between lines, as a multiple of the size. */
  spacing: number
  lineSpacing: number
  extrude: number
  bevelDepth: number
  bevelResolution: number
}

export type ObjectData = MeshRef | LightData | CameraData | EmptyData | CurveData | TextData

/**
 * The modifiers a document can name, as a list rather than as a union: the sanitiser has to check a
 * value against them at run time, and a union that only exists in the type system cannot be read.
 */
export const MODIFIER_KINDS = [
  'subsurf', 'mirror', 'array', 'solidify', 'bevel', 'boolean', 'decimate', 'screw',
  'triangulate', 'weld', 'wireframe', 'smooth', 'simpleDeform', 'cast', 'edgeSplit', 'displace',
] as const

export type ModifierKind = (typeof MODIFIER_KINDS)[number]

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
  /** Which key the panel is on, and which one a sculpt stroke writes into. */
  activeShapeKey?: number
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
  /** The file it came from, so a panel can name it without reading the resource back. */
  name?: string
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
  /**
   * Whether the mesh's colour attribute multiplies the base colour.
   *
   * Blender puts a Color Attribute node into the base colour socket; the Principled here has no
   * graph yet, so it is a switch on the mapping — the same choice, without the wiring.
   */
  baseColorAttribute?: boolean
  backfaceCulling: boolean
  /**
   * Whether the surface is a graph rather than the fields above.
   *
   * The fields stay where they are when it is on, and the graph stays where it is when it is off:
   * a switch that threw one of them away would be a switch nobody dares press. Blender's own
   * "Use Nodes" behaves the same way.
   */
  useNodes?: boolean
  /** The graph, kept whether or not it is being used. Its shape is the vendored engine's. */
  graph?: unknown
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
  /** Id of an environment image resource, when one is chosen, and the file it came from. */
  environmentId?: string | null
  environmentName?: string
  /** How much of the environment reaches the surfaces, and how far round it has been turned. */
  environmentStrength?: number
  environmentRotation?: number
  /**
   * Lighting and background are separate switches, as they are in Blender: an environment can light
   * a scene without being seen behind it, which is how a product shot is lit.
   */
  useForLighting?: boolean
  visibleAsBackground?: boolean
  fog?: { enabled: boolean; density: number; color: string }
}

/* ------------------------------------------------------------------- view */

export type ShadingMode = 'wireframe' | 'solid' | 'material' | 'rendered'
export type SelectMode = 'vertex' | 'edge' | 'face'
export type EditorMode = 'object' | 'edit' | 'sculpt' | 'vertex-paint'
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
  /** Edit-mode overlays. */
  wireframe: boolean
  faceOrientation: boolean
  normals: boolean
  /** How long a drawn normal is, in metres. */
  normalLength: number
  statistics: boolean
  textInfo: boolean
  /** The edge attributes, each drawn in its own colour over the edges that carry it. */
  seams: boolean
  sharp: boolean
  creases: boolean
  bevelWeight: boolean
  /** The dot at the middle of a face, which face mode draws whether or not this is on. */
  faceCentres: boolean
  /** Blender's measurement overlays: the ids, and the size of what is selected. */
  indices: boolean
  edgeLength: boolean
  edgeAngle: boolean
  faceArea: boolean
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
/**
 * The UV editor's own state, kept with the view rather than in a preference.
 *
 * It travels with the document because it is a way of looking at *this* model: a person who
 * unwrapped a character and left the editor open beside the viewport should find it open when they
 * come back to that file, and should not find it open over an unrelated one.
 */
export type UvEditorState = {
  open: boolean
  /** How much of the room the viewport keeps, from 0 to 1; the UV editor takes the rest. */
  split: number
  /** What is drawn behind the map: the material's own image, a checker, or nothing. */
  background: 'texture' | 'checker' | 'none'
  grid: boolean
  /** What a click in the image picks up. */
  selectMode: 'vertex' | 'edge' | 'face' | 'island'
  /**
   * Blender's "UV sync selection". Off — the default — the editor shows the faces the viewport has
   * selected and keeps its own selection of corners; on, it shows the whole map.
   */
  sync: boolean
  /** Blender's stretch overlays, which colour each face by how badly the map treats it. */
  stretch: 'none' | 'angle' | 'area'
}

/** The brushes sculpt mode offers, in the order the tool bar shows them. */
export type SculptBrush =
  | 'draw' | 'draw-sharp' | 'clay' | 'clay-strips' | 'inflate' | 'blob' | 'crease'
  | 'smooth' | 'flatten' | 'fill' | 'scrape' | 'pinch'
  | 'grab' | 'elastic' | 'snake-hook' | 'thumb' | 'nudge' | 'rotate'
  | 'mask'

/**
 * Sculpt mode's settings, kept with the view.
 *
 * The size is in *pixels*, as Blender's is: a brush is sized against what is on screen, so that
 * zooming in sculpts finer detail rather than the same detail in a bigger picture. The session that
 * does the sculpting works in the object's own units, and the tool converts between them where the
 * brush actually touches the surface.
 */
export type SculptState = {
  brush: SculptBrush
  size: number
  strength: number
  falloff: 'smooth' | 'sphere' | 'root' | 'inverse-square' | 'sharp' | 'linear' | 'constant' | 'random'
  symmetry: { x: boolean; y: boolean; z: boolean }
  /** How much of a smoothing pass follows every dab, 0 to 1. */
  autoSmooth: number
  frontFacesOnly: boolean
}

/** What vertex paint mode is set to, kept with the view, as sculpt mode's settings are. */
export type PaintState = {
  brush: 'paint' | 'blur' | 'smear'
  /** The colour being painted and the one ⇧X swaps it with, as Blender's pair does. */
  colour: string
  secondary: string
  /** In pixels, like the sculpt brush: a brush is sized against what is on screen. */
  size: number
  strength: number
  falloff: SculptState['falloff']
  blend: 'mix' | 'add' | 'multiply' | 'lighten' | 'darken'
  symmetry: { x: boolean; y: boolean; z: boolean }
  /** Which domain a fresh colour attribute is made on, and which one painting writes. */
  domain: 'vertex' | 'corner'
}

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
  /**
   * What solid shading looks like. Blender's own list, and the same defaults: a studio rig, one
   * grey, no cavity — the picture a person models against rather than one that flatters the model.
   */
  solid?: {
    lighting: 'studio' | 'matcap' | 'flat'
    /** Which matcap, by the name of a file in `public/matcaps`. */
    matcap: string
    colour: 'material' | 'object' | 'single' | 'random' | 'texture' | 'attribute'
    single: string
    background: 'theme' | 'world' | 'viewport'
    backfaceCulling: boolean
    cavity: boolean
    cavityStrength: number
    shadow: boolean
    outline: boolean
    specular: boolean
  }
  /** How solid a mesh is in X-ray, and how heavy the wireframe overlay's lines are. */
  xrayAlpha?: number
  wireframeOpacity?: number
  /** Edges flatter than this are left out of the wireframe overlay, as Blender's threshold does. */
  wireframeThreshold?: number
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
  /**
   * Mirror editing: an axis that is on makes each moved vertex's partner on the other side move
   * with it, found by position within a tolerance. It is how a face is modelled once rather than
   * twice, and it is a way of editing rather than a modifier — nothing is added to the mesh.
   */
  symmetry?: { x: boolean; y: boolean; z: boolean }
  proportional: boolean
  proportionalFalloff: 'smooth' | 'sphere' | 'root' | 'inverse-square' | 'sharp' | 'linear' | 'constant' | 'random'
  proportionalSize: number
  /** Objects hidden by "local view"; empty when the view is not local. */
  localObjectIds?: string[]
  /** The panels the person left open, so a document reopens the way it was closed. */
  panels?: { toolbar: boolean; sidebar: boolean; sidebarTab: 'item' | 'tool' | 'view' | 'assets' }
  /** The UV editor: whether the second space is open, how much room it has, and what it draws. */
  uv?: UvEditorState
  /** Sculpt mode's brush and its settings. */
  sculpt?: SculptState
  paint?: PaintState
  /**
   * Looking through the active camera, with its frame drawn and the rest dimmed. It is a state of
   * the view rather than a place it has moved to: the camera is what is being looked through, so
   * moving the camera moves the view and not the other way about — unless it is locked.
   */
  camera?: {
    /** Whether the view is looking through the active camera at all. */
    looking: boolean
    /** Navigating moves the camera itself, which is Blender's "Lock camera to view". */
    lock?: boolean
    /** How dark the region outside the frame is drawn, nought to one. */
    passepartout?: number
  }
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

/*
 * The controls a document exposes live in `@/scene/rig`, beside the parsing and the resolution
 * that give them meaning — as the drawing editor's do in `@/vector/rig`. They are re-exported here
 * because a document type that mentions them should not force every reader to know where they are.
 */
export type { SceneBinding, SceneRig } from '@/scene/rig'

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
  /** What an image is rendered at, and how the numbers reach the screen. */
  output?: { width: number; height: number; percentage: number; transparent: boolean }
  colorManagement?: { exposure: number; gamma: number }
  annotations?: Annotation[]
  measurements?: Measurement[]
  rig?: import('./rig').SceneRig
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
  /**
   * Which material slot of the active object the Material panel is on. It is here rather than on
   * the object because it is a place in the interface rather than a property of the scene: a file
   * reopened elsewhere should not remember which row a person had highlighted.
   */
  activeMaterialSlot?: number
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
  /**
   * What is selected in the UV editor, by object: corner indices into the mesh's own numbering.
   *
   * Corners rather than points, because a point is worked out from the map and moves with it while
   * a corner is a place in the mesh — so a selection survives an unwrap, a pack and a change of
   * which map is active.
   */
  uv?: Record<string, number[]>
}

export const EMPTY_SELECTION: SceneSelection = { objectIds: [], activeObjectId: null }
