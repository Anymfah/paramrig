/*
 * Two comments, an arrow each. Drawing in the second one used to be able to grab the first one's
 * endpoint — the hit radius is 16 px and every mark on the page answered to it — and the workspace
 * then quietly moved the open comment to the arrow's owner. Measured: an arrow shortened by a
 * second pass that was meant to draw a new one.
 *
 * The drawing is driven inside the frame: the mouse driven over CDP loses its way in a cross-origin
 * frame after a scroll, and everything the SDK reads from a pointer gesture is in the events.
 */
import { run } from './lib.mjs'
import { clearComments, openWorkspace } from './web-lib.mjs'

const gesture = ([selector, from, to, id]) => {
  const el = document.querySelector(selector)
  const box = el.getBoundingClientRect()
  const at = (p) => ({ clientX: box.x + box.width * p[0], clientY: box.y + box.height * p[1] })
  const fire = (kind, p) => el.dispatchEvent(new PointerEvent(kind, { bubbles: true, composed: true, button: 0, pointerId: id, ...at(p) }))
  fire('pointerdown', from)
  fire('pointermove', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2])
  fire('pointermove', to)
  fire('pointerup', to)
}

export default run('web-marks', async ({ page, check, log }) => {
  await openWorkspace(page)
  const frame = () => page.frames().find(f => f.url().includes('127.0.0.1'))
  const draft = () => page.evaluate(async () => (await (await fetch('/api/web/state', { cache: 'no-store' })).json()).draft.document)

  const comments = page.locator('button[aria-label^="Comments"]')
  const newComment = async () => {
    await comments.click()
    await page.getByRole('button', { name: 'Comment on page' }).click()
    await page.waitForTimeout(400)
    // The note tool wants a click in the page to place the comment.
    await frame().evaluate(gesture, ['[data-paramrig-id="hero-title"]', [.1, .5], [.1, .5], 11])
    await page.waitForSelector('.web-ticket-editor')
    await page.waitForTimeout(500)
  }
  const drawArrow = async (from, to, id) => {
    await page.getByRole('button', { name: 'Draw', exact: true }).click()
    await page.waitForSelector('.web-markup-toolbar')
    await page.waitForTimeout(300)
    await frame().evaluate(gesture, ['[data-paramrig-id="hero-title"]', from, to, id])
    await page.waitForTimeout(600)
    await page.locator('button[aria-label="Finish drawing"]').click()
    await page.waitForTimeout(400)
  }

  await newComment()
  await page.locator('textarea[aria-label="Comment"]').fill('First')
  await drawArrow([.1, .2], [.6, .8], 21)
  const afterFirst = await draft()
  const one = afterFirst.tickets.find(t => t.comment === 'First')
  check('the first comment holds one arrow', one?.marks.filter(m => m.tool === 'arrow').length === 1, JSON.stringify(one?.marks.map(m => m.tool)))
  const before = JSON.stringify(one.marks.find(m => m.tool === 'arrow').points)

  await newComment()
  await page.locator('textarea[aria-label="Comment"]').fill('Second')
  // Start the second arrow exactly on the first one's endpoint. Under the old hit test this
  // grabbed it; now it has to draw a new mark and leave the other comment alone.
  await drawArrow([.1, .2], [.9, .3], 22)
  const after = await draft()
  const first = after.tickets.find(t => t.comment === 'First')
  const second = after.tickets.find(t => t.comment === 'Second')
  const arrows = (t) => t?.marks.filter(m => m.tool === 'arrow') ?? []
  log(`NOTE first ${JSON.stringify(arrows(first).map(m => m.points))} second ${JSON.stringify(arrows(second).map(m => m.points))}`)
  check('drawing in one comment leaves the other comment alone', JSON.stringify(arrows(first)[0]?.points) === before, `${before} → ${JSON.stringify(arrows(first)[0]?.points)}`)
  check('and the second comment gets an arrow of its own', arrows(second).length === 1, JSON.stringify(arrows(second).map(m => m.points)))
  check('the two arrows are different marks', arrows(first)[0]?.id !== arrows(second)[0]?.id)

  // The numbers hold: the list, the bubble and the heading agree, and stay put.
  await comments.click()
  await page.waitForTimeout(400)
  const listed = await page.locator('.web-list-number').allInnerTexts()
  const pins = await page.locator('.web-comment-pin span').allInnerTexts()
  log(`NOTE numbers: list ${JSON.stringify(listed)} bubbles ${JSON.stringify(pins)}`)
  check('the list and the bubbles agree on the numbers', JSON.stringify(listed) === JSON.stringify(pins), `${JSON.stringify(listed)} vs ${JSON.stringify(pins)}`)

  // Review leaves the page: the selection tool is no longer pressed.
  await page.locator('.web-review-button').click()
  await page.waitForSelector('.web-feedback-review')
  const pressed = await page.locator('button[aria-label="Select element"]').getAttribute('aria-pressed')
  check('entering review lets go of the selection tool', pressed === 'false', String(pressed))
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.waitForTimeout(400)

  // The drawing tool has a glyph of its own rather than the one the size menu uses.
  await comments.click()
  await page.locator('.web-ticket-list button').first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Draw', exact: true }).click()
  await page.waitForSelector('.web-markup-toolbar')
  const glyphs = await page.evaluate(() => {
    const path = (selector) => document.querySelector(selector)?.querySelector('svg')?.innerHTML ?? null
    return { pageDraw: path('.web-markup-toolbar button[aria-label="Draw on page"]'), size: path('.web-size-trigger') }
  })
  check('Draw on page no longer wears the size menu glyph', glyphs.pageDraw !== null && glyphs.pageDraw !== glyphs.size)
  const tip = await page.locator('button[aria-label="Draw on page"]').hover().then(async () => { await page.waitForTimeout(400); return page.getByRole('tooltip').innerText() }).catch(() => '')
  check('and says what it changes', tip === 'Draw in page coordinates', tip)
  await page.locator('button[aria-label="Finish drawing"]').click()

  // The comments this script made go away again; the shared draft belongs to everyone.
  check('the script leaves no comment behind', await clearComments(page) === 0)
})
