import { describe, expect, it } from 'vitest'
import {
  beginTransform,
  cancelTransform,
  confirmTransform,
  transformChanged,
  transformLabel,
  transformOutput,
  updateTransform,
  type BeginTransformOptions,
  type TransformModifiers,
  type TransformSession,
  type TransformTarget,
  type ViewBasis,
} from '@/scene/transform/session'
import type { Transform, Vec3 } from '@/scene/types'

/** Blender's front view: looking along +Y, X across the screen and Z up it, a pixel worth a centimetre. */
const FRONT_VIEW: ViewBasis = {
  right: [1, 0, 0],
  up: [0, 0, 1],
  forward: [0, 1, 0],
  unitsPerPixel: 0.01,
  pivotScreen: [400, 300],
}

const NONE: TransformModifiers = { shift: false, ctrl: false, alt: false }
const SHIFT: TransformModifiers = { shift: true, ctrl: false, alt: false }
const CTRL: TransformModifiers = { shift: false, ctrl: true, alt: false }
const CTRL_SHIFT: TransformModifiers = { shift: true, ctrl: true, alt: false }

/** The pointer opens a hundred pixels to the right of the pivot, so its angle is nought and its radius round. */
const START: [number, number] = [500, 300]

function objectAt(id: string, position: Vec3, rotation: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]): TransformTarget {
  return { id, transform: { position, rotation, scale }, centre: position }
}

function open(overrides: Partial<BeginTransformOptions> = {}): TransformSession {
  return beginTransform({
    mode: 'move',
    targets: [objectAt('cube', [0, 0, 0])],
    pivot: 'median',
    orientation: 'global',
    view: FRONT_VIEW,
    pointer: START,
    ...overrides,
  })
}

function press(session: TransformSession, key: string, modifiers: TransformModifiers = NONE): TransformSession {
  return updateTransform(session, { cursor: session.pointer, modifiers, key })
}

function typeKeys(session: TransformSession, text: string): TransformSession {
  return [...text].reduce((current, key) => press(current, key), session)
}

function drag(session: TransformSession, cursor: [number, number], modifiers: TransformModifiers = NONE): TransformSession {
  return updateTransform(session, { cursor, modifiers })
}

/** A point on the circle the cursor sweeps, at a screen angle measured clockwise from the right. */
function atAngle(degrees: number, radius = 100): [number, number] {
  const radians = (degrees * Math.PI) / 180
  return [400 + radius * Math.cos(radians), 300 + radius * Math.sin(radians)]
}

function positionOf(session: TransformSession, id = 'cube'): Vec3 {
  const result = confirmTransform(session).find((entry) => entry.id === id)
  return result ? result.transform.position : [0, 0, 0]
}

function transformOf(session: TransformSession, id = 'cube'): Transform {
  const result = confirmTransform(session).find((entry) => entry.id === id)
  if (!result) throw new Error(`no target called ${id}`)
  return result.transform
}

function closeTo(actual: Vec3, expected: Vec3, digits = 6): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits)
  expect(actual[1]).toBeCloseTo(expected[1], digits)
  expect(actual[2]).toBeCloseTo(expected[2], digits)
}

describe('moving with a typed number', () => {
  it('moves exactly two units along X when the axis and the number are typed', () => {
    const session = typeKeys(press(open(), 'x'), '2')

    closeTo(positionOf(session), [2, 0, 0])
  })

  it('keeps what was typed for the previous axis when Tab moves on', () => {
    const session = typeKeys(press(typeKeys(open(), '2'), 'Tab'), '3')

    closeTo(positionOf(session), [2, 3, 0])
  })

  it('reads a fraction as it is typed', () => {
    const session = typeKeys(press(open(), 'x'), '1/3')

    expect(positionOf(session)[0]).toBeCloseTo(1 / 3, 9)
  })

  it('reads a length written in centimetres', () => {
    const session = typeKeys(press(open(), 'x'), '20cm')

    closeTo(positionOf(session), [0.2, 0, 0])
  })

  it('hands the pointer back when Backspace empties the field', () => {
    const dragged = drag(open(), [550, 300])
    const typed = typeKeys(press(dragged, 'x'), '2')
    const emptied = press(typed, 'Backspace')
    const abandoned = press(emptied, 'Backspace')

    expect(positionOf(typed)[0]).toBeCloseTo(2, 9)
    expect(positionOf(emptied)[0]).toBeCloseTo(0, 9)
    expect(positionOf(abandoned)[0]).toBeCloseTo(0.5, 9)
  })
})

describe('moving with the pointer', () => {
  it('follows the cursor across the plane of the screen', () => {
    const session = drag(open(), [550, 250])

    closeTo(positionOf(session), [0.5, 0, 0.5])
  })

  it('writes the modal header the way the header line reads', () => {
    const output = transformOutput(drag(open(), [550, 300]))

    expect(output.header).toBe('Dx: 0.5 m  Dy: 0  Dz: 0 (0.5 m) | global')
    expect(output.hud).toBe('0.5 m')
    expect(output.axes).toEqual([])
  })

  it('holds to one axis, and says which axis the viewport should draw', () => {
    const output = transformOutput(drag(press(open(), 'x'), [550, 250]))

    closeTo(output.transforms[0]!.transform.position, [0.5, 0, 0])
    expect(output.axes).toEqual(['x'])
    expect(output.header).toContain('| global X')
    expect(output.hud).toBe('X 0.5 m')
  })

  it('excludes an axis when shift is held with it, leaving the other two', () => {
    const output = transformOutput(drag(press(open(), 'x', SHIFT), [560, 250]))

    expect(output.axes).toEqual(['y', 'z'])
    expect(output.header).toContain('| global YZ')
    // Y points straight at this camera, so the whole of the travel lands on Z and none of it on X.
    closeTo(output.transforms[0]!.transform.position, [0, 0, 0.5])
  })

  it('moves a tenth as fast from the moment shift goes down, without the value jumping', () => {
    const full = drag(open(), [600, 300])
    const precise = drag(full, [700, 300], SHIFT)

    expect(positionOf(full)[0]).toBeCloseTo(1, 9)
    expect(positionOf(precise)[0]).toBeCloseTo(1.1, 9)
  })

  it('snaps to whole units while control is held, and to a tenth with shift as well', () => {
    const loose = drag(open(), [637, 300])
    const snapped = drag(loose, [637, 300], CTRL)
    const fine = drag(snapped, [637, 300], CTRL_SHIFT)

    expect(positionOf(loose)[0]).toBeCloseTo(1.37, 9)
    expect(positionOf(snapped)[0]).toBeCloseTo(1, 9)
    expect(positionOf(fine)[0]).toBeCloseTo(1.4, 9)
  })
})

describe('the frame a constraint is read in', () => {
  const turned = objectAt('cube', [0, 0, 0], [0, 0, 90])

  it('holds to the global axis on the first press of the key', () => {
    const session = typeKeys(press(open({ targets: [turned] }), 'x'), '2')

    closeTo(positionOf(session), [2, 0, 0])
  })

  it('holds to the object own axis on the second press', () => {
    const session = typeKeys(press(press(open({ targets: [turned] }), 'x'), 'x'), '2')

    closeTo(positionOf(session), [0, 2, 0])
  })

  it('lets go on the third press', () => {
    const session = press(press(press(open({ targets: [turned] }), 'x'), 'x'), 'x')

    expect(transformOutput(session).axes).toEqual([])
  })

  it('reads the first press in the orientation the header has chosen', () => {
    const session = typeKeys(press(open({ targets: [turned], orientation: 'local' }), 'x'), '2')

    closeTo(positionOf(session), [0, 2, 0])
  })
})

describe('rotating', () => {
  const rotating = { mode: 'rotate' as const }

  it('turns by the angle the cursor sweeps around the pivot', () => {
    const session = drag(press(open(rotating), 'z'), atAngle(90))

    closeTo(transformOf(session).rotation, [0, 0, 90], 4)
  })

  it('turns exactly ninety degrees when the number is typed', () => {
    const session = typeKeys(press(open(rotating), 'z'), '90')

    closeTo(transformOf(session).rotation, [0, 0, 90], 6)
  })

  it('keeps going past half a turn instead of folding back', () => {
    let session = press(open(rotating), 'z')
    const swept: number[] = []
    for (let degrees = 10; degrees <= 210; degrees += 10) {
      session = drag(session, atAngle(degrees))
      swept.push(transformOf(session).rotation[2])
    }

    expect(swept[swept.length - 1]).toBeCloseTo(210, 3)
    swept.forEach((angle, index) => {
      const previous = index === 0 ? 0 : swept[index - 1]!
      expect(angle - previous).toBeCloseTo(10, 3)
    })
  })

  it('snaps to five degrees while control is held, and to one with shift as well', () => {
    const loose = drag(press(open(rotating), 'z'), atAngle(47.4))
    const snapped = drag(loose, atAngle(47.4), CTRL)
    const fine = drag(snapped, atAngle(47.4), CTRL_SHIFT)

    expect(transformOf(loose).rotation[2]).toBeCloseTo(47.4, 3)
    expect(transformOf(snapped).rotation[2]).toBeCloseTo(45, 3)
    expect(transformOf(fine).rotation[2]).toBeCloseTo(47, 3)
  })

  it('writes the angle into the header and the chip', () => {
    const output = transformOutput(typeKeys(press(open(rotating), 'z'), '90'))

    expect(output.header).toBe('Rot: [90]° | global Z')
    expect(output.axes).toEqual(['z'])
  })
})

describe('the pivot a rotation turns about', () => {
  const pair = [objectAt('left', [-2, 0, 0]), objectAt('right', [2, 0, 0])]

  function turn(overrides: Partial<BeginTransformOptions>): TransformSession {
    return typeKeys(press(open({ mode: 'rotate', targets: pair, ...overrides }), 'z'), '90')
  }

  it('turns every target about the median point', () => {
    const session = turn({ pivot: 'median' })

    closeTo(positionOf(session, 'right'), [0, 2, 0])
    closeTo(positionOf(session, 'left'), [0, -2, 0])
  })

  it('turns each target about its own origin with individual origins', () => {
    const session = turn({ pivot: 'individual' })

    closeTo(positionOf(session, 'right'), [2, 0, 0])
    closeTo(positionOf(session, 'left'), [-2, 0, 0])
    closeTo(transformOf(session, 'right').rotation, [0, 0, 90], 6)
  })

  it('turns every target about the 3D cursor', () => {
    const session = turn({ pivot: 'cursor', sceneCursor: [1, 0, 0] })

    closeTo(positionOf(session, 'right'), [1, 1, 0])
  })

  it('turns every target about the active one', () => {
    const session = turn({ pivot: 'active', activeId: 'right' })

    closeTo(positionOf(session, 'right'), [2, 0, 0])
    closeTo(positionOf(session, 'left'), [2, -4, 0])
  })

  it('reads the bounding box centre, which is not the median when the targets are lopsided', () => {
    const lopsided = [objectAt('a', [0, 0, 0]), objectAt('b', [0, 0, 0]), objectAt('c', [4, 0, 0])]
    const box = typeKeys(open({ mode: 'scale', targets: lopsided, pivot: 'bounding-box' }), '2')
    const median = typeKeys(open({ mode: 'scale', targets: lopsided, pivot: 'median' }), '2')

    closeTo(positionOf(box, 'a'), [-2, 0, 0])
    closeTo(positionOf(median, 'a'), [-4 / 3, 0, 0])
  })
})

describe('scaling', () => {
  const scaling = { mode: 'scale' as const }

  it('scales by the ratio of the cursor distance to the pivot', () => {
    const session = drag(open({ ...scaling, targets: [objectAt('cube', [1, 0, 0])], pivot: 'cursor' }), [600, 300])

    closeTo(transformOf(session).scale, [2, 2, 2], 9)
    closeTo(positionOf(session), [2, 0, 0], 9)
  })

  it('scales everything by one typed number', () => {
    const session = typeKeys(open(scaling), '2')

    closeTo(transformOf(session).scale, [2, 2, 2], 9)
  })

  it('scales one axis per field once Tab has moved on', () => {
    const session = typeKeys(press(typeKeys(open(scaling), '2'), 'Tab'), '3')

    closeTo(transformOf(session).scale, [2, 3, 1], 9)
  })

  it('mirrors on the constrained axis when minus one is typed', () => {
    const session = typeKeys(press(open(scaling), 'z'), '-1')

    closeTo(transformOf(session).scale, [1, 1, -1], 9)
    closeTo(transformOf(session).rotation, [0, 0, 0], 9)
  })

  it('snaps to a tenth while control is held', () => {
    const session = drag(open(scaling), [537, 300], CTRL)

    expect(transformOf(session).scale[0]).toBeCloseTo(1.4, 6)
  })

  it('scales along the object own axis when the constraint is local', () => {
    const turned = objectAt('cube', [0, 0, 0], [0, 0, 90])
    const session = typeKeys(press(press(open({ ...scaling, targets: [turned] }), 'x'), 'x'), '2')

    closeTo(transformOf(session).scale, [2, 1, 1], 6)
    closeTo(transformOf(session).rotation, [0, 0, 90], 6)
  })
})

describe('a trackball rotation', () => {
  const trackball = { mode: 'trackball' as const }

  it('turns about the screen up axis when the drag goes sideways', () => {
    const session = drag(open(trackball), [600, 300])

    closeTo(transformOf(session).rotation, [0, 0, 50], 4)
  })

  it('turns about the screen right axis when the drag goes down', () => {
    const session = drag(open(trackball), [500, 400])

    closeTo(transformOf(session).rotation, [50, 0, 0], 4)
  })

  it('has no axis to constrain and no number to type', () => {
    const session = typeKeys(press(drag(open(trackball), [600, 300]), 'x'), '2')

    expect(transformOutput(session).axes).toEqual([])
    closeTo(transformOf(session).rotation, [0, 0, 50], 4)
  })
})

describe('proportional editing', () => {
  it('moves a half weighted target half as far', () => {
    const targets: TransformTarget[] = [
      { ...objectAt('centre', [0, 0, 0]), weight: 1 },
      { ...objectAt('edge', [0, 0, 5]), weight: 0.5 },
    ]
    const session = typeKeys(press(open({ targets }), 'x'), '2')

    closeTo(positionOf(session, 'centre'), [2, 0, 0])
    closeTo(positionOf(session, 'edge'), [1, 0, 5])
  })
})

describe('ending a session', () => {
  it('gives back the transforms it was given when it is cancelled', () => {
    const target = objectAt('cube', [0, 0, 0])
    const session = drag(open({ targets: [target] }), [600, 400])

    expect(positionOf(session)).not.toEqual([0, 0, 0])
    expect(cancelTransform(session)[0]!.transform).toBe(target.transform)
  })

  it('changes nothing when the cursor never moved and nothing was typed', () => {
    const target = objectAt('cube', [1, 2, 3])
    const session = drag(open({ targets: [target] }), START)

    expect(transformChanged(session)).toBe(false)
    expect(confirmTransform(session)[0]!.transform).toBe(target.transform)
  })

  it('changes nothing when an axis was pressed but the cursor never moved', () => {
    const target = objectAt('cube', [1, 2, 3])
    const session = press(open({ targets: [target] }), 'x')

    expect(transformChanged(session)).toBe(false)
    expect(confirmTransform(session)[0]!.transform).toBe(target.transform)
  })

  it('names itself for the history, counting the targets', () => {
    expect(transformLabel(open())).toBe('Move')
    expect(transformLabel(open({ mode: 'rotate', targets: [objectAt('a', [0, 0, 0]), objectAt('b', [1, 0, 0])] })))
      .toBe('Rotate 2 objects')
  })
})
