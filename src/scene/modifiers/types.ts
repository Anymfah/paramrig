import type { ParameterDef } from '@/rigs/types'
import type { EditMesh } from '@/scene/mesh/editMesh'
import type { MeshData, Modifier, ModifierKind, Vec3 } from '@/scene/types'

/**
 * What a modifier is.
 *
 * The same shape as an operator, and for the same reason: one declaration from which the panel,
 * the defaults, the sanitiser and the documentation are all derived, so a parameter cannot exist in
 * the code and be missing from the interface. A module is a pure function of a mesh and its
 * numbers — no document, no viewport, no three.js — which is what lets every one of them be tested
 * against a cube rather than against a screenshot.
 *
 * `apply` mutates the mesh it is given, exactly as an operator does. The stack hands it a clone, so
 * a modifier never touches what the document holds.
 */

export type ModifierCategory = 'modify' | 'generate' | 'deform'

/** Another object a modifier reads: its shape, and where it is relative to the object being built. */
export type ModifierInput = {
  id: string
  name: string
  /** The other object's transform in the frame of the one being modified, row-major, sixteen long. */
  matrix: number[]
  mesh: MeshData | null
}

export type ModifierContext = {
  /** The objects named by the modifier's parameters, by parameter id. */
  inputs: Record<string, ModifierInput | null>
  /** Whether this evaluation is for the final render rather than for the viewport. */
  forRender: boolean
  /** Whether the object is open for editing, which some modifiers behave differently under. */
  editing: boolean
}

/**
 * What a modifier did. A string is a refusal with the reason in it, which the panel shows in red
 * and the stack carries on past — a broken modifier hides the ones after it if it stops the stack.
 */
export type ModifierOutcome = void | string

export type ModifierModule<Params extends Modifier['params'] = Modifier['params']> = {
  kind: ModifierKind
  label: string
  category: ModifierCategory
  /** One line for the Add menu and the generated documentation. */
  description: string
  /** The name of an icon in `src/scene/iconRegistry.ts`. */
  icon?: string
  defaults: Params
  schema: ParameterDef[]
  /** Which parameters name another object, so the stack can gather them before applying. */
  objectInputs?: string[]
  apply: (mesh: EditMesh, params: Params, context: ModifierContext) => ModifierOutcome
}

/** Declare a built-in without mutating the registry during import. */
export function defineModifier<Params extends Modifier['params']>(module: ModifierModule<Params>): ModifierModule<Params> { return module }

const MODULES = new Map<ModifierKind, ModifierModule>()

/**
 * Registration is a side effect of import, once, and refused twice: two modules under one kind
 * would mean a panel describing one thing and the viewport drawing another.
 */
export function registerModifier<Params extends Modifier['params']>(module: ModifierModule<Params>): ModifierModule<Params> {
  // Twice is a mistake, except under hot replacement, where the file simply ran again: see the
  // same note in `operators/registry.ts`. The definition that was just written wins.
  if (MODULES.has(module.kind) && !import.meta.hot) {
    throw new Error(`A modifier is already registered as “${module.kind}”.`)
  }
  MODULES.set(module.kind, module as unknown as ModifierModule)
  return module
}

export function getModifier(kind: ModifierKind): ModifierModule | undefined {
  return MODULES.get(kind)
}

export function listModifiers(category?: ModifierCategory): ModifierModule[] {
  const all = [...MODULES.values()]
  return category ? all.filter((module) => module.category === category) : all
}

export function modifierCount(): number {
  return MODULES.size
}

/** Only for tests: a registry that starts empty again. */
export function resetModifiers(): void {
  MODULES.clear()
}

/** A modifier's parameters with anything missing filled in from its module. */
export function withModifierDefaults(modifier: Modifier): Modifier['params'] {
  const module = getModifier(modifier.kind)
  return { ...(module?.defaults ?? {}), ...modifier.params }
}

/* ------------------------------------------------------------------ numbers */

/**
 * The readers every module uses on its own parameters.
 *
 * A parameter arrives as whatever the document held, which after a hand-edited file may be a
 * string, a null or nothing at all. Reading it through these means a modifier is never handed a
 * NaN — which in a mesh is not an error but a hole, and one that only shows up three operations
 * later.
 */
export function numberOf(value: unknown, fallback: number, low = -1e9, high = 1e9): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(high, Math.max(low, number))
}

export function wholeOf(value: unknown, fallback: number, low = 0, high = 1e6): number {
  return Math.round(numberOf(value, fallback, low, high))
}

export function switchOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function chosenOf<Option extends string>(value: unknown, options: readonly Option[], fallback: Option): Option {
  return options.includes(value as Option) ? (value as Option) : fallback
}

export function vectorOf(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length < 3) return fallback
  const read = value.map((entry, index) => numberOf(entry, fallback[index] ?? 0))
  return [read[0]!, read[1]!, read[2]!]
}
