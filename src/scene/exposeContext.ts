import { createContext, useContext } from 'react'
import type { ParameterDef, ParamGroup } from '@/rigs/types'
import type { SceneBinding } from '@/scene/rig'
import type { SceneDocument } from '@/scene/types'
import type { ExposeRequest } from '@/scene/rigEdits'

/**
 * What a field needs to know to become a control.
 *
 * The panels are handed one context rather than a dozen callbacks, for the same reason the drawing
 * editor is: a field is written once, in the panel that owns it, and wrapping it in a diamond must
 * not mean threading the rig through every component between the page and the row.
 *
 * A panel that is rendered outside the editor — a test, a preview — simply has no provider, and
 * every `Exposable` then draws its field and nothing else.
 */
export type SceneExposeContextValue = {
  /** The document as it is stored, which is what a control's default is read from. */
  document: SceneDocument
  groups: ParamGroup[]
  /** The controls the document declares, so a bound field can name the one driving it. */
  parameters: ParameterDef[]
  bindings: SceneBinding[]
  onExpose: (request: ExposeRequest) => void
  onUnbind: (binding: SceneBinding) => void
  onGoToControl: (binding: SceneBinding) => void
  /** A control dragged out of the Controls tab and dropped on a field. */
  onDropParameter?: (parameterId: string, target: { objectId?: string; property: string }) => void
  /** The controls that carry keyframes, so an animated field can say so. */
  animated?: ReadonlySet<string>
}

export const SceneExposeContext = createContext<SceneExposeContextValue | null>(null)

export function useSceneExpose(): SceneExposeContextValue | null {
  return useContext(SceneExposeContext)
}

/** The binding driving one property of one object, or nothing. */
export function bindingFor(
  context: SceneExposeContextValue | null,
  target: { objectId?: string; property: string },
): SceneBinding | null {
  if (!context) return null
  // The last binding wins when a property has more than one, so it is the one a field reports.
  const matches = context.bindings.filter((binding) => (
    binding.property === target.property && (binding.objectId ?? null) === (target.objectId ?? null)
  ))
  return matches[matches.length - 1] ?? null
}

/**
 * Whether any of these properties is driven. A folded section uses it to say so without being
 * opened: the detail lives on the row, and a lit diamond is what carries the news out to the head.
 */
export function useDrivenScene(target: { objectId?: string }, ...properties: string[]): boolean {
  const context = useSceneExpose()
  if (!context) return false
  return context.bindings.some((binding) => (
    properties.includes(binding.property) && (binding.objectId ?? null) === (target.objectId ?? null)
  ))
}
