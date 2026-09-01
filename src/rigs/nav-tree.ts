import type { RigManifest } from '@/rigs/types'

export type NavFolderNode = {
  kind: 'folder'
  path: string
  label: string
  children: NavNode[]
}

export type NavRigNode = {
  kind: 'rig'
  path: string
  rig: RigManifest
}

export type NavNode = NavFolderNode | NavRigNode

type MutableFolder = {
  label: string
  path: string
  folders: Map<string, MutableFolder>
  rigs: RigManifest[]
}

export function folderSegments(rig: RigManifest): string[] {
  const raw = rig.title.trim() || (rig.collection === 'project' ? 'Project' : 'Examples')
  return raw.split('/').map((part) => part.trim()).filter(Boolean)
}

export function ancestorPaths(rig: RigManifest): string[] {
  const parts = folderSegments(rig)
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
}

export function unwrapNavRoot(tree: NavNode[]): NavNode[] {
  if (tree.length === 1 && tree[0]?.kind === 'folder') return tree[0].children
  return tree
}

export function descendantRigs(node: NavNode): RigManifest[] {
  if (node.kind === 'rig') return [node.rig]
  return node.children.flatMap(descendantRigs)
}

export type CompactNavItem =
  | { kind: 'rig'; rig: RigManifest }
  | { kind: 'folder'; folder: NavFolderNode; rigs: RigManifest[] }

export function compactNavItems(tree: NavNode[]): CompactNavItem[] {
  return unwrapNavRoot(tree).flatMap((node): CompactNavItem[] => {
    if (node.kind === 'rig') return [{ kind: 'rig', rig: node.rig }]
    const rigs = descendantRigs(node)
    if (rigs.length <= 1) return rigs.map((rig) => ({ kind: 'rig' as const, rig }))
    return [{ kind: 'folder', folder: node, rigs }]
  })
}

export function buildNavTree(rigs: RigManifest[]): NavNode[] {
  const root: MutableFolder = { label: '', path: '', folders: new Map(), rigs: [] }

  for (const rig of rigs) {
    let node = root
    for (const part of folderSegments(rig)) {
      const path = node.path ? `${node.path}/${part}` : part
      let next = node.folders.get(part)
      if (!next) {
        next = { label: part, path, folders: new Map(), rigs: [] }
        node.folders.set(part, next)
      }
      node = next
    }
    node.rigs.push(rig)
  }

  return freezeFolder(root)
}

function freezeFolder(folder: MutableFolder): NavNode[] {
  const folders = [...folder.folders.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(
      (child): NavFolderNode => ({
        kind: 'folder',
        path: child.path,
        label: child.label,
        children: freezeFolder(child),
      }),
    )
  const leaves = folder.rigs
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (rig): NavRigNode => ({
        kind: 'rig',
        path: folder.path ? `${folder.path}/${rig.id}` : rig.id,
        rig,
      }),
    )
  return [...folders, ...leaves]
}
