import { useId, useState } from 'react'
import type { ParameterDef, ParamGroup } from '../rigs/types'
import { valuesEqual } from '../state/values'
import { ContextMenuRoot, ContextTarget, type ContextMenuItem } from '../ui/ContextMenu'
import { ParameterField } from '../ui/ParameterField'
import { IconChevron, IconReset, IconResetSection } from '../ui/icons'
import type { WebSession } from './session'
import type { Values } from './contracts'

export type ScopedControl = { param: ParameterDef; scope: string }

export function WebControls({ session, controls, disabled, values = session.document.values }: { session: WebSession; controls: ScopedControl[]; disabled: boolean; values?: Values }) {
  const sections = [...new Set(controls.map(control => control.scope))].flatMap(scope => session.manifest.groups.flatMap(group => {
    const visible = controls.filter(control => control.param.group === group.id && control.scope === scope)
    return visible.length ? [{ group, controls: visible, scope }] : []
  }))
  /*
   * A section is named after its group; how far it reaches is a badge beside that name. Repeating
   * the same reach on every section of a panel says nothing — "Global" three times over is noise —
   * so it is dropped once several sections agree. A lone section keeps it: "All instances" on the
   * controls of a repeated component is the warning that the other cards will change too.
   */
  const reach = new Set(sections.map(section => section.scope))
  const informative = sections.length < 2 || reach.size > 1
  return <ContextMenuRoot><div inert={disabled}>
    {sections.map(section => <ControlSection key={`${section.group.id}:${section.scope}`} group={section.group} controls={section.controls} session={session} values={values} scope={informative ? section.scope : null} />)}
  </div></ContextMenuRoot>
}

function ControlSection({ group, controls, session, values, scope }: { group: ParamGroup; controls: ScopedControl[]; session: WebSession; values: Values; scope: string | null }) {
  const [open, setOpen] = useState(group.defaultOpen ?? true)
  const panelId = useId()
  const doc = session.document
  const dirty = controls.filter(({ param }) => !valuesEqual(values[param.id]!, doc.sourceValues[param.id]!))
  const badge = scope && scope.toLowerCase() !== group.label.toLowerCase() ? scope : null
  const resetSection = () => {
    session.begin(`Reset ${group.label}`)
    for (const { param } of dirty) session.reset(param.id)
    session.end()
  }
  const sectionAction: ContextMenuItem = { label: 'Reset section', icon: <IconResetSection />, disabled: !dirty.length, onSelect: resetSection }

  return <section className="section" data-open={open}>
    <ContextTarget items={[sectionAction]} label={`${group.label} actions`}>
      <div className="section__head">
        <button type="button" className="section__title" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
          <span>{group.label}</span>{badge ? <span className="web-section-scope">{badge}</span> : null}<IconChevron />
        </button>
      </div>
    </ContextTarget>
    <div className="section__panel" id={panelId} inert={!open} aria-hidden={!open}><div>
      {controls.map(({ param }) => <ContextTarget key={param.id} label={`${param.label} actions`} items={[
        { label: `Reset ${param.label}`, icon: <IconReset />, disabled: !dirty.some(control => control.param.id === param.id), onSelect: () => session.reset(param.id) },
        ...(controls.length > 1 ? [sectionAction] : []),
      ]}>
        <ParameterField
          param={{ ...param, defaultValue: doc.sourceValues[param.id] ?? param.defaultValue } as ParameterDef}
          value={values[param.id] ?? param.defaultValue}
          onChange={value => session.setValue(param.id, value)}
          onGestureStart={() => session.begin(`Adjust ${param.label}`)}
          onGestureEnd={() => session.end()}
          onGestureCancel={() => session.cancel()}
          parameters={session.manifest.parameters}
          resolveNumber={id => Number(values[id])}
          onAction={id => session.action(id)}
          onPreset={(id, choice) => {
            const preset = session.manifest.parameters.find(candidate => candidate.id === id)
            if (preset?.kind !== 'preset') return
            session.begin('Apply preset')
            session.setValue(id, choice)
            for (const [key, value] of Object.entries(preset.options.find(option => option.value === choice)?.values ?? {})) session.setValue(key, value)
            session.end()
          }}
        />
      </ContextTarget>)}
    </div></div>
  </section>
}
