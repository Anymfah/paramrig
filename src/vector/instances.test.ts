import { describe, expect, it } from 'vitest'
import { componentFrom, componentsOf, detachInstance, instanceCount, instanceOf, isInstanceChild, masterChildId, overrideBetween, overrideUpdate, resetOverrides, syncInstances } from '@/vector/instances'
import { createVectorElement } from '@/vector/document'
import type { VectorElement } from '@/vector/types'

function scene(): VectorElement[] {
  const box = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 100, height: 60 }), id: 'box', name: 'Box', fill: '#FF0000', parentId: 'card' }
  const label = { ...createVectorElement('rectangle', { x: 10, y: 10, width: 40, height: 20 }), id: 'label', name: 'Label', fill: '#00FF00', parentId: 'card' }
  const card = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 100, height: 60 }), id: 'card', name: 'Card', kind: 'component' as const }
  return [box, label, card]
}

/** The copies an instance carries, in the order they are painted. */
const copies = (elements: VectorElement[], instanceId: string) =>
  elements.filter((element) => masterChildId(instanceId, element.id) !== null)

describe('making a component', () => {
  it('wraps what is selected and keeps its box', () => {
    const shapes = [
      { ...createVectorElement('rectangle', { x: 10, y: 10, width: 40, height: 20 }), id: 'a' },
      { ...createVectorElement('rectangle', { x: 30, y: 40, width: 40, height: 20 }), id: 'b' },
    ]
    const result = componentFrom(shapes, ['a', 'b'], 'comp', 'Card')!

    const component = result.elements.find((element) => element.id === 'comp')!
    expect(component).toMatchObject({ kind: 'component', x: 10, y: 10, width: 60, height: 50 })
    expect(result.elements.filter((element) => element.parentId === 'comp')).toHaveLength(2)
    expect(componentsOf(result.elements)).toHaveLength(1)
  })

  it('gives up on an empty selection', () => {
    expect(componentFrom([], [], 'comp', 'Card')).toBeNull()
  })
})

describe('an instance', () => {
  it('copies the master, placed on its own box', () => {
    const master = scene()
    const instance = instanceOf(master[2]!, 'one', { x: 250, y: 130 })
    const synced = syncInstances([...master, instance])
    const made = copies(synced, 'one')

    expect(made).toHaveLength(2)
    expect(made[0]).toMatchObject({ fill: '#FF0000', parentId: 'one' })
    expect(made[0]!.x).toBeCloseTo(200, 4)
    expect(made[0]!.y).toBeCloseTo(100, 4)
    expect(instanceCount(synced, 'card')).toBe(1)
  })

  it('follows the master when it changes', () => {
    const master = scene()
    const instance = instanceOf(master[2]!, 'one', { x: 250, y: 130 })
    const first = syncInstances([...master, instance])
    const edited = first.map((element) => element.id === 'box' ? { ...element, fill: '#0000FF' } : element)

    expect(copies(syncInstances(edited), 'one')[0]!.fill).toBe('#0000FF')
  })

  it('keeps every copy of a component in step', () => {
    const master = scene()
    const one = instanceOf(master[2]!, 'one', { x: 250, y: 130 })
    const two = instanceOf(master[2]!, 'two', { x: 450, y: 130 })
    const three = instanceOf(master[2]!, 'three', { x: 650, y: 130 })
    const synced = syncInstances([...master, one, two, three])
    const edited = syncInstances(synced.map((element) => element.id === 'box' ? { ...element, fill: '#123456' } : element))

    for (const id of ['one', 'two', 'three']) {
      expect(copies(edited, id)[0]!.fill).toBe('#123456')
    }
  })

  it('turns an edit aimed at a copy into an override on the instance', () => {
    const master = scene()
    const instance = instanceOf(master[2]!, 'one', { x: 250, y: 130 })
    const synced = syncInstances([...master, instance])
    const copyId = copies(synced, 'one')[0]!.id
    const update = overrideUpdate(synced, copyId, { fill: '#ABCDEF' })!

    expect(update).toEqual({ id: 'one', patch: { overrides: { box: { fill: '#ABCDEF' } } } })
    const painted = synced.map((element) => element.id === 'one' ? { ...element, ...update.patch } : element)
    const after = syncInstances(painted)

    expect(after.find((element) => element.id === 'one')!.overrides).toEqual({ box: { fill: '#ABCDEF' } })
    expect(copies(after, 'one')[0]!.fill).toBe('#ABCDEF')
    // And the master still rules everything the override does not mention.
    const moved = syncInstances(after.map((element) => element.id === 'box' ? { ...element, stroke: '#111111' } : element))
    expect(copies(moved, 'one')[0]).toMatchObject({ fill: '#ABCDEF', stroke: '#111111' })
  })

  it('goes back to the master when its overrides are dropped', () => {
    const master = scene()
    const instance = { ...instanceOf(master[2]!, 'one', { x: 250, y: 130 }), overrides: { box: { fill: '#ABCDEF' } } }
    const synced = syncInstances([...master, instance])

    expect(copies(synced, 'one')[0]!.fill).toBe('#ABCDEF')
    expect(copies(syncInstances(resetOverrides(synced, 'one')), 'one')[0]!.fill).toBe('#FF0000')
  })

  it('is left alone when nothing changed', () => {
    const master = scene()
    const synced = syncInstances([...master, instanceOf(master[2]!, 'one', { x: 250, y: 130 })])

    expect(syncInstances(synced)).toBe(synced)
  })
})

describe('detaching', () => {
  it('turns an instance into a plain group whose copies stop following', () => {
    const master = scene()
    const synced = syncInstances([...master, instanceOf(master[2]!, 'one', { x: 250, y: 130 })])
    const detached = detachInstance(synced, 'one')

    expect(detached.find((element) => element.id === 'one')!.kind).toBe('group')
    expect(detached.find((element) => element.id === 'one')!.componentId).toBeUndefined()
    expect(detached.some((element) => isInstanceChild(element.id))).toBe(false)
    expect(detached.filter((element) => element.parentId === 'one')).toHaveLength(2)
    // The master moves on; the detached copies do not.
    const edited = syncInstances(detached.map((element) => element.id === 'box' ? { ...element, fill: '#000000' } : element))
    expect(edited.filter((element) => element.parentId === 'one')[0]!.fill).toBe('#FF0000')
  })

  it('happens on its own when the master is deleted', () => {
    const master = scene()
    const synced = syncInstances([...master, instanceOf(master[2]!, 'one', { x: 250, y: 130 })])
    const without = syncInstances(synced.filter((element) => element.id !== 'card'))

    expect(without.find((element) => element.id === 'one')).toMatchObject({ kind: 'group' })
    expect(without.filter((element) => element.parentId === 'one')).toHaveLength(2)
  })
})

describe('reading a difference', () => {
  const base = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), id: 'a' }

  it('names only what an instance may change', () => {
    expect(overrideBetween(base, { ...base, fill: '#123456' })).toEqual({ fill: '#123456' })
    expect(overrideBetween(base, { ...base, x: 40 })).toBeNull()
  })
})
