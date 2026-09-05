import type { RigManifest } from '../rigs/types'
import { parseManifest, type WebProjectManifest } from './contracts'

const KEY = 'paramrig.web-projects.v1'
export const webRigId = (id: string) => `web-${id}`
export function listWebProjects(): WebProjectManifest[] {
  try { const items: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(items) ? items.flatMap(item => { try { return [parseManifest(item)] } catch { return [] } }) : [] } catch { return [] }
}
export function rememberWebProject(manifest: WebProjectManifest) {
  const projects = [manifest, ...listWebProjects().filter(p => p.id !== manifest.id)].slice(0, 24)
  try { localStorage.setItem(KEY, JSON.stringify(projects)) } catch { /* The connected document remains usable. */ }
}
export function webManifest(project: WebProjectManifest): RigManifest {
  return { id: webRigId(project.id), name: project.name, summary: `Web · ${new URL(project.origin).host}`, description: 'Connected web interface with live controls and visual feedback.', renderer: 'web', rendererLabel: 'Web', collection: 'project', title: 'Projects/Web', sourceFile: '.paramrig/manifest.json', tags: ['web', 'feedback'], groups: [], parameters: [] }
}
