import { useState } from 'react'
import type { BezierCurve, GradientStop, NumberParam, ParameterDef, ParamGroup, ParamValue } from '@/rigs/types'
import { ColorField } from '@/ui/ColorField'
import { CurveField } from '@/ui/CurveField'
import { GradientField } from '@/ui/GradientField'
import { IconChevron, IconSliders } from '@/ui/icons'
import { SelectField } from '@/ui/SelectField'
import { SliderField } from '@/ui/SliderField'
import { SwitchField } from '@/ui/SwitchField'
import { valuesEqual } from '@/state/values'
import type { RigSession } from '@/state/session'
import { usePlayhead } from '@/state/workspace'

type InspectorProps = {
  session: RigSession
  groups: ParamGroup[]
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  defaults: Record<string, ParamValue>
}

export function Inspector({ session, groups, parameters, values, defaults }: InspectorProps) {
  const [tab, setTab] = useState<'controls' | 'bindings' | 'snapshots'>('controls')
  const snapshot = session.getSnapshot()
  const tabs = ['controls', 'bindings', 'snapshots'] as const
  const selectTab = (id: (typeof tabs)[number]) => {
    setTab(id)
    queueMicrotask(() => document.getElementById(`inspector-tab-${id}`)?.focus())
  }

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector__head">
        <strong>Inspector</strong>
        <IconSliders />
      </div>
      <div className="inspector__tabs" role="tablist" aria-label="Inspector panels">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`inspector-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`inspector-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const index = tabs.indexOf(tab)
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault()
                selectTab(tabs[(index + 1) % tabs.length]!)
              }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault()
                selectTab(tabs[(index + tabs.length - 1) % tabs.length]!)
              }
              if (event.key === 'Home') {
                event.preventDefault()
                selectTab(tabs[0]!)
              }
              if (event.key === 'End') {
                event.preventDefault()
                selectTab(tabs[tabs.length - 1]!)
              }
            }}
          >
            {id[0]?.toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>
      <div className="inspector__body scroll-area" role="tabpanel" id={`inspector-panel-${tab}`} aria-labelledby={`inspector-tab-${tab}`}>
        {tab === 'controls'
          ? groups.map((group) => (
              <ParameterSection
                key={group.id}
                label={group.label}
                parameters={parameters.filter((param) => param.group === group.id)}
                values={values}
                defaults={defaults}
                session={session}
              />
            ))
          : null}
        {tab === 'bindings' ? (
          <div className="section">
            <p className="lede">Each control writes the same key that export JSON uses. Custom controls share this contract.</p>
            {parameters.map((param) => (
              <div className="meta-row" key={param.id}>
                <span>{param.label}</span>
                <code data-copyable>{param.id}</code>
              </div>
            ))}
          </div>
        ) : null}
        {tab === 'snapshots' ? (
          <div className="section">
            {snapshot.snapshots.length === 0 ? (
              <>
                <p className="lede">No snapshots yet. Capture current values to compare Original against later edits.</p>
                <button type="button" className="btn btn--solid btn--sm" onClick={() => session.captureSnapshot('Snapshot 1')}>
                  Snapshot current values
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => session.captureSnapshot(`Snapshot ${snapshot.snapshots.length + 1}`)}
                >
                  Snapshot current values
                </button>
                {snapshot.snapshots.map((item) => {
                  const active = item.id === snapshot.activeSnapshotId
                  return (
                    <div className="snapshot-row" key={item.id} data-active={active} aria-current={active ? 'true' : undefined}>
                      <div>
                        <strong>{item.name}</strong>
                        <p className="field__hint">{snapshotStamp(item.createdAt)}</p>
                      </div>
                      {active ? (
                        <span className="snapshot-row__state">Active</span>
                      ) : (
                        <button type="button" className="btn btn--quiet btn--sm" onClick={() => session.restoreSnapshot(item.id)}>
                          Restore
                        </button>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function snapshotStamp(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ParameterSection({
  label,
  parameters,
  values,
  defaults,
  session,
}: {
  label: string
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  defaults: Record<string, ParamValue>
  session: RigSession
}) {
  const [open, setOpen] = useState(true)
  const animated = parameters.filter((param) => session.trackFor(param.id)).length
  return (
    <section className="section" data-open={open}>
      <button type="button" className="section__title" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
        <IconChevron />
      </button>
      <div className="section__panel">
        <div>
          {parameters.map((param) => (
            <Control
              key={param.id}
              param={param}
              value={values[param.id] as ParamValue}
              defaultValue={defaults[param.id] as ParamValue}
              session={session}
            />
          ))}
          {animated > 0 ? (
            <p className="field__hint">
              {animated} animated {animated === 1 ? 'parameter' : 'parameters'}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function Control({
  param,
  value,
  defaultValue,
  session,
}: {
  param: ParameterDef
  value: ParamValue
  defaultValue: ParamValue
  session: RigSession
}) {
  const resetDisabled = valuesEqual(session.storedValue(param.id) ?? value, defaultValue)
  const start = () => session.beginGesture()
  const end = () => session.endGesture()
  const reset = () => session.resetParam(param.id)
  const track = session.trackFor(param.id)

  if (param.kind === 'number') {
    if (track) {
      return <LiveNumberControl param={param} defaultValue={defaultValue} session={session} />
    }
    return (
      <SliderField
        label={param.label}
        value={Number(value)}
        min={param.min}
        max={param.max}
        step={param.step}
        unit={param.unit}
        sliderMin={param.sliderMin}
        sliderMax={param.sliderMax}
        onChange={(next) => session.setValue(param.id, next)}
        onGestureStart={start}
        onGestureEnd={end}
        onReset={reset}
        resetDisabled={resetDisabled}
      />
    )
  }
  if (param.kind === 'color') {
    return (
      <ColorField
        label={param.label}
        value={String(value)}
        onChange={(next) => session.setValue(param.id, next)}
        onGestureStart={start}
        onGestureEnd={end}
        onReset={reset}
        resetDisabled={resetDisabled}
      />
    )
  }
  if (param.kind === 'curve') {
    return (
      <CurveField
        label={param.label}
        value={value as BezierCurve}
        onChange={(next) => session.setValue(param.id, next)}
        onGestureStart={start}
        onGestureEnd={end}
        onReset={reset}
        resetDisabled={resetDisabled}
      />
    )
  }
  if (param.kind === 'switch') {
    return <SwitchField label={param.label} checked={Boolean(value)} onChange={(next) => session.setValue(param.id, next)} onReset={reset} resetDisabled={resetDisabled} />
  }
  if (param.kind === 'gradient') {
    return (
      <GradientField
        label={param.label}
        value={value as GradientStop[]}
        onChange={(next) => session.setValue(param.id, next)}
        onGestureStart={start}
        onGestureEnd={end}
        onReset={reset}
        resetDisabled={resetDisabled}
      />
    )
  }
  if (param.kind === 'select') {
    const apply = (next: string) => {
      if (param.appliesToTracks && (next === 'linear' || next === 'step')) {
        session.beginGesture()
        session.setValue(param.id, next)
        for (const track of session.getSnapshot().tracks) {
          session.setTrackInterpolation(track.paramId, next)
        }
        session.endGesture()
        return
      }
      session.setValue(param.id, next)
    }
    return (
      <SelectField
        label={param.label}
        value={String(value)}
        options={param.options}
        onChange={apply}
        onReset={() => apply(String(param.defaultValue))}
        resetDisabled={resetDisabled}
      />
    )
  }
  return null
}

function LiveNumberControl({
  param,
  defaultValue,
  session,
}: {
  param: NumberParam
  defaultValue: ParamValue
  session: RigSession
}) {
  const playhead = usePlayhead(session)
  const value = session.liveNumber(param.id)
  const stored = session.storedValue(param.id)
  const resetDisabled = stored === undefined ? true : valuesEqual(stored, defaultValue)
  return (
    <>
      <SliderField
        label={param.label}
        value={value}
        min={param.min}
        max={param.max}
        step={param.step}
        unit={param.unit}
        sliderMin={param.sliderMin}
        sliderMax={param.sliderMax}
        onChange={(next) => session.setValue(param.id, next)}
        onGestureStart={() => session.beginGesture()}
        onGestureEnd={() => session.endGesture()}
        onReset={() => session.resetParam(param.id)}
        resetDisabled={resetDisabled}
      />
      <p className="field__hint">Interpolated at {playhead.toFixed(2)} s</p>
    </>
  )
}
