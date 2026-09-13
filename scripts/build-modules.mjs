import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { root } from './sdk-entries.mjs'
import { calibrateBundleMetrics } from './bundle-metrics.mjs'
import { allModules, selectModules } from './app-modules.mjs'
await calibrateBundleMetrics()
const matrix = process.argv.includes('--matrix')
const args = process.argv.slice(2)
if (args.some(arg => arg.startsWith('--') && arg !== '--matrix' && !arg.startsWith('--modules='))) throw Error('Usage: build:modules -- --modules=audio,vector or --matrix')
const selections = args.filter(arg => arg !== '--matrix').map(arg => arg.replace(/^--modules=/, ''))
if (selections.length > 1 || (matrix && selections.length)) throw Error('Choose one module list or --matrix')
const requested = selections[0]
if (requested === '') throw Error('The module list cannot be empty')
const groups = matrix ? [allModules, ...allModules.map(module => [module])] : [selectModules(requested)]
for (const group of groups) {
  const name = group.length === 4 ? 'suite' : group.join('-')
  const output = resolve(root, '.local/modularity/distributions', name)
  execFileSync(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'app', '--outDir', output], { cwd: root, env: { ...process.env, PARAMRIG_MODULES: group.join(',') }, stdio: 'inherit' })
  const report = JSON.parse(readFileSync(resolve(root, '.local/modularity', `${group.join('-')}-app-build.json`), 'utf8'))
  const foreign = allModules.filter(module => !group.includes(module))
  // Sound Labs owns its 3D relief. It shares Three.js, never the Scene SDK or editor.
  const presentationDependencies = group.includes('audio') ? { three: 'Sound Labs spectral relief; loaded when Labs opens' } : {}
  for (const module of report.total.modules) {
    if (foreign.some(domain => module.includes(`/src/${domain}/`))) throw Error(`${name} includes an omitted domain: ${module}`)
    if (!group.includes('scene') && !group.includes('audio') && /node_modules\/(three|three-mesh-bvh|three-bvh-csg|@react-three)\//.test(module)) throw Error(`${name} includes 3D dependencies: ${module}`)
    if (!group.includes('vector') && /node_modules\/paper\//.test(module)) throw Error(`${name} includes Paper: ${module}`)
  }
  if (report.initial.modules.some(module => /\/src\/(audio|vector|scene)\//.test(module) || /node_modules\/(three|paper)\//.test(module))) throw Error(`${name} starts an engine in the library`)
  if (report.initial.gzipBytes > 250000) throw Error(`${name} library exceeds 250000 gzip bytes`)
  writeFileSync(resolve(output, 'distribution.json'), JSON.stringify({ modules: group, presentationDependencies, initialGzipBytes: report.initial.gzipBytes, schemaVersion: 1 }, null, 2))
  const files = readdirSync(output, { recursive: true, withFileTypes: true }).filter(file => file.isFile()).map(file => resolve(file.parentPath, file.name).slice(output.length + 1))
  for (const file of files) {
    if (file.startsWith('thumbnails/') && !group.includes(file.split('/')[1])) throw Error(`Foreign thumbnail in ${name}: ${file}`)
    if (!group.includes('vector') && !group.includes('scene') && file.startsWith('fonts/') && !['fonts/PublicSans.woff2', 'fonts/PublicSans-OFL.txt'].includes(file)) throw Error(`Foreign artwork font in ${name}: ${file}`)
    if (!/^(assets\/|fonts\/|thumbnails\/|index\.html$|favicon\.svg$|\.htaccess$|distribution\.json$)/.test(file)) throw Error(`Unexpected archive file in ${name}: ${file}`)
    if (/\.(map|tsx?)$/.test(file) || readFileSync(resolve(output, file)).length === 0) throw Error(`Source or empty file in ${name}: ${file}`)
  }
  mkdirSync(resolve(root, '.local/modularity/archives'), { recursive: true })
  const archive = resolve(root, '.local/modularity/archives', `paramrig-${name}.tar.gz`)
  execFileSync('tar', ['-czf', archive, '-C', output, '.'])
  const archived = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(file => file && !file.endsWith('/')).map(file => file.replace(/^\.\//, '')).sort()
  if (JSON.stringify(archived) !== JSON.stringify(files.sort())) throw Error(`Archive content does not match verified distribution: ${name}`)
  console.log(`Verified and archived ${name}: ${report.initial.gzipBytes} initial gzip bytes`)
}
