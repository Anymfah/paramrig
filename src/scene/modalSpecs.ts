import type { ModalSpec } from '@/scene/modalOperator'
import type { OperatorParams } from '@/scene/operators'
import type { Vec3 } from '@/scene/types'

/**
 * Which parameter the pointer drives, for every modal modelling operator.
 *
 * This is the only place that knows a bevel's width follows the pointer while its segments follow
 * the wheel. The operators themselves stay pure functions of their parameters — which is what lets
 * the F9 panel replay one — and the gesture is described here, beside every other gesture, so that
 * they can be compared and kept alike.
 */

/** Rounds for a readout: three decimals is a millimetre, which is as fine as anyone reads. */
function metres(value: unknown): string {
  const number = Number(value) || 0
  return `${number.toFixed(3)} m`
}

function factor(value: unknown): string {
  return (Number(value) || 0).toFixed(3)
}

function along(vector: unknown): string {
  const value = Array.isArray(vector) ? vector as number[] : [0, 0, 0]
  const distance = Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0)
  return `${distance.toFixed(3)} m`
}

export type ModalContext = {
  /** The frame of what is selected: an extrusion leaves along it. */
  normal: Vec3 | null
  /** The edge under the pointer, which a loop cut and a vertex slide are about. */
  edge?: number
}

export function modalSpecFor(operatorId: string, context: ModalContext): ModalSpec | null {
  const normal = context.normal ?? [0, 0, 1]
  switch (operatorId) {
    case 'mesh.extrudeRegion':
    case 'mesh.extrudeEdges':
    case 'mesh.extrudeVertices':
    case 'mesh.extrudeManifold':
      return {
        operatorId,
        drive: { param: 'offset', kind: 'vector', direction: normal },
        readout: (params) => along(params.offset),
      }
    case 'mesh.extrudeAlongNormals':
    case 'mesh.extrudeIndividual':
      return {
        operatorId,
        drive: { param: 'offset', kind: 'distance' },
        keys: [{ code: 'KeyE', param: 'offsetEven', label: 'even', kind: 'toggle' }],
        readout: (params) => metres(params.offset),
      }
    case 'mesh.inset':
      return {
        operatorId,
        drive: { param: 'thickness', kind: 'distance', min: 0 },
        keys: [
          { code: 'KeyI', param: 'individual', label: 'individual', kind: 'toggle' },
          { code: 'KeyB', param: 'boundary', label: 'boundary', kind: 'toggle' },
          { code: 'KeyO', param: 'outset', label: 'outset', kind: 'toggle' },
        ],
        readout: (params) => `Thickness ${metres(params.thickness)} · Depth ${metres(params.depth)}`,
      }
    case 'mesh.bevelEdges':
    case 'mesh.bevelVertices':
      return {
        operatorId,
        drive: { param: 'width', kind: 'distance', min: 0 },
        wheel: { param: 'segments', step: 1, min: 1, max: 32 },
        keys: [
          { code: 'KeyC', param: 'clampOverlap', label: 'clamp', kind: 'toggle' },
          { code: 'KeyP', param: 'profile', label: 'profile', kind: 'step', step: 0.1, min: 0, max: 1 },
          { code: 'KeyM', param: 'miterOuter', label: 'miter', kind: 'cycle', values: ['sharp', 'patch', 'arc'] },
        ],
        readout: (params) => `Width ${metres(params.width)} · Segments ${Number(params.segments) || 1} · Profile ${factor(params.profile)}`,
      }
    case 'mesh.loopCut':
      return {
        operatorId,
        drive: { param: 'factor', kind: 'factor', span: 160, min: -1, max: 1 },
        wheel: { param: 'cuts', step: 1, min: 1, max: 64 },
        keys: [
          { code: 'KeyE', param: 'even', label: 'even', kind: 'toggle' },
          { code: 'KeyF', param: 'flipped', label: 'flipped', kind: 'toggle' },
        ],
        ...(context.edge !== undefined ? { fixed: { edge: context.edge } as OperatorParams } : {}),
        readout: (params) => `Cuts ${Number(params.cuts) || 1} · Factor ${factor(params.factor)}`,
      }
    case 'mesh.offsetEdgeLoop':
      return {
        operatorId,
        drive: { param: 'factor', kind: 'factor', span: 160, min: -1, max: 1 },
        readout: (params) => `Factor ${factor(params.factor)}`,
      }
    case 'mesh.edgeSlide':
      return {
        operatorId,
        drive: { param: 'factor', kind: 'factor', span: 160, min: -1, max: 1 },
        keys: [
          { code: 'KeyE', param: 'even', label: 'even', kind: 'toggle' },
          { code: 'KeyF', param: 'flipped', label: 'flipped', kind: 'toggle' },
          { code: 'KeyC', param: 'clamp', label: 'clamp', kind: 'toggle' },
        ],
        readout: (params) => `Factor ${factor(params.factor)}`,
      }
    case 'mesh.vertexSlide':
      return {
        operatorId,
        drive: { param: 'factor', kind: 'factor', span: 160, min: 0, max: 1 },
        ...(context.edge !== undefined ? { fixed: { edge: context.edge } as OperatorParams } : {}),
        readout: (params) => `Factor ${factor(params.factor)}`,
      }
    case 'mesh.shrinkFatten':
      return {
        operatorId,
        drive: { param: 'offset', kind: 'distance' },
        keys: [{ code: 'KeyE', param: 'even', label: 'even thickness', kind: 'toggle' }],
        readout: (params) => `Offset ${metres(params.offset)}`,
      }
    case 'mesh.pushPull':
      return {
        operatorId,
        drive: { param: 'offset', kind: 'distance' },
        readout: (params) => `Distance ${metres(params.offset)}`,
      }
    case 'mesh.toSphere':
      return {
        operatorId,
        drive: { param: 'factor', kind: 'factor', span: 200, min: 0, max: 1 },
        readout: (params) => `Factor ${factor(params.factor)}`,
      }
    case 'mesh.shear':
      return {
        operatorId,
        drive: { param: 'offset', kind: 'factor', span: 200, min: -10, max: 10, axis: 'x' },
        readout: (params) => `Offset ${factor(params.offset)}`,
      }
    case 'mesh.spin':
      return {
        operatorId,
        drive: { param: 'angle', kind: 'factor', span: 2, min: -360, max: 360, axis: 'x' },
        wheel: { param: 'steps', step: 1, min: 1, max: 128 },
        keys: [{ code: 'KeyD', param: 'duplicates', label: 'duplicates', kind: 'toggle' }],
        readout: (params) => `${(Number(params.angle) || 0).toFixed(1)}° · Steps ${Number(params.steps) || 1}`,
      }
    case 'mesh.screw':
      return {
        operatorId,
        drive: { param: 'turns', kind: 'factor', span: 200, min: 1, max: 32 },
        wheel: { param: 'steps', step: 1, min: 3, max: 128 },
        readout: (params) => `Turns ${factor(params.turns)} · Steps ${Number(params.steps) || 1}`,
      }
    case 'mesh.smoothVertices':
      return {
        operatorId,
        drive: { param: 'factor', kind: 'factor', span: 200, min: 0, max: 1 },
        wheel: { param: 'repeat', step: 1, min: 1, max: 32 },
        readout: (params) => `Factor ${factor(params.factor)}`,
      }
    case 'mesh.randomize':
      return {
        operatorId,
        drive: { param: 'amount', kind: 'distance', min: 0 },
        readout: (params) => `Amount ${metres(params.amount)}`,
      }
    case 'mesh.solidify':
      return {
        operatorId,
        drive: { param: 'thickness', kind: 'distance' },
        readout: (params) => `Thickness ${metres(params.thickness)}`,
      }
    case 'mesh.wireframe':
      return {
        operatorId,
        drive: { param: 'thickness', kind: 'distance', min: 0 },
        readout: (params) => `Thickness ${metres(params.thickness)}`,
      }
    case 'mesh.duplicate':
      return {
        operatorId,
        drive: { param: 'offset', kind: 'vector', direction: [0, 0, 1] },
        readout: (params) => along(params.offset),
      }
    case 'mesh.rip':
      return {
        operatorId,
        drive: { param: 'offset', kind: 'vector', direction: normal },
        readout: (params) => along(params.offset),
      }
    default:
      return null
  }
}

/** Whether an operator is one the pointer drives, which is what a key binding has to know. */
export function isModalOperator(operatorId: string): boolean {
  return modalSpecFor(operatorId, { normal: null }) !== null
}
