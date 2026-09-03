import { useCallback, useEffect, useRef, useState } from 'react'
import { recentProjects, supportsFileSystemAccess, type RecentProject } from '@/editor/fileHandles'
import { storageMessage, type StorageResult } from '@/editor/storage'

const AUTOSAVE_DELAY = 800

export type SaveState = 'clean' | 'pending' | 'saving' | 'saved' | 'error'

/** What a file reader hands back: the document, or the reason the file could not be used. */
export type ProjectRead<Doc> =
  | { ok: true; document: Doc; note?: string }
  | { ok: false; error: string }

/**
 * What one editor's file format is: the marker that says a file belongs to it, how a document is
 * written and read back, and what the library card should remember about it.
 */
export type ProjectFormat<Doc> = {
  /** The `format` field a file must carry. A file marked for another editor is refused by name. */
  magic: string
  /** Browser-storage key, used only to name the format in messages; writing goes through `save`. */
  storageKey: string
  extension: string
  mime: string
  pickerLabel: string
  documentId: (document: Doc) => string
  documentName: (document: Doc) => string
  fileName: (document: Doc) => string
  serialize: (document: Doc) => string
  parse: (text: string) => ProjectRead<Doc>
  save: (document: Doc) => StorageResult
  /** The parts of a Recent entry that describe this kind of document. */
  recent: (document: Doc) => Pick<RecentProject, 'kind' | 'width' | 'height' | 'background' | 'thumbnail'>
}

export type ProjectFile<Doc> = {
  state: SaveState
  /** ISO timestamp of the last successful write. */
  savedAt: string | null
  message: string | null
  fileName: string | null
  /** Whether a file on disk is linked and receiving the autosave. */
  linked: boolean
  supported: boolean
  saveAs: () => Promise<void>
  saveNow: () => Promise<void>
  openFromDisk: (file?: File) => Promise<Doc | null>
  downloadProject: () => void
  unlink: () => Promise<void>
}

/**
 * Keeps the document written where the user expects it: browser storage always, and a file on
 * disk once one is chosen. Every change schedules one write 800 ms later; the badge reports the
 * outcome instead of asking for a Save click.
 */
export function useProjectFile<Doc>(document: Doc | null, format: ProjectFormat<Doc>): ProjectFile<Doc> {
  const [state, setState] = useState<SaveState>('clean')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const handle = useRef<FileSystemFileHandle | null>(null)
  const latest = useRef<Doc | null>(document)
  const timer = useRef<number | null>(null)
  /** The document snapshot already on disk and in storage; identity, not deep equality. */
  const written = useRef<Doc | null>(document)
  /** True between a change and the write that lands it, so unload and unmount can react. */
  const pending = useRef(false)
  /** A write in flight, and whether another change arrived while it ran. */
  const writing = useRef(false)
  const again = useRef(false)
  latest.current = document
  /** The format is read inside callbacks that must not be rebuilt when a caller re-renders. */
  const spec = useRef(format)
  spec.current = format

  const documentId = document ? format.documentId(document) : null

  useEffect(() => {
    handle.current = null
    setFileName(null)
    setState('clean')
    setSavedAt(null)
    setMessage(null)
    written.current = latest.current
    pending.current = false
    if (!documentId) return
    let cancelled = false
    void recentProjects.getProjectHandle(documentId).then((found) => {
      if (cancelled || !found) return
      handle.current = found
      setFileName(found.name)
    })
    return () => {
      cancelled = true
    }
  }, [documentId])

  const write = useCallback(async (): Promise<void> => {
    const current = latest.current
    if (!current) return
    // One write at a time: a second `createWritable` on the same file while one is open fails.
    if (writing.current) {
      again.current = true
      return
    }
    writing.current = true
    setState('saving')
    const active = spec.current
    const stored = active.save(current)
    let error = storageMessage(stored)
    const target = handle.current
    if (target) {
      try {
        const permission = await target.requestPermission?.({ mode: 'readwrite' })
        if (permission && permission !== 'granted') throw new Error('Permission to write that file was declined.')
        const writable = await target.createWritable()
        await writable.write(active.serialize(current))
        await writable.close()
        error = null
        await recentProjects.rememberProject({
          id: active.documentId(current),
          name: active.documentName(current),
          savedAt: new Date().toISOString(),
          fileName: target.name,
          ...active.recent(current),
          handle: target,
        })
      } catch (failure) {
        writing.current = false
        setState('error')
        setMessage(failure instanceof Error ? failure.message : 'That file could not be written.')
        return
      }
    }
    writing.current = false
    if (error) {
      setState('error')
      setMessage(error)
      return
    }
    written.current = current
    pending.current = false
    setMessage(null)
    setSavedAt(new Date().toISOString())
    setState('saved')
    if (again.current) {
      again.current = false
      void write()
    }
  }, [])

  useEffect(() => {
    if (!document || document === written.current) return
    pending.current = true
    setState((current) => (current === 'saving' ? current : 'pending'))
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      void write()
    }, AUTOSAVE_DELAY)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [document, write])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pending.current && !writing.current && state !== 'error') return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state])

  // Leaving the editor must not drop the changes the debounce was still holding.
  const flush = useRef(() => undefined as void)
  flush.current = () => {
    if (pending.current) void write()
  }
  useEffect(() => () => flush.current(), [])

  const downloadProject = useCallback(() => {
    const current = latest.current
    if (!current) return
    const active = spec.current
    const blob = new Blob([active.serialize(current)], { type: active.mime })
    const href = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = href
    anchor.download = active.fileName(current)
    anchor.click()
    URL.revokeObjectURL(href)
    setSavedAt(new Date().toISOString())
    setState('saved')
    setMessage(null)
  }, [])

  const saveAs = useCallback(async () => {
    const current = latest.current
    if (!current) return
    const active = spec.current
    if (!supportsFileSystemAccess() || !window.showSaveFilePicker) {
      downloadProject()
      return
    }
    try {
      const picked = await window.showSaveFilePicker({
        suggestedName: active.fileName(current),
        types: [{ description: active.pickerLabel, accept: { [active.mime]: [active.extension, '.json'] } }],
      })
      handle.current = picked
      setFileName(picked.name)
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return
      setState('error')
      setMessage('That location could not be used.')
      return
    }
    await write()
  }, [downloadProject, write])

  const saveNow = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    await write()
  }, [write])

  const openFromDisk = useCallback(async (file?: File): Promise<Doc | null> => {
    const active = spec.current
    let picked: FileSystemFileHandle | null = null
    let source = file ?? null
    if (!source) {
      if (!window.showOpenFilePicker) return null
      try {
        const [found] = await window.showOpenFilePicker({
          types: [{ description: active.pickerLabel, accept: { [active.mime]: [active.extension, '.json'] } }],
          multiple: false,
        })
        if (!found) return null
        picked = found
        source = await found.getFile()
      } catch (failure) {
        if (failure instanceof DOMException && failure.name === 'AbortError') return null
        setState('error')
        setMessage('That file could not be opened.')
        return null
      }
    }
    const result = active.parse(await source.text())
    if (!result.ok) {
      setState('error')
      setMessage(result.error)
      return null
    }
    const opened = result.document
    written.current = opened
    const stored = active.save(opened)
    const storageError = storageMessage(stored)
    await recentProjects.rememberProject({
      id: active.documentId(opened),
      name: active.documentName(opened),
      savedAt: new Date().toISOString(),
      fileName: picked?.name ?? source.name,
      ...active.recent(opened),
      ...(picked ? { handle: picked } : {}),
    })
    setMessage(storageError ?? result.note ?? null)
    setState(storageError ? 'error' : 'saved')
    return opened
  }, [])

  const unlink = useCallback(async () => {
    handle.current = null
    setFileName(null)
    if (documentId) await recentProjects.forgetProject(documentId)
  }, [documentId])

  return {
    state,
    savedAt,
    message,
    fileName,
    linked: fileName !== null,
    supported: supportsFileSystemAccess(),
    saveAs,
    saveNow,
    openFromDisk,
    downloadProject,
    unlink,
  }
}

/** "Saved · 12:04", or the pending / failed wording for the badge. */
export function saveBadgeLabel(file: Pick<ProjectFile<unknown>, 'state' | 'savedAt'>): string {
  switch (file.state) {
    case 'saving': return 'Saving…'
    case 'pending': return 'Unsaved changes'
    case 'error': return 'Not saved'
    case 'saved': return file.savedAt ? `Saved · ${formatClock(file.savedAt)}` : 'Saved'
    default: return file.savedAt ? `Saved · ${formatClock(file.savedAt)}` : 'No changes yet'
  }
}

export function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
