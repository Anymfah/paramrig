import { describe, expect, it } from 'vitest'
import { contourBloomManifest } from '@/rigs/examples/contour-bloom'
import { surfaceStudiesManifest } from '@/rigs/examples/surface-studies'
import { tidalPlanetManifest } from '@/rigs/examples/tidal-planet'
import { typeSpecimenManifest } from '@/rigs/examples/type-specimen'
import { ancestorPaths, buildNavTree, compactNavItems } from '@/rigs/nav-tree'

describe('buildNavTree', () => {
  it('groups rigs by Storybook-style title paths', () => {
    const tree = buildNavTree([
      contourBloomManifest,
      tidalPlanetManifest,
      surfaceStudiesManifest,
      typeSpecimenManifest,
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ kind: 'folder', path: 'Examples', label: 'Examples' })
    if (tree[0]?.kind !== 'folder') throw new Error('expected folder')
    const labels = tree[0].children.map((child) => (child.kind === 'folder' ? child.label : child.rig.name))
    expect(labels).toEqual(['3D', 'HTML', 'SVG'])
    const html = tree[0].children.find((child) => child.kind === 'folder' && child.path === 'Examples/HTML')
    expect(html?.kind).toBe('folder')
    if (html?.kind !== 'folder') throw new Error('expected HTML folder')
    expect(html.children.map((leaf) => (leaf.kind === 'rig' ? leaf.rig.id : leaf.path))).toEqual([
      'surface-studies',
      'type-specimen',
    ])
  })

  it('lists ancestor folder paths for the active rig', () => {
    expect(ancestorPaths(surfaceStudiesManifest)).toEqual(['Examples', 'Examples/HTML'])
  })

  it('collapses a compact rail to rigs and multi-child folders', () => {
    const items = compactNavItems(
      buildNavTree([
        contourBloomManifest,
        tidalPlanetManifest,
        surfaceStudiesManifest,
        typeSpecimenManifest,
      ]),
    )
    expect(items.map((item) => (item.kind === 'rig' ? item.rig.id : item.folder.label))).toEqual([
      'tidal-planet',
      'HTML',
      'contour-bloom',
    ])
    const html = items.find((item) => item.kind === 'folder')
    expect(html?.kind).toBe('folder')
    if (html?.kind !== 'folder') throw new Error('expected HTML folder')
    expect(html.rigs.map((rig) => rig.id)).toEqual(['surface-studies', 'type-specimen'])
  })
})
