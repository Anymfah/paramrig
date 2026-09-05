import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorModal } from '@/editor/EditorModal'
import { EditorSaveBadge } from '@/editor/EditorSaveBadge'
import { formatClock, type ProjectFile } from '@/editor/useProjectFile'
import { bindingFor, shortcutLabel } from '@/scene/keymap'
import { SceneMenu, type SceneMenuEntry } from '@/scene/SceneMenu'
import type { SceneDocument, SceneVersion } from '@/scene/types'
import { CoformSymbol } from '@/ui/BrandMark'
import { Button, IconButton } from '@/ui/Button'
import { MODEL_ACCEPT } from '@/scene/io/models'
import { IconDoc, IconDownload, IconFolderOpen, IconImport, IconKeyframe, IconReset, IconSnapshot, IconTrash } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'

/**
 * The left end of the editor's header: the mark, what the scene is called, whether the last write
 * landed, and the menu for everything that happens to the document as a whole.
 *
 * The name commits when the field is left or Enter is pressed, and Escape puts back what was there
 * — a half-typed name is never what anyone meant to save. Versions open in a dialog rather than a
 * submenu, because restoring and deleting want a list you can read, not a menu you hover through.
 */
export function SceneFileMenu({
  name,
  file,
  versions,
  onRename,
  onOpen,
  onImport,
  onImportModel,
  onExportModel,
  onRender,
  onExport,
  onRevert,
  onSaveVersion,
  onRestoreVersion,
  onDeleteVersion,
  onCommand,
}: {
  name: string
  file: ProjectFile<SceneDocument>
  versions: SceneVersion[]
  /** The editor's own actions, which are not operators: undo, redo, the preferences. */
  onCommand: (id: string) => void
  onRename: (name: string) => void
  onOpen: () => void
  onImport: (file: File) => void
  /** A model file — glTF, OBJ or STL — brought into the scene rather than opened as a project. */
  onImportModel: (file: File) => void
  onExportModel: (format: 'gltf' | 'obj' | 'stl') => void
  onRender: () => void
  onExport: () => void
  onRevert: () => void
  onSaveVersion: (name: string) => void
  onRestoreVersion: (id: string) => void
  onDeleteVersion: (id: string) => void
}) {
  const importInput = useRef<HTMLInputElement>(null)
  const modelInput = useRef<HTMLInputElement>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)

  const commit = (field: HTMLInputElement) => {
    const next = field.value.trim()
    // An empty name, or the name it already had, is not an edit worth a step in the history.
    if (!next || next === name) {
      field.value = name
      return
    }
    onRename(next)
  }

  /* The editor's own actions rather than operators, so they are written out rather than looked up. */
  const editEntries: SceneMenuEntry[] = [
    { id: 'undo', label: 'Undo', ...(shortcutFor('undo') ? { shortcut: shortcutFor('undo') } : {}), run: () => onCommand('undo') },
    { id: 'redo', label: 'Redo', ...(shortcutFor('redo') ? { shortcut: shortcutFor('redo') } : {}), run: () => onCommand('redo') },
    { id: 'repeatLast', label: 'Repeat last', ...(shortcutFor('repeatLast') ? { shortcut: shortcutFor('repeatLast') } : {}), run: () => onCommand('repeatLast') },
    { id: 'redoPanel', label: 'Adjust last operation', ...(shortcutFor('redoPanel') ? { shortcut: shortcutFor('redoPanel') } : {}), run: () => onCommand('redoPanel') },
    { separator: true },
    { id: 'favorites', label: 'Quick favourites', ...(shortcutFor('favorites') ? { shortcut: shortcutFor('favorites') } : {}), run: () => onCommand('favorites') },
    { separator: true },
    { id: 'preferences', label: 'Preferences…', ...(shortcutFor('preferences') ? { shortcut: shortcutFor('preferences') } : {}), run: () => onCommand('preferences') },
  ]

  return (
    <div className="scene-file">
      <CoformSymbol className="scene-file__mark" />
      <input
        className="scene-file__name"
        aria-label="Scene name"
        // Remounting on a rename is what puts an outside change — a restore, an opened file — in
        // the field, since an uncontrolled input keeps whatever was last typed into it.
        key={name}
        defaultValue={name}
        maxLength={120}
        spellCheck={false}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            event.currentTarget.value = name
            event.currentTarget.blur()
          }
        }}
      />
      <EditorSaveBadge file={file} />
      <DropdownMenu.Root modal={false}>
        <Tooltip content="The document, its file, and its versions">
          <DropdownMenu.Trigger asChild>
            <button type="button" className="scene-file__button">File</button>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu scene-file-menu" side="bottom" align="start" sideOffset={8} collisionPadding={8} aria-label="File">
            <FileItem
              label={file.linked ? 'Save a copy…' : 'Save as…'}
              shortcut={shortcutFor('file.saveAs')}
              onSelect={() => void file.saveAs()}
            ><IconDownload /></FileItem>
            <FileItem label="Open…" shortcut={shortcutFor('file.open')} onSelect={onOpen}><IconFolderOpen /></FileItem>
            <DropdownMenu.Separator className="menu__sep" />
            <FileItem label="Import project" onSelect={() => importInput.current?.click()}><IconImport /></FileItem>
            <FileItem label="Export project" onSelect={onExport}><IconDoc /></FileItem>
            <DropdownMenu.Separator className="menu__sep" />
            <FileItem label="Import model…" onSelect={() => modelInput.current?.click()}><IconImport /></FileItem>
            <FileItem label="Export glTF (.glb)" onSelect={() => onExportModel('gltf')}><IconDownload /></FileItem>
            <FileItem label="Export OBJ" onSelect={() => onExportModel('obj')}><IconDownload /></FileItem>
            <FileItem label="Export STL" onSelect={() => onExportModel('stl')}><IconDownload /></FileItem>
            <DropdownMenu.Separator className="menu__sep" />
            <FileItem label="Render image…" shortcut="F12" onSelect={onRender}><IconSnapshot /></FileItem>
            <FileItem label="Revert" onSelect={onRevert}><IconReset /></FileItem>
            <DropdownMenu.Separator className="menu__sep" />
            <FileItem
              label="Versions…"
              detail={versions.length ? String(versions.length) : undefined}
              onSelect={() => setVersionsOpen(true)}
            ><IconKeyframe /></FileItem>
            {file.linked ? (
              <>
                <DropdownMenu.Separator className="menu__sep" />
                <p className="scene-file-menu__path">Autosaving to <span className="scene-file-menu__name">{file.fileName}</span></p>
                <FileItem label="Stop saving to that file" onSelect={() => void file.unlink()} />
              </>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {/*
        * Edit, beside File, which is where Blender keeps undo, redo and the preferences: in the
        * topbar rather than in the 3D viewport's own header. Blender's viewport header has no Edit
        * menu at all, and every entry below is in the topbar's — so this is where a hand trained on
        * Blender reaches, and it gives the viewport header back the width it was short of.
        */}
      <SceneMenu label="Edit" entries={editEntries} />
      <input
        ref={modelInput}
        type="file"
        accept={MODEL_ACCEPT}
        aria-label="Model file to import"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => {
          const picked = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (picked) onImportModel(picked)
        }}
      />
      <input
        ref={importInput}
        type="file"
        accept=".json,application/json"
        aria-label="Project file to import"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => {
          const picked = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (picked) onImport(picked)
        }}
      />
      <VersionsDialog
        open={versionsOpen}
        versions={versions}
        onClose={() => setVersionsOpen(false)}
        onSaveVersion={onSaveVersion}
        onRestoreVersion={onRestoreVersion}
        onDeleteVersion={onDeleteVersion}
      />
    </div>
  )
}

/**
 * The saved versions of a scene: what is kept, and the two things that can be done to one. A
 * restore replaces what is on screen, so it closes the dialog; a delete does not, so it does not.
 */
function VersionsDialog({ open, versions, onClose, onSaveVersion, onRestoreVersion, onDeleteVersion }: {
  open: boolean
  versions: SceneVersion[]
  onClose: () => void
  onSaveVersion: (name: string) => void
  onRestoreVersion: (id: string) => void
  onDeleteVersion: (id: string) => void
}) {
  const [name, setName] = useState('')

  useEffect(() => {
    if (!open) setName('')
  }, [open])

  const save = () => {
    onSaveVersion(name)
    setName('')
  }

  return (
    <EditorModal label="Versions" open={open} onClose={onClose}>
      <div className="scene-versions">
        <h2 className="scene-versions__title">Versions</h2>
        <p className="scene-versions__hint">
          A version keeps the objects, meshes, collections and materials as they are now. The twenty most recent are kept.
        </p>
        <div className="scene-versions__save">
          <input
            className="scene-versions__field"
            aria-label="Version name"
            value={name}
            placeholder={`Version ${versions.length + 1}`}
            maxLength={80}
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') save() }}
          />
          <Button variant="solid" size="sm" onClick={save}>Save version</Button>
        </div>
        {versions.length === 0 ? (
          <p className="scene-versions__empty">No versions yet.</p>
        ) : (
          <ul className="scene-versions__list">
            {versions.map((version) => (
              <li key={version.id} className="scene-versions__item">
                <span className="scene-versions__label">
                  <span className="scene-versions__name">{version.name}</span>
                  <span className="scene-versions__stamp">{versionStamp(version.createdAt)}</span>
                </span>
                <Button variant="quiet" size="sm" onClick={() => { onRestoreVersion(version.id); onClose() }}>
                  Restore
                </Button>
                <Tooltip content={`Delete ${version.name}`}>
                  <IconButton label={`Delete ${version.name}`} onClick={() => onDeleteVersion(version.id)}>
                    <IconTrash />
                  </IconButton>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
        <div className="scene-versions__actions">
          <Button variant="quiet" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </EditorModal>
  )
}

function FileItem({ label, shortcut, detail, onSelect, children }: {
  label: string
  shortcut?: string
  detail?: string
  onSelect: () => void
  children?: ReactNode
}) {
  return (
    <DropdownMenu.Item className="menu__item scene-file-menu__item" onSelect={onSelect}>
      <span className="scene-file-menu__glyph">{children}</span>
      <span className="scene-file-menu__label">{label}</span>
      {detail ? <span className="scene-file-menu__detail">{detail}</span> : null}
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </DropdownMenu.Item>
  )
}

/** The chord the keymap gives an action, so the menu and the keyboard cannot disagree. */
function shortcutFor(actionId: string): string | undefined {
  const binding = bindingFor(actionId)
  return binding ? shortcutLabel(binding) : undefined
}

function versionStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${formatClock(iso)}`
}
