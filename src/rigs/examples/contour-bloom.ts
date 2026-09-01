import type { RigManifest } from '@/rigs/types'
import { defaultCurve } from '@/state/values'

export const contourBloomManifest: RigManifest = {
  id: 'contour-bloom',
  name: 'Contour bloom',
  summary: 'SVG · Shape, relief and motion',
  description: 'A shape study with layered contours. Tune the silhouette, relief and motion.',
  renderer: 'svg',
  rendererLabel: 'SVG',
  collection: 'examples',
  title: 'Examples/SVG',
  sourceFile: 'examples/contour-bloom.rig.tsx',
  tags: ['svg', 'shape', 'relief'],
  groups: [
    { id: 'shape', label: 'Shape' },
    { id: 'relief', label: 'Relief' },
    { id: 'surface', label: 'Surface' },
  ],
  parameters: [
    { kind: 'number', id: 'lobes', label: 'Lobes', group: 'shape', min: 3, max: 16, step: 1, defaultValue: 6 },
    { kind: 'number', id: 'amplitude', label: 'Amplitude', group: 'shape', min: 0, max: 0.6, step: 0.01, defaultValue: 0.18 },
    { kind: 'number', id: 'twist', label: 'Twist', group: 'shape', min: -120, max: 120, step: 1, unit: '°', defaultValue: 24, sliderMin: -60, sliderMax: 60 },
    { kind: 'number', id: 'layers', label: 'Layers', group: 'relief', min: 4, max: 64, step: 1, defaultValue: 38 },
    { kind: 'number', id: 'depth', label: 'Depth', group: 'relief', min: 0.1, max: 0.95, step: 0.01, defaultValue: 0.72 },
    { kind: 'color', id: 'ink', label: 'Ink', group: 'surface', defaultValue: '#1C201C' },
    { kind: 'curve', id: 'edgeSoftness', label: 'Edge softness', group: 'surface', defaultValue: defaultCurve() },
  ],
}
