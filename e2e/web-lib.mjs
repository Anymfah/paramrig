/*
 * The moves every web script makes.
 *
 * The workspace is opened through the connections page rather than by deep link, because that is
 * the path a person takes, and because the deep link is the subject of one script rather than the
 * preamble of all of them.
 */
import { BASE } from './lib.mjs'

/**
 * A draft the browser is holding ahead of the file on disk blocks every write until someone
 * chooses between the two versions — which is exactly what a killed run leaves behind, since the
 * recovery copy in IndexedDB is written before the file is. A script that does not make that
 * choice writes nothing and fails on the state it thought it had saved. It takes the project's
 * file: that is the version every other window shares.
 */
export async function settleRecovery(page) {
  const choice = page.getByRole('button', { name: 'Use the project file' })
  if (await choice.count() === 0) return false
  await choice.click()
  await page.waitForTimeout(800)
  return true
}

/** Opens the Fieldnotes workspace and waits for the preview to answer. */
export async function openWorkspace(page, { theme } = {}) {
  await page.goto(`${BASE}/web`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  if (theme) {
    const changed = await page.evaluate(value => {
      const had = localStorage.getItem('paramrig.theme')
      localStorage.setItem('paramrig.theme', value)
      return had !== value
    }, theme)
    if (changed) await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  }
  await page.getByRole('button', { name: 'Open project' }).click()
  await page.waitForSelector('.web-toolbar')
  await settled(page)
  await settleRecovery(page)
}

/** Waits for the preview to be connected — the notice is gone. */
export function settled(page) {
  return page.waitForFunction(() => document.querySelectorAll('.web-connection-notice').length === 0, null, { timeout: 30000 })
}

/**
 * A display stream that is really a canvas, installed in place of `getDisplayMedia`.
 *
 * The permission and the browser's own picker have no headless equivalent; everything behind them
 * does. `captureStream` hands back a live MediaStreamTrack, so the video element, the frame, the
 * canvas and the track being stopped all run exactly as they do for a real screen. Pass it to
 * `page.addInitScript` before opening the workspace; `window.__display` counts the calls and the
 * stops, and `deny` makes the next call refuse the way a person declining does.
 */
export const fakeDisplay = () => {
  window.__display = { calls: 0, stopped: 0, deny: false }
  const media = navigator.mediaDevices ?? {}
  media.getDisplayMedia = async () => {
    window.__display.calls += 1
    if (window.__display.deny) throw new DOMException('Denied', 'NotAllowedError')
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 400
    const context = canvas.getContext('2d')
    context.fillStyle = '#1d3f36'; context.fillRect(0, 0, 640, 400)
    context.fillStyle = '#df7757'; context.fillRect(0, 0, 320, 200)
    // A stream with no new frames never fires requestVideoFrameCallback; redrawing keeps the track
    // producing, exactly as a real screen does. It stops with the track, so the page is not left
    // painting for the scripts that follow.
    const paint = setInterval(() => { context.fillRect(0, 0, 320, 200) }, 60)
    const stream = canvas.captureStream(30)
    for (const track of stream.getTracks()) {
      const stop = track.stop.bind(track)
      track.stop = () => { window.__display.stopped += 1; clearInterval(paint); stop() }
    }
    return stream
  }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => media })
}

/**
 * Where a point inside the preview lands on the page, ready for `page.mouse`.
 *
 * The frame's own rect is already past its scroll, and the iframe's box already carries the scale
 * the preview is drawn at, so the two compose without knowing either.
 */
export async function pointInFrame(page, selector, { down = 12 } = {}) {
  const frame = page.frames().find(f => f.url().includes('127.0.0.1'))
  const box = await page.locator('iframe').boundingBox()
  const declared = await page.locator('iframe').evaluate(el => Number(el.getAttribute('width')))
  const scale = box.width / declared
  const inner = await frame.evaluate(sel => {
    const r = document.querySelector(sel).getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y, height: r.height }
  }, selector)
  return { x: box.x + inner.x * scale, y: box.y + (inner.y + Math.min(down, inner.height / 2)) * scale, inner, scale }
}

/**
 * How far down the preview a real mouse can go, in page pixels.
 *
 * Input aimed at a cross-origin frame is hit-tested against the *real* browser window, not against
 * the viewport the harness emulates. The QA browser's window is 600 px tall while the scripts
 * emulate 900, so roughly the top half of the preview answers a real click and the rest does not.
 * It is positional and repeatable rather than intermittent, and it is the browser, not the page:
 * the frame's own document hears nothing either. Below it, dispatch inside the frame instead.
 */
export async function mouseReach(page) {
  const real = await page.evaluate(() => ({ outer: outerHeight, inner: innerHeight }))
  return Math.max(0, real.outer - 60)
}

/** Removes every comment in the draft. The draft is shared, so a script cleans up after itself. */
export async function clearComments(page, guard = 10) {
  await page.locator('button[aria-label^="Comments"]').click()
  await page.waitForTimeout(300)
  for (let attempt = 0; attempt < guard; attempt += 1) {
    const rows = page.locator('.web-ticket-list button')
    if (await rows.count() === 0) break
    await rows.first().click()
    await page.waitForTimeout(300)
    await page.locator('button[aria-label="Remove ticket"]').click()
    await page.waitForTimeout(400)
  }
  return page.locator('.web-ticket-list button').count()
}
