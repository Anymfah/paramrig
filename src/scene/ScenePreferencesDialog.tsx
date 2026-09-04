import { useMemo, useState } from 'react'
import { EditorModal } from '@/editor/EditorModal'
import { describeKeymap } from '@/scene/keymap'
import { DEFAULT_PREFERENCES, type ScenePreferences } from '@/scene/prefs'
import { MATCAPS, MATCAP_LABELS } from '@/scene/viewport/matcap'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'

/**
 * Edit · Preferences: how this person works, kept apart from what any document contains.
 *
 * The sections are Blender's, in Blender's order, so somebody arriving from it knows where to look
 * — and every setting here is one the editor actually reads. A preference that changed nothing
 * would be worse than a missing one: it would look like a promise.
 *
 * The keymap section is a reader rather than an editor. Rebinding is a chantier of its own; what
 * this offers is the whole table, searchable, generated from the keymap itself so it cannot drift,
 * with the two preferences that change what the table says sitting above it.
 */

const TABS = ['navigation', 'input', 'editing', 'interface', 'themes', 'keymap'] as const

type Tab = typeof TABS[number]

const TAB_LABELS: Record<Tab, string> = {
  navigation: 'Navigation',
  input: 'Input',
  editing: 'Editing',
  interface: 'Interface',
  themes: 'Themes',
  keymap: 'Keymap',
}

export function ScenePreferencesDialog({ open, onClose, preferences, onChange }: {
  open: boolean
  onClose: () => void
  preferences: ScenePreferences
  onChange: (patch: Partial<ScenePreferences>) => void
}) {
  const [tab, setTab] = useState<Tab>('navigation')
  return (
    <EditorModal prefix="scene" label="Preferences" open={open} onClose={onClose}>
      <div className="scene-prefs">
        <div className="scene-prefs__tabs" role="tablist" aria-label="Preferences" aria-orientation="vertical">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="scene-prefs__tab"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </div>
        <div className="scene-prefs__panel scroll-area" role="tabpanel" aria-label={TAB_LABELS[tab]}>
          {tab === 'navigation' ? <Navigation preferences={preferences} onChange={onChange} /> : null}
          {tab === 'input' ? <Input preferences={preferences} onChange={onChange} /> : null}
          {tab === 'editing' ? <Editing preferences={preferences} onChange={onChange} /> : null}
          {tab === 'interface' ? <Interface preferences={preferences} onChange={onChange} /> : null}
          {tab === 'themes' ? <Themes preferences={preferences} onChange={onChange} /> : null}
          {tab === 'keymap' ? <Keymap preferences={preferences} onChange={onChange} /> : null}
        </div>
      </div>
    </EditorModal>
  )
}

type Section = {
  preferences: ScenePreferences
  onChange: (patch: Partial<ScenePreferences>) => void
}

function Navigation({ preferences, onChange }: Section) {
  return (
    <>
      <SelectField
        label="Orbit method"
        value={preferences.orbitStyle}
        defaultValue={DEFAULT_PREFERENCES.orbitStyle}
        options={[{ value: 'turntable', label: 'Turntable' }, { value: 'trackball', label: 'Trackball' }]}
        onChange={(value) => onChange({ orbitStyle: value as ScenePreferences['orbitStyle'] })}
      />
      <SwitchField
        label="Orbit around selection"
        checked={preferences.orbitAroundSelection}
        defaultValue={DEFAULT_PREFERENCES.orbitAroundSelection}
        onChange={(value) => onChange({ orbitAroundSelection: value })}
      />
      <SwitchField
        label="Auto perspective"
        checked={preferences.autoPerspective}
        defaultValue={DEFAULT_PREFERENCES.autoPerspective}
        onChange={(value) => onChange({ autoPerspective: value })}
      />
      <SwitchField
        label="Zoom to mouse position"
        checked={preferences.zoomToMouse}
        defaultValue={DEFAULT_PREFERENCES.zoomToMouse}
        onChange={(value) => onChange({ zoomToMouse: value })}
      />
      <NumberField
        label="Smooth view"
        unit="ms"
        value={preferences.smoothViewMs}
        defaultValue={DEFAULT_PREFERENCES.smoothViewMs}
        min={0}
        max={1000}
        step={10}
        variant="field"
        onChange={(value) => onChange({ smoothViewMs: value })}
      />
      <SwitchField
        label="Emulate 3 button mouse"
        checked={preferences.emulateThreeButton}
        defaultValue={DEFAULT_PREFERENCES.emulateThreeButton}
        onChange={(value) => onChange({ emulateThreeButton: value })}
      />
      <SwitchField
        label="Emulate numpad"
        checked={preferences.numpadEmulation}
        defaultValue={DEFAULT_PREFERENCES.numpadEmulation}
        onChange={(value) => onChange({ numpadEmulation: value })}
      />
    </>
  )
}

function Input({ preferences, onChange }: Section) {
  return (
    <>
      <SelectField
        label="Select with"
        value={preferences.rightClickSelect ? 'right' : 'left'}
        options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]}
        onChange={(value) => onChange({ rightClickSelect: value === 'right' })}
      />
      <SwitchField
        label="Invert zoom wheel"
        checked={preferences.invertZoomWheel}
        defaultValue={DEFAULT_PREFERENCES.invertZoomWheel}
        onChange={(value) => onChange({ invertZoomWheel: value })}
      />
      <SwitchField
        label="Trackpad natural scroll"
        checked={preferences.trackpadNatural}
        defaultValue={DEFAULT_PREFERENCES.trackpadNatural}
        onChange={(value) => onChange({ trackpadNatural: value })}
      />
      <SwitchField
        label="Clicking nothing deselects"
        checked={preferences.deselectOnEmptyClick}
        defaultValue={DEFAULT_PREFERENCES.deselectOnEmptyClick}
        onChange={(value) => onChange({ deselectOnEmptyClick: value })}
      />
    </>
  )
}

function Editing({ preferences, onChange }: Section) {
  return (
    <>
      <NumberField
        label="Undo steps"
        value={preferences.undoSteps}
        defaultValue={DEFAULT_PREFERENCES.undoSteps}
        min={8}
        max={256}
        step={1}
        variant="field"
        onChange={(value) => onChange({ undoSteps: Math.round(value) })}
      />
      <SwitchField
        label="Cancel removes an extrusion"
        checked={preferences.cancelRemovesExtrusion}
        defaultValue={DEFAULT_PREFERENCES.cancelRemovesExtrusion}
        onChange={(value) => onChange({ cancelRemovesExtrusion: value })}
      />
      <NumberField
        label="Auto merge distance"
        unit="m"
        value={preferences.autoMergeDistance}
        defaultValue={DEFAULT_PREFERENCES.autoMergeDistance}
        min={0}
        max={1}
        step={0.001}
        variant="field"
        onChange={(value) => onChange({ autoMergeDistance: value })}
      />
    </>
  )
}

function Interface({ preferences, onChange }: Section) {
  return (
    <>
      <NumberField
        label="Resolution scale"
        value={preferences.resolutionScale}
        defaultValue={DEFAULT_PREFERENCES.resolutionScale}
        min={0.5}
        max={2}
        step={0.05}
        variant="field"
        onChange={(value) => onChange({ resolutionScale: value })}
      />
      <NumberField
        label="Tooltip delay"
        unit="ms"
        value={preferences.tooltipDelayMs}
        defaultValue={DEFAULT_PREFERENCES.tooltipDelayMs}
        min={0}
        max={2000}
        step={50}
        variant="field"
        onChange={(value) => onChange({ tooltipDelayMs: Math.round(value) })}
      />
      <SwitchField
        label="Animate pie menus"
        checked={preferences.pieAnimation}
        defaultValue={DEFAULT_PREFERENCES.pieAnimation}
        onChange={(value) => onChange({ pieAnimation: value })}
      />
    </>
  )
}

function Themes({ preferences, onChange }: Section) {
  return (
    <>
      <SelectField
        label="Selection colours"
        value={preferences.theme}
        defaultValue={DEFAULT_PREFERENCES.theme}
        options={[
          { value: 'paramrig', label: 'ParamRig' },
          { value: 'blender-classic', label: 'Blender classic' },
          { value: 'high-contrast', label: 'High contrast' },
        ]}
        onChange={(value) => onChange({ theme: value as ScenePreferences['theme'] })}
      />
      <SelectField
        label="Default matcap"
        value={preferences.matcap}
        defaultValue={DEFAULT_PREFERENCES.matcap}
        options={MATCAPS.map((name) => ({ value: name, label: MATCAP_LABELS[name] }))}
        onChange={(value) => onChange({ matcap: value })}
      />
    </>
  )
}

function Keymap({ preferences, onChange }: Section) {
  const [query, setQuery] = useState('')
  const sections = useMemo(() => describeKeymap(preferences), [preferences])
  const needle = query.trim().toLowerCase()
  const found = useMemo(() => sections.flatMap((section) => {
    const entries = needle
      ? section.entries.filter((entry) => (
        entry.label.toLowerCase().includes(needle) || entry.shortcut.toLowerCase().includes(needle)
      ))
      : section.entries
    return entries.length ? [{ ...section, entries }] : []
  }), [sections, needle])

  return (
    <>
      <SelectField
        label="Spacebar action"
        value={preferences.spacebarAction}
        defaultValue={DEFAULT_PREFERENCES.spacebarAction}
        options={[
          { value: 'play', label: 'Play' },
          { value: 'tools', label: 'Tools' },
          { value: 'search', label: 'Search' },
        ]}
        onChange={(value) => onChange({ spacebarAction: value as ScenePreferences['spacebarAction'] })}
      />
      <SwitchField
        label="Emulate numpad"
        checked={preferences.numpadEmulation}
        defaultValue={DEFAULT_PREFERENCES.numpadEmulation}
        onChange={(value) => onChange({ numpadEmulation: value })}
      />
      <input
        className="scene-prefs__search"
        value={query}
        placeholder="Search the keymap"
        aria-label="Search the keymap"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
      />
      {found.length === 0 ? <p className="scene-prefs__empty">No shortcut matches that.</p> : null}
      {found.map((section) => (
        <section key={section.id} className="scene-prefs__keys">
          <h3>{section.title}</h3>
          <ul>
            {section.entries.map((entry) => (
              <li key={`${entry.shortcut}-${entry.label}-${entry.mode ?? ''}`}>
                <kbd>{entry.shortcut}</kbd>
                <span>{entry.label}</span>
                {entry.mode ? <span className="scene-prefs__mode">{entry.mode}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
