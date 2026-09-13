import { numberOf, defineModifier, switchOf, wholeOf } from '@/scene/modifiers/types'
import { smoothVertices, type SmoothAxes } from '@/scene/operators/spin'
import { numberParam, switchParam } from '@/scene/operators/types'

/**
 * Smooth: every vertex towards the average of the vertices it is joined to.
 *
 * The arithmetic is not written here. It is `smoothVertices` in `operators/spin.ts`, which is what
 * the Smooth vertices operator runs on a selection; this modifier runs the same passes over every
 * vertex of the mesh instead. Two copies of a relaxation would be two copies with different
 * rounding the first time either was touched, and the panel and the menu item would stop agreeing.
 *
 * Nothing here changes the topology: the counts before and after are the same mesh, which is why
 * a modifier this cheap can sit anywhere in the stack without the ones after it having to care.
 */

export const smoothModifier = defineModifier({
  kind: 'smooth',
  label: 'Smooth',
  category: 'deform',
  description: 'Move every vertex towards the average of the vertices it is joined to.',
  defaults: { factor: 0.5, repeat: 1, axisX: true, axisY: true, axisZ: true },
  schema: [
    numberParam('factor', 'Factor', { min: -10, max: 10, step: 0.05, defaultValue: 0.5, view: 'bar' }),
    numberParam('repeat', 'Repeat', { min: 0, max: 200, step: 1, defaultValue: 1 }),
    switchParam('axisX', 'X', true),
    switchParam('axisY', 'Y', true),
    switchParam('axisZ', 'Z', true),
  ],
  apply: (mesh, params) => {
    const axes: SmoothAxes = [
      switchOf(params.axisX, true),
      switchOf(params.axisY, true),
      switchOf(params.axisZ, true),
    ]
    if (!axes[0] && !axes[1] && !axes[2]) return 'Leave at least one axis on, or nothing can move.'
    // A mesh of loose vertices has no neighbourhoods to average, so the modifier would be silently
    // inert; saying so is worth more than a stack that looks as though it ran.
    if (mesh.edgeCount === 0) return 'Smooth averages along the edges, and this mesh has none.'
    const slots: number[] = []
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) slots.push(slot)
    smoothVertices(mesh, slots, {
      factor: numberOf(params.factor, 0.5, -10, 10),
      repeat: wholeOf(params.repeat, 1, 0, 200),
      axes,
    })
    return undefined
  },
})
