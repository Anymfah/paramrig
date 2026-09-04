import { describe, expect, it } from 'vitest'
import { createSceneDocument } from '@/scene/document'
import { channelsFor, insertKeyframes } from '@/scene/animate'
import type { SceneDocument, SceneObject } from '@/scene/types'

/**
 * I, and what it makes.
 *
 * The thing worth proving is the part that is not Blender's: a keyframe here goes on a *control*,
 * so pressing I on a channel that has none has to make one — and pressing it again must not make a
 * second one writing to the same property.
 */

function scene(): { document: SceneDocument; object: SceneObject } {
  const document = createSceneDocument()
  const object = document.objects.find((entry) => entry.kind === 'mesh')!
  return { document, object }
}

describe('inserting a keyframe', () => {
  it('names the three channels of a transform, and both of the others', () => {
    const { object } = scene()
    expect(channelsFor(object, 'location').length).toBe(3)
    expect(channelsFor(object, 'locRotScale').length).toBe(9)
    expect(channelsFor(object, 'shapeKey')).toBe('That object has no shape keys to key.')
    expect(channelsFor({ ...object, shapeKeys: [{ name: 'Smile', value: 0, min: 0, max: 1, offsets: {} }] }, 'shapeKey'))
      .toEqual([expect.objectContaining({ property: 'shapeKeys[Smile].value' })])
  })

  it('makes a control for every channel that had none, and keys the value that is there', () => {
    const { document, object } = scene()
    const moved = {
      ...document,
      objects: document.objects.map((entry) => (entry.id === object.id
        ? { ...entry, transform: { ...entry.transform, position: [1, 2, 3] as [number, number, number] } }
        : entry)),
    }
    const built = insertKeyframes(moved, moved.objects.find((entry) => entry.id === object.id)!, 'location')
    expect(typeof built, String(built)).not.toBe('string')
    if (typeof built === 'string') return
    expect(built.document.rig?.parameters).toHaveLength(3)
    expect(built.entries.map((entry) => entry.value)).toEqual([1, 2, 3])
    expect(built.document.rig?.bindings.map((binding) => binding.property))
      .toEqual(['transform.position.x', 'transform.position.y', 'transform.position.z'])
  })

  it('keys the control that is already there rather than making a second one', () => {
    const { document, object } = scene()
    const first = insertKeyframes(document, object, 'location')
    if (typeof first === 'string') throw new Error(first)
    const again = insertKeyframes(first.document, first.document.objects.find((entry) => entry.id === object.id)!, 'location')
    if (typeof again === 'string') throw new Error(again)
    expect(again.document.rig?.parameters).toHaveLength(3)
    expect(again.entries.map((entry) => entry.parameterId)).toEqual(first.entries.map((entry) => entry.parameterId))
  })

  it('widens a control’s range rather than keying a value outside it', () => {
    const { document, object } = scene()
    const far = {
      ...document,
      objects: document.objects.map((entry) => (entry.id === object.id
        ? { ...entry, transform: { ...entry.transform, position: [500, 0, 0] as [number, number, number] } }
        : entry)),
    }
    const built = insertKeyframes(far, far.objects.find((entry) => entry.id === object.id)!, 'location')
    if (typeof built === 'string') throw new Error(built)
    const parameter = built.document.rig?.parameters[0]
    expect(parameter?.kind === 'number' && parameter.max).toBeGreaterThanOrEqual(500)
  })

  it('says so rather than keying nothing when a channel has nothing on it', () => {
    const { document, object } = scene()
    expect(insertKeyframes(document, object, 'shapeKey')).toBe('That object has no shape keys to key.')
  })
})
