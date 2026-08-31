import type { RigManifest } from '@/rigs/types'

export const tidalPlanetManifest: RigManifest = {
  id: 'tidal-planet',
  name: 'Tidal planet',
  summary: '3D · Surface, atmosphere and orbit',
  description: 'A bounded planetary study. Shape terrain, atmosphere and a short orbital loop.',
  renderer: 'three',
  rendererLabel: '3D',
  collection: 'examples',
  sourceFile: 'examples/tidal-planet.rig.tsx',
  tags: ['3d', 'atmosphere', 'orbit'],
  groups: [
    { id: 'surface', label: 'Surface' },
    { id: 'atmosphere', label: 'Atmosphere' },
    { id: 'animation', label: 'Animation' },
  ],
  parameters: [
    { kind: 'number', id: 'seed', label: 'Seed', group: 'surface', min: 1, max: 9999, step: 1, defaultValue: 4817 },
    { kind: 'number', id: 'terrainScale', label: 'Terrain scale', group: 'surface', min: 0.4, max: 4, step: 0.01, defaultValue: 2.4 },
    { kind: 'number', id: 'ridgeStrength', label: 'Ridge strength', group: 'surface', min: 0, max: 1, step: 0.01, defaultValue: 0.62 },
    {
      kind: 'gradient',
      id: 'elevation',
      label: 'Elevation palette',
      group: 'surface',
      defaultValue: [
        { t: 0, color: '#263D42' },
        { t: 0.5, color: '#819893' },
        { t: 1, color: '#E2DDBC' },
      ],
    },
    { kind: 'number', id: 'atmosphere', label: 'Density', group: 'atmosphere', min: 0, max: 1, step: 0.01, defaultValue: 0.28 },
    { kind: 'number', id: 'lightAngle', label: 'Light direction', group: 'atmosphere', min: 0, max: 360, step: 1, unit: '°', defaultValue: 12 },
    { kind: 'number', id: 'rotationY', label: 'Rotation Y', group: 'animation', min: 0, max: 360, step: 1, unit: '°', defaultValue: 0 },
    { kind: 'number', id: 'cloudDrift', label: 'Cloud drift', group: 'animation', min: 0, max: 1, step: 0.01, defaultValue: 0 },
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
        paramId: 'cloudDrift',
        interpolation: 'linear',
        keyframes: [
          { time: 0, value: 0 },
          { time: 5, value: 0.24 },
          { time: 8, value: 1 },
        ],
      },
      {
        paramId: 'lightAngle',
        interpolation: 'linear',
        keyframes: [
          { time: 0, value: 12 },
          { time: 2.4, value: 36 },
          { time: 8, value: 300 },
        ],
      },
    ],
  },
}
