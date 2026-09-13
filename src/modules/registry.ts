import { catalog, loaders, requiredModules } from 'virtual:paramrig-modules'
import { findProjectMetadata } from '@/library/projectIndex'
import type { DomainModule, ModuleId } from './types'
export { catalog }
export const availableModules = Object.keys(loaders) as ModuleId[]
export const hasModule = (id: ModuleId) => !!loaders[id]
const loaded = new Map<ModuleId, DomainModule>()
const pending = new Map<ModuleId, Promise<DomainModule>>()
export function getLoadedModule(id: ModuleId) { return loaded.get(id) }
export function requiredModule(id: string): ModuleId | undefined {
  return findProjectMetadata(id)?.module ?? requiredModules[id]
    ?? (id === 'long-name-study' ? 'vector' : id.startsWith('web-') ? 'web' : undefined)
}
export async function loadModule(id: ModuleId): Promise<DomainModule> {
  const module = loaded.get(id)
  if (module) return module
  const load = loaders[id]
  if (!load) throw new Error(`This distribution does not include the ${id} module.`)
  let request = pending.get(id)
  if (!request) {
    request = load().then(module => { loaded.set(id, module); return module }).finally(() => pending.delete(id))
    pending.set(id, request)
  }
  return request
}
