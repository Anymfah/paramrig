import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { RigManifest } from '@/rigs/types'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { IconButton } from '@/ui/Button'
import { IconCheck, IconChevron, IconChevronRight, IconDownload, IconEllipse, IconGrid, IconMinus, IconPlus, IconRectangle, IconRedo, IconSelect, IconTransformSelect, IconTrash, IconUndo } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { createVectorElement, serializeVectorDocument } from '@/vector/document'
import { VectorCanvas, type VectorViewOptions } from '@/vector/VectorCanvas'
import { VectorInspector } from '@/vector/VectorInspector'
import { VectorLayers } from '@/vector/VectorLayers'
import type { VectorTool } from '@/vector/types'
import { useVectorDocument } from '@/vector/useVectorDocument'

type SelectionTool = Extract<VectorTool, 'select' | 'transform'>

export function VectorEditorPage({ manifest }: { manifest: RigManifest }) {
  const navigate = useNavigate()
  const editor = useVectorDocument(manifest.id)
  const [tool, setTool] = useState<VectorTool>('select')
  const [selectionTool, setSelectionTool] = useState<SelectionTool>('select')
  const [zoom, setZoom] = useState(() => {
    if (typeof window === 'undefined' || window.innerWidth >= 768) return 0.8
    return Math.max(0.25, Math.min(0.8, (window.innerWidth - 48) / 800))
  })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [viewOptions, setViewOptions] = useState<VectorViewOptions>({
    pixelPreview: 'off',
    pixelGrid: false,
    snapToPixelGrid: false,
    layoutGuides: false,
    rulers: false,
    outlines: 'off',
  })
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.matches('input, textarea') || target.isContentEditable)) return
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) editor.redo()
        else editor.undo()
        return
      }
      if (meta && event.key.toLowerCase() === 'd' && editor.selectedId) {
        event.preventDefault()
        editor.duplicateElement(editor.selectedId)
        return
      }
      if (meta || event.altKey) return
      if (event.key === 'v' || event.key === 'V') {
        setSelectionTool('select')
        setTool('select')
      }
      if (event.key === 'o' || event.key === 'O') setTool('ellipse')
      if (event.key === 'Escape') editor.setSelectedId(null)
      if ((tool === 'select' || tool === 'transform') && editor.selectedElements.length > 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault()
        const amount = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0
        const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0
        editor.updateElements(editor.selectedElements.map((element) => ({
          id: element.id,
          patch: { x: element.x + dx, y: element.y + dy },
        })))
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && editor.selectedIds.length > 0) {
        event.preventDefault()
        editor.removeElements(editor.selectedIds)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editor, tool])

  const document = editor.document
  if (!document) {
    return (
      <main className="vector-missing" id="main">
        <button type="button" className="btn btn--solid btn--md" onClick={() => navigate('/')}>Back to library</button>
      </main>
    )
  }

  const download = () => {
    const blob = new Blob([serializeVectorDocument(document)], { type: 'image/svg+xml' })
    const href = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = href
    anchor.download = `${slug(document.name)}.svg`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  return (
    <WorkspaceShell
      rigs={listRigs()}
      activeId={document.id}
      mainLabel="Canvas"
      navLabel="Layers"
      mobilePanel={mobilePanel}
      onMobilePanel={setMobilePanel}
      renderNavigation={({ compact, inert, onNavigate }) => (
        <VectorLayers
          document={document}
          selectedIds={editor.selectedIds}
          compact={compact}
          inert={inert}
          onNavigate={onNavigate}
          onSelect={editor.setSelectedId}
          onUpdate={editor.updateElement}
          onRemove={editor.removeElement}
          onReorder={editor.reorderElement}
          onMove={editor.moveElement}
          onRename={editor.renameElement}
          onDuplicate={editor.duplicateElement}
        />
      )}
      inspector={
        <VectorInspector
          document={document}
          selected={editor.selected}
          onRenameDocument={editor.rename}
          onUpdateDocument={editor.updateDocument}
          onUpdate={editor.updateElement}
          onGestureStart={editor.beginGesture}
          onGestureEnd={editor.endGesture}
          onGestureCancel={editor.cancelGesture}
        />
      }
    >
      <h1 className="visually-hidden">{document.name}</h1>
      <div className="workspace-toolbar vector-toolbar" role="toolbar" aria-label="Vector tools">
        <div className="workspace-toolbar__group">
          <Tooltip content="Undo · ⌘Z">
            <IconButton label="Undo" disabled={!editor.canUndo} onClick={editor.undo}><IconUndo /></IconButton>
          </Tooltip>
          <Tooltip content="Redo · ⇧⌘Z">
            <IconButton label="Redo" disabled={!editor.canRedo} onClick={editor.redo}><IconRedo /></IconButton>
          </Tooltip>
        </div>
        <div className="workspace-toolbar__group vector-toolbar__tools">
          <SelectionToolMenu
            value={selectionTool}
            active={tool === selectionTool}
            onChange={(next) => {
              setSelectionTool(next)
              setTool(next)
            }}
            onActivate={() => setTool(selectionTool)}
          />
          <ToolButton label="Rectangle" active={tool === 'rectangle'} onClick={(keyboard) => {
            setTool('rectangle')
            if (keyboard) editor.addElement(createVectorElement('rectangle', centeredBounds(document, 160, 120)))
          }}><IconRectangle /></ToolButton>
          <ToolButton label="Ellipse · O" active={tool === 'ellipse'} onClick={(keyboard) => {
            setTool('ellipse')
            if (keyboard) editor.addElement(createVectorElement('ellipse', centeredBounds(document, 140, 140)))
          }}><IconEllipse /></ToolButton>
        </div>
        <div className="workspace-toolbar__group vector-toolbar__end">
          <div className="vector-toolbar__zoom">
            <Tooltip content="Zoom out">
              <IconButton label="Zoom out" disabled={zoom <= 0.1} onClick={() => setZoom((value) => steppedZoom(value, -1))}><IconMinus /></IconButton>
            </Tooltip>
            <button type="button" className="vector-zoom" aria-label="Reset canvas view" onClick={() => { setZoom(0.8); setPan({ x: 0, y: 0 }) }}>{Math.round(zoom * 100)}%</button>
            <Tooltip content="Zoom in">
              <IconButton label="Zoom in" disabled={zoom >= 8} onClick={() => setZoom((value) => steppedZoom(value, 1))}><IconPlus /></IconButton>
            </Tooltip>
          </div>
          <ViewOptionsMenu value={viewOptions} onChange={setViewOptions} />
          {editor.selectedId ? (
            <Tooltip content="Delete">
              <IconButton label="Delete selected object" onClick={() => editor.removeElements(editor.selectedIds)}><IconTrash /></IconButton>
            </Tooltip>
          ) : null}
          <Tooltip content="Export SVG">
            <IconButton label="Export SVG" onClick={download}><IconDownload /></IconButton>
          </Tooltip>
        </div>
      </div>
      <div className="preview-stage vector-stage" id="main" tabIndex={-1}>
        <VectorCanvas
          document={document}
          tool={tool}
          zoom={zoom}
          pan={pan}
          viewOptions={viewOptions}
          onPanChange={setPan}
          onZoomChange={setZoom}
          selectedId={editor.selectedId}
          selectedIds={editor.selectedIds}
          onSelect={editor.setSelectedId}
          onSelectIds={editor.setSelectedIds}
          onEnterNodeEdit={() => {
            setSelectionTool('select')
            setTool('select')
          }}
          onAdd={(element) => {
            editor.addElement(element)
            setSelectionTool('select')
            setTool('select')
          }}
          onUpdate={editor.updateElement}
          onUpdateElements={editor.updateElements}
          onGestureStart={editor.beginGesture}
          onGestureEnd={editor.endGesture}
          onGestureCancel={editor.cancelGesture}
        />
      </div>
    </WorkspaceShell>
  )
}

function ViewOptionsMenu({ value, onChange }: { value: VectorViewOptions; onChange: (value: VectorViewOptions) => void }) {
  const active = value.pixelPreview !== 'off' || value.pixelGrid || value.snapToPixelGrid || value.layoutGuides || value.rulers || value.outlines !== 'off'
  const update = <Key extends keyof VectorViewOptions>(key: Key, next: VectorViewOptions[Key]) => onChange({ ...value, [key]: next })
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content="View options">
        <DropdownMenu.Trigger asChild>
          <IconButton label="View options" aria-pressed={active}><IconGrid /></IconButton>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu vector-view-menu" side="bottom" align="end" sideOffset={8} collisionPadding={8} aria-label="View options">
          <ViewSubmenu label="Pixel preview" value={value.pixelPreview} onChange={(next) => update('pixelPreview', next)} options={[
            { value: 'off', label: 'Off' },
            { value: '1x', label: '1×' },
            { value: '2x', label: '2×' },
          ]} />
          <ViewToggle label="Pixel grid" checked={value.pixelGrid} onChange={(checked) => update('pixelGrid', checked)} />
          <ViewToggle label="Snap to pixel grid" checked={value.snapToPixelGrid} onChange={(checked) => update('snapToPixelGrid', checked)} />
          <DropdownMenu.Separator className="menu__sep" />
          <ViewToggle label="Layout guides" checked={value.layoutGuides} onChange={(checked) => update('layoutGuides', checked)} />
          <ViewToggle label="Rulers" checked={value.rulers} onChange={(checked) => update('rulers', checked)} />
          <ViewSubmenu label="Outlines" value={value.outlines} onChange={(next) => update('outlines', next)} options={[
            { value: 'off', label: 'Off' },
            { value: 'all', label: 'All objects' },
            { value: 'selected', label: 'Selected objects' },
          ]} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ViewToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <DropdownMenu.CheckboxItem
      className="menu__item vector-view-menu__item"
      checked={checked}
      onCheckedChange={(next) => onChange(next === true)}
      onSelect={(event) => event.preventDefault()}
    >
      <span className="vector-view-menu__check"><DropdownMenu.ItemIndicator><IconCheck /></DropdownMenu.ItemIndicator></span>
      <span className="vector-view-menu__label">{label}</span>
    </DropdownMenu.CheckboxItem>
  )
}

function ViewSubmenu<Value extends string>({ label, value, options, onChange }: {
  label: string
  value: Value
  options: Array<{ value: Value; label: string }>
  onChange: (value: Value) => void
}) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className="menu__item vector-view-menu__item">
        <span className="vector-view-menu__check">{value !== 'off' ? <IconCheck /> : null}</span>
        <span className="vector-view-menu__label">{label}</span>
        <IconChevronRight />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent className="menu vector-view-menu__sub" sideOffset={6} collisionPadding={8}>
          <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as Value)}>
            {options.map((option) => (
              <DropdownMenu.RadioItem key={option.value} className="menu__item vector-view-menu__item" value={option.value}>
                <span className="vector-view-menu__check"><DropdownMenu.ItemIndicator><IconCheck /></DropdownMenu.ItemIndicator></span>
                <span className="vector-view-menu__label">{option.label}</span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

function SelectionToolMenu({ value, active, onChange, onActivate }: {
  value: SelectionTool
  active: boolean
  onChange: (tool: SelectionTool) => void
  onActivate: () => void
}) {
  const CurrentIcon = value === 'select' ? IconSelect : IconTransformSelect
  const currentLabel = value === 'select' ? 'Select · V' : 'Transform · G / R / S'
  return (
    <div className="vector-tool-menu" data-active={active || undefined}>
      <Tooltip content={currentLabel}>
        <IconButton label={currentLabel.split(' · ')[0]!} aria-pressed={active} className="vector-tool vector-tool-menu__main" onClick={onActivate}>
          <CurrentIcon />
        </IconButton>
      </Tooltip>
      <DropdownMenu.Root modal={false}>
        <Tooltip content="Selection tools">
          <DropdownMenu.Trigger asChild>
            <button type="button" className="vector-tool-menu__trigger" aria-label="Selection tools">
              <IconChevron />
            </button>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu vector-tool-menu__content" side="bottom" align="start" sideOffset={8} collisionPadding={8} aria-label="Selection tools">
            <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as SelectionTool)}>
              <SelectionToolItem value="select" label="Select" shortcut="V"><IconSelect /></SelectionToolItem>
              <SelectionToolItem value="transform" label="Transform" shortcut="G / R / S"><IconTransformSelect /></SelectionToolItem>
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function SelectionToolItem({ value, label, shortcut, children }: { value: SelectionTool; label: string; shortcut: string; children: ReactNode }) {
  return (
    <DropdownMenu.RadioItem className="menu__item vector-tool-menu__item" value={value}>
      <span className="vector-tool-menu__check"><DropdownMenu.ItemIndicator><IconCheck /></DropdownMenu.ItemIndicator></span>
      {children}
      <span className="vector-tool-menu__label">{label}</span>
      <kbd>{shortcut}</kbd>
    </DropdownMenu.RadioItem>
  )
}

function ToolButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: (keyboard: boolean) => void; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <IconButton label={label.split(' · ')[0]!} aria-pressed={active} className="vector-tool" onClick={(event: ReactMouseEvent<HTMLButtonElement>) => onClick(event.detail === 0)}>{children}</IconButton>
    </Tooltip>
  )
}

function centeredBounds(document: { width: number; height: number }, width: number, height: number) {
  return { x: (document.width - width) / 2, y: (document.height - height) / 2, width, height }
}

function steppedZoom(current: number, direction: -1 | 1): number {
  const levels = [0.1, 0.25, 0.5, 0.8, 1, 1.5, 2, 3, 4, 6, 8]
  if (direction > 0) return levels.find((level) => level > current + 0.001) ?? 8
  return [...levels].reverse().find((level) => level < current - 0.001) ?? 0.1
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
}
