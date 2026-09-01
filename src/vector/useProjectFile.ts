import { useCallback, useEffect, useRef, useState } from 'react'
import { documentThumbnail, saveVectorDocument, storageMessage } from '@/vector/document'
import { forgetProject, getProjectHandle, rememberProject, supportsFileSystemAccess } from '@/vector/fileHandles'
import { importProject, projectFileName, PROJECT_EXTENSION, PROJECT_MIME, serializeProject } from '@/vector/project'
import type { VectorDocument } from '@/vector/types'

const AUTOSAVE_DELAY = 800

export type SaveState = 'clean' | 'pending' | 'saving' | 'saved' | 'error'

export type ProjectFile = {
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
  openFromDisk: (file?: File) => Promise<VectorDocument | null>
  downloadProject: () => void
  unlink: () => Promise<void>
}

const PICKER_TYPES = [{ description: 'ParamRig project', accept: { [PROJECT_MIME]: [PROJECT_EXTENSION, '.json'] } }]

/**
 * Keeps the document written where the user expects it: browser storage always, and a file on
 * disk once one is chosen. Every change schedules one write 800 ms later; the badge reports the
 * outcome instead of asking for a Save click.
 */
export function useProjectFile(document: VectorDocument | null): ProjectFile {
  const [state, setState] = useState<SaveState>('clean')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const handle = useRef<FileSystemFileHandle | null>(null)
  const latest = useRef<VectorDocument | null>(document)
  const timer = useRef<number | null>(null)
  /** The document snapshot already on disk and in storage; identity, not deep equality. */
  const written = useRef<VectorDocument | null>(document)
  latest.current = document

  const documentId = document?.id ?? null

  useEffect(() => {
    handle.current = null
    setFileName(null)
    setState('clean')
    setSavedAt(null)
    setMessage(null)
    written.current = latest.current
    if (!documentId) return
    let cancelled = false
    void getProjectHandle(documentId).then((found) => {
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
    setState('saving')
    const stored = saveVectorDocument(current)
    let error = storageMessage(stored)
    const target = handle.current
    if (target) {
      try {
        const permission = await target.requestPermission?.({ mode: 'readwrite' })
        if (permission && permission !== 'granted') throw new Error('Permission to write that file was declined.')
        const writable = await target.createWritable()
        await writable.write(serializeProject(current))
        await writable.close()
        error = null
        await rememberProject({
          id: current.id,
          name: current.name,
          savedAt: new Date().toISOString(),
          fileName: target.name,
          width: current.width,
          height: current.height,
          background: current.background,
          thumbnail: documentThumbnail(current),
          handle: target,
        })
      } catch (failure) {
        setState('error')
        setMessage(failure instanceof Error ? failure.message : 'That file could not be written.')
        return
      }
    }
    if (error) {
      setState('error')
      setMessage(error)
      return
    }
    written.current = current
    setMessage(null)
    setSavedAt(new Date().toISOString())
    setState('saved')
  }, [])

  useEffect(() => {
    if (!document || document === written.current) return
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
      if (timer.current === null && state !== 'error') return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state])

  const downloadProject = useCallback(() => {
    const current = latest.current
    if (!current) return
    const blob = new Blob([serializeProject(current)], { type: PROJECT_MIME })
    const href = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = href
    anchor.download = projectFileName(current)
    anchor.click()
    URL.revokeObjectURL(href)
    setSavedAt(new Date().toISOString())
    setState('saved')
    setMessage(null)
  }, [])

  const saveAs = useCallback(async () => {
    const current = latest.current
    if (!current) return
    if (!supportsFileSystemAccess() || !window.showSaveFilePicker) {
      downloadProject()
      return
    }
    try {
      const picked = await window.showSaveFilePicker({ suggestedName: projectFileName(current), types: PICKER_TYPES })
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

  const openFromDisk = useCallback(async (file?: File): Promise<VectorDocument | null> => {
    let picked: FileSystemFileHandle | null = null
    let source = file ?? null
    if (!source) {
      if (!window.showOpenFilePicker) return null
      try {
        const [found] = await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false })
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
    const result = importProject(await source.text())
    if (!result.ok) {
      setState('error')
      setMessage(result.error)
      return null
    }
    const opened = result.project.document
    written.current = opened
    const stored = saveVectorDocument(opened)
    const storageError = storageMessage(stored)
    await rememberProject({
      id: opened.id,
      name: opened.name,
      savedAt: new Date().toISOString(),
      fileName: picked?.name ?? source.name,
      width: opened.width,
      height: opened.height,
      background: opened.background,
      thumbnail: documentThumbnail(opened),
      ...(picked ? { handle: picked } : {}),
    })
    setMessage(storageError)
    setState(storageError ? 'error' : 'saved')
    return opened
  }, [])

  const unlink = useCallback(async () => {
    handle.current = null
    setFileName(null)
    if (documentId) await forgetProject(documentId)
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
export function saveBadgeLabel(file: Pick<ProjectFile, 'state' | 'savedAt'>): string {
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
