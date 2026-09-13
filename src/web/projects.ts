import { indexSuccessfulWrite } from '@/library/projectIndex'
import type { RigManifest } from '../rigs/types'
import { parseManifest, safeId, type WebProjectManifest } from './contracts'

const KEY = 'paramrig.web-projects.v1'
export const webRigId = (id: string) => `web-${id}`
export const webProjectId = (rigId: string) => rigId.startsWith('web-') ? rigId.slice(4) : ''
export function listWebProjects(): WebProjectManifest[] {
  try { const items: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(items) ? items.flatMap(item => { try { return [parseManifest(item)] } catch { return [] } }) : [] } catch { return [] }
}
export function rememberWebProject(manifest: WebProjectManifest) {
  const projects = [manifest, ...listWebProjects().filter(p => p.id !== manifest.id)].slice(0, 24)
  try { const raw = JSON.stringify(projects); localStorage.setItem(KEY, raw); indexSuccessfulWrite(KEY, raw) } catch { /* The connected document remains usable. */ }
}
/**
 * A web rig this browser has not opened before. The registry cannot describe it — nothing on disk
 * belongs to the workbench — but the local service can, so the workspace opens on this placeholder
 * and asks. Without it a shared link lands on the library's "not in the example registry" page
 * even though the service is connected to exactly that project.
 */
export function pendingWebManifest(rigId: string): RigManifest | undefined {
  if (!safeId(webProjectId(rigId))) return undefined
  return { id: rigId, name: 'Web project', summary: 'Web · asking the local service', description: 'Connected web interface with live controls and visual feedback.', renderer: 'web', rendererLabel: 'Web', collection: 'project', title: 'Projects/Web', sourceFile: '.paramrig/manifest.json', tags: ['web', 'feedback'], groups: [], parameters: [] }
}
export function webManifest(project: WebProjectManifest): RigManifest {
  return { id: webRigId(project.id), name: project.name, summary: `Web · ${new URL(project.origin).host}`, description: 'Connected web interface with live controls and visual feedback.', renderer: 'web', rendererLabel: 'Web', collection: 'project', title: 'Projects/Web', sourceFile: '.paramrig/manifest.json', tags: ['web', 'feedback'], groups: [], parameters: [] }
}
