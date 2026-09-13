import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { root } from './sdk-entries.mjs'
export const allModules = ['audio', 'vector', 'scene', 'web']
export function selectModules(value = process.env.PARAMRIG_MODULES) {
  if (!value) return allModules
  const selected = [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
  if (!selected.length || selected.some(item => !allModules.includes(item))) throw Error('Select one or more modules: audio, vector, scene, web')
  return allModules.filter(item => selected.includes(item))
}
/** Literal imports are generated before bundling. Omitted domains never enter the app graph. */
export function appModulesPlugin() {
  const selected = selectModules()
  return { name: 'paramrig-modules',
    resolveId(id) { if (id === 'virtual:paramrig-modules') return '\0paramrig-modules' },
    load(id) {
      if (id !== '\0paramrig-modules') return
      const path = resolve(root, 'src/modules/catalog.generated.json')
      this.addWatchFile(path)
      const all = JSON.parse(readFileSync(path, 'utf8'))
      const catalog = all.filter(item => selected.includes(item.module))
      const requiredModules = Object.fromEntries(all.map(item => [item.id, item.module]))
      return `export const requiredModules = ${JSON.stringify(requiredModules)}; export const catalog = ${JSON.stringify(catalog)}; export const loaders = {${selected.map(module => `${module}: () => import('/src/modules/${module}.tsx').then(module => module.default)`).join(',')}};`
    },
  }
}
