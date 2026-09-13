import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { measureBundle } from './bundle-metrics.mjs'
import { root } from './sdk-entries.mjs'
import { selectModules } from './app-modules.mjs'
export function appBundleReport() {
  return { name: 'paramrig-bundle-report', apply: 'build', generateBundle(_options, bundle) {
    const files = Object.values(bundle)
    const initial = new Set()
    const visit = name => {
      if (initial.has(name)) return
      initial.add(name)
      const file = bundle[name]
      if (file?.type !== 'chunk') return
      for (const dependency of file.imports) visit(dependency)
      for (const css of file.viteMetadata?.importedCss ?? []) initial.add(css)
    }
    for (const file of files) if (file.type === 'chunk' && file.isEntry && !file.isDynamicEntry) visit(file.fileName)
    const measurement = measureBundle(files.filter(file => initial.has(file.fileName)))
    const selected = selectModules()
    const report = { selected, initial: { ...measurement, modules: [...measurement.modules] }, total: { ...measureBundle(files), modules: [...measureBundle(files).modules] }, chunks: files.filter(file => file.type === 'chunk').map(file => ({ name: file.fileName, imports: file.imports, dynamicImports: file.dynamicImports, modules: Object.keys(file.modules) })) }
    mkdirSync(resolve(root, '.local/modularity'), { recursive: true })
    writeFileSync(resolve(root, '.local/modularity', `${selected.join('-')}-app-build.json`), JSON.stringify(report, null, 2))
    console.log(`Library initial JS/CSS: ${measurement.gzipBytes} gzip bytes; ${measurement.modules.size} modules`)
  } }
}
