import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { IconButton } from '@/ui/Button'
import { CoformSymbol } from '@/ui/BrandMark'
import { IconCommand, IconDownload, IconFolderOpen, IconImport, IconPlus, IconRedo, IconUndo } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { SHORTCUTS } from '@/vector/commands'
import type { ProjectFile } from '@/vector/useProjectFile'

/**
 * The one button at the head of the bar. It carries the document's own menu — new, open, save,
 * import — and the two actions that belong to no tool: undo and redo, and the command palette.
 */
export function VectorFileMenu({ file, canUndo, canRedo, undoLabel, redoLabel, onUndo, onRedo, onNewDocument, onOpenProject, onImportSvg, onCommands }: {
  file: ProjectFile
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  onUndo: () => void
  onRedo: () => void
  onNewDocument: () => void
  onOpenProject: () => void
  onImportSvg: () => void
  onCommands: () => void
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content="File">
        <DropdownMenu.Trigger asChild>
          <IconButton label="File" className="vector-file-button"><CoformSymbol className="vector-file-button__mark" /></IconButton>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu vector-file-menu" side="bottom" align="start" sideOffset={8} collisionPadding={8} aria-label="File">
          <FileItem label={undoLabel ? `Undo ${undoLabel}` : 'Undo'} shortcut={SHORTCUTS.undo} disabled={!canUndo} onSelect={onUndo}><IconUndo /></FileItem>
          <FileItem label={redoLabel ? `Redo ${redoLabel}` : 'Redo'} shortcut={SHORTCUTS.redo} disabled={!canRedo} onSelect={onRedo}><IconRedo /></FileItem>
          <DropdownMenu.Separator className="menu__sep" />
          <FileItem label="New document" onSelect={onNewDocument}><IconPlus /></FileItem>
          <FileItem label="Open…" shortcut={SHORTCUTS.open} onSelect={onOpenProject}><IconFolderOpen /></FileItem>
          <FileItem label={file.linked ? 'Save a copy…' : 'Save as…'} shortcut={SHORTCUTS.saveAs} onSelect={() => void file.saveAs()}><IconDownload /></FileItem>
          <FileItem label="Import SVG…" onSelect={onImportSvg}><IconImport /></FileItem>
          <DropdownMenu.Separator className="menu__sep" />
          <FileItem label="Commands…" shortcut={SHORTCUTS.palette} onSelect={onCommands}><IconCommand /></FileItem>
          {file.linked ? (
            <>
              <DropdownMenu.Separator className="menu__sep" />
              <p className="vector-file-menu__path">Autosaving to <span className="vector-file-menu__name">{file.fileName}</span></p>
              <FileItem label="Stop saving to that file" onSelect={() => void file.unlink()} />
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function FileItem({ label, shortcut, disabled, onSelect, children }: { label: string; shortcut?: string; disabled?: boolean; onSelect: () => void; children?: ReactNode }) {
  return (
    <DropdownMenu.Item className="menu__item vector-file-menu__item" disabled={disabled} onSelect={onSelect}>
      <span className="vector-file-menu__glyph">{children}</span>
      <span className="vector-file-menu__label">{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </DropdownMenu.Item>
  )
}
