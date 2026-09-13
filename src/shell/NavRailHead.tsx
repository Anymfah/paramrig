import { Link, NavLink } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Lockup } from '@/ui/BrandMark'
import { Tooltip } from '@/ui/Tooltip'
import { IconDoc, IconGear, IconPanelLeft, IconPanelLeftClose, IconSliders } from '@/ui/icons'
import { updatePrefs, useWorkspace } from '@/state/workspace'

/**
 * The top of the left rail, wherever that rail is.
 *
 * The library, the drawing editor and the scene editor each grew their own copy of this, and they
 * had already drifted: two of them offered the settings menu and one did not, so the same corner
 * of the same column did different things depending on which document you had open. It is one
 * component now, and a new editor gets the whole corner by asking for it.
 *
 * `noun` is what the rail is holding, and it appears only in the collapse control's label —
 * "Collapse layers", "Collapse sounds" — because that is the one thing about this corner that is
 * different from editor to editor.
 */
export function NavRailHead({ compact, noun = 'navigation', onNavigate }: {
  compact: boolean
  noun?: string
  onNavigate?: () => void
}) {
  const { prefs } = useWorkspace()
  const expand = `Expand ${noun}`
  const collapse = noun === 'navigation' ? 'Compact navigation' : `Collapse ${noun}`
  return (
    <div className="nav-rail__head">
      <Tooltip content="ParamRig" side="right" disabled={!compact}>
        <Link to="/" className="nav-brand" aria-label="ParamRig home" onClick={onNavigate}>
          <Lockup />
        </Link>
      </Tooltip>
      <div className="nav-rail__tools">
        <NavSettings compact={compact} />
        <Tooltip content={compact ? expand : collapse} side={compact ? 'right' : 'top'}>
          <button
            type="button"
            className="icon-btn icon-btn--ghost nav-rail__compact"
            aria-pressed={prefs.navCompact}
            aria-label={compact ? expand : collapse}
            onClick={() => updatePrefs({ navCompact: !prefs.navCompact, navCollapsed: false })}
          >
            {compact ? <IconPanelLeft /> : <IconPanelLeftClose />}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

function NavSettings({ compact }: { compact: boolean }) {
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content="Settings" side={compact ? 'right' : 'top'}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="icon-btn icon-btn--ghost nav-rail__gear" aria-label="Settings">
            <IconGear />
          </button>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu"
          side={compact ? 'right' : 'bottom'}
          align="start"
          sideOffset={8}
          collisionPadding={8}
          aria-label="Settings"
        >
          <DropdownMenu.Item asChild>
            <NavLink to="/docs" className="menu__item">
              <IconDoc />
              <span>Documentation</span>
            </NavLink>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <NavLink to="/docs/controls" className="menu__item">
              <IconSliders />
              <span>Controllers</span>
            </NavLink>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
