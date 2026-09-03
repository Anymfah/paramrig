import { useId } from 'react'
import { bindingFor, shortcutLabel } from '@/scene/keymap'
import { getOperator } from '@/scene/operators/registry'
import type { OperatorParams } from '@/scene/operators/types'
import { IconChevron, IconChevronUp } from '@/ui/icons'
import { ParameterField } from '@/ui/ParameterField'
import { Tooltip } from '@/ui/Tooltip'

/**
 * “Adjust last operation”: the panel in the bottom left corner that lets the numbers of the thing
 * just done be changed after the fact.
 *
 * It draws nothing of its own. The fields come from the operator's declared schema, so an operator
 * that gains a parameter gains a field here without a line being written, and changing one hands
 * back the whole parameter object — the editor re-runs the operator against the document as it was
 * before, rather than trying to edit the result. Folded it is one line, because the panel is over
 * the viewport and the viewport is what a person is looking at.
 */
export function SceneRedoPanel({ operation, expanded, onExpanded, onAdjust }: {
  operation: { operatorId: string; label: string; params: OperatorParams } | null
  expanded: boolean
  onExpanded: (expanded: boolean) => void
  onAdjust: (params: OperatorParams) => void
}) {
  const bodyId = useId()
  // Nothing has been done yet, or what was done left no operation to adjust: the corner stays empty.
  if (!operation) return null

  const operator = getOperator(operation.operatorId)
  const schema = operator?.params ?? []
  const binding = bindingFor('redoPanel')

  return (
    <section className="scene-redo" aria-label="Adjust last operation">
      <Tooltip content={binding ? `Adjust last operation · ${shortcutLabel(binding)}` : 'Adjust last operation'} side="top" block>
        <button
          type="button"
          className="scene-redo__summary"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => onExpanded(!expanded)}
        >
          <span className="scene-redo__label">{operation.label}</span>
          {expanded ? <IconChevron /> : <IconChevronUp />}
        </button>
      </Tooltip>
      {expanded ? (
        <div className="scene-redo__body" id={bodyId}>
          {!operator ? (
            <p className="scene-redo__empty">That operation is not in this build, so there is nothing to adjust.</p>
          ) : schema.length === 0 ? (
            <p className="scene-redo__empty">This operation has no settings.</p>
          ) : (
            schema.map((param) => {
              const stored = operation.params[param.id]
              return (
                <ParameterField
                  key={param.id}
                  param={param}
                  value={stored === undefined ? param.defaultValue : stored}
                  onChange={(next) => onAdjust({ ...operation.params, [param.id]: next })}
                />
              )
            })
          )}
        </div>
      ) : null}
    </section>
  )
}
