import { useSyncExternalStore } from 'react'
import { resolvedTheme, subscribeTheme, toggleTheme } from '@/state/theme'
import { Tooltip } from '@/ui/Tooltip'

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore(subscribeTheme, resolvedTheme, resolvedTheme)
  const dark = theme === 'dark'

  return (
    <Tooltip content={dark ? 'Switch to light' : 'Switch to dark'} side={compact ? 'right' : 'top'} block>
      <button
        type="button"
        className={compact ? 'theme-toggle theme-toggle--compact' : 'theme-toggle'}
        role="switch"
        aria-checked={dark}
        aria-label={dark ? 'Switch to light' : 'Switch to dark'}
        onClick={toggleTheme}
      >
        {compact ? <span className="visually-hidden">Dark</span> : 'Dark'}
        <span className="switch" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
      </button>
    </Tooltip>
  )
}
