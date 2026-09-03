import {
  ACESFilmicToneMapping,
  Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
  type Texture,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { createMaterialLibrary, materialSignature, type MaterialLibrary } from '@/scene/viewport/materials'
import type { Material } from '@/scene/types'

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
