import { paddedBounds, sceneBounds } from '@/scene/objects'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam, type Operator, type OperatorContext, type OperatorParams, type OperatorResult } from '@/scene/operators/types'
import type { SceneDocument, ViewState } from '@/scene/types'
import { AXIS_VIEWS, clampPitch, fovFromFocalLength, frameBox, wrapYaw, type AxisView } from '@/scene/viewport/view'

/**
 * Moving the view is an operator like any other, so it appears in the View menu, in the palette
 * and in the generated keymap without being written out three times. It is the one family marked
 * `history: false`: the camera is not part of the document's story.
 *
 * These produce a *destination*. The navigator sees the view change and travels to it over two
 * hundred milliseconds, which is why an operator here is a pure function and the animation is not
 * its business.
 */

function withView(document: SceneDocument, view: Partial<ViewState>): SceneDocument {
  return { ...document, view: { ...document.view, ...view } }
}

function axisOperator(id: string, label: string, axis: AxisView, shortcut: string): Operator<OperatorParams> {
  return registerOperator({
    id,
    label,
    section: 'View',
    shortcut,
    description: `Look along the ${axis} axis, exactly.`,
    params: [],
    defaults: {},
    history: false,
    available: () => true,
    run: (context) => ({
      document: withView(context.document, {
        yaw: AXIS_VIEWS[axis].yaw,
        pitch: AXIS_VIEWS[axis].pitch,
        // An axis view in perspective is a lie: parallel edges converge and nothing lines up.
        // Blender switches to orthographic, and the preference is what decides whether it does.
        projection: 'orthographic',
      }),
      label,
    }),
  })
}

axisOperator('view.front', 'Front', 'front', 'Numpad 1')
axisOperator('view.back', 'Back', 'back', '⌃Numpad 1')
axisOperator('view.right', 'Right', 'right', 'Numpad 3')
axisOperator('view.left', 'Left', 'left', '⌃Numpad 3')
axisOperator('view.top', 'Top', 'top', 'Numpad 7')
axisOperator('view.bottom', 'Bottom', 'bottom', '⌃Numpad 7')

function frame(context: OperatorContext, which: 'selection' | 'all', aspect: number): OperatorResult {
  const ids = which === 'selection' && context.selection.objectIds.length > 0 ? context.selection.objectIds : undefined
  const box = sceneBounds(context.document, ids)
  if (!box) return { error: which === 'selection' ? 'Nothing is selected to frame.' : 'The scene is empty.' }
  const framed = frameBox(paddedBounds(box), { fovDegrees: fovFromFocalLength(context.document.view.focalLength), aspect })
  return {
    document: withView(context.document, { target: framed.target, distance: framed.distance }),
    label: which === 'selection' ? 'Frame selected' : 'Frame all',
  }
}

/**
 * Framing needs to know how wide the viewport is, and an operator is not given a viewport. The
 * aspect comes in as a parameter with a sensible default, which also means the palette can frame
 * before the viewport has ever been measured.
 */
const ASPECT = numberParam('aspect', 'Aspect', { min: 0.1, max: 10, step: 0.01, defaultValue: 16 / 9 })

registerOperator({
  id: 'view.frameSelected',
  label: 'Frame selected',
  section: 'View',
  shortcut: 'Numpad .',
  description: 'Move the view until the selection fills it.',
  params: [ASPECT],
  defaults: { aspect: 16 / 9 },
  history: false,
  available: () => true,
  run: (context, params) => frame(context, 'selection', Number(params.aspect) || 16 / 9),
})

registerOperator({
  id: 'view.frameAll',
  label: 'Frame all',
  section: 'View',
  shortcut: 'Home',
  description: 'Move the view until the whole scene fills it.',
  params: [ASPECT],
  defaults: { aspect: 16 / 9 },
  history: false,
  available: () => true,
  run: (context, params) => frame(context, 'all', Number(params.aspect) || 16 / 9),
})

registerOperator({
  id: 'view.opposite',
  label: 'View opposite',
  section: 'View',
  shortcut: 'Numpad 9',
  description: 'Swing round to the view from the other side.',
  params: [],
  defaults: {},
  history: false,
  available: () => true,
  run: (context) => ({
    document: withView(context.document, { yaw: wrapYaw(context.document.view.yaw + 180), pitch: -context.document.view.pitch }),
    label: 'View opposite',
  }),
})

registerOperator({
  id: 'view.togglePerspective',
  label: 'Perspective / orthographic',
  section: 'View',
  shortcut: 'Numpad 5',
  description: 'Switch between a converging view and a parallel one.',
  params: [],
  defaults: {},
  history: false,
  available: () => true,
  run: (context) => ({
    document: withView(context.document, { projection: context.document.view.projection === 'perspective' ? 'orthographic' : 'perspective' }),
    label: context.document.view.projection === 'perspective' ? 'Orthographic' : 'Perspective',
  }),
})

const STEP = numberParam('degrees', 'Angle', { min: 1, max: 90, step: 1, defaultValue: 15, unit: '°' })

function orbitOperator(id: string, label: string, shortcut: string, yaw: number, pitch: number): void {
  registerOperator({
    id,
    label,
    section: 'View',
    shortcut,
    description: 'Turn the view by a fixed step, for a keyboard-only orbit.',
    params: [STEP],
    defaults: { degrees: 15 },
    history: false,
    available: () => true,
    run: (context, params) => {
      const step = Number(params.degrees) || 15
      return {
        document: withView(context.document, {
          yaw: wrapYaw(context.document.view.yaw + yaw * step),
          pitch: clampPitch(context.document.view.pitch + pitch * step),
        }),
        label,
      }
    },
  })
}

orbitOperator('view.orbitUp', 'Orbit up', 'Numpad 8', 0, 1)
orbitOperator('view.orbitDown', 'Orbit down', 'Numpad 2', 0, -1)
orbitOperator('view.orbitLeft', 'Orbit left', 'Numpad 4', 1, 0)
orbitOperator('view.orbitRight', 'Orbit right', 'Numpad 6', -1, 0)

registerOperator({
  id: 'view.camera',
  label: 'Camera view',
  section: 'View',
  shortcut: 'Numpad 0',
  description: 'Look through the active camera.',
  params: [],
  defaults: {},
  history: false,
  available: (context) => (context.document.objects.some((object) => object.data.kind === 'camera' && object.data.active)
    ? true
    : 'This scene has no active camera.'),
  run: (context) => {
    const camera = context.document.objects.find((object) => object.data.kind === 'camera' && object.data.active)
    if (!camera) return { error: 'This scene has no active camera.' }
    // Standing where the camera stands is a first approximation; the passe-partout view that
    // shows what the camera will render arrives with the camera prompt.
    const [x, y, z] = camera.transform.position
    const [rx, , rz] = camera.transform.rotation
    return {
      document: withView(context.document, {
        // A camera aims down its own -Z; the view's pitch is measured from the ground plane.
        yaw: wrapYaw(180 - rz),
        pitch: clampPitch(rx - 90),
        target: [x, y, z],
        distance: Math.max(context.document.view.distance, 0.01),
      }),
      label: 'Camera view',
    }
  },
})

registerOperator({
  id: 'view.local',
  label: 'Local view',
  section: 'View',
  shortcut: 'Numpad /',
  description: 'Hide everything but the selection, and frame it.',
  params: [switchParam('frame', 'Frame the selection', true)],
  defaults: { frame: true },
  history: false,
  available: (context) => (context.selection.objectIds.length > 0 || (context.document.view.localObjectIds?.length ?? 0) > 0
    ? true
    : 'Select something to look at on its own.'),
  run: (context, params) => {
    const active = context.document.view.localObjectIds ?? []
    if (active.length > 0) {
      const view: Partial<ViewState> = { localObjectIds: [] }
      return { document: withView(context.document, view), label: 'Leave local view' }
    }
    const ids = context.selection.objectIds
    const box = sceneBounds(context.document, ids)
    const framed = box && params.frame
      ? frameBox(paddedBounds(box), { fovDegrees: fovFromFocalLength(context.document.view.focalLength), aspect: 16 / 9 })
      : null
    return {
      document: withView(context.document, {
        localObjectIds: ids,
        ...(framed ? { target: framed.target, distance: framed.distance } : {}),
      }),
      label: 'Local view',
    }
  },
})
