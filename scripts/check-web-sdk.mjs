/*
 * What the SDK package is allowed to contain, and whether a stranger can compile against it.
 *
 * Two failures this catches, both of which shipped silently before it existed: the workbench's own
 * `public/` copied into the package — a favicon, an `.htaccess` and 150 kB of Public Sans — and a
 * stale hashed chunk left behind by a build that did not empty its directory. Neither breaks a
 * build, so neither is noticed until someone reads the published tarball.
 *
 * The consumer is not a mock. It is a small project with its own tsconfig that imports
 * `@paramrig/web` through a link in its own `node_modules`, so TypeScript resolves the package the
 * way anyone else's does: through `exports`, its `types` condition, and the declarations as emitted.
 * A declaration that imports a `.ts` path, or an `exports` map that names a file that is not there,
 * fails here rather than in someone else's repository.
 */
import { spawnSync, execFileSync } from 'node:child_process'
import { readdirSync, statSync, existsSync, mkdirSync, rmSync, symlinkSync, readFileSync, mkdtempSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'packages/web-sdk')
const dist = join(pkgDir, 'dist')
const problems = []

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name)
  return statSync(full).isDirectory() ? walk(full) : [relative(dist, full)]
})

if (!existsSync(dist)) {
  problems.push('packages/web-sdk/dist does not exist. Run the Vite build before this check.')
} else {
  /*
   * The whole of what belongs here: the entry Vite emits, the chunks it splits out beside it, and
   * the declarations `tsc` writes under the source tree's own shape. Anything else is either the
   * workbench leaking in or a build that did not clean up after itself, and both are worth a stop.
   */
  const files = walk(dist).sort()
  const allowed = (file) => file === 'paramrig-web.js' || /^[\w.-]+\.js$/.test(file) || /\.d\.ts$/.test(file)
  for (const file of files.filter((f) => !allowed(f))) problems.push(`Unexpected file in the package: dist/${file}`)
  for (const file of files.filter(file => file.endsWith('.d.ts'))) if (/['"](?:@\/|@paramrig\/core)/.test(readFileSync(join(dist, file), 'utf8'))) problems.push(`A private alias or external Core dependency leaked into ${file}`)
  if (!files.includes('paramrig-web.js')) problems.push('dist/paramrig-web.js is missing.')
  if (!files.some((f) => f.endsWith('.d.ts'))) problems.push('No declarations were emitted into dist.')

  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const targets = Object.values(manifest.exports['.'])
  for (const target of targets) if (!existsSync(join(pkgDir, target))) problems.push(`exports names ${target}, which is not in the package.`)
  for (const condition of ['types', 'import', 'default']) if (!manifest.exports['.'][condition]) problems.push(`exports is missing its ${condition} condition.`)

  console.log(`packages/web-sdk/dist holds ${files.length} files:`)
  for (const file of files) console.log(`  ${file}`)
}

// The link a real consumer would get from an install. Under node_modules, so git never sees it.
const consumer = join(root, 'scripts/web-sdk-consumer')
const linked = join(consumer, 'node_modules/@paramrig')
rmSync(linked, { recursive: true, force: true })
mkdirSync(linked, { recursive: true })
symlinkSync(relative(linked, pkgDir), join(linked, 'web'), 'dir')

const tsc = join(root, 'node_modules/typescript/bin/tsc')
const check = spawnSync(process.execPath, [tsc, '-p', join(consumer, 'tsconfig.json')], { encoding: 'utf8' })
if (check.status !== 0) problems.push(`A consumer cannot compile against this package:\n${check.stdout}${check.stderr}`.trimEnd())
else console.log('A reference consumer compiles against the emitted declarations.')

/*
 * What npm would actually put in the tarball, which is not always what `files` reads like: npm adds
 * the package manifest, the README and the licence on its own, and drops anything a `.npmignore` or
 * the repository's `.gitignore` happens to cover. Printing it is how the list stays reviewable.
 */
const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: pkgDir, encoding: 'utf8' })
if (packed.status !== 0) problems.push(`npm pack --dry-run failed:\n${packed.stderr}`.trimEnd())
else {
  const entries = JSON.parse(packed.stdout)[0].files.map((f) => f.path).sort()
  console.log(`\nnpm pack --dry-run would publish ${entries.length} files:`)
  for (const entry of entries) console.log(`  ${entry}`)
  const expected = (file) => file === 'package.json' || file === 'README.md' || file === 'LICENSE' || file.startsWith('dist/') || file.startsWith('schemas/')
  for (const entry of entries.filter((f) => !expected(f))) problems.push(`npm pack would publish ${entry}, which does not belong in the package.`)
  if (!entries.includes('README.md')) problems.push('npm pack would publish no README.md.')
}

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} with the SDK package:`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
const isolated = mkdtempSync(join(tmpdir(), 'paramrig-web-consumer-'))
const [artifact] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', isolated], { cwd: pkgDir, encoding: 'utf8' }))
writeFileSync(join(isolated, 'package.json'), JSON.stringify({ name: 'paramrig-web-isolated-consumer', private: true, type: 'module' }))
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(isolated, artifact.filename)], { cwd: isolated, stdio: 'pipe' })
for (const file of ['index.ts', 'tsconfig.json', 'manifest.json']) copyFileSync(join(consumer, file), join(isolated, file))
execFileSync(process.execPath, [tsc, '-p', isolated], { stdio: 'pipe', encoding: 'utf8' })
execFileSync(process.execPath, ['--input-type=module', '-e', "import { parseManifest, connectWeb } from '@paramrig/web'; if(typeof parseManifest !== 'function' || typeof connectWeb !== 'function') throw Error('Public exports unavailable')"], { cwd: isolated, stdio: 'pipe' })
const installed = Object.keys(JSON.parse(readFileSync(join(isolated, 'package-lock.json'), 'utf8')).packages).filter(Boolean)
if (JSON.stringify(installed) !== JSON.stringify(['node_modules/@paramrig/web'])) throw Error('Web installed an unrelated dependency')
const artifacts = join(root, '.local/modularity/tarballs')
mkdirSync(artifacts, { recursive: true }); copyFileSync(join(isolated, artifact.filename), join(artifacts, artifact.filename))
console.log('A clean Web tarball consumer passes strict NodeNext TypeScript and Node imports without Core or repository dependencies.')
console.log('The SDK package holds exactly what it should.')
