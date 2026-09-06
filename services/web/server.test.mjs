import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createWebService } from './server.mjs'

const opened = []
afterEach(async () => { for (const item of opened.splice(0)) { await item.service.close(); await fs.rm(item.root, { recursive: true, force: true }) } })
const example = () => fs.readFile(new URL('../../examples/web/manifest.json', import.meta.url), 'utf8').then(JSON.parse)
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paramrig-web-'))
  const manifest = await example()
  const service = await createWebService({ projectDir: root, seedManifest: manifest })
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve))
  opened.push({ root, service })
  const url = `http://127.0.0.1:${service.server.address().port}`
  const state = await (await fetch(`${url}/api/web/state`)).json()
  const post = (endpoint, body, headers = {}) => fetch(`${url}/api/web/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174', 'X-ParamRig-Token': state.token, ...headers }, body: JSON.stringify(body) })
  return { root, service, url, state, post }
}
function draft(manifest) {
  const values = Object.fromEntries(manifest.parameters.map(p => [p.id, p.defaultValue]))
  return { version: 1, projectId: manifest.id, sourceRevision: manifest.revision, sourceValues: values, values, tickets: [], snapshots: [], conflicts: [], handledResponses: [] }
}
test('concurrent draft saves compare revisions and leave a readable atomic file', async () => {
  const { root, state, post } = await setup()
  const document = draft(state.manifest)
  const replies = await Promise.all([post('draft', { expectedRevision: 0, document }), post('draft', { expectedRevision: 0, document })])
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409])
  const disk = JSON.parse(await fs.readFile(path.join(root, '.paramrig/draft.json'), 'utf8'))
  assert.equal(disk.revision, 1); assert.equal(disk.document.projectId, 'fieldnotes')
})
test('validated batches are immutable and repeat publication is idempotent', async () => {
  const { state, post } = await setup()
  const batch = { version: 1, id: 'batch-1', projectId: 'fieldnotes', sourceRevision: state.manifest.revision, createdAt: new Date().toISOString(), values: {}, changes: [], tickets: [] }
  assert.equal((await post('batches', batch)).status, 201)
  assert.equal((await post('batches', batch)).status, 201)
  assert.equal((await post('batches', { ...batch, values: { changed: true } })).status, 409)
})
test('writes reject wrong origins, missing pairing token, traversal and symlink destinations', async () => {
  const { root, state, post } = await setup()
  const body = { expectedRevision: 0, document: draft(state.manifest) }
  assert.equal((await post('draft', body, { Origin: 'https://untrusted.example' })).status, 403)
  assert.equal((await post('draft', body, { 'X-ParamRig-Token': '' })).status, 403)
  assert.equal((await post('captures', { id: '../outside', dataUrl: 'data:image/png;base64,AAAA' })).status, 400)
  const outside = path.join(root, 'source.txt'); await fs.writeFile(outside, 'untouched')
  await fs.symlink(outside, path.join(root, '.paramrig/draft.json'))
  assert.equal((await post('draft', body)).status, 409)
  assert.equal(await fs.readFile(outside, 'utf8'), 'untouched')
})
test('malformed responses remain visible as issues and do not break the project', async () => {
  const { root, url } = await setup()
  await fs.writeFile(path.join(root, '.paramrig/responses/bad.json'), '{')
  const next = await (await fetch(`${url}/api/web/state`)).json()
  assert.equal(next.manifest.id, 'fieldnotes'); assert.match(next.issues[0], /responses\/bad.json/)
})

test('the example manifest is seeded into an empty folder and refused everywhere else', async () => {
  const seedManifest = await example()
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'paramrig-empty-'))
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'paramrig-project-'))
  await fs.writeFile(path.join(project, 'package.json'), '{"name":"someone-elses-app"}')
  const one = await createWebService({ projectDir: empty, seedManifest })
  const two = await createWebService({ projectDir: project, seedManifest })
  opened.push({ root: empty, service: one }, { root: project, service: two })

  assert.equal(one.refusedSeed, '')
  assert.equal((await one.state()).manifest.id, 'fieldnotes')
  // Forgetting PARAMRIG_SEED_MANIFEST= must not write Fieldnotes into a stranger's repository.
  assert.match(two.refusedSeed, /is not empty/)
  await assert.rejects(two.state(), e => e.code === 'ENOENT')
  assert.deepEqual((await fs.readdir(path.join(project, '.paramrig'))).sort(), ['.gitignore', 'README.md', 'batches', 'captures', 'responses'])
})

test('a project with no manifest is told which file to write, and the service keeps serving', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'paramrig-bare-'))
  await fs.writeFile(path.join(project, 'package.json'), '{"name":"someone-elses-app"}')
  const service = await createWebService({ projectDir: project, seedManifest: await example() })
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve))
  opened.push({ root: project, service })
  const res = await fetch(`http://127.0.0.1:${service.server.address().port}/api/web/state`)
  const body = await res.json()
  assert.equal(res.status, 404)
  assert.equal(body.error, 'No web manifest found. Add .paramrig/manifest.json to the connected project.')
  assert.equal(body.path, path.join(await fs.realpath(project), '.paramrig', 'manifest.json'))
})

test('the feedback gitignore covers only what ParamRig rewrites, and is never written over', async () => {
  const { root, service } = await setup()
  const file = path.join(root, '.paramrig/.gitignore')
  assert.equal(await fs.readFile(file, 'utf8'), 'draft.json\ncaptures/\n')
  // A project that edits it keeps its edit, however many times the service starts. Deleting it is
  // how README.md behaves too: the next start writes it again, because absent reads as new.
  await fs.writeFile(file, 'draft.json\n')
  for (let start = 0; start < 2; start += 1) {
    const again = await createWebService({ projectDir: root, seedManifest: await example() })
    await again.close()
  }
  assert.equal(await fs.readFile(file, 'utf8'), 'draft.json\n')
  await service.close()
})
