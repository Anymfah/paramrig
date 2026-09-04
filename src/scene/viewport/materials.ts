import { applyGraphMaterial, clearGraphMaterial } from '@/scene/viewport/graphMaterial'
import {
  Color,
  DoubleSide,
  FrontSide,
  MeshPhysicalMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  type Material as ThreeMaterial,
} from 'three'
import { loadResource } from '@/state/resources'
import type { Material, TextureSlot } from '@/scene/types'

/**
 * A document's materials, as things three.js can draw.
 *
 * A material is shared: twenty objects can name the same one, and building twenty copies of it
 * would mean twenty shader compilations for one appearance. So they are made once and kept, keyed
 * on everything that would change the picture — and a material whose numbers have not moved is the
 * very same object between frames, which is also what lets three skip recompiling its programme.
 *
 * The images are loaded from the project's own resource store, which is asynchronous and a texture
 * is not. A material is therefore built at once with whatever is already loaded, and the image is
 * attached when it arrives; the caller is told to redraw. Waiting instead would mean a scene that
 * is blank until every texture is in, and a first frame that arrives late is worse than one that
 * arrives plain.
 */

export type MaterialLibrary = {
  /** The three.js material for a document material, built or remembered. */
  materialFor: (material: Material) => MeshPhysicalMaterial
  /** Forgets every built material, so a change nothing signed for is picked up. */
  refresh: () => void
  /** How many are being kept, for the tests and the debug hatch. */
  size: () => number
  dispose: () => void
}

/** Everything that changes the picture, as one string. */
export function materialSignature(material: Material): string {
  return JSON.stringify([
    material.baseColor,
    material.metallic,
    material.roughness,
    material.specular,
    material.ior,
    material.transmission,
    material.emission,
    material.emissionStrength,
    material.alpha,
    material.normalStrength,
    material.backfaceCulling,
    material.baseColorAttribute === true,
    material.useNodes === true,
    material.useNodes ? material.graph : null,
    material.blendMode,
    material.textures ?? null,
  ])
}

export function createMaterialLibrary(options: { onTextureLoaded?: () => void } = {}): MaterialLibrary {
  const built = new Map<string, { signature: string; material: MeshPhysicalMaterial }>()
  const textures = new Map<string, Texture>()
  let disposed = false

  /**
   * The image behind a slot. It is fetched once per resource and shared by every material that
   * names it — an object map used by three materials should be decoded once, not three times.
   */
  const textureFor = (slot: TextureSlot | undefined, colour: boolean): Texture | null => {
    const id = slot?.resourceId
    if (!id) return null
    const kept = textures.get(id)
    if (kept) return applySlot(kept, slot)
    const texture = new Texture()
    if (colour) texture.colorSpace = SRGBColorSpace
    textures.set(id, texture)
    void loadResource(id)
      .then(async (blob) => {
        if (!blob || disposed) return
        const bitmap = await createImageBitmap(blob)
        if (disposed) {
          bitmap.close()
          return
        }
        texture.image = bitmap
        texture.needsUpdate = true
        options.onTextureLoaded?.()
      })
      .catch(() => {
        /* A resource that cannot be read leaves the material plain rather than the scene broken. */
      })
    return applySlot(texture, slot)
  }

  const write = (material: MeshPhysicalMaterial, source: Material): void => {
    material.color = new Color(source.baseColor)
    material.metalness = clamp(source.metallic, 0, 1)
    material.roughness = clamp(source.roughness, 0, 1)
    material.specularIntensity = clamp(source.specular, 0, 1)
    material.ior = clamp(source.ior, 1, 2.333)
    material.transmission = clamp(source.transmission, 0, 1)
    material.emissive = new Color(source.emission)
    material.emissiveIntensity = Math.max(0, source.emissionStrength)
    material.opacity = clamp(source.alpha, 0, 1)
    material.transparent = source.blendMode === 'blend' || source.alpha < 1 || source.transmission > 0
    material.alphaTest = source.blendMode === 'clip' ? 0.5 : 0
    material.side = source.backfaceCulling ? FrontSide : DoubleSide
    // The colour attribute multiplies the base colour, which is what three's `vertexColors` does;
    // a mesh that carries none hands the shader white, and white multiplies to nothing.
    material.vertexColors = source.baseColorAttribute === true
    /*
     * A material with nodes on is drawn by the graph rather than by the fields above. The fields are
     * still written first: they are what the surface falls back to while the engine is fetched, and
     * what it goes back to the moment the switch is turned off.
     */
    if (source.useNodes && source.graph) applyGraphMaterial(material, source.graph)
    else clearGraphMaterial(material)
    material.map = textureFor(source.textures?.baseColor, true)
    material.roughnessMap = textureFor(source.textures?.roughness, false)
    material.metalnessMap = textureFor(source.textures?.metallic, false)
    material.emissiveMap = textureFor(source.textures?.emission, true)
    material.normalMap = textureFor(source.textures?.normal, false)
    if (material.normalMap) material.normalScale.set(source.normalStrength, source.normalStrength)
    material.needsUpdate = true
  }

  return {
    materialFor: (source) => {
      const signature = materialSignature(source)
      const kept = built.get(source.id)
      if (kept && kept.signature === signature) return kept.material
      if (kept) {
        // The same material, changed: written into rather than replaced, so that every mesh already
        // pointing at it follows without being told.
        write(kept.material, source)
        built.set(source.id, { signature, material: kept.material })
        return kept.material
      }
      const material = new MeshPhysicalMaterial({ name: source.name })
      write(material, source)
      built.set(source.id, { signature, material })
      return material
    },
    size: () => built.size,
    /*
     * Every built material forgotten, so the next read builds it again.
     *
     * The shader engine arrives after the materials do: a material that was written before it
     * landed carries no graph, and its signature has not changed, so nothing would ever ask for it
     * again. This is how the viewport says "build them all once more".
     */
    refresh: () => {
      for (const entry of built.values()) entry.material.dispose()
      built.clear()
    },
    dispose: () => {
      disposed = true
      for (const entry of built.values()) entry.material.dispose()
      built.clear()
      for (const texture of textures.values()) {
        const image = texture.image as ImageBitmap | undefined
        if (image && typeof image.close === 'function') image.close()
        texture.image = null
        texture.dispose()
      }
      textures.clear()
    },
  }
}

/** A texture's own scale and offset, which are the slot's rather than the image's. */
function applySlot(texture: Texture, slot: TextureSlot): Texture {
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  if (slot.scale) texture.repeat.set(slot.scale[0], slot.scale[1])
  if (slot.offset) texture.offset.set(slot.offset[0], slot.offset[1])
  return texture
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  return Math.min(high, Math.max(low, value))
}

/** Frees a material or a list of them, which three does not do for you. */
export function disposeThreeMaterial(material: ThreeMaterial | ThreeMaterial[] | null | undefined): void {
  if (!material) return
  for (const entry of Array.isArray(material) ? material : [material]) entry.dispose()
}
