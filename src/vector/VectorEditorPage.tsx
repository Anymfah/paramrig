import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { RigManifest } from '@/rigs/types'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { IconButton } from '@/ui/Button'
import { IconBucket, IconCheck, IconChevron, IconChevronRight, IconDownload, IconEllipse, IconFlipH, IconFlipV, IconGrid, IconGroup, IconImport, IconLasso, IconLock, IconMinus, IconNode, IconPen, IconPencilTool, IconPlus, IconRectangle, IconRedo, IconRotate90, IconSelect, IconTransformSelect, IconTrash, IconUndo, IconUngroup, IconUnlock } from '@/ui/icons'
import { flipAffine, rotationAffine, transformElementAffine } from '@/vector/affine'
import { elementCenter } from '@/vector/geometry'
import { importSvg } from '@/vector/svgImport'
import { readClipboardPayload, writeClipboardPayload } from '@/vector/clipboard'
import type { VectorCanvasController } from '@/vector/VectorCanvas'
import { Tooltip } from '@/ui/Tooltip'
import { alignElements, type AlignMode, type ElementPatch } from '@/vector/align'
import { createVectorElement, serializeVectorDocument } from '@/vector/document'
import { selectionBounds } from '@/vector/geometry'
import { childrenOf, leafElements } from '@/vector/tree'
import { VectorCanvas, type VectorViewOptions } from '@/vector/VectorCanvas'
import { VectorInspector } from '@/vector/VectorInspector'
import { VectorLayers } from '@/vector/VectorLayers'
import type { VectorElement, VectorTool } from '@/vector/types'
import { useVectorDocument } from '@/vector/useVectorDocument'

type SelectionTool = Extract<VectorTool, 'select' | 'transform'>

const ALIGN_KEYS: Record<string, AlignMode> = { KeyA: 'left', KeyH: 'centerX', KeyD: 'right', KeyW: 'top', KeyV: 'centerY', KeyS: 'bottom' }

export function VectorEditorPage({ manifest }: { manifest: RigManifest }) {
  const navigate = useNavigate()
  const editor = useVectorDocument(manifest.id)
  const [tool, setTool] = useState<VectorTool>('select')
  const [selectionTool, setSelectionTool] = useState<SelectionTool>('select')
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [zoom, setZoom] = useState(() => {
    if (typeof window === 'undefined' || window.innerWidth >= 768) return 0.8
    return Math.max(0.25, Math.min(0.8, (window.innerWidth - 48) / 800))
  })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [viewOptions, setViewOptions] = useState<VectorViewOptions>({
    pixelPreview: 'off',
    pixelGrid: false,
    snapToPixelGrid: false,
    snapToObjects: true,
    snapToGuides: true,
    snapToNodes: true,
    layoutGuides: false,
    rulers: false,
    guides: true,
    minimap: false,
    outlines: 'off',
  })
  const controller = useRef<VectorCanvasController | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')
  const lastLayerClick = useRef<string | null>(null)
  const editorRef = useRef(editor)
  editorRef.current = editor

  const document = editor.document
  const selectedIds = editor.selectedIds
  const selectedElements = editor.selectedElements
  const canUngroup = selectedElements.some((element) => element.kind === 'group')
  const allLocked = selectedElements.length > 0 && selectedElements.every((element) => element.locked)

  const chooseTool = useCallback((next: VectorTool) => {
    setTool(next)
    if (next === 'select' || next === 'transform') setSelectionTool(next)
  }, [])

  const group = useCallback(() => {
    const current = editorRef.current
    if (current.selectedIds.length === 0) return
    const id = current.groupSelection(current.selectedIds)
    if (id) {
      current.setSelectedIds([id])
      current.setEnteredGroupId(null)
    }
  }, [])

  const ungroup = useCallback(() => {
    const current = editorRef.current
    const groups = current.selectedElements.filter((element) => element.kind === 'group')
    if (groups.length === 0) return
    const children = groups.flatMap((element) => childrenOf(current.document?.elements ?? [], element.id).map((child) => child.id))
    current.ungroup(groups.map((element) => element.id))
    current.setSelectedIds(children)
  }, [])

  const transformSelection = useCallback((build: (center: { x: number; y: number }) => ReturnType<typeof flipAffine>) => {
    const current = editorRef.current
    const doc = current.document
    if (!doc || current.selectedIds.length === 0) return
    const leaves = leafElements(doc.elements, current.selectedIds).filter((element) => !element.locked)
    if (leaves.length === 0) return
    const center = elementCenter(selectionBounds(leaves))
    const map = build(center)
    current.updateElements(leaves.map((leaf) => ({ id: leaf.id, patch: transformElementAffine(leaf, map) })))
  }, [])

  const pasteElements = useCallback((elements: VectorElement[], offset = 0, parent?: string): string[] => {
    const current = editorRef.current
    if (!current.document || elements.length === 0) return []
    const idMap = new Map(elements.map((element) => [element.id, crypto.randomUUID()]))
    const copies = elements.map((element): VectorElement => {
      const { parentId, ...rest } = element
      const mapped = parentId && idMap.has(parentId) ? idMap.get(parentId)! : parent ?? current.enteredGroupId ?? undefined
      const moved = element.kind !== 'group' ? { x: element.x + offset, y: element.y + offset } : {}
      return { ...rest, ...moved, id: idMap.get(element.id)!, ...(mapped ? { parentId: mapped } : {}) }
    })
    current.addElements(copies)
    return copies.map((element) => element.id)
  }, [])

  const importFile = useCallback(async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    const elements = importSvg(text, { currentColor: '#D4E7E1' })
    if (elements.length === 0) return
    const current = editorRef.current
    if (elements.length === 1) {
      pasteElements(elements)
      return
    }
    const group = createVectorElement('group', { x: 0, y: 0, width: 1, height: 1 }, { name: file.name.replace(/\.svg$/i, '') || 'Import' })
    if (current.enteredGroupId) group.parentId = current.enteredGroupId
    const idMap = new Map(elements.map((element) => [element.id, crypto.randomUUID()]))
    const copies = elements.map((element): VectorElement => ({ ...element, id: idMap.get(element.id)!, parentId: group.id }))
    current.editElements((all) => [...all, ...copies, group])
    current.setSelectedIds([group.id])
  }, [pasteElements])

  const alignSelection = useCallback((mode: AlignMode) => {
    const current = editorRef.current
    const doc = current.document
    if (!doc || current.selectedElements.length === 0) return
    const leaves = leafElements(doc.elements, current.selectedIds)
    const target = current.selectedElements.length > 1 && leaves.length ? selectionBounds(leaves) : { x: 0, y: 0, width: doc.width, height: doc.height }
    current.updateElements(expandMoves(doc.elements, alignElements(current.selectedElements, mode, target)))
  }, [])

  useEffect(() => {
    const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)
    const onCopy = (event: ClipboardEvent, cut: boolean) => {
      if (editable(event.target)) return
      const current = editorRef.current
      const doc = current.document
      if (!doc || current.selectedIds.length === 0) return
      const ids = new Set(current.selectedIds.flatMap((id) => [id, ...leafElements(doc.elements, [id]).map((leaf) => leaf.id), ...doc.elements.filter((element) => element.parentId === id).map((element) => element.id)]))
      const elements = doc.elements.filter((element) => ids.has(element.id) || (element.parentId && ids.has(element.parentId)))
      event.preventDefault()
      writeClipboardPayload(event.clipboardData, elements, doc)
      if (cut) current.removeElements(current.selectedIds)
    }
    const onPaste = (event: ClipboardEvent) => {
      if (editable(event.target)) return
      const payload = readClipboardPayload(event.clipboardData)
      if (!payload) return
      event.preventDefault()
      pasteElements(payload.elements, payload.source === 'internal' ? 12 : 0)
    }
    const copyHandler = (event: ClipboardEvent) => onCopy(event, false)
    const cutHandler = (event: ClipboardEvent) => onCopy(event, true)
    window.document.addEventListener('copy', copyHandler)
    window.document.addEventListener('cut', cutHandler)
    window.document.addEventListener('paste', onPaste)
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return
      const current = editorRef.current
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (meta && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) current.redo()
        else current.undo()
        return
      }
      if (meta && key === 'd') {
        event.preventDefault()
        current.duplicateSelection()
        return
      }
      if (meta && key === 'a') {
        event.preventDefault()
        const doc = current.document
        if (!doc) return
        current.setSelectedIds(childrenOf(doc.elements, current.enteredGroupId).filter((element) => element.visible && !element.locked).map((element) => element.id))
        return
      }
      if (meta && key === 'g') {
        event.preventDefault()
        if (event.shiftKey) ungroup()
        else group()
        return
      }
      if (meta && key === 'e') {
        event.preventDefault()
        window.document.querySelector<HTMLButtonElement>('.vector-inspector button[data-action="combine"]')?.click()
        return
      }
      if (meta && key === 'j') {
        event.preventDefault()
        window.document.querySelector<HTMLButtonElement>('.vector-inspector button[data-action="join"]')?.click()
        return
      }
      if (meta && event.shiftKey && key === 'l') {
        event.preventDefault()
        if (current.selectedElements.length === 0) return
        const locked = !current.selectedElements.every((element) => element.locked)
        current.updateElements(current.selectedElements.map((element) => ({ id: element.id, patch: { locked } })))
        return
      }
      if (meta && event.shiftKey && key === 'h') {
        event.preventDefault()
        if (current.selectedElements.length === 0) return
        const visible = !current.selectedElements.every((element) => element.visible)
        current.updateElements(current.selectedElements.map((element) => ({ id: element.id, patch: { visible } })))
        return
      }
      if (meta) return
      if (event.altKey) {
        const mode = ALIGN_KEYS[event.code]
        if (mode && current.selectedElements.length > 0) {
          event.preventDefault()
          alignSelection(mode)
        } else if (event.code === 'KeyR' && current.selectedElements.length > 0) {
          event.preventDefault()
          transformSelection((center) => rotationAffine(event.shiftKey ? -90 : 90, center))
        }
        return
      }
      if (event.shiftKey && (key === 'h' || key === 'v') && current.selectedElements.length > 0) {
        event.preventDefault()
        transformSelection((center) => flipAffine(key === 'h' ? 'x' : 'y', center))
        return
      }
      if (event.shiftKey && (key === '0' || key === '1' || key === '2' || event.code === 'Digit0' || event.code === 'Digit1' || event.code === 'Digit2')) {
        event.preventDefault()
        const doc = current.document
        if (event.code === 'Digit0') controller.current?.zoomTo(1)
        else if (event.code === 'Digit1') controller.current?.fit(null)
        else if (event.code === 'Digit2' && doc) {
          const leaves = leafElements(doc.elements, current.selectedIds)
          controller.current?.fit(leaves.length ? selectionBounds(leaves) : null, 96)
        }
        return
      }
      if (event.repeat && !['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) return
      if (key === 'v') chooseTool('select')
      else if (key === 'q') chooseTool('lasso')
      else if (key === 'b') chooseTool('bucket')
      else if (key === 'p' && event.shiftKey) chooseTool('pencil')
      else if (key === 'p') chooseTool('pen')
      else if (key === 'r') chooseTool('rectangle')
      else if (key === 'o') chooseTool('ellipse')
      else if (key === 'enter') {
        const selected = current.selected
        if (current.selectedIds.length === 1 && selected) {
          event.preventDefault()
          if (selected.kind === 'group') {
            current.setEnteredGroupId(selected.id)
            const first = childrenOf(current.document?.elements ?? [], selected.id).at(-1)
            if (first) current.setSelectedIds([first.id])
          } else if (!selected.locked) {
            chooseTool('node')
          }
        }
      } else if ((tool === 'select' || tool === 'transform') && current.selectedElements.length > 0 && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        event.preventDefault()
        const amount = event.shiftKey ? 10 : 1
        const dx = key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0
        const dy = key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0
        const leaves = leafElements(current.document?.elements ?? [], current.selectedIds).filter((element) => !element.locked)
        current.updateElements(leaves.map((element) => ({ id: element.id, patch: { x: element.x + dx, y: element.y + dy } })))
      } else if ((key === 'backspace' || key === 'delete') && current.selectedIds.length > 0 && tool !== 'node' && tool !== 'bucket') {
        event.preventDefault()
        current.removeElements(current.selectedIds)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.document.removeEventListener('copy', copyHandler)
      window.document.removeEventListener('cut', cutHandler)
      window.document.removeEventListener('paste', onPaste)
    }
  }, [tool, chooseTool, group, ungroup, alignSelection, transformSelection, pasteElements])

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

  const selectFromLayers = (id: string, mode: 'replace' | 'toggle' | 'range') => {
    if (mode === 'replace') {
      editor.setSelectedIds([id])
      lastLayerClick.current = id
      return
    }
    if (mode === 'toggle') {
      editor.setSelectedIds(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id])
      lastLayerClick.current = id
      return
    }
    const anchor = lastLayerClick.current ?? selectedIds.at(-1) ?? id
    const order = document.elements.map((element) => element.id)
    const from = order.indexOf(anchor)
    const to = order.indexOf(id)
    if (from < 0 || to < 0) {
      editor.setSelectedIds([id])
      return
    }
    const [start, end] = from < to ? [from, to] : [to, from]
    const anchorElement = document.elements[from]!
    const range = order.slice(start, end + 1).filter((value) => (document.elements.find((element) => element.id === value)?.parentId ?? null) === (anchorElement.parentId ?? null))
    editor.setSelectedIds([...new Set([...selectedIds, ...range])])
  }

  const toggleLock = () => {
    if (selectedElements.length === 0) return
    editor.updateElements(selectedElements.map((element) => ({ id: element.id, patch: { locked: !allLocked } })))
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
          selectedIds={selectedIds}
          enteredGroupId={editor.enteredGroupId}
          compact={compact}
          inert={inert}
          onNavigate={onNavigate}
          onSelect={selectFromLayers}
          onUpdate={editor.updateElement}
          onUpdateElements={editor.updateElements}
          onRemove={editor.removeElements}
          onReorder={editor.reorderElement}
          onMoveInTree={editor.moveElementInTree}
          onRename={editor.renameElement}
          onDuplicate={editor.duplicateElement}
          onGroup={(ids) => { editor.setSelectedIds(ids); requestAnimationFrame(group) }}
          onUngroup={(ids) => { editor.setSelectedIds(ids); requestAnimationFrame(ungroup) }}
        />
      )}
      inspector={
        <VectorInspector
          document={document}
          tool={tool}
          selectedElements={selectedElements}
          selectedNodeIds={selectedNodeIds}
          onRenameDocument={editor.rename}
          onUpdateDocument={editor.updateDocument}
          onUpdate={editor.updateElement}
          onUpdateElements={editor.updateElements}
          onEditElements={editor.editElements}
          onSelectIds={editor.setSelectedIds}
          onSelectNodes={setSelectedNodeIds}
          historyDepth={editor.historyDepth}
          onSaveVersion={editor.saveVersion}
          onRestoreVersion={editor.restoreVersion}
          onDeleteVersion={editor.deleteVersion}
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
            onChange={(next) => chooseTool(next)}
            onActivate={() => chooseTool(selectionTool)}
          />
          <ToolButton label="Edit nodes · Enter" active={tool === 'node'} disabled={selectedIds.length !== 1 || selectedElements[0]?.kind === 'group' || !!selectedElements[0]?.locked} onClick={() => chooseTool('node')}><IconNode /></ToolButton>
          <ToolButton label="Pen · P" active={tool === 'pen'} onClick={() => chooseTool('pen')}><IconPen /></ToolButton>
          <ToolButton label="Pencil · ⇧P" active={tool === 'pencil'} onClick={() => chooseTool('pencil')}><IconPencilTool /></ToolButton>
          <ToolButton label="Lasso · Q" active={tool === 'lasso'} onClick={() => chooseTool('lasso')}><IconLasso /></ToolButton>
          <ToolButton label="Paint bucket · B" active={tool === 'bucket'} onClick={() => chooseTool('bucket')}><IconBucket /></ToolButton>
          <ToolButton label="Rectangle · R" active={tool === 'rectangle'} onClick={(keyboard) => {
            chooseTool('rectangle')
            if (keyboard) editor.addElement(createVectorElement('rectangle', centeredBounds(document, 160, 120)))
          }}><IconRectangle /></ToolButton>
          <ToolButton label="Ellipse · O" active={tool === 'ellipse'} onClick={(keyboard) => {
            chooseTool('ellipse')
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
          {selectedIds.length > 0 ? (
            <div className="workspace-toolbar__group vector-toolbar__selection">
              {canUngroup ? (
                <Tooltip content="Ungroup · ⇧⌘G">
                  <IconButton label="Ungroup" onClick={ungroup}><IconUngroup /></IconButton>
                </Tooltip>
              ) : null}
              <Tooltip content="Group · ⌘G">
                <IconButton label="Group" onClick={group}><IconGroup /></IconButton>
              </Tooltip>
              <Tooltip content="Flip horizontal · ⇧H">
                <IconButton label="Flip horizontal" onClick={() => transformSelection((center) => flipAffine('x', center))}><IconFlipH /></IconButton>
              </Tooltip>
              <Tooltip content="Flip vertical · ⇧V">
                <IconButton label="Flip vertical" onClick={() => transformSelection((center) => flipAffine('y', center))}><IconFlipV /></IconButton>
              </Tooltip>
              <Tooltip content="Rotate 90° · ⌥R">
                <IconButton label="Rotate 90 degrees" onClick={() => transformSelection((center) => rotationAffine(90, center))}><IconRotate90 /></IconButton>
              </Tooltip>
              <Tooltip content={allLocked ? 'Unlock · ⇧⌘L' : 'Lock · ⇧⌘L'}>
                <IconButton label={allLocked ? 'Unlock selection' : 'Lock selection'} aria-pressed={allLocked} onClick={toggleLock}>{allLocked ? <IconLock /> : <IconUnlock />}</IconButton>
              </Tooltip>
              <Tooltip content="Delete">
                <IconButton label="Delete selection" onClick={() => editor.removeElements(selectedIds)}><IconTrash /></IconButton>
              </Tooltip>
            </div>
          ) : null}
          <Tooltip content="Import SVG">
            <IconButton label="Import SVG" onClick={() => importInput.current?.click()}><IconImport /></IconButton>
          </Tooltip>
          <input ref={importInput} type="file" accept=".svg,image/svg+xml" className="visually-hidden" tabIndex={-1} onChange={(event) => { void importFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
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
          selectedIds={selectedIds}
          enteredGroupId={editor.enteredGroupId}
          selectedNodeIds={selectedNodeIds}
          onSelectIds={editor.setSelectedIds}
          onEnterGroup={editor.setEnteredGroupId}
          onSelectNodes={setSelectedNodeIds}
          onToolChange={chooseTool}
          onAddElements={(elements) => {
            editor.addElements(elements)
            if (tool === 'rectangle' || tool === 'ellipse') chooseTool('select')
          }}
          onUpdate={editor.updateElement}
          onUpdateElements={editor.updateElements}
          onDuplicateElements={editor.duplicateElements}
          onSetGuides={editor.setGuides}
          onEditElements={editor.editElements}
          controller={controller}
          onEscape={() => {
            if (editor.enteredGroupId) {
              editor.setSelectedIds([editor.enteredGroupId])
              editor.setEnteredGroupId(null)
            } else {
              editor.setSelectedIds([])
            }
          }}
          onGestureStart={editor.beginGesture}
          onGestureEnd={editor.endGesture}
          onGestureCancel={editor.cancelGesture}
        />
      </div>
    </WorkspaceShell>
  )
}

/** Turns group moves into leaf moves so grouped objects follow. */
function expandMoves(elements: VectorElement[], patches: ElementPatch[]): ElementPatch[] {
  const updates: ElementPatch[] = []
  for (const { id, patch } of patches) {
    const element = elements.find((item) => item.id === id)
    if (!element) continue
    if (element.kind !== 'group') {
      updates.push({ id, patch })
      continue
    }
    const dx = typeof patch.x === 'number' ? patch.x - element.x : 0
    const dy = typeof patch.y === 'number' ? patch.y - element.y : 0
    for (const leaf of leafElements(elements, [id])) updates.push({ id: leaf.id, patch: { x: Math.round((leaf.x + dx) * 100) / 100, y: Math.round((leaf.y + dy) * 100) / 100 } })
  }
  return updates
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
          <ViewToggle label="Pixel grid" hint="from 400%" checked={value.pixelGrid} onChange={(checked) => update('pixelGrid', checked)} />
          <DropdownMenu.Separator className="menu__sep" />
          <ViewToggle label="Snap to pixel grid" checked={value.snapToPixelGrid} onChange={(checked) => update('snapToPixelGrid', checked)} />
          <ViewToggle label="Snap to objects" checked={value.snapToObjects} onChange={(checked) => update('snapToObjects', checked)} />
          <ViewToggle label="Snap to guides" checked={value.snapToGuides} onChange={(checked) => update('snapToGuides', checked)} />
          <ViewToggle label="Snap to nodes" checked={value.snapToNodes} onChange={(checked) => update('snapToNodes', checked)} />
          <DropdownMenu.Separator className="menu__sep" />
          <ViewToggle label="Rulers" checked={value.rulers} onChange={(checked) => update('rulers', checked)} />
          <ViewToggle label="Guides" checked={value.guides} onChange={(checked) => update('guides', checked)} />
          <ViewToggle label="Layout grid" checked={value.layoutGuides} onChange={(checked) => update('layoutGuides', checked)} />
          <ViewToggle label="Minimap" checked={value.minimap} onChange={(checked) => update('minimap', checked)} />
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

function ViewToggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <DropdownMenu.CheckboxItem
      className="menu__item vector-view-menu__item"
      checked={checked}
      onCheckedChange={(next) => onChange(next === true)}
      onSelect={(event) => event.preventDefault()}
    >
      <span className="vector-view-menu__check"><DropdownMenu.ItemIndicator><IconCheck /></DropdownMenu.ItemIndicator></span>
      <span className="vector-view-menu__label">{label}</span>
      {hint ? <kbd>{hint}</kbd> : null}
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

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active: boolean; disabled?: boolean; onClick: (keyboard: boolean) => void; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <IconButton label={label.split(' · ')[0]!} aria-pressed={active} disabled={disabled} className="vector-tool" onClick={(event: ReactMouseEvent<HTMLButtonElement>) => onClick(event.detail === 0)}>{children}</IconButton>
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
