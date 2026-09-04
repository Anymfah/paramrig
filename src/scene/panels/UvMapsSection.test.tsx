import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { activeUvIndex, addUvMap, uvMapsOf, withUvMaps } from '@/scene/mesh/uv'
import { UvMapsSection } from '@/scene/panels/UvMapsSection'
import type { MeshData, SceneDocument } from '@/scene/types'

/**
 * Data > UV maps. Every case here is the same shape: press something, and read back the document
 * the panel asked for — because the panel's whole job is to turn a press into one document edit
 * with a name the history can show.
 */

const MESH_ID = 'mesh-cube'

afterEach(cleanup)

function scene(mesh: MeshData): SceneDocument {
  return {
    version: 1,
    id: 'scene-test',
    name: 'Test scene',
    objects: [],
    meshes: { [MESH_ID]: mesh },
    collections: [{ id: 'scene-collection', name: 'Scene Collection' }],
    materials: [],
    world: { color: '#3b3b3b', strength: 1 },
    cursor: { position: [0, 0, 0], rotation: [0, 0, 0] },
    view: structuredClone(DEFAULT_VIEW),
    units: { system: 'metric', scale: 1 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function setup(mesh = boxMesh(2)) {
  const edits: Array<{ label: string; mesh: MeshData }> = []
  const document = scene(mesh)
  const onEditDocument = vi.fn((edit: (current: SceneDocument) => SceneDocument, label: string) => {
    edits.push({ label, mesh: edit(document).meshes[MESH_ID]! })
  })
  render(
    <UvMapsSection
      mesh={mesh}
      meshId={MESH_ID}
      onEditDocument={onEditDocument}
      isOpen={() => true}
      onSection={vi.fn()}
    />,
  )
  return { edits }
}

describe('Data > UV maps', () => {
  it('lists the maps a mesh carries and marks the active one', () => {
    setup(addUvMap(boxMesh(2)))
    expect(screen.getByRole('button', { name: 'UVMap' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'UVMap.001' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says a mesh has none, and how to give it one', () => {
    setup(withUvMaps(boxMesh(2), []))
    expect(screen.getByText(/no UV map/)).toBeInTheDocument()
  })

  it('adds a map, as one named edit', () => {
    const { edits } = setup()
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    expect(edits).toHaveLength(1)
    expect(edits[0]!.label).toBe('Add UV map')
    expect(uvMapsOf(edits[0]!.mesh).map((map) => map.name)).toEqual(['UVMap', 'UVMap.001'])
  })

  it('makes a row active by pressing its name, and does nothing when it already is', () => {
    const { edits } = setup(addUvMap(boxMesh(2)))
    fireEvent.click(screen.getByRole('button', { name: 'UVMap' }))
    expect(edits[0]!.label).toBe('Active UV map')
    expect(activeUvIndex(edits[0]!.mesh)).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'UVMap.001' }))
    expect(edits).toHaveLength(1)
  })

  it('renames from the row, and keeps Escape as a way out', () => {
    const { edits } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Rename UVMap' }))
    const field = screen.getByRole('textbox', { name: 'Rename UVMap' })
    fireEvent.change(field, { target: { value: 'Lightmap' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(edits[0]!.label).toBe('Rename UV map')
    expect(uvMapsOf(edits[0]!.mesh)[0]!.name).toBe('Lightmap')

    fireEvent.click(screen.getByRole('button', { name: 'Rename UVMap' }))
    const again = screen.getByRole('textbox', { name: 'Rename UVMap' })
    fireEvent.change(again, { target: { value: 'Thrown away' } })
    fireEvent.keyDown(again, { key: 'Escape' })
    expect(edits).toHaveLength(1)
  })

  it('removes a map', () => {
    const { edits } = setup(addUvMap(boxMesh(2)))
    fireEvent.click(screen.getByRole('button', { name: 'Remove UVMap' }))
    expect(edits[0]!.label).toBe('Remove UV map')
    expect(uvMapsOf(edits[0]!.mesh).map((map) => map.name)).toEqual(['UVMap.001'])
  })

  it('refuses a ninth map, and says why rather than going quiet', () => {
    let mesh = boxMesh(2)
    for (let index = 0; index < 8; index += 1) mesh = addUvMap(mesh)
    setup(mesh)
    expect(screen.getByRole('button', { name: /Add/ })).toBeDisabled()
  })
})
