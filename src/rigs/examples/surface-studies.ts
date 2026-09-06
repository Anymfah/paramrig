import type { RigManifest } from '@/rigs/types'

export const surfaceStudiesManifest: RigManifest = {
  id: 'surface-studies',
  name: 'Surface studies',
  summary: 'HTML / CSS · Material and light',
  description: 'Three material plates. Adjust light, radius and contrast without leaving the page.',
  renderer: 'html',
  rendererLabel: 'HTML / CSS',
  collection: 'examples',
  title: 'Examples/HTML',
  sourceFile: 'src/rigs/examples/surface-studies.ts',
  tags: ['html', 'material', 'light'],
  groups: [
    { id: 'light', label: 'Light' },
    { id: 'form', label: 'Form' },
  ],
  parameters: [
    { kind: 'number', id: 'azimuth', label: 'Azimuth', group: 'light', min: 0, max: 360, step: 1, unit: '°', defaultValue: 210 },
    { kind: 'number', id: 'elevation', label: 'Elevation', group: 'light', min: 4, max: 80, step: 1, unit: '°', defaultValue: 42 },
    { kind: 'number', id: 'softness', label: 'Softness', group: 'light', min: 0, max: 1, step: 0.01, defaultValue: 0.35 },
    { kind: 'number', id: 'radius', label: 'Corner radius', group: 'form', min: 0, max: 48, step: 1, unit: 'px', defaultValue: 20 },
    { kind: 'number', id: 'gap', label: 'Plate gap', group: 'form', min: 8, max: 48, step: 1, unit: 'px', defaultValue: 24 },
    { kind: 'switch', id: 'hairline', label: 'Hairline edge', group: 'form', defaultValue: true },
  ],
}
