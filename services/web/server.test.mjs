import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createWebService } from './server.mjs'

const opened = []
afterEach(async () => { for (const item of opened.splice(0)) { await item.service.close(); await fs.rm(item.root, { recursive: true, force: true }) } })
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paramrig-web-'))
  const manifest = JSON.parse(await fs.readFile(new URL('../../examples/web/manifest.json', import.meta.url), 'utf8'))
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
