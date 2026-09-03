import { useMemo, useState } from 'react'
import { countedLabel } from '@/editor/history'
import { descendantObjectIds } from '@/scene/document'
import { objectBounds } from '@/scene/objects'
import { SceneAxes, SceneEmpty, SceneFold, SceneSection } from '@/scene/SceneProperties'
import { IDENTITY_TRANSFORM, type EulerOrder, type SceneDocument, type SceneObject, type Transform, type Vec3 } from '@/scene/types'
import { ColorField } from '@/ui/ColorField'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'
import { TextController } from '@/ui/TextController'

/**
 * The Object tab: what the selection is called, where it is, what it hangs from and how it is
 * drawn.
 *
 * Every field here works on the whole selection. A field the selected objects disagree about shows
 * "Mixed" and, once something is typed into it, writes that same value to all of them — which is
 * what makes the panel usable on more than one object without a second set of controls.
 */

/** Sentinel values for the selects: no object id, collection id or enum can collide with them. */
const NO_PARENT = 'none'
const MIXED = 'mixed'

const EULER_ORDERS: EulerOrder[] = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX']

type DisplayMode = NonNullable<SceneObject['displayAs']>

const DISPLAY_MODES: Array<{ value: DisplayMode; label: string }> = [
  { value: 'textured', label: 'Textured' },
  { value: 'solid', label: 'Solid' },
  { value: 'wire', label: 'Wire' },
  { value: 'bounds', label: 'Bounds' },
]

const DEFAULT_OBJECT_COLOR = '#ffffff'

type Channel = 'location' | 'rotation' | 'scale'

export function ObjectPanel({
  document,
  selectedObjects,
  activeObject,
  unit,
  onUpdateObject,
  onUpdateObjects,
  onGestureStart,
  onGestureEnd,
  isOpen,
  onSection,
}: {
  document: SceneDocument
  selectedObjects: SceneObject[]
  activeObject: SceneObject | null
  unit: string | undefined
  onUpdateObject: (id: string, patch: Partial<SceneObject>, label?: string) => void
  onUpdateObjects: (patches: Array<{ id: string; patch: Partial<SceneObject> }>, label?: string) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
}) {
  /**
   * The padlocks. Blender stores a lock per axis on the object; `SceneObject` has no field for
   * one, so the lock guards the hands for as long as the panel is open rather than being written
   * to the document — a wrong document is worse than a lock that does not survive a reload.
   */
  const [locks, setLocks] = useState<Record<string, boolean>>({})

  /** Measuring a box walks every vertex, so it is done once per selection rather than per field. */
  const extents = useMemo(
    () => new Map(selectedObjects.map((object) => [object.id, baseExtent(document, object)])),
    [document, selectedObjects],
  )

  const folds = { isOpen, onSection }
  const gesture = { onGestureStart, onGestureEnd }
  const count = selectedObjects.length

  if (count === 0) {
    return (
      <div className="scene-properties__notice">
        <SceneEmpty>No object selected. Click one in the viewport, or pick it in the outliner.</SceneEmpty>
      </div>
    )
  }

  const apply = (make: (object: SceneObject) => Partial<SceneObject>, label: string) => {
    const only = selectedObjects[0]
    if (count === 1 && only) {
      onUpdateObject(only.id, make(only), label)
      return
    }
    onUpdateObjects(selectedObjects.map((object) => ({ id: object.id, patch: make(object) })), label)
  }

  const applyTransform = (make: (object: SceneObject) => Transform, label: string) => {
    apply((object) => ({ transform: make(object) }), label)
  }

  const setVector = (part: 'position' | 'rotation' | 'scale', axis: number, value: number, label: string) => {
    applyTransform((object) => {
      const next = [...object.transform[part]] as Vec3
      next[axis] = value
      return { ...object.transform, [part]: next }
    }, label)
  }

  const setDimension = (axis: number, value: number) => {
    applyTransform((object) => {
      const extent = extents.get(object.id)?.[axis] ?? 0
      // A flat axis has no size to divide into, so there is no scale that would produce one.
      if (extent <= 0) return object.transform
      const scale = [...object.transform.scale] as Vec3
      // A mirrored object keeps its mirror: the dimension is read as a size, the sign is not.
      const sign = (scale[axis] ?? 1) < 0 ? -1 : 1
      scale[axis] = (value / extent) * sign
      return { ...object.transform, scale }
    }, countedLabel('Resize', count))
  }

  const lockKey = (channel: Channel, axis: number) => `${channel}-${axis}`
  const locksOf = (channel: Channel) => [0, 1, 2].map((axis) => locks[lockKey(channel, axis)] ?? false)
  const setLock = (channel: Channel, axis: number, locked: boolean) => {
    setLocks((current) => ({ ...current, [lockKey(channel, axis)]: locked }))
  }

  const axisValues = (read: (object: SceneObject) => Vec3) => (
    [0, 1, 2].map((axis) => shared(selectedObjects, (object) => read(object)[axis] ?? 0))
  )
  const dimensions = [0, 1, 2].map((axis) => shared(selectedObjects, (object) => (
    Math.abs(object.transform.scale[axis] ?? 1) * (extents.get(object.id)?.[axis] ?? 0)
  )))
  const flatAxes = [0, 1, 2].map((axis) => selectedObjects.every((object) => (extents.get(object.id)?.[axis] ?? 0) <= 0))

  const order = shared(selectedObjects, (object) => eulerOrder(object.transform))
  const parent = shared(selectedObjects, (object) => object.parentId ?? NO_PARENT)
  const collection = shared(selectedObjects, (object) => object.collectionId)
  const displayAs = shared(selectedObjects, (object) => object.displayAs ?? 'textured')
  const color = shared(selectedObjects, (object) => object.color ?? DEFAULT_OBJECT_COLOR)
  const visible = shared(selectedObjects, (object) => object.visible)
  const selectable = shared(selectedObjects, (object) => object.selectable)
  const renderable = shared(selectedObjects, (object) => object.renderable)
  const inFront = shared(selectedObjects, (object) => object.inFront ?? false)

  // An object cannot hang from itself or from anything already hanging from it.
  const unparentable = new Set<string>()
  for (const object of selectedObjects) {
    unparentable.add(object.id)
    for (const id of descendantObjectIds(document, object.id)) unparentable.add(id)
  }

  return (
    <>
      <div className="scene-properties__notice">
        {activeObject ? (
          <TextController
            label="Name"
            value={activeObject.name}
            maxLength={80}
            onChange={(name) => onUpdateObject(activeObject.id, { name: name.trim() || activeObject.name }, 'Rename')}
          />
        ) : null}
        {count > 1 ? <SceneEmpty>{count} objects selected. A field they disagree about reads Mixed until it is typed into.</SceneEmpty> : null}
      </div>

      <SceneSection id="object-transform" title="Transform" {...folds}>
        <SceneAxes
          label="Location"
          unit={unit}
          min={-1e6}
          max={1e6}
          step={0.01}
          values={axisValues((object) => object.transform.position)}
          locks={locksOf('location')}
          onLock={(axis, locked) => setLock('location', axis, locked)}
          onChange={(axis, value) => setVector('position', axis, value, countedLabel('Move', count))}
          {...gesture}
        />
        <SceneAxes
          label="Rotation"
          unit="°"
          min={-3600}
          max={3600}
          step={0.1}
          values={axisValues((object) => object.transform.rotation)}
          locks={locksOf('rotation')}
          onLock={(axis, locked) => setLock('rotation', axis, locked)}
          onChange={(axis, value) => setVector('rotation', axis, value, countedLabel('Rotate', count))}
          {...gesture}
        />
        <SelectField
          label="Rotation mode"
          value={order ?? MIXED}
          options={[
            ...(order === null ? [{ value: MIXED, label: 'Mixed' }] : []),
            ...EULER_ORDERS.map((value) => ({ value, label: value })),
          ]}
          onChange={(value) => {
            const next = EULER_ORDERS.find((entry) => entry === value)
            if (!next) return
            // Picking an order puts an object that was on a quaternion back onto Euler angles,
            // which is what Blender's own rotation mode menu does.
            applyTransform((object) => ({ ...object.transform, rotationMode: next }), 'Rotation mode')
          }}
        />
        <SceneAxes
          label="Scale"
          min={-1e4}
          max={1e4}
          step={0.01}
          values={axisValues((object) => object.transform.scale)}
          locks={locksOf('scale')}
          onLock={(axis, locked) => setLock('scale', axis, locked)}
          onChange={(axis, value) => setVector('scale', axis, value, countedLabel('Scale', count))}
          {...gesture}
        />
        <SceneAxes
          label="Dimensions"
          unit={unit}
          min={0}
          max={1e6}
          step={0.01}
          values={dimensions}
          disabled={flatAxes}
          // A dimension is the scale seen from the other end, so it answers to the scale's padlock.
          locks={locksOf('scale')}
          onLock={(axis, locked) => setLock('scale', axis, locked)}
          onChange={setDimension}
          {...gesture}
        />
        <SceneFold title="Delta transform">
          <SceneEmpty>No delta transform. The document stores one transform per object, so there is nothing yet to offset it with.</SceneEmpty>
        </SceneFold>
      </SceneSection>

      <SceneSection id="object-relations" title="Relations" {...folds}>
        <SelectField
          label="Parent"
          value={parent ?? MIXED}
          options={[
            ...(parent === null ? [{ value: MIXED, label: 'Mixed' }] : []),
            { value: NO_PARENT, label: 'None' },
            ...document.objects
              .filter((object) => !unparentable.has(object.id))
              .map((object) => ({ value: object.id, label: object.name })),
          ]}
          onChange={(value) => {
            if (value === MIXED) return
            apply(() => ({ parentId: value === NO_PARENT ? undefined : value }), 'Parent')
          }}
        />
        <SelectField
          label="Collection"
          value={collection ?? MIXED}
          options={[
            ...(collection === null ? [{ value: MIXED, label: 'Mixed' }] : []),
            ...document.collections.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          onChange={(value) => {
            if (value === MIXED) return
            apply(() => ({ collectionId: value }), 'Move to collection')
          }}
        />
      </SceneSection>

      <SceneSection id="object-visibility" title="Visibility" {...folds}>
        <SwitchField
          label="Show in viewport"
          checked={visible ?? true}
          mixed={visible === null}
          onChange={(next) => apply(() => ({ visible: next }), countedLabel(next ? 'Show' : 'Hide', count))}
        />
        <SwitchField
          label="Selectable"
          checked={selectable ?? true}
          mixed={selectable === null}
          onChange={(next) => apply(() => ({ selectable: next }), 'Selectable')}
        />
        <SwitchField
          label="Show in render"
          checked={renderable ?? true}
          mixed={renderable === null}
          onChange={(next) => apply(() => ({ renderable: next }), 'Show in render')}
        />
      </SceneSection>

      <SceneSection id="object-display" title="Viewport display" {...folds}>
        <SelectField
          label="Display as"
          value={displayAs ?? MIXED}
          options={[...(displayAs === null ? [{ value: MIXED, label: 'Mixed' }] : []), ...DISPLAY_MODES]}
          onChange={(value) => {
            const mode = DISPLAY_MODES.find((entry) => entry.value === value)
            if (!mode) return
            apply(() => ({ displayAs: mode.value }), 'Display as')
          }}
        />
        <ColorField
          label="Colour"
          value={color ?? DEFAULT_OBJECT_COLOR}
          mixed={color === null}
          defaultValue={DEFAULT_OBJECT_COLOR}
          onChange={(value) => apply(() => ({ color: value }), 'Object colour')}
          {...gesture}
        />
        <SwitchField
          label="In front"
          checked={inFront ?? false}
          mixed={inFront === null}
          onChange={(next) => apply(() => ({ inFront: next }), 'In front')}
        />
        <SceneEmpty>An object in front is drawn over everything else, whatever is between it and the camera.</SceneEmpty>
      </SceneSection>
    </>
  )
}

/** What the whole selection agrees on, or `null` when it does not. */
function shared<T>(objects: SceneObject[], read: (object: SceneObject) => T): T | null {
  const first = objects[0]
  if (!first) return null
  const value = read(first)
  return objects.every((object) => read(object) === value) ? value : null
}

/** A quaternion has no Euler order to show, so the select falls back to the order it would use. */
function eulerOrder(transform: Transform): EulerOrder {
  const mode = transform.rotationMode
  return mode && mode !== 'quaternion' ? mode : 'XYZ'
}

/**
 * The size an object would have at scale 1, which is what a dimension divides into.
 *
 * Blender's dimensions ignore the rotation and everything above the object in the hierarchy: they
 * are the object's own box multiplied by its own scale. Measuring the box under an identity
 * transform, with no parent, is what gives that box.
 */
function baseExtent(document: SceneDocument, object: SceneObject): Vec3 {
  const box = objectBounds(document, { ...object, parentId: undefined, transform: IDENTITY_TRANSFORM })
  if (!box) return [0, 0, 0]
  return [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]]
}
