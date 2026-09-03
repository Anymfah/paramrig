import { describe, expect, it } from 'vitest'
import {
  NO_CONSTRAINT,
  combineAmounts,
  constraintAxes,
  constraintLabel,
  cycleConstraint,
  freeAxisNames,
  freeAxisVectors,
  isAxisKey,
  projectDelta,
  type AxisConstraint,
} from '@/scene/transform/constraints'
import { GLOBAL_BASIS, transformAxes } from '@/scene/transform/math'
import type { Vec3 } from '@/scene/types'

const TURNED_A_QUARTER = transformAxes({ position: [0, 0, 0], rotation: [0, 0, 90], scale: [1, 1, 1] })

function closeTo(actual: Vec3, expected: Vec3, digits = 6): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits)
  expect(actual[1]).toBeCloseTo(expected[1], digits)
  expect(actual[2]).toBeCloseTo(expected[2], digits)
}

describe('the axis cycle', () => {
  it('goes global, then local, then free again on three presses of the same key', () => {
    const first = cycleConstraint(NO_CONSTRAINT, 'x', false)
    const second = cycleConstraint(first, 'x', false)
    const third = cycleConstraint(second, 'x', false)

    expect(first).toEqual({ axis: 'x', kind: 'axis', space: 'global' })
    expect(second).toEqual({ axis: 'x', kind: 'axis', space: 'local' })
    expect(third).toEqual(NO_CONSTRAINT)
  })

  it('starts a fresh cycle when a different axis is pressed', () => {
    const onX: AxisConstraint = { axis: 'x', kind: 'axis', space: 'local' }

    expect(cycleConstraint(onX, 'y', false)).toEqual({ axis: 'y', kind: 'axis', space: 'global' })
  })

  it('reads shift and an axis as the plane that excludes it, on a cycle of its own', () => {
    const plane = cycleConstraint({ axis: 'x', kind: 'axis', space: 'global' }, 'x', true)

    expect(plane).toEqual({ axis: 'x', kind: 'plane', space: 'global' })
    expect(freeAxisNames(plane)).toEqual(['y', 'z'])
    expect(cycleConstraint(cycleConstraint(plane, 'x', true), 'x', true)).toEqual(NO_CONSTRAINT)
  })

  it('knows which keys are axis keys', () => {
    expect(isAxisKey('x')).toBe(true)
    expect(isAxisKey('w')).toBe(false)
  })

  it('names the axes the viewport draws', () => {
    expect(constraintAxes(NO_CONSTRAINT)).toEqual([])
    expect(constraintAxes({ axis: 'z', kind: 'axis', space: 'global' })).toEqual(['z'])
    expect(constraintAxes({ axis: 'z', kind: 'plane', space: 'global' })).toEqual(['x', 'y'])
  })
})

describe('a movement held to a constraint', () => {
  const delta: Vec3 = [1, 2, 3]

  it('keeps only the axis it is held to', () => {
    closeTo(projectDelta(delta, { axis: 'y', kind: 'axis', space: 'global' }, GLOBAL_BASIS), [0, 2, 0])
  })

  it('flattens into the plane that excludes the axis', () => {
    closeTo(projectDelta(delta, { axis: 'y', kind: 'plane', space: 'global' }, GLOBAL_BASIS), [1, 0, 3])
  })

  it('leaves a free movement alone', () => {
    closeTo(projectDelta(delta, NO_CONSTRAINT, GLOBAL_BASIS), delta)
  })

  it('holds to the object own axis when the frame is the object own', () => {
    closeTo(projectDelta(delta, { axis: 'x', kind: 'axis', space: 'local' }, TURNED_A_QUARTER), [0, 2, 0])
  })

  it('rebuilds a movement out of an amount along each free axis', () => {
    const axes = freeAxisVectors({ axis: 'z', kind: 'plane', space: 'global' }, GLOBAL_BASIS)

    expect(axes).toHaveLength(2)
    closeTo(combineAmounts([2, 3], axes), [2, 3, 0])
  })
})

describe('what the header calls a constraint', () => {
  it('names the space and the axes it holds', () => {
    expect(constraintLabel(NO_CONSTRAINT, 'global')).toBe('global')
    expect(constraintLabel({ axis: 'x', kind: 'axis', space: 'global' }, 'global')).toBe('global X')
    expect(constraintLabel({ axis: 'x', kind: 'plane', space: 'local' }, 'local')).toBe('local YZ')
  })
})
