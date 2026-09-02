import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { RigManifest } from '@/rigs/types'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { IconButton } from '@/ui/Button'
import { IconBringForward, IconBucket, IconCheck, IconChevron, IconCommand, IconChevronRight, IconCopy, IconEllipse, IconEyeOff, IconFlipH, IconFlipV, IconFrame, IconGrid, IconGroup, IconLasso, IconLock, IconMinus, IconNode, IconPaste, IconPen, IconPencil, IconPencilTool, IconPlus, IconRectangle, IconRedo, IconRotate90, IconSelect, IconSendBackward, IconText, IconTransformSelect, IconTrash, IconUndo, IconUngroup, IconUnlock } from '@/ui/icons'
import { flipAffine, rotationAffine, transformElementAffine } from '@/vector/affine'
import { elementCenter } from '@/vector/geometry'
import { importSvg } from '@/vector/svgImport'
import { readClipboardPayload, writeClipboardPayload } from '@/vector/clipboard'
import type { VectorCanvasController } from '@/vector/VectorCanvas'
import { Tooltip } from '@/ui/Tooltip'
import { alignElements, type AlignMode, type ElementPatch } from '@/vector/align'
import { createVectorDocument, createVectorElement, MAX_EXPORT_PRESETS } from '@/vector/document'
import { DEFAULT_EXPORT, embedFonts, exportBounds, exportFileName, exportMarkup, rasterize, type ExportSettings } from '@/vector/export'
import { VectorExportMenu } from '@/vector/VectorExportMenu'
import { ContextMenuRoot, ContextTarget, type ContextMenuItem } from '@/ui/ContextMenu'
import {
  appearanceOf,
  appearancePatch,
  matchingIds,
  nextSiblingId,
  opacityFromDigit,
  SHORTCUTS,
  withShortcut,
  type Appearance,
  type OpacityBuffer,
  type VectorCommand,
} from '@/vector/commands'
import { countedLabel } from '@/vector/history'
import { VectorCommandPalette } from '@/vector/VectorCommandPalette'
import { VectorRenameDialog } from '@/vector/VectorRenameDialog'
import { VectorFileMenu } from '@/vector/VectorFileMenu'
import { colorAt, sampleDocument, type CanvasSample } from '@/vector/sampling'
import {
  applyStylePatch,
  detachStylePatch,
  pushRecentColor,
  styleFromElement,
  styleIdKey,
  syncStylePatches,
  toggleSwatch,
} from '@/vector/styles'
import type { PaintPalette } from '@/vector/VectorPaintPanel'
import { VectorSaveBadge } from '@/vector/VectorSaveBadge'
import { useProjectFile } from '@/vector/useProjectFile'
import { selectionBounds } from '@/vector/geometry'
import { ancestorIds, childrenOf, descendantIds, isContainer, leafElements } from '@/vector/tree'
import { VectorCanvas, type VectorViewOptions } from '@/vector/VectorCanvas'
import { VectorInspector } from '@/vector/VectorInspector'
import { VectorLayers } from '@/vector/VectorLayers'
import type { VectorElement, VectorPaint, VectorTool } from '@/vector/types'
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
  const projectInput = useRef<HTMLInputElement>(null)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT)
  const [exportError, setExportError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const appearanceClipboard = useRef<Appearance | null>(null)
  const elementClipboard = useRef<VectorElement[]>([])
  const opacityBuffer = useRef<OpacityBuffer | null>(null)
  const [sampler, setSampler] = useState<{ sample: CanvasSample; apply: (hex: string) => void } | null>(null)
  const lastLayerClick = useRef<string | null>(null)
  const editorRef = useRef(editor)
  editorRef.current = editor
  const file = useProjectFile(editor.document)
  const fileRef = useRef(file)
  fileRef.current = file

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

  const transformSelection = useCallback((build: (center: { x: number; y: number }) => ReturnType<typeof flipAffine>, label = 'Transform') => {
    const current = editorRef.current
    const doc = current.document
    if (!doc || current.selectedIds.length === 0) return
    const leaves = leafElements(doc.elements, current.selectedIds).filter((element) => !element.locked)
    if (leaves.length === 0) return
    const center = elementCenter(selectionBounds(leaves))
    const map = build(center)
    current.updateElements(leaves.map((leaf) => ({ id: leaf.id, patch: transformElementAffine(leaf, map) })), true, label)
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
    current.addElements(copies, true, 'Paste')
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

  const openProject = useCallback(async (picked?: File) => {
    const opened = await fileRef.current.openFromDisk(picked)
    if (opened) navigate(`/r/${opened.id}`)
  }, [navigate])

  const requestOpen = useCallback(() => {
    if (typeof window.showOpenFilePicker === 'function') void openProject()
    else projectInput.current?.click()
  }, [openProject])

  const newDocument = useCallback(() => {
    navigate(`/r/${createVectorDocument().id}`)
  }, [navigate])

  /** Elements a copy covers: the selection plus everything under it. */
  const selectionBlock = useCallback((): VectorElement[] => {
    const current = editorRef.current
    const doc = current.document
    if (!doc || current.selectedIds.length === 0) return []
    const ids = new Set(current.selectedIds.flatMap((id) => [id, ...descendantIds(doc.elements, id)]))
    return doc.elements.filter((element) => ids.has(element.id))
  }, [])

  const copySelection = useCallback((cut: boolean) => {
    const block = selectionBlock()
    if (block.length === 0) return
    elementClipboard.current = structuredClone(block)
    if (cut) editorRef.current.removeElements(editorRef.current.selectedIds)
  }, [selectionBlock])

  const pasteStored = useCallback(() => {
    const ids = pasteElements(elementClipboard.current, 12)
    if (ids.length) editorRef.current.setSelectedIds(ids)
  }, [pasteElements])

  const copyAppearance = useCallback(() => {
    const source = editorRef.current.selectedElements.find((element) => element.kind !== 'group')
    if (source) appearanceClipboard.current = appearanceOf(source)
  }, [])

  const pasteAppearance = useCallback(() => {
    const appearance = appearanceClipboard.current
    const current = editorRef.current
    if (!appearance || current.selectedIds.length === 0) return
    const targets = leafElements(current.document?.elements ?? [], current.selectedIds).filter((element) => !element.locked)
    if (targets.length === 0) return
    current.updateElements(targets.map((element) => ({ id: element.id, patch: appearancePatch(appearance) })), true, 'Paste properties')
  }, [])

  /** Keeps each target's box and replaces everything else with the copied objects. */
  const pasteToReplace = useCallback(() => {
    const current = editorRef.current
    if (elementClipboard.current.length === 0 || current.selectedIds.length === 0) return
    const replaced = current.selectedIds
    const ids = pasteElements(elementClipboard.current, 0)
    current.removeElements(replaced)
    if (ids.length) current.setSelectedIds(ids)
  }, [pasteElements])

  const order = useCallback((mode: 'forward' | 'backward' | 'front' | 'back') => {
    const current = editorRef.current
    if (current.selectedIds.length === 0) return
    current.orderElements(current.selectedIds, mode)
  }, [])

  const walkSiblings = useCallback((direction: 1 | -1) => {
    const current = editorRef.current
    const doc = current.document
    if (!doc) return
    const next = nextSiblingId(doc.elements, current.selectedIds.at(-1) ?? null, current.enteredGroupId, direction)
    if (next) current.setSelectedIds([next])
  }, [])

  const setOpacity = useCallback((digit: string) => {
    const current = editorRef.current
    if (current.selectedIds.length === 0) return
    const { opacity, buffer } = opacityFromDigit(opacityBuffer.current, digit, Date.now())
    opacityBuffer.current = buffer
    current.updateElements(current.selectedElements.filter((element) => !element.locked).map((element) => ({ id: element.id, patch: { opacity } })), true, 'Change opacity')
  }, [])

  const selectSame = useCallback((key: 'fill' | 'stroke' | 'strokeWidth') => {
    const current = editorRef.current
    const doc = current.document
    const reference = current.selectedElements.find((element) => element.kind !== 'group')
    if (!doc || !reference) return
    current.setSelectedIds(matchingIds(doc.elements, reference, key))
  }, [])

  const alignSelection = useCallback((mode: AlignMode) => {
    const current = editorRef.current
    const doc = current.document
    if (!doc || current.selectedElements.length === 0) return
    const leaves = leafElements(doc.elements, current.selectedIds)
    const target = current.selectedElements.length > 1 && leaves.length ? selectionBounds(leaves) : { x: 0, y: 0, width: doc.width, height: doc.height }
    current.updateElements(expandMoves(doc.elements, alignElements(current.selectedElements, mode, target)), true, 'Align')
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
      elementClipboard.current = structuredClone(elements)
      if (cut) current.removeElements(current.selectedIds)
    }
    const onPaste = (event: ClipboardEvent) => {
      if (editable(event.target)) return
      const pictures = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'))
      if (pictures.length > 0) {
        event.preventDefault()
        void controller.current?.addImages(pictures)
        return
      }
      const payload = readClipboardPayload(event.clipboardData)
      if (!payload) {
        // Nothing readable on the system clipboard: fall back to what a menu copy stored.
        if (elementClipboard.current.length === 0) return
        event.preventDefault()
        pasteStored()
        return
      }
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
      if (meta && key === 's') {
        event.preventDefault()
        if (event.shiftKey) void fileRef.current.saveAs()
        else void fileRef.current.saveNow()
        return
      }
      if (meta && key === 'o') {
        event.preventDefault()
        requestOpen()
        return
      }
      if (meta && (key === ']' || key === '[' || event.code === 'BracketRight' || event.code === 'BracketLeft')) {
        event.preventDefault()
        const forward = key === ']' || event.code === 'BracketRight'
        order(event.altKey ? (forward ? 'front' : 'back') : (forward ? 'forward' : 'backward'))
        return
      }
      if (meta && event.altKey && key === 'c') {
        event.preventDefault()
        copyAppearance()
        return
      }
      if (meta && event.altKey && key === 'v') {
        event.preventDefault()
        pasteAppearance()
        return
      }
      if (meta && event.shiftKey && key === 'r') {
        event.preventDefault()
        pasteToReplace()
        return
      }
      if (meta && key === '/') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
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
        current.updateElements(current.selectedElements.map((element) => ({ id: element.id, patch: { locked } })), true, locked ? 'Lock' : 'Unlock')
        return
      }
      if (meta && event.shiftKey && key === 'h') {
        event.preventDefault()
        if (current.selectedElements.length === 0) return
        const visible = !current.selectedElements.every((element) => element.visible)
        current.updateElements(current.selectedElements.map((element) => ({ id: element.id, patch: { visible } })), true, visible ? 'Show' : 'Hide')
        return
      }
      if (meta) return
      if (key === 'tab') {
        // Only the canvas walks objects with Tab; everywhere else it still moves focus.
        const active = window.document.activeElement
        const onCanvas = !active || active === window.document.body || (active instanceof HTMLElement && !!active.closest('#main'))
        if (!onCanvas) return
        event.preventDefault()
        walkSiblings(event.shiftKey ? -1 : 1)
        return
      }
      if (event.shiftKey && key === 'enter') {
        event.preventDefault()
        const doc = current.document
        const parent = doc && current.enteredGroupId ? doc.elements.find((element) => element.id === current.enteredGroupId) ?? null : null
        current.setEnteredGroupId(parent?.parentId ?? null)
        if (parent) current.setSelectedIds([parent.id])
        return
      }
      if (!event.shiftKey && /^[0-9]$/.test(event.key) && current.selectedIds.length > 0) {
        event.preventDefault()
        setOpacity(event.key)
        return
      }
      if (event.altKey) {
        const mode = ALIGN_KEYS[event.code]
        if (mode && current.selectedElements.length > 0) {
          event.preventDefault()
          alignSelection(mode)
        } else if (event.code === 'KeyR' && current.selectedElements.length > 0) {
          event.preventDefault()
          transformSelection((center) => rotationAffine(event.shiftKey ? -90 : 90, center), 'Rotate 90°')
        }
        return
      }
      if (event.shiftKey && (key === 'h' || key === 'v') && current.selectedElements.length > 0) {
        event.preventDefault()
        transformSelection((center) => flipAffine(key === 'h' ? 'x' : 'y', center), key === 'h' ? 'Flip horizontal' : 'Flip vertical')
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
      else if (key === 't') chooseTool('text')
      else if (key === 'f') chooseTool('frame')
      else if (key === 'r') chooseTool('rectangle')
      else if (key === 'o') chooseTool('ellipse')
      else if (key === 'enter') {
        const selected = current.selected
        if (current.selectedIds.length === 1 && selected) {
          event.preventDefault()
          if (isContainer(selected)) {
            current.setEnteredGroupId(selected.id)
            const first = childrenOf(current.document?.elements ?? [], selected.id).at(-1)
            if (first) current.setSelectedIds([first.id])
          } else if (selected.kind === 'text') {
            controller.current?.editText(selected.id)
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
        current.updateElements(leaves.map((element) => ({ id: element.id, patch: { x: element.x + dx, y: element.y + dy } })), true, countedLabel('Move', leaves.length))
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
  }, [tool, chooseTool, group, ungroup, alignSelection, transformSelection, pasteElements, pasteStored, requestOpen, order, copyAppearance, pasteAppearance, pasteToReplace, walkSiblings, setOpacity])

  if (!document) {
    return (
      <main className="vector-missing" id="main">
        <button type="button" className="btn btn--solid btn--md" onClick={() => navigate('/')}>Back to library</button>
      </main>
    )
  }

  /** The frame an export means: the selected one, the one holding the selection, or the only one. */
  const frames = document.elements.filter((element) => element.kind === 'frame')
  const selectedFrame = selectedElements.find((element) => element.kind === 'frame')
    ?? frames.find((frame) => selectedIds.some((id) => ancestorIds(document.elements, id).includes(frame.id)))
    ?? (frames.length === 1 ? frames[0] : undefined)
    ?? null

  const runExport = async (settings: ExportSettings) => {
    setExportError(null)
    const selection = { frameId: selectedFrame?.id ?? null, selectedIds }
    const bounds = exportBounds(document, settings.target, selection)
    const markup = exportMarkup(document, settings, selection)
    if (!markup || !bounds) {
      setExportError('There is nothing to export with those settings.')
      return
    }
    const embedded = await embedFonts(markup)
    const name = exportFileName(document, settings, selectedFrame?.name)
    if (settings.format === 'svg') {
      downloadBlob(new Blob([embedded], { type: 'image/svg+xml' }), name)
      return
    }
    const png = await rasterize(embedded, bounds, settings.scale)
    if (!png) {
      setExportError('That drawing could not be rendered to PNG in this browser.')
      return
    }
    downloadBlob(png, name)
  }

  const palette: PaintPalette = {
    recent: document.recentColors,
    swatches: document.swatches,
    onColorUsed: (hex) => editor.updateDocument({ recentColors: pushRecentColor(document.recentColors, hex) }, false),
    onAddSwatch: (hex) => editor.updateDocument({ swatches: toggleSwatch(document.swatches, hex) }, true, 'Pin colour'),
    onRemoveSwatch: (hex) => editor.updateDocument({ swatches: toggleSwatch(document.swatches, hex, true) }, true, 'Unpin colour'),
    onPickFromCanvas: (apply) => { void startCanvasPick(apply) },
  }

  /** Renders the page offscreen once, then the next canvas click reads a pixel out of it. */
  const startCanvasPick = async (apply: (hex: string) => void) => {
    setExportError(null)
    const sample = await sampleDocument(document)
    if (!sample) {
      setExportError('This browser could not render the drawing to sample a colour from it.')
      return
    }
    setSampler({ sample, apply })
  }

  const finishCanvasPick = (point: { x: number; y: number } | null) => {
    const active = sampler
    setSampler(null)
    if (!active || !point) return
    const hex = colorAt(active.sample, point)
    if (!hex) return
    active.apply(hex)
    editor.updateDocument({ recentColors: pushRecentColor(document.recentColors, hex) }, false)
  }

  const createStyle = (kind: 'fill' | 'stroke', source: VectorElement) => {
    const existing = document.styles ?? []
    const base = kind === 'fill' ? 'Fill style' : 'Stroke style'
    let name = `${base} ${existing.filter((style) => style.kind === kind).length + 1}`
    while (existing.some((style) => style.name === name)) name = `${name}'`
    const style = styleFromElement(source, kind, name, crypto.randomUUID())
    const targets = leafElements(document.elements, selectedIds)
    editor.editDocument((current) => ({
      ...current,
      styles: [...(current.styles ?? []), style],
      elements: current.elements.map((element) => targets.some((target) => target.id === element.id) ? { ...element, ...applyStylePatch(style) } : element),
    }), true, `Create style “${style.name}”`)
  }

  const linkStyle = (kind: 'fill' | 'stroke', styleId: string | null) => {
    const style = styleId ? (document.styles ?? []).find((item) => item.id === styleId) : null
    if (styleId && !style) return
    const targets = leafElements(document.elements, selectedIds)
    if (targets.length === 0) return
    editor.updateElements(targets.map((element) => ({ id: element.id, patch: style ? applyStylePatch(style) : detachStylePatch(kind) })), true, style ? `Apply “${style.name}”` : 'Detach style')
  }

  const updateStyle = (styleId: string, paints: VectorPaint[], record?: boolean) => {
    editor.editDocument((current) => {
      const styles = (current.styles ?? []).map((style) => style.id === styleId ? { ...style, paints } : style)
      const style = styles.find((item) => item.id === styleId)
      if (!style) return current
      const patches = new Map(syncStylePatches(current.elements, style).map((entry) => [entry.id, entry.patch]))
      return {
        ...current,
        styles,
        elements: current.elements.map((element) => patches.has(element.id) ? { ...element, ...patches.get(element.id)! } : element),
      }
    }, record, 'Change style')
  }

  const renameStyle = (styleId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    editor.updateDocument({ styles: (document.styles ?? []).map((style) => style.id === styleId ? { ...style, name: trimmed.slice(0, 60) } : style) }, true, 'Rename style')
  }

  const deleteStyle = (styleId: string) => {
    const style = (document.styles ?? []).find((item) => item.id === styleId)
    if (!style) return
    const key = styleIdKey(style.kind)
    editor.editDocument((current) => ({
      ...current,
      styles: (current.styles ?? []).filter((item) => item.id !== styleId),
      // The objects keep the look they had; only the link goes.
      elements: current.elements.map((element) => element[key] === styleId ? { ...element, [key]: undefined } : element),
    }), true, `Delete style “${style.name}”`)
  }

  const savePreset = (name: string, settings: ExportSettings) => {
    const presets = [...(document.exportPresets ?? []), { id: crypto.randomUUID(), name: name.trim().slice(0, 60), ...settings }].slice(-MAX_EXPORT_PRESETS)
    editor.updateDocument({ exportPresets: presets })
  }

  const deletePreset = (id: string) => {
    const presets = (document.exportPresets ?? []).filter((preset) => preset.id !== id)
    editor.updateDocument({ exportPresets: presets.length ? presets : undefined })
  }

  const toggleLock = () => {
    if (selectedElements.length === 0) return
    editor.updateElements(selectedElements.map((element) => ({ id: element.id, patch: { locked: !allLocked } })), true, allLocked ? 'Unlock' : 'Lock')
  }

  const single = selectedElements.length === 1 ? selectedElements[0]! : null
  const hasSelection = selectedIds.length > 0
  const paintReference = selectedElements.find((element) => element.kind !== 'group') ?? null

  const commands: VectorCommand[] = [
    { id: 'undo', label: 'Undo', section: 'Edit', shortcut: SHORTCUTS.undo, disabled: !editor.canUndo, run: editor.undo },
    { id: 'redo', label: 'Redo', section: 'Edit', shortcut: SHORTCUTS.redo, disabled: !editor.canRedo, run: editor.redo },
    { id: 'copy', label: 'Copy', section: 'Edit', shortcut: SHORTCUTS.copy, disabled: !hasSelection, run: () => copySelection(false) },
    { id: 'cut', label: 'Cut', section: 'Edit', shortcut: SHORTCUTS.cut, disabled: !hasSelection, run: () => copySelection(true) },
    { id: 'paste', label: 'Paste', section: 'Edit', shortcut: SHORTCUTS.paste, disabled: elementClipboard.current.length === 0, run: pasteStored },
    { id: 'paste-replace', label: 'Paste to replace', section: 'Edit', shortcut: SHORTCUTS.pasteToReplace, disabled: !hasSelection || elementClipboard.current.length === 0, run: pasteToReplace },
    { id: 'copy-properties', label: 'Copy properties', section: 'Edit', shortcut: SHORTCUTS.copyProperties, disabled: !paintReference, run: copyAppearance },
    { id: 'paste-properties', label: 'Paste properties', section: 'Edit', shortcut: SHORTCUTS.pasteProperties, disabled: !hasSelection || !appearanceClipboard.current, run: pasteAppearance },
    { id: 'duplicate', label: 'Duplicate', section: 'Edit', shortcut: SHORTCUTS.duplicate, disabled: !hasSelection, run: editor.duplicateSelection },
    { id: 'delete', label: 'Delete', section: 'Edit', shortcut: SHORTCUTS.delete, disabled: !hasSelection, run: () => editor.removeElements(selectedIds) },
    { id: 'select-all', label: 'Select all', section: 'Selection', shortcut: SHORTCUTS.selectAll, run: () => editor.setSelectedIds(childrenOf(document.elements, editor.enteredGroupId).filter((element) => element.visible && !element.locked).map((element) => element.id)) },
    { id: 'next-sibling', label: 'Select next object', section: 'Selection', shortcut: SHORTCUTS.nextSibling, run: () => walkSiblings(1) },
    { id: 'previous-sibling', label: 'Select previous object', section: 'Selection', shortcut: SHORTCUTS.previousSibling, run: () => walkSiblings(-1) },
    { id: 'same-fill', label: 'Select all with same fill', section: 'Selection', disabled: !paintReference, run: () => selectSame('fill') },
    { id: 'same-stroke', label: 'Select all with same stroke', section: 'Selection', disabled: !paintReference, run: () => selectSame('stroke') },
    { id: 'same-stroke-width', label: 'Select all with same stroke width', section: 'Selection', disabled: !paintReference, run: () => selectSame('strokeWidth') },
    { id: 'bring-forward', label: 'Bring forward', section: 'Arrange', shortcut: SHORTCUTS.bringForward, disabled: !hasSelection, run: () => order('forward') },
    { id: 'send-backward', label: 'Send backward', section: 'Arrange', shortcut: SHORTCUTS.sendBackward, disabled: !hasSelection, run: () => order('backward') },
    { id: 'bring-to-front', label: 'Bring to front', section: 'Arrange', shortcut: SHORTCUTS.bringToFront, disabled: !hasSelection, run: () => order('front') },
    { id: 'send-to-back', label: 'Send to back', section: 'Arrange', shortcut: SHORTCUTS.sendToBack, disabled: !hasSelection, run: () => order('back') },
    { id: 'group', label: 'Group', section: 'Arrange', shortcut: SHORTCUTS.group, disabled: !hasSelection, run: group },
    { id: 'ungroup', label: 'Ungroup', section: 'Arrange', shortcut: SHORTCUTS.ungroup, disabled: !canUngroup, run: ungroup },
    { id: 'flip-h', label: 'Flip horizontal', section: 'Arrange', shortcut: SHORTCUTS.flipHorizontal, disabled: !hasSelection, run: () => transformSelection((center) => flipAffine('x', center), 'Flip horizontal') },
    { id: 'flip-v', label: 'Flip vertical', section: 'Arrange', shortcut: SHORTCUTS.flipVertical, disabled: !hasSelection, run: () => transformSelection((center) => flipAffine('y', center), 'Flip vertical') },
    { id: 'rotate-90', label: 'Rotate 90°', section: 'Arrange', shortcut: SHORTCUTS.rotate90, disabled: !hasSelection, run: () => transformSelection((center) => rotationAffine(90, center), 'Rotate 90°') },
    { id: 'lock', label: allLocked ? 'Unlock' : 'Lock', section: 'Object', shortcut: SHORTCUTS.lock, disabled: !hasSelection, run: toggleLock },
    { id: 'hide', label: selectedElements.every((element) => element.visible) ? 'Hide' : 'Show', section: 'Object', shortcut: SHORTCUTS.hide, disabled: !hasSelection, run: () => editor.updateElements(selectedElements.map((element) => ({ id: element.id, patch: { visible: !selectedElements.every((item) => item.visible) } }))) },
    { id: 'opacity', label: 'Set opacity', section: 'Object', shortcut: SHORTCUTS.opacity, disabled: !hasSelection, run: () => setOpacity('0') },
    { id: 'edit-nodes', label: 'Edit nodes', section: 'Object', shortcut: SHORTCUTS.enter, disabled: !single || single.kind === 'group' || single.kind === 'text' || single.locked, run: () => chooseTool('node') },
    { id: 'edit-text', label: 'Edit text', section: 'Object', shortcut: SHORTCUTS.enter, disabled: single?.kind !== 'text', run: () => { if (single) controller.current?.editText(single.id) } },
    { id: 'combine', label: 'Combine paths', section: 'Object', shortcut: SHORTCUTS.combine, disabled: selectedElements.filter((element) => element.kind !== 'group').length < 2, run: () => window.document.querySelector<HTMLButtonElement>('.vector-inspector button[data-action="combine"]')?.click() },
    { id: 'flatten', label: 'Flatten', section: 'Object', disabled: !hasSelection, run: () => window.document.querySelector<HTMLButtonElement>('.vector-inspector button[data-action="flatten"]')?.click() },
    { id: 'outline-stroke', label: 'Outline stroke', section: 'Object', disabled: !single || single.kind === 'group' || single.strokeWidth <= 0, run: () => window.document.querySelector<HTMLButtonElement>('.vector-inspector button[data-action="outline-stroke"]')?.click() },
    { id: 'rename', label: 'Rename layers…', section: 'Object', disabled: !hasSelection, run: () => setRenameOpen(true) },
    { id: 'open', label: 'Open…', section: 'File', shortcut: SHORTCUTS.open, run: requestOpen },
    { id: 'save-as', label: 'Save as…', section: 'File', shortcut: SHORTCUTS.saveAs, run: () => void file.saveAs() },
    { id: 'import-svg', label: 'Import SVG…', section: 'File', run: () => importInput.current?.click() },
    { id: 'export', label: 'Export…', section: 'File', run: () => void runExport(exportSettings) },
    { id: 'zoom-reset', label: 'Zoom to 100%', section: 'View', shortcut: SHORTCUTS.zoomReset, run: () => controller.current?.zoomTo(1) },
    { id: 'zoom-fit', label: 'Fit page', section: 'View', shortcut: SHORTCUTS.zoomFit, run: () => controller.current?.fit(null) },
    { id: 'zoom-selection', label: 'Fit selection', section: 'View', shortcut: SHORTCUTS.zoomSelection, disabled: !hasSelection, run: () => controller.current?.fit(selectionBounds(leafElements(document.elements, selectedIds)), 96) },
  ]

  const byId = new Map(commands.map((command) => [command.id, command]))
  const menuItem = (id: string, icon?: ReactNode, separatorBefore?: boolean): ContextMenuItem[] => {
    const command = byId.get(id)
    if (!command) return []
    return [{ label: command.shortcut ? `${command.label} · ${command.shortcut}` : command.label, icon, disabled: command.disabled, ...(separatorBefore === undefined ? {} : { separatorBefore }), onSelect: command.run }]
  }

  const canvasMenuItems: ContextMenuItem[] = [
    ...menuItem('copy', <IconCopy />),
    ...menuItem('paste', <IconPaste />, false),
    ...menuItem('duplicate', undefined, false),
    ...menuItem('delete', <IconTrash />, false),
    ...menuItem('group', <IconGroup />),
    ...menuItem('ungroup', <IconUngroup />, false),
    ...menuItem('bring-forward', <IconBringForward />),
    ...menuItem('send-backward', <IconSendBackward />, false),
    ...menuItem('bring-to-front', undefined, false),
    ...menuItem('send-to-back', undefined, false),
    ...menuItem('flip-h', <IconFlipH />),
    ...menuItem('flip-v', <IconFlipV />, false),
    ...menuItem('rotate-90', <IconRotate90 />, false),
    ...menuItem('combine'),
    ...menuItem('flatten', undefined, false),
    ...menuItem('outline-stroke', undefined, false),
    ...menuItem(single?.kind === 'text' ? 'edit-text' : 'edit-nodes', <IconNode />, false),
    ...menuItem('same-fill'),
    ...menuItem('same-stroke', undefined, false),
    ...menuItem('same-stroke-width', undefined, false),
    ...menuItem('rename', <IconPencil />),
    ...menuItem('lock', allLocked ? <IconUnlock /> : <IconLock />),
    ...menuItem('hide', <IconEyeOff />, false),
  ]

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
          onRenameMany={(ids) => { editor.setSelectedIds(ids); setRenameOpen(true) }}
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
          historySteps={editor.historySteps}
          historyIndex={editor.historyIndex}
          onGoToStep={editor.goToStep}
          onSaveVersion={editor.saveVersion}
          onRestoreVersion={editor.restoreVersion}
          onDeleteVersion={editor.deleteVersion}
          onGestureStart={editor.beginGesture}
          onGestureEnd={editor.endGesture}
          onGestureCancel={editor.cancelGesture}
          saveBadge={<VectorSaveBadge file={file} />}
          saveMessage={file.message ?? exportError}
          palette={palette}
          onCreateStyle={createStyle}
          onLinkStyle={linkStyle}
          onUpdateStyle={updateStyle}
          onRenameStyle={renameStyle}
          onDeleteStyle={deleteStyle}
          onCropImage={(id) => controller.current?.cropImage(id)}
        />
      }
    >
      <h1 className="visually-hidden">{document.name}</h1>
      <div className="workspace-toolbar vector-toolbar" role="toolbar" aria-label="Vector tools">
        <div className="workspace-toolbar__group">
          <VectorFileMenu
            file={file}
            onNewDocument={newDocument}
            onOpenProject={requestOpen}
            onImportSvg={() => importInput.current?.click()}
          />
          <Tooltip content={withShortcut('Undo', 'undo')}>
            <IconButton label="Undo" disabled={!editor.canUndo} onClick={editor.undo}><IconUndo /></IconButton>
          </Tooltip>
          <Tooltip content={withShortcut('Redo', 'redo')}>
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
          <ToolButton label="Edit nodes · Enter" active={tool === 'node'} disabled={selectedIds.length !== 1 || selectedElements[0]?.kind === 'group' || selectedElements[0]?.kind === 'text' || !!selectedElements[0]?.locked} onClick={() => chooseTool('node')}><IconNode /></ToolButton>
          <ToolButton label="Pen · P" active={tool === 'pen'} onClick={() => chooseTool('pen')}><IconPen /></ToolButton>
          <ToolButton label="Pencil · ⇧P" active={tool === 'pencil'} onClick={() => chooseTool('pencil')}><IconPencilTool /></ToolButton>
          <ToolButton label="Lasso · Q" active={tool === 'lasso'} onClick={() => chooseTool('lasso')}><IconLasso /></ToolButton>
          <ToolButton label="Paint bucket · B" active={tool === 'bucket'} onClick={() => chooseTool('bucket')}><IconBucket /></ToolButton>
          <ToolButton label="Frame · F" active={tool === 'frame'} onClick={() => chooseTool('frame')}><IconFrame /></ToolButton>
          <ToolButton label="Text · T" active={tool === 'text'} onClick={() => chooseTool('text')}><IconText /></ToolButton>
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
          <Tooltip content={withShortcut('Commands', 'palette')}>
            <IconButton label="Commands" onClick={() => setPaletteOpen(true)}><IconCommand /></IconButton>
          </Tooltip>
          <ViewOptionsMenu value={viewOptions} onChange={setViewOptions} />
          <VectorExportMenu
            settings={exportSettings}
            onSettings={setExportSettings}
            frameName={selectedFrame?.name ?? null}
            selectionCount={selectedIds.length}
            presets={document.exportPresets ?? []}
            onExport={(settings) => void runExport(settings)}
            onSavePreset={savePreset}
            onDeletePreset={deletePreset}
          />
          {selectedIds.length > 0 ? (
            <div className="workspace-toolbar__group vector-toolbar__selection">
              {canUngroup ? (
                <Tooltip content={withShortcut('Ungroup', 'ungroup')}>
                  <IconButton label="Ungroup" onClick={ungroup}><IconUngroup /></IconButton>
                </Tooltip>
              ) : null}
              <Tooltip content={withShortcut('Group', 'group')}>
                <IconButton label="Group" onClick={group}><IconGroup /></IconButton>
              </Tooltip>
              <Tooltip content={withShortcut('Flip horizontal', 'flipHorizontal')}>
                <IconButton label="Flip horizontal" onClick={() => transformSelection((center) => flipAffine('x', center))}><IconFlipH /></IconButton>
              </Tooltip>
              <Tooltip content={withShortcut('Flip vertical', 'flipVertical')}>
                <IconButton label="Flip vertical" onClick={() => transformSelection((center) => flipAffine('y', center))}><IconFlipV /></IconButton>
              </Tooltip>
              <Tooltip content={withShortcut('Rotate 90°', 'rotate90')}>
                <IconButton label="Rotate 90 degrees" onClick={() => transformSelection((center) => rotationAffine(90, center))}><IconRotate90 /></IconButton>
              </Tooltip>
              <Tooltip content={withShortcut(allLocked ? 'Unlock' : 'Lock', 'lock')}>
                <IconButton label={allLocked ? 'Unlock selection' : 'Lock selection'} aria-pressed={allLocked} onClick={toggleLock}>{allLocked ? <IconLock /> : <IconUnlock />}</IconButton>
              </Tooltip>
              <Tooltip content={withShortcut('Delete', 'delete')}>
                <IconButton label="Delete selection" onClick={() => editor.removeElements(selectedIds)}><IconTrash /></IconButton>
              </Tooltip>
            </div>
          ) : null}
          <input ref={importInput} type="file" accept=".svg,image/svg+xml" className="visually-hidden" tabIndex={-1} onChange={(event) => { void importFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
          <input ref={projectInput} type="file" accept=".json,application/json" className="visually-hidden" tabIndex={-1} onChange={(event) => { const picked = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (picked) void openProject(picked) }} />
        </div>
      </div>
      <div
        className="preview-stage vector-stage"
        id="main"
        tabIndex={-1}
        onContextMenuCapture={(event) => {
          // A right click ends a modal transform; it should not also open the menu.
          if (window.document.querySelector('.vector-canvas[data-transform]')) event.stopPropagation()
        }}
      >
        <ContextMenuRoot>
        <ContextTarget className="vector-stage__menu" items={canvasMenuItems} label="Canvas actions" touchActions={false}>
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
            if (tool === 'rectangle' || tool === 'ellipse' || tool === 'text' || tool === 'frame') chooseTool('select')
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
          sampling={!!sampler}
          onSample={finishCanvasPick}
        />
        </ContextTarget>
        </ContextMenuRoot>
      </div>
      <VectorCommandPalette commands={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <VectorRenameDialog
        elements={selectedElements}
        open={renameOpen && selectedElements.length > 0}
        onClose={() => setRenameOpen(false)}
        onRename={(names) => editor.updateElements(selectedElements.map((element, index) => ({ id: element.id, patch: { name: names[index]! } })), true, countedLabel('Rename', selectedElements.length, 'layer'))}
      />
    </WorkspaceShell>
  )
}

/** Turns group moves into leaf moves so grouped objects follow. */
function expandMoves(elements: VectorElement[], patches: ElementPatch[]): ElementPatch[] {
  const updates: ElementPatch[] = []
  for (const { id, patch } of patches) {
    const element = elements.find((item) => item.id === id)
    if (!element) continue
    if (!isContainer(element)) {
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

function downloadBlob(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = href
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(href)
}
