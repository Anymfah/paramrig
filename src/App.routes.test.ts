import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/*
 * The demo is a static site behind Apache: a route only the router knows about answers with
 * Apache's own 404 on a reload or a shared link, and nothing in the build says so. Reading both
 * files and comparing them is the only thing that notices.
 *
 * The rewrite is read rather than reimplemented: the paths are put through the real rule, so a rule
 * that stops matching fails here whatever it is rewritten to look like.
 */
// Read from the repository root: under jsdom `import.meta.url` is an http URL, not a file one.
const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const htaccess = readFileSync(resolve(process.cwd(), 'public/.htaccess'), 'utf8')

const routes = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1]!)
const rule = /RewriteRule\s+\^\((.+)\)\$\s+index\.html/.exec(htaccess)
/** A concrete path for a route: the parameters a person's URL would actually carry. */
const sample = (route: string) => route.replace(/:rigId/, 'web-fieldnotes').replace(/^\//, '')

describe('the demo answers every route it declares', () => {
  it('reads both files', () => {
    expect(routes.length).toBeGreaterThan(4)
    expect(rule).not.toBeNull()
  })

  it('rewrites every route in the router', () => {
    const rewrite = new RegExp(`^(${rule![1]})$`)
    // `/` is the document root, which Apache serves without a rewrite, and `*` is the router's own
    // fallback, which is only reached once the application is running.
    const wanted = routes.filter(route => route !== '/' && route !== '*').map(sample)
    expect(wanted.filter(path => !rewrite.test(path))).toEqual([])
    expect(wanted).toContain('web')
    expect(wanted).toContain('docs/vector-rigs')
  })

  it('leaves a missing asset alone rather than answering it with the application', () => {
    const rewrite = new RegExp(`^(${rule![1]})$`)
    for (const path of ['assets/index-abc123.js', 'fonts/PublicSans.woff2', 'favicon.svg', 'examples/web/index.html']) {
      expect(rewrite.test(path)).toBe(false)
    }
  })
})
