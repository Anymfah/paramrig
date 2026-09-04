import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import '@/scene/modifiers'
import { paperLantern } from '@/rigs/examples/paper-lantern'
import { SceneRigPreview } from '@/renderers/scene/SceneRigPreview'
import { saveSceneDocument, sceneManifest } from '@/scene/document'
import { clearSceneRigCache } from '@/scene/rig'
import { dropSceneViewport } from '@/scene/viewport/keep'
import type { SceneDocument } from '@/scene/types'
import type { SceneViewport } from '@/scene/viewport/SceneViewport'
import { RigSession } from '@/state/session'

/**
 * Tune mode, with a viewport that is not three.js.
 *
 * What the preview owes the workbench is that the document reaching the viewport is the resolved
 * one, and that it is resolved again when a control moves — so the double records the documents it
 * is handed and the test reads the numbers out of them.
 */

const documents: SceneDocument[] = []

function createViewportDouble(container: HTMLElement): SceneViewport {
  const canvas = window.document.createElement('canvas')
  canvas.className = 'scene-canvas'
  container.appendChild(canvas)
  const nothing = () => undefined
  const double = {
    canvas,
    ok: true,
    pixelSize: { width: 800, height: 600 },
    setDocument: (next: SceneDocument) => { documents.push(next) },
    setSelection: nothing,
    setView: nothing,
    setHover: nothing,
    setTextCaret: nothing,
    setTheme: nothing,
    setGizmos: nothing,
    setGizmoHover: nothing,
    gizmoHandle: () => null,
    unitsPerPixelAt: () => 0.01,
    invalidate: nothing,
    render: nothing,
    resize: nothing,
    dispose: () => { canvas.remove() },
    reparent: (next: HTMLElement) => { next.appendChild(canvas) },
    setOptions: nothing,
    pick: () => null,
    pickObject: () => null,
    pickRegion: () => [],
    raycast: () => null,
    raycastStack: () => [],
    project: () => [400, 300] as [number, number],
    unproject: () => [0, 0, 0] as [number, number, number],
    pointOnViewPlane: () => [0, 0, 0] as [number, number, number],
    ray: () => ({ origin: [0, 0, 0] as [number, number, number], direction: [0, 1, 0] as [number, number, number] }),
    bounds: () => null,
    annotations: null,
    transformOverlay: null,
    stats: () => ({
      objects: 3, meshes: 1, vertices: 8, edges: 12, faces: 6, triangles: 12, renderedTriangles: 12,
      drawCalls: 0, frames: 0, invalidateCount: 0, geometries: 0, textures: 0, samples: 4, contextLost: 0,
    }),
  }
  return double as unknown as SceneViewport
}

function lantern(): SceneDocument {
  const document = paperLantern()
  saveSceneDocument(document)
  return document
}

function show(document: SceneDocument) {
  const session = new RigSession(sceneManifest(document))
  render(
    <SceneRigPreview
      documentId={document.id}
      session={session}
      values={session.getSnapshot().values}
      name={document.name}
      createViewport={createViewportDouble}
    />,
  )
  return session
}

beforeEach(() => {
  localStorage.clear()
  documents.length = 0
  clearSceneRigCache()
  dropSceneViewport('example-paper-lantern')
})

describe('a scene in Tune mode', () => {
  it('hands the viewport the document its controls say, not the stored one', () => {
    const document = lantern()
    show(document)
    const shown = documents.at(-1)!
    const lamp = shown.objects.find((object) => object.name === 'Lamp')!
    // The stored document and the control agree at rest, which is what a default means.
    expect(lamp.data.kind === 'light' && lamp.data.power).toBe(60)
    expect(shown).not.toBe(document)
  })

  it('resolves again when a control moves', () => {
    const document = lantern()
    const session = show(document)
    const before = documents.length
    act(() => { session.setValue('brightness', 150) })
    expect(documents.length).toBeGreaterThan(before)
    const lamp = documents.at(-1)!.objects.find((object) => object.name === 'Lamp')!
    expect(lamp.data.kind === 'light' && lamp.data.power).toBe(150)
    // And the stored document is untouched: the control is the only thing that moved.
    expect(document.objects.find((object) => object.name === 'Lamp')!.data).toMatchObject({ power: 60 })
  })

  it('drives a modifier, a material and a rotation from the same rig', () => {
    const document = lantern()
    const session = show(document)
    act(() => {
      session.setValue('roundness', 1)
      session.setValue('glow', '#00ff00')
      session.setValue('spin', 90)
    })
    const shown = documents.at(-1)!
    const object = shown.objects.find((entry) => entry.name === 'Lantern')!
    expect(object.modifiers[0]!.params.levels).toBe(1)
    expect(object.transform.rotation[2]).toBe(90)
    expect(shown.materials[0]!.emission).toBe('#00ff00')
  })

  it('says so when the scene is not in this browser', () => {
    localStorage.clear()
    render(
      <SceneRigPreview documentId="scene-missing" session={null} values={{}} name="Gone" createViewport={createViewportDouble} />,
    )
    expect(screen.getByText(/not in this browser/)).toBeTruthy()
  })
})
