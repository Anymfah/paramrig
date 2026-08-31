import { useSyncExternalStore } from 'react'
import { resolvedTheme, subscribeTheme, toggleTheme } from '@/state/theme'
import { Tooltip } from '@/ui/Tooltip'

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, resolvedTheme, resolvedTheme)
  const dark = theme === 'dark'

  return (
    <Tooltip content={dark ? 'Switch to light' : 'Switch to dark'} block>
      <button
        type="button"
        className="theme-toggle"
        role="switch"
        aria-checked={dark}
        onClick={toggleTheme}
      >
        Dark
        <span className="switch" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
      </button>
    </Tooltip>
  )
}
