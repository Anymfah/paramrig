import { useEffect, useState } from 'react'
import type { ValueSource } from '@/rigs/extended-types'
import { SelectField } from './SelectField'
import { TextController } from './TextController'
import { NumberController } from './NumberController'
import { Button } from './Button'

type NumericSource = { id: string; label: string }

export function ValueSourceController({ label, target, value, sources, animated, min, max, onChange, forceExpanded = false }: {
  label: string
  target: string
  value: ValueSource
  sources: NumericSource[]
  animated: boolean
  min: number
  max: number
  onChange: (value: ValueSource) => void
  forceExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(forceExpanded || value.mode !== 'local')
  useEffect(() => {
    if (value.mode !== 'local') setExpanded(true)
  }, [value.mode])
  const modes = [
    { value: 'local', label: 'Local' },
    { value: 'parameter', label: 'Param' },
    { value: 'expression', label: 'Expr' },
    { value: 'animation', label: 'Track' },
    { value: 'macro', label: 'Macro' },
    { value: 'modulation', label: 'Modulation' },
    { value: 'blend', label: 'Blend' },
  ]
  const sourceOptions = sources.filter(source => source.id !== target).map(source => ({ value: source.id, label: source.label }))
  const mode = value.mode
  const sourceField = (fieldLabel: string, source?: string, onSource?: (source: string) => void) => (
    <SelectField label={fieldLabel} value={source ?? sourceOptions[0]?.value ?? ''} options={sourceOptions} disabled={!sourceOptions.length} onChange={source => onSource?.(source)}/>
  )
  const numberField = (fieldLabel: string, fieldValue: number, fieldMin: number, fieldMax: number, onValue: (next: number) => void) => (
    <NumberController param={{ kind: 'number', id: fieldLabel, label: fieldLabel, group: 'source', min: fieldMin, max: fieldMax, step: 0.01, defaultValue: fieldValue, view: 'field' }} value={fieldValue} onChange={next => onValue(Number(next))}/>
  )
  const modulation = mode === 'modulation' ? value : null
  if (!expanded) return <Button size="sm" variant="quiet" aria-label={`Add value source to ${label}`} onClick={() => setExpanded(true)}>Add value source</Button>
  return <fieldset className="controller-stack controller-fieldset binding-controller">
    <legend>{label} source</legend>
    <SelectField label="Value source" value={mode} options={modes} onChange={next => {
      if (next === 'macro') onChange({ mode: 'macro', min, max })
      else if (next === 'modulation') onChange({ mode: 'modulation', shape: 'sine', rate: 1, phase: 0, amplitude: (max - min) / 2, offset: (min + max) / 2, attack: 0.5, hold: 1, release: 0.5, seed: 0 })
      else if (next === 'blend') onChange({ mode: 'blend', from: min, to: max, amount: 0 })
      else onChange({ mode: next as Extract<ValueSource, { mode: 'local' | 'parameter' | 'expression' | 'animation' }>['mode'] })
    }}/>
    {mode === 'parameter' ? sourceField('Source parameter', value.source, source => onChange({ mode, source })) : null}
    {mode === 'expression' ? <TextController label="Expression" value={value.expression ?? ''} onChange={expression => onChange({ mode, expression })} validate={expression => {
      if (!expression.trim()) return 'Enter an expression'
      return null
    }}/> : null}
    {mode === 'macro' ? <>{sourceField('Macro parameter', value.source, source => onChange({ ...value, source }))}{numberField('Minimum output', value.min, min, max, next => onChange({ ...value, min: next }))}{numberField('Maximum output', value.max, min, max, next => onChange({ ...value, max: next }))}</> : null}
    {modulation ? <><SelectField label="Shape" value={modulation.shape} options={['sine', 'triangle', 'square', 'noise', 'envelope'].map(shape => ({ value: shape, label: shape[0]!.toUpperCase() + shape.slice(1) }))} onChange={shape => onChange({ ...modulation, shape })}/>{numberField('Rate', modulation.rate, 0.01, 60, rate => onChange({ ...modulation, rate }))}{numberField('Amplitude', modulation.amplitude, 0, 10000, amplitude => onChange({ ...modulation, amplitude }))}{numberField('Offset', modulation.offset, -10000, 10000, offset => onChange({ ...modulation, offset }))}</> : null}
    {mode === 'blend' ? <>{sourceField('Blend parameter', value.source, source => onChange({ ...value, source, amount: undefined }))}{numberField('From', value.from, min, max, from => onChange({ ...value, from }))}{numberField('To', value.to, min, max, to => onChange({ ...value, to }))}{!value.source ? numberField('Amount', value.amount ?? 0, 0, 1, amount => onChange({ ...value, amount })) : null}</> : null}
    {mode === 'local' ? <p className="field__hint">The target keeps its local value.</p> : null}
    {mode === 'parameter' ? <p className="field__hint">The target follows the selected numeric parameter.</p> : null}
    {mode === 'expression' ? <p className="field__hint">Use parameter names, t, pi, + − * / and sin, cos, min, max, clamp.</p> : null}
    {mode === 'animation' ? <p className="field__hint">{animated ? 'The target follows its timeline track.' : 'Add a keyframe in the Timeline to animate the target.'}</p> : null}
    {mode === 'local' ? <Button size="sm" variant="quiet" onClick={() => setExpanded(false)}>Hide source settings</Button> : <Button size="sm" variant="quiet" aria-label={`Remove value source from ${label}`} onClick={() => { onChange({ mode: 'local' }); setExpanded(false) }}>Remove value source</Button>}
  </fieldset>
}
