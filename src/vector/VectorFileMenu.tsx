import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { IconButton } from '@/ui/Button'
import { IconCode, IconDoc, IconDownload, IconFolderOpen, IconImport, IconPlus } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import type { ProjectFile } from '@/vector/useProjectFile'

export function VectorFileMenu({ file, onNewDocument, onOpenProject, onImportSvg, onExportSvg }: {
  file: ProjectFile
  onNewDocument: () => void
  onOpenProject: () => void
  onImportSvg: () => void
  onExportSvg: () => void
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content="File">
        <DropdownMenu.Trigger asChild>
          <IconButton label="File"><IconDoc /></IconButton>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu vector-file-menu" side="bottom" align="start" sideOffset={8} collisionPadding={8} aria-label="File">
          <FileItem label="New document" onSelect={onNewDocument}><IconPlus /></FileItem>
          <FileItem label="Open…" shortcut="⌘O" onSelect={onOpenProject}><IconFolderOpen /></FileItem>
          <FileItem label={file.linked ? 'Save a copy…' : 'Save as…'} shortcut="⇧⌘S" onSelect={() => void file.saveAs()}><IconDownload /></FileItem>
          <DropdownMenu.Separator className="menu__sep" />
          <FileItem label="Import SVG…" onSelect={onImportSvg}><IconImport /></FileItem>
          <FileItem label="Export SVG" onSelect={onExportSvg}><IconCode /></FileItem>
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

function FileItem({ label, shortcut, onSelect, children }: { label: string; shortcut?: string; onSelect: () => void; children?: ReactNode }) {
  return (
    <DropdownMenu.Item className="menu__item vector-file-menu__item" onSelect={onSelect}>
      <span className="vector-file-menu__glyph">{children}</span>
      <span className="vector-file-menu__label">{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </DropdownMenu.Item>
  )
}
