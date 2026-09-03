import { useId, useMemo, useRef, useState } from 'react'
import { bindingFor, shortcutLabel } from '@/scene/keymap'
import { objectBounds } from '@/scene/objects'
import type {
  SceneDocument,
  SceneObject,
  SceneSelection,
  SceneTool,
  SceneUnits,
  Transform,
  Vec3,
  ViewState,
} from '@/scene/types'
import { IconButton } from '@/ui/Button'
import { IconClose, IconLock, IconUnlock } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'
import { Tooltip } from '@/ui/Tooltip'
import { useRovingFocus } from '@/ui/useRovingFocus'

/**
 * The N sidebar: where the active object is, what the active tool will do with it, and how the
 * viewport is looking at the scene.
 *
 * It floats over the right of the viewport rather than sitting beside it, because opening a panel
 * must never resize the thing being modelled — a viewport that reflows on N would move the object
 * out from under the pointer. The panel therefore takes only the values it draws and the callbacks
 * it calls, and never the editor itself, so a test can mount it with three lines of setup.
 */

export type SidebarTab = 'item' | 'tool' | 'view'

/**
 * How the next box, circle or lasso combines with what is already selected.
 *
 * Blender keeps this on the tool. `ViewState` has no room for it yet and `src/scene/types.ts` is
 * not this module's to change, so the panel holds it until the selection tools land and can own it.
 */
export type SelectionMode = 'new' | 'extend' | 'subtract' | 'invert' | 'intersect'

type VectorChannel = 'position' | 'rotation' | 'scale'
type AxisIndex = 0 | 1 | 2
type AxisLocks = Record<VectorChannel, [boolean, boolean, boolean]>

const AXES = ['X', 'Y', 'Z'] as const
const AXIS_INDEXES: AxisIndex[] = [0, 1, 2]
const EULER_ORDERS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'] as const

/** Wide enough that no scene reaches the end of a field, tight enough that a typo stays readable. */
const FAR = 1e6
const LENGTH_STEP = 0.01
const ANGLE_STEP = 1

const TABS: Array<{ id: SidebarTab; label: string }> = [
  { id: 'item', label: 'Item' },
  { id: 'tool', label: 'Tool' },
  { id: 'view', label: 'View' },
]

const SELECTION_MODES: Array<{ value: SelectionMode; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'extend', label: 'Extend' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'invert', label: 'Invert' },
  { value: 'intersect', label: 'Intersect' },
]

const ORIENTATIONS: Array<{ value: ViewState['orientation']; label: string }> = [
  { value: 'global', label: 'Global' },
  { value: 'local', label: 'Local' },
  { value: 'normal', label: 'Normal' },
  { value: 'gimbal', label: 'Gimbal' },
  { value: 'view', label: 'View' },
  { value: 'cursor', label: 'Cursor' },
]

const PIVOTS: Array<{ value: ViewState['pivot']; label: string }> = [
  { value: 'bounding-box', label: 'Bounding box centre' },
  { value: 'cursor', label: '3D cursor' },
  { value: 'individual', label: 'Individual origins' },
  { value: 'median', label: 'Median point' },
  { value: 'active', label: 'Active element' },
]

const SNAP_MODES: Array<{ value: ViewState['snapMode']; label: string }> = [
  { value: 'increment', label: 'Increment' },
  { value: 'vertex', label: 'Vertex' },
  { value: 'edge', label: 'Edge' },
  { value: 'face', label: 'Face' },
  { value: 'volume', label: 'Volume' },
  { value: 'edge-center', label: 'Edge centre' },
  { value: 'edge-perpendicular', label: 'Edge perpendicular' },
]

const SNAP_TARGETS: Array<{ value: ViewState['snapTarget']; label: string }> = [
  { value: 'closest', label: 'Closest' },
  { value: 'center', label: 'Centre' },
  { value: 'median', label: 'Median' },
  { value: 'active', label: 'Active' },
]

const FALLOFFS: Array<{ value: ViewState['proportionalFalloff']; label: string }> = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'root', label: 'Root' },
  { value: 'inverse-square', label: 'Inverse square' },
  { value: 'sharp', label: 'Sharp' },
  { value: 'linear', label: 'Linear' },
  { value: 'constant', label: 'Constant' },
  { value: 'random', label: 'Random' },
]

/** A tool's name, derived from its id so the sidebar and the T bar cannot drift apart. */
function toolLabel(tool: SceneTool): string {
  const words = tool.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The suffix a length carries. A metric document stores metres, so the unit is the truth; an
 * imperial one would need a conversion no module here performs, and a wrong unit is worse than
 * none.
 */
function lengthUnit(units: SceneUnits): string | undefined {
  return units.system === 'metric' ? 'm' : undefined
}

function rotationMode(value: string): Transform['rotationMode'] {
  const order = EULER_ORDERS.find((entry) => entry === value)
  if (order) return order
  return value === 'quaternion' ? 'quaternion' : 'XYZ'
}

function selectionMode(value: string): SelectionMode {
  return SELECTION_MODES.find((entry) => entry.value === value)?.value ?? 'new'
}

/** A list value read back off a select, without a cast that could paper over a renamed option. */
function optionValue<Value extends string>(options: Array<{ value: Value }>, raw: string, fallback: Value): Value {
  return options.find((option) => option.value === raw)?.value ?? fallback
}

/**
 * The size of an object's own box, its scale included but its rotation and its parents left out.
 *
 * `objectBounds` answers in world space, which is right for framing and wrong here: the world box
 * of a turned cube is bigger than the cube, so a dimension read from it would change every time the
 * object rotated. Measuring a probe that keeps the scale and drops the rest gives the number
 * Blender shows, and holds it still while the object turns.
 */
function objectDimensions(document: SceneDocument, object: SceneObject): Vec3 {
  const probe: SceneObject = {
    ...object,
    parentId: undefined,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: object.transform.scale },
  }
  const box = objectBounds({ ...document, objects: [probe] }, probe)
  if (!box) return [0, 0, 0]
  return [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]]
}

/** Whether the selected objects disagree about one number, which is what a field says "Mixed" for. */
function disagree(objects: SceneObject[], read: (object: SceneObject) => number): boolean {
  if (objects.length < 2) return false
  const first = read(objects[0]!)
  return objects.some((object) => Math.abs(read(object) - first) > 1e-6)
}

export function SceneSidebar({
  open,
  tab,
  onTab,
  onClose,
  document,
  selection,
  activeObject,
  selectedObjects,
  onUpdateObject,
  onEditDocument,
  onView,
  onGestureStart,
  onGestureEnd,
}: {
  open: boolean
  tab: SidebarTab
  onTab: (tab: SidebarTab) => void
  onClose: () => void
  document: SceneDocument
  selection: SceneSelection
  activeObject: SceneObject | null
  selectedObjects: SceneObject[]
  onUpdateObject: (id: string, patch: Partial<SceneObject>, label?: string) => void
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onView: (patch: Partial<ViewState>) => void
  onGestureStart: () => void
  onGestureEnd: () => void
}) {
  const panelId = useId()
  // These three are settings the document model has no field for yet; see SelectionMode above.
  const [locks, setLocks] = useState<AxisLocks>(() => ({
    position: [false, false, false],
    rotation: [false, false, false],
    scale: [false, false, false],
  }))
  const [mode, setMode] = useState<SelectionMode>('new')
  const [cameraLocked, setCameraLocked] = useState(false)

  if (!open) return null

  const binding = bindingFor('panel.sidebar')
  // Written out rather than keyed by a computed name: a union key would widen the record away.
  const toggleLock = (channel: VectorChannel, axis: AxisIndex) => {
    setLocks((current) => {
      const next: [boolean, boolean, boolean] = [...current[channel]]
      next[axis] = !next[axis]
      if (channel === 'position') return { ...current, position: next }
      if (channel === 'rotation') return { ...current, rotation: next }
      return { ...current, scale: next }
    })
  }

  return (
    <aside className="scene-sidebar" aria-label="Sidebar">
      <div className="scene-sidebar__head">
        <SidebarTabs tab={tab} onTab={onTab} panelId={panelId} />
        <Tooltip content={binding ? `Close sidebar · ${shortcutLabel(binding)}` : 'Close sidebar'}>
          <IconButton label="Close sidebar" onClick={onClose}>
            <IconClose />
          </IconButton>
        </Tooltip>
      </div>
      <div
        className="scene-sidebar__body scroll-area"
        role="tabpanel"
        id={`${panelId}-panel-${tab}`}
        aria-labelledby={`${panelId}-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'item' ? (
          <ItemTab
            document={document}
            selection={selection}
            activeObject={activeObject}
            selectedObjects={selectedObjects}
            locks={locks}
            onLock={toggleLock}
            onUpdateObject={onUpdateObject}
            onEditDocument={onEditDocument}
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
          />
        ) : null}
        {tab === 'tool' ? (
          <ToolTab
            view={document.view}
            mode={mode}
            onMode={setMode}
            onView={onView}
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
          />
        ) : null}
        {tab === 'view' ? (
          <ViewTab
            document={document}
            cameraLocked={cameraLocked}
            onCameraLocked={setCameraLocked}
            onView={onView}
            onEditDocument={onEditDocument}
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
          />
        ) : null}
      </div>
    </aside>
  )
}

/**
 * The tabs are their own component so that the roving tabindex is set up the moment the panel
 * opens: the hook reads the element once, on mount, and a panel that only returned null would
 * never give it one.
 */
function SidebarTabs({ tab, onTab, panelId }: { tab: SidebarTab; onTab: (tab: SidebarTab) => void; panelId: string }) {
  const tabs = useRef<HTMLDivElement>(null)
  useRovingFocus(tabs)
  return (
    <div className="scene-sidebar__tabs" role="tablist" aria-label="Sidebar tabs" ref={tabs}>
      {TABS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          id={`${panelId}-tab-${entry.id}`}
          className="scene-sidebar__tab"
          aria-selected={entry.id === tab}
          // Only the open tab names a panel: the other two have none on the page to point at.
          aria-controls={entry.id === tab ? `${panelId}-panel-${entry.id}` : undefined}
          onClick={() => onTab(entry.id)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------- item */

function ItemTab({
  document,
  selection,
  activeObject,
  selectedObjects,
  locks,
  onLock,
  onUpdateObject,
  onEditDocument,
  onGestureStart,
  onGestureEnd,
}: {
  document: SceneDocument
  selection: SceneSelection
  activeObject: SceneObject | null
  selectedObjects: SceneObject[]
  locks: AxisLocks
  onLock: (channel: VectorChannel, axis: AxisIndex) => void
  onUpdateObject: (id: string, patch: Partial<SceneObject>, label?: string) => void
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onGestureStart: () => void
  onGestureEnd: () => void
}) {
  const targets = useMemo(
    () => (selectedObjects.length > 0 ? selectedObjects : activeObject ? [activeObject] : []),
    [selectedObjects, activeObject],
  )
  const dimensions = useMemo(() => {
    const sizes = new Map<string, Vec3>()
    for (const object of targets) sizes.set(object.id, objectDimensions(document, object))
    return sizes
  }, [document, targets])

  if (!activeObject) {
    return <p className="scene-sidebar__empty">Nothing is active. Select an object to see where it is.</p>
  }

  const unit = lengthUnit(document.units)
  const transform = activeObject.transform
  const quaternionRotation = transform.rotationMode === 'quaternion'
  const size = dimensions.get(activeObject.id) ?? [0, 0, 0]

  /**
   * One field, one history entry, however many objects are selected: a single object goes through
   * `onUpdateObject`, and several go through one document edit rather than one entry each.
   */
  const write = (label: string, next: (object: SceneObject, source: SceneDocument) => Transform) => {
    if (targets.length === 1) {
      const only = targets[0]!
      onUpdateObject(only.id, { transform: next(only, document) }, label)
      return
    }
    const ids = new Set(targets.map((object) => object.id))
    onEditDocument(
      (current) => ({
        ...current,
        objects: current.objects.map((object) => (ids.has(object.id) ? { ...object, transform: next(object, current) } : object)),
      }),
      label,
    )
  }

  const setAxis = (channel: VectorChannel, label: string, axis: AxisIndex, value: number) => {
    write(label, (object) => {
      const vector: Vec3 = [...object.transform[channel]]
      vector[axis] = value
      if (channel === 'position') return { ...object.transform, position: vector }
      if (channel === 'rotation') return { ...object.transform, rotation: vector }
      return { ...object.transform, scale: vector }
    })
  }

  const setDimension = (axis: AxisIndex, value: number) => {
    write('Dimensions', (object, source) => {
      const own = objectDimensions(source, object)
      const scale: Vec3 = [...object.transform.scale]
      // A flat axis — the thickness of a plane — has no size to scale, so the field leaves it alone.
      if (own[axis] > 1e-9) scale[axis] = (scale[axis] * value) / own[axis]
      return { ...object.transform, scale }
    })
  }

  return (
    <>
      <p className="scene-sidebar__title">{activeObject.name}</p>
      {selection.objectIds.length > 1 ? (
        <p className="scene-sidebar__note">
          {selection.objectIds.length} objects selected. A field they disagree on reads “Mixed”, and a change applies to all
          of them.
        </p>
      ) : null}

      <AxisFields
        legend="Location"
        values={transform.position}
        mixed={AXIS_INDEXES.map((axis) => disagree(targets, (object) => object.transform.position[axis]))}
        locked={locks.position}
        min={-FAR}
        max={FAR}
        step={LENGTH_STEP}
        unit={unit}
        onValue={(axis, value) => setAxis('position', 'Location', axis, value)}
        onLock={(axis) => onLock('position', axis)}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />

      <SelectField
        label="Rotation mode"
        value={transform.rotationMode ?? 'XYZ'}
        options={[...EULER_ORDERS.map((order) => ({ value: order, label: `${order} Euler` })), { value: 'quaternion', label: 'Quaternion' }]}
        onChange={(next) => write('Rotation mode', (object) => ({ ...object.transform, rotationMode: rotationMode(next) }))}
      />

      {quaternionRotation ? (
        <QuaternionFields quaternion={transform.quaternion ?? [0, 0, 0, 1]} />
      ) : (
        <AxisFields
          legend="Rotation"
          values={transform.rotation}
          mixed={AXIS_INDEXES.map((axis) => disagree(targets, (object) => object.transform.rotation[axis]))}
          locked={locks.rotation}
          min={-FAR}
          max={FAR}
          step={ANGLE_STEP}
          unit="°"
          onValue={(axis, value) => setAxis('rotation', 'Rotation', axis, value)}
          onLock={(axis) => onLock('rotation', axis)}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
      )}

      <AxisFields
        legend="Scale"
        values={transform.scale}
        mixed={AXIS_INDEXES.map((axis) => disagree(targets, (object) => object.transform.scale[axis]))}
        locked={locks.scale}
        min={-FAR}
        max={FAR}
        step={LENGTH_STEP}
        onValue={(axis, value) => setAxis('scale', 'Scale', axis, value)}
        onLock={(axis) => onLock('scale', axis)}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />

      <AxisFields
        legend="Dimensions"
        values={size}
        mixed={AXIS_INDEXES.map((axis) => disagree(targets, (object) => (dimensions.get(object.id) ?? [0, 0, 0])[axis]))}
        // A dimension is the scale seen in metres, so a locked scale axis locks the dimension too.
        locked={locks.scale}
        min={0}
        max={FAR}
        step={LENGTH_STEP}
        unit={unit}
        onValue={setDimension}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />
    </>
  )
}

/**
 * A vector, one field per axis, each with the padlock that keeps a transform session and this panel
 * off that axis. The lock is a button rather than a checkbox because it sits inside the row and
 * carries a glyph, and `aria-pressed` says which way it is.
 */
function AxisFields({
  legend,
  values,
  mixed,
  locked,
  min,
  max,
  step,
  unit,
  onValue,
  onLock,
  onGestureStart,
  onGestureEnd,
}: {
  legend: string
  values: Vec3
  mixed: boolean[]
  locked: [boolean, boolean, boolean]
  min: number
  max: number
  step: number
  unit?: string
  onValue: (axis: AxisIndex, value: number) => void
  onLock?: (axis: AxisIndex) => void
  onGestureStart: () => void
  onGestureEnd: () => void
}) {
  return (
    <div className="scene-sidebar__vector" role="group" aria-label={legend}>
      <span className="scene-sidebar__legend">{legend}</span>
      {AXIS_INDEXES.map((axis) => (
        <div className="scene-sidebar__row" key={AXES[axis]}>
          <NumberField
            label={`${legend} ${AXES[axis]}`}
            variant="field"
            value={values[axis]}
            mixed={mixed[axis] ?? false}
            disabled={locked[axis]}
            min={min}
            max={max}
            step={step}
            unit={unit}
            onChange={(value) => onValue(axis, value)}
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
          />
          {onLock ? (
            <Tooltip content={locked[axis] ? `Unlock ${legend.toLowerCase()} ${AXES[axis]}` : `Lock ${legend.toLowerCase()} ${AXES[axis]}`}>
              <IconButton
                label={`Lock ${legend.toLowerCase()} ${AXES[axis]}`}
                className="scene-sidebar__lock"
                aria-pressed={locked[axis]}
                onClick={() => onLock(axis)}
              >
                {locked[axis] ? <IconLock /> : <IconUnlock />}
              </IconButton>
            </Tooltip>
          ) : (
            <span className="scene-sidebar__lock-spacer" aria-hidden="true" />
          )}
        </div>
      ))}
    </div>
  )
}

/** A quaternion is shown as it is stored: four numbers nobody types, which is why they are read-only. */
function QuaternionFields({ quaternion }: { quaternion: [number, number, number, number] }) {
  const [x, y, z, w] = quaternion
  const components: Array<[string, number]> = [['W', w], ['X', x], ['Y', y], ['Z', z]]
  return (
    <div className="scene-sidebar__vector" role="group" aria-label="Rotation">
      <span className="scene-sidebar__legend">Rotation</span>
      {components.map(([axis, value]) => (
        <div className="scene-sidebar__row" key={axis}>
          <NumberField
            label={`Rotation ${axis}`}
            variant="field"
            value={value}
            disabled
            min={-1}
            max={1}
            step={0.001}
            onChange={() => undefined}
          />
          <span className="scene-sidebar__lock-spacer" aria-hidden="true" />
        </div>
      ))}
      <p className="scene-sidebar__note">Switch to an Euler order to type angles.</p>
    </div>
  )
}

/* ------------------------------------------------------------------- tool */

function ToolTab({
  view,
  mode,
  onMode,
  onView,
  onGestureStart,
  onGestureEnd,
}: {
  view: ViewState
  mode: SelectionMode
  onMode: (mode: SelectionMode) => void
  onView: (patch: Partial<ViewState>) => void
  onGestureStart: () => void
  onGestureEnd: () => void
}) {
  return (
    <>
      <p className="scene-sidebar__title">{toolLabel(view.tool)}</p>

      <div className="scene-sidebar__section" role="group" aria-label="Selection">
        <span className="scene-sidebar__legend">Selection</span>
        <SelectField
          label="Mode"
          value={mode}
          options={SELECTION_MODES}
          onChange={(next) => onMode(selectionMode(next))}
        />
      </div>

      <div className="scene-sidebar__section" role="group" aria-label="Transform">
        <span className="scene-sidebar__legend">Transform</span>
        <SelectField
          label="Orientation"
          value={view.orientation}
          options={ORIENTATIONS}
          onChange={(next) => onView({ orientation: optionValue(ORIENTATIONS, next, 'global') })}
        />
        <SelectField
          label="Pivot point"
          value={view.pivot}
          options={PIVOTS}
          onChange={(next) => onView({ pivot: optionValue(PIVOTS, next, 'median') })}
        />
      </div>

      <div className="scene-sidebar__section" role="group" aria-label="Snapping">
        <span className="scene-sidebar__legend">Snapping</span>
        <SwitchField label="Snap" checked={view.snapEnabled} onChange={(next) => onView({ snapEnabled: next })} />
        <SelectField
          label="Snap to"
          value={view.snapMode}
          options={SNAP_MODES}
          disabled={!view.snapEnabled}
          onChange={(next) => onView({ snapMode: optionValue(SNAP_MODES, next, 'increment') })}
        />
        <SelectField
          label="Snap with"
          value={view.snapTarget}
          options={SNAP_TARGETS}
          disabled={!view.snapEnabled}
          onChange={(next) => onView({ snapTarget: optionValue(SNAP_TARGETS, next, 'closest') })}
        />
      </div>

      <div className="scene-sidebar__section" role="group" aria-label="Proportional editing">
        <span className="scene-sidebar__legend">Proportional editing</span>
        <SwitchField
          label="Proportional editing"
          checked={view.proportional}
          onChange={(next) => onView({ proportional: next })}
        />
        <SelectField
          label="Falloff"
          value={view.proportionalFalloff}
          options={FALLOFFS}
          disabled={!view.proportional}
          onChange={(next) => onView({ proportionalFalloff: optionValue(FALLOFFS, next, 'smooth') })}
        />
        <NumberField
          label="Size"
          variant="field"
          value={view.proportionalSize}
          min={0.001}
          max={1000}
          step={0.1}
          disabled={!view.proportional}
          onChange={(next) => onView({ proportionalSize: next })}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
      </div>
    </>
  )
}

/* ------------------------------------------------------------------- view */

function ViewTab({
  document,
  cameraLocked,
  onCameraLocked,
  onView,
  onEditDocument,
  onGestureStart,
  onGestureEnd,
}: {
  document: SceneDocument
  cameraLocked: boolean
  onCameraLocked: (locked: boolean) => void
  onView: (patch: Partial<ViewState>) => void
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onGestureStart: () => void
  onGestureEnd: () => void
}) {
  const unit = lengthUnit(document.units)
  const setCursor = (channel: 'position' | 'rotation', axis: AxisIndex, value: number) => {
    onEditDocument(
      (current) => {
        const vector: Vec3 = [...current.cursor[channel]]
        vector[axis] = value
        const cursor = channel === 'position'
          ? { ...current.cursor, position: vector }
          : { ...current.cursor, rotation: vector }
        return { ...current, cursor }
      },
      channel === 'position' ? 'Move the 3D cursor' : 'Turn the 3D cursor',
    )
  }

  return (
    <>
      <div className="scene-sidebar__section" role="group" aria-label="View lens">
        <span className="scene-sidebar__legend">View lens</span>
        <NumberField
          label="Focal length"
          variant="field"
          value={document.view.focalLength}
          min={1}
          max={250}
          step={1}
          unit="mm"
          onChange={(next) => onView({ focalLength: next })}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
      </div>

      <div className="scene-sidebar__section" role="group" aria-label="Clip">
        <span className="scene-sidebar__legend">Clip</span>
        <NumberField
          label="Clip start"
          variant="field"
          value={document.view.clipStart}
          min={0.0001}
          max={FAR}
          step={0.01}
          unit={unit}
          onChange={(next) => onView({ clipStart: next })}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
        <NumberField
          label="Clip end"
          variant="field"
          value={document.view.clipEnd}
          min={0.001}
          max={FAR}
          step={1}
          unit={unit}
          onChange={(next) => onView({ clipEnd: next })}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
        <SwitchField
          label="Lock camera to view"
          checked={cameraLocked}
          onChange={onCameraLocked}
        />
      </div>

      <AxisFields
        legend="3D cursor location"
        values={document.cursor.position}
        mixed={[false, false, false]}
        locked={[false, false, false]}
        min={-FAR}
        max={FAR}
        step={LENGTH_STEP}
        unit={unit}
        onValue={(axis, value) => setCursor('position', axis, value)}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />

      <AxisFields
        legend="3D cursor rotation"
        values={document.cursor.rotation}
        mixed={[false, false, false]}
        locked={[false, false, false]}
        min={-FAR}
        max={FAR}
        step={ANGLE_STEP}
        unit="°"
        onValue={(axis, value) => setCursor('rotation', axis, value)}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />
    </>
  )
}
