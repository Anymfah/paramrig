const KEY = 'paramrig.theme'
const LIGHT_THEME_COLOR = '#F4F3EB'
const DARK_THEME_COLOR = '#0F1212'

export type Theme = 'light' | 'dark'

const listeners = new Set<() => void>()
let current: Theme = 'light'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function emit() {
  for (const listener of listeners) listener()
}

export function applyTheme(theme: Theme) {
  current = theme
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
}

export function resolvedTheme(): Theme {
  return current
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* private mode */
  }
  applyTheme(theme)
  emit()
}

export function toggleTheme() {
  setTheme(current === 'dark' ? 'light' : 'dark')
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function initTheme() {
  applyTheme(readStored() ?? systemTheme())
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', () => {
    if (readStored() == null) {
      applyTheme(systemTheme())
      emit()
    }
  })
}
