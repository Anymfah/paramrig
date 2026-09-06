/*
 * Screen capture, as far as a headless browser can go.
 *
 * Prompt 1 left this untested because `getDisplayMedia` has no headless equivalent and no synthetic
 * replacement. That is true of the permission and the picker; it is not true of everything behind
 * them. Only `getDisplayMedia` is replaced here — with a real `MediaStream` from a canvas — so the
 * video element, `requestVideoFrameCallback`, the frame drawn to a canvas, the track being stopped,
 * the crop, the PNG, the upload and the file on disk all run for real. What remains untested is the
 * browser's own picker and a person choosing a surface in it.
 */
import { run } from './lib.mjs'
import { clearComments, fakeDisplay, openWorkspace } from './web-lib.mjs'

export default run('web-capture', async ({ page, check, log }) => {
  await page.addInitScript(fakeDisplay)
  await openWorkspace(page)
  await clearComments(page)
  const state = () => page.evaluate(async () => (await (await fetch('/api/web/state', { cache: 'no-store' })).json()))

  // A comment to hang the capture on.
  await page.getByRole('button', { name: 'Comment on page' }).click()
  await page.waitForTimeout(400)
  const frame = () => page.frames().find(f => f.url().includes('127.0.0.1'))
  await frame().evaluate(() => {
    const el = document.querySelector('[data-paramrig-id="hero-title"]')
    const r = el.getBoundingClientRect()
    const at = { bubbles: true, composed: true, button: 0, pointerId: 51, clientX: r.x + 20, clientY: r.y + 12 }
    el.dispatchEvent(new PointerEvent('pointerdown', at))
    el.dispatchEvent(new PointerEvent('pointerup', at))
  })
  await page.waitForSelector('.web-ticket-editor')
  await page.locator('textarea[aria-label="Comment"]').fill('The hero looks cramped on my screen.')
  await page.waitForTimeout(700)

  const captures = page.locator('.web-ticket-editor details', { hasText: 'Captures' })
  await captures.locator('summary').click()
  await page.waitForTimeout(300)

  /* ------------------------------------------------- sharing declined leaves the work intact */

  await page.evaluate(() => { window.__display.deny = true })
  await page.getByRole('button', { name: 'Capture screen' }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.web-inspector__body .status-msg')].some(el => el.textContent.includes('declined')), null, { timeout: 15000 }).catch(() => undefined)
  // …and it is still there a couple of seconds later, once the background saves have run.
  await page.waitForTimeout(2500)
  const refused = await page.locator('.web-inspector__body .status-msg').allInnerTexts()
  log(`NOTE after declining: ${JSON.stringify(refused)}`)
  check('declining says so, and the reason is still there a moment later', refused.some(t => t.includes('declined') && t.includes('preserved')), JSON.stringify(refused))
  check('and nothing was cropped', await page.locator('.web-capture-crop').count() === 0)
  check('the comment is still there', await page.locator('textarea[aria-label="Comment"]').inputValue() === 'The hero looks cramped on my screen.')

  /* ------------------------------------------------------------------- and then accepted */

  await page.evaluate(() => { window.__display.deny = false })
  await page.getByRole('button', { name: 'Capture screen' }).click()
  await page.waitForSelector('.web-capture-crop', { timeout: 20000 })
  await page.waitForTimeout(400)
  const grabbed = await page.evaluate(() => {
    const image = document.querySelector('.web-capture-crop img')
    return { png: image.src.startsWith('data:image/png;base64,'), length: image.src.length, stopped: window.__display.stopped, calls: window.__display.calls }
  })
  log(`NOTE grabbed: ${JSON.stringify(grabbed)}`)
  check('a real frame comes back as a PNG', grabbed.png && grabbed.length > 2000, JSON.stringify(grabbed))
  check('the sharing stream is stopped once the frame is taken', grabbed.stopped >= 1, String(grabbed.stopped))

  // Crop it with the rectangle rather than the fields.
  const box = await page.locator('.web-capture-crop').boundingBox()
  const handle = page.locator('button[aria-label="Bottom right edge"]')
  const grip = await handle.boundingBox()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const cropped = await page.evaluate(() => {
    const el = document.querySelector('.web-crop-box')
    return { width: el.style.width, height: el.style.height }
  })
  log(`NOTE crop after dragging the corner: ${JSON.stringify(cropped)}`)
  check('dragging a grip really moves the crop', parseFloat(cropped.width) < 70 && parseFloat(cropped.height) < 70, JSON.stringify(cropped))

  const before = await state()
  await page.getByRole('button', { name: 'Save capture' }).click()
  // The comment already carries the DOM capture taken when it was created; the screen one is named
  // as such, and the fold it lives in is open, because keeping it is what the person just did.
  await page.waitForSelector('.web-capture img[alt="Screen capture"]', { state: 'visible', timeout: 20000 })
  await page.waitForTimeout(1200)
  const kept = await page.evaluate(() => {
    const image = document.querySelector('.web-capture img[alt="Screen capture"]')
    return { src: image?.getAttribute('src') ?? null, caption: image?.closest('.web-capture')?.querySelector('figcaption')?.textContent ?? null }
  })
  log(`NOTE kept: ${JSON.stringify(kept)}`)
  check('the cropped frame is attached to the comment', kept.src?.startsWith('/api/web/captures/'), JSON.stringify(kept))
  check('and it is labelled as a screen capture', kept.caption === 'Screen capture', String(kept.caption))
  check('the fold it landed in is open, so the person sees what they kept', await page.locator('.web-ticket-editor details[open]', { hasText: 'Captures' }).count() === 1)

  // The bytes reached the project, and the service will serve them back.
  const file = kept.src?.replace('/api/web/', '')
  const served = await page.evaluate(async src => {
    const response = await fetch(src, { cache: 'no-store' })
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { ok: response.ok, type: response.headers.get('content-type'), size: bytes.length, png: [...bytes.slice(0, 4)].join(',') }
  }, kept.src)
  log(`NOTE served back: ${JSON.stringify(served)}`)
  check('the capture is a PNG on disk that the service serves back', served.ok && served.type === 'image/png' && served.png === '137,80,78,71', JSON.stringify(served))

  const after = await state()
  const ticket = after.draft.document.tickets.find(t => t.comment === 'The hero looks cramped on my screen.')
  const screen = ticket?.captures.filter(c => c.kind === 'screen') ?? []
  check('the draft records the capture without carrying its bytes', screen.length === 1 && !!screen[0]?.file && !screen[0]?.dataUrl, JSON.stringify(screen.map(c => ({ kind: c.kind, file: c.file, dataUrl: !!c.dataUrl }))))
  check('a DOM capture was taken automatically as well', (ticket?.captures.filter(c => c.kind === 'dom').length ?? 0) >= 1, JSON.stringify(ticket?.captures.map(c => c.kind)))
  check('the state the service reports gained exactly this capture', after.draft.revision > before.draft.revision)
  check('taking a screen capture leaves the preview alone', await page.locator('button[aria-label="Select element"]').getAttribute('aria-pressed') === 'false')
  log(`NOTE capture file: ${file}`)

  check('the script leaves no comment behind', await clearComments(page) === 0)
})
