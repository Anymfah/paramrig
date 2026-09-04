import {
  ACESFilmicToneMapping,
  Box3,
  Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildScene } from '@/scene/io/gltf'
import { createMaterialLibrary, materialSignature, type MaterialLibrary } from '@/scene/viewport/materials'
import type { Material, SceneDocument } from '@/scene/types'

/**
 * The little sphere beside a material's name.
 *
 * A swatch of the base colour would be a lie: half of what a material is — how rough it is, how
 * metal, how much light passes through it — is invisible in a flat square, and two materials that
 * differ only in roughness would draw identically. So the swatch is a real render: the same
 * `MeshPhysicalMaterial` the viewport uses, on a sphere, under three's own room.
 *
 * One renderer serves the whole application. A 64-pixel canvas costs little to draw and a great
 * deal to allocate — a WebGL context, a shader cache, a pre-filtered environment — and a panel
 * listing twelve materials would otherwise ask for twelve of them. The result is a data URL, cached
 * on everything that changes the picture, so a panel that re-renders draws from the cache and a
 * slider that is being dragged renders once per changed value rather than once per frame.
 *
 * Where there is no WebGL — a unit test under jsdom, a browser that refuses a second context — the
 * answer is null and the caller draws a flat swatch instead. A missing preview is a smaller problem
 * than a panel that will not render.
 */

const SIZE = 64
/** Enough for the Material tab, the asset rail and a scene of a dozen materials, several times over. */
const CACHE_LIMIT = 96

type Rig = {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  mesh: Mesh
  library: MaterialLibrary
  environment: Texture
}

let rig: Rig | null = null
let refused = false
const cache = new Map<string, string>()

function build(): Rig | null {
  if (rig) return rig
  if (refused) return null
  try {
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setSize(SIZE, SIZE, false)
    renderer.setPixelRatio(1)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    const maker = new PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const environment = maker.fromScene(room, 0.04).texture
    room.dispose?.()
    maker.dispose()
    const scene = new Scene()
    scene.environment = environment
    const camera = new PerspectiveCamera(35, 1, 0.1, 10)
    camera.position.set(0, 0, 3.2)
    const mesh = new Mesh(new SphereGeometry(1, 48, 32))
    scene.add(mesh)
    const library = createMaterialLibrary()
    rig = { renderer, scene, camera, mesh, library, environment }
    return rig
  } catch {
    // No WebGL here. Asked once, then remembered: a panel that re-renders must not retry per row.
    refused = true
    return null
  }
}

/**
 * A PNG data URL of the material, or null where nothing can be rendered.
 *
 * Textures are deliberately not waited for: the swatch shows the material's numbers, which is what
 * distinguishes it from its neighbours in a list, and an image that arrives later would need the
 * whole panel told about it for very little.
 */
export function materialPreview(material: Material): string | null {
  const key = materialSignature(material)
  const kept = cache.get(key)
  if (kept !== undefined) {
    cache.delete(key)
    cache.set(key, kept)
    return kept
  }
  const built = build()
  if (!built) return null
  try {
    built.mesh.material = built.library.materialFor(material)
    built.renderer.render(built.scene, built.camera)
    const url = built.renderer.domElement.toDataURL('image/png')
    cache.set(key, url)
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return url
  } catch {
    return null
  }
}

/**
 * A whole scene as a small picture, for a library card.
 *
 * The same renderer as the swatches, for the same reason: a card list would otherwise ask for a
 * WebGL context per card and a browser gives out about sixteen in all. The scene is built the way
 * an export builds it — no grid, no glyphs, no outlines — lit by the same studio, and framed by its
 * own bounds so that a scene of one cube and a scene of a hundred both fill the card.
 *
 * The answer is null wherever nothing can be rendered, and the caller draws the isometric boxes
 * instead: a card without a picture would be worse than a card with a diagram.
 */
export function renderDocumentThumbnail(document: SceneDocument, size = 256): string | null {
  const built = build()
  if (!built) return null
  const scene = buildScene(document, { applyModifiers: true })
  scene.environment = built.environment
  const camera = new PerspectiveCamera(35, 1, 0.01, 1000)
  frameScene(scene, camera)
  try {
    built.renderer.setSize(size, size, false)
    built.renderer.render(scene, camera)
    const url = built.renderer.domElement.toDataURL('image/png')
    // Back to the swatch size, so the next material preview is not drawn at a card's resolution.
    built.renderer.setSize(SIZE, SIZE, false)
    return url
  } catch {
    return null
  } finally {
    scene.traverse((node) => {
      const mesh = node as Mesh
      mesh.geometry?.dispose?.()
    })
  }
}

/** Blender's own three-quarter view, pulled back until the whole scene is inside the frame. */
function frameScene(scene: Scene, camera: PerspectiveCamera): void {
  const box = new Box3().setFromObject(scene)
  if (box.isEmpty()) {
    camera.position.set(4, -4, 3)
    camera.up.set(0, 0, 1)
    camera.lookAt(0, 0, 0)
    return
  }
  const centre = box.getCenter(new Vector3())
  const radius = Math.max(0.001, box.getSize(new Vector3()).length() / 2)
  const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.15
  const direction = new Vector3(0.6, -0.75, 0.5).normalize()
  camera.up.set(0, 0, 1)
  camera.position.copy(centre).addScaledVector(direction, distance)
  camera.lookAt(centre)
  camera.near = Math.max(0.01, distance - radius * 4)
  camera.far = distance + radius * 8
  camera.updateProjectionMatrix()
}

/** Only for tests and for the editor closing: gives the context and the cache back. */
export function disposeMaterialPreviews(): void {
  cache.clear()
  if (!rig) return
  rig.library.dispose()
  rig.mesh.geometry.dispose()
  rig.environment.dispose()
  rig.renderer.dispose()
  rig.renderer.forceContextLoss()
  rig = null
  refused = false
}
