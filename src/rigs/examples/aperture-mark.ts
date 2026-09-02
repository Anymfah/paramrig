import type { VectorDocument } from '@/vector/types'

/**
 * A vector document that carries its own controls: a ring with an opening, a rounded core, and one
 * colour behind both. It ships with the app so there is always a worked example of the format on
 * hand — the same file "Save as…" writes, read by the same code that reads an imported one.
 */
export const APERTURE_MARK_ID = 'vector-example-aperture-mark'

export const apertureMarkDocument: VectorDocument = {
  version: 1,
  id: APERTURE_MARK_ID,
  name: 'Aperture mark',
  background: '#101211',
  width: 400,
  height: 400,
  elements: [
    {
      id: 'ring',
      kind: 'ellipse',
      name: 'Ring',
      x: 60, y: 60, width: 280, height: 280, rotation: -30,
      fill: 'none',
      stroke: '#8CBDA8',
      strokeWidth: 24,
      strokeCap: 'round',
      arcStart: 0,
      arcSweep: 300,
      arcRatio: 0,
      opacity: 1,
      visible: true,
      locked: false,
    },
    {
      id: 'core',
      kind: 'rectangle',
      name: 'Core',
      x: 150, y: 150, width: 100, height: 100, rotation: 0,
      fill: '#D4E7E1',
      stroke: 'none',
      strokeWidth: 0,
      cornerRadius: 24,
      cornerSmoothing: 0.6,
      opacity: 1,
      visible: true,
      locked: false,
    },
  ],
  guides: [],
  rig: {
    groups: [{ id: 'mark', label: 'Mark' }],
    parameters: [
      { kind: 'color', id: 'ink', label: 'Ink', group: 'mark', defaultValue: '#8CBDA8' },
      { kind: 'color', id: 'core-ink', label: 'Core ink', group: 'mark', defaultValue: '#D4E7E1' },
      { kind: 'number', id: 'radius', label: 'Corner radius', group: 'mark', min: 0, max: 50, step: 1, unit: 'px', defaultValue: 24 },
      { kind: 'number', id: 'opening', label: 'Opening', group: 'mark', min: 20, max: 360, step: 1, unit: '°', defaultValue: 300 },
      { kind: 'number', id: 'weight', label: 'Ring weight', group: 'mark', min: 4, max: 60, step: 1, unit: 'px', defaultValue: 24 },
    ],
    bindings: [
      { id: 'ring-ink', elementId: 'ring', property: 'stroke', parameterId: 'ink' },
      { id: 'ring-weight', elementId: 'ring', property: 'strokeWidth', parameterId: 'weight' },
      { id: 'ring-opening', elementId: 'ring', property: 'arcSweep', parameterId: 'opening' },
      { id: 'core-ink', elementId: 'core', property: 'fill', parameterId: 'core-ink' },
      { id: 'core-radius', elementId: 'core', property: 'cornerRadius', parameterId: 'radius' },
      // The core keeps step with the ring: half its weight away from square, whatever the weight.
      { id: 'core-size', elementId: 'core', property: 'width', parameterId: 'weight', transform: { expression: '160 - value * 1.5', min: 40, max: 220 } },
      { id: 'core-height', elementId: 'core', property: 'height', parameterId: 'weight', transform: { expression: '160 - value * 1.5', min: 40, max: 220 } },
    ],
  },
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
}

/** The vector documents that ship with the app, offered until they are edited and stored. */
export const BUNDLED_DOCUMENTS: VectorDocument[] = [apertureMarkDocument]
