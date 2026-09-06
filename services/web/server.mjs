import http from 'node:http'
import { promises as fs, constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, randomBytes } from 'node:crypto'
import { parseManifest, isDraft, isBatch, isResponse, safeId } from '../../src/web/contracts.ts'

const MAX_BODY = 24 * 1024 * 1024
const GUIDE = `# ParamRig feedback\n\nRead manifest.json, then immutable batches/*.json. Each batch contains approved values, source revision, exact targets, comments, vector markup and captures. Drafts are not approved instructions. Apply changes in the source project; preserve stable data-paramrig-id and data-paramrig-instance attributes. Update the manifest revision and SDK revision together. Write a new responses/<id>.json atomically (temporary file, then rename).\n\nResponse format: { "version": 1, "id": "unique-id", "projectId": "manifest-id", "batchId": "batch-id", "sourceRevision": "batch-source-revision", "resultRevision": "new-manifest-revision", "createdAt": "ISO timestamp", "summary": "What changed", "tickets": [{ "id": "ticket-id", "status": "implemented", "message": "What changed and how to verify" }] }. Use needs-info to request clarification. Only the user validates a correction. Do not change batches, draft.json or capture files. Captures marked dom are reconstructions and may differ from screen rendering.\n`

export async function createWebService({ projectDir, seedManifest, allowedOrigins = ['http://localhost:5174', 'http://127.0.0.1:5174'] }) {
  if (!projectDir) throw new Error('Provide an explicit PARAMRIG_PROJECT_DIR.')
  await fs.mkdir(projectDir, { recursive: true })
  const project = await fs.realpath(projectDir)
  const root = path.join(project, '.paramrig')
  await fs.mkdir(root, { recursive: true })
  if ((await fs.lstat(root)).isSymbolicLink() || await fs.realpath(root) !== root) throw new Error('The feedback directory must not be a symbolic link.')
  for (const name of ['batches', 'responses', 'captures']) {
    await fs.mkdir(path.join(root, name), { recursive: true })
    if ((await fs.lstat(path.join(root, name))).isSymbolicLink()) throw new Error('Feedback subdirectories must not be symbolic links.')
  }
  const token = randomBytes(32).toString('hex')
  const clients = new Set()
  let queue = Promise.resolve()
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next }
  async function confined(relative) {
    const target = path.resolve(root, relative)
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid feedback path.')
    let current = root
    for (const part of path.relative(root, target).split(path.sep)) {
      current = path.join(current, part)
      const info = await fs.lstat(current).catch(e => { if (e.code === 'ENOENT') return null; throw e })
      if (info?.isSymbolicLink()) throw new Error('Symbolic links are not allowed in feedback paths.')
    }
    if (await fs.realpath(root) !== root) throw new Error('The feedback directory changed.')
    return target
  }
  async function read(relative) {
    const target = await confined(relative)
    const file = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { if ((await file.stat()).size > MAX_BODY) throw new Error('Feedback file is too large.'); return JSON.parse(await file.readFile('utf8')) } finally { await file.close() }
  }
  async function atomic(relative, value, immutable = false) {
    const target = await confined(relative)
    const tmp = path.join(path.dirname(target), `.tmp-${randomUUID()}`)
    const file = await fs.open(tmp, 'wx', 0o600)
    try {
      await file.writeFile(Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`)
      await file.sync()
    } finally { await file.close() }
    try {
      await confined(relative)
      if (immutable) await fs.link(tmp, target)
      else await fs.rename(tmp, target)
    } finally { await fs.unlink(tmp).catch(() => {}) }
  }
  if (seedManifest) {
    try { await atomic('manifest.json', parseManifest(seedManifest), true) } catch (e) { if (e.code !== 'EEXIST') throw e }
  }
  await fs.writeFile(await confined('README.md'), GUIDE, { flag: 'wx', mode: 0o600 }).catch(e => { if (e.code !== 'EEXIST') throw e })
  async function listing(folder, validate, issues) {
    const names = (await fs.readdir(await confined(folder))).filter(n => /^[\w-]+\.json$/.test(n)).sort()
    const result = []
    for (const name of names.slice(-1000)) {
      try {
        const item = await read(`${folder}/${name}`)
        if (!validate(item) || `${item.id}.json` !== name) throw new Error('Invalid document')
        result.push(item)
      } catch { issues.push(`Cannot read ${folder}/${name}. Correct the file and save it again.`) }
    }
    return result
  }
  async function state() {
    const manifest = parseManifest(await read('manifest.json'))
    const issues = []
    let draft = { revision: 0, document: null, savedAt: null }
    try {
      draft = await read('draft.json')
      if (!Number.isInteger(draft.revision) || !isDraft(draft.document) || draft.document.projectId !== manifest.id) throw new Error('Invalid draft')
      // When two windows disagree about the draft, the person choosing between them needs to know
      // which one is newer. The file's own timestamp is the only honest answer.
      draft.savedAt = (await fs.stat(await confined('draft.json'))).mtime.toISOString()
    }
    catch (e) { if (e.code !== 'ENOENT') { issues.push('The saved draft cannot be read. Use browser recovery or restore the file.'); draft = { revision: -1, document: null, savedAt: null } } }
    const batches = await listing('batches', isBatch, issues)
    const responses = await listing('responses', isResponse, issues)
    return { manifest, draft, batches: batches.filter(b => b.projectId === manifest.id), responses: responses.filter(r => r.projectId === manifest.id), issues, token }
  }
  function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
  async function body(req) {
    if (!String(req.headers['content-type']).startsWith('application/json')) throw Object.assign(new Error('Use application/json.'), { status: 415 })
    const chunks = []; let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(new Error('Request is too large.'), { status: 413 }); chunks.push(chunk) }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  function changed() { for (const res of clients) res.write('event: change\ndata: {}\n\n') }
  const server = http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin
      if (origin && !allowedOrigins.includes(origin)) return json(res, 403, { error: 'Origin is not allowed.' })
      const pathname = new URL(req.url, 'http://localhost').pathname
      if (req.method === 'GET' && pathname === '/api/web/state') return json(res, 200, await state())
      if (req.method === 'GET' && pathname === '/api/web/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
        res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return
      }
      if (req.method === 'GET' && /^\/api\/web\/captures\/[\w-]+\.png$/.test(pathname)) {
        const file = await fs.open(await confined(`captures/${path.basename(pathname)}`), constants.O_RDONLY | constants.O_NOFOLLOW)
        try { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); res.end(await file.readFile()) } finally { await file.close() }
        return
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'Unknown endpoint.' })
      if (!origin || !allowedOrigins.includes(origin) || req.headers['x-paramrig-token'] !== token) return json(res, 403, { error: 'Reconnect before saving feedback.' })
      const input = await body(req)
      await serial(async () => {
        const current = await state()
        if (pathname === '/api/web/draft') {
          if (!isDraft(input.document) || input.document.projectId !== current.manifest.id) return json(res, 400, { error: 'Invalid draft.' })
          if (input.expectedRevision !== current.draft.revision || current.draft.revision < 0) return json(res, 409, { error: 'The saved draft changed. Review recovery before saving.', draft: current.draft })
          const next = { revision: current.draft.revision + 1, document: input.document }
          await atomic('draft.json', next); json(res, 200, next)
        } else if (pathname === '/api/web/batches') {
          if (!isBatch(input) || input.projectId !== current.manifest.id || input.sourceRevision !== current.manifest.revision) return json(res, 409, { error: 'Feedback does not match the current project revision.' })
          for (const t of input.tickets) for (const c of t.captures) {
            if (c.dataUrl || c.file && !/^captures\/[\w-]+\.png$/.test(c.file)) return json(res, 400, { error: 'Save captures before validating feedback.' })
            if (c.file) await fs.access(await confined(c.file))
          }
          try { await atomic(`batches/${input.id}.json`, input, true) }
          catch (e) { if (e.code !== 'EEXIST') throw e; if (JSON.stringify(await read(`batches/${input.id}.json`)) !== JSON.stringify(input)) return json(res, 409, { error: 'Validated feedback cannot be overwritten.' }) }
          json(res, 201, { id: input.id })
        } else if (pathname === '/api/web/captures') {
          if (!safeId(input.id) || typeof input.dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.dataUrl)) return json(res, 400, { error: 'Invalid PNG capture.' })
          const bytes = Buffer.from(input.dataUrl.split(',')[1], 'base64')
          if (bytes.length > 12 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return json(res, 400, { error: 'Invalid or oversized PNG capture.' })
          const file = `captures/${input.id}.png`
          try { await atomic(file, bytes, true) } catch (e) { if (e.code !== 'EEXIST') throw e }
          json(res, 201, { file })
        } else return json(res, 404, { error: 'Unknown endpoint.' })
        changed()
      })
    } catch (error) {
      if (!res.headersSent) json(res, error.status ?? 400, { error: error.code === 'ENOENT' ? 'No web manifest found. Add .paramrig/manifest.json to the connected project.' : error.message })
      else res.end()
    }
  })
  let signature = ''
  const poll = setInterval(async () => {
    try {
      const current = JSON.stringify(await state())
      if (signature && signature !== current) changed()
      signature = current
    } catch { changed() }
    for (const res of clients) res.write(': heartbeat\n\n')
  }, 1500)
  poll.unref()
  server.on('close', () => { clearInterval(poll); for (const res of clients) res.end() })
  return { server, root, state, close: () => { for (const res of clients) res.end(); return new Promise(resolve => server.close(resolve)) } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const seedManifest = process.env.PARAMRIG_SEED_MANIFEST ? JSON.parse(await fs.readFile(process.env.PARAMRIG_SEED_MANIFEST, 'utf8')) : undefined
  const service = await createWebService({ projectDir: process.env.PARAMRIG_PROJECT_DIR, seedManifest, allowedOrigins: (process.env.PARAMRIG_ALLOWED_ORIGINS ?? 'http://localhost:5174,http://127.0.0.1:5174').split(',') })
  service.server.listen(Number(process.env.PORT ?? 5175), '0.0.0.0', () => console.log('ParamRig web feedback service is ready.'))
  process.on('SIGTERM', async () => { await service.close(); process.exit(0) })
}
