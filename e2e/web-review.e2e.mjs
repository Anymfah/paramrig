/*
 * The last step: what the review shows, what leaving a control out of it does to the batch on
 * disk, and what the workspace says once the agent has something to read.
 *
 * Approved batches are immutable and shared, so this script adds its own comment, approves it and
 * then removes what is left of its own draft. It never touches a batch that was already there.
 */
import { run } from './lib.mjs'
import { clearComments, openWorkspace } from './web-lib.mjs'

export default run('web-review', async ({ page, check, log }) => {
  await openWorkspace(page)
  const state = () => page.evaluate(async () => (await (await fetch('/api/web/state', { cache: 'no-store' })).json()))
  const before = await state()
  const comments = page.locator('button[aria-label^="Comments"]')

  // A comment of this script's own, on a real element.
  await comments.click()
  await page.getByRole('button', { name: 'Comment on page' }).click()
  await page.waitForTimeout(400)
  const frame = () => page.frames().find(f => f.url().includes('127.0.0.1'))
  // A note is a whole pointer gesture, not a single event: the SDK sends the mark on the way up.
  await frame().evaluate(() => {
    const el = document.querySelector('[data-paramrig-id="hero-title"]')
    const r = el.getBoundingClientRect()
    const at = { bubbles: true, composed: true, button: 0, pointerId: 31, clientX: r.x + 20, clientY: r.y + 12 }
    el.dispatchEvent(new PointerEvent('pointerdown', at))
    el.dispatchEvent(new PointerEvent('pointerup', at))
  })
  await page.waitForSelector('.web-ticket-editor')
  await page.locator('textarea[aria-label="Comment"]').fill('Give the hero a little more room.')
  await page.waitForTimeout(700)

  // A control change to go with it.
  await page.locator('button[aria-label="Project controls"]').click()
  await page.waitForTimeout(300)

  await page.locator('.web-review-button').click()
  await page.waitForSelector('.web-feedback-review')
  await page.waitForTimeout(400)
  const summary = await page.locator('.web-feedback-review > p').first().innerText()
  log(`NOTE review summary: ${JSON.stringify(summary)}`)
  const swatches = await page.locator('.web-swatch').count()
  const moves = await page.locator('.web-review-move').allInnerTexts()
  log(`NOTE control moves: ${JSON.stringify(moves)}`)
  check('a colour change is shown with its colour', swatches > 0, String(swatches))
  check('a number change is shown with its unit', moves.some(m => /\d+px[\s\S]*→[\s\S]*\d+px/.test(m)), JSON.stringify(moves))
  const ticketLine = await page.locator('.web-review-ticket').first().innerText()
  log(`NOTE comment line: ${JSON.stringify(ticketLine)}`)
  check('a comment says where it came from', ticketLine.includes('Home') && ticketLine.includes('Hero title'), ticketLine)
  check('the button asks to approve', await page.getByRole('button', { name: 'Approve feedback' }).count() === 1)

  // Leave one control out, approve the rest.
  const waiting = async () => Number(await page.locator('.web-count').innerText().catch(() => '0'))
  const before2 = await waiting()
  const dropped = await page.locator('.web-review-change').first().innerText()
  const droppedLabel = dropped.split('\n')[0]
  await page.locator('.web-review-change input').first().uncheck()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Approve feedback' }).click()
  await page.waitForSelector('.web-published', { timeout: 20000 })

  const after = await state()
  const fresh = after.batches.filter(b => !before.batches.some(old => old.id === b.id))
  check('exactly one batch was written', fresh.length === 1, `${fresh.length}`)
  const batch = fresh[0]
  log(`NOTE batch ${batch?.id}: changes ${JSON.stringify(batch?.changes.map(c => c.label))}`)
  check('the comment reached the batch', batch?.tickets.some(t => t.comment === 'Give the hero a little more room.'), JSON.stringify(batch?.tickets.map(t => t.comment)))
  check('the excluded control is not asked for', !batch?.changes.some(c => c.label === droppedLabel), `${droppedLabel} in ${JSON.stringify(batch?.changes.map(c => c.label))}`)
  const excludedParam = batch?.changes.length !== undefined && before.draft.document
    ? Object.keys(before.draft.document.sourceValues).find(id => batch.values[id] !== undefined && JSON.stringify(batch.values[id]) === JSON.stringify(before.draft.document.sourceValues[id]) && !batch.changes.some(c => c.paramId === id))
    : undefined
  check('and its source value is what the batch asks for instead', excludedParam !== undefined, String(excludedParam))
  check('the ticket left the draft as sent', after.draft.document.tickets.every(t => t.status !== 'draft' || t.comment !== 'Give the hero a little more room.'))

  // What the workspace says afterwards.
  const said = await page.locator('.web-published').innerText()
  log(`NOTE after approval:\n${said}`)
  check('it says where the batch was written', said.includes(`.paramrig/batches/${batch?.id}.json`), said.slice(0, 120))
  check('it gives the instruction to hand the agent', said.includes('Read the new approved batch in .paramrig/batches'))
  const selectable = await page.evaluate(() => getComputedStyle(document.querySelector('.web-published code')).userSelect)
  check('the instruction can be selected', selectable === 'text', selectable)
  /*
   * Everything approved leaves the button. The control taken back out stays on it, and stays even
   * when an earlier batch had carried it: the batch just approved asks for its source value, so the
   * override still on screen is something the agent has not been told about. Resting means "nothing
   * unsent", not "nothing changed", which is why what is left is exactly the one withheld.
   */
  const left = await waiting()
  log(`NOTE waiting to be reviewed: ${before2} before, ${left} after`)
  check('what was approved leaves the review button', left === 1, `${before2} → ${left}`)
  await page.getByRole('button', { name: 'Back to comments' }).click()
  await page.waitForTimeout(400)
  const status = await page.locator('.web-ticket-list small').allInnerTexts()
  check('the comment reads as sent rather than as a contract value', status.includes('Sent to agent'), JSON.stringify(status))

  // Clean up this script's own draft; the approved batch stays, as it must.
  check('the script leaves no comment behind', await clearComments(page) === 0)
})
