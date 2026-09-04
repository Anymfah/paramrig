import {
  ACESFilmicToneMapping,
  Color,
  PCFSoftShadowMap,
  PerspectiveCamera,
  OrthographicCamera,
  SRGBColorSpace,
  WebGLRenderer,
  type Camera,
} from 'three'
import { buildScene } from '@/scene/io/gltf'
import { localMatrix, worldMatrix } from '@/scene/objects'
import { fovFromFocalLength } from '@/scene/viewport/view'
import type { CameraData, SceneDocument, SceneObject } from '@/scene/types'

/**
 * F12: the image the scene makes.
 *
 * It is rendered off screen rather than by enlarging the viewport, for three reasons. The viewport
 * is the size of a window and the render is the size of the output — often ten times larger. The
 * viewport is full of things a picture must not contain: the grid, the outlines, the glyphs, the
 * gizmos. And a render must not disturb what is on screen while it runs.
 *
 * Large images are drawn in tiles. A graphics card refuses a canvas past its own limit — commonly
 * 16 384 pixels, sometimes far less — and the memory a 8K frame wants at once is more than a laptop
 * will give. `renderTiles` is the plan, and it is pure, so the arithmetic that decides where each
 * piece goes is tested without a graphics card.
 */

export type RenderTile = {
  /** Where the tile belongs in the finished image. */
  x: number
  y: number
  width: number
  height: number
}

/**
 * The image cut into pieces no larger than `tile`, in reading order.
 *
 * The last column and the last row are short rather than overhanging: a tile that ran past the edge
 * would render pixels nobody asked for and, worse, would shift the camera's view offset by a
 * fraction of a tile and leave a seam.
 */
export function renderTiles(width: number, height: number, tile: number): RenderTile[] {
  const step = Math.max(16, Math.floor(tile))
  const tiles: RenderTile[] = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      tiles.push({ x, y, width: Math.min(step, width - x), height: Math.min(step, height - y) })
    }
  }
  return tiles
}

/** The pixels an output description asks for, percentage and all, bounded to what a card will draw. */
export function outputSize(document: SceneDocument, limit = 16384): { width: number; height: number } {
  const output = document.output ?? { width: 1920, height: 1080, percentage: 100, transparent: false }
  const scale = Math.max(1, Math.min(400, output.percentage)) / 100
  return {
    width: Math.max(1, Math.min(limit, Math.round(output.width * scale))),
    height: Math.max(1, Math.min(limit, Math.round(output.height * scale))),
  }
}

export type RenderOptions = {
  /** How far along, nought to one, called once a tile. */
  onProgress?: (done: number) => void
  /** Set to stop between tiles; the promise then rejects with the reason. */
  signal?: AbortSignal
  /** Tile edge in pixels. Smaller is slower and gentler on memory. */
  tile?: number
}

/**
 * The finished image, as a PNG.
 *
 * The scene is built the same way an export builds it — one place that turns a document into three
 * objects — and then given what a render needs and a file does not: the world's environment, tone
 * mapping with the scene's exposure, and shadows.
 */
export async function renderImage(document: SceneDocument, options: RenderOptions = {}): Promise<Blob> {
  const camera = activeCamera(document)
  if (!camera) throw new Error('This scene has no active camera to render from.')
  const size = outputSize(document)
  const transparent = document.output?.transparent === true

  const canvas = globalThis.document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser will not give a canvas to draw the render on.')

  const tiles = renderTiles(size.width, size.height, options.tile ?? 1024)
  const first = tiles[0] ?? { x: 0, y: 0, width: size.width, height: size.height }
  const renderer = new WebGLRenderer({ antialias: true, alpha: transparent, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(first.width, first.height, false)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = Math.pow(2, document.colorManagement?.exposure ?? 0)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  if (!transparent) renderer.setClearColor(new Color(document.world.color), 1)

  const scene = buildScene(document, { applyModifiers: true })
  const view = renderCamera(document, camera, size)
  try {
    for (let index = 0; index < tiles.length; index += 1) {
      if (options.signal?.aborted) throw new Error('The render was stopped.')
      const tile = tiles[index]!
      renderer.setSize(tile.width, tile.height, false)
      // The camera is told it is drawing one window of a larger image, which is what keeps the
      // pieces of a tiled render in perspective with each other rather than each one its own shot.
      if ('setViewOffset' in view) {
        (view as PerspectiveCamera).setViewOffset(size.width, size.height, tile.x, tile.y, tile.width, tile.height)
        ;(view as PerspectiveCamera).updateProjectionMatrix()
      }
      renderer.render(scene, view)
      context.drawImage(renderer.domElement, tile.x, tile.y)
      options.onProgress?.((index + 1) / tiles.length)
      // A frame to the page between tiles, so a large render leaves the interface answering.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The render could not be turned into an image.')
  return blob
}

function activeCamera(document: SceneDocument): SceneObject | null {
  return document.objects.find((object) => object.data.kind === 'camera' && object.data.active) ?? null
}

/** The three camera to render through, placed where the object is and shaped by the output. */
function renderCamera(document: SceneDocument, object: SceneObject, size: { width: number; height: number }): Camera {
  const data = object.data as CameraData
  const aspect = size.width / Math.max(1, size.height)
  const camera = data.projection === 'orthographic'
    ? new OrthographicCamera(-data.orthoScale / 2, data.orthoScale / 2, data.orthoScale / (2 * aspect), -data.orthoScale / (2 * aspect), data.clipStart, data.clipEnd)
    : new PerspectiveCamera(verticalFov(data, aspect), aspect, data.clipStart, data.clipEnd)
  camera.matrixAutoUpdate = false
  camera.matrix.copy(worldMatrix(document, object) ?? localMatrix(object))
  camera.matrixWorldNeedsUpdate = true
  camera.updateMatrixWorld(true)
  return camera
}

/** A focal length is a horizontal angle on a sensor; three wants the vertical one. */
function verticalFov(data: CameraData, aspect: number): number {
  const horizontal = fovFromFocalLength(data.focalLength, data.sensor)
  return (2 * Math.atan(Math.tan((horizontal * Math.PI) / 360) / aspect) * 180) / Math.PI
}
