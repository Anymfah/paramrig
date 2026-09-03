/**
 * Loading this module is what puts the operators in the registry.
 *
 * Registration is a side effect of import, and the registry is the single list the menus, the
 * palette, the keymap and the documentation are all built from — so a family that is not imported
 * here is a family that exists in the source and nowhere in the interface. The editor page imports
 * this once.
 */
import '@/scene/operators/add'
import '@/scene/operators/collection'
import '@/scene/operators/cursor'
import '@/scene/operators/object'
import '@/scene/operators/select'
import '@/scene/operators/transform'
import '@/scene/operators/view'

export { getOperator, listOperators, operatorAvailability, operatorCount, runOperator } from '@/scene/operators/registry'
export type { Availability, Operator, OperatorContext, OperatorParams, OperatorResult } from '@/scene/operators/types'
