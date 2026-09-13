import type { ComponentType } from 'react'
import type { RigManifest, ParamValue } from '@paramrig/core/types'
import type { ControlRegistry } from '@/controls/registry'
import type { RigSession } from '@/state/session'

export type ModuleId = 'audio' | 'vector' | 'scene' | 'web'
export type ProjectMetadata = Pick<RigManifest, 'id' | 'name' | 'summary' | 'description' | 'renderer' | 'rendererLabel' | 'collection' | 'title' | 'sourceFile' | 'tags'> & {
  module: ModuleId
  updatedAt?: string
  thumbnail?: string
}
export type OpenResult = { ok: true; id: string; name: string; note?: string } | { ok: false; error: string }
export type EditorMode = 'edit' | 'tune'
export type ModulePreviewProps = { rigId: string; renderer: RigManifest['renderer']; values: Record<string, ParamValue>; name: string; session?: RigSession }
export type ModuleEditorProps = { manifest: RigManifest; mode: EditorMode; onMode: (mode: EditorMode) => void }
export type DomainModule = {
  id: ModuleId
  getRig: (id: string) => RigManifest | undefined
  create?: () => { id: string }
  openFile?: (text: string) => Promise<OpenResult>
  Editor: ComponentType<ModuleEditorProps>
  Preview: ComponentType<ModulePreviewProps>
  Landing?: ComponentType
  Documentation?: ComponentType
  ExportExtras?: ComponentType<{ session: RigSession }>
  controls?: ControlRegistry
  readMode?: (id: string) => EditorMode
  writeMode?: (id: string, mode: EditorMode) => void
  thumbnail?: (id: string) => { stamp: string; url: string } | null
  dispose?: () => void
}
export const moduleForRenderer = (renderer: RigManifest['renderer']): ModuleId => renderer === 'audio' ? 'audio' : renderer === 'scene' || renderer === 'three' ? 'scene' : renderer === 'web' || renderer === 'html' ? 'web' : 'vector'
export const MODULE_LABELS: Record<ModuleId, string> = { audio: 'Sound', vector: 'Vector', scene: '3D', web: 'Web' }
