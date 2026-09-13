import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { root, sourceAliases } from './sdk-entries.mjs'

// This entry runs during development/build tooling only. Browsers read its static metadata.
const directory = resolve(root, '.local/modularity/catalog')
await mkdir(directory, { recursive: true })
const entry = resolve(directory, 'source.ts')
await writeFile(entry, `import { listRigs } from '@/modules/catalog-source'; export const catalog = listRigs();`)
await build({ configFile: false, publicDir: false, logLevel: 'warn',
  resolve: { alias: [...sourceAliases, { find: '@', replacement: resolve(root, 'src') }], dedupe: ['three'] },
  build: { rollupOptions: { external: id => ['paper', 'opentype.js', 'fontkit', 'three', 'three-mesh-bvh', 'three-bvh-csg'].some(name => id === name || id.startsWith(`${name}/`)) }, target: 'es2022', outDir: resolve(directory, 'dist'), minify: false, lib: { entry, formats: ['es'], fileName: 'catalog' } },
})
const { catalog } = await import(pathToFileURL(resolve(directory, 'dist/catalog.js')).href)
const ids = new Set()
for (const item of catalog) {
  if (ids.has(item.id)) throw new Error(`Duplicate catalogue id ${item.id}`)
  ids.add(item.id)
}
await writeFile(resolve(root, 'src/modules/catalog.generated.json'), JSON.stringify(catalog, null, 2) + '\n')
console.log(`Recorded ${catalog.length} bundled metadata entries without parameters or document data`)
