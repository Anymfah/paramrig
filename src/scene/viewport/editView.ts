import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  LineSegments,
  Mesh,
  NearestFilter,
  NoBlending,
  Points,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  type Matrix4,
} from 'three'
import { faceNormal as faceNormalOf } from '@/scene/mesh/normals'
import type { MeshData, SelectMode } from '@/scene/types'
import { createLines, setLineResolution, type ViewportLines } from '@/scene/viewport/lines'
import type { MeshView } from '@/scene/viewport/meshView'
import { pickAlpha } from '@/scene/viewport/picking'
import { splitAlpha, type SceneTheme } from '@/scene/viewport/theme'

/**
 * What edit mode draws, and what it lets a person click.
 *
 * Both halves live here on purpose. The overlay and the id buffer must agree about where a vertex
 * is to within a pixel — a dot drawn in one place and picked in another is the single most
 * infuriating bug an editor can have — and the only way to be sure of that is for one module to
 * lay out both from the same arrays, at the same moment.
 *
 * Three costs are kept apart, because they happen at three different rates. Topology changes when
 * an operator runs, and rebuilds everything. Positions change on every frame of a drag, and rewrite
 * one attribute. Selection changes on every click, and rewrites one small array or one texture —
 * never the geometry. A mesh of a hundred thousand vertices is dragged at the same cost as a cube.
 */

/** Which of the edit-mode overlays are on, and how long a drawn normal is. */
export type EditOverlayFlags = {
  seams: boolean
  sharp: boolean
  creases: boolean
  bevelWeight: boolean
  faceCentres: boolean
  normals: boolean
  normalLength: number
}

const DEFAULT_OVERLAYS: EditOverlayFlags = {
  seams: true,
  sharp: true,
  creases: true,
  bevelWeight: false,
  faceCentres: true,
  normals: false,
  normalLength: 0.2,
}

/** What is selected, in slots of the mesh as it stands. */
export type EditSlots = {
  vertices: Set<number>
  edges: Set<number>
  faces: Set<number>
  active: { kind: SelectMode; slot: number } | null
}

/** The four states a drawn element can be in, which is what the shaders switch on. */
const PLAIN = 0
const CHOSEN = 1
const ACTIVE = 2
const UNDER_POINTER = 3

/**
 * How an element id is written into twenty-four bits: four for which object is being edited, twenty
 * for the element. Sixteen objects at once is past what anyone edits together, and a million
 * elements is past what any one of them holds; a mesh larger than that picks nothing rather than
 * picking the wrong thing, which is what `decodeElement` returning null means.
 */
const OBJECT_SHIFT = 20
const ELEMENT_LIMIT = 1 << OBJECT_SHIFT
export const MAX_EDITED_OBJECTS = 16

export function encodeElement(objectIndex: number, elementIndex: number): number {
  return ((objectIndex & 0xf) << OBJECT_SHIFT) | (elementIndex & (ELEMENT_LIMIT - 1))
}

export function decodeElement(id: number): { objectIndex: number; elementIndex: number } {
  return { objectIndex: (id >> OBJECT_SHIFT) & 0xf, elementIndex: id & (ELEMENT_LIMIT - 1) }
}

/* ------------------------------------------------------------------ shaders */

const POINT_VERTEX = /* glsl */ `
  attribute float aState;
  varying float vState;
  uniform float uSize;
  uniform float uSelectedSize;
  uniform float uPixelRatio;
  void main() {
    vState = aState;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    // A dot that grew with the distance to it would be a sphere, not a handle. The size is in
    // pixels, and the pixel ratio is what turns those into the device's own.
    gl_PointSize = (aState > 0.5 ? uSelectedSize : uSize) * uPixelRatio;
  }
`

const POINT_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vState;
  uniform vec3 uPlain;
  uniform vec3 uChosen;
  uniform vec3 uActive;
  uniform vec3 uHover;
  uniform float uOpacity;
  void main() {
    vec2 offset = gl_PointCoord - vec2(0.5);
    float radius = length(offset);
    if (radius > 0.5) discard;
    vec3 colour = vState > 2.5 ? uHover : vState > 1.5 ? uActive : vState > 0.5 ? uChosen : uPlain;
    // The active vertex wears a ring rather than another colour, so that it is still legible to
    // someone who cannot tell the two oranges apart.
    float alpha = uOpacity;
    if (vState > 1.5 && vState < 2.5 && radius > 0.28 && radius < 0.42) colour = vec3(1.0);
    gl_FragColor = vec4(colour, alpha);
    #include <colorspace_fragment>
  }
`

const FACE_VERTEX = /* glsl */ `
  attribute float element;
  varying float vState;
  uniform sampler2D uStates;
  uniform vec2 uStateSize;
  void main() {
    float column = mod(element, uStateSize.x);
    float row = floor(element / uStateSize.x);
    vec2 uv = vec2((column + 0.5) / uStateSize.x, (row + 0.5) / uStateSize.y);
    vState = texture2D(uStates, uv).r * 255.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FACE_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vState;
  uniform vec3 uChosen;
  uniform vec3 uActive;
  uniform vec3 uHover;
  uniform float uOpacity;
  void main() {
    if (vState < 0.5) discard;
    vec3 colour = vState > 2.5 ? uHover : vState > 1.5 ? uActive : uChosen;
    gl_FragColor = vec4(colour, uOpacity);
    #include <colorspace_fragment>
  }
`

const ID_VERTEX = /* glsl */ `
  attribute vec3 aId;
  varying vec3 vId;
  uniform float uSize;
  uniform float uPixelRatio;
  void main() {
    vId = aId;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uPixelRatio;
  }
`

const ID_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vId;
  uniform float uKind;
  uniform float uRound;
  void main() {
    if (uRound > 0.5) {
      // The vertex target is a disc, not a square, so the corners of one dot do not sit closer to
      // the pointer than the middle of the dot beside it.
      if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
    }
    // No colour management here on purpose: these bytes are an identifier, not a colour, and any
    // conversion at all would turn face 7 into face 24.
    gl_FragColor = vec4(vId, uKind);
  }
`

const FACE_ID_VERTEX = /* glsl */ `
  attribute float element;
  varying vec3 vId;
  uniform float uObject;
  void main() {
    float value = uObject + element + 1.0;
    float blue = mod(value, 256.0);
    float green = mod(floor(value / 256.0), 256.0);
    float red = floor(value / 65536.0);
    vId = vec3(red, green, blue) / 255.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/* -------------------------------------------------------------------- view */

export type EditView = {
  /** Drawn over the shaded mesh, in the overlay scene. */
  root: Group
  /** The same geometry again, in the id buffer's scene. */
  pickRoot: Group
  setMatrix: (matrix: Matrix4) => void
  setMesh: (mesh: MeshData, meshView: MeshView) => void
  setSelection: (slots: EditSlots) => void
  /** The element under the pointer, drawn in the hover colour. True when it changed. */
  setHover: (element: { kind: SelectMode; slot: number } | null) => boolean
  setSelectMode: (modes: SelectMode[]) => void
  /**
   * Which kinds the id buffer answers for on the next read. A click wants all three — ⌥ takes a
   * loop of edges while the editor is in vertex mode — and a region wants only the kind being
   * selected, which is both what Blender selects and three passes' worth of drawing saved.
   */
  setPickKinds: (kinds: SelectMode[]) => void
  setOverlays: (overlays: EditOverlayFlags) => void
  setXray: (xray: boolean) => void
  setResolution: (width: number, height: number, pixelRatio: number) => void
  setTheme: (theme: SceneTheme) => void
  dispose: () => void
}

export function createEditView(objectIndex: number, theme: SceneTheme): EditView {
  const root = new Group()
  const pickRoot = new Group()
  root.name = 'edit-overlay'
  pickRoot.name = 'edit-pick'
  root.matrixAutoUpdate = false
  pickRoot.matrixAutoUpdate = false

  let mesh: MeshData | null = null
  let slots: EditSlots = { vertices: new Set(), edges: new Set(), faces: new Set(), active: null }
  let modes: SelectMode[] = ['vertex']
  let hovered: { kind: SelectMode; slot: number } | null = null
  let xray = false
  let size = { width: 1, height: 1 }
  let lastShape = ''
  /*
   * The edge buffers are kept and rewritten rather than rebuilt.
   *
   * A mesh of a hundred thousand vertices has two hundred thousand edges, which is one and a
   * fifth million numbers a piece for the positions and for the colours. Allocating those on every
   * pointer move — and again on every click — is most of what opening a heavy mesh used to cost.
   * The same array is handed to the overlay and to the id pass, because they draw the same points.
   */
  let edgePositions = new Float32Array(0)
  let edgeColours = new Float32Array(0)
  let chosenPositions = new Float32Array(0)
  let overlays: EditOverlayFlags = DEFAULT_OVERLAYS
  let colours = readColours(theme)

  /* the drawn things */
  const pointGeometry = new BufferGeometry()
  const pointMaterial = new ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    uniforms: {
      uSize: { value: 4.4 },
      uSelectedSize: { value: 6.4 },
      uPixelRatio: { value: 1 },
      uPlain: { value: new Color(colours.vertex) },
      uChosen: { value: new Color(colours.vertexSelected) },
      uActive: { value: new Color(colours.active) },
      uHover: { value: new Color(colours.hover) },
      uOpacity: { value: 1 },
    },
  })
  const points = new Points(pointGeometry, pointMaterial)
  points.frustumCulled = false
  points.renderOrder = 30

  const centreGeometry = new BufferGeometry()
  const centreMaterial = pointMaterial.clone()
  centreMaterial.uniforms.uSize!.value = 3.4
  centreMaterial.uniforms.uSelectedSize!.value = 4.6
  const centres = new Points(centreGeometry, centreMaterial)
  centres.frustumCulled = false
  centres.renderOrder = 30
  centres.visible = false

  const edges: ViewportLines = createLines({ colour: colours.edge, width: 1.1, opacity: colours.edgeAlpha })
  edges.material.vertexColors = true
  edges.object.renderOrder = 28
  const chosenEdges: ViewportLines = createLines({ colour: colours.edgeSelected, width: 2.2 })
  chosenEdges.object.renderOrder = 29

  const faceStates = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType)
  faceStates.minFilter = NearestFilter
  faceStates.magFilter = NearestFilter
  const faceMaterial = new ShaderMaterial({
    vertexShader: FACE_VERTEX,
    fragmentShader: FACE_FRAGMENT,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    // Negative units pull the tint towards the viewer, so it lies on its face instead of fighting it.
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uStates: { value: faceStates },
      uStateSize: { value: [1, 1] },
      uChosen: { value: new Color(colours.faceSelected) },
      uActive: { value: new Color(colours.faceActive) },
      uHover: { value: new Color(colours.hover) },
      uOpacity: { value: colours.faceAlpha },
    },
  })
  let faces: Mesh | null = null

  /* the picked things */
  const facePickMaterial = new ShaderMaterial({
    vertexShader: FACE_ID_VERTEX,
    fragmentShader: ID_FRAGMENT,
    side: DoubleSide,
    blending: NoBlending,
    uniforms: {
      uObject: { value: objectIndex << OBJECT_SHIFT },
      uKind: { value: pickAlpha('face') },
      uRound: { value: 0 },
      uSize: { value: 1 },
      uPixelRatio: { value: 1 },
    },
  })
  let facePick: Mesh | null = null

  const edgePickGeometry = new BufferGeometry()
  const edgePickMaterial = new ShaderMaterial({
    vertexShader: ID_VERTEX,
    fragmentShader: ID_FRAGMENT,
    blending: NoBlending,
    uniforms: { uKind: { value: pickAlpha('edge') }, uRound: { value: 0 }, uSize: { value: 1 }, uPixelRatio: { value: 1 } },
  })
  /*
   * The id buffer draws its edges as plain one-pixel lines, not as the anti-aliased strips the
   * overlay uses: WebGL ignores a line width above one, and a strip would need its own geometry
   * kept in step with the overlay's for no gain. A thin line is enough because a pick reads a
   * square around the pointer and takes the nearest match, so an edge is reachable from ten pixels
   * away — which is the tolerance Blender picks with anyway.
   */
  const edgePick = new LineSegments(edgePickGeometry, edgePickMaterial)
  edgePick.frustumCulled = false
  edgePick.renderOrder = 1
  const vertexPickGeometry = new BufferGeometry()
  const vertexPickMaterial = new ShaderMaterial({
    vertexShader: ID_VERTEX,
    fragmentShader: ID_FRAGMENT,
    blending: NoBlending,
    uniforms: { uKind: { value: pickAlpha('vertex') }, uRound: { value: 1 }, uSize: { value: 11 }, uPixelRatio: { value: 1 } },
  })
  const vertexPick = new Points(vertexPickGeometry, vertexPickMaterial)
  vertexPick.frustumCulled = false

  vertexPick.renderOrder = 2
  const normals: ViewportLines = createLines({ colour: colours.normal, width: 1.4 })
  normals.object.renderOrder = 29
  normals.object.visible = false

  root.add(points, centres, edges.object, chosenEdges.object, normals.object)
  pickRoot.add(edgePick, vertexPick)

  /* ------------------------------------------------------------ the writing */

  function rebuild(next: MeshData, meshView: MeshView): void {
    mesh = next
    const count = next.vertexIds.length
    const positions = new Float32Array(count * 3)
    for (let index = 0; index < count * 3; index += 1) positions[index] = next.vertices[index] ?? 0
    pointGeometry.setAttribute('position', new BufferAttribute(positions, 3))
    pointGeometry.setAttribute('aState', new BufferAttribute(new Float32Array(count), 1))
    pointGeometry.setDrawRange(0, count)

    const ids = new Float32Array(count * 3)
    for (let slot = 0; slot < count; slot += 1) writeId(ids, slot * 3, encodeElement(objectIndex, slot) + 1)
    vertexPickGeometry.setAttribute('position', new BufferAttribute(positions.slice(), 3))
    vertexPickGeometry.setAttribute('aId', new BufferAttribute(ids, 3))

    writeEdgePositions(true)
    writeEdgeIds()
    writeFaceCentres()
    writeNormals()

    if (faces) {
      root.remove(faces)
      faces = null
    }
    if (facePick) {
      pickRoot.remove(facePick)
      facePick = null
    }
    faces = new Mesh(meshView.geometry, faceMaterial)
    faces.frustumCulled = false
    faces.renderOrder = 27
    root.add(faces)
    facePick = new Mesh(meshView.geometry, facePickMaterial)
    facePick.frustumCulled = false
    facePick.renderOrder = 0
    pickRoot.add(facePick)
    resizeFaceStates(next.faces.length)
    applySelection()
  }

  function writeEdgePositions(rebuilt: boolean): void {
    if (!mesh) return
    const count = mesh.edges.length
    if (edgePositions.length !== count * 6) edgePositions = new Float32Array(count * 6)
    for (let slot = 0; slot < count; slot += 1) {
      const [a, b] = mesh.edges[slot]!
      edgePositions[slot * 6] = mesh.vertices[a * 3] ?? 0
      edgePositions[slot * 6 + 1] = mesh.vertices[a * 3 + 1] ?? 0
      edgePositions[slot * 6 + 2] = mesh.vertices[a * 3 + 2] ?? 0
      edgePositions[slot * 6 + 3] = mesh.vertices[b * 3] ?? 0
      edgePositions[slot * 6 + 4] = mesh.vertices[b * 3 + 1] ?? 0
      edgePositions[slot * 6 + 5] = mesh.vertices[b * 3 + 2] ?? 0
    }
    const attribute = edgePickGeometry.getAttribute('position') as BufferAttribute | undefined
    if (rebuilt || !attribute || attribute.array !== edgePositions) {
      edges.setPositions(edgePositions)
      edgePickGeometry.setAttribute('position', new BufferAttribute(edgePositions, 3))
      return
    }
    // The same numbers, in the same place: both the strip and the id pass just need telling.
    attribute.needsUpdate = true
    const start = edges.object.geometry.getAttribute('instanceStart')
    if (start) (start as unknown as { data: { needsUpdate: boolean } }).data.needsUpdate = true
  }

  function writeEdgeIds(): void {
    if (!mesh) return
    const count = mesh.edges.length
    const ids = new Float32Array(count * 6)
    for (let slot = 0; slot < count; slot += 1) {
      const value = encodeElement(objectIndex, slot) + 1
      writeId(ids, slot * 6, value)
      writeId(ids, slot * 6 + 3, value)
    }
    edgePickGeometry.setAttribute('aId', new BufferAttribute(ids, 3))
  }

  /** One line out of each face's middle, along its normal, at the length the overlay asks for. */
  function writeNormals(): void {
    if (!mesh || !overlays.normals) {
      normals.object.visible = false
      return
    }
    const positions: number[] = []
    const reach = Math.max(0.001, overlays.normalLength)
    for (let face = 0; face < mesh.faces.length; face += 1) {
      const loop = mesh.faces[face]!
      let x = 0
      let y = 0
      let z = 0
      for (const corner of loop) {
        x += mesh.vertices[corner * 3] ?? 0
        y += mesh.vertices[corner * 3 + 1] ?? 0
        z += mesh.vertices[corner * 3 + 2] ?? 0
      }
      const divisor = Math.max(1, loop.length)
      const centre: [number, number, number] = [x / divisor, y / divisor, z / divisor]
      const normal = faceNormalOf(mesh, face)
      positions.push(
        centre[0], centre[1], centre[2],
        centre[0] + normal[0] * reach, centre[1] + normal[1] * reach, centre[2] + normal[2] * reach,
      )
    }
    normals.object.visible = positions.length > 0
    if (positions.length > 0) normals.setPositions(positions)
  }

  function writeFaceCentres(): void {
    if (!mesh) return
    const count = mesh.faces.length
    const positions = new Float32Array(count * 3)
    const states = new Float32Array(count)
    for (let slot = 0; slot < count; slot += 1) {
      const loop = mesh.faces[slot]!
      let x = 0
      let y = 0
      let z = 0
      for (const corner of loop) {
        x += mesh.vertices[corner * 3] ?? 0
        y += mesh.vertices[corner * 3 + 1] ?? 0
        z += mesh.vertices[corner * 3 + 2] ?? 0
      }
      const divisor = Math.max(1, loop.length)
      positions[slot * 3] = x / divisor
      positions[slot * 3 + 1] = y / divisor
      positions[slot * 3 + 2] = z / divisor
    }
    centreGeometry.setAttribute('position', new BufferAttribute(positions, 3))
    centreGeometry.setAttribute('aState', new BufferAttribute(states, 1))
  }

  /** Positions only: what a drag rewrites, sixty times a second. */
  function movePositions(next: MeshData): void {
    mesh = next
    const position = pointGeometry.getAttribute('position') as BufferAttribute | undefined
    if (!position || position.count !== next.vertexIds.length) return
    const array = position.array as Float32Array
    for (let index = 0; index < array.length; index += 1) array[index] = next.vertices[index] ?? 0
    position.needsUpdate = true
    const pick = vertexPickGeometry.getAttribute('position') as BufferAttribute | undefined
    if (pick) {
      ;(pick.array as Float32Array).set(array)
      pick.needsUpdate = true
    }
    writeEdgePositions(false)
    writeFaceCentres()
    writeNormals()
    applySelection()
  }

  function resizeFaceStates(count: number): void {
    const width = Math.max(1, Math.min(2048, count || 1))
    const height = Math.max(1, Math.ceil((count || 1) / width))
    // Four bytes a texel rather than one: a single-channel texture whose width is not a multiple
    // of four unpacks its rows shifted, and every face after the first row would read its
    // neighbour's state.
    const data = new Uint8Array(width * height * 4)
    /*
     * Freed before it is re-described, and not merely marked dirty.
     *
     * WebGL 2 gives a texture immutable storage the first time it is uploaded, and three then keeps
     * it up to date with `texSubImage2D`. Handing the same texture a larger image would therefore
     * write past the storage it was given — `GL_INVALID_VALUE: Offset overflows texture dimensions`
     * in the console, and a selection that stops updating on a mesh that has grown. Disposing drops
     * the allocation, so the next frame allocates one of the new size.
     */
    if (faceStates.image.width !== width || faceStates.image.height !== height) faceStates.dispose()
    faceStates.image = { data, width, height } as unknown as typeof faceStates.image
    faceStates.needsUpdate = true
    faceMaterial.uniforms.uStateSize!.value = [width, height]
  }

  /** The selection: one small array and one texture, never a geometry. */
  function applySelection(): void {
    if (!mesh) return
    const state = pointGeometry.getAttribute('aState') as BufferAttribute | undefined
    if (state) {
      const array = state.array as Float32Array
      array.fill(PLAIN)
      for (const slot of slots.vertices) if (slot >= 0 && slot < array.length) array[slot] = CHOSEN
      if (slots.active?.kind === 'vertex' && slots.active.slot < array.length) array[slots.active.slot] = ACTIVE
      if (hovered?.kind === 'vertex' && hovered.slot < array.length) array[hovered.slot] = UNDER_POINTER
      state.needsUpdate = true
    }
    const centreState = centreGeometry.getAttribute('aState') as BufferAttribute | undefined
    if (centreState) {
      const array = centreState.array as Float32Array
      array.fill(PLAIN)
      for (const slot of slots.faces) if (slot >= 0 && slot < array.length) array[slot] = CHOSEN
      if (slots.active?.kind === 'face' && slots.active.slot < array.length) array[slots.active.slot] = ACTIVE
      if (hovered?.kind === 'face' && hovered.slot < array.length) array[hovered.slot] = UNDER_POINTER
      centreState.needsUpdate = true
    }
    const data = faceStates.image.data as Uint8Array
    data.fill(0)
    const texels = data.length / 4
    for (const slot of slots.faces) if (slot >= 0 && slot < texels) data[slot * 4] = CHOSEN
    if (slots.active?.kind === 'face' && slots.active.slot < texels) data[slots.active.slot * 4] = ACTIVE
    if (hovered?.kind === 'face' && hovered.slot < texels) data[hovered.slot * 4] = UNDER_POINTER
    faceStates.needsUpdate = true
    writeEdgeColours()
  }

  function writeEdgeColours(): void {
    if (!mesh) return
    const count = mesh.edges.length
    const plain = new Color(colours.edge)
    const chosen = new Color(colours.edgeSelected)
    const active = new Color(colours.active)
    const under = new Color(colours.hover)
    const seam = new Color(colours.seam)
    const sharp = new Color(colours.sharp)
    const crease = new Color(colours.crease)
    const attributes = mesh.attributes.edge
    if (edgeColours.length !== count * 6) edgeColours = new Float32Array(count * 6)
    const rgb = edgeColours
    let selectedCount = 0
    for (let slot = 0; slot < count; slot += 1) {
      const isActive = slots.active?.kind === 'edge' && slots.active.slot === slot
      const isChosen = slots.edges.has(slot)
      const isUnder = hovered?.kind === 'edge' && hovered.slot === slot
      /*
       * An attribute wins over the plain edge colour and loses to the selection. Blender draws it
       * the same way round: a seam you have selected is drawn as selected, because what you are
       * about to move matters more than what the edge is marked as.
       */
      const marked = overlays.seams && attributes.seam?.[slot]
        ? seam
        : overlays.sharp && attributes.sharp?.[slot]
          ? sharp
          : overlays.creases && (attributes.crease?.[slot] ?? 0) > 0
            ? crease
            : overlays.bevelWeight && (attributes.bevelWeight?.[slot] ?? 0) > 0
              ? crease
              : null
      const colour = isUnder ? under : isActive ? active : isChosen ? chosen : marked ?? plain
      rgb[slot * 6] = colour.r
      rgb[slot * 6 + 1] = colour.g
      rgb[slot * 6 + 2] = colour.b
      rgb[slot * 6 + 3] = colour.r
      rgb[slot * 6 + 4] = colour.g
      rgb[slot * 6 + 5] = colour.b
      if (!isChosen && !isActive) continue
      selectedCount += 1
    }
    edges.setColours(rgb)
    // The thicker strip carries only what is selected, so its buffer is the size of the selection
    // rather than of the mesh — and a selection of four edges costs four edges' worth of work.
    if (chosenPositions.length !== selectedCount * 6) chosenPositions = new Float32Array(selectedCount * 6)
    let at = 0
    for (let slot = 0; slot < count; slot += 1) {
      const isActive = slots.active?.kind === 'edge' && slots.active.slot === slot
      if (!slots.edges.has(slot) && !isActive) continue
      const [a, b] = mesh.edges[slot]!
      chosenPositions[at] = mesh.vertices[a * 3] ?? 0
      chosenPositions[at + 1] = mesh.vertices[a * 3 + 1] ?? 0
      chosenPositions[at + 2] = mesh.vertices[a * 3 + 2] ?? 0
      chosenPositions[at + 3] = mesh.vertices[b * 3] ?? 0
      chosenPositions[at + 4] = mesh.vertices[b * 3 + 1] ?? 0
      chosenPositions[at + 5] = mesh.vertices[b * 3 + 2] ?? 0
      at += 6
    }
    chosenEdges.object.visible = selectedCount > 0
    if (selectedCount > 0) chosenEdges.setPositions(chosenPositions)
  }

  function applyModes(): void {
    points.visible = modes.includes('vertex')
    centres.visible = modes.includes('face') && overlays.faceCentres
    // Blender never hides the edges: they are how a person reads the shape they are working on.
    edges.object.visible = true
    if (faces) faces.visible = true
    /*
     * All three passes stay in the id buffer whatever is being selected. ⌥ click takes a loop of
     * edges while the editor is in vertex mode, and a hover has to know what it is over before the
     * priority is applied — a buffer that only answered for the current mode could do neither. A
     * region read narrows them for the length of its own render; see `setPickKinds`.
     */
    vertexPick.visible = true
    edgePick.visible = true
    if (facePick) facePick.visible = true
  }

  function applyXray(): void {
    pointMaterial.depthTest = !xray
    centreMaterial.depthTest = !xray
    edges.material.depthTest = !xray
    chosenEdges.material.depthTest = !xray
    faceMaterial.depthTest = !xray
    faceMaterial.uniforms.uOpacity!.value = xray ? colours.faceAlpha * 1.6 : colours.faceAlpha
    // In X-ray the id buffer must answer for what is behind as well, or a box selection would
    // choose the vertices a person can see and leave the ones they were told they were choosing.
    facePickMaterial.depthWrite = !xray
    facePickMaterial.depthTest = !xray
    edgePickMaterial.depthTest = !xray
    vertexPickMaterial.depthTest = !xray
    pointMaterial.needsUpdate = true
    faceMaterial.needsUpdate = true
  }

  return {
    root,
    pickRoot,
    setMatrix: (matrix) => {
      root.matrix.copy(matrix)
      root.matrixWorldNeedsUpdate = true
      pickRoot.matrix.copy(matrix)
      pickRoot.matrixWorldNeedsUpdate = true
    },
    setMesh: (next, meshView) => {
      const shape = topologySignature(next)
      if (mesh && shape === lastShape) movePositions(next)
      else {
        rebuild(next, meshView)
        lastShape = shape
      }
      applyModes()
      applyXray()
    },
    setSelection: (next) => {
      slots = next
      applySelection()
    },
    setHover: (next) => {
      if (hovered?.kind === next?.kind && hovered?.slot === next?.slot) return false
      hovered = next
      applySelection()
      return true
    },
    setSelectMode: (next) => {
      modes = next.length > 0 ? next : ['vertex']
      applyModes()
    },
    setPickKinds: (kinds) => {
      vertexPick.visible = kinds.includes('vertex')
      edgePick.visible = kinds.includes('edge')
      if (facePick) facePick.visible = kinds.includes('face')
    },
    setOverlays: (next) => {
      const drawnNormals = overlays.normals === next.normals && overlays.normalLength === next.normalLength
      // The colours are only worth rewriting when something that paints an edge has changed: on a
      // mesh of two hundred thousand edges that walk is most of a frame.
      const paintedEdges = overlays.seams === next.seams
        && overlays.sharp === next.sharp
        && overlays.creases === next.creases
        && overlays.bevelWeight === next.bevelWeight
      overlays = next
      if (!drawnNormals) writeNormals()
      applyModes()
      if (!paintedEdges) writeEdgeColours()
    },
    setXray: (next) => {
      xray = next
      applyXray()
    },
    setResolution: (width, height, ratio) => {
      size = { width, height }
      pointMaterial.uniforms.uPixelRatio!.value = ratio
      centreMaterial.uniforms.uPixelRatio!.value = ratio
      vertexPickMaterial.uniforms.uPixelRatio!.value = ratio
      setLineResolution(edges.material, size.width, size.height)
      setLineResolution(chosenEdges.material, size.width, size.height)
      setLineResolution(normals.material, size.width, size.height)
    },
    setTheme: (next) => {
      colours = readColours(next)
      ;(pointMaterial.uniforms.uPlain!.value as Color).set(colours.vertex)
      ;(pointMaterial.uniforms.uChosen!.value as Color).set(colours.vertexSelected)
      ;(pointMaterial.uniforms.uActive!.value as Color).set(colours.active)
      ;(pointMaterial.uniforms.uHover!.value as Color).set(colours.hover)
      ;(centreMaterial.uniforms.uHover!.value as Color).set(colours.hover)
      ;(faceMaterial.uniforms.uHover!.value as Color).set(colours.hover)
      ;(centreMaterial.uniforms.uPlain!.value as Color).set(colours.vertex)
      ;(centreMaterial.uniforms.uChosen!.value as Color).set(colours.vertexSelected)
      ;(centreMaterial.uniforms.uActive!.value as Color).set(colours.active)
      ;(faceMaterial.uniforms.uChosen!.value as Color).set(colours.faceSelected)
      ;(faceMaterial.uniforms.uActive!.value as Color).set(colours.faceActive)
      faceMaterial.uniforms.uOpacity!.value = colours.faceAlpha
      chosenEdges.setColour(colours.edgeSelected)
      normals.setColour(colours.normal)
      writeEdgeColours()
    },
    dispose: () => {
      pointGeometry.dispose()
      centreGeometry.dispose()
      pointMaterial.dispose()
      centreMaterial.dispose()
      edges.dispose()
      chosenEdges.dispose()
      normals.dispose()
      faceMaterial.dispose()
      faceStates.dispose()
      facePickMaterial.dispose()
      edgePickGeometry.dispose()
      edgePickMaterial.dispose()
      vertexPickGeometry.dispose()
      vertexPickMaterial.dispose()
      root.clear()
      pickRoot.clear()
    },
  }
}

/* ---------------------------------------------------------------- internals */

function writeId(target: Float32Array, offset: number, value: number): void {
  target[offset] = ((value >> 16) & 0xff) / 255
  target[offset + 1] = ((value >> 8) & 0xff) / 255
  target[offset + 2] = (value & 0xff) / 255
}

/**
 * What tells a rebuild from a move: the counts, the id counters and a walk of the loops. A drag
 * changes none of it, an operator changes some of it, and only the second needs new geometry.
 */
function topologySignature(mesh: MeshData): string {
  let hash = 2166136261
  for (let face = 0; face < mesh.faces.length; face += 1) {
    const loop = mesh.faces[face]!
    hash = Math.imul(hash ^ loop.length, 16777619)
    hash = Math.imul(hash ^ (loop[0] ?? 0), 16777619)
    hash = Math.imul(hash ^ (loop[loop.length - 1] ?? 0), 16777619)
  }
  return [
    mesh.vertexIds.length,
    mesh.edges.length,
    mesh.faces.length,
    mesh.nextVertexId,
    mesh.nextFaceId,
    hash >>> 0,
  ].join(':')
}

function readColours(theme: SceneTheme) {
  const edge = splitAlpha(theme.edge)
  const face = splitAlpha(theme.faceSelected)
  return {
    vertex: splitAlpha(theme.vertex).colour,
    vertexSelected: splitAlpha(theme.vertexSelected).colour,
    active: splitAlpha(theme.active).colour,
    edge: edge.colour,
    edgeAlpha: edge.alpha,
    edgeSelected: splitAlpha(theme.edgeSelected).colour,
    faceSelected: face.colour,
    faceAlpha: face.alpha,
    hover: splitAlpha(theme.hover).colour,
    faceActive: splitAlpha(theme.faceActive).colour,
    normal: splitAlpha(theme.normal).colour,
    seam: splitAlpha(theme.seam).colour,
    sharp: splitAlpha(theme.sharp).colour,
    crease: splitAlpha(theme.crease).colour,
  }
}
