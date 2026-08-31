import { NavLink, Link } from 'react-router-dom'
import * as Popover from '@radix-ui/react-popover'
import type { RigManifest } from '@/rigs/types'
import { collectionIcon } from '@/ui/collectionIcons'
import { Lockup } from '@/ui/BrandMark'
import { ThemeToggle } from '@/ui/ThemeToggle'
import { IconDoc, IconGear, IconGrid } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'

type RigNavigationProps = {
  rigs: RigManifest[]
  activeId?: string
}

export function RigNavigation({ rigs, activeId }: RigNavigationProps) {
  const examples = rigs.filter((rig) => rig.collection === 'examples')
  return (
    <nav className="nav-rail" aria-label="Rigs">
      <div className="nav-rail__head">
        <Link to="/" className="nav-brand" aria-label="ParamRig home">
          <Lockup />
        </Link>
        <NavSettings />
      </div>
      <div className="nav-rail__body scroll-area">
        <div className="nav-list">
          {examples.map((rig) => {
            const Icon = collectionIcon[rig.id as keyof typeof collectionIcon] ?? IconGrid
            return (
              <NavLink
                key={rig.id}
                to={`/r/${rig.id}`}
                className="nav-item"
                aria-current={activeId === rig.id ? 'page' : undefined}
              >
                <Icon />
                {rig.name}
              </NavLink>
            )
          })}
        </div>
      </div>
      <div className="nav-rail__foot">
        <ThemeToggle />
      </div>
    </nav>
  )
}

function NavSettings() {
  return (
    <Popover.Root modal={false}>
      <Tooltip content="Settings">
        <Popover.Trigger asChild>
          <button type="button" className="icon-btn icon-btn--ghost nav-rail__gear" aria-label="Settings">
            <IconGear />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          className="popover popover--menu"
          sideOffset={8}
          align="start"
          collisionPadding={8}
          aria-label="Settings"
        >
          <NavLink className="nav-menu__item" to="/docs">
            <IconDoc />
            Documentation
          </NavLink>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
