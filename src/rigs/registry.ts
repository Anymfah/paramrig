import { controllerManifest } from '@/rigs/controller-catalog'
import { contourBloomManifest } from '@/rigs/examples/contour-bloom'
import { surfaceStudiesManifest } from '@/rigs/examples/surface-studies'
import { tidalPlanetManifest } from '@/rigs/examples/tidal-planet'
import { typeSpecimenManifest } from '@/rigs/examples/type-specimen'
import type { RigManifest } from '@/rigs/types'

export type LibraryFixture = 'ok' | 'empty' | 'error' | 'loading' | 'long'

export type LibraryLoad = {
  rigs: RigManifest[]
  source: 'examples'
  note: string
}

const EXAMPLES: RigManifest[] = [
  contourBloomManifest,
  tidalPlanetManifest,
  surfaceStudiesManifest,
  typeSpecimenManifest,
  controllerManifest,
]

function longNameStudy(): RigManifest {
  return {
    ...contourBloomManifest,
    id: 'long-name-study',
    name: 'Bartholomew Featherstonehaugh contour reconstruction',
    summary: 'SVG · Extremely long source paths must wrap, not clip, in the library and inspector.',
    title: 'Examples/SVG',
    sourceFile: 'examples/projects/bartholomew-featherstonehaugh/contour-reconstruction.rig.tsx',
  }
}

export function listExampleRigs(): RigManifest[] {
  return EXAMPLES
}

export function getRig(id: string): RigManifest | undefined {
  if (id === 'long-name-study') return longNameStudy()
  return EXAMPLES.find((rig) => rig.id === id)
}

export function parseFixture(search: string): LibraryFixture {
  const value = new URLSearchParams(search).get('fixture')
  if (value === 'empty' || value === 'error' || value === 'loading' || value === 'long') return value
  return 'ok'
}

export async function loadLibrary(fixture: LibraryFixture = 'ok'): Promise<LibraryLoad> {
  if (fixture === 'loading') {
    await new Promise<never>(() => {})
  }
  if (fixture === 'error') {
    throw new Error('The example registry could not be read. Local files were not changed.')
  }
  if (fixture === 'long') {
    return {
      rigs: [longNameStudy(), ...EXAMPLES],
      source: 'examples',
      note: 'Long-name fixture. Names and paths must wrap; they are not truncated with CSS overflow hidden.',
    }
  }
  if (fixture === 'empty') {
    return {
      rigs: [],
      source: 'examples',
      note: 'This empty state is a local fixture. Example rigs are bundled with the app, not discovered from disk.',
    }
  }
  return {
    rigs: EXAMPLES,
    source: 'examples',
    note: 'Bundled example rigs. This is not a project scan or a network connection.',
  }
}

export function searchRigs(rigs: RigManifest[], query: string): RigManifest[] {
  const q = query.trim().toLowerCase()
  if (!q) return rigs
  return rigs.filter((rig) => {
    const hay = [rig.name, rig.title, rig.summary, rig.description, rig.rendererLabel, rig.sourceFile, ...rig.tags]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}
