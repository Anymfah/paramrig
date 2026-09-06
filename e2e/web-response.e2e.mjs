/*
 * The other half of the round trip: an agent answers.
 *
 * Prompt 1 left this unchecked — `session.response()` was covered by unit tests with a synthetic
 * response, and no file had ever been dropped into `.paramrig/responses/` while the workspace was
 * watching. This writes them, exactly as an agent would, and follows what the workspace does: two
 * comments in one batch answered one way each, a correction looked at and validated, a question
 * left open, and three responses that must be refused with a reason rather than acted on.
 *
 * The batch it answers is one this script makes. Approved batches are immutable, so the ones
 * already on disk are left alone; the response files this script writes are its own and go away
 * with it.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from './lib.mjs'
import { clearComments, openWorkspace } from './web-lib.mjs'

const RESPONSES = '/workspace/.local/web/.paramrig/responses'

export default run('web-response', async ({ page, check, log }) => {
  mkdirSync(RESPONSES, { recursive: true })
  const written = []
  const respond = (id, value) => {
    written.push(id)
    writeFileSync(join(RESPONSES, `${id}.json`), `${JSON.stringify({ ...value, id }, null, 2)}\n`)
  }
  const state = () => page.evaluate(async () => (await (await fetch('/api/web/state', { cache: 'no-store' })).json()))
  const frame = () => page.frames().find(f => f.url().includes('127.0.0.1'))
  const openComment = async (text) => {
    await page.locator('button[aria-label^="Comments"]').click()
    await page.waitForTimeout(300)
    await page.locator('.web-ticket-list button', { hasText: text.slice(0, 24) }).first().click()
    await page.waitForSelector('.web-ticket-editor')
    await page.waitForTimeout(400)
  }
  const ticketStatus = () => page.locator('.web-ticket-editor .web-scope').innerText()

  try {
    await openWorkspace(page)
    await clearComments(page)

    // Two comments of this script's own, on real elements, approved together.
    const write = async (target, text, pointerId) => {
      await page.locator('button[aria-label^="Comments"]').click()
      await page.getByRole('button', { name: 'Comment on page' }).click()
      await page.waitForTimeout(400)
      await frame().evaluate(([selector, id]) => {
        const el = document.querySelector(selector)
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        const at = { bubbles: true, composed: true, button: 0, pointerId: id, clientX: r.x + 20, clientY: r.y + 12 }
        el.dispatchEvent(new PointerEvent('pointerdown', at))
        el.dispatchEvent(new PointerEvent('pointerup', at))
      }, [target, pointerId])
      await page.waitForSelector('.web-ticket-editor')
      await page.locator('textarea[aria-label="Comment"]').fill(text)
      await page.waitForTimeout(700)
    }
    const ROOM = 'Give the hero more room above the title.'
    const RADIUS = 'Soften the corners of the story cards.'
    await write('[data-paramrig-id="hero-title"]', ROOM, 41)
    await write('[data-paramrig-id="story-card"]', RADIUS, 42)

    const before = await state()
    await page.locator('.web-review-button').click()
    await page.waitForSelector('.web-feedback-review')
    await page.getByRole('button', { name: 'Approve feedback' }).click()
    await page.waitForSelector('.web-published', { timeout: 20000 })
    await page.getByRole('button', { name: 'Back to comments' }).click()
    await page.waitForTimeout(600)

    const after = await state()
    const batch = after.batches.find(b => !before.batches.some(old => old.id === b.id))
    const room = batch?.tickets.find(t => t.comment === ROOM)
    const radius = batch?.tickets.find(t => t.comment === RADIUS)
    check('both comments were approved into one batch', !!room && !!radius, JSON.stringify(batch?.tickets.map(t => t.comment)))
    if (!batch || !room || !radius) return

    const base = { version: 1, projectId: batch.projectId, batchId: batch.id, sourceRevision: batch.sourceRevision, createdAt: new Date().toISOString() }
    const revision = after.manifest.revision
    const stamp = Date.now().toString(36)

    /* ---------------------------------------------- responses the workspace must not act on */

    respond(`qa-stale-${stamp}`, { ...base, resultRevision: 'study-0', summary: 'Applied against an older source.', tickets: [{ id: room.id, status: 'implemented', message: 'Should not arrive.' }] })
    respond(`qa-orphan-${stamp}`, { ...base, batchId: 'a-batch-that-never-existed', resultRevision: revision, summary: 'No such batch.', tickets: [] })
    respond(`qa-outsider-${stamp}`, { ...base, resultRevision: revision, summary: 'Names a ticket from somewhere else.', tickets: [{ id: 'a-ticket-that-is-not-in-it', status: 'implemented', message: 'Should not arrive.' }] })
    await page.waitForFunction(() => document.querySelectorAll('.web-inspector__body .status-msg').length >= 3, null, { timeout: 20000 }).catch(() => undefined)
    await page.waitForTimeout(1200)
    const notes = await page.locator('.web-inspector__body .status-msg').allInnerTexts()
    log(`NOTE notes after three refused responses: ${JSON.stringify(notes)}`)
    check('a response from another revision is refused with a reason', notes.some(n => n.includes('another source revision')), JSON.stringify(notes))
    check('a response naming no batch is refused with a reason', notes.some(n => n.includes('no matching feedback batch')), JSON.stringify(notes))
    check('a response naming a ticket outside its batch is refused', notes.some(n => n.includes('outside its feedback batch')), JSON.stringify(notes))
    const untouched = await page.locator('.web-ticket-list small').allInnerTexts()
    check('none of them moved a comment', untouched.length === 2 && untouched.every(s => s === 'Sent to agent'), JSON.stringify(untouched))

    /* ------------------------------------------------------ one response, two answers in it */

    respond(`qa-answer-${stamp}`, {
      ...base,
      resultRevision: revision,
      summary: 'Raised the hero spacing; the card radius needs a decision.',
      tickets: [
        { id: room.id, status: 'implemented', message: 'Added 24px above the title. Check it at 390 px as well.' },
        { id: radius.id, status: 'needs-info', message: 'Every card, or only the ones in the journal?' },
      ],
    })
    await page.waitForFunction(() => {
      const words = [...document.querySelectorAll('.web-ticket-list small')].map(el => el.textContent)
      return words.includes('Ready for review') && words.includes('Needs clarification')
    }, null, { timeout: 20000 })
    check('one response can answer each comment its own way', true)

    await openComment(ROOM)
    const message = await page.locator('.web-response').innerText()
    log(`NOTE the agent said: ${JSON.stringify(message)}`)
    check("the agent's message is shown with the comment", message.includes('Added 24px above the title'), message)
    const banner = await page.locator('.web-context-action').innerText().catch(() => '')
    check('opening it shows the source result rather than the local overrides', banner.includes('Source result'), banner)
    const validate = page.getByRole('button', { name: 'Validate correction' })
    check('the correction can be validated', await validate.count() === 1 && await validate.isEnabled())
    await validate.click()
    await page.waitForTimeout(800)
    check('validating closes the comment', await ticketStatus() === 'Validated', await ticketStatus())
    /*
     * Its own pin, not every pin. A pin is drawn for a comment that is neither validated nor
     * scrolled out of view, so counting them all passes or fails on where the preview happens to
     * be sitting — which it did, silently, until the example page's rhythm changed. The comment
     * that was validated is the one that has to go, and the one still waiting has to stay.
     */
    check('and a validated comment leaves the page', await page.getByRole('button', { name: 'Open comment 1' }).count() === 0)
    check('while the comment still waiting keeps its pin', await page.getByRole('button', { name: 'Open comment 2' }).count() === 1)

    await openComment(RADIUS)
    check('a needs-info answer asks rather than closes', await ticketStatus() === 'Needs clarification', await ticketStatus())
    const question = await page.locator('.web-response').innerText()
    check('and the question is shown with the comment', question.includes('only the ones in the journal'), question)

    /* -------------------------------------------- a comment reopened is no longer that batch's */

    await page.getByRole('button', { name: 'Reopen' }).click()
    await page.waitForTimeout(700)
    check('reopening puts the comment back in the draft', await ticketStatus() === 'Draft', await ticketStatus())
    respond(`qa-late-${stamp}`, { ...base, resultRevision: revision, summary: 'Answering the batch again.', tickets: [{ id: radius.id, status: 'implemented', message: 'Should not reach a reopened comment.' }] })
    await page.waitForTimeout(3000)
    check('a later answer to the batch it left does not reach it', await ticketStatus() === 'Draft', await ticketStatus())
    check('and the comment keeps no stale answer on it', await page.locator('.web-response').count() === 0)
  } finally {
    for (const id of written) rmSync(join(RESPONSES, `${id}.json`), { force: true })
    await page.locator('button[aria-label^="Comments"]').click().catch(() => undefined)
    await page.waitForTimeout(400)
    check('the script leaves no comment behind', await clearComments(page) === 0)
  }
})
