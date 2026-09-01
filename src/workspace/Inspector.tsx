import { useEffect, useId, useRef, useState } from 'react'
import type { InspectorCategory, ParameterDef, ParamGroup, ParamValue } from '@/rigs/types'
import { ContextMenuRoot, ContextTarget, type ContextMenuItem } from '@/ui/ContextMenu'
import { horizontalStripWheel } from '@/ui/horizontal-strip-wheel'
import { IconChevron, IconReset, IconResetSection, IconSliders } from '@/ui/icons'
import { ParameterField } from '@/ui/ParameterField'
import { ValueSourceController } from '@/ui/BindingController'
import type { RigSession } from '@/state/session'
import { usePlayhead } from '@/state/workspace'

type InspectorProps = {
  session: RigSession
  categories?: InspectorCategory[]
  groups: ParamGroup[]
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  defaults: Record<string, ParamValue>
}

export function Inspector({ session, categories = [], groups, parameters, values, defaults }: InspectorProps) {
  const [tab, setTab] = useState<'controls' | 'bindings' | 'snapshots' | 'history'>('controls')
  const [category, setCategory] = useState(categories[0]?.id ?? '')
  const bodyRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const snapshot = session.getSnapshot()
  const tabs = ['controls', 'snapshots', 'history', 'bindings'] as const
  const categoryRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectTab = (id: (typeof tabs)[number]) => {
    setTab(id)
    queueMicrotask(() => document.getElementById(`inspector-tab-${id}`)?.focus())
  }

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const blockWheelOnValues = (event: WheelEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('input[type="range"], .number-value, .stepper')) {
        event.preventDefault()
      }
    }
    el.addEventListener('wheel', blockWheelOnValues, { passive: false })
    return () => el.removeEventListener('wheel', blockWheelOnValues)
  }, [tab])

  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    const syncOverflow = () => {
      const max = el.scrollWidth - el.clientWidth
      const start = el.scrollLeft > 1
      const end = max > 1 && el.scrollLeft < max - 1
      const next = start && end ? 'both' : start ? 'start' : end ? 'end' : 'none'
      if (el.dataset.overflow !== next) el.dataset.overflow = next
    }
    const onWheel = (event: WheelEvent) => {
      const delta = horizontalStripWheel(event, el.clientWidth)
      if (delta === 0) return
      if (el.scrollWidth <= el.clientWidth) return
      event.preventDefault()
      el.scrollLeft += delta
      syncOverflow()
    }
    syncOverflow()
    const observer = new ResizeObserver(syncOverflow)
    observer.observe(el)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', syncOverflow, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', syncOverflow)
    }
  }, [tab])

  useEffect(() => {
    document.getElementById(`inspector-tab-${tab}`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [tab])

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector__head">
        <strong>Inspector</strong>
        <IconSliders />
      </div>
      <div ref={tabsRef} className="inspector__tabs" role="tablist" aria-label="Inspector panels" data-overflow="none">
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
      {tab === 'controls' && categories.length > 1 ? (
        <div className="inspector__categories" role="tablist" aria-label="Control categories">
          {categories.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => { if (node) categoryRefs.current.set(item.id, node); else categoryRefs.current.delete(item.id) }}
              type="button"
              role="tab"
              id={`inspector-category-${item.id}`}
              aria-selected={category === item.id}
              aria-controls="inspector-controls-panel"
              tabIndex={category === item.id ? 0 : -1}
              onClick={() => setCategory(item.id)}
              onKeyDown={(event) => {
                let next = index
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % categories.length
                else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + categories.length - 1) % categories.length
                else if (event.key === 'Home') next = 0
                else if (event.key === 'End') next = categories.length - 1
                else return
                event.preventDefault()
                const nextId = categories[next]!.id
                setCategory(nextId)
                queueMicrotask(() => categoryRefs.current.get(nextId)?.focus())
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="inspector__body scroll-area"
        role="tabpanel"
        id={`inspector-panel-${tab}`}
        aria-labelledby={`inspector-tab-${tab}`}
        ref={bodyRef}
        tabIndex={0}
      >
        {tab === 'controls'
          ? (
            <ContextMenuRoot>
              <div id="inspector-controls-panel" role={categories.length > 1 ? 'tabpanel' : undefined} aria-labelledby={categories.length > 1 ? `inspector-category-${category}` : undefined}>
              {groups.filter((group) => !group.tab || group.tab === category).map((group) => (
                <ParameterSection
                  key={group.id}
                  label={group.label}
                  parameters={parameters.filter((param) => param.group === group.id && !param.hidden)}
                  values={values}
                  defaults={defaults}
                  session={session}
                  defaultOpen={group.defaultOpen}
                />
              ))}
              </div>
            </ContextMenuRoot>
          )
          : null}
        {tab === 'bindings' ? (
          <div className="section">
            <p className="lede">Each control writes the same key that export JSON uses. Custom controls share this contract.</p>
            {parameters.filter(param=>!param.hidden).map((param) => (
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
                <p className="lede">Capture a reference before you experiment. Snapshots stay in this browser after reload.</p>
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
                        <input className="snapshot-name" aria-label={`Rename ${item.name}`} defaultValue={item.name} key={item.name}
                          onBlur={event => session.renameSnapshot(item.id, event.target.value)}
                          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = item.name; event.currentTarget.blur() } }} />
                        <p className="field__hint">{snapshotStamp(item.createdAt)}</p>
                      </div>
                      <div className="snapshot-actions">
                        {active ? <span className="snapshot-row__state">Reference</span> : null}
                        <button type="button" className="btn btn--quiet btn--sm" onClick={() => session.restoreSnapshot(item.id)}>Restore</button>
                        <button type="button" className="btn btn--quiet btn--sm" aria-label={`Remove ${item.name}`} onClick={() => session.removeSnapshot(item.id)}>Remove</button>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        ) : null}
        {tab === 'history' ? (
          <div className="history-panel">
            <p className="lede">Return to any step. Dragging is one step; playback is not recorded. The last 100 actions are kept for this session.</p>
            <ol className="history-list">
              {session.history().labels.map((label, index) => (
                <li key={index}><button type="button" aria-current={session.history().index === index ? 'step' : undefined}
                  className="history-step" data-future={index > session.history().index}
                  onClick={() => session.goToHistory(index)}><span>{index}</span><span>{label}</span>{session.history().index === index ? <span>Current</span> : null}</button></li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
      {tab === 'controls' ? (
        <p className="inspector__hint" aria-live="polite">
          Shift + drag for fine adjustment. Esc restores the previous value.
        </p>
      ) : null}
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
  defaultOpen,
}: {
  label: string
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  defaults: Record<string, ParamValue>
  session: RigSession
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen ?? true)
  const sectionId = useId()
  const animated = parameters.filter((param) => session.trackFor(param.id)).length
  const dirtyIds = parameters
    .filter((param) => session.isParamModified(param.id))
    .map((param) => param.id)
  const sectionItems: ContextMenuItem[] = [
    {
      label: 'Reset section',
      icon: <IconResetSection />,
      disabled: dirtyIds.length === 0,
      onSelect: () => session.resetParams(dirtyIds),
    },
  ]
  return (
    <section className="section" data-open={open}>
      <ContextTarget items={sectionItems} label={`${label} actions`}>
        <div className="section__head">
          <button type="button" className="section__title" aria-expanded={open} aria-controls={sectionId} onClick={() => setOpen((v) => !v)}>
            {label}
            <IconChevron />
          </button>
        </div>
      </ContextTarget>
      <div className="section__panel" id={sectionId} inert={!open} aria-hidden={!open}>
        <div>
          {parameters.map((param) => (
            <Control
              key={param.id}
              param={param}
              value={values[param.id] as ParamValue}
              defaultValue={defaults[param.id] as ParamValue}
              session={session}
              sectionDirtyIds={dirtyIds}
              sectionHasNeighbors={parameters.length > 1}
              onResetSection={() => session.resetParams(dirtyIds)}
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
  session,
  sectionDirtyIds,
  sectionHasNeighbors,
  onResetSection,
}: {
  param: ParameterDef
  value: ParamValue
  defaultValue: ParamValue
  session: RigSession
  sectionDirtyIds: string[]
  sectionHasNeighbors: boolean
  onResetSection: () => void
}) {
  const resetDisabled = !session.isParamModified(param.id)
  const reset = () => session.resetParam(param.id)
  const items: ContextMenuItem[] = [
    { label: `Reset ${param.label}`, icon: <IconReset />, disabled: resetDisabled, onSelect: reset },
  ]
  if (param.kind === 'number' && !param.readOnly && !param.role) items.push({ label: `Add ${param.label} keyframe`, onSelect: () => session.addKeyframe(param.id) })
  if (sectionHasNeighbors) {
    items.push({
      label: 'Reset section',
      icon: <IconResetSection />,
      disabled: sectionDirtyIds.length === 0,
      onSelect: onResetSection,
    })
  }

  const field = <SessionParameterField param={param} session={session} value={value}/>
  const sourceController = param.kind === 'number' && !param.readOnly && !param.role
    ? <ValueSourceController label={param.label} target={param.id} value={session.sourceFor(param.id) ?? {mode:'local'}} sources={session.parameters.filter(candidate => candidate.kind === 'number' && !candidate.readOnly && !candidate.role).map(candidate => ({id:candidate.id,label:candidate.label}))} animated={Boolean(session.trackFor(param.id))} min={param.min} max={param.max} onChange={source => session.setValueSource(param.id,source)} forceExpanded/>
    : undefined

  return field ? <ContextTarget items={items} label={`${param.label} actions`} controller={sourceController}>{field}</ContextTarget> : null
}

function SessionParameterField({param,session,value}:{param:ParameterDef;session:RigSession;value:ParamValue}) {
  usePlayhead(session)
  const shown=param.kind==='number'?session.liveNumber(param.id):value
  const error=session.driverErrors()[param.id]
  return <><ParameterField param={param.kind==='number'&&param.role==='playhead'?{...param,max:session.durationTime()}:param} value={shown} onChange={next=>session.setValue(param.id,next)}
    onAction={id=>session.runAction(id)} onPreset={(id,next)=>session.applyPreset(id,next)}
    resolveNumber={id=>{const v=session.viewValues()[id];if(typeof v!=='number')throw new Error(`Not a numeric parameter: ${id}`);return v}}
    parameters={session.parameters} animated={id=>Boolean(session.trackFor(id))}
    onGestureStart={()=>session.beginGesture(`Adjust ${param.label}`)} onGestureEnd={()=>session.endGesture()} onGestureCancel={()=>session.cancelGesture()}/>
    {error?<p className="field__error" role="alert">{error}</p>:null}</>
}
