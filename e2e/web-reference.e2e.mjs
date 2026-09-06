/*
 * The record for the web workspace: the pictures the report compares against the ones taken before
 * the work started, the handshake measured over three passes, and a sweep of the three widths in
 * both themes looking for a row that does not fit.
 *
 * Writes into `e2e/reference/web/after/` rather than `e2e/output/`, beside the `before/` set.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from './lib.mjs'
import { clearComments, openWorkspace } from './web-lib.mjs'

const REF = join(process.cwd(), 'e2e', 'reference', 'web', 'after')

const watcher = () => {
  window.__hs = []
  window.__sdk = []
  let announcedAt = null
  window.addEventListener('message', event => { if (event.data?.type === 'sdk-present') announcedAt = performance.now() }, true)
  let noticeAt = null
  let sawBar = false
  const tick = () => {
    const bar = !!document.querySelector('.web-toolbar')
    const notice = document.querySelector('.web-connection-notice')
    if (bar && !sawBar) { sawBar = true; if (notice) noticeAt = performance.now() }
    if (sawBar && notice && noticeAt === null) noticeAt = performance.now()
    if (sawBar && !notice && noticeAt !== null) {
      window.__hs.push(Math.round(performance.now() - noticeAt))
      window.__sdk.push(announcedAt === null ? null : Math.round(performance.now() - announcedAt))
      noticeAt = null; announcedAt = null
    }
    requestAnimationFrame(tick)
  }
  tick()
}

export default run('web-reference', async ({ page, check, log }) => {
  mkdirSync(REF, { recursive: true })
  const lines = []
  const note = text => { lines.push(text); log(`NOTE ${text}`) }
  await page.addInitScript(watcher)
  const shotRef = async file => writeFileSync(join(REF, file), await page.screenshot())
  const open = async (theme = 'dark') => {
    // A resize is not instant in a shared headless window; a navigation that starts before the
    // window has taken the new size is a navigation that is still settling when it is measured.
    await page.waitForTimeout(400)
    await openWorkspace(page, { theme })
  }
  const frame = () => page.frames().find(f => f.url().includes('127.0.0.1'))
  const pick = async selector => {
    await frame().evaluate(sel => {
      const el = document.querySelector(sel)
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, pointerId: 9, clientX: r.x + r.width / 2, clientY: r.y + Math.min(12, r.height / 2) }))
    }, selector)
    await page.waitForTimeout(600)
  }

  // 1 · the handshake, three passes over each of the three cases
  const opens = []; const reloads = []; const pages = []; const sinceSdk = []
  for (let pass = 0; pass < 3; pass += 1) {
    await page.goto('about:blank')
    await open()
    opens.push((await page.evaluate(() => window.__hs))[0])
    await page.locator('button[aria-label="View options"]').click()
    await page.getByRole('menuitem', { name: 'Reload preview' }).click()
    await page.waitForFunction(() => window.__hs.length >= 2, null, { timeout: 30000 })
    reloads.push((await page.evaluate(() => window.__hs))[1])
    await page.locator('.web-page-picker button').click()
    await page.getByRole('option', { name: 'Journal' }).click()
    await page.waitForFunction(() => window.__hs.length >= 3, null, { timeout: 30000 })
    pages.push((await page.evaluate(() => window.__hs))[2])
    sinceSdk.push(...(await page.evaluate(() => window.__sdk)).filter(v => v !== null))
  }
  const stat = list => `${list.join(' / ')} ms · spread ${Math.max(...list) - Math.min(...list)} ms`
  note(`handshake, open: ${stat(opens)}`)
  note(`handshake, reload preview: ${stat(reloads)}`)
  note(`handshake, page change: ${stat(pages)}`)
  note(`from the SDK announcing itself to Connected: ${stat(sinceSdk)}`)
  check('every handshake is under a fifth of a second', Math.max(...opens, ...reloads, ...pages) < 200, `${Math.max(...opens, ...reloads, ...pages)} ms`)

  // 2 · the pictures the report compares
  await open()
  await shotRef('project-controls-1440.png')
  await page.locator('button[aria-label="Select element"]').click()
  await page.waitForTimeout(300)
  await pick('[data-paramrig-id="story-card"]')
  await shotRef('card-selected-1440.png')
  await pick('.fn-hero .fn-kicker')
  await shotRef('kicker-selected-1440.png')

  await page.locator('button[aria-label="Comment on selection"]').click()
  await page.waitForSelector('.web-ticket-editor')
  await page.locator('textarea[aria-label="Comment"]').fill('The kicker sits too close to the title.')
  await page.waitForTimeout(800)
  await shotRef('ticket-editor-1440.png')

  await page.locator('.web-review-button').click()
  await page.waitForSelector('.web-feedback-review')
  await page.waitForTimeout(400)
  await shotRef('review-1440.png')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.waitForTimeout(400)

  // The comment this script wrote goes away again; the draft is shared with every other window.
  check('the record leaves no comment behind', await clearComments(page) === 0)

  // 3 · three widths, two themes, and a look for anything that does not fit
  const overflow = () => page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    toolbar: document.querySelector('.web-toolbar').scrollWidth - document.querySelector('.web-toolbar').clientWidth,
    inspector: (() => { const el = document.querySelector('.web-inspector__body'); return el ? el.scrollWidth - el.clientWidth : 0 })(),
  }))
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.waitForFunction(w => window.innerWidth === w, width, { timeout: 10000 }).catch(() => undefined)
      await open(theme)
      await page.waitForTimeout(500)
      if (width === 390) { await page.getByRole('button', { name: 'Page', exact: true }).click().catch(() => undefined); await page.waitForTimeout(400) }
      const room = await overflow()
      note(`${width} px ${theme}: overflow ${JSON.stringify(room)}`)
      check(`nothing overflows sideways at ${width} px in the ${theme} theme`, room.page <= 0 && room.toolbar <= 0 && room.inspector <= 0, JSON.stringify(room))
      await shotRef(`shell-${width}-${theme}.png`)
      if (width === 390 && theme === 'dark') {
        await shotRef('toolbar-390.png')
        await page.getByRole('button', { name: 'Inspector', exact: true }).click().catch(() => undefined)
        await page.waitForTimeout(500)
        await shotRef('inspector-390.png')
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  writeFileSync(join(REF, 'measurements.txt'), `${lines.join('\n')}\n`)
})
