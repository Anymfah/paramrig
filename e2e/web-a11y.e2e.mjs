/*
 * The four environments prompt 1 declared unchecked: forced colours, reduced motion, a viewport the
 * size browser zoom leaves, and a finger.
 *
 * Browser zoom itself cannot be driven here — it is not a CDP surface — but 200% zoom in a 1440 px
 * window leaves the page 720 CSS pixels of room, and that is what is measured. The touch is real:
 * `Emulation.setTouchEmulationEnabled` is what makes Blink report `pointer: coarse`, and every tap
 * is an `Input.dispatchTouchEvent`.
 */
import { run } from './lib.mjs'
import { clearComments, fakeDisplay, openWorkspace, settled } from './web-lib.mjs'

/** Whether a thing is drawn at all: some colour, some size, and not the colour behind it. */
const legible = () => {
  const seen = (selector) => {
    const el = document.querySelector(selector)
    if (!el) return null
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return { color: style.color, background: style.backgroundColor, border: style.borderTopColor, width: Math.round(box.width), height: Math.round(box.height) }
  }
  return {
    dot: seen('.web-toolbar .web-status-dot'),
    review: seen('.web-review-button'),
    select: seen('button[aria-label="Select element"]'),
    inspector: seen('.web-inspector-head strong'),
    page: seen('.web-page-picker .select-trigger'),
  }
}

export default run('web-a11y', async ({ page, check, log }) => {
  const cdp = await page.context().newCDPSession(page)
  await page.addInitScript(fakeDisplay)
  try {
    /* --------------------------------------------------------------- forced colours */

    await page.emulateMedia({ forcedColors: 'active' })
    await openWorkspace(page)
    await clearComments(page)
    const forced = await page.evaluate(() => window.matchMedia('(forced-colors: active)').matches)
    check('the browser really is in forced colours', forced === true, String(forced))

    const drawn = await page.evaluate(legible)
    log(`NOTE forced colours: ${JSON.stringify(drawn)}`)
    check('the toolbar is still drawn', !!drawn.review && !!drawn.select && drawn.review.width > 0)
    // The dot is a filled shape rather than text: it is meant to be the colour it inherits.
    const written = Object.entries(drawn).filter(([name]) => name !== 'dot').map(([, item]) => item)
    check('no text is painted in its own background', written.every(item => !item || item.color !== item.background), JSON.stringify(drawn))
    check('the connection state is still a visible mark', !!drawn.dot && drawn.dot.width === 8 && drawn.dot.background !== 'rgba(0, 0, 0, 0)', JSON.stringify(drawn.dot))

    // A pressed tool must not look like an unpressed one when the palette is taken away.
    await page.locator('button[aria-label="Select element"]').click()
    await page.waitForTimeout(300)
    const pressed = await page.evaluate(() => {
      const el = document.querySelector('button[aria-label="Select element"]')
      const style = getComputedStyle(el)
      return { border: style.borderTopColor, borderWidth: style.borderTopWidth, background: style.backgroundColor, outline: style.outlineStyle }
    })
    log(`NOTE pressed tool in forced colours: ${JSON.stringify(pressed)}`)
    check('a pressed tool is told apart by something other than its fill', pressed.borderWidth !== '0px', JSON.stringify(pressed))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    /*
     * The veil over a preview that has not answered has to leave its own words readable. It lives
     * about sixty milliseconds now, which is shorter than a round trip from the container, so the
     * watcher goes in before the reload rather than chasing it afterwards.
     */
    await page.evaluate(() => {
      window.__veil = null
      const tick = () => {
        const notice = document.querySelector('.web-connection-notice')
        const veil = document.querySelector('.web-connection-veil')
        if (notice && veil && !window.__veil) {
          const text = getComputedStyle(notice)
          window.__veil = { color: text.color, background: text.backgroundColor, border: text.borderTopColor, over: getComputedStyle(veil).backgroundColor, words: notice.textContent }
        }
        requestAnimationFrame(tick)
      }
      tick()
    })
    await page.locator('button[aria-label="View options"]').click()
    await page.getByRole('menuitem', { name: 'Reload preview' }).click()
    await settled(page)
    const veil = await page.evaluate(() => window.__veil)
    log(`NOTE the veil in forced colours: ${JSON.stringify(veil)}`)
    check('the status over the preview was shown at all', !!veil, JSON.stringify(veil))
    check('and stayed readable', !!veil && veil.color !== veil.background && veil.over !== 'rgba(0, 0, 0, 0)', JSON.stringify(veil))

    /*
     * A swatch cannot say anything when every colour is forced to the same colour, so it keeps its
     * own — `forced-color-adjust: none`, the treatment the workbench already gives its colour chips
     * — and the hex is written beside it either way. A change is made here to have one to look at.
     */
    await page.locator('button[aria-label="Project controls"]').click()
    await page.waitForTimeout(300)
    const hex = page.locator('.web-inspector__body .color-field__hex').first()
    const restore = await hex.inputValue()
    await hex.fill('#3366cc')
    await hex.press('Enter')
    await page.waitForTimeout(800)
    await page.locator('.web-review-button').click()
    await page.waitForSelector('.web-feedback-review')
    await page.waitForTimeout(400)
    const swatches = await page.evaluate(() => [...document.querySelectorAll('.web-swatch')].map(el => ({ shown: getComputedStyle(el).display, background: getComputedStyle(el).backgroundColor })))
    const values = await page.locator('.web-review-move').allInnerTexts()
    log(`NOTE swatches in forced colours: ${JSON.stringify(swatches)}`)
    check('a swatch that cannot show a colour is not shown', swatches.every(s => s.shown === 'none') || new Set(swatches.map(s => s.background)).size === swatches.length, JSON.stringify(swatches))
    check('the value is written out either way', values.some(v => v.includes('#')), JSON.stringify(values))
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForTimeout(300)

    /* -------------------------------------------- the crop rectangle over a real picture */

    await page.locator('button[aria-label^="Comments"]').click()
    await page.getByRole('button', { name: 'Comment on page' }).click()
    await page.waitForTimeout(400)
    const frame = page.frames().find(f => f.url().includes('127.0.0.1'))
    await frame.evaluate(() => {
      const el = document.querySelector('[data-paramrig-id="hero-title"]')
      const r = el.getBoundingClientRect()
      const at = { bubbles: true, composed: true, button: 0, pointerId: 61, clientX: r.x + 20, clientY: r.y + 12 }
      el.dispatchEvent(new PointerEvent('pointerdown', at))
      el.dispatchEvent(new PointerEvent('pointerup', at))
    })
    await page.waitForSelector('.web-ticket-editor')
    await page.locator('.web-ticket-editor details', { hasText: 'Captures' }).locator('summary').click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Capture screen' }).click()
    await page.waitForSelector('.web-capture-crop', { timeout: 20000 })
    await page.waitForTimeout(400)
    const crop = await page.evaluate(() => {
      const box = getComputedStyle(document.querySelector('.web-crop-box'))
      const grip = getComputedStyle(document.querySelector('.web-crop-handle'), '::before')
      return { edge: box.borderTopColor, fill: box.backgroundColor, grip: grip.backgroundColor, gripBorder: grip.borderTopColor }
    })
    log(`NOTE the crop rectangle in forced colours: ${JSON.stringify(crop)}`)
    check('the crop rectangle keeps a visible edge', crop.edge !== 'rgba(0, 0, 0, 0)' && crop.edge !== crop.fill, JSON.stringify(crop))
    const clear = (colour) => /rgba\(.*,\s*0\)$/.test(colour)
    check('and does not paint over the picture it is cropping', clear(crop.fill), JSON.stringify(crop))
    check('its grips are told apart from its edge', crop.grip !== crop.edge && crop.grip !== 'rgba(0, 0, 0, 0)', JSON.stringify(crop))
    await page.getByRole('button', { name: 'Discard' }).click()
    await page.waitForTimeout(400)
    await clearComments(page)

    // Put the control back where it was; the draft belongs to every window.
    await page.locator('button[aria-label="Project controls"]').click()
    await page.waitForTimeout(300)
    await hex.fill(restore)
    await hex.press('Enter')
    await page.waitForTimeout(800)

    /* ---------------------------------------------------------------- reduced motion */

    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' })
    await openWorkspace(page)
    const still = await page.evaluate(() => {
      const of = (selector) => {
        const el = document.querySelector(selector)
        return el ? getComputedStyle(el).transitionDuration : null
      }
      return { toolbarButton: of('.web-toolbar button'), inspectorHead: of('.web-inspector-head .icon-btn'), section: of('.section__panel') }
    })
    log(`NOTE transitions under reduced motion: ${JSON.stringify(still)}`)
    check('nothing in the workspace animates under reduced motion', Object.values(still).every(value => value === null || /^0s(, 0s)*$/.test(value)), JSON.stringify(still))

    /* ------------------------------------------- the room 200% browser zoom leaves behind */

    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 720, height: 450 })
    await page.waitForFunction(() => window.innerWidth === 720, null, { timeout: 10000 }).catch(() => undefined)
    await openWorkspace(page)
    const zoomed = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      toolbar: document.querySelector('.web-toolbar').scrollWidth - document.querySelector('.web-toolbar').clientWidth,
      dock: !!document.querySelector('.mobile-dock'),
      review: !!document.querySelector('.web-review-button'),
      select: !!document.querySelector('button[aria-label="Select element"]'),
    }))
    log(`NOTE at 720 CSS px, the room 200% zoom leaves in a 1440 window: ${JSON.stringify(zoomed)}`)
    check('nothing overflows sideways with half the room', zoomed.overflow <= 0 && zoomed.toolbar <= 0, JSON.stringify(zoomed))
    check('every control is still reachable', zoomed.review && zoomed.select, JSON.stringify(zoomed))

    /* ---------------------------------------------------------------------- a finger */

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(() => window.innerWidth === 390, null, { timeout: 10000 }).catch(() => undefined)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await openWorkspace(page)
    const coarse = await page.evaluate(() => ({
      coarse: matchMedia('(pointer: coarse)').matches,
      any: matchMedia('(any-pointer: coarse)').matches,
    }))
    check('the page is being touched, not pointed at', coarse.coarse && coarse.any, JSON.stringify(coarse))

    /*
     * Everything a finger can land on, in the bar and in the panel it opens. The workspace's own
     * chrome is what is checked; the shared inspector widgets it hosts — the section titles, the
     * reset marks, the context triggers, the colour chip — belong to the drawing and scene editors
     * too and are only reported here.
     */
    const OWN = '.web-toolbar button, .mobile-dock button, .web-inspector-head button, .web-ticket-list > button, .web-picks button, .web-target-row button, .web-ancestors button, .web-disclosure summary, .web-actions button, .web-comment-pin, .web-markup-toolbar button'
    const SHARED = '.web-inspector .section__title, .web-inspector .field-reset, .web-inspector .context-touch-trigger, .web-inspector .color-swatch'
    /*
     * What answers a finger, rather than what is drawn. Several of these widgets keep a small mark
     * and take their room from a pseudo-element, which `getBoundingClientRect` knows nothing about,
     * so the region is found by asking the page what is under each point around the centre.
     */
    const answering = (selector) => page.evaluate(css => [...document.querySelectorAll(css)]
      .filter(el => { const b = el.getBoundingClientRect(); return b.width > 4 && b.height > 4 && b.top > 0 && b.bottom < innerHeight })
      .map(el => {
        const box = el.getBoundingClientRect()
        const cx = Math.round(box.x + box.width / 2)
        const cy = Math.round(box.y + box.height / 2)
        const hits = (x, y) => { const top = document.elementFromPoint(x, y); return !!top && (top === el || el.contains(top)) }
        const reach = (dx, dy) => { let step = 0; while (step < 40 && hits(cx + dx * (step + 1), cy + dy * (step + 1))) step += 1; return step }
        return {
          label: (el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '').slice(0, 22),
          w: hits(cx, cy) ? reach(-1, 0) + reach(1, 0) + 1 : 0,
          h: hits(cx, cy) ? reach(0, -1) + reach(0, 1) + 1 : 0,
        }
      }), selector)
    const sized = (selector) => page.evaluate(css => [...document.querySelectorAll(css)]
      .filter(el => { const box = el.getBoundingClientRect(); return box.width > 4 && box.height > 4 })
      .map(el => {
        const box = el.getBoundingClientRect()
        return { label: (el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '').slice(0, 22), w: Math.round(box.width), h: Math.round(box.height) }
      }), selector)
    const measure = () => sized(OWN)
    const bar = await measure()
    await page.getByRole('button', { name: 'Inspector', exact: true }).click().catch(() => undefined)
    await page.waitForTimeout(500)
    await page.locator('button[aria-label="Project controls"]').click().catch(() => undefined)
    await page.waitForTimeout(400)
    const controls = await measure()
    const sharedAll = await answering(SHARED)
    await page.locator('button[aria-label^="Comments"]').click().catch(() => undefined)
    await page.waitForTimeout(400)
    const targets = [...bar, ...controls, ...await measure()]
    const small = targets.filter(t => t.h < 44 || t.w < 44)
    log(`NOTE ${targets.length} touch targets in the workspace, ${small.length} under 44 px: ${JSON.stringify(small)}`)
    check('every control of the workspace is at least 44 px under a finger', small.length === 0, JSON.stringify(small))
    const shared = sharedAll.filter(t => t.h < 44 || t.w < 44)
    log(`NOTE ${sharedAll.length} shared inspector widgets, measured by what answers rather than what is drawn: ${JSON.stringify(sharedAll)}`)
    check('the shared inspector widgets answer a finger on 44 px too', shared.length === 0, JSON.stringify(shared))
    await page.getByRole('button', { name: 'Page', exact: true }).click().catch(() => undefined)
    await page.waitForTimeout(400)

    const tap = async (locator) => {
      const box = await locator.boundingBox()
      const at = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at })
      await page.waitForTimeout(40)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(350)
    }
    await tap(page.locator('button[aria-label="Select element"]'))
    check('a tap turns the selection tool on', await page.locator('button[aria-label="Select element"]').getAttribute('aria-pressed') === 'true')
    await tap(page.locator('button[aria-label="Select element"]'))
    check('and a second tap turns it off again', await page.locator('button[aria-label="Select element"]').getAttribute('aria-pressed') === 'false')
    await tap(page.getByRole('button', { name: 'Inspector', exact: true }))
    check('a tap on the dock brings the inspector up', await page.locator('.web-inspector').isVisible())
    // A tooltip must not open under a finger: there is nothing to hover with, and it would sit on
    // top of what the tap is about to do.
    check('no tooltip opens under a finger', await page.getByRole('tooltip').count() === 0)
  } finally {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => undefined)
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' }).catch(() => undefined)
    await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined)
  }
})
