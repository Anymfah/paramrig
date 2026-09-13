import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { calibrateBundleMetrics, measureBundle } from './bundle-metrics.mjs'
import { build } from 'vite'
import { entries, root } from './sdk-entries.mjs'
import { fixtures } from './consumer-fixtures.mjs'

await calibrateBundleMetrics()
const temp = await mkdtemp(resolve(tmpdir(), 'paramrig-consumers-'))
const run = (command, args, cwd = temp) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const tarballs = new Map()
const artifactDirectory = resolve(root, '.local/modularity/tarballs')
await mkdir(artifactDirectory, { recursive: true })
const registry = process.argv.includes('--registry')
const selected = process.argv.slice(2).filter(arg => arg !== '--registry')
for (const name of Object.keys(entries)) {
  if (selected.length && !selected.includes(name)) continue
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], resolve(root, 'packages', name)))
  assert(packed.files.every(file => /^(dist\/|README\.md$|LICENSE$|package\.json$)/.test(file.path)), `Unexpected published file in ${name}`)
  assert(!packed.files.some(file => /\.(tsx?|map)$/.test(file.path) && !file.path.endsWith('.d.ts')), `Sources leaked into ${name}`)
  for (const file of packed.files.filter(file => file.path.endsWith('.d.ts'))) {
    const text = await readFile(resolve(root, 'packages', name, file.path), 'utf8')
    assert(!/["']@\//.test(text), `Repository alias leaked into ${name}/${file.path}`)
  }
  if (registry) {
    const integrity = JSON.parse(run('npm', ['view', `${packed.name}@${packed.version}`, 'dist.integrity', '--json']))
    assert.equal(integrity, packed.integrity, `${name}: npm does not contain the validated artifact`)
  }
  tarballs.set(name, registry ? `${packed.name}@${packed.version}` : resolve(temp, packed.filename))
  await cp(resolve(temp, packed.filename), resolve(artifactDirectory, packed.filename))
}

const report = []
for (const [name, fixture] of Object.entries(fixtures)) {
  if (!fixture.packages.every(name => tarballs.has(name))) continue
  const cwd = resolve(temp, name)
  await mkdir(cwd)
  await writeFile(resolve(cwd, 'package.json'), JSON.stringify({ name: `consumer-${name}`, private: true, type: 'module' }))
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...fixture.packages.map(name => tarballs.get(name)), ...(fixture.extra ?? [])], cwd)
  const lock = JSON.parse(await readFile(resolve(cwd, 'package-lock.json'), 'utf8'))
  const installed = Object.keys(lock.packages).filter(Boolean)
  assert.deepEqual(installed.filter(id => id.startsWith('node_modules/@paramrig/')).sort(), fixture.packages.map(name => `node_modules/@paramrig/${name}`).sort(), `${name} installed unrelated ParamRig engines`)
  const hasControls = fixture.packages.includes('controls')
  const hasVector = fixture.packages.includes('vector')
  const hasScene = fixture.packages.includes('scene')
  if (!hasVector && !hasScene && !hasControls) assert.deepEqual(installed.sort(), fixture.packages.map(name => `node_modules/@paramrig/${name}`).sort(), `${name} installed unrelated dependencies`)
  const forbidden = [!hasControls && 'react', !hasVector && 'paper', !hasScene && 'three'].filter(Boolean)
  const foreign = new RegExp(`node_modules/(${forbidden.join('|')})(/|$)`)
  assert(!installed.some(id => foreign.test(id)), `${name} installed a forbidden engine or React`)
  if (name === 'scene') assert.equal(installed.filter(id => /(?:^|\/)node_modules\/three$/.test(id)).length, 1, 'More than one Three.js copy installed')
  if (fixture.node) {
    await writeFile(resolve(cwd, 'node.mjs'), fixture.node)
    run(process.execPath, ['node.mjs'], cwd)
  }
  // The consumer has no repository aliases, sources or devDependencies. The compiler is a tool.
  await writeFile(resolve(cwd, 'consumer.ts'), fixture.browser ?? fixture.node)
  await writeFile(resolve(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, strict: true, target: 'ES2023', lib: ['ES2023', 'DOM'], module: 'NodeNext', moduleResolution: 'NodeNext', types: [], skipLibCheck: false }, include: ['consumer.ts'] }))
  run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', cwd], cwd)
  const modules = new Set()
  const built = await build({ root: cwd, configFile: false, publicDir: false, logLevel: 'warn', define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [{ name: 'consumer-graph', generateBundle(_opts, bundle) { for (const out of Object.values(bundle)) if (out.type === 'chunk') Object.keys(out.modules).forEach(id => modules.add(id)) } }],
    build: { minify: true, lib: { entry: resolve(cwd, 'consumer.ts'), formats: ['es'], fileName: 'consumer' } },
  })
  const outputs = (Array.isArray(built) ? built : [built]).flatMap(result => result.output)
  if (name === 'audio-browser') {
    const code = outputs.filter(out => out.type === 'chunk').map(out => out.code).join('\n')
    assert(!code.includes('"/assets/worklet-'), 'The player contains an application-relative processor URL')
    assert(outputs.some(out => /worklet.*\.js$/.test(out.fileName)) || code.includes('data:'), 'The consuming bundle did not carry its processor')
  }
  const measurement = measureBundle(outputs)
  const bytes = measurement.gzipBytes
  assert.deepEqual([...modules].sort(), [...measurement.modules].sort(), 'Module collector disagrees with calibrated measurement')
  assert([...modules].every(id => !foreign.test(id)), `${name} bundled an unrelated engine`)
  if (fixture.budget) assert(bytes <= fixture.budget, `${name}: ${bytes} gzip bytes exceeds ${fixture.budget}`)
  const baselines = JSON.parse(await readFile(resolve(root, 'tests/consumers/budgets.json'), 'utf8'))
  if (baselines[name]) assert(bytes <= Math.ceil(baselines[name].gzipBytes * 1.05), `${name}: ${bytes} gzip bytes exceeds its validated baseline by more than 5%; investigate and document any deliberate baseline change`)
  report.push({ name, gzipBytes: bytes, files: measurement.files, installed, modules: [...modules].map(id => id.replace(temp, '<consumer>')) })
  if (fixture.browser) {
    const demo = resolve(root, '.local/modularity/consumers', name)
    await cp(resolve(cwd, 'dist'), demo, { recursive: true })
    const entry = outputs.find(out => out.type === 'chunk' && out.isEntry).fileName
    const template = await readFile(resolve(root, 'tests/consumers', `${name}.html`), 'utf8')
    await writeFile(resolve(demo, 'index.html'), template.replaceAll('__SDK_ENTRY__', `./${entry}`).replaceAll('__SDK_STYLES__', `./${outputs.find(out => out.type === 'asset' && out.fileName.endsWith('.css'))?.fileName ?? ''}`))
  }
  if (name === 'vector') {
    // A host's test environment must not make a data-only import initialise Paper's canvas.
    run('npm', ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', 'jsdom@30.0.1'], cwd)
    run(process.execPath, ['node.mjs'], cwd)
  }
  // Build the published example as an application, not only as an SDK library bundle.
  const example = resolve(root, 'examples/sdk', name)
  if (fixture.browser) {
    await cp(resolve(example, 'index.html'), resolve(cwd, 'index.html'))
    await cp(resolve(example, 'sdk.js'), resolve(cwd, 'sdk.js'))
    if (name === 'vector') await cp(resolve(example, 'public'), resolve(cwd, 'public'), { recursive: true })
    await build({ root: cwd, configFile: false, base: './', logLevel: 'warn', build: { outDir: 'example-dist' } })
    await cp(resolve(cwd, 'example-dist'), resolve(root, '.local/modularity/examples', name), { recursive: true })
  } else {
    await cp(resolve(example, 'index.mjs'), resolve(cwd, 'example.mjs'))
    run(process.execPath, ['example.mjs'], cwd)
  }
  console.log(`${name}: clean tarball install, ${fixture.node ? 'Node, ' : ''}TypeScript and browser bundle passed (${bytes} gzip bytes)`)
}
await mkdir(resolve(root, '.local/modularity'), { recursive: true })
await writeFile(resolve(root, `.local/modularity/consumers${registry ? '-registry' : ''}.json`), JSON.stringify({ temp, source: registry ? 'npm' : 'tarballs', report }, null, 2))
