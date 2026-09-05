import { useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, History, Maximize, Monitor, MoreHorizontal, MousePointer2, Redo2, RefreshCw, Smartphone, Tablet, Undo2 } from 'lucide-react'
import { Button, IconButton } from '../ui/Button'
import { CoformSymbol } from '../ui/BrandMark'
import { NumberController } from '../ui/NumberController'
import { SelectField } from '../ui/SelectField'
import { Tooltip } from '../ui/Tooltip'
import { resolvedTheme, subscribeTheme, toggleTheme } from '../state/theme'
import { listWebProjects, webRigId } from './projects'
import type { WebProjectManifest } from './contracts'

type Props = {
  manifest: WebProjectManifest
  pageId: string
  onPage: (id: string) => void
  mode: 'browse' | 'select' | 'annotate'
  onMode: (mode: 'browse' | 'select') => void
  viewport: { width: number; height: number }
  fluid: boolean
  onViewport: (viewport: { width: number; height: number } | null) => void
  zoom: string
  onZoom: (zoom: string) => void
  previewMode: 'current' | 'reference' | 'source'
  onPreviewMode: (mode: 'current' | 'reference' | 'source') => void
  undoLabel: string | undefined
  redoLabel: string | undefined
  onUndo: () => void
  onRedo: () => void
  onSnapshots: () => void
  onReload: () => void
  status: string
  connected: boolean
  changeCount: number
  reviewDisabled: boolean
  onReview: () => void
}

export function WebToolbar(p: Props) {
  const theme = useSyncExternalStore(subscribeTheme, resolvedTheme)
  const [viewOpen, setViewOpen] = useState(false)
  return <div className="web-toolbar">
    <Menu.Root modal={false}>
      <Menu.Trigger asChild><button className="web-project-button" type="button" aria-label={`${p.manifest.name} project menu`}>
        <CoformSymbol className="web-project-mark" /><span>{p.manifest.name}</span><ChevronDown size={12} />
      </button></Menu.Trigger>
      <Menu.Portal><Menu.Content className="menu" align="start" sideOffset={8} collisionPadding={8}>
        <Menu.Item asChild className="menu__item"><Link to="/">Library</Link></Menu.Item>
        <Menu.Item asChild className="menu__item"><Link to="/web">Connect project…</Link></Menu.Item>
        {listWebProjects().filter(project => project.id !== p.manifest.id).map(project => <Menu.Item key={project.id} asChild className="menu__item"><Link to={`/r/${webRigId(project.id)}`}>{project.name}</Link></Menu.Item>)}
        <Menu.Separator className="menu__sep" />
        <Menu.Item className="menu__item" onSelect={toggleTheme}>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</Menu.Item>
      </Menu.Content></Menu.Portal>
    </Menu.Root>
    <div className="web-page-picker"><SelectField presentation="menu" label="Page" value={p.pageId} options={p.manifest.pages.map(page => ({ value: page.id, label: page.name }))} onChange={p.onPage} /></div>
    <Popover.Root>
      <Tooltip content="Preview size"><Popover.Trigger asChild><button type="button" className="web-size-trigger" aria-label="Preview size">
        {p.fluid ? <Maximize size={15} /> : p.viewport.width < 600 ? <Smartphone size={15} /> : <Monitor size={15} />}<span>{p.viewport.width}<span className="web-size-unit"> px</span></span><ChevronDown size={12} />
      </button></Popover.Trigger></Tooltip>
      <Popover.Portal><Popover.Content className="popover web-view-popover" sideOffset={8} collisionPadding={8} aria-label="Preview size">
        <div className="web-viewport-presets" role="group" aria-label="Viewport">
          {([{ label: 'Available width', icon: Maximize, size: null }, { label: 'Desktop', icon: Monitor, size: { width: 1440, height: 900 } }, { label: 'Tablet', icon: Tablet, size: { width: 768, height: 900 } }, { label: 'Mobile', icon: Smartphone, size: { width: 390, height: 844 } }]).map(preset => <Tooltip key={preset.label} content={preset.label}><IconButton label={preset.label} aria-pressed={preset.size ? !p.fluid && p.viewport.width === preset.size.width : p.fluid} onClick={() => p.onViewport(preset.size)}><preset.icon size={17} /></IconButton></Tooltip>)}
        </div>
        <NumberController param={{ id: 'web-width', kind: 'number', label: 'Width', group: 'viewport', defaultValue: 1440, min: 320, max: 2560, step: 1, unit: 'px', view: 'field' }} value={p.viewport.width} onChange={width => p.onViewport({ ...p.viewport, width })} />
        <SelectField label="Zoom" presentation="menu" value={p.zoom} onChange={p.onZoom} options={[{ value: '1', label: '100%' }, { value: 'fit', label: 'Fit width' }, { value: '.75', label: '75%' }, { value: '.5', label: '50%' }]} />
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    <div className="web-mode" role="group" aria-label="Preview interaction">
      <Tooltip content={p.mode === 'browse' ? 'Select element' : 'Stop selecting (Esc)'}>
        <IconButton label="Select element" aria-pressed={p.mode !== 'browse'} onClick={() => p.onMode(p.mode === 'browse' ? 'select' : 'browse')}>
          <MousePointer2 size={16} aria-hidden="true" />
        </IconButton>
      </Tooltip>
    </div>
    <div className="web-history">
      <Tooltip content={p.undoLabel ? `Undo: ${p.undoLabel}` : 'Undo'}><IconButton label="Undo" disabled={!p.undoLabel} onClick={p.onUndo}><Undo2 size={16} /></IconButton></Tooltip>
      <Tooltip content={p.redoLabel ? `Redo: ${p.redoLabel}` : 'Redo'}><IconButton label="Redo" disabled={!p.redoLabel} onClick={p.onRedo}><Redo2 size={16} /></IconButton></Tooltip>
    </div>
    <Menu.Root modal={false} open={viewOpen} onOpenChange={setViewOpen}>
      <Tooltip content="View options"><Menu.Trigger asChild><IconButton label="View options"><MoreHorizontal size={18} /></IconButton></Menu.Trigger></Tooltip>
      <Menu.Portal><Menu.Content className="menu" align="end" sideOffset={8} collisionPadding={8}>
        <Menu.RadioGroup value={p.previewMode} onValueChange={value => p.onPreviewMode(value as Props['previewMode'])}>
          {(['current', 'reference'] as const).map(value => <Menu.RadioItem className="menu__item" key={value} value={value}><span className="web-menu-check"><Menu.ItemIndicator><Check size={14} /></Menu.ItemIndicator></span>{value === 'current' ? 'Current' : 'Reference'}</Menu.RadioItem>)}
        </Menu.RadioGroup>
        <Menu.Item className="menu__item" onSelect={() => { p.onSnapshots(); setViewOpen(false) }}><History size={16} />Snapshots</Menu.Item>
        <Menu.Separator className="menu__sep" />
        <Menu.Item className="menu__item" onSelect={p.onReload}><RefreshCw size={16} />Reload preview</Menu.Item>
      </Menu.Content></Menu.Portal>
    </Menu.Root>
    <Tooltip content={p.status}><span className="web-sync" tabIndex={0} role="status" aria-label={p.status}><span className="web-status-dot" data-offline={!p.connected || undefined} /></span></Tooltip>
    <Button size="sm" className="web-review-button" onClick={p.onReview} disabled={p.reviewDisabled}><span className="web-review-label">Review changes</span><span className="web-review-mobile">Review</span>{p.changeCount > 0 ? <span className="web-count">{p.changeCount}</span> : null}</Button>
  </div>
}
