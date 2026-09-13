import { buildControlStyles } from './build-control-styles.mjs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { calibrateBundleMetrics, measureBundle } from './bundle-metrics.mjs'
import ts from 'typescript'
import { build } from 'vite'
import { entries, root, sourceAliases, specifier } from './sdk-entries.mjs'

await calibrateBundleMetrics()
const requested = process.argv.slice(2)
const selected = requested.length ? requested : Object.keys(entries)
for (const name of selected) if (!entries[name]) throw new Error(`Unknown SDK: ${name}`)
const posix = path => path.replaceAll('\\', '/')
const config = ts.readConfigFile(resolve(root, 'tsconfig.app.json'), ts.sys.readFile).config
const compiler = ts.parseJsonConfigFileContent(config, ts.sys, root).options

async function declarations(name, points, outDir) {
  const options = { ...compiler, noEmit: false, declaration: true, emitDeclarationOnly: true,
    incremental: false, composite: false, noEmitOnError: true, rootDir: root,
    outDir: resolve(outDir, 'types'), tsBuildInfoFile: undefined }
  const ambient = ts.parseJsonConfigFileContent(config, ts.sys, root).fileNames.filter(file => file.endsWith('.d.ts') && !file.includes('/src/modules/'))
  const program = ts.createProgram({ rootNames: [...Object.values(points).map(path => resolve(root, path)), ...ambient], options })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }))
  const writes = []
  const result = program.emit(undefined, (file, content, _bom, _error, sources) => {
    const source = sources?.[0]?.fileName
    if (!source) return
    // Dependency declarations belong to their own package, never to this tarball.
    if (source.includes('/packages/') && !source.includes(`/packages/${name}/`)) return
    const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true)
    const edits = []
    const visit = node => {
      if (ts.isStringLiteral(node) && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)
        || (ts.isLiteralTypeNode(node.parent) && ts.isImportTypeNode(node.parent.parent)))) {
        const id = node.text
        if (id.startsWith('@/') || id.startsWith('.')) {
          const resolved = ts.resolveModuleName(id, source, options, ts.sys).resolvedModule?.resolvedFileName
          if (resolved && !resolved.includes('/node_modules/')) {
            const target = resolve(outDir, 'types', relative(root, resolved)).replace(/\.(tsx?|mts)$/, '.js')
            const path = posix(relative(dirname(file), target))
            edits.push([node.getStart(ast), node.getEnd(), JSON.stringify(path.startsWith('.') ? path : `./${path}`)])
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) content = content.slice(0, start) + value + content.slice(end)
    writes.push(mkdir(dirname(file), { recursive: true }).then(() => writeFile(file, content)))
  })
  if (result.emitSkipped) throw new Error(`Declaration emission failed for ${name}`)
  await Promise.all(writes)
}

for (const name of selected) {
  const points = entries[name]
  const destination = resolve(root, 'packages', name, 'dist')
  const outDir = resolve(root, '.local/modularity/sdk-builds', name)
  const manifest = JSON.parse(await readFile(resolve(root, 'packages', name, 'package.json'), 'utf8'))
  const allowed = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])
  const external = id => allowed.has(id) || [...allowed].some(dep => id.startsWith(`${dep}/`))
  await rm(outDir, { recursive: true, force: true })
  const modules = new Set()
  const result = await build({ configFile: false, publicDir: false, base: './', logLevel: 'warn',
    resolve: { alias: [...sourceAliases.filter(alias => !external(alias.find)), { find: '@', replacement: resolve(root, 'src') }], dedupe: ['three', 'react', 'react-dom'] },
    plugins: [{ name: 'sdk-boundaries', generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) if (output.type === 'chunk') {
        for (const id of Object.keys(output.modules)) modules.add(posix(relative(root, id)))
      }
    } }],
    build: { outDir, emptyOutDir: false, minify: true, target: 'es2022',
      lib: { entry: Object.fromEntries(Object.entries(points).map(([entry, source]) => [entry === '.' ? 'index' : entry.slice(2), resolve(root, source)])), formats: ['es'] },
      rollupOptions: { external, output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' } },
    },
  })
  const forbidden = name === 'core' ? /^(src\/(audio|vector|scene|web|ui|resources)\/|node_modules\/)/
    : name.startsWith('audio') ? /^(src\/(vector|scene|web|ui|resources)\/|node_modules\/(react|three|paper)(\/|$))/
    : name === 'vector' ? /^(src\/(audio|scene|web|ui|editor|resources|rigs\/examples)\/|node_modules\/(react|three)(\/|$))/ : name === 'scene' ? /^(src\/(audio|vector|web|ui|editor|resources|rigs\/examples)\/|node_modules\/(react|paper)(\/|$))/ : name === 'controls' ? /^(src\/(audio|vector|scene|web|state\/resources|renderers)|node_modules\/(three|paper)(\/|$))/ : null
  for (const id of modules) if (/^src\/(modules|library|state\/(resources|persistence|workspace))/.test(id) || forbidden?.test(id)) throw new Error(`${specifier(name, '.')} includes forbidden module ${id}`)
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(result => result.output ?? [])
  const sizes = measureBundle(outputs).files
  await declarations(name, points, outDir)
  if (name === 'controls') await buildControlStyles(outDir)
  const previous = `${destination}.previous`
  await rm(previous, { recursive: true, force: true })
  let retained = false
  try { await rename(destination, previous); retained = true } catch (error) { if (error.code !== 'ENOENT') throw error }
  try { await rename(outDir, destination) } catch (error) { if (retained) await rename(previous, destination); throw error }
  await rm(previous, { recursive: true, force: true })
  await mkdir(resolve(root, '.local/modularity'), { recursive: true })
  await writeFile(resolve(root, '.local/modularity', `${name}-build.json`), JSON.stringify({ modules: [...modules].sort(), sizes }, null, 2))
  console.log(`${manifest.name}: built ${sizes.length} JavaScript artifacts and checked declarations`)
}
