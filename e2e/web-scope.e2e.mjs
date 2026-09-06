/*
 * What a section of controls is called, and how far it says it reaches. The titles used to be
 * replaced by the reach — "ALL INSTANCES", "FROM STORY CARD · ALL INSTANCES", "CONTROLS" — and
 * "Global" was repeated on every section of a panel where everything was global.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { run, BASE, OUTPUT } from './lib.mjs'

export default run('web-scope', async ({ page, check, log, shot }) => {
  mkdirSync(join(OUTPUT, 'web-scope'), { recursive: true })
  await page.goto(`${BASE}/web`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Open project' }).click()
  await page.waitForSelector('.web-toolbar')
  await page.waitForFunction(() => document.querySelectorAll('.web-connection-notice').length === 0, null, { timeout: 30000 })

  const sections = () => page.evaluate(() => [...document.querySelectorAll('.web-inspector__body .section__title')].map(title => ({
    name: title.querySelector('span:not(.web-section-scope)')?.textContent ?? '',
    badge: title.querySelector('.web-section-scope')?.textContent ?? null,
  })))

  // Project controls: every section is global, so nothing says so.
  const project = await sections()
  log(`NOTE project controls: ${JSON.stringify(project)}`)
  check('project sections are named after their group', project.map(s => s.name).join(' | ') === 'Identity | Page rhythm', JSON.stringify(project))
  check('a panel that is global throughout does not say so on each section', project.every(s => s.badge === null), JSON.stringify(project))

  // A repeated component: the group keeps its name, the reach is a badge.
  const frame = () => page.frames().find(f => f.url().includes('127.0.0.1'))
  await page.locator('button[aria-label="Select element"]').click()
  await page.waitForTimeout(200)
  await frame().evaluate(() => {
    const el = document.querySelector('[data-paramrig-id="story-card"]')
    const r = el.getBoundingClientRect()
    el.scrollIntoView({ block: 'center' })
    const after = el.getBoundingClientRect()
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, pointerId: 9, clientX: after.x + 8, clientY: after.y + 8, screenX: r.x }))
  })
  await page.waitForTimeout(700)
  const card = await sections()
  const heading = await page.locator('.web-inspector-head strong').innerText()
  log(`NOTE card selected: head ${JSON.stringify(heading)} sections ${JSON.stringify(card)}`)
  check('the inspector is headed with the element', heading === 'Story card', heading)
  check('the section keeps the group name', card.some(s => s.name === 'Selected element'), JSON.stringify(card))
  check('the reach is a badge, not the title', card.some(s => s.badge === 'All instances'), JSON.stringify(card))
  await shot('web-scope/card-selected-1440.png')

  // The comment action lives in the inspector head, not over the page.
  check('nothing floats over the selected element', await page.locator('.web-quick-comment').count() === 0)
  const comment = page.locator('button[aria-label="Comment on selection"]')
  check('the inspector head offers the comment instead', await comment.count() === 1)
  await comment.hover()
  await page.waitForTimeout(400)
  const tip = await page.getByRole('tooltip').innerText().catch(() => '')
  check('and its tooltip carries the shortcut', tip === 'Comment · C', tip)

  // The hierarchy reads as a path.
  const crumbs = await page.locator('.web-ancestors button, .web-crumb').allInnerTexts()
  log(`NOTE hierarchy: ${JSON.stringify(crumbs)}`)
  check('the ancestors read as a path ending on the selection', crumbs.at(-1) === 'Story card' && crumbs.length >= 2, JSON.stringify(crumbs))
  check('the path never shows a raw tag', crumbs.every(c => c !== 'div' && c !== 'body'), JSON.stringify(crumbs))

  await page.keyboard.press('Escape')
})
