import { createReadStream, existsSync, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { root } from './sdk-entries.mjs'
/** Serve exact built artifacts on loopback hostnames through the existing development service. */
export function appPreviewPlugin() {
  return { name: 'paramrig-distribution-preview', apply: 'serve', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const match = /^paramrig-(suite|audio|vector|scene|web|website)\.localhost(?::\d+)?$/.exec(req.headers.host ?? '')
      if (!match) return next()
      const base = resolve(root, '.local/modularity/distributions', match[1])
      let path
      try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname) } catch { res.statusCode = 400; res.end(); return }
      const candidate = resolve(base, `.${path}`)
      if (!candidate.startsWith(base + sep) && candidate !== base) { res.statusCode = 403; res.end(); return }
      const index = resolve(candidate, 'index.html')
      const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : existsSync(index) ? index : match[1] !== 'website' && !extname(path) ? resolve(base, 'index.html') : candidate
      if (!existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end('Build this distribution first.'); return }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webp': 'image/webp', '.png': 'image/png', '.txt': 'text/plain', '.xml': 'application/xml' }
      res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      createReadStream(file).pipe(res)
    })
  } }
}
