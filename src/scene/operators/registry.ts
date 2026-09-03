import type { Availability, Operator, OperatorContext, OperatorParams, OperatorResult } from '@/scene/operators/types'
import { withDefaults } from '@/scene/operators/types'

/**
 * The one list of everything the editor can do.
 *
 * Registration happens once, at module load, and is refused twice: two operators under one id
 * would mean a menu entry and a keystroke doing different things, which is the kind of bug that is
 * only ever found by a person in the middle of their work.
 */
const OPERATORS = new Map<string, Operator<OperatorParams>>()

export function registerOperator<Params extends OperatorParams>(operator: Operator<Params>): Operator<Params> {
  if (OPERATORS.has(operator.id)) {
    /*
     * Twice is a mistake, except while a module is being hot-replaced: the dev server re-runs the
     * file, every `registerOperator` in it runs again, and a throw there takes the editor down for
     * the rest of the session over an edit that was fine. The new definition is the one to keep —
     * it is the one that was just written.
     */
    if (!import.meta.hot) throw new Error(`An operator is already registered as “${operator.id}”.`)
  }
  OPERATORS.set(operator.id, operator as unknown as Operator<OperatorParams>)
  return operator
}

export function getOperator(id: string): Operator<OperatorParams> | undefined {
  return OPERATORS.get(id)
}

export function listOperators(section?: Operator<OperatorParams>['section']): Array<Operator<OperatorParams>> {
  const all = [...OPERATORS.values()]
  return section ? all.filter((operator) => operator.section === section) : all
}

export function operatorCount(): number {
  return OPERATORS.size
}

/** Only for tests: a registry that starts empty again. */
export function resetOperators(): void {
  OPERATORS.clear()
}

export function operatorAvailability(id: string, context: OperatorContext): Availability {
  const operator = getOperator(id)
  if (!operator) return 'That operator is not in this build.'
  return operator.available(context)
}

/**
 * Runs an operator by id. An operator that is not available here does not run: it comes back with
 * the reason, which the status bar shows — a refused action always says why.
 */
export function runOperator(id: string, context: OperatorContext, params: Partial<OperatorParams> = {}): OperatorResult {
  const operator = getOperator(id)
  if (!operator) return { error: `That operator is not in this build (${id}).` }
  const availability = operator.available(context)
  if (availability !== true) return { error: availability }
  return operator.run(context, withDefaults(operator, params))
}
