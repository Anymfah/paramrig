import { useId, useRef, useState, type ReactNode } from 'react'
import type { HistoryStep } from '@/editor/history'
import { sceneIcon } from '@/scene/iconRegistry'
import { DataPanel } from '@/scene/panels/DataPanel'
import { HistoryPanel } from '@/scene/panels/HistoryPanel'
import { ObjectPanel } from '@/scene/panels/ObjectPanel'
import { ScenePanel } from '@/scene/panels/ScenePanel'
import { WorldPanel } from '@/scene/panels/WorldPanel'
import { PROPERTIES_TABS, type PropertiesTab } from '@/scene/prefs'
import type { SceneDocument, SceneObject, SceneSelection, SceneVersion } from '@/scene/types'
import { IconButton } from '@/ui/Button'
import { IconChevron, IconLock, IconUnlock } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { Tooltip } from '@/ui/Tooltip'

/**
 * The properties editor: Blender's right-hand panel, with its vertical strip of icon tabs.
 *
 * The panel draws what is selected and calls back; it holds no document state of its own, so a
 * test can render it with three lines of setup. The tabs are icons rather than words because
 * there are eight of them and the panel is narrow — which is exactly why Blender does the same.
 */

const TAB_NAMES: Record<PropertiesTab, string> = {
  scene: 'Scene',
  world: 'World',
  object: 'Object',
  modifiers: 'Modifiers',
  material: 'Material',
  data: 'Data',
  controls: 'Controls',
  history: 'History',
}

export function SceneProperties({
  document,
  selection,
  selectedObjects,
  activeObject,
  tab,
  onTab,
  onUpdateObject,
  onUpdateObjects,
  onEditDocument,
  onGestureStart,
  onGestureEnd,
  isOpen,
  onSection,
  history,
}: {
  document: SceneDocument
  selection: SceneSelection
  selectedObjects: SceneObject[]
  activeObject: SceneObject | null
  tab: PropertiesTab
  onTab: (tab: PropertiesTab) => void
  onUpdateObject: (id: string, patch: Partial<SceneObject>, label?: string) => void
  onUpdateObjects: (patches: Array<{ id: string; patch: Partial<SceneObject> }>, label?: string) => void
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  /** Section fold state, remembered per person rather than per document. */
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
  history: {
    steps: HistoryStep[]
    index: number
    onGoTo: (index: number) => void
    versions: SceneVersion[]
    onRestoreVersion: (id: string) => void
    onDeleteVersion: (id: string) => void
    onSaveVersion: (name: string) => void
  }
}) {
  const tabs = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const folds = { isOpen, onSection }
  const gesture = { onGestureStart, onGestureEnd }
  const unit = lengthUnit(document)

  // The selection carries the order things were picked in; the panel only needs how many.
  void selection

  const moveTab = (from: PropertiesTab, step: number) => {
    const index = PROPERTIES_TABS.indexOf(from)
    const next = PROPERTIES_TABS[(index + step + PROPERTIES_TABS.length) % PROPERTIES_TABS.length]
    if (!next) return
    onTab(next)
    // The tab strip is a roving group: the arrows move the selection and the focus together.
    queueMicrotask(() => tabs.current?.querySelector<HTMLElement>(`#scene-tab-${next}`)?.focus())
  }

  return (
    <aside className="inspector scene-properties" aria-label="Properties">
      <div
        className="scene-properties__tabs"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Properties"
        ref={tabs}
      >
        {PROPERTIES_TABS.map((id) => {
          const Glyph = sceneIcon(`tab-${id}`)
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`scene-tab-${id}`}
              className="scene-properties__tab"
              aria-label={TAB_NAMES[id]}
              aria-selected={tab === id}
              aria-controls={panelId}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => onTab(id)}
              onKeyDown={(event) => {
                const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
                if (!step) return
                event.preventDefault()
                moveTab(id, step)
              }}
            >
              {/* The tooltip sits inside the button so that the tab list owns its tabs directly. */}
              <Tooltip content={TAB_NAMES[id]} side="left">
                <span className="scene-properties__glyph">{Glyph ? <Glyph /> : null}</span>
              </Tooltip>
            </button>
          )
        })}
      </div>
      <div
        className="scene-properties__body scroll-area"
        role="tabpanel"
        id={panelId}
        aria-labelledby={`scene-tab-${tab}`}
      >
        {tab === 'scene' ? <ScenePanel document={document} unit={unit} onEditDocument={onEditDocument} {...gesture} {...folds} /> : null}
        {tab === 'world' ? <WorldPanel world={document.world} onEditDocument={onEditDocument} {...gesture} {...folds} /> : null}
        {tab === 'object' ? (
          <ObjectPanel
            document={document}
            selectedObjects={selectedObjects}
            activeObject={activeObject}
            unit={unit}
            onUpdateObject={onUpdateObject}
            onUpdateObjects={onUpdateObjects}
            {...gesture}
            {...folds}
          />
        ) : null}
        {tab === 'modifiers' ? (
          <div className="scene-properties__notice">
            <SceneEmpty>No modifiers. They arrive with the modifier prompt.</SceneEmpty>
          </div>
        ) : null}
        {tab === 'material' ? (
          <div className="scene-properties__notice">
            <SceneEmpty>No materials. They arrive with the material prompt.</SceneEmpty>
          </div>
        ) : null}
        {tab === 'data' ? (
          <DataPanel
            document={document}
            activeObject={activeObject}
            unit={unit}
            onUpdateObject={onUpdateObject}
            {...gesture}
            {...folds}
          />
        ) : null}
        {tab === 'controls' ? (
          <div className="scene-properties__notice">
            <SceneEmpty>No controls yet. Controls arrive with the rig prompt, where a parameter is bound to a property of the scene.</SceneEmpty>
          </div>
        ) : null}
        {tab === 'history' ? (
          <HistoryPanel
            steps={history.steps}
            index={history.index}
            onGoTo={history.onGoTo}
            versions={history.versions}
            onRestoreVersion={history.onRestoreVersion}
            onDeleteVersion={history.onDeleteVersion}
            onSaveVersion={history.onSaveVersion}
            {...folds}
          />
        ) : null}
      </div>
    </aside>
  )
}

/**
 * The one section header of the properties editor: a chevron, a title and whatever it counts.
 *
 * It lives here rather than in a panel because every panel is built from it, and because the fold
 * state belongs to the person rather than to the document — which is why it is handed down as a
 * pair of callbacks instead of being read from storage by the section itself.
 */
export function SceneSection({ id, title, meta, isOpen, onSection, children }: {
  id: string
  title: string
  meta?: ReactNode
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
  children: ReactNode
}) {
  const open = isOpen(id)
  const panelId = useId()
  return (
    <section className="scene-section" data-open={open} data-section={id} aria-label={title}>
      <div className="scene-section__head">
        <button
          type="button"
          className="scene-section__title"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onSection(id, !open)}
        >
          <IconChevron />
          <span>{title}</span>
        </button>
        {meta ? <span className="scene-section__meta">{meta}</span> : null}
      </div>
      <div className="scene-section__panel" id={panelId} inert={!open} aria-hidden={!open}>
        <div className="scene-section__body">{children}</div>
      </div>
    </section>
  )
}

/**
 * A fold inside a section, for the rows that are worth having and rarely wanted.
 *
 * It keeps its own state: the fold store the panel is given lists what a person collapsed, so a
 * section it has never seen reads as open, and there is no way to say "closed until asked for".
 */
export function SceneFold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className="scene-fold" data-open={open}>
      <button type="button" className="scene-fold__head" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <IconChevron />
        <span>{title}</span>
      </button>
      <div className="scene-fold__panel" id={panelId} inert={!open} aria-hidden={!open}>
        {children}
      </div>
    </div>
  )
}

/**
 * The suffix a length field shows.
 *
 * Only the metric system names a stored unit without converting the number as well: printing "ft"
 * against a value in metres would be a lie, so an imperial or unitless document goes without a
 * suffix until the conversions are written.
 */
function lengthUnit(document: SceneDocument): string | undefined {
  return document.units.system === 'metric' ? 'm' : undefined
}

/** What a section says when it holds nothing: what it is for, and what will fill it. */
export function SceneEmpty({ children }: { children: ReactNode }) {
  return <p className="scene-empty">{children}</p>
}

const AXIS_NAMES = ['X', 'Y', 'Z'] as const

/**
 * One transform channel: three fields side by side under the name of what they move.
 *
 * A value of `null` means the selected objects disagree, which is what puts the field in its
 * "Mixed" state; typing into it then writes the same number to all of them. The padlock is
 * Blender's: it greys the field out so a stray scrub cannot move that axis.
 */
export function SceneAxes({ label, unit, min, max, step, values, disabled, locks, onLock, onChange, onGestureStart, onGestureEnd }: {
  label: string
  unit?: string
  min: number
  max: number
  step: number
  /** One value per axis; `null` where the selection disagrees. */
  values: Array<number | null>
  /** Axes that cannot be edited at all, whatever the padlock says. */
  disabled?: boolean[]
  locks?: boolean[]
  onLock?: (axis: number, locked: boolean) => void
  onChange: (axis: number, value: number) => void
  onGestureStart: () => void
  onGestureEnd: () => void
}) {
  const labelId = useId()
  return (
    <div className="scene-axes" role="group" aria-labelledby={labelId}>
      <span className="scene-axes__label" id={labelId}>{label}</span>
      <div className="scene-axes__fields">
        {AXIS_NAMES.map((axis, index) => {
          const value = values[index] ?? null
          const locked = locks?.[index] ?? false
          return (
            <NumberField
              key={axis}
              label={axis}
              value={value ?? 0}
              mixed={value === null}
              min={min}
              max={max}
              step={step}
              unit={unit}
              variant="field"
              disabled={locked || (disabled?.[index] ?? false)}
              onChange={(next) => onChange(index, next)}
              onGestureStart={onGestureStart}
              onGestureEnd={onGestureEnd}
              trailing={onLock ? (
                <Tooltip content={locked ? `Unlock ${label.toLowerCase()} ${axis}` : `Lock ${label.toLowerCase()} ${axis}`}>
                  <IconButton
                    label={`Lock ${label.toLowerCase()} ${axis}`}
                    aria-pressed={locked}
                    onClick={() => onLock(index, !locked)}
                  >
                    {locked ? <IconLock /> : <IconUnlock />}
                  </IconButton>
                </Tooltip>
              ) : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}
