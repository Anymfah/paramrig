import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSceneDocument } from '@/scene/document'
import { SceneEditorPage } from '@/scene/SceneEditorPage'
import type { SceneViewport } from '@/scene/viewport/SceneViewport'

/**
 * The page, with a viewport that is not three.js.
 *
 * jsdom has no WebGL, and asking it for one would make every test of the chrome depend on a canvas
 * it cannot make. The page takes a `createViewport`, so the double below records what it is told
 * and answers the few questions the chrome asks — which is enough to prove the page mounts, wires
 * the document through, and puts the panels where they belong.
 */

type Recorded = {
  documents: number
  selections: number
  views: number
  disposed: number
}

function createViewportDouble(recorded: Recorded): (container: HTMLElement) => SceneViewport {
  return (container: HTMLElement) => {
    const canvas = window.document.createElement('canvas')
    canvas.className = 'scene-canvas'
    container.appendChild(canvas)
    const nothing = () => undefined
    const double = {
      canvas,
      ok: true,
      pixelSize: { width: 800, height: 600 },
      setDocument: () => { recorded.documents += 1 },
      setSelection: () => { recorded.selections += 1 },
      setView: () => { recorded.views += 1 },
      setHover: nothing,
      setTheme: nothing,
      setGizmos: nothing,
      setGizmoHover: nothing,
      gizmoHandle: () => null,
      unitsPerPixelAt: () => 0.01,
      invalidate: nothing,
      render: nothing,
      resize: nothing,
      dispose: () => { recorded.disposed += 1; canvas.remove() },
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
}

function open(recorded: Recorded, documentId: string) {
  return render(
    <MemoryRouter>
      <SceneEditorPage
        documentId={documentId}
        mode="edit"
        onMode={vi.fn()}
        createViewport={createViewportDouble(recorded)}
      />
    </MemoryRouter>,
  )
}

let documentId = ''
let recorded: Recorded

beforeEach(() => {
  localStorage.clear()
  documentId = createSceneDocument('Bench').id
  recorded = { documents: 0, selections: 0, views: 0, disposed: 0 }
})

describe('the scene editor page', () => {
  it('mounts a viewport once and tells it about the document', () => {
    open(recorded, documentId)

    expect(window.document.querySelector('.scene-canvas')).toBeInTheDocument()
    expect(recorded.documents).toBeGreaterThan(0)
    expect(recorded.views).toBeGreaterThan(0)
  })

  it('puts the outliner, the viewport and the properties where the shell expects them', () => {
    open(recorded, documentId)

    expect(screen.getByRole('tree', { name: 'Scene contents' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Scene tools' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Properties' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Bench' })).toBeInTheDocument()
  })

  it('lists the startup scene in the outliner', () => {
    open(recorded, documentId)
    const tree = screen.getByRole('tree', { name: 'Scene contents' })

    for (const name of ['Scene Collection', 'Cube', 'Light', 'Camera']) {
      expect(within(tree).getByText(name)).toBeInTheDocument()
    }
  })

  it('counts the scene in the status bar', () => {
    open(recorded, documentId)

    expect(screen.getByText('Objects 0/3')).toBeInTheDocument()
    expect(screen.getByText('Vertices 8')).toBeInTheDocument()
    expect(screen.getByText('Faces 6')).toBeInTheDocument()
  })

  it('keeps the viewport for a moment when the page goes, then gives it back', () => {
    vi.useFakeTimers()
    try {
      const view = open(recorded, documentId)

      /*
       * Unmounting no longer destroys it: switching to Tune mode unmounts this page before the
       * preview mounts, and rebuilding would mean a second WebGL context and a black frame. It is
       * kept for a moment, and given back when nobody comes for it.
       */
      view.unmount()
      expect(recorded.disposed).toBe(0)

      vi.advanceTimersByTime(10_000)
      expect(recorded.disposed).toBe(1)
      expect(window.document.querySelector('.scene-canvas')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says so, rather than showing an empty editor, when the scene is not in this browser', () => {
    open(recorded, 'scene-nobody')

    expect(screen.getByRole('alert')).toHaveTextContent('That scene is not in this browser.')
  })
})
