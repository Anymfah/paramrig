/**
 * Loading this module is what puts the operators in the registry.
 *
 * Registration is a side effect of import, and the registry is the single list the menus, the
 * palette, the keymap and the documentation are all built from — so a family that is not imported
 * here is a family that exists in the source and nowhere in the interface. The editor page imports
 * this once.
 */
import '@/scene/operators/add'
import '@/scene/operators/bevel'
import '@/scene/operators/bisect'
import '@/scene/operators/boolean'
import '@/scene/operators/bridge'
import '@/scene/operators/cleanup'
import '@/scene/operators/collection'
import '@/scene/operators/cursor'
import '@/scene/operators/duplicate'
import '@/scene/operators/extrude'
import '@/scene/operators/fill'
import '@/scene/operators/hull'
import '@/scene/operators/inset'
import '@/scene/operators/knife'
import '@/scene/operators/loopCut'
import '@/scene/operators/merge'
import '@/scene/operators/mode'
import '@/scene/operators/modifier'
import '@/scene/operators/normals'
import '@/scene/operators/object'
import '@/scene/operators/polyBuild'
import '@/scene/operators/remove'
import '@/scene/operators/select'
import '@/scene/operators/selectMesh'
import '@/scene/operators/shell'
import '@/scene/operators/spin'
import '@/scene/operators/split'
import '@/scene/operators/subdivide'
import '@/scene/operators/symmetry'
import '@/scene/operators/transform'
import '@/scene/operators/transformMesh'
import '@/scene/operators/view'

export { getOperator, listOperators, operatorAvailability, operatorCount, runOperator } from '@/scene/operators/registry'
export type { Availability, Operator, OperatorContext, OperatorParams, OperatorResult } from '@/scene/operators/types'
