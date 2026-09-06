import type { RigManifest } from '@/rigs/types'

export const typeSpecimenManifest: RigManifest = {
  id: 'type-specimen',
  name: 'Type specimen',
  summary: 'HTML / CSS · Rhythm and hierarchy',
  description: 'A short reading block. Size, tracking and leading stay independent so you can feel the rhythm.',
  renderer: 'html',
  rendererLabel: 'HTML / CSS',
  collection: 'examples',
  title: 'Examples/HTML',
  sourceFile: 'src/rigs/examples/type-specimen.ts',
  tags: ['html', 'type', 'rhythm'],
  groups: [
    { id: 'type', label: 'Type' },
    { id: 'measure', label: 'Measure' },
  ],
  parameters: [
    {kind:'text',id:'headline',label:'Display text',group:'type',defaultValue:'Aa'},
    {kind:'text',id:'copy',label:'Body text',group:'type',multiline:true,defaultValue:'Make it your own. Type, space, rhythm. The agent built the specimen; you decide the measure.'},
    { kind: 'number', id: 'display', label: 'Display size', group: 'type', min: 28, max: 88, step: 1, unit: 'px', defaultValue: 56 },
    { kind: 'number', id: 'body', label: 'Body size', group: 'type', min: 14, max: 24, step: 0.5, unit: 'px', defaultValue: 18 },
    { kind: 'number', id: 'tracking', label: 'Display tracking', group: 'type', min: -0.06, max: 0.04, step: 0.005, unit: 'em', defaultValue: -0.03 },
    { kind: 'number', id: 'leading', label: 'Body leading', group: 'measure', min: 1.2, max: 1.8, step: 0.05, defaultValue: 1.5 },
    { kind: 'number', id: 'measureCh', label: 'Measure', group: 'measure', min: 28, max: 72, step: 1, unit: 'ch', defaultValue: 42 },
    { kind: 'number', id: 'weight', label: 'Display weight', group: 'type', min: 400, max: 700, step: 50, defaultValue: 600 },
  ],
}
