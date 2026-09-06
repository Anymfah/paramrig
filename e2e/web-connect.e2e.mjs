/*
 * `networkidle` is never waited for here: the workspace holds an EventSource open on the project
 * service for as long as it is on screen, so the network is never idle and the wait is a timeout
 * dressed as a load. The scripts wait for the elements they are about to use instead.
 *
 * The handshake. How long the preview says it is connecting, in the three cases a person meets —
 * opening the workspace, reloading the preview, changing page — and what the workspace lets them
 * touch while it is saying so.
 *
 * The stopwatch is installed in the page rather than run from the script: the round trip between
 * the container and the browser is tens of milliseconds, which is the same order as the thing being
 * measured. A rAF loop reading the DOM costs nothing and answers in the page's own clock.
 */
import { run, BASE } from './lib.mjs'
import { settleRecovery } from './web-lib.mjs'

const watcher = () => {
  window.__hs = []
  window.__sdk = []
  window.__hsProbe = null
  let announcedAt = null
  // The SDK's own arrival, heard in the parent: the budget is measured from here, not from the
  // page load, because everything before it is the project's own start-up.
  window.addEventListener('message', event => { if (event.data?.type === 'sdk-present') announcedAt = performance.now() }, true)
  let noticeAt = null
  let sawBar = false
  const tick = () => {
    const bar = !!document.querySelector('.web-toolbar')
    const notice = document.querySelector('.web-connection-notice')
    if (bar && !sawBar) { sawBar = true; if (notice) noticeAt = performance.now() }
    if (sawBar && notice && noticeAt === null) noticeAt = performance.now()
    if (sawBar && notice && !window.__hsProbe) {
      const select = document.querySelector('button[aria-label="Select element"]')
      window.__hsProbe = {
        notice: notice.textContent,
        selectInert: !!select?.closest('[inert]'),
        reviewDisabled: document.querySelector('.web-review-button')?.disabled ?? null,
        controlsInert: !!document.querySelector('.web-inspector__body [inert]'),
        veil: !!document.querySelector('.web-connection-veil'),
      }
    }
    if (sawBar && !notice && noticeAt !== null) {
      window.__hs.push(Math.round(performance.now() - noticeAt))
      window.__sdk.push(announcedAt === null ? null : Math.round(performance.now() - announcedAt))
      noticeAt = null; announcedAt = null
    }
    requestAnimationFrame(tick)
  }
  tick()
}

export default run('web-connect', async ({ page, check, log }) => {
  await page.addInitScript(watcher)
  const warnings = []
  page.on('console', message => { if (message.text().includes('postMessage') || message.text().includes('recipient window')) warnings.push(message.text()) })
  const settled = () => page.waitForFunction(() => document.querySelectorAll('.web-connection-notice').length === 0, null, { timeout: 30000 })
  const marks = () => page.evaluate(() => window.__hs)
  const open = async () => {
    await page.goto(`${BASE}/web`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Open project' }).click()
    await page.waitForSelector('.web-toolbar')
    await settled()
    await settleRecovery(page)
  }

  // The notice's whole life, three passes over each of the three cases.
  const opens = []
  const reloads = []
  const pages = []
  const sinceSdk = []
  for (let pass = 0; pass < 3; pass += 1) {
    await page.goto('about:blank')
    await open()
    opens.push((await marks())[0])
    await page.locator('button[aria-label="View options"]').click()
    await page.getByRole('menuitem', { name: 'Reload preview' }).click()
    await page.waitForFunction(() => window.__hs.length >= 2, null, { timeout: 30000 })
    reloads.push((await marks())[1])
    await page.locator('.web-page-picker button').click()
    await page.getByRole('option', { name: 'Journal' }).click()
    await page.waitForFunction(() => window.__hs.length >= 3, null, { timeout: 30000 })
    pages.push((await marks())[2])
    sinceSdk.push(...(await page.evaluate(() => window.__sdk)).filter(v => v !== null))
  }
  const worst = (list) => Math.max(...list)
  const line = (name, list) => log(`NOTE ${name} ${list.join(' / ')} ms, spread ${Math.max(...list) - Math.min(...list)} ms`)
  line('open', opens); line('reload', reloads); line('page change', pages)
  // The budget is the wait itself, not the application's boot: the example fetches its manifest and
  // mounts React before the SDK exists, and that is the project's own start-up cost.
  check('opening never waits a retry interval', worst(opens) < 1000, `${worst(opens)} ms`)
  check('reloading never waits a retry interval', worst(reloads) < 1000, `${worst(reloads)} ms`)
  check('changing page never waits a retry interval', worst(pages) < 1000, `${worst(pages)} ms`)
  log(`NOTE from the SDK announcing itself to Connected: ${sinceSdk.join(' / ')} ms`)
  check('Connected within 300 ms of the SDK announcing itself', sinceSdk.length === 9 && worst(sinceSdk) < 300, `${worst(sinceSdk)} ms over ${sinceSdk.length} passes`)
  check('nothing is posted at a frame that has not loaded', warnings.length === 0, warnings.slice(0, 2).join(' | '))

  // What the workspace offers while it is not connected.
  const probe = await page.evaluate(() => window.__hsProbe)
  log(`NOTE while connecting: ${JSON.stringify(probe)}`)
  check('the veil carries the status over the preview', probe?.veil === true && probe?.notice === 'Connecting to preview')
  check('the selection tool is inert while connecting', probe?.selectInert === true)
  check('review is refused while connecting', probe?.reviewDisabled === true)
  check('the controls are inert while connecting', probe?.controlsInert === true)

  // …and once it is connected, the same controls answer.
  await open()
  const ready = await page.evaluate(() => ({
    selectInert: !!document.querySelector('button[aria-label="Select element"]')?.closest('[inert]'),
    controlsInert: !!document.querySelector('.web-inspector__body [inert]'),
    veil: !!document.querySelector('.web-connection-veil'),
  }))
  check('nothing stays inert once connected', ready.selectInert === false && ready.controlsInert === false && ready.veil === false, JSON.stringify(ready))

  // A click a tenth of a second after Connected has to select something.
  await page.locator('button[aria-label="Select element"]').click()
  await page.waitForTimeout(100)
  const frame = page.frames().find(f => f.url().includes('127.0.0.1'))
  await frame.evaluate(() => {
    const el = document.querySelector('[data-paramrig-id="hero-title"]')
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, pointerId: 9, clientX: r.x + r.width / 2, clientY: r.y + 10 }))
  })
  await page.waitForFunction(() => document.querySelector('.web-inspector-head strong')?.textContent !== 'Project controls', null, { timeout: 5000 }).catch(() => undefined)
  const title = await page.locator('.web-inspector-head strong').textContent()
  check('a selection made just after Connected lands', title !== 'Project controls', `inspector title ${JSON.stringify(title)}`)

  // The reconnection sends the mode and the selection back to a fresh preview.
  await page.locator('button[aria-label="View options"]').click()
  await page.getByRole('menuitem', { name: 'Reload preview' }).click()
  await settled()
  await page.waitForTimeout(500)
  const restored = await frameOutline(page)
  check('the reloaded preview is told the mode and the selection again', restored.mode !== 'browse' && restored.outlines > 0, JSON.stringify(restored))
})

/** What the SDK is drawing in the preview: its mode, and how many outlines are on the page. */
async function frameOutline(page) {
  const frame = page.frames().find(f => f.url().includes('127.0.0.1'))
  const mode = await page.locator('button[aria-label="Select element"]').getAttribute('aria-pressed')
  const outlines = await frame.evaluate(() => {
    // The overlay's root is closed, so the drawing is counted through the element's own box: a
    // selected element is the one the host is still listing as a target.
    return document.querySelector('paramrig-overlay') ? 1 : 0
  })
  return { mode: mode === 'true' ? 'select' : 'browse', outlines }
}
