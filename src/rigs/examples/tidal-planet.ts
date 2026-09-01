import type { RigManifest } from '@/rigs/types'

export const tidalPlanetManifest: RigManifest = {
  id: 'tidal-planet',
  name: 'Tidal planet',
  summary: '3D · Minimal procedural planet',
  description: 'Helios Ray terrain architecture reduced to one restrained ParamRig surface.',
  renderer: 'three',
  rendererLabel: '3D',
  collection: 'examples',
  title: 'Examples/3D',
  sourceFile: 'examples/tidal-planet.rig.tsx',
  tags: ['3d', 'procedural', 'terrain', 'minimal'],
  inspectorCategories: [
    { id: 'surface', label: 'Surface' },
    { id: 'light', label: 'Light' },
    { id: 'motion', label: 'Motion' },
  ],
  groups: [
    { id: 'form', label: 'Planet', tab: 'surface' },
    { id: 'material', label: 'Material', tab: 'surface' },
    { id: 'lighting', label: 'Lighting', tab: 'light' },
    { id: 'animation', label: 'Rotation', tab: 'motion' },
  ],
  parameters: [
    { kind: 'number', id: 'seed', label: 'Seed', group: 'form', min: 1, max: 9999, step: 1, defaultValue: 4817 },
    { kind: 'number', id: 'planetScale', label: 'Landform scale', group: 'form', min: 0.3, max: 1.35, step: 0.01, defaultValue: 0.78 },
    { kind: 'number', id: 'planetRelief', label: 'Relief', group: 'form', min: 0.012, max: 0.11, step: 0.001, defaultValue: 0.052 },
    { kind: 'number', id: 'surfaceDetail', label: 'Detail', group: 'form', min: 3, max: 10, step: 1, defaultValue: 7 },
    {
      kind: 'gradient',
      id: 'terrainPalette',
      label: 'Surface palette',
      group: 'material',
      defaultValue: [
        { t: 0, color: '#222324' },
        { t: 0.1, color: '#343837' },
        { t: 0.13, color: '#68706c' },
        { t: 0.42, color: '#929793' },
        { t: 0.72, color: '#c6c6c6' },
        { t: 1, color: '#f2f2f2' },
      ],
    },
    { kind: 'number', id: 'surfaceRoughness', label: 'Roughness', group: 'material', min: 0, max: 1, step: 0.01, defaultValue: 0.52 },
    { kind: 'number', id: 'keyDirection', label: 'Light direction', group: 'lighting', min: 0, max: 360, step: 1, unit: '°', defaultValue: 32 },
    { kind: 'number', id: 'keyElevation', label: 'Elevation', group: 'lighting', min: -20, max: 80, step: 1, unit: '°', defaultValue: 26 },
    { kind: 'number', id: 'lightAmbient', label: 'Ambient light', group: 'lighting', min: 0.2, max: 0.85, step: 0.01, defaultValue: 0.58 },
    { kind: 'number', id: 'lightIntensity', label: 'Key light', group: 'lighting', min: 0.3, max: 1.4, step: 0.01, defaultValue: 1.02 },
    { kind: 'number', id: 'exposure', label: 'Exposure', group: 'lighting', min: 0.7, max: 1.35, step: 0.01, defaultValue: 1.05 },
    { kind: 'number', id: 'rotationY', label: 'Rotation Y', group: 'animation', min: 0, max: 360, step: 1, unit: '°', defaultValue: 0 },
    {
      kind: 'select',
      id: 'interpolation',
      label: 'Interpolation',
      group: 'animation',
      defaultValue: 'linear',
      appliesToTracks: true,
      options: [
        { value: 'linear', label: 'Linear' },
        { value: 'step', label: 'Step' },
      ],
    },
  ],
  animation: {
    duration: 8,
    fps: 30,
    loop: true,
    tracks: [
      {
        paramId: 'rotationY',
        interpolation: 'linear',
        keyframes: [
          { time: 0, value: 0 },
          { time: 2.4, value: 108 },
          { time: 8, value: 360 },
        ],
      },
      {
        paramId: 'keyDirection',
        interpolation: 'linear',
        keyframes: [
          { time: 0, value: 32 },
          { time: 2.4, value: 32 },
          { time: 8, value: 32 },
        ],
      },
    ],
  },
}
