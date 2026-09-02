import { createContext, useContext } from 'react'
import type { ParameterDef, ParamGroup } from '@/rigs/types'
import type { VectorBinding } from '@/vector/rig'

/** What is asked for when a field is turned into a control. */
export type ExposeRequest = {
  elementId: string
  property: string
  label: string
  group: string
  newGroupLabel?: string
  min?: number
  max?: number
  step?: number
}

export type ExposeContextValue = {
  /** The object whose fields are on screen; null when several are selected. */
  elementId: string | null
  /** The name of that object, used to prefill a control's label. */
  elementName: string
  groups: ParamGroup[]
  /** The controls the document declares, so a bound field can name the one driving it. */
  parameters: ParameterDef[]
  bindings: VectorBinding[]
  onExpose: (request: ExposeRequest) => void
  onUnbind: (binding: VectorBinding) => void
  onGoToControl: (binding: VectorBinding) => void
  /** A control dragged from the Controls tab and dropped on a field. */
  onDropParameter?: (parameterId: string, elementId: string, property: string) => void
}

export const ExposeContext = createContext<ExposeContextValue | null>(null)

/**
 * Whether any of these properties of the selected object is driven. A line of a list uses it to
 * say so without being opened: the detail lives in a popover, and a lit diamond is what carries
 * the news out to the line.
 */
export function useDriven(...properties: string[]): boolean {
  const context = useContext(ExposeContext)
  if (!context?.elementId) return false
  return context.bindings.some((binding) => binding.elementId === context.elementId && properties.includes(binding.property))
}

