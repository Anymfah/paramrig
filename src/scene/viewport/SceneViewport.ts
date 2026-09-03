import {
  Box3,
  Color,
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Matrix4,
  Mesh,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Camera,
  type Material,
} from 'three'
import { meshOf } from '@/scene/document'
import { drawnMesh, evaluateObject } from '@/scene/modifiers/stack'
import { parseEdgeKey } from '@/scene/mesh/data'
import type { MeshData, OverlayFlags, SceneDocument, SceneObject, SceneSelection, SelectMode, Vec3, ViewState } from '@/scene/types'
import { createGrid, type ViewportGrid } from '@/scene/viewport/grid'
import { setLineResolution } from '@/scene/viewport/lines'
import { localMatrix, worldMatrix } from '@/scene/objects'
import { buildMeshView, createMesh, edgePositions, meshViewIsCurrent, refreshMeshBounds, updateMeshPositions, type MeshView } from '@/scene/viewport/meshView'
import { cameraGlyph, cursorGlyph, emptyGlyph, lightGlyph, type Glyph } from '@/scene/viewport/overlays'
import { createMaskMaterial, createOutlinePass, OUTLINE_ACTIVE, OUTLINE_HOVER, OUTLINE_SELECTED, type OutlinePass } from '@/scene/viewport/outline'
import { createEditView, decodeElement, MAX_EDITED_OBJECTS, type EditSlots, type EditView } from '@/scene/viewport/editView'
import { createPickBuffer, createPickMaterial, decodePick, type PickBuffer, type PickResult } from '@/scene/viewport/picking'
import { createFaceOrientationMaterial, createSolidMaterial, createStudioLights, disposeMaterial, type StudioLights } from '@/scene/viewport/shading'
import { createAnnotationLayer, type AnnotationLayer } from '@/scene/viewport/annotations'
import { createGizmos, type GizmoHandle, type GizmoKind, type GizmoSet } from '@/scene/viewport/gizmo'
import { createTransformOverlay, type TransformOverlay } from '@/scene/viewport/transformOverlay'
import { countViewport } from '@/scene/viewport/debug'
import { readSceneTheme, splitAlpha, type SceneTheme } from '@/scene/viewport/theme'
import { cameraBasis, cameraPosition, fovFromFocalLength, isAxisView, orthoHeight } from '@/scene/viewport/view'
import { createLines, type ViewportLines } from '@/scene/viewport/lines'

/**
 * The 3D viewport: three.js, and no React inside it.
 *
 * React is very good at describing a panel and very bad at sixty frames a second. Everything in
 * here — the pointer position, the frame rate, the delta of a drag — changes faster than a render
 * pass can be scheduled, so none of it goes through a component. React owns the chrome; this class
 * owns the canvas, is mounted once, and is told about the document through plain method calls.
 *
 * Nothing is drawn unless something asked for it. `invalidate()` schedules exactly one frame; a
 * damped orbit or a view transition keeps asking until it has settled, and then the loop stops. An
 * idle editor uses no GPU at all, which is what makes a laptop's fan stay quiet with a scene open.
 */

export type SceneViewportOptions = {
  /** Injected so a test can hand over a double instead of asking jsdom for a WebGL context. */
  createRenderer?: (canvas: HTMLCanvasElement) => WebGLRenderer
  /** Device pixel ratio ceiling. Two is the point past which nobody can see the difference. */
  maxPixelRatio?: number
  onError?: (message: string) => void
  onFrame?: (info: FrameInfo) => void
}

export type FrameInfo = { duration: number; triangles: number; calls: number }

export type ViewportStats = {
  objects: number
  meshes: number
  vertices: number
  edges: number
  faces: number
  /** Triangles in the document. */
  triangles: number
  /** Triangles the last frame actually drew, which includes what an instance drew twice. */
  renderedTriangles: number
  drawCalls: number
  /** How many frames have been drawn since the viewport was created. */
  frames: number
  /** How many times a frame has been asked for; stays still when nothing is happening. */
  invalidateCount: number
  geometries: number
  textures: number
  samples: number
  contextLost: number
}

export const WEBGL2_MESSAGE = 'This browser cannot open the 3D editor: it has no WebGL 2. Everything else in ParamRig still works.'

type ObjectView = {
  id: string
  root: Group
  mesh?: Mesh
  meshView?: MeshView
  wire?: ViewportLines
  glyph?: Glyph
  pickMesh?: Mesh
  pickMaterial?: Material
  maskMesh?: Mesh
  maskMaterial?: Material
  material?: Material
  /** The meshes an empty draws on behalf of the collection it stands in for. */
  instances?: MeshView[]
  /** Their counterparts in the id buffer, so an instance can be clicked where it is drawn. */
  instancePicks?: Mesh[]
  /**
   * A geometry this view made for the id buffer alone. A mesh object's pick mesh shares the
   * geometry the object is drawn from and is given back with it; a glyph's proxy sphere has no
   * other owner, so this is what remembers to give it back.
   */
  pickGeometry?: BufferGeometry
  /** Whether the pick mesh is a glyph's proxy, which is sized in pixels rather than in metres. */
  glyphPick?: boolean
  /** What the view was built from, so a rebuild only happens when it has to. */
  signature: string
}

/** One element found under the pointer, and how far from it in pixels. */
export type ElementHit = { objectId: string; slot: number; distance: number }
export type ElementHits = { vertex: ElementHit | null; edge: ElementHit | null; face: ElementHit | null }

/**
 * The document's selection, in slots of one mesh.
 *
 * The document names elements by stable id and the viewport draws them by slot, so this is the one
 * place the two meet on the drawing side. It walks the mesh once and looks nothing up twice, which
 * matters: it runs on every click, and a click must never be the slow part of an editor.
 */
function editSlots(mesh: MeshData, selection: SceneSelection, objectId: string): EditSlots {
  const stored = selection.elements?.[objectId]
  const slots: EditSlots = { vertices: new Set(), edges: new Set(), faces: new Set(), active: null }
  if (!stored) return slots
  // Three indexes over a hundred thousand elements, built to look nothing up: the empty selection
  // is the commonest one there is, and it is the one a mesh is opened with.
  const active = selection.active
  const wanted = stored.vertices.length + stored.edges.length + stored.faces.length
  if (wanted === 0 && (!active || active.objectId !== objectId)) return slots
  const vertexSlot = new Map<number, number>()
  for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) vertexSlot.set(mesh.vertexIds[slot]!, slot)
  const faceSlot = new Map<number, number>()
  for (let slot = 0; slot < mesh.faceIds.length; slot += 1) faceSlot.set(mesh.faceIds[slot]!, slot)
  const edgeSlot = new Map<string, number>()
  for (let slot = 0; slot < mesh.edges.length; slot += 1) {
    const [a, b] = mesh.edges[slot]!
    edgeSlot.set(pairKey(mesh.vertexIds[a] ?? -1, mesh.vertexIds[b] ?? -1), slot)
  }
  for (const id of stored.vertices) {
    const slot = vertexSlot.get(Number(id))
    if (slot !== undefined) slots.vertices.add(slot)
  }
  for (const id of stored.faces) {
    const slot = faceSlot.get(Number(id))
    if (slot !== undefined) slots.faces.add(slot)
  }
  for (const key of stored.edges) {
    const pair = parseEdgeKey(key)
    if (!pair) continue
    const slot = edgeSlot.get(pairKey(pair[0], pair[1]))
    if (slot !== undefined) slots.edges.add(slot)
  }
  if (active && active.objectId === objectId) {
    if (active.kind === 'vertex') {
      const slot = vertexSlot.get(Number(active.id))
      if (slot !== undefined) slots.active = { kind: 'vertex', slot }
    } else if (active.kind === 'face') {
      const slot = faceSlot.get(Number(active.id))
      if (slot !== undefined) slots.active = { kind: 'face', slot }
    } else {
      const pair = parseEdgeKey(active.id)
      const slot = pair ? edgeSlot.get(pairKey(pair[0], pair[1])) : undefined
      if (slot !== undefined) slots.active = { kind: 'edge', slot }
    }
  }
  return slots
}

/** Whether any overlay the edit view draws has been switched, which is what makes it redraw. */
function overlaysChanged(before: OverlayFlags, after: OverlayFlags): boolean {
  const keys: Array<keyof OverlayFlags> = ['seams', 'sharp', 'creases', 'bevelWeight', 'faceCentres', 'normals', 'normalLength', 'faceOrientation']
  return keys.some((key) => before[key] !== after[key])
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

const UP: Vec3 = [0, 0, 1]

/** How many pixels across a glyph's grab area is, at any distance. */
const GLYPH_PICK_PX = 11

export class SceneViewport {
  readonly canvas: HTMLCanvasElement
  private readonly container: HTMLElement
  private renderer: WebGLRenderer | null = null
  private readonly options: SceneViewportOptions
  private readonly scene = new Scene()
  private readonly overlay = new Scene()
  private readonly objectRoot = new Group()
  private readonly overlayRoot = new Group()
  private perspective = new PerspectiveCamera(40, 1, 0.01, 1000)
  private orthographic = new OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
  private studio: StudioLights | null = null
  private grid: ViewportGrid | null = null
  private outline: OutlinePass | null = null
  private picking: PickBuffer | null = null
  private cursor: (Glyph & { setScreenScale: (scale: number) => void }) | null = null
  private transform: TransformOverlay | null = null
  private gizmos: GizmoSet | null = null
  private notes: AnnotationLayer | null = null
  private gizmoKinds: GizmoKind[] = []
  private gizmoPivot: Vec3 = [0, 0, 0]
  private gizmoBasis = { x: [1, 0, 0] as Vec3, y: [0, 1, 0] as Vec3, z: [0, 0, 1] as Vec3 }
  private views = new Map<string, ObjectView>()
  /** One per mesh open for editing, keyed by object id; the index is what its element ids carry. */
  private editViews = new Map<string, { view: EditView; index: number; cage?: MeshView }>()
  private editObjects: string[] = []
  /** Built the first time the face-orientation overlay is switched on, and kept for the session. */
  private orientationMaterial: Material | null = null
  private observer: ResizeObserver | null = null
  private frameHandle: number | null = null
  private disposed = false
  private failed = false

  private document: SceneDocument | null = null
  private selection: SceneSelection = { objectIds: [], activeObjectId: null }
  private hoverId: string | null = null
  private view: ViewState | null = null
  private theme: SceneTheme
  private size = { width: 1, height: 1 }
  private pixelRatio = 1
  private counters = { frames: 0, invalidate: 0, contextLost: 0, drawCalls: 0, triangles: 0 }
  private readonly raycaster = new Raycaster()
  /** Every disposable this viewport created, so `dispose` can prove it left nothing behind. */
  private readonly disposables: Array<() => void> = []

  constructor(container: HTMLElement, options: SceneViewportOptions = {}) {
    this.container = container
    this.options = options
    this.theme = readSceneTheme(container)
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'scene-canvas'
    this.canvas.setAttribute('data-scene-canvas', '')
    container.appendChild(this.canvas)

    this.scene.add(this.objectRoot)
    this.overlay.add(this.overlayRoot)
    for (const camera of [this.perspective, this.orthographic]) camera.up.set(UP[0], UP[1], UP[2])

    try {
      this.renderer = options.createRenderer
        ? options.createRenderer(this.canvas)
        : new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false })
    } catch {
      this.fail(WEBGL2_MESSAGE)
      return
    }
    const context = this.renderer.getContext()
    // WebGL 1 cannot do what the id buffer, the grid's derivatives and the line shader need.
    if (typeof WebGL2RenderingContext !== 'undefined' && !(context instanceof WebGL2RenderingContext)) {
      this.fail(WEBGL2_MESSAGE)
      return
    }
    this.renderer.autoClear = false
    // A frame is four passes, and `info` resets itself on every one of them: left alone it would
    // report the overlay's triangles as the frame's, which is neither the truth nor useful.
    this.renderer.info.autoReset = false
    this.renderer.setClearColor(new Color(splitAlpha(this.theme.viewport).colour), 1)

    this.studio = createStudioLights()
    this.scene.add(this.studio.group)
    this.grid = createGrid({
      line: this.theme.grid,
      major: this.theme.gridMajor,
      axisX: this.theme.axisX,
      axisY: this.theme.axisY,
      axisZ: this.theme.axisZ,
      showFloor: true,
      showAxisX: true,
      showAxisY: true,
      showAxisZ: false,
      plane: 'xy',
    })
    this.scene.add(this.grid.mesh)
    this.outline = createOutlinePass()
    this.outline.setColours({
      hover: splitAlpha(this.theme.hover).colour,
      selected: splitAlpha(this.theme.selected).colour,
      active: splitAlpha(this.theme.active).colour,
      halo: splitAlpha(this.theme.outlineHalo).colour,
    })
    this.outline.setWidth(2 * Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1))
    this.picking = createPickBuffer()
    this.cursor = cursorGlyph({ ring: splitAlpha(this.theme.cursorRing).colour, ground: splitAlpha(this.theme.cursorGround).colour })
    this.overlayRoot.add(this.cursor.object)
    this.transform = createTransformOverlay(this.theme)
    this.overlayRoot.add(this.transform.group)
    this.notes = createAnnotationLayer(this.theme)
    this.overlayRoot.add(this.notes.group)
    this.gizmos = createGizmos(this.theme)
    this.overlayRoot.add(this.gizmos.group)
    this.picking.scene.add(this.gizmos.pickGroup)
    this.gizmos.setVisible(false)

    this.canvas.addEventListener('webglcontextlost', this.onContextLost)
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored)

    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize())
      this.observer.observe(container)
    }
    countViewport(1)
    this.resize()
  }

  /* ------------------------------------------------------------- lifecycle */

  private fail(message: string): void {
    this.failed = true
    this.options.onError?.(message)
  }

  get ok(): boolean {
    return !this.failed && !!this.renderer
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle)
    this.frameHandle = null
    this.observer?.disconnect()
    this.observer = null
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    for (const view of this.views.values()) this.disposeObjectView(view)
    this.views.clear()
    for (const entry of this.editViews.values()) {
      entry.view.dispose()
      entry.cage?.dispose()
    }
    this.editViews.clear()
    this.cursor?.dispose()
    this.transform?.dispose()
    this.gizmos?.dispose()
    this.notes?.dispose()
    this.grid?.dispose()
    this.outline?.dispose()
    this.picking?.dispose()
    this.studio?.dispose()
    for (const dispose of this.disposables.splice(0)) dispose()
    this.scene.clear()
    this.overlay.clear()
    this.renderer?.dispose()
    // Read after the dispose: what is still counted here is what was not given back.
    const left = this.renderer
      ? {
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        programs: this.renderer.info.programs?.length ?? 0,
      }
      : { geometries: 0, textures: 0, programs: 0 }
    this.renderer?.forceContextLoss?.()
    this.renderer = null
    this.canvas.remove()
    countViewport(-1, left)
  }

  private onContextLost = (event: Event) => {
    // Without this the browser never fires `webglcontextrestored`, and the canvas stays black.
    event.preventDefault()
    this.counters.contextLost += 1
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle)
    this.frameHandle = null
  }

  private onContextRestored = () => {
    // Everything on the card is gone: geometries, textures, programs. Rebuilding from the document
    // is the only honest recovery, and it is cheap enough that a reload would be an insult.
    const document = this.document
    for (const view of this.views.values()) this.disposeObjectView(view)
    this.views.clear()
    for (const entry of this.editViews.values()) {
      entry.view.dispose()
      entry.cage?.dispose()
    }
    this.editViews.clear()
    this.renderer?.resetState()
    this.applySize()
    if (document) this.setDocument(document)
    this.invalidate()
  }

  /* ------------------------------------------------------------------ size */

  resize(): void {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    const ratio = Math.min(this.options.maxPixelRatio ?? 2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)
    if (width === this.size.width && height === this.size.height && ratio === this.pixelRatio) return
    this.size = { width, height }
    this.pixelRatio = ratio
    this.applySize()
    this.invalidate()
  }

  private applySize(): void {
    const { width, height } = this.size
    this.renderer?.setPixelRatio(this.pixelRatio)
    this.renderer?.setSize(width, height, false)
    const buffer = { width: Math.max(1, Math.round(width * this.pixelRatio)), height: Math.max(1, Math.round(height * this.pixelRatio)) }
    this.outline?.setSize(buffer.width, buffer.height)
    // The outline is two CSS pixels wherever it is drawn, which means two device pixels times the
    // ratio; a fixed texel count would be a hairline on a retina screen and a slab on a projector.
    this.outline?.setWidth(2 * this.pixelRatio)
    this.picking?.setSize(buffer.width, buffer.height)
    this.perspective.aspect = width / height
    this.perspective.updateProjectionMatrix()
    for (const entry of this.editViews.values()) entry.view.setResolution(buffer.width, buffer.height, this.pixelRatio)
    for (const view of this.views.values()) {
      if (view.wire) setLineResolution(view.wire.material, buffer.width, buffer.height)
      if (!view.glyph) continue
      for (const line of view.glyph.lines) setLineResolution(line.material, buffer.width, buffer.height)
    }
    if (this.cursor) for (const line of this.cursor.lines) setLineResolution(line.material, buffer.width, buffer.height)
    this.transform?.setResolution(buffer.width, buffer.height)
    this.gizmos?.setResolution(buffer.width, buffer.height)
    this.notes?.setResolution(buffer.width, buffer.height)
  }

  get pixelSize(): { width: number; height: number } {
    return { ...this.size }
  }

  /* ----------------------------------------------------------------- state */

  setTheme(): void {
    this.theme = readSceneTheme(this.container)
    for (const entry of this.editViews.values()) entry.view.setTheme(this.theme)
    this.renderer?.setClearColor(new Color(splitAlpha(this.theme.viewport).colour), 1)
    this.grid?.update({
      line: this.theme.grid,
      major: this.theme.gridMajor,
      axisX: this.theme.axisX,
      axisY: this.theme.axisY,
      axisZ: this.theme.axisZ,
    })
    this.outline?.setColours({
      hover: splitAlpha(this.theme.hover).colour,
      selected: splitAlpha(this.theme.selected).colour,
      active: splitAlpha(this.theme.active).colour,
      halo: splitAlpha(this.theme.outlineHalo).colour,
    })
    if (this.cursor) {
      this.cursor.lines[0]?.setColour(splitAlpha(this.theme.cursorGround).colour)
      this.cursor.lines[1]?.setColour(splitAlpha(this.theme.cursorRing).colour)
      this.cursor.lines[2]?.setColour(splitAlpha(this.theme.cursorGround).colour)
      this.cursor.lines[3]?.setColour(splitAlpha(this.theme.cursorRing).colour)
    }
    this.transform?.setTheme(this.theme)
    this.gizmos?.setTheme(this.theme)
    this.notes?.setTheme(this.theme)
    for (const view of this.views.values()) {
      const object = this.document?.objects.find((entry) => entry.id === view.id)
      if (object) this.paintGlyph(view, object)
    }
    this.invalidate()
  }

  /** The freehand notes and the rulers drawn over the scene. */
  get annotations(): AnnotationLayer | null {
    return this.notes
  }

  /** The lines a modal transform draws: its constraint axes and its measuring line. */
  get transformOverlay(): TransformOverlay | null {
    return this.transform
  }

  /**
   * Where the gizmos are and which of them are shown. Called when the selection or the header
   * changes, not every frame — but their screen size is recomputed on every frame, in `render`.
   */
  setGizmos(kinds: GizmoKind[], pivot: Vec3, basis: { x: Vec3; y: Vec3; z: Vec3 }): void {
    this.gizmoKinds = kinds
    this.gizmoPivot = pivot
    this.gizmoBasis = basis
    this.gizmos?.setVisible(kinds.length > 0)
    this.placeGizmos()
    this.invalidate()
  }

  setGizmoHover(id: number | null): void {
    this.gizmos?.setHover(id)
    this.invalidate()
  }

  gizmoHandle(pick: PickResult): GizmoHandle | null {
    return this.gizmos?.handleOf(pick) ?? null
  }

  /** The world size of a screen pixel at a point, which is what keeps a gizmo one size. */
  unitsPerPixelAt(point: Vec3): number {
    const view = this.view
    if (!view) return 1
    const forward = cameraBasis(view.yaw, view.pitch).forward
    const camera: Vec3 = [
      view.target[0] - forward[0] * view.distance,
      view.target[1] - forward[1] * view.distance,
      view.target[2] - forward[2] * view.distance,
    ]
    const depth = view.projection === 'orthographic'
      ? view.distance
      : Math.max(1e-4, (point[0] - camera[0]) * forward[0] + (point[1] - camera[1]) * forward[1] + (point[2] - camera[2]) * forward[2])
    const fov = (fovFromFocalLength(view.focalLength) * Math.PI) / 180
    return (2 * Math.tan(fov / 2) * depth) / Math.max(1, this.size.height)
  }

  private placeGizmos(): void {
    if (!this.gizmos || this.gizmoKinds.length === 0) return
    this.gizmos.update({
      kinds: this.gizmoKinds,
      pivot: this.gizmoPivot,
      basis: this.gizmoBasis,
      unitsPerPixel: this.unitsPerPixelAt(this.gizmoPivot),
      camera: this.camera,
    })
  }

  setDocument(document: SceneDocument): void {
    this.document = document
    this.syncObjects()
    this.syncEdit()
    this.syncCursor()
    this.notes?.setAnnotations(document.annotations ?? [])
    this.notes?.setMeasurements(document.measurements ?? [], null)
    this.invalidate()
  }

  setSelection(selection: SceneSelection): void {
    this.selection = selection
    this.syncOutlineScene()
    this.syncEdit()
    this.invalidate()
  }

  setHover(objectId: string | null): void {
    if (this.hoverId === objectId) return
    this.hoverId = objectId
    this.syncOutlineScene()
    this.invalidate()
  }

  setView(view: ViewState): void {
    const before = this.view
    this.view = view
    this.applyView()
    if (
      !before
      || before.mode !== view.mode
      || before.xray !== view.xray
      || before.selectMode.join() !== view.selectMode.join()
      || overlaysChanged(before.overlays, view.overlays)
    ) {
      this.syncEdit()
    }
    this.invalidate()
  }

  /* --------------------------------------------------------------- objects */

  /** Whether this object is one of the meshes open for editing, which some modifiers stand aside for. */
  private isEditing(object: SceneObject): boolean {
    return this.view?.mode === 'edit' && (this.selection.editObjectIds ?? []).includes(object.id)
  }

  /**
   * What an object really looks like: its mesh with its modifier stack run over it. An object with
   * no modifiers gets its own mesh back untouched, so a scene without any pays nothing for this.
   */
  private drawnMeshOf(object: SceneObject): MeshData | null {
    if (!this.document) return null
    return drawnMesh(this.document, object, { editing: this.isEditing(object) })
  }

  private objectSignature(object: SceneObject): string {
    const mesh = this.document ? this.drawnMeshOf(object) : null
    return JSON.stringify([
      object.kind,
      object.data.kind === 'mesh' ? object.data.meshId : object.data,
      mesh ? mesh.faces.length : 0,
      // A stack that changed is a different shape, even when the face count happens to match.
      object.modifiers.map((modifier) => [modifier.kind, modifier.enabled, modifier.params]),
      this.isEditing(object),
      object.displayAs ?? 'textured',
      // An empty that stands in for a collection is rebuilt when that collection changes.
      object.data.kind === 'empty' && object.data.instanceCollectionId
        ? this.collectionSignature(object.data.instanceCollectionId)
        : null,
    ])
  }

  /** What a collection holds, as far as an instance of it is concerned. */
  private collectionSignature(collectionId: string): string {
    const document = this.document
    if (!document) return ''
    return document.objects
      .filter((object) => object.collectionId === collectionId && object.data.kind === 'mesh')
      .map((object) => `${object.id}:${(object.data as { meshId: string }).meshId}:${JSON.stringify(object.transform)}`)
      .join('|')
  }

  private syncObjects(): void {
    const document = this.document
    if (!document) return
    const alive = new Set<string>()
    for (const object of document.objects) {
      alive.add(object.id)
      let view = this.views.get(object.id)
      const signature = this.objectSignature(object)
      if (view && view.signature !== signature) {
        this.disposeObjectView(view)
        this.views.delete(object.id)
        view = undefined
      }
      if (!view) {
        view = this.createObjectView(object, signature)
        this.views.set(object.id, view)
      } else if (object.data.kind === 'mesh' && view.meshView) {
        const mesh = this.drawnMeshOf(object)
        if (mesh && !meshViewIsCurrent(view.meshView, mesh)) {
          updateMeshPositions(view.meshView, mesh)
          refreshMeshBounds(view.meshView)
          // The fingerprint is cleared so the next comparison is forced; the source is what says
          // “this is the very mesh I was last given”, and it is now that one.
          view.meshView.fingerprint = ''
          view.meshView.source = mesh
          view.wire?.setPositions(edgePositions(mesh))
        }
      }
      this.placeObject(view, object)
    }
    for (const [id, view] of [...this.views]) {
      if (alive.has(id)) continue
      this.disposeObjectView(view)
      this.views.delete(id)
    }
    this.syncOutlineScene()
  }

  /* ------------------------------------------------------------ edit mode */

  /**
   * The meshes open for editing get a second layer over them: dots, edges and face tints, and the
   * same three again in the id buffer so that they can be clicked. The object's own pick mesh goes
   * dark while it is being edited — a click in edit mode chooses a vertex, never the object it
   * belongs to, and leaving both in the buffer would make the answer depend on which happened to
   * be nearer the pointer.
   */
  /**
   * Face orientation replaces the shading rather than drawing over it: the question it answers is
   * about every face at once, and a tint over a lit surface would be read as a material.
   */
  private applyFaceOrientation(): void {
    const wanted = this.view?.overlays.faceOrientation === true
    if (wanted && !this.orientationMaterial) {
      this.orientationMaterial = createFaceOrientationMaterial(
        splitAlpha(this.theme.faceFront).colour,
        splitAlpha(this.theme.faceBack).colour,
      )
      this.disposables.push(() => disposeMaterial(this.orientationMaterial))
    }
    for (const view of this.views.values()) {
      if (!view.mesh || !view.material) continue
      const material = wanted && this.orientationMaterial ? this.orientationMaterial : view.material
      if (view.mesh.material !== material) view.mesh.material = material
    }
  }

  private syncEdit(): void {
    this.applyFaceOrientation()
    const document = this.document
    const editing = this.view?.mode === 'edit'
      ? (this.selection.editObjectIds ?? []).filter((id) => document?.objects.some((object) => object.id === id)).slice(0, MAX_EDITED_OBJECTS)
      : []
    this.editObjects = editing
    for (const [id, entry] of [...this.editViews]) {
      if (editing.includes(id) && editing.indexOf(id) === entry.index) continue
      this.overlayRoot.remove(entry.view.root)
      this.picking?.scene.remove(entry.view.pickRoot)
      entry.view.dispose()
      entry.cage?.dispose()
      this.editViews.delete(id)
    }
    for (const [id, view] of this.views) {
      if (view.pickMesh) view.pickMesh.visible = !editing.includes(id)
    }
    if (!document || editing.length === 0) return
    const buffer = { width: Math.round(this.size.width * this.pixelRatio), height: Math.round(this.size.height * this.pixelRatio) }
    editing.forEach((id, index) => {
      const object = document.objects.find((candidate) => candidate.id === id)
      const objectView = this.views.get(id)
      /*
       * The overlay is drawn on the *cage* — the mesh a person is editing — and not on what the
       * modifiers made of it. They can have different faces entirely, so the overlay carries its own
       * geometry rather than borrowing the object's: a face tinted by the index of another mesh's
       * face is a tint on the wrong face.
       */
      const data = object ? evaluateObject(document, object, { editing: true })?.cage ?? meshOf(document, object) : null
      if (!object || !objectView || !data) return
      let entry = this.editViews.get(id)
      if (!entry) {
        entry = { view: createEditView(index, this.theme), index }
        this.editViews.set(id, entry)
        this.overlayRoot.add(entry.view.root)
        this.picking?.scene.add(entry.view.pickRoot)
      }
      if (!entry.cage || !meshViewIsCurrent(entry.cage, data)) {
        entry.cage?.dispose()
        entry.cage = buildMeshView(data)
      }
      entry.view.setResolution(buffer.width, buffer.height, this.pixelRatio)
      entry.view.setMesh(data, entry.cage)
      entry.view.setSelectMode(this.view?.selectMode ?? ['vertex'])
      const overlays = this.view?.overlays
      entry.view.setOverlays({
        seams: overlays?.seams ?? true,
        sharp: overlays?.sharp ?? true,
        creases: overlays?.creases ?? true,
        bevelWeight: overlays?.bevelWeight ?? false,
        faceCentres: overlays?.faceCentres ?? true,
        normals: overlays?.normals ?? false,
        normalLength: overlays?.normalLength ?? 0.2,
      })
      entry.view.setXray(this.view?.xray ?? false)
      entry.view.setSelection(editSlots(data, this.selection, id))
      entry.view.setMatrix(objectView.root.matrix)
    })
  }

  /** Draws one element as being under the pointer. True when that changed anything. */
  setElementHover(element: { objectId: string; kind: SelectMode; slot: number } | null): boolean {
    let changed = false
    for (const [id, entry] of this.editViews) {
      const wanted = element && element.objectId === id ? { kind: element.kind, slot: element.slot } : null
      if (entry.view.setHover(wanted)) changed = true
    }
    return changed
  }

  /**
   * What is under the pointer, per kind, within a radius. One render and one read answer for all
   * three: the caller applies Blender's priority — a vertex beats an edge beats a face — rather
   * than this deciding for it, because the priority depends on which kinds are being selected.
   */
  pickElements(x: number, y: number, radius = 10): ElementHits {
    const renderer = this.renderer
    const hits: ElementHits = { vertex: null, edge: null, face: null }
    if (!renderer || !this.picking || this.editObjects.length === 0) return hits
    const ratio = this.pixelRatio
    const half = Math.max(1, Math.round(radius * ratio))
    const left = Math.round(x * ratio) - half
    const top = Math.round(y * ratio) - half
    const span = half * 2 + 1
    const buffer = this.picking.region(renderer, this.camera, left, top, span, span)
    for (let row = 0; row < span; row += 1) {
      for (let column = 0; column < span; column += 1) {
        const offset = (row * span + column) * 4
        const found = decodePick(buffer[offset]!, buffer[offset + 1]!, buffer[offset + 2]!, buffer[offset + 3]!)
        if (!found || (found.kind !== 'vertex' && found.kind !== 'edge' && found.kind !== 'face')) continue
        const { objectIndex, elementIndex } = decodeElement(found.id)
        const objectId = this.editObjects[objectIndex]
        if (!objectId) continue
        // The buffer's rows run bottom-up and the pointer's coordinates run top-down.
        const dx = column - half
        const dy = (span - 1 - row) - half
        const distance = Math.sqrt(dx * dx + dy * dy) / ratio
        const current = hits[found.kind]
        if (current && current.distance <= distance) continue
        hits[found.kind] = { objectId, slot: elementIndex, distance }
      }
    }
    return hits
  }

  /** Every element whose pixels fall inside a rectangle, for the box, lasso and circle tools. */
  pickElementRegion(
    x: number,
    y: number,
    width: number,
    height: number,
    inside?: (px: number, py: number) => boolean,
    kinds?: SelectMode[],
  ): Map<string, { vertices: Set<number>; edges: Set<number>; faces: Set<number> }> {
    const found = new Map<string, { vertices: Set<number>; edges: Set<number>; faces: Set<number> }>()
    const renderer = this.renderer
    if (!renderer || !this.picking || width < 1 || height < 1 || this.editObjects.length === 0) return found
    // Only the kinds being selected are drawn into the buffer for this read, which is what Blender
    // selects with a box and, on a heavy mesh, two passes of drawing that nobody would have read.
    const wanted = kinds && kinds.length > 0 ? kinds : (['vertex', 'edge', 'face'] as SelectMode[])
    for (const entry of this.editViews.values()) entry.view.setPickKinds(wanted)
    const ratio = this.pixelRatio
    const buffer = this.picking.region(renderer, this.camera, x * ratio, y * ratio, width * ratio, height * ratio)
    const readWidth = Math.max(1, Math.round(width * ratio))
    const readHeight = Math.max(1, Math.round(height * ratio))
    /*
     * A face covers thousands of pixels and they all say the same thing. Comparing the four bytes
     * with the last pixel's is two comparisons; decoding them and touching three sets is not, and
     * over a million pixels the difference is the whole cost of a box selection.
     */
    /*
     * The pixels are read four bytes at a time. The number that comes out is not a colour in any
     * particular order — the packing depends on the machine — but it is the same number for the
     * same four bytes, which is all an "is this the same as the last one" test needs. Only when it
     * differs are the bytes taken apart.
     */
    const packed = new Uint32Array(buffer.buffer, buffer.byteOffset, (buffer.length / 4) | 0)
    let lastKey = -1
    let lastInside = true
    for (let row = 0; row < readHeight; row += 1) {
      for (let column = 0; column < readWidth; column += 1) {
        const pixel = row * readWidth + column
        const offset = pixel * 4
        if (buffer[offset + 3] === 0) continue
        const key = packed[pixel]!
        const shape = inside ? inside(x + column / ratio, y + (readHeight - 1 - row) / ratio) : true
        if (key === lastKey && shape === lastInside) continue
        lastKey = key
        lastInside = shape
        if (!shape) continue
        const hit = decodePick(buffer[offset]!, buffer[offset + 1]!, buffer[offset + 2]!, buffer[offset + 3]!)
        if (!hit || (hit.kind !== 'vertex' && hit.kind !== 'edge' && hit.kind !== 'face')) continue
        const { objectIndex, elementIndex } = decodeElement(hit.id)
        const objectId = this.editObjects[objectIndex]
        if (!objectId) continue
        let entry = found.get(objectId)
        if (!entry) {
          entry = { vertices: new Set(), edges: new Set(), faces: new Set() }
          found.set(objectId, entry)
        }
        if (hit.kind === 'vertex') entry.vertices.add(elementIndex)
        else if (hit.kind === 'edge') entry.edges.add(elementIndex)
        else entry.faces.add(elementIndex)
      }
    }
    for (const entry of this.editViews.values()) entry.view.setPickKinds(['vertex', 'edge', 'face'])
    return found
  }

  private createObjectView(object: SceneObject, signature: string): ObjectView {
    const root = new Group()
    root.matrixAutoUpdate = false
    this.objectRoot.add(root)
    const view: ObjectView = { id: object.id, root, signature }

    if (object.data.kind === 'mesh' && this.document) {
      const data = this.drawnMeshOf(object)
      if (data) {
        const meshView = buildMeshView(data)
        const material = createSolidMaterial()
        const mesh = createMesh(meshView, material)
        mesh.matrixAutoUpdate = false
        root.add(mesh)
        view.meshView = meshView
        view.mesh = mesh
        view.material = material

        const pickMaterial = createPickMaterial('object', this.objectIndex(object.id))
        const pickMesh = createMesh(meshView, pickMaterial)
        pickMesh.matrixAutoUpdate = false
        view.pickMesh = pickMesh
        view.pickMaterial = pickMaterial
        this.picking?.scene.add(pickMesh)

        const maskMaterial = createMaskMaterial(OUTLINE_SELECTED)
        const maskMesh = createMesh(meshView, maskMaterial)
        maskMesh.matrixAutoUpdate = false
        maskMesh.visible = false
        view.maskMesh = maskMesh
        view.maskMaterial = maskMaterial
        this.outline?.scene.add(maskMesh)

        const wire = createLines({ positions: edgePositions(data), colour: splitAlpha(this.theme.edge).colour, width: 1, opacity: splitAlpha(this.theme.edge).alpha })
        wire.object.visible = false
        root.add(wire.object)
        view.wire = wire
      }
    } else {
      view.glyph = this.buildGlyph(object)
      if (view.glyph) root.add(view.glyph.object)
      /*
       * A light, a camera and an empty are glyphs, and a glyph is lines: the id buffer would find
       * nothing under the pointer, and neither would a click. Each gets an invisible solid at its
       * origin, sized to the glyph it stands behind, so it is as clickable as anything else.
       */
      const pickMaterial = createPickMaterial('object', this.objectIndex(object.id))
      const proxyGeometry = new SphereGeometry(1, 12, 8)
      const proxy = new Mesh(proxyGeometry, pickMaterial)
      proxy.matrixAutoUpdate = false
      view.pickMesh = proxy
      view.pickMaterial = pickMaterial
      view.pickGeometry = proxyGeometry
      view.glyphPick = true
      this.picking?.scene.add(proxy)
      /*
       * An empty may stand in for a whole collection. Blender draws the collection's contents at
       * the empty, without copying them into the document — so this builds a second set of meshes
       * from the same `MeshData`, parented to the empty, and nothing else in the editor has to know
       * that they are not objects.
       */
      if (object.data.kind === 'empty' && object.data.instanceCollectionId && this.document) {
        const collectionId = object.data.instanceCollectionId
        const material = createSolidMaterial()
        view.material = material
        view.instances = []
        for (const member of this.document.objects) {
          if (member.collectionId !== collectionId || member.data.kind !== 'mesh') continue
          // A collection that contains this very empty would instance itself for ever.
          if (member.id === object.id) continue
          const data = drawnMesh(this.document, member)
          if (!data) continue
          const built = buildMeshView(data)
          const mesh = createMesh(built, material)
          mesh.matrix.copy(localMatrix(member))
          mesh.matrixAutoUpdate = false
          mesh.matrixWorldNeedsUpdate = true
          root.add(mesh)
          view.instances.push(built)
          const proxyMaterial = createPickMaterial('object', this.objectIndex(object.id))
          const proxy = createMesh(built, proxyMaterial)
          proxy.matrixAutoUpdate = false
          proxy.userData.local = localMatrix(member)
          view.instancePicks = view.instancePicks ?? []
          view.instancePicks.push(proxy)
          this.picking?.scene.add(proxy)
        }
      }
    }
    const buffer = { width: Math.round(this.size.width * this.pixelRatio), height: Math.round(this.size.height * this.pixelRatio) }
    if (view.wire) setLineResolution(view.wire.material, buffer.width, buffer.height)
    for (const line of view.glyph?.lines ?? []) setLineResolution(line.material, buffer.width, buffer.height)
    return view
  }

  private buildGlyph(object: SceneObject): Glyph | undefined {
    const colour = this.glyphColour(object)
    if (object.data.kind === 'light') return lightGlyph(object.data, colour)
    if (object.data.kind === 'camera') return cameraGlyph(object.data, colour)
    if (object.data.kind === 'empty') return emptyGlyph(object.data, colour)
    return undefined
  }

  private glyphColour(object: SceneObject): string {
    if (this.selection.activeObjectId === object.id) return splitAlpha(this.theme.active).colour
    if (this.selection.objectIds.includes(object.id)) return splitAlpha(this.theme.selected).colour
    return splitAlpha(this.theme.gizmoView).colour
  }

  private paintGlyph(view: ObjectView, object: SceneObject): void {
    if (!view.glyph) return
    const colour = this.glyphColour(object)
    for (const line of view.glyph.lines) line.setColour(colour)
  }

  private objectIndex(id: string): number {
    return this.document ? this.document.objects.findIndex((object) => object.id === id) : -1
  }

  private placeObject(view: ObjectView, object: SceneObject): void {
    const matrix = this.document ? worldMatrix(this.document, object) : localMatrix(object)
    view.root.matrix.copy(matrix)
    view.root.matrixWorldNeedsUpdate = true
    const visible = this.isVisible(object)
    view.root.visible = visible
    if (view.pickMesh) {
      view.pickMesh.matrix.copy(matrix)
      view.pickMesh.matrixWorldNeedsUpdate = true
      view.pickMesh.visible = visible && object.selectable
      if (view.glyphPick) {
        view.pickMesh.userData.world = matrix.clone()
        this.sizeGlyphPick(view)
      }
    }
    for (const proxy of view.instancePicks ?? []) {
      proxy.matrix.multiplyMatrices(matrix, proxy.userData.local as Matrix4)
      proxy.matrixWorldNeedsUpdate = true
      proxy.visible = visible && object.selectable
    }
    if (view.maskMesh) {
      view.maskMesh.matrix.copy(matrix)
      view.maskMesh.matrixWorldNeedsUpdate = true
    }
    this.paintGlyph(view, object)
  }

  private isVisible(object: SceneObject): boolean {
    if (!object.visible) return false
    const local = this.view?.localObjectIds
    if (local && local.length > 0 && !local.includes(object.id)) return false
    const collection = this.document?.collections.find((entry) => entry.id === object.collectionId)
    if (collection?.hidden || collection?.excluded) return false
    return true
  }

  private disposeObjectView(view: ObjectView): void {
    for (const instance of view.instances ?? []) instance.dispose()
    for (const proxy of view.instancePicks ?? []) {
      this.picking?.scene.remove(proxy)
      disposeMaterial(proxy.material as Material)
    }
    view.pickGeometry?.dispose()
    view.meshView?.dispose()
    view.wire?.dispose()
    view.glyph?.dispose()
    disposeMaterial(view.material)
    disposeMaterial(view.pickMaterial)
    disposeMaterial(view.maskMaterial)
    if (view.pickMesh) this.picking?.scene.remove(view.pickMesh)
    if (view.maskMesh) this.outline?.scene.remove(view.maskMesh)
    view.root.removeFromParent()
    view.root.clear()
  }

  private syncOutlineScene(): void {
    for (const view of this.views.values()) {
      if (!view.maskMesh || !view.maskMaterial) continue
      const state = this.selection.activeObjectId === view.id
        ? OUTLINE_ACTIVE
        : this.selection.objectIds.includes(view.id)
          ? OUTLINE_SELECTED
          : this.hoverId === view.id
            ? OUTLINE_HOVER
            : 0
      view.maskMesh.visible = state > 0 && view.root.visible
      const uniforms = (view.maskMaterial as unknown as { uniforms?: { uState?: { value: number } } }).uniforms
      if (uniforms?.uState) uniforms.uState.value = state
    }
    const document = this.document
    if (!document) return
    for (const object of document.objects) {
      const view = this.views.get(object.id)
      if (view) this.paintGlyph(view, object)
    }
  }

  private syncCursor(): void {
    const cursor = this.document?.cursor
    if (!cursor || !this.cursor) return
    this.cursor.object.position.set(cursor.position[0], cursor.position[1], cursor.position[2])
    this.cursor.object.visible = this.view?.overlays.cursor !== false
    this.cursor.object.updateMatrix()
  }

  /* -------------------------------------------------------------- the view */

  private applyView(): void {
    const view = this.view
    if (!view) return
    const position = cameraPosition(view)
    const basis = cameraBasis(view.yaw, view.pitch)
    const fov = fovFromFocalLength(view.focalLength)
    this.perspective.fov = fov
    this.perspective.near = view.clipStart
    this.perspective.far = view.clipEnd
    this.perspective.position.set(position[0], position[1], position[2])
    this.perspective.up.set(basis.up[0], basis.up[1], basis.up[2])
    this.perspective.lookAt(view.target[0], view.target[1], view.target[2])
    this.perspective.updateProjectionMatrix()

    // The orthographic camera stands in the same place and shows the same width, so switching
    // between the two never moves the picture; only the convergence changes.
    const height = orthoHeight(view.distance, fov)
    const aspect = this.size.width / Math.max(1, this.size.height)
    this.orthographic.left = -height * aspect
    this.orthographic.right = height * aspect
    this.orthographic.top = height
    this.orthographic.bottom = -height
    this.orthographic.near = -Math.max(view.clipEnd, view.distance * 4)
    this.orthographic.far = Math.max(view.clipEnd, view.distance * 4)
    this.orthographic.position.copy(this.perspective.position)
    this.orthographic.up.copy(this.perspective.up)
    this.orthographic.quaternion.copy(this.perspective.quaternion)
    this.orthographic.updateProjectionMatrix()

    const axis = isAxisView(view.yaw, view.pitch)
    this.grid?.update({
      showFloor: view.overlays.grid && view.overlays.floor,
      showAxisX: view.overlays.axisX,
      showAxisY: view.overlays.axisY,
      showAxisZ: view.overlays.axisZ,
      // Blender turns the floor grid into a wall in a side view, which is the only way a front
      // view has any grid at all.
      plane: view.projection === 'orthographic' && (axis === 'front' || axis === 'back')
        ? 'xz'
        : view.projection === 'orthographic' && (axis === 'left' || axis === 'right')
          ? 'yz'
          : 'xy',
    })
    this.grid?.setCamera(position, view.distance)
    this.syncCursor()
    for (const objectView of this.views.values()) {
      const object = this.document?.objects.find((entry) => entry.id === objectView.id)
      if (object) objectView.root.visible = this.isVisible(object)
      if (objectView.wire) objectView.wire.object.visible = view.shading === 'wireframe' || view.overlays.wireframe
    }
  }

  get camera(): Camera {
    return this.view?.projection === 'orthographic' ? this.orthographic : this.perspective
  }

  /* -------------------------------------------------------------- painting */

  invalidate(): void {
    this.counters.invalidate += 1
    if (this.disposed || this.failed || this.frameHandle !== null) return
    this.frameHandle = requestAnimationFrame(() => {
      this.frameHandle = null
      this.render()
    })
  }

  /** Draws now, outside the frame loop. Used by the thumbnail and by the QA scripts. */
  render(): void {
    const renderer = this.renderer
    if (!renderer || this.disposed || this.failed) return
    const started = typeof performance !== 'undefined' ? performance.now() : 0
    renderer.info.reset()
    const camera = this.camera
    this.keepScreenSizedThingsSized(camera)
    this.placeGizmos()
    for (const view of this.views.values()) if (view.glyphPick) this.sizeGlyphPick(view)

    renderer.autoClear = false
    renderer.clear(true, true, false)
    renderer.render(this.scene, camera)

    // The outline is drawn from a mask of the selected objects, then the overlay scene goes on top
    // with the depth buffer left alone, so a glyph behind a wall is still behind it.
    this.outline?.render(renderer, camera)
    this.outline?.draw(renderer)
    renderer.render(this.overlay, camera)

    this.counters.frames += 1
    this.counters.drawCalls = renderer.info.render.calls
    this.counters.triangles = renderer.info.render.triangles
    const duration = (typeof performance !== 'undefined' ? performance.now() : 0) - started
    this.options.onFrame?.({ duration, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls })
  }

  /**
   * A glyph's grab area, in pixels rather than in metres.
   *
   * A light or a camera is drawn as lines, and lines are not in the id buffer, so each carries an
   * invisible solid to be clicked. Sized in world units that solid is a trap: a camera near the
   * viewer would reach half way across the screen and swallow clicks meant for the object behind
   * it. Sized in pixels it is what it looks like — a small target on the glyph's own centre.
   */
  private sizeGlyphPick(view: ObjectView): void {
    const proxy = view.pickMesh
    const world = proxy?.userData.world as Matrix4 | undefined
    if (!proxy || !world) return
    const origin = new Vector3().setFromMatrixPosition(world)
    const radius = Math.max(1e-5, this.unitsPerPixelAt([origin.x, origin.y, origin.z]) * GLYPH_PICK_PX)
    proxy.matrix.makeTranslation(origin.x, origin.y, origin.z).scale(new Vector3(radius, radius, radius))
    proxy.matrixWorldNeedsUpdate = true
  }

  /** The cursor, and anything else that must not grow with the distance to it. */
  private keepScreenSizedThingsSized(camera: Camera): void {
    if (!this.cursor || !this.view) return
    const distance = camera === this.orthographic
      ? orthoHeight(this.view.distance, fovFromFocalLength(this.view.focalLength)) * 2
      : new Vector3(...this.cursor.object.position.toArray()).distanceTo(camera.position)
    const fov = fovFromFocalLength(this.view.focalLength) * (Math.PI / 180)
    const worldPerPixel = (2 * Math.tan(fov / 2) * Math.max(distance, 1e-3)) / Math.max(1, this.size.height)
    this.cursor.setScreenScale(worldPerPixel * 40)
    // The cursor faces the viewer, as Blender's does, so it never turns into a line.
    this.cursor.object.quaternion.copy(camera.quaternion)
    this.cursor.object.updateMatrix()
  }

  /* --------------------------------------------------------------- reading */

  pick(x: number, y: number, radius = 12): PickResult {
    const renderer = this.renderer
    if (!renderer || !this.picking) return null
    return this.picking.pick(renderer, this.camera, x * this.pixelRatio, y * this.pixelRatio, Math.round(radius * this.pixelRatio))
  }

  /** The object under a point, by id, or null. */
  pickObject(x: number, y: number, radius = 12): string | null {
    const found = this.pick(x, y, radius)
    if (!found || found.kind !== 'object') return null
    return this.document?.objects[found.id]?.id ?? null
  }

  /** Every object whose pixels fall inside a rectangle: box, lasso and circle all start here. */
  pickRegion(x: number, y: number, width: number, height: number, inside?: (px: number, py: number) => boolean): string[] {
    const renderer = this.renderer
    if (!renderer || !this.picking || width < 1 || height < 1) return []
    const ratio = this.pixelRatio
    const buffer = this.picking.region(renderer, this.camera, x * ratio, y * ratio, width * ratio, height * ratio)
    const readWidth = Math.max(1, Math.round(width * ratio))
    const readHeight = Math.max(1, Math.round(height * ratio))
    const found = new Set<string>()
    for (let row = 0; row < readHeight; row += 1) {
      for (let column = 0; column < readWidth; column += 1) {
        const offset = (row * readWidth + column) * 4
        const alpha = buffer[offset + 3]
        if (alpha !== 1) continue
        const id = ((buffer[offset]! << 16) | (buffer[offset + 1]! << 8) | buffer[offset + 2]!) - 1
        if (id < 0) continue
        if (inside && !inside(x + column / ratio, y + (readHeight - 1 - row) / ratio)) continue
        const object = this.document?.objects[id]
        if (object) found.add(object.id)
      }
    }
    return [...found]
  }

  /** A world point in viewport pixels, or null when it is behind the camera. */
  project(point: Vec3): [number, number] | null {
    const camera = this.camera
    const vector = new Vector3(point[0], point[1], point[2]).project(camera)
    if (vector.z > 1) return null
    return [((vector.x + 1) / 2) * this.size.width, ((1 - vector.y) / 2) * this.size.height]
  }

  /** A viewport pixel back into the world, on the plane through the target facing the camera. */
  unproject(x: number, y: number, depth = 0.5): Vec3 {
    const camera = this.camera
    const vector = new Vector3((x / this.size.width) * 2 - 1, 1 - (y / this.size.height) * 2, depth * 2 - 1)
    vector.unproject(camera)
    return [vector.x, vector.y, vector.z]
  }

  /**
   * What the ray under a pixel hits. Slower than the id buffer and more precise: the buffer says
   * which object, this says exactly where on it, which is what the 3D cursor and zoom-to-pointer
   * need. `three-mesh-bvh` keeps it a few microseconds even on a heavy mesh.
   */
  raycast(x: number, y: number): { objectId: string; point: Vec3; normal: Vec3; distance: number } | null {
    const camera = this.camera
    this.raycaster.setFromCamera(
      new Vector2((x / this.size.width) * 2 - 1, 1 - (y / this.size.height) * 2),
      camera,
    )
    const targets: Mesh[] = []
    for (const view of this.views.values()) {
      if (!view.mesh || !view.root.visible) continue
      view.root.updateMatrixWorld(true)
      view.mesh.updateMatrixWorld(true)
      targets.push(view.mesh)
    }
    const hits = this.raycaster.intersectObjects(targets, false)
    const hit = hits[0]
    if (!hit) return null
    const owner = [...this.views.entries()].find(([, view]) => view.mesh === hit.object)
    if (!owner) return null
    const normal = hit.face
      ? new Vector3().copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize()
      : new Vector3(0, 0, 1)
    return {
      objectId: owner[0],
      point: [hit.point.x, hit.point.y, hit.point.z],
      normal: [normal.x, normal.y, normal.z],
      distance: hit.distance,
    }
  }

  /**
   * Every object the ray under a pixel passes through, nearest first.
   *
   * Blender's ⌥ click cycles through what is under the pointer, which needs the whole stack and not
   * just the front of it. The id buffer cannot answer this — it only remembers the winner — so this
   * is the one place a real ray is cast through everything.
   */
  raycastStack(x: number, y: number): string[] {
    const camera = this.camera
    this.raycaster.setFromCamera(
      new Vector2((x / this.size.width) * 2 - 1, 1 - (y / this.size.height) * 2),
      camera,
    )
    const targets: Mesh[] = []
    const owners = new Map<Mesh, string>()
    for (const [id, view] of this.views) {
      if (!view.mesh || !view.root.visible) continue
      view.root.updateMatrixWorld(true)
      view.mesh.updateMatrixWorld(true)
      targets.push(view.mesh)
      owners.set(view.mesh, id)
    }
    const found: string[] = []
    for (const hit of this.raycaster.intersectObjects(targets, false)) {
      const owner = owners.get(hit.object as Mesh)
      if (owner && !found.includes(owner)) found.push(owner)
    }
    return found
  }

  /**
   * Where a pixel lands on the plane through the view's target, facing the camera. This is the
   * surface Blender falls back to whenever there is no geometry under the pointer — placing the
   * cursor in empty space, or zooming towards nothing in particular.
   */
  pointOnViewPlane(x: number, y: number): Vec3 {
    const view = this.view
    const { origin, direction } = this.ray(x, y)
    if (!view) return origin
    const normal = new Vector3(...cameraBasis(view.yaw, view.pitch).forward)
    const denominator = normal.x * direction[0] + normal.y * direction[1] + normal.z * direction[2]
    if (Math.abs(denominator) < 1e-9) return origin
    const toTarget = new Vector3(view.target[0] - origin[0], view.target[1] - origin[1], view.target[2] - origin[2])
    const t = (normal.x * toTarget.x + normal.y * toTarget.y + normal.z * toTarget.z) / denominator
    return [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t]
  }

  /** The ray under a pixel, for the raycast the cursor and the snapping use. */
  ray(x: number, y: number): { origin: Vec3; direction: Vec3 } {
    const camera = this.camera
    const near = new Vector3((x / this.size.width) * 2 - 1, 1 - (y / this.size.height) * 2, -1).unproject(camera)
    const far = new Vector3((x / this.size.width) * 2 - 1, 1 - (y / this.size.height) * 2, 1).unproject(camera)
    const direction = far.clone().sub(near).normalize()
    return { origin: [near.x, near.y, near.z], direction: [direction.x, direction.y, direction.z] }
  }

  /** The box around what is drawn, or around the selection when there is one. */
  bounds(objectIds?: string[]): { min: Vec3; max: Vec3 } | null {
    const box = new Box3()
    let found = false
    for (const [id, view] of this.views) {
      if (objectIds && !objectIds.includes(id)) continue
      if (!view.root.visible) continue
      view.root.updateMatrixWorld(true)
      if (view.meshView) {
        const geometry = view.meshView.geometry
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        if (!geometry.boundingBox) continue
        const local = geometry.boundingBox.clone().applyMatrix4(view.root.matrixWorld)
        box.union(local)
        found = true
      } else {
        const position = new Vector3().setFromMatrixPosition(view.root.matrixWorld)
        box.expandByPoint(position)
        found = true
      }
    }
    if (!found) return null
    return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }
  }

  stats(): ViewportStats {
    const document = this.document
    let vertices = 0
    let edges = 0
    let faces = 0
    let triangles = 0
    let meshes = 0
    if (document) {
      for (const object of document.objects) {
        const mesh = meshOf(document, object)
        if (!mesh) continue
        meshes += 1
        vertices += mesh.vertexIds.length
        edges += mesh.edges.length
        faces += mesh.faces.length
        for (const face of mesh.faces) triangles += Math.max(0, face.length - 2)
      }
    }
    const context = this.renderer?.getContext() as WebGL2RenderingContext | undefined
    return {
      objects: document?.objects.length ?? 0,
      meshes,
      vertices,
      edges,
      faces,
      triangles,
      renderedTriangles: this.counters.triangles,
      drawCalls: this.counters.drawCalls,
      frames: this.counters.frames,
      invalidateCount: this.counters.invalidate,
      geometries: this.renderer?.info.memory.geometries ?? 0,
      textures: this.renderer?.info.memory.textures ?? 0,
      samples: context ? (context.getParameter(context.SAMPLES) as number) ?? 0 : 0,
      contextLost: this.counters.contextLost,
    }
  }
}
