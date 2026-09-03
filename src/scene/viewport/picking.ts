import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  NearestFilter,
  NoBlending,
  Scene,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three'

/**
 * Picking by drawing.
 *
 * Working out what is under the pointer with a ray means walking every object's triangles; doing
 * it with a buffer means asking the graphics card, which has already worked out what is in front
 * of what, and reading back a few pixels. It costs one small render and one `readPixels`, and it
 * gives occlusion for free — a handle behind a wall is not picked, which is exactly the rule
 * Blender's gizmos follow.
 *
 * Ids are written as a colour. Twenty-four bits is over sixteen million distinct elements, which
 * no document will reach; the alpha byte carries the *kind*, so one buffer answers "which object",
 * "which face" and "which gizmo handle" at once.
 */

export type PickKind = 'object' | 'face' | 'edge' | 'vertex' | 'gizmo'

const KIND_BYTE: Record<PickKind, number> = { object: 1, face: 2, edge: 3, vertex: 4, gizmo: 5 }
const BYTE_KIND: Record<number, PickKind> = { 1: 'object', 2: 'face', 3: 'edge', 4: 'vertex', 5: 'gizmo' }

export type PickResult = { kind: PickKind; id: number } | null

export function decodePick(r: number, g: number, b: number, a: number): PickResult {
  const id = (r << 16) | (g << 8) | b
  if (id === 0) return null
  const kind = BYTE_KIND[a]
  if (!kind) return null
  return { kind, id: id - 1 }
}

export function pickAlpha(kind: PickKind): number {
  return KIND_BYTE[kind] / 255
}

export type PickBuffer = {
  scene: Scene
  target: WebGLRenderTarget
  setSize: (width: number, height: number) => void
  /** Renders the id buffer and reads a square around a point. Returns the nearest match found. */
  pick: (renderer: WebGLRenderer, camera: Camera, x: number, y: number, radius?: number) => PickResult
  /** Reads a whole rectangle, for a box, a lasso or a circle selection. */
  region: (renderer: WebGLRenderer, camera: Camera, x: number, y: number, width: number, height: number) => Uint8Array
  dispose: () => void
}

export function createPickBuffer(): PickBuffer {
  const scene = new Scene()
  scene.name = 'picking'
  const target = new WebGLRenderTarget(1, 1, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  })
  let size = { width: 1, height: 1 }
  const pixels = new Uint8Array(4 * 64 * 64)

  const render = (renderer: WebGLRenderer, camera: Camera) => {
    const previousTarget = renderer.getRenderTarget()
    const previousClear = renderer.getClearColor(new Color()).getHex()
    const previousAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, false)
    renderer.render(scene, camera)
    renderer.setRenderTarget(previousTarget)
    renderer.setClearColor(previousClear, previousAlpha)
  }

  return {
    scene,
    target,
    setSize: (width, height) => {
      size = { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) }
      target.setSize(size.width, size.height)
    },
    pick: (renderer, camera, x, y, radius = 12) => {
      render(renderer, camera)
      const half = Math.max(1, Math.min(31, Math.floor(radius)))
      // The render target's rows run bottom-up; the pointer's coordinates run top-down.
      const pointerX = Math.round(x)
      const pointerY = size.height - Math.round(y)
      const left = Math.max(0, Math.min(size.width - 1, pointerX - half))
      const bottom = Math.max(0, Math.min(size.height - 1, pointerY - half))
      const width = Math.min(half * 2 + 1, size.width - left)
      const height = Math.min(half * 2 + 1, size.height - bottom)
      if (width <= 0 || height <= 0) return null
      const view = pixels.subarray(0, width * height * 4)
      renderer.readRenderTargetPixels(target, left, bottom, width, height, view)
      // Nearest to the pointer wins, so a thin element beside a large one is still reachable.
      let best: PickResult = null
      let bestDistance = Infinity
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          const offset = (row * width + column) * 4
          const found = decodePick(view[offset]!, view[offset + 1]!, view[offset + 2]!, view[offset + 3]!)
          if (!found) continue
          const dx = left + column - pointerX
          const dy = bottom + row - pointerY
          const distance = dx * dx + dy * dy
          if (distance >= bestDistance) continue
          bestDistance = distance
          best = found
        }
      }
      return best
    },
    region: (renderer, camera, x, y, width, height) => {
      render(renderer, camera)
      const left = Math.max(0, Math.min(size.width - 1, Math.round(x)))
      const bottom = Math.max(0, Math.min(size.height - 1, size.height - Math.round(y) - Math.round(height)))
      const readWidth = Math.max(1, Math.min(Math.round(width), size.width - left))
      const readHeight = Math.max(1, Math.min(Math.round(height), size.height - bottom))
      const buffer = new Uint8Array(readWidth * readHeight * 4)
      renderer.readRenderTargetPixels(target, left, bottom, readWidth, readHeight, buffer)
      return buffer
    },
    dispose: () => {
      target.dispose()
      scene.clear()
    },
  }
}

/**
 * The material an object is drawn with in the id buffer: one flat colour, no lighting, both sides,
 * and the alpha byte saying what kind of thing this is.
 */
export function createPickMaterial(kind: PickKind, id: number): MeshBasicMaterial {
  const value = id + 1
  // The colour must reach the buffer as the exact bytes it was written as, so no tone mapping,
  // no blending and no colour conversion may touch it. The alpha channel carries the kind, and a
  // material writes its opacity to alpha whether or not it is marked transparent — which it must
  // not be, or the object would leave the depth-sorted pass and stop occluding what is behind it.
  const material = new MeshBasicMaterial({
    color: new Color().setRGB(((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255),
    side: DoubleSide,
    transparent: false,
    opacity: KIND_BYTE[kind] / 255,
    toneMapped: false,
    fog: false,
    blending: NoBlending,
  })
  return material
}

export function setPickId(material: MeshBasicMaterial, kind: PickKind, id: number): void {
  const value = id + 1
  material.color.setRGB(((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255)
  material.opacity = KIND_BYTE[kind] / 255
}
