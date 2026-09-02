import { chromium } from 'playwright-core'
import { get as httpGet } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Shared harness for the browser QA.
 *
 * The scripts run inside the app container; the browser they drive is the headless GPU Chrome on
 * the host. That is why the two addresses differ: the CDP endpoint is reached through
 * `host.docker.internal`, while the page URL is resolved by the browser itself, on the host.
 * Both can be overridden by environment variables for a run straight from macOS.
 */
export const CDP = process.env.PARAMRIG_CDP ?? 'http://host.docker.internal:9223'
export const BASE = process.env.PARAMRIG_BASE ?? 'http://localhost:5174'
export const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), 'output')

/** Runs one QA script against a fresh page, and reports its checks. */
export async function run(name, body) {
  const lines = []
  const results = { name, passed: 0, failed: 0, lines }
  const log = (text) => { lines.push(text); console.log(text) }
  const check = (label, ok, extra = '') => {
    results[ok ? 'passed' : 'failed'] += 1
    log(`${ok ? 'PASS' : 'FAIL'} · ${label}${extra ? ` — ${extra}` : ''}`)
  }
  const browser = await connect()
  const page = await browser.contexts()[0].newPage()
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(String(error)))
  const shot = async (file, options) => {
    mkdirSync(OUTPUT, { recursive: true })
    await page.screenshot({ path: join(OUTPUT, file), ...options })
  }
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await body({ page, check, log, errors, shot, helpers: pageHelpers(page) })
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  } catch (error) {
    results.failed += 1
    log(`SCRIPT ERROR ${error?.stack ?? error}`)
  } finally {
    await page.close()
    await browser.close()
    mkdirSync(OUTPUT, { recursive: true })
    writeFileSync(join(OUTPUT, `${name}.txt`), lines.join('\n'))
  }
  return results
}

/**
 * Connects to the browser on the host.
 *
 * Chrome's DevTools endpoint refuses any Host header that is neither an IP nor localhost, and
 * `host.docker.internal` is neither — even though Docker forwards the connection to the host's
 * loopback, where Chrome is listening. So the handshake is done by hand: ask for the socket with
 * a Host of localhost, then point the returned URL back at the host and keep the same header for
 * the upgrade. A run from macOS goes straight through the plain endpoint.
 */
async function connect() {
  const endpoint = new URL(CDP)
  const host = `localhost:${endpoint.port || 9222}`
  if (endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1') return chromium.connectOverCDP(CDP)
  // `fetch` refuses to set a Host header, so the handshake goes through the raw client.
  const version = JSON.parse(await get(`${CDP}/json/version`, host))
  const socket = new URL(version.webSocketDebuggerUrl)
  socket.hostname = endpoint.hostname
  return chromium.connectOverCDP(socket.toString(), { headers: { Host: host } })
}

function get(url, host) {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, { headers: { Host: host } }, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve(body))
    })
    request.on('error', reject)
  })
}

/** The handful of page moves every script makes. */
export function pageHelpers(page) {
  /** Document coordinates to client coordinates, through the canvas transform. */
  const toClient = (point) => page.evaluate(({ x, y }) => {
    const m = document.querySelector('.vector-world').getScreenCTM()
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
  }, point)

  const toDocument = (client) => page.evaluate(({ x, y }) => {
    const m = document.querySelector('.vector-world').getScreenCTM().inverse()
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
  }, client)

  /** The stored document, which is what the editor persists. */
  const doc = () => page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('paramrig.vector-documents.v1') ?? '{}')
    return all[location.pathname.split('/r/')[1]]
  })

  /** Replaces the stored elements and reloads, for scenes too tedious to draw by hand. */
  const seed = async (build) => {
    await page.evaluate((source) => {
      const key = 'paramrig.vector-documents.v1'
      const all = JSON.parse(localStorage.getItem(key) ?? '{}')
      const id = location.pathname.split('/r/')[1]
      // eslint-disable-next-line no-new-func
      all[id] = { ...all[id], ...new Function(`return (${source})`)()(all[id]) }
      localStorage.setItem(key, JSON.stringify(all))
    }, build.toString())
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.vector-toolbar')
    await page.waitForTimeout(400)
  }

  const drag = async (from, to, { steps = 8, keys = [] } = {}) => {
    const a = await toClient(from)
    const b = await toClient(to)
    for (const key of keys) await page.keyboard.down(key)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    for (let index = 1; index <= steps; index += 1) {
      await page.mouse.move(a.x + (b.x - a.x) * index / steps, a.y + (b.y - a.y) * index / steps)
      await page.waitForTimeout(16)
    }
    await page.mouse.up()
    for (const key of keys) await page.keyboard.up(key)
    await page.waitForTimeout(150)
  }

  const clickAt = async (point) => {
    const at = await toClient(point)
    await page.mouse.click(at.x, at.y)
    await page.waitForTimeout(150)
  }

  /** A new vector document, focused, ready for tool keys. */
  const newDocument = async () => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.click('[aria-label="New vector document"]')
    await page.waitForSelector('.vector-toolbar')
    await page.locator('#main').focus()
  }

  /** Grabs the export the editor hands over, without writing a file. */
  const captureExport = async (open) => {
    const probe = page.evaluate(() => new Promise((resolve) => {
      const original = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function patched() {
        HTMLAnchorElement.prototype.click = original
        fetch(this.href).then((response) => response.text()).then((text) => resolve({ download: this.download, text }))
      }
      setTimeout(() => { HTMLAnchorElement.prototype.click = original; resolve(null) }, 8000)
    }))
    await open()
    return probe
  }

  return { toClient, toDocument, doc, seed, drag, clickAt, newDocument, captureExport }
}
