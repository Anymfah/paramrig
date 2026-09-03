import {
  DataTexture,
  EquirectangularReflectionMapping,
  PMREMGenerator,
  SRGBColorSpace,
  Texture,
  type WebGLRenderer,
} from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { loadResource } from '@/state/resources'
import type { World } from '@/scene/types'

/**
 * What a surface reflects, and what is behind it.
 *
 * Three kinds of thing end up in the same place. Material preview lights everything with three's own
 * room, so that a material can be judged before a lamp exists. A world with an environment image
 * lights the scene with that photograph instead. And a world with neither lights it with its flat
 * colour, which three does for free once the background is set.
 *
 * All of them are pre-filtered by `PMREMGenerator` — a mip chain where each level is the image
 * blurred by one more step of roughness, which is what makes a rough surface reflect a smear rather
 * than a mirror image. It costs a few hundred kilobytes and about a second, so it is done once per
 * image and kept; a change of strength or rotation reuses it.
 *
 * The images are project resources rather than paths, and loading one is asynchronous while a frame
 * is not. So a caller gets whatever is ready — the studio, or nothing — and is told to redraw when
 * the image arrives. A world that has just been given an HDRI is therefore lit by its colour for
 * one frame rather than not drawn at all.
 */

export type SceneEnvironment = {
  /** The pre-filtered environment for a document's world, or the studio when it has none. */
  forWorld: (world: World, wantsStudio: boolean) => Texture | null
  /** The unfiltered image, for drawing behind the scene. Null unless the world shows one. */
  backgroundFor: (world: World) => Texture | null
  dispose: () => void
}

/** A Radiance file starts with this signature; the rest are decoded by the browser. */
const RADIANCE = '#?RADIANCE'

export function createSceneEnvironment(renderer: WebGLRenderer, options: { onLoaded?: () => void } = {}): SceneEnvironment {
  const maker = new PMREMGenerator(renderer)
  let studio: Texture | null = null
  let disposed = false
  /** By resource id: the image as loaded, and the pre-filtered environment made from it. */
  const built = new Map<string, { source: Texture | null; environment: Texture | null }>()

  const studioEnvironment = (): Texture | null => {
    if (disposed) return null
    if (studio) return studio
    const room = new RoomEnvironment()
    studio = maker.fromScene(room, 0.04).texture
    room.dispose?.()
    return studio
  }

  /**
   * The image behind a resource id, fetched once. A Radiance file goes through three's own decoder
   * because a browser cannot read one; everything else is decoded by the browser, which is faster
   * and handles the colour space itself.
   */
  const load = (id: string): void => {
    if (built.has(id)) return
    built.set(id, { source: null, environment: null })
    void loadResource(id)
      .then(async (blob) => {
        if (!blob || disposed) return
        const bytes = new Uint8Array(await blob.slice(0, RADIANCE.length).arrayBuffer())
        const header = String.fromCharCode(...bytes)
        const texture = header.startsWith(RADIANCE)
          ? radiance(new Uint8Array(await blob.arrayBuffer()))
          : await bitmap(blob)
        if (disposed) {
          texture.dispose()
          return
        }
        texture.mapping = EquirectangularReflectionMapping
        const entry = built.get(id)
        if (!entry) return
        entry.source = texture
        entry.environment = maker.fromEquirectangular(texture).texture
        options.onLoaded?.()
      })
      .catch(() => {
        /* An unreadable image leaves the world lit by its colour rather than the scene unlit. */
      })
  }

  const entryFor = (world: World): { source: Texture | null; environment: Texture | null } | null => {
    const id = world.environmentId
    if (typeof id !== 'string' || id === '') return null
    load(id)
    return built.get(id) ?? null
  }

  return {
    forWorld: (world, wantsStudio) => {
      const entry = entryFor(world)
      if (entry?.environment && world.useForLighting !== false) return entry.environment
      return wantsStudio ? studioEnvironment() : null
    },
    backgroundFor: (world) => {
      if (world.visibleAsBackground === false) return null
      return entryFor(world)?.source ?? null
    },
    dispose: () => {
      disposed = true
      studio?.dispose()
      studio = null
      for (const entry of built.values()) {
        entry.source?.dispose()
        entry.environment?.dispose()
      }
      built.clear()
      maker.dispose()
    },
  }
}

/** A Radiance image, decoded in this thread: they are small, and three's decoder is synchronous. */
function radiance(bytes: Uint8Array): DataTexture {
  const loader = new RGBELoader()
  const parsed = loader.parse(bytes.buffer as ArrayBuffer) as {
    data: Uint8Array | Float32Array
    width: number
    height: number
    type: DataTexture['type']
    header?: string
  }
  const texture = new DataTexture(parsed.data, parsed.width, parsed.height, undefined, parsed.type)
  texture.needsUpdate = true
  return texture
}

/** Anything else: the browser decodes it, and an ordinary image is in sRGB. */
async function bitmap(blob: Blob): Promise<Texture> {
  const image = await createImageBitmap(blob)
  const texture = new Texture(image as unknown as HTMLImageElement)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
