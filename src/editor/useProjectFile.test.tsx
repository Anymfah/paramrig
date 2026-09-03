import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useProjectFile, type ProjectFormat } from '@/editor/useProjectFile'

type Doc = { id: string; name: string }

const MAGIC = 'paramrig.test'

const format: ProjectFormat<Doc> = {
  magic: MAGIC,
  storageKey: 'paramrig.test-documents.v1',
  extension: '.paramrig.json',
  mime: 'application/json',
  pickerLabel: 'ParamRig test project',
  documentId: (document) => document.id,
  documentName: (document) => document.name,
  fileName: (document) => `${document.name}.paramrig.json`,
  serialize: (document) => JSON.stringify({ format: MAGIC, document }),
  parse: (text) => {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return { ok: false, error: 'That file is not valid JSON.' }
    }
    const source = value as { format?: unknown; document?: Doc }
    if (source.format !== MAGIC) return { ok: false, error: 'That file is not a ParamRig test project.' }
    return { ok: true, document: source.document as Doc }
  },
  save: () => ({ ok: true }),
  recent: () => ({ kind: 'scene', thumbnail: null }),
}

const document: Doc = { id: 'a', name: 'A' }

function fileOf(text: string): File {
  return { name: 'dropped.paramrig.json', text: () => Promise.resolve(text) } as unknown as File
}

describe('opening a file with the wrong marker', () => {
  it('refuses a file that belongs to another editor, and says so', async () => {
    const { result } = renderHook(() => useProjectFile<Doc>(document, format))

    let opened: Doc | null = { id: 'x', name: 'x' }
    await act(async () => {
      opened = await result.current.openFromDisk(fileOf(JSON.stringify({ format: 'paramrig.vector', document: { id: 'b', name: 'B' } })))
    })

    expect(opened).toBeNull()
    expect(result.current.state).toBe('error')
    expect(result.current.message).toBe('That file is not a ParamRig test project.')
  })

  it('opens a file that carries the right marker', async () => {
    const { result } = renderHook(() => useProjectFile<Doc>(document, format))

    let opened: Doc | null = null
    await act(async () => {
      opened = await result.current.openFromDisk(fileOf(JSON.stringify({ format: MAGIC, document: { id: 'b', name: 'B' } })))
    })

    expect(opened).toEqual({ id: 'b', name: 'B' })
    expect(result.current.state).toBe('saved')
  })
})
