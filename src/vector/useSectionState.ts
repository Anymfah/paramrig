import { useCallback, useEffect, useState } from 'react'
import { isOpen, readInspectorPrefs, withSection, writeInspectorPrefs } from '@/vector/inspectorPrefs'

/** A section's folded state, kept in browser storage so it survives a reload. */
export function useSectionState(id: string, defaultOpen: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => isOpen(readInspectorPrefs(), id, defaultOpen))
  useEffect(() => { setOpenState(isOpen(readInspectorPrefs(), id, defaultOpen)) }, [id, defaultOpen])
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    writeInspectorPrefs(withSection(readInspectorPrefs(), id, next))
  }, [id])
  return [open, setOpen]
}
