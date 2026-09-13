import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { root, sourceAliases } from './sdk-entries.mjs'
// Paper's optional Node integration must not pick up the repository's jsdom test environment.
const directory = await mkdtemp(resolve(tmpdir(), 'paramrig-thumbnails-'))
await writeFile(resolve(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', 'paper@0.12.18', 'react@19.2.0', 'react-dom@19.2.0', 'opentype.js@2.0.0', 'fontkit@2.0.4', 'three@0.185.1', 'three-mesh-bvh@0.9.14', 'three-bvh-csg@0.0.18'], { cwd: directory, stdio: 'pipe' })
await build({ configFile: false, publicDir: false, logLevel: 'warn',
  resolve: { alias: [...sourceAliases, { find: '@', replacement: resolve(root, 'src') }] },
  build: { outDir: resolve(directory, 'dist'), minify: false, target: 'es2022',
    lib: { entry: resolve(root, 'src/modules/thumbnail-source.tsx'), formats: ['es'], fileName: 'thumbnails' },
    rollupOptions: { external: id => ['react', 'react-dom', 'paper', 'opentype.js', 'fontkit', 'three', 'three-mesh-bvh', 'three-bvh-csg'].some(name => id === name || id.startsWith(`${name}/`)) },
  },
})
const { thumbnails } = await import(pathToFileURL(resolve(directory, 'dist/thumbnails.js')).href)
const images = thumbnails()
const path = resolve(root, 'src/modules/catalog.generated.json')
const catalog = JSON.parse(await readFile(path, 'utf8'))
for (const item of catalog) {
  if (!images[item.id]?.startsWith('<svg')) throw Error(`Missing SVG thumbnail for ${item.id}`)
  const output = resolve(root, 'public/thumbnails', item.module)
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, `${item.id}.svg`), images[item.id])
  item.thumbnail = `/thumbnails/${item.module}/${item.id}.svg`
}
await writeFile(path, JSON.stringify(catalog, null, 2) + '\n')
console.log(`Generated ${catalog.length} static previews`)
