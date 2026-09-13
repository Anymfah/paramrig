import type { RigManifest } from '@/rigs/types'
import { readProjectIndex } from '@/library/projectIndex'
import { catalog, getLoadedModule, hasModule, requiredModule } from '@/modules/registry'
import type { ProjectMetadata } from '@/modules/types'

export type LibraryFixture = 'ok' | 'empty' | 'error' | 'loading' | 'long'

export type LibraryLoad = {
  rigs: RigManifest[]
  source: 'examples' | 'mixed'
  note: string
}

// Navigation never evaluates a rig. Only getRig exposes full parameters after its module loads.
const asNavigationRig = (item: ProjectMetadata): RigManifest => ({ ...item, groups: [], parameters: [] })
const EXAMPLES = catalog.map(asNavigationRig)
function longNameStudy(): RigManifest {
  return { ...EXAMPLES.find(item => item.id === 'contour-bloom')!, id: 'long-name-study', name: 'Bartholomew Featherstonehaugh contour reconstruction', summary: 'SVG · Extremely long source paths must wrap, not clip, in the library and inspector.', title: 'Examples/SVG', sourceFile: 'examples/projects/bartholomew-featherstonehaugh/contour-reconstruction.rig.tsx' }
}
export function listExampleRigs(): RigManifest[] { return EXAMPLES }
export function listRigs(): RigManifest[] {
  const stored = readProjectIndex().filter(item => hasModule(item.module))
  const ids = new Set(stored.map(item => item.id))
  return [...stored.map(asNavigationRig), ...EXAMPLES.filter(item => !ids.has(item.id))]
}
export function getRig(id: string): RigManifest | undefined {
  const module = requiredModule(id)
  return module ? getLoadedModule(module)?.getRig(id) : undefined
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
  const local = readProjectIndex().length
  return {
    rigs: listRigs(),
    source: local ? 'mixed' : 'examples',
    note: 'Local documents and bundled example rigs.',
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
