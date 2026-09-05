import { chromium } from 'playwright-core'
import { get as httpGet } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWitness } from './witness.mjs'

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
  const context = browser.contexts()[0]
  /*
   * One page, borrowed and given back — never a new one each time.
   *
   * The QA browser is shared and headless, and only its front tab is drawn. Opening a page per
   * script leaves the new one behind the old, and a page that is not drawn produces no frames: no
   * `requestAnimationFrame`, and every Playwright actionability check waits for ever on an element
   * it will never see settle. So the run takes the page that is already there, hands it back
   * pointing at nothing, and closes anything a killed run left over — except the last one, because
   * a browser attached over CDP loses its window along with its final page.
   */
  for (const stale of context.pages()) {
    if (context.pages().length <= 1) break
    const url = stale.url()
    if (url === 'about:blank' || url.startsWith(BASE)) await stale.close().catch(() => undefined)
  }
  let page = context.pages()[0] ?? await context.newPage()
  page.removeAllListeners('console')
  page.removeAllListeners('pageerror')
  // The page outlives a script, so a listener left behind would count a later script's modules on
  // top of this one's. Stripped for the same reason the two above are.
  page.removeAllListeners('request')
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(String(error)))
  const shot = async (file, options) => {
    mkdirSync(OUTPUT, { recursive: true })
    await page.screenshot({ path: join(OUTPUT, file), ...options })
  }
  /** How many frames the page draws in 400 ms. Nought means it is not being drawn at all. */
  const frameCount = (target) => target.evaluate(() => new Promise((resolve) => {
    let frames = 0
    const step = () => { frames += 1; requestAnimationFrame(step) }
    requestAnimationFrame(step)
    setTimeout(() => resolve(frames), 400)
  }))
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    /*
     * The canary. A shared headless browser sometimes stops drawing — an occluded window, a page
     * left behind by a killed run, a 3D page whose context was lost — and every symptom of that is
     * a thirty-second timeout on an element that is perfectly still. One frame asked for up front
     * turns a mystery into a sentence.
     *
     * A page that has stopped is worth one attempt at replacing before the run is given up on: a
     * fresh page in front of the old one usually draws again, and the alternative is a whole
     * campaign failing because the script before this one left its WebGL context behind.
     */
    if (await frameCount(page) === 0) {
      const fresh = await context.newPage()
      await fresh.bringToFront().catch(() => undefined)
      if (context.pages().length > 1) await page.close().catch(() => undefined)
      page = fresh
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
      page.on('pageerror', (error) => errors.push(String(error)))
      await page.setViewportSize({ width: 1440, height: 900 })
      log('NOTE the page had stopped drawing and was replaced with a fresh one')
    }
    if (await frameCount(page) === 0) {
      throw new Error('The QA browser has stopped drawing: no frames in 400 ms, so nothing can be'
        + ' clicked. Restart it with --disable-backgrounding-occluded-windows'
        + ' --disable-renderer-backgrounding --disable-background-timer-throttling'
        + ' --disable-features=CalculateNativeWinOcclusion and try again.')
    }
    // The window is shared, and a resize is not instant: a script that starts measuring before the
    // page has taken the new width measures the last script's window.
    await page.waitForFunction(() => window.innerWidth === 1440, null, { timeout: 5000 }).catch(() => undefined)
    /*
     * The machine, measured before the application is on screen. A page left behind by the script
     * before this one would make the witness move with the very thing it is there to hold still, so
     * the blank page is insisted on rather than assumed: the goto in `finally` swallows its own
     * failure, and the first script of a run starts on whatever the browser was showing.
     */
    await page.goto('about:blank').catch(() => undefined)
    const witness = await readWitness(page)
    log(witness.line())
    await body({ page, check, log, errors, shot, witness, helpers: pageHelpers(page) })
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  } catch (error) {
    results.failed += 1
    log(`SCRIPT ERROR ${error?.stack ?? error}`)
  } finally {
    // The page is handed back rather than closed: see the note where it was borrowed.
    await page.goto('about:blank').catch(() => undefined)
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
/**
 * A control on the right of the header, whether or not the width has folded that half away.
 *
 * At 1440 the view settings collapse into one popover, and the overlays menu and the mirror axes
 * are inside it. Widening the window to avoid that is not an option: the QA browser has one window
 * and resizing it stops the compositor drawing for every script that follows.
 */
export async function headerControl(page, selector) {
  const direct = page.locator(selector)
  if (await direct.count() > 0 && await direct.first().isVisible()) return direct.first()
  const settings = page.locator('button[aria-label="View settings"]')
  if (await settings.count() > 0) {
    // Dispatched rather than clicked: the header is a roving-tabindex toolbar whose buttons sit
    // under a tooltip wrapper, and Playwright reads that as an interception even though a person's
    // click lands squarely on the button.
    await settings.first().dispatchEvent('click')
    await page.waitForTimeout(350)
  }
  return page.locator(selector).first()
}

export function pageHelpers(page) {
  /*
   * How many of the application's own modules the browser fetches before the first frame is drawn.
   *
   * This is the honest regression guard for the time to that frame. The stopwatch cannot be one:
   * measured through `newScene`, it starts at a reload and runs through Playwright's own five
   * hundred millisecond networkidle wait and a click's actionability checks, so more than half of
   * what it reports is the harness idling on purpose, and the rest is the dev server transforming
   * on demand across a Docker loopback. None of that is the application, and none of it moves when
   * the application gets lighter. A module count does: it is a property of the import graph, it is
   * the same number on a busy machine as on a quiet one, and it is exactly what a deferred import
   * changes. The milliseconds are still printed, because a person should see them.
   */
  let modules = 0
  page.on('request', (request) => { if (request.url().includes('/src/')) modules += 1 })
  let firstFrameModules = null

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

  /**
   * A new vector document, focused, ready for tool keys. The browser's stored documents and drafts
   * are cleared first: a run that starts on a library of two hundred leftovers is a run whose
   * clicks land on a page that is still settling.
   */
  const newDocument = async () => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.evaluate(() => {
      localStorage.removeItem('paramrig.vector-documents.v1')
      localStorage.removeItem('paramrig.drafts.v1')
      localStorage.removeItem('paramrig.tabs.v1')
    })
    await page.reload({ waitUntil: 'networkidle' })
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

  /**
   * The same trick for a file that is not text: the bytes come back as numbers.
   *
   * Only the head is carried over the bridge — a GLB or a PNG is megabytes, and what a check needs
   * is the signature and the length rather than the whole file.
   */
  const captureDownload = async (open, head = 32) => {
    const probe = page.evaluate((take) => new Promise((resolve) => {
      const original = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function patched() {
        HTMLAnchorElement.prototype.click = original
        fetch(this.href)
          .then((response) => response.arrayBuffer())
          .then((buffer) => resolve({
            download: this.download,
            size: buffer.byteLength,
            head: [...new Uint8Array(buffer.slice(0, take))],
          }))
      }
      setTimeout(() => { HTMLAnchorElement.prototype.click = original; resolve(null) }, 20000)
    }), head)
    await open()
    return probe
  }

  /**
   * Opens the detail of a paint layer. A fill or a stroke is a 32 px line in the inspector; its
   * type, its colour and its opacity live in the popover that line opens.
   */
  const openPaint = async (section = 'fill', index = 0) => {
    const rows = page.locator(`[data-section="${section}"] .vector-row__open`)
    await rows.nth(index).click()
    await page.waitForSelector('.vector-paint-popover')
    await page.waitForTimeout(150)
    return page.locator('.vector-paint-popover')
  }

  /** Closes whatever popover is open, without touching the selection. */
  const closePaint = async () => {
    await page.locator('.vector-paint-popover').press('Escape')
    await page.waitForTimeout(200)
  }

  /** Folds a section open, so a control inside it can be reached. */
  const openSection = async (section) => {
    const node = page.locator(`[data-section="${section}"]`)
    if (await node.getAttribute('data-open') === 'false') {
      await node.locator('.vector-section__title').click()
      await page.waitForTimeout(150)
    }
  }

  /**
   * A new scene, focused, ready for tool keys. Stored documents are cleared first: a run that
   * starts on a library of two hundred leftovers is a run whose clicks land on a page still
   * settling.
   */
  const newScene = async () => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.evaluate(() => {
      localStorage.removeItem('paramrig.scene-documents.v1')
      localStorage.removeItem('paramrig.vector-documents.v1')
      localStorage.removeItem('paramrig.drafts.v1')
      localStorage.removeItem('paramrig.tabs.v1')
      // The preferences follow the person, and the browser profile outlives a run: a script that
      // did not set them must find the defaults rather than what the last script left behind. The
      // per-document store goes too: it held the preferences before they moved, and is read once
      // when the new key is absent.
      localStorage.removeItem('paramrig.scene-prefs.v1')
      localStorage.removeItem('paramrig.scene-inspector.v1')
    })
    modules = 0
    await page.reload({ waitUntil: 'networkidle' })
    await page.click('[aria-label="New scene"]')
    await page.waitForSelector('.scene-stage')
    // Stop counting where the measurement stops: the viewport marks its first frame, and the panels
    // that load after it are not what the budget is about.
    await page.waitForFunction(() => window.__paramrigScene?.firstFrame() !== null, null, { timeout: 20000 })
      .catch(() => undefined)
    firstFrameModules = modules
    await page.locator('#main').focus()
  }

  /**
   * The modules the last `newScene` fetched before its first frame, or null if none has run. Both
   * halves of the journey are in it — the library page and the scene editor's own chunk — because
   * both are inside the window the first-frame stopwatch measures.
   */
  const moduleCount = () => firstFrameModules

  /**
   * A header control, wherever the header is currently keeping it.
   *
   * The viewport header folds its trailing groups into popovers when the row cannot hold them, and
   * which groups are folded depends on the mode and on how wide the panels beside it are. A script
   * that reaches straight into the bar is asking a question about the width of the window rather
   * than about the editor. This asks the question the person asks: reach the control, opening what
   * has to be opened.
   */
  const headerControl = async (label) => {
    const inBar = page.locator(`.scene-header__button[aria-label="${label}"]`)
    if (await inBar.count() > 0) return inBar
    for (const trigger of ['Editor', 'View settings']) {
      const fold = page.locator('.scene-header').getByRole('button', { name: trigger })
      if (await fold.count() === 0) continue
      await fold.first().click()
      await page.waitForTimeout(200)
      const folded = page.locator(`[aria-label="${label}"]`)
      if (await folded.count() > 0) return folded.first()
      await page.keyboard.press('Escape')
    }
    return inBar
  }

  /** The stored scene, which is what the editor persists. */
  const scene = () => page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('paramrig.scene-documents.v1') ?? '{}')
    return all[location.pathname.split('/r/')[1]]
  })

  /**
   * Replaces parts of the stored scene and reloads, for states too tedious to build by hand.
   * `build` is serialised into the page: it is given the stored document and returns the patch.
   */
  const seedScene = async (build) => {
    await page.evaluate((source) => {
      const key = 'paramrig.scene-documents.v1'
      const all = JSON.parse(localStorage.getItem(key) ?? '{}')
      const id = location.pathname.split('/r/')[1]
      // eslint-disable-next-line no-new-func
      all[id] = { ...all[id], ...new Function(`return (${source})`)()(all[id]) }
      localStorage.setItem(key, JSON.stringify(all))
    }, build.toString())
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.scene-stage')
    await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
    await page.locator('#main').focus()
  }

  /** Where a world point lands on screen, in page coordinates as well as the canvas's own. */
  const project3d = async (point) => {
    const local = await page.evaluate((value) => window.__paramrigScene.project(value), point)
    if (!local) return null
    const box = await page.locator('.scene-viewport').boundingBox()
    return { x: box.x + local[0], y: box.y + local[1], local }
  }

  /** What the id buffer says is under a point, in canvas coordinates. */
  const pick = (x, y) => page.evaluate(([px, py]) => window.__paramrigScene.pick(px, py), [x, y])

  /**
   * The canvas's box on screen, for placing a pointer without guessing. It is the canvas and not
   * the stage: `project()` answers in canvas coordinates, and the stage also holds the status bar.
   */
  const viewportBox = () => page.locator('.scene-viewport').boundingBox()

  return { toClient, toDocument, doc, seed, drag, clickAt, newDocument, newScene, scene, seedScene, project3d, pick, viewportBox, captureExport, captureDownload, openPaint, closePaint, openSection, moduleCount, headerControl }
}
