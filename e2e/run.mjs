import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Runs the QA scripts against the running dev server and the headless Chrome on the host.
 *
 *   docker compose run --rm app npm run e2e            every script
 *   docker compose run --rm app npm run e2e -- chantier-d   the ones whose name matches
 */
const here = dirname(fileURLToPath(import.meta.url))
const filters = process.argv.slice(2)
const scripts = readdirSync(here)
  .filter((file) => file.endsWith('.e2e.mjs'))
  .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
  .sort()

if (scripts.length === 0) {
  console.error(filters.length ? `No QA script matches ${filters.join(', ')}` : 'No QA script found')
  process.exit(1)
}

let passed = 0
let failed = 0
for (const script of scripts) {
  console.log(`\n— ${script}`)
  const module = await import(join(here, script))
  const result = await module.default
  passed += result.passed
  failed += result.failed
}
console.log(`\n${passed} passed, ${failed} failed, across ${scripts.length} ${scripts.length === 1 ? 'script' : 'scripts'}`)
process.exit(failed === 0 ? 0 : 1)
