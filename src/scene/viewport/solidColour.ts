import type { Material, SceneDocument, SceneObject, ViewState } from '@/scene/types'

/**
 * What colour an object is in solid shading.
 *
 * Solid is the mode a person models in, and its colour is a *reading aid* rather than a rendering:
 * material colour to see how the materials are laid out, object colour to tell two copies apart,
 * random to see where one object stops and the next begins in a scene of many, single to take all
 * of it away and look at the form alone. Blender offers exactly these, and they matter more than
 * they sound — a scene of forty grey objects is unreadable.
 *
 * It is pure, and it is here rather than in the viewport, because "which colour" is a question
 * about a document and "how to draw it" is a question about a renderer.
 */

/** Blender's own solid grey, and the fallback whenever a mode has nothing to say. */
export const SOLID_DEFAULT = '#b4b4b4'

export function solidColour(document: SceneDocument, object: SceneObject, view: ViewState): string {
  const mode = view.solid?.colour ?? 'material'
  if (mode === 'single') return view.solid?.single ?? SOLID_DEFAULT
  if (mode === 'object') return object.color ?? SOLID_DEFAULT
  if (mode === 'random') return randomColour(object.id)
  // Texture falls back to the material until a base-colour map is drawn in solid shading; a
  // material's own colour is the nearest true answer, and a flat grey would say less.
  const material = materialOf(document, object)
  return material?.baseColor ?? SOLID_DEFAULT
}

/** The material in an object's first slot: what a single-material object is, which is most of them. */
function materialOf(document: SceneDocument, object: SceneObject): Material | undefined {
  const id = object.materialSlots[0]
  if (!id) return undefined
  return document.materials.find((entry) => entry.id === id)
}

/**
 * A colour from an id: the same object gets the same colour every time the scene is opened, and two
 * objects almost never get the same one. The hue is spread by the golden angle rather than taken
 * straight from the hash, so neighbouring hashes land far apart on the wheel instead of next door.
 */
export function randomColour(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  const hue = ((hash % 1000) / 1000) * 360
  return hslToHex((hue * 0.618033988749895 * 360) % 360, 0.55, 0.62)
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const match = lightness - chroma / 2
  const [red, green, blue] = sector(hue, chroma, second)
  const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value + match)) * 255).toString(16).padStart(2, '0')
  return `#${byte(red)}${byte(green)}${byte(blue)}`
}

function sector(hue: number, chroma: number, second: number): [number, number, number] {
  if (hue < 60) return [chroma, second, 0]
  if (hue < 120) return [second, chroma, 0]
  if (hue < 180) return [0, chroma, second]
  if (hue < 240) return [0, second, chroma]
  if (hue < 300) return [second, 0, chroma]
  return [chroma, 0, second]
}
