/*
 * Loading the stack loads the modifiers themselves.
 *
 * Registration is a side effect of importing a module, and the stack is what every drawing path
 * goes through — the viewport, a thumbnail, a render, the preview in Tune mode. Leaving the import
 * to the editor page meant that a scene drawn anywhere else was drawn without its modifiers, which
 * looks exactly like a scene that has none.
 */
import '@/scene/modifiers'
import { meshOf } from '@/scene/document'
import { meshFingerprint } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { invert, multiply } from '@/scene/modifiers/matrix'
import { getModifier, withModifierDefaults, type ModifierInput } from '@/scene/modifiers/types'
import { worldMatrix } from '@/scene/objects'
import type { MeshData, Modifier, SceneDocument, SceneObject } from '@/scene/types'

/**
 * The modifier stack: what an object really looks like.
 *
 * A document holds the mesh a person edits; what the viewport draws is that mesh with the stack
 * run over it. The two are kept apart on purpose — a modifier is a description, not a change, and
 * turning one off has to give back exactly what was there before.
 *
 * Evaluating is not cheap, and it is asked for on every frame that redraws, so the answer is kept.
 * The key is the whole of what the answer depends on: the mesh it started from, the modifiers and
 * their numbers, and the shape and place of every object they read. Anything else changing — the
 * camera, the selection, another object entirely — hits the cache rather than the arithmetic.
 */

export type EvaluatedMesh = {
  /** What to draw. */
  mesh: MeshData
  /**
   * What to edit, when the object is open for editing: the mesh as the document holds it, unless a
   * modifier asked to be shown on the cage.
   */
  cage: MeshData
  /** How many modifiers actually ran, for the panel and for the tests. */
  applied: number
  /** What a modifier refused to do, with the reason, in the order the stack met them. */
  errors: Array<{ modifierId: string; message: string }>
}

/** How many evaluated meshes to keep. A scene of more objects than this is rare; a wrong one is not. */
const CACHE_LIMIT = 64

const cache = new Map<string, EvaluatedMesh>()

export function clearModifierCache(): void {
  cache.clear()
}

export function modifierCacheSize(): number {
  return cache.size
}

export type EvaluateOptions = {
  /** Use the render-time settings of each modifier rather than the viewport's. */
  forRender?: boolean
  /** The object is open for editing, so the modifiers that stand aside for that do. */
  editing?: boolean
}

/**
 * The object's mesh with its stack applied. An object with no modifiers gets its own mesh back,
 * unchanged and uncopied — which is what makes the stack free for the scenes that have none.
 */
export function evaluateObject(document: SceneDocument, object: SceneObject, options: EvaluateOptions = {}): EvaluatedMesh | null {
  const data = meshOf(document, object)
  if (!data) return null
  const forRender = options.forRender === true
  const editing = options.editing === true
  const wanted = object.modifiers.filter((modifier) => (
    (forRender ? modifier.enabled.render : modifier.enabled.viewport)
    && (!editing || modifier.enabled.editMode)
  ))
  if (wanted.length === 0) return { mesh: data, cage: data, applied: 0, errors: [] }

  const key = signature(document, object, data, wanted, forRender, editing)
  const kept = cache.get(key)
  if (kept) {
    // Least recently used, kept honest: reading it moves it back to the end.
    cache.delete(key)
    cache.set(key, kept)
    return kept
  }

  const mesh = EditMesh.from(data)
  const errors: EvaluatedMesh['errors'] = []
  let applied = 0
  let cage: MeshData = data
  for (const modifier of wanted) {
    const module = getModifier(modifier.kind)
    if (!module) {
      errors.push({ modifierId: modifier.id, message: `“${modifier.kind}” is not a modifier this build has.` })
      continue
    }
    const outcome = module.apply(mesh, withModifierDefaults(modifier), {
      inputs: modifierInputs(document, object, modifier, module.objectInputs ?? []),
      forRender,
      editing,
    })
    if (typeof outcome === 'string') {
      errors.push({ modifierId: modifier.id, message: outcome })
      continue
    }
    applied += 1
    // “On cage” means the thing you edit is this modifier's output rather than the stored mesh.
    if (editing && modifier.enabled.onCage) cage = mesh.toData()
  }
  const evaluated: EvaluatedMesh = { mesh: mesh.toData(), cage, applied, errors }
  cache.set(key, evaluated)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return evaluated
}

/** The mesh to draw for an object: the evaluated one, or its own when it has no stack. */
export function drawnMesh(document: SceneDocument, object: SceneObject, options: EvaluateOptions = {}): MeshData | null {
  return evaluateObject(document, object, options)?.mesh ?? meshOf(document, object)
}

/**
 * Everything the answer depends on, as one string.
 *
 * The mesh's fingerprint rather than its identity: an operator that rebuilds a mesh into an equal
 * one should hit the cache. The inputs' fingerprints *and* their matrices, because a mirror about
 * an empty changes when the empty moves and not otherwise.
 */
function signature(
  document: SceneDocument,
  object: SceneObject,
  data: MeshData,
  modifiers: Modifier[],
  forRender: boolean,
  editing: boolean,
): string {
  const parts: string[] = [object.id, meshFingerprint(data), forRender ? 'render' : 'view', editing ? 'edit' : 'object']
  for (const modifier of modifiers) {
    parts.push(modifier.kind, JSON.stringify(withModifierDefaults(modifier)), modifier.enabled.onCage ? 'cage' : '')
    const module = getModifier(modifier.kind)
    for (const name of module?.objectInputs ?? []) {
      const input = inputFor(document, object, modifier.params[name])
      parts.push(input ? `${input.id}:${input.matrix.map(round).join(',')}:${input.mesh ? meshFingerprint(input.mesh) : '-'}` : '-')
    }
  }
  return parts.join('|')
}

/** Rounded so that a matrix that differs in the last bit of a float is still the same matrix. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/**
 * The objects a modifier reads, each placed in the frame of the one being modified. Exported
 * because applying a modifier needs exactly the same composition as evaluating it, and two copies
 * of it would be two chances for a mirror to bake somewhere it did not preview.
 */
export function modifierInputs(
  document: SceneDocument,
  object: SceneObject,
  modifier: Modifier,
  names: string[],
): Record<string, ModifierInput | null> {
  const inputs: Record<string, ModifierInput | null> = {}
  for (const name of names) inputs[name] = inputFor(document, object, modifier.params[name])
  return inputs
}

/**
 * Another object, placed in this one's frame.
 *
 * A modifier works in the mesh's own space, so an object it reads has to be brought into it: the
 * other object's place in the world, then back through this one's. That composition is why the
 * modules are handed a matrix rather than an object — they do not need to know what a scene is.
 */
function inputFor(document: SceneDocument, object: SceneObject, value: unknown): ModifierInput | null {
  if (typeof value !== 'string' || value === '') return null
  const other = document.objects.find((candidate) => candidate.id === value)
  if (!other) return null
  const into = invert(worldMatrix(document, object).toArray())
  const matrix = multiply(into, worldMatrix(document, other).toArray())
  return { id: other.id, name: other.name, matrix, mesh: meshOf(document, other) }
}
