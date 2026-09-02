import { useEffect, type RefObject } from 'react'

// Note the absence of a :not([tabindex="-1"]) clause: this hook is what sets those, and a
// selector that excluded them would find only the one stop it had just made.
const FOCUSABLE = 'button:not([disabled]), [role="combobox"]:not([disabled])'

/**
 * Roving tabindex inside a toolbar: one stop for the whole group, the arrows walk it.
 *
 * The keyboard reaches the toolbar once, not once per button, and Home and End jump to the ends.
 * The stop follows whatever was last focused, so coming back lands where the user left off.
 */
export function useRovingFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const items = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const sync = (active?: HTMLElement) => {
      const list = items()
      if (list.length === 0) return
      const current = active && list.includes(active) ? active : list.find((item) => item.tabIndex === 0) ?? list[0]!
      for (const item of list) item.tabIndex = item === current ? 0 : -1
    }
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof HTMLElement) sync(target.closest<HTMLElement>(FOCUSABLE) ?? undefined)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
      if (!keys.includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return
      const list = items()
      const active = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(FOCUSABLE) : null
      const index = active ? list.indexOf(active) : -1
      if (index < 0) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? list.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length
      const target = list[next]
      if (!target) return
      sync(target)
      target.focus()
    }
    sync()
    const observer = new MutationObserver(() => sync())
    observer.observe(root, { childList: true, subtree: true })
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('keydown', onKeyDown)
    return () => {
      observer.disconnect()
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('keydown', onKeyDown)
    }
  }, [ref])
}
