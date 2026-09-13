import type { ReactNode } from 'react'
import type { ParameterDef, ParamGroup, ParamValue } from '@paramrig/core/types'
import { ParameterControl as Control, type ParameterControlProps } from './ParameterControl'
export type { ParameterControlProps } from './ParameterControl'
export type { ControlResources } from '@/ui/ResourceController'
export type { GestureProps } from '@/ui/controller-gesture'

export function ControlsScope({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`paramrig-controls ${className}`.trim()}>{children}</div>
}
export function ParameterControl(props: ParameterControlProps) {
  return <ControlsScope><Control {...props}/></ControlsScope>
}
export type RigControlsProps = Omit<ParameterControlProps, 'param' | 'value' | 'onChange' | 'parameters' | 'onGestureStart' | 'onGestureEnd' | 'onGestureCancel'> & {
  parameters: ParameterDef[]
  groups?: ParamGroup[]
  values: Record<string, ParamValue>
  onChange: (id: string, value: ParamValue) => void
  onGestureStart?: (id: string) => void
  onGestureEnd?: (id: string) => void
  onGestureCancel?: (id: string) => void
}
/** Controlled inputs only: the host supplies values and decides how to store gestures. */
export function RigControls({ parameters, groups = [], values, onChange, onGestureStart, onGestureEnd, onGestureCancel, ...options }: RigControlsProps) {
  const visible = parameters.filter(parameter => !parameter.hidden)
  const render = (parameter: ParameterDef) => <Control key={parameter.id} {...options} param={parameter} parameters={parameters}
    value={values[parameter.id] ?? parameter.defaultValue} onChange={value => onChange(parameter.id, value)}
    onGestureStart={() => onGestureStart?.(parameter.id)} onGestureEnd={() => onGestureEnd?.(parameter.id)} onGestureCancel={() => onGestureCancel?.(parameter.id)}/>
  const known = new Set(groups.map(group => group.id))
  return <ControlsScope><div className="paramrig-rig-controls">
    {groups.map(group => <fieldset key={group.id} className="controller-fieldset controller-stack"><legend>{group.label}</legend>{visible.filter(parameter => parameter.group === group.id).map(render)}</fieldset>)}
    {visible.filter(parameter => !known.has(parameter.group)).map(render)}
  </div></ControlsScope>
}
