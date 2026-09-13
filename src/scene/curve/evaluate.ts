import { outlineFont, type OutlineFont, type OutlineFontLookup } from '@/scene/curve/font'
import { curveMesh } from '@/scene/curve/geometry'
import { sampleSpline } from '@/scene/curve/spline'
import { textMesh } from '@/scene/curve/text'
import type { MeshData, SceneDocument, SceneObject } from '@/scene/types'

/**
 * The geometry an object starts from, whatever kind it is.
 *
 * A mesh has one stored, and a curve or a text object is *evaluated* into one — that is the whole
 * of what makes them work here. Everything downstream, from the modifier stack to the exporter to
 * the box a click tests against, reads a `MeshData`, and this is the one place that knows a curve
 * is not one.
 *
 * The answer is kept, because it is asked for on every frame that redraws and building a bevelled
 * curve is not free. The key is the data itself, so a knot dragged one micron is a different curve
 * and a camera moved is not.
 */
export function objectMesh(document: SceneDocument, object: SceneObject, fontFor: OutlineFontLookup = outlineFont): MeshData | null {
  const data = object.data
  // The mesh table is read directly rather than through `meshOf`: the document module reads this
  // one for its own counts, and two modules that import each other are a module that may not load.
  if (data.kind === 'mesh') return document.meshes[data.meshId] ?? null
  if (data.kind !== 'curve' && data.kind !== 'text') return null
  const taper = data.kind === 'curve' ? taperSpline(document, data.taperObjectId) : null
  const font = data.kind === 'text' ? fontFor(data.font) : null
  if (font && !fontIds.has(font)) fontIds.set(font, ++fontSequence)
  const key = `${font ? fontIds.get(font) : 0}|${object.id}|${JSON.stringify(data)}|${taper ? taper.points.length : 0}`
  const kept = generated.get(key)
  if (kept) {
    generated.delete(key)
    generated.set(key, kept)
    return kept
  }
  const built = data.kind === 'curve' ? curveMesh(data, taper) : textMesh(data, font)
  generated.set(key, built)
  if (generated.size > CACHE_LIMIT) {
    const oldest = generated.keys().next().value
    if (oldest !== undefined) generated.delete(oldest)
  }
  return built
}

const fontIds = new WeakMap<OutlineFont, number>()
let fontSequence = 0
const generated = new Map<string, MeshData>()

export function clearGeneratedCache(): void {
  generated.clear()
}

/** The first spline of the object a curve names as its taper, read in that object's own space. */
function taperSpline(document: SceneDocument, taperObjectId: string | undefined) {
  if (!taperObjectId) return null
  const other = document.objects.find((candidate) => candidate.id === taperObjectId)
  if (!other || other.data.kind !== 'curve') return null
  const spline = other.data.splines[0]
  if (!spline || spline.points.length < 2) return null
  return sampleSpline(spline, other.data.resolution)
}

/** How many built curves to keep. The same ceiling the modifier stack uses, for the same reason. */
const CACHE_LIMIT = 64
