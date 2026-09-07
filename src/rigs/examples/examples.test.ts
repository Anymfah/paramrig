import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { listExampleRigs } from '@/rigs/registry'
import { apertureMarkDocument } from '@/rigs/examples/aperture-mark'
import { aperturePosterDocument } from '@/rigs/examples/aperture-poster'
import { paperLantern } from '@/rigs/examples/paper-lantern'
import { vectorManifest } from '@/vector/document'
import { sceneManifest } from '@/scene/document'
import type { RigManifest } from '@/rigs/types'

/*
 * What the shipped examples promise about themselves.
 *
 * Both of these were wrong and neither showed up in a test: four of the five named a `sourceFile`
 * that has never existed — `examples/contour-bloom.rig.tsx` and its three siblings — and the
 * controller lab was the one card in the library whose summary did not begin with what renders it,
 * so it sat out of line with every other card in the grid.
 */
const shipped = (): RigManifest[] => [
  ...listExampleRigs(),
  vectorManifest(apertureMarkDocument),
  vectorManifest(aperturePosterDocument),
  sceneManifest(paperLantern()),
]

describe('the examples that ship with the app', () => {
  it('name a source file that is really there', () => {
    const missing = shipped()
      .map((rig) => ({ rig: rig.name, file: rig.sourceFile }))
      .filter((entry) => !existsSync(resolve(process.cwd(), entry.file)))
    expect(missing).toEqual([])
  })

  it('introduce themselves the same way, so the library grid reads as one column', () => {
    const odd = shipped()
      .map((rig) => ({ rig: rig.name, summary: rig.summary, label: rig.rendererLabel }))
      .filter((entry) => !entry.summary.startsWith(`${entry.label} · `))
    expect(odd).toEqual([])
  })

  it('are filed under Examples, and say what they are', () => {
    for (const rig of shipped()) {
      expect(rig.collection).toBe('examples')
      expect(rig.title.startsWith('Examples/')).toBe(true)
      expect(rig.name.length).toBeGreaterThan(0)
      expect(rig.description.length === 0 || rig.description.endsWith('.')).toBe(true)
    }
  })
})
