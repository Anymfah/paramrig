import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { root } from './sdk-entries.mjs'

const order = ['core', 'audio', 'audio-labs', 'audio-browser', 'vector', 'scene', 'controls']
const temporary = await mkdtemp(resolve(tmpdir(), 'paramrig-release-'))
const planned = []
for (const name of order) {
  const directory = resolve(root, 'packages', name)
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  assert.equal(process.env.GITHUB_REF_NAME, `sdk-v${manifest.version}`, `Release tag does not match ${manifest.name}`)
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd: directory, encoding: 'utf8' }))
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`)
  if (!response.ok && response.status !== 404) throw Error(`Registry check failed for ${manifest.name}: HTTP ${response.status}`)
  const published = response.ok ? await response.json() : null
  if (published) assert.equal(published.dist.integrity, packed.integrity, `${manifest.name}@${manifest.version} already exists with different bytes. Release a new version.`)
  planned.push({ manifest, packed, exists: Boolean(published) })
}
// Check every package first; a later conflict must not cause an avoidable partial release.
for (const { manifest, packed, exists } of planned) {
  if (exists) { console.log(`${manifest.name}@${manifest.version}: identical artifact already published`); continue }
  execFileSync('npm', ['publish', resolve(temporary, packed.filename), '--access', 'public', '--provenance'], { cwd: root, stdio: 'inherit' })
}
