import {
  ACESFilmicToneMapping, NoToneMapping, PCFSoftShadowMap, Color, FogExp2, Group,
  Scene, PerspectiveCamera, OrthographicCamera, Mesh, LineSegments, LineBasicMaterial,
  BufferGeometry, BufferAttribute, type Material as ThreeMaterial, type Texture, type WebGLRenderer,
} from 'three'
import type { ParamValue } from '@paramrig/core/types'
import { interpolateNumber } from '@paramrig/core/values'
import { DEFAULT_MATERIAL, collectionHidden } from './model'
import { initializeBuiltinModifiers } from './modifiers'
import { evaluateObject } from './modifiers/stack'
import { localMatrix, worldMatrix } from './objects'
import { resolveSceneValues } from './rig'
import type { SceneDocument, SceneObject, ViewState } from './types'
import type { SceneResources } from './resources'
import { createOutlineFontRegistry } from './curve/font'
import { loadOutlineFont } from '@/typography/outline'
import { createMaterialLibrary } from './viewport/materials'
import { onGraphEngine, ensureGraphEngine } from './viewport/graphMaterial'
import { createSceneLights } from './viewport/sceneLights'
import { createSceneEnvironment } from './viewport/environment'
import { buildMeshView, edgePositions, meshViewIsCurrent, createMesh, type MeshView } from './viewport/meshView'
import { createSolidLook, createStudioLights, DEFAULT_SOLID_LOOK, matcapTexture, solidLookKey } from './viewport/shading'
import { solidColour } from './viewport/solidColour'
import { cameraBasis, cameraPosition, fovFromFocalLength, orthoHeight } from './viewport/view'

export type SceneInstanceOptions = {
  document: SceneDocument
  values?: Record<string, ParamValue>
  resources?: SceneResources
  /** Used for environment prefiltering only. The host owns rendering and its animation loop. */
  renderer?: WebGLRenderer
  width?: number
  height?: number
  shadows?: boolean
  maxShadows?: number
  onInvalidate?: () => void
  onError?: (error: Error) => void
}

type ObjectView = { root: Group; geometry?: MeshView; mesh?: Mesh; solid?: ReturnType<typeof createSolidLook>; solidKey?: string; wire?: LineSegments<BufferGeometry, LineBasicMaterial> }

/** A scene's visible content, sharing the editor's geometry, materials, shaders and lighting. */
export function createSceneInstance(options: SceneInstanceOptions) {
  initializeBuiltinModifiers()
  const scene = new Scene()
  const content = new Group()
  const studio = createStudioLights()
  const lights = createSceneLights()
  scene.add(content, studio.group, lights.group)
  const cameras = new Map<string, PerspectiveCamera | OrthographicCamera>()
  const perspective = new PerspectiveCamera()
  const orthographic = new OrthographicCamera()
  const objects = new Map<string, ObjectView>()
  const matcaps = new Map<string, Texture>()
  const fonts = createOutlineFontRegistry()
  const clock = { value: 0 }
  let disposed = false
  let source = options.document
  let values = options.values ?? {}
  let viewOverride: ViewState | undefined
  let document = resolveSceneValues(source, values)
  let width = Math.max(1, options.width ?? 640)
  let height = Math.max(1, options.height ?? 480)
  let ready: Promise<void> = Promise.resolve()
  const errors: Error[] = []
  const report = (error: unknown) => {
    if (disposed) return
    const value = error instanceof Error ? error : new Error(String(error))
    errors.push(value); options.onError?.(value)
  }
  const invalidate = () => { if (!disposed) options.onInvalidate?.() }
  const materials = createMaterialLibrary({ resolveResource: options.resources?.resource, clock, onTextureLoaded: invalidate, onError: report })
  const environment = options.renderer ? createSceneEnvironment(options.renderer, {
    resolveResource: options.resources?.resource, onError: report, onLoaded: () => { if (!disposed) { syncLighting(); invalidate() } },
  }) : null
  const live = () => { if (disposed) throw new Error('This scene instance has been destroyed.') }
  const releaseView = (view: ObjectView) => {
    view.geometry?.dispose(); view.solid?.dispose()
    if (view.wire) { view.wire.geometry.dispose(); view.wire.material.dispose() }
    view.root.removeFromParent()
  }
  const surface = (object: SceneObject, view: ObjectView): ThreeMaterial | ThreeMaterial[] => {
    const settings = document.view
    if (settings.shading === 'material' || settings.shading === 'rendered') {
      const slots = object.materialSlots.length ? object.materialSlots : [document.materials[0]?.id ?? '']
      const built = slots.map(id => materials.materialFor(document.materials.find(material => material.id === id) ?? document.materials[0] ?? DEFAULT_MATERIAL))
      return built.length === 1 ? built[0]! : built
    }
    const solid = settings.solid
    const look = { ...DEFAULT_SOLID_LOOK, ...(solid ? {
      lighting: solid.lighting, matcap: solid.matcap, backfaceCulling: solid.backfaceCulling,
      cavity: solid.cavity, cavityStrength: solid.cavityStrength, specular: solid.specular,
    } : {}), xray: settings.xray, xrayAlpha: settings.xrayAlpha ?? DEFAULT_SOLID_LOOK.xrayAlpha, colourAttribute: solid?.colour === 'attribute' }
    const key = solidLookKey(look)
    if (!view.solid || key !== view.solidKey) {
      view.solid?.dispose(); view.solid = createSolidLook(look, name => matcapTexture(name, matcaps)); view.solidKey = key
    }
    view.solid.color.set(solidColour(document, object, settings))
    return view.solid
  }
  function syncLighting() {
    const shading = document.view.shading
    studio.setEnabled(shading === 'solid' || shading === 'material')
    lights.group.visible = shading === 'rendered'
    if (lights.group.visible) lights.sync(document, { shadows: options.shadows !== false, maxShadows: options.maxShadows ?? 4 })
    const world = document.world
    scene.environment = shading === 'rendered' ? environment?.forWorld(world, false) ?? null
      : shading === 'material' ? environment?.forWorld({ ...world, environmentId: null }, true) ?? null : null
    scene.environmentIntensity = Math.max(0, world.environmentStrength ?? 1)
    scene.environmentRotation.set(0, world.environmentRotation ?? 0, 0)
    scene.background = shading === 'rendered' ? environment?.backgroundFor(world) ?? new Color(world.color)
      : new Color(document.view.solid?.background === 'world' ? world.color : '#25272b')
    scene.backgroundIntensity = Math.max(0, world.strength)
    scene.backgroundRotation.set(0, world.environmentRotation ?? 0, 0)
    scene.fog = shading === 'rendered' && world.fog?.enabled ? new FogExp2(world.fog.color, Math.max(0, world.fog.density)) : null
  }
  function syncCameras() {
    const aspect = width / height
    const view = document.view
    const position = cameraPosition(view)
    const basis = cameraBasis(view.yaw, view.pitch)
    perspective.fov = fovFromFocalLength(view.focalLength)
    perspective.aspect = aspect; perspective.near = view.clipStart; perspective.far = view.clipEnd
    perspective.position.set(...position); perspective.up.set(...basis.up); perspective.lookAt(...view.target); perspective.updateProjectionMatrix()
    const extent = orthoHeight(view.distance, perspective.fov)
    orthographic.left = -extent * aspect; orthographic.right = extent * aspect; orthographic.top = extent; orthographic.bottom = -extent
    orthographic.near = -Math.max(view.clipEnd, view.distance * 4); orthographic.far = Math.max(view.clipEnd, view.distance * 4)
    orthographic.position.copy(perspective.position); orthographic.quaternion.copy(perspective.quaternion); orthographic.updateProjectionMatrix()
    const alive = new Set<string>()
    for (const object of document.objects) {
      if (object.data.kind !== 'camera') continue
      alive.add(object.id)
      const data = object.data
      let camera = cameras.get(object.id)
      if (!camera || (camera instanceof PerspectiveCamera) !== (data.projection === 'perspective')) {
        camera = data.projection === 'perspective' ? new PerspectiveCamera() : new OrthographicCamera()
        cameras.set(object.id, camera)
      }
      camera.name = object.name; camera.matrixAutoUpdate = false; camera.matrix.copy(worldMatrix(document, object)); camera.matrixWorldNeedsUpdate = true
      camera.near = data.clipStart; camera.far = data.clipEnd
      if (camera instanceof PerspectiveCamera) {
        camera.aspect = aspect
        camera.fov = 2 * Math.atan(Math.tan(fovFromFocalLength(data.focalLength, data.sensor) * Math.PI / 360) / aspect) * 180 / Math.PI
        camera.setViewOffset(width, height, -(data.shiftX ?? 0) * width, (data.shiftY ?? 0) * width, width, height)
      } else {
        const half = data.orthoScale / 2
        camera.left = -half; camera.right = half; camera.top = half / aspect; camera.bottom = -half / aspect
        camera.setViewOffset(width, height, -(data.shiftX ?? 0) * width, (data.shiftY ?? 0) * width, width, height)
      }
      camera.updateMatrixWorld(true); camera.updateProjectionMatrix()
    }
    for (const id of cameras.keys()) if (!alive.has(id)) cameras.delete(id)
  }
  function syncObject(object: SceneObject, key: string, parent: Group, instance = false) {
    let view = objects.get(key)
    if (!view) { view = { root: new Group() }; objects.set(key, view); parent.add(view.root) }
    view.root.name = object.name; view.root.userData.objectId = object.id; view.root.matrixAutoUpdate = false
    view.root.matrix.copy(instance ? localMatrix(object) : worldMatrix(document, object)); view.root.matrixWorldNeedsUpdate = true
    view.root.visible = object.visible && !collectionHidden(document, object.collectionId)
    const evaluated = evaluateObject(document, object, { fontFor: fonts.get })
    for (const error of evaluated?.errors ?? []) report(new Error(`${object.name}: ${error.message}`))
    if (!evaluated) {
      view.geometry?.dispose(); view.mesh?.removeFromParent()
      view.solid?.dispose()
      if (view.wire) { view.wire.removeFromParent(); view.wire.geometry.dispose(); view.wire.material.dispose() }
      view.geometry = undefined; view.mesh = undefined; view.wire = undefined; view.solid = undefined; view.solidKey = undefined
      return
    }
    if (!view.geometry || !meshViewIsCurrent(view.geometry, evaluated.mesh)) {
      view.geometry?.dispose()
      if (view.mesh) view.mesh.removeFromParent()
      if (view.wire) { view.wire.removeFromParent(); view.wire.geometry.dispose(); view.wire.material.dispose() }
      view.geometry = buildMeshView(evaluated.mesh, { picking: false })
      view.mesh = createMesh(view.geometry, surface(object, view)); view.root.add(view.mesh)
      const positions = edgePositions(evaluated.mesh)
      const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(positions, 3))
      view.wire = new LineSegments(geometry, new LineBasicMaterial({ color: '#9ba0a8' })); view.root.add(view.wire)
    }
    view.mesh!.material = surface(object, view); view.mesh!.castShadow = true; view.mesh!.receiveShadow = true
    view.mesh!.visible = document.view.shading !== 'wireframe'
    view.wire!.visible = document.view.shading === 'wireframe'
    view.wire!.material.opacity = Math.min(1, Math.max(0.05, document.view.wireframeOpacity ?? 0.5))
    view.wire!.material.transparent = view.wire!.material.opacity < 1
  }
  function sync() {
    if (disposed) return
    if (viewOverride) document = { ...document, view: viewOverride }
    scene.name = document.name
    const alive = new Set<string>()
    for (const object of document.objects) {
      alive.add(object.id); syncObject(object, object.id, content)
      if (object.data.kind === 'empty' && object.data.instanceCollectionId) {
        for (const member of document.objects) {
          if (member.id === object.id || member.collectionId !== object.data.instanceCollectionId || member.data.kind !== 'mesh') continue
          const key = `${object.id}/${member.id}`; alive.add(key); syncObject(member, key, objects.get(object.id)!.root, true)
        }
      }
    }
    for (const [key, view] of objects) if (!alive.has(key)) { releaseView(view); objects.delete(key) }
    syncCameras(); syncLighting(); scene.updateMatrixWorld(true); invalidate()
  }
  const unsubscribeGraph = onGraphEngine(() => { if (!disposed) { materials.refresh(); sync() } })
  const unsubscribeFonts = fonts.subscribe(sync)
  const prepare = () => {
    const families = [...new Set(document.objects.flatMap(object => object.data.kind === 'text' ? [object.data.font] : []))]
    ready = Promise.all([
      ...families.map(family => fonts.ensure(family, async (name, signal) => {
        const font = await loadOutlineFont(name, [], options.resources?.font, signal)
        if (!font && !signal.aborted) throw new Error(`Outline font is unavailable: ${name}`)
        return font
      })),
      materials.whenIdle(), environment?.whenIdle(),
      document.materials.some(material => material.useNodes && material.graph) ? ensureGraphEngine() : undefined,
    ]).then(() => { if (!disposed) sync() }).catch(error => { report(error); throw error })
    return ready
  }
  sync(); void prepare().catch(() => {})
  return {
    scene, cameras, fonts,
    get ready() { return ready },
    get document() { return document },
    get camera() {
      const active = document.view.camera?.looking
        ? document.objects.find(object => object.data.kind === 'camera' && object.data.active)
        : undefined
      return (active && cameras.get(active.id)) || (document.view.projection === 'orthographic' ? orthographic : perspective)
    },
    get errors() { return [...errors] },
    get renderSettings() { return { toneMapping: document.view.shading === 'rendered' ? ACESFilmicToneMapping : NoToneMapping,
      toneMappingExposure: Math.pow(2, document.colorManagement?.exposure ?? 0),
      shadows: document.view.shading === 'rendered' && options.shadows !== false, shadowMapType: PCFSoftShadowMap } },
    /** Explicit opt-in: callers using their own renderer can apply or ignore these settings. */
    configureRenderer(renderer: WebGLRenderer) {
      live(); const settings = this.renderSettings
      renderer.toneMapping = settings.toneMapping; renderer.toneMappingExposure = settings.toneMappingExposure
      renderer.shadowMap.enabled = settings.shadows; renderer.shadowMap.type = settings.shadowMapType
    },
    update(next: SceneDocument, nextValues = values) { live(); source = next; values = nextValues; document = resolveSceneValues(source, values); errors.length = 0; sync(); return prepare() },
    setValues(next: Record<string, ParamValue>) { live(); values = next; document = resolveSceneValues(source, values); sync() },
    setView(view: ViewState) { live(); viewOverride = structuredClone(view); sync() },
    setTime(seconds: number) {
      live(); clock.value = seconds
      const animation = source.rig?.animation
      const animated = { ...values }
      if (animation) for (const track of animation.tracks) animated[track.paramId] = interpolateNumber(track, seconds, animation.duration, animation.loop)
      document = resolveSceneValues(source, animated); sync()
    },
    resize(nextWidth: number, nextHeight: number) { live(); width = Math.max(1, nextWidth); height = Math.max(1, nextHeight); syncCameras(); invalidate() },
    destroy() {
      if (disposed) return
      disposed = true; unsubscribeGraph(); unsubscribeFonts(); fonts.dispose(); environment?.dispose(); materials.dispose(); studio.dispose(); lights.dispose()
      for (const view of objects.values()) releaseView(view)
      objects.clear(); cameras.clear(); for (const texture of matcaps.values()) texture.dispose(); matcaps.clear(); scene.clear()
    },
  }
}
export type SceneInstance = ReturnType<typeof createSceneInstance>
