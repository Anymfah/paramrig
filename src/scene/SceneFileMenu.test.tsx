import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectFile } from '@/editor/useProjectFile'
import { SceneFileMenu } from '@/scene/SceneFileMenu'
import type { SceneDocument, SceneVersion } from '@/scene/types'

function projectFile(over: Partial<ProjectFile<SceneDocument>> = {}): ProjectFile<SceneDocument> {
  return {
    state: 'saved',
    savedAt: '2026-09-03T09:04:00.000Z',
    message: null,
    fileName: null,
    linked: false,
    supported: false,
    saveAs: vi.fn(async () => undefined),
    saveNow: vi.fn(async () => undefined),
    openFromDisk: vi.fn(async () => null),
    downloadProject: vi.fn(),
    unlink: vi.fn(async () => undefined),
    ...over,
  }
}

const VERSION: SceneVersion = {
  id: 'version-1',
  name: 'Blocking',
  createdAt: '2026-09-01T08:30:00.000Z',
  objects: [],
  meshes: {},
  collections: [],
  materials: [],
}

function menu(over: Partial<Parameters<typeof SceneFileMenu>[0]> = {}) {
  const props = {
    name: 'Kitchen',
    file: projectFile(),
    versions: [] as SceneVersion[],
    onRename: vi.fn(),
    onOpen: vi.fn(),
    onImport: vi.fn(),
    onImportModel: vi.fn(),
    onExportModel: vi.fn(),
    onRender: vi.fn(),
    onExport: vi.fn(),
    onRevert: vi.fn(),
    onSaveVersion: vi.fn(),
    onRestoreVersion: vi.fn(),
    onDeleteVersion: vi.fn(),
    onCommand: vi.fn(),
    ...over,
  }
  render(<SceneFileMenu {...props} />)
  return props
}

describe('the scene name', () => {
  it('commits what was typed when Enter is pressed', async () => {
    const props = menu()
    const field = screen.getByRole('textbox', { name: 'Scene name' })

    await userEvent.clear(field)
    await userEvent.type(field, 'Kitchen, second pass{Enter}')

    expect(props.onRename).toHaveBeenCalledWith('Kitchen, second pass')
  })

  it('puts back the name it had when Escape is pressed', async () => {
    const props = menu()
    const field = screen.getByRole('textbox', { name: 'Scene name' })

    await userEvent.clear(field)
    await userEvent.type(field, 'Half typed{Escape}')

    expect(field).toHaveValue('Kitchen')
    expect(props.onRename).not.toHaveBeenCalled()
  })

  it('leaves the document alone when the field is left unchanged', async () => {
    const props = menu()

    await userEvent.click(screen.getByRole('textbox', { name: 'Scene name' }))
    await userEvent.tab()

    expect(props.onRename).not.toHaveBeenCalled()
  })

  it('refuses to name a scene nothing at all', async () => {
    const props = menu()
    const field = screen.getByRole('textbox', { name: 'Scene name' })

    await userEvent.clear(field)
    await userEvent.type(field, '   {Enter}')

    expect(props.onRename).not.toHaveBeenCalled()
    expect(field).toHaveValue('Kitchen')
  })
})

describe('the File menu', () => {
  const open = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'File' }))
    return screen.findByRole('menu', { name: 'File' })
  }

  it('offers the whole document, and says which chord saves it', async () => {
    menu()

    await open()

    expect(await screen.findByRole('menuitem', { name: /Save as…/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Open…/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Import project' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Export project' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Revert' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Save as…/ }).textContent).toContain('⇧⌃S')
  })

  it('calls what the chosen entry is for', async () => {
    const props = menu()

    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Export project' }))

    expect(props.onExport).toHaveBeenCalledOnce()

    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: /Open…/ }))

    expect(props.onOpen).toHaveBeenCalledOnce()

    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Revert' }))

    expect(props.onRevert).toHaveBeenCalledOnce()
  })

  it('offers a copy, and the way out, once a file on disk is linked', async () => {
    menu({ file: projectFile({ linked: true, fileName: 'kitchen.paramrig.json' }) })

    await open()

    expect(await screen.findByRole('menuitem', { name: /Save a copy…/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Stop saving to that file' })).toBeInTheDocument()
  })

  it('hands the importer the file that was picked', () => {
    const props = menu()
    const picker = screen.getByLabelText('Project file to import')

    fireEvent.change(picker, { target: { files: [new File(['{}'], 'scene.paramrig.json', { type: 'application/json' })] } })

    expect(props.onImport).toHaveBeenCalledOnce()
  })
})

describe('the versions dialog', () => {
  const openVersions = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'File' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Versions…/ }))
    return screen.findByRole('dialog', { name: 'Versions' })
  }

  it('saves a version under the name that was typed', async () => {
    const props = menu()

    await openVersions()
    await userEvent.type(screen.getByRole('textbox', { name: 'Version name' }), 'Blocking')
    await userEvent.click(screen.getByRole('button', { name: 'Save version' }))

    expect(props.onSaveVersion).toHaveBeenCalledWith('Blocking')
  })

  it('lets a version go unnamed, since the editor names it', async () => {
    const props = menu({ versions: [VERSION] })

    await openVersions()
    await userEvent.click(screen.getByRole('button', { name: 'Save version' }))

    expect(props.onSaveVersion).toHaveBeenCalledWith('')
  })

  it('restores a version and gets out of the way', async () => {
    const props = menu({ versions: [VERSION] })

    await openVersions()
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(props.onRestoreVersion).toHaveBeenCalledWith('version-1')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Versions' })).not.toBeInTheDocument())
  })

  it('deletes a version and stays open, so another can be dealt with', async () => {
    const props = menu({ versions: [VERSION] })

    await openVersions()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Blocking' }))

    expect(props.onDeleteVersion).toHaveBeenCalledWith('version-1')
    expect(screen.getByRole('dialog', { name: 'Versions' })).toBeInTheDocument()
  })

  it('says so when nothing has been kept yet', async () => {
    menu()

    await openVersions()

    expect(screen.getByText('No versions yet.')).toBeInTheDocument()
  })

  /*
   * Blender's viewport header has no Edit menu: undo, redo and the preferences live in the topbar's,
   * beside File. This is that menu, and until it moved here nothing tested it.
   */
  it('carries the Edit menu, beside File, where Blender keeps it', async () => {
    const { onCommand } = menu()

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Preferences/ }))
    expect(onCommand).toHaveBeenCalledWith('preferences')
  })

  it('offers undo, redo and the rest of what the topbar owns', async () => {
    menu()

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent ?? '')
    for (const label of ['Undo', 'Redo', 'Repeat last', 'Adjust last operation', 'Quick favourites']) {
      expect(items.some((text) => text.startsWith(label))).toBe(true)
    }
  })
})
