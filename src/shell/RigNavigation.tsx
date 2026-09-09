import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { RigManifest } from '@/rigs/types'
import { ancestorPaths, buildNavTree, compactNavItems, type NavFolderNode, type NavNode } from '@/rigs/nav-tree'
import { loadCollapsedFolders, saveCollapsedFolders } from '@/state/persistence'
import { NavRailHead } from '@/shell/NavRailHead'
import { collectionIcon } from '@/ui/collectionIcons'
import { ThemeToggle } from '@/ui/ThemeToggle'
import {
  IconChevronRight,
  IconDoc,
  IconFolder,
  IconFolderOpen,

  IconGrid,
} from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'

type RigNavigationProps = {
  rigs: RigManifest[]
  activeId?: string
  compact?: boolean
  onNavigate?: () => void
  inert?: boolean
}

export function RigNavigation({ rigs, activeId, compact = false, onNavigate, inert }: RigNavigationProps) {
  const tree = buildNavTree(rigs)
  const [collapsed, setCollapsed] = useState(loadCollapsedFolders)

  useEffect(() => {
    if (!activeId) return
    const active = rigs.find((rig) => rig.id === activeId)
    if (!active) return
    const keepOpen = new Set(ancestorPaths(active))
    setCollapsed((paths) => {
      const next = paths.filter((path) => !keepOpen.has(path))
      if (next.length === paths.length) return paths
      saveCollapsedFolders(next)
      return next
    })
  }, [activeId, rigs])

  const toggleFolder = (path: string) => {
    setCollapsed((paths) => {
      const hidden = new Set(paths)
      if (hidden.has(path)) hidden.delete(path)
      else hidden.add(path)
      const next = [...hidden]
      saveCollapsedFolders(next)
      return next
    })
  }

  return (
    <nav className="nav-rail" aria-label="Rigs" inert={inert} onClick={(event) => { if ((event.target as Element).closest('a[href]')) onNavigate?.() }}>
      <NavRailHead compact={compact} />
      <div className="nav-rail__body scroll-area">
        {compact ? (
          <ul className="nav-tree">
            {compactNavItems(tree).map((item) =>
              item.kind === 'rig' ? (
                <CompactRigLink key={item.rig.id} rig={item.rig} activeId={activeId} />
              ) : (
                <CompactFolderMenu key={item.folder.path} folder={item.folder} rigs={item.rigs} activeId={activeId} />
              ),
            )}
          </ul>
        ) : (
          <ul className="nav-tree">
            {tree.map((node) => (
              <NavTreeNode
                key={node.path}
                node={node}
                depth={0}
                activeId={activeId}
                collapsed={collapsed}
                onToggle={toggleFolder}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="nav-rail__foot">
        <ThemeToggle compact={compact} />
      </div>
    </nav>
  )
}


function NavHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip content={label} side="right" instant block>
      {children}
    </Tooltip>
  )
}

function rigIcon(rig: RigManifest) {
  if (rig.renderer === 'vector') return IconDoc
  return collectionIcon[rig.id as keyof typeof collectionIcon] ?? IconGrid
}

function CompactRigLink({ rig, activeId }: { rig: RigManifest; activeId?: string }) {
  const Icon = rigIcon(rig)
  return (
    <li className="nav-tree__item">
      <NavHint label={rig.name}>
        <NavLink
          to={`/r/${rig.id}`}
          className="nav-item"
          aria-label={rig.name}
          aria-current={activeId === rig.id ? 'page' : undefined}
        >
          <Icon />
          <span className="nav-label">{rig.name}</span>
        </NavLink>
      </NavHint>
    </li>
  )
}

function CompactFolderMenu({
  folder,
  rigs,
  activeId,
}: {
  folder: NavFolderNode
  rigs: RigManifest[]
  activeId?: string
}) {
  const current = rigs.some((rig) => rig.id === activeId)
  return (
    <li className="nav-tree__item">
      <DropdownMenu.Root modal={false}>
        <NavHint label={folder.label}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="nav-folder"
              aria-label={folder.label}
              aria-current={current ? 'true' : undefined}
            >
              <IconFolder />
              <span className="nav-label">{folder.label}</span>
            </button>
          </DropdownMenu.Trigger>
        </NavHint>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="menu"
            side="right"
            align="start"
            sideOffset={8}
            collisionPadding={8}
            aria-label={folder.label}
          >
            {rigs.map((rig) => {
              const Icon = rigIcon(rig)
              return (
                <DropdownMenu.Item key={rig.id} asChild>
                  <NavLink
                    to={`/r/${rig.id}`}
                    className="menu__item"
                    aria-current={activeId === rig.id ? 'page' : undefined}
                  >
                    <Icon />
                    <span>{rig.name}</span>
                  </NavLink>
                </DropdownMenu.Item>
              )
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  )
}

function NavTreeNode({
  node,
  depth,
  activeId,
  collapsed,
  onToggle,
}: {
  node: NavNode
  depth: number
  activeId?: string
  collapsed: string[]
  onToggle: (path: string) => void
}) {
  if (node.kind === 'rig') {
    const Icon = rigIcon(node.rig)
    return (
      <li className="nav-tree__item" style={{ '--nav-depth': depth } as CSSProperties}>
        <NavLink
          to={`/r/${node.rig.id}`}
          className="nav-item"
          aria-current={activeId === node.rig.id ? 'page' : undefined}
        >
          <Icon />
          <span className="nav-label">{node.rig.name}</span>
        </NavLink>
      </li>
    )
  }

  const open = !collapsed.includes(node.path)
  const panelId = `nav-folder-${node.path.replaceAll('/', '-')}`

  return (
    <li className="nav-tree__item" style={{ '--nav-depth': depth } as CSSProperties}>
      <button
        type="button"
        className="nav-folder"
        aria-expanded={open}
        aria-controls={panelId}
        data-depth={depth}
        onClick={() => onToggle(node.path)}
      >
        <IconChevronRight className="nav-folder__chevron" />
        {open ? <IconFolderOpen /> : <IconFolder />}
        <span className="nav-label">{node.label}</span>
      </button>
      {open ? (
        <ul className="nav-tree" id={panelId}>
          {node.children.map((child) => (
            <NavTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
