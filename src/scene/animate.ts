import { exposeProperty } from '@/scene/rigEdits'
import { currentSceneValue } from '@/scene/rig'
import type { SceneDocument, SceneObject } from '@/scene/types'

/**
 * I: a keyframe on what is under the pointer, and the control it needs to exist on.
 *
 * Blender's I makes an action out of nothing — press it on an object with no animation and the
 * object has one, with a channel per component. The same thing happens here, through the rig: a
 * channel that has no control gets one, and the keyframe goes on that control's track. So an
 * animated scene and a rigged scene are the same scene, and everything that already works on a
 * control — the timeline, the graph, the drivers, the export — works on the animation too.
 *
 * That is a real difference from Blender worth naming: there, an F-curve can address any property
 * directly. Here it addresses a *control*, and the control addresses the property. The cost is one
 * indirection and a control in the panel for every animated channel; what it buys is one animation
 * system rather than two.
 */

export type KeyChannel = 'location' | 'rotation' | 'scale' | 'locRotScale' | 'shapeKey'

export const KEY_CHANNELS: Array<{ id: KeyChannel; label: string }> = [
  { id: 'location', label: 'Location' },
  { id: 'rotation', label: 'Rotation' },
  { id: 'scale', label: 'Scale' },
  { id: 'locRotScale', label: 'Location, rotation and scale' },
  { id: 'shapeKey', label: 'Shape key value' },
]

/** One property a keyframe would go on, with the range a control for it should have. */
type Channel = { property: string; label: string; min: number; max: number; step: number }

const AXES = ['x', 'y', 'z'] as const

function transformChannels(kind: 'position' | 'rotation' | 'scale', object: SceneObject): Channel[] {
  const label = kind === 'position' ? 'Location' : kind === 'rotation' ? 'Rotation' : 'Scale'
  return AXES.map((axis) => ({
    property: `transform.${kind}.${axis}`,
    label: `${object.name} ${label} ${axis.toUpperCase()}`,
    min: kind === 'rotation' ? -720 : kind === 'scale' ? 0 : -100,
    max: kind === 'rotation' ? 720 : kind === 'scale' ? 10 : 100,
    step: kind === 'rotation' ? 1 : 0.01,
  }))
}

/** What a channel would key: the properties, or a sentence saying why it would key nothing. */
export function channelsFor(object: SceneObject, channel: KeyChannel): Channel[] | string {
  if (channel === 'location') return transformChannels('position', object)
  if (channel === 'rotation') return transformChannels('rotation', object)
  if (channel === 'scale') return transformChannels('scale', object)
  if (channel === 'locRotScale') {
    return [...transformChannels('position', object), ...transformChannels('rotation', object), ...transformChannels('scale', object)]
  }
  const keys = object.shapeKeys ?? []
  if (keys.length === 0) return 'That object has no shape keys to key.'
  const key = keys[Math.min(keys.length - 1, Math.max(0, object.activeShapeKey ?? 0))]!
  return [{
    property: `shapeKeys[${key.name}].value`,
    label: `${object.name} ${key.name}`,
    min: key.min,
    max: key.max,
    step: 0.01,
  }]
}

export type KeyframeEntry = { parameterId: string; value: number }

/**
 * The document with a control for every channel that lacked one, and what to key on each.
 *
 * A channel that already has a control keeps it — pressing I twice must not leave two controls
 * writing to one property — and the value keyed is the property's own, read from the document
 * rather than from the control, so a keyframe records what is on screen.
 */
export function insertKeyframes(document: SceneDocument, object: SceneObject, channel: KeyChannel): {
  document: SceneDocument
  entries: KeyframeEntry[]
} | string {
  const channels = channelsFor(object, channel)
  if (typeof channels === 'string') return channels
  let next = document
  const entries: KeyframeEntry[] = []
  for (const entry of channels) {
    const value = currentSceneValue(next, { objectId: object.id, property: entry.property })
    if (typeof value !== 'number') continue
    const existing = next.rig?.bindings.find((binding) => (
      binding.property === entry.property && (binding.objectId ?? '') === object.id
    ))
    if (existing) {
      entries.push({ parameterId: existing.parameterId, value })
      continue
    }
    const exposed = exposeProperty(next, {
      objectId: object.id,
      property: entry.property,
      label: entry.label,
      group: next.rig?.groups[0]?.id ?? 'main',
      newGroupLabel: 'Main',
      min: Math.min(entry.min, value),
      max: Math.max(entry.max, value),
      step: entry.step,
    })
    if (!exposed) continue
    next = exposed.document
    entries.push({ parameterId: exposed.parameterId, value })
  }
  if (entries.length === 0) return 'There is nothing on that channel to key.'
  return { document: next, entries }
}
