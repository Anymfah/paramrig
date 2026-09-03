import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveBadgeLabel as sharedBadgeLabel } from '@/editor/useProjectFile'
import { createSceneDocument, getSceneDocument } from '@/scene/document'
import { sceneThumbnail } from '@/scene/io/thumbnail'
import { SCENE_PROJECT_FORMAT, saveBadgeLabel, useSceneFile } from '@/scene/useSceneFile'
import type { SceneDocument, SceneObject, Vec3 } from '@/scene/types'

describe('the scene project format', () => {
  it('refuses a vector project by name rather than by failing to read it', () => {
    const vectorFile = JSON.stringify({ format: 'paramrig.vector', formatVersion: 1, document: { id: 'v', name: 'Poster' } })

    const result = SCENE_PROJECT_FORMAT.parse(vectorFile)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('vector document')
  })

  it('refuses a file that is not a project at all', () => {
    expect(SCENE_PROJECT_FORMAT.parse('not json').ok).toBe(false)
    expect(SCENE_PROJECT_FORMAT.parse('{"format":"something.else"}').ok).toBe(false)
  })

  it('reads back a scene it wrote', () => {
    const document = createSceneDocument('Round trip')

    const read = SCENE_PROJECT_FORMAT.parse(SCENE_PROJECT_FORMAT.serialize(document))

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.document.id).toBe(document.id)
    expect(read.document.name).toBe('Round trip')
    expect(read.document.objects.map((object) => object.name)).toEqual(document.objects.map((object) => object.name))
    expect(Object.keys(read.document.meshes)).toEqual(Object.keys(document.meshes))
  })

  it('names the file after the scene', () => {
    expect(SCENE_PROJECT_FORMAT.fileName(createSceneDocument('A Small Study'))).toBe('a-small-study.paramrig.json')
  })

  it('tells the library which editor opens the entry, and what it looks like', () => {
    const recent = SCENE_PROJECT_FORMAT.recent(createSceneDocument('Boxes'))

    expect(recent.kind).toBe('scene')
    expect(recent.thumbnail?.startsWith('data:image/svg+xml')).toBe(true)
  })
})

describe('the autosave badge', () => {
  it('is the one every editor shows', () => {
    expect(saveBadgeLabel).toBe(sharedBadgeLabel)
    expect(saveBadgeLabel({ state: 'pending', savedAt: null })).toBe('Unsaved changes')
    expect(saveBadgeLabel({ state: 'saved', savedAt: '2026-09-02T10:04:00.000Z' })).toMatch(/^Saved · \d\d:\d\d$/)
  })
})

describe('autosaving a scene', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('writes the scene to browser storage once the pause is over', () => {
    const document = createSceneDocument('Untitled')
    const { rerender } = renderHook(({ value }: { value: SceneDocument }) => useSceneFile(value), {
      initialProps: { value: document },
    })

    rerender({ value: { ...document, name: 'Renamed' } })
    expect(getSceneDocument(document.id)?.name).toBe('Untitled')

    act(() => { vi.advanceTimersByTime(900) })

    expect(getSceneDocument(document.id)?.name).toBe('Renamed')
  })
})

describe('the scene thumbnail', () => {
  const DATA_PREFIX = 'data:image/svg+xml,'

  const markupOf = (url: string) => decodeURIComponent(url.slice(DATA_PREFIX.length))

  /** The startup cube, repeated across a grid, which is the heaviest shape a card ever gets. */
  function sceneOf(count: number): SceneDocument {
    const base = createSceneDocument('Many')
    const cube = base.objects.find((object) => object.kind === 'mesh')
    if (!cube) throw new Error('the startup file no longer opens with a mesh')
    const objects: SceneObject[] = []
    for (let index = 0; index < count; index += 1) {
      const position: Vec3 = [index % 20, Math.floor(index / 20), (index % 7) * 0.5]
      objects.push({ ...cube, id: `object-${index}`, name: `Cube ${index}`, transform: { ...cube.transform, position } })
    }
    return { ...base, objects }
  }

  it('is a data URL, drawn without a WebGL context', () => {
    const url = sceneThumbnail(createSceneDocument('Boxes'))

    expect(url.startsWith(DATA_PREFIX)).toBe(true)
    expect(markupOf(url)).toContain('<svg')
    expect(markupOf(url)).toContain('<path')
  })

  it('is drawn at the size it was asked for', () => {
    expect(markupOf(sceneThumbnail(createSceneDocument('Boxes'), { size: 96 }))).toContain("viewBox='0 0 96 96'")
  })

  it('stays well under the 40 kB the recent-projects store keeps, for two hundred objects', () => {
    expect(sceneThumbnail(sceneOf(200)).length).toBeLessThan(20_000)
  })

  it('draws the same picture twice for the same scene', () => {
    const document = sceneOf(12)

    expect(sceneThumbnail(document)).toBe(sceneThumbnail(document))
  })

  it('carries no identifier and no timestamp that would change between two draws', () => {
    const document = sceneOf(12)

    const markup = markupOf(sceneThumbnail(document))

    expect(markup).not.toContain(document.id)
    expect(markup).not.toContain('object-3')
    expect(markup).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('draws nothing for a scene with nothing visible in it', () => {
    const document = createSceneDocument('Hidden')
    const hidden = { ...document, objects: document.objects.map((object) => ({ ...object, visible: false })) }

    const markup = markupOf(sceneThumbnail(hidden))

    expect(markup).toContain('<svg')
    expect(markup).not.toContain('<path')
  })
})
