/*
 * Hover, selection and the empty panel. Selecting the hero's kicker used to answer with an empty
 * inspector and two chips reading "hero" and "page" — nothing said that Title size, Title text and
 * Corner radius existed anywhere on the page.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { run, OUTPUT } from './lib.mjs'
import { mouseReach, openWorkspace, pointInFrame } from './web-lib.mjs'

export default run('web-select', async ({ page, check, log, shot }) => {
  mkdirSync(join(OUTPUT, 'web-select'), { recursive: true })
  await openWorkspace(page)

  /*
   * The mouse driven over CDP reaches the top of a cross-origin frame and then loses its way after
   * a scroll, so pointer work is dispatched inside the frame itself. Everything the SDK reads from
   * a pointer event is carried in the event.
   */
  const frame = () => page.frames().find(f => f.url().includes('127.0.0.1'))
  const dispatch = (selector, type, init = {}) => frame().evaluate(([sel, kind, extra]) => {
    const el = document.querySelector(sel)
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new PointerEvent(kind, { bubbles: true, composed: true, button: 0, pointerId: 9, clientX: r.x + r.width / 2, clientY: r.y + Math.min(12, r.height / 2), ...extra }))
  }, [selector, type, init])
  const hoverWord = () => frame().evaluate(() => document.querySelector('paramrig-overlay')?.dataset.hover ?? null)

  await page.locator('button[aria-label="Select element"]').click()
  await page.waitForTimeout(200)

  // The outline names what it is around, and says how many controls reach it.
  await dispatch('[data-paramrig-id="hero-title"]', 'pointermove')
  await page.waitForTimeout(300)
  const onTitle = await hoverWord()
  log(`NOTE hover caption: ${JSON.stringify(onTitle)}`)
  check('the hover outline names the element and counts its controls', onTitle === 'Hero title · 2 controls', String(onTitle))
  await dispatch('.fn-hero .fn-kicker', 'pointermove')
  await page.waitForTimeout(300)
  check('an element without controls is named without a count', await hoverWord() === 'A journal for a slower pace', String(await hoverWord()))

  // The pointer leaving the page takes the outline with it.
  await frame().evaluate(() => window.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })))
  await page.waitForTimeout(300)
  check('the outline leaves with the pointer', await hoverWord() === null, String(await hoverWord()))

  // A selection with no controls of its own says where the controls are.
  await dispatch('.fn-hero .fn-kicker', 'pointerdown')
  await page.waitForTimeout(600)
  const title = await page.locator('.web-inspector-head strong').innerText()
  check('the inspector is headed with the element, not a raw identifier', title === 'A journal for a slower pace', title)
  check('it says the element carries no control', await page.locator('.web-no-controls').innerText().then(t => t.includes('No controls on this element')))
  const picks = await page.locator('.web-picks button').allInnerTexts()
  log(`NOTE offered instead: ${JSON.stringify(picks)}`)
  check('the ancestors that do carry controls are offered', picks.some(p => p.includes('Hero title') && p.includes('2 controls')), JSON.stringify(picks))
  check('so are the other instrumented elements of the page', picks.some(p => p.includes('Story card')), JSON.stringify(picks))
  await shot('web-select/kicker-selected-1440.png')

  // …and choosing one selects it and fills the inspector.
  await page.locator('.web-picks button', { hasText: 'Hero title' }).first().click()
  await page.waitForTimeout(700)
  const filled = await page.locator('.web-inspector-head strong').innerText()
  const controls = await page.locator('.web-inspector__body .field__label, .web-inspector__body label').allInnerTexts()
  check('choosing an offered element selects it', filled === 'Hero title', filled)
  check('and its controls arrive', controls.join(' ').includes('Title size'), JSON.stringify(controls.slice(0, 6)))

  // With nothing selected the same list is one fold away.
  await page.locator('button[aria-label="Project controls"]').click()
  await page.waitForTimeout(400)
  const fold = page.locator('.web-inspector__body details', { hasText: 'On this page' })
  check('the page list is offered, folded, in the project controls', await fold.count() === 1)
  await fold.locator('summary').click()
  await page.waitForTimeout(300)
  const folded = await page.locator('.web-picks button').allInnerTexts()
  check('and it holds the same elements', folded.some(p => p.includes('Hero title')), JSON.stringify(folded))

  /*
   * A real mouse, not a dispatched event. It reaches as far down the page as the browser's real
   * window goes — see `mouseReach`, and the harness makes sure that window is bigger than the
   * viewport the scripts emulate — so the whole preview answers, including below the fold.
   */
  await page.locator('button[aria-label="Project controls"]').click()
  await page.waitForTimeout(300)
  const at = await pointInFrame(page, '[data-paramrig-id="hero-title"]')
  const reach = await mouseReach(page)
  log(`NOTE a real mouse reaches about ${reach} px down the page; the click is at y ${Math.round(at.y)}`)
  await page.mouse.move(at.x, at.y)
  await page.waitForTimeout(120)
  const hovered = await frame().evaluate(() => document.querySelector('paramrig-overlay')?.dataset.hover ?? null)
  check('a real mouse moving over the preview lights the outline', hovered === 'Hero title · 2 controls', String(hovered))
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(700)
  check('and a real click selects what is under it', await page.locator('.web-inspector-head strong').innerText() === 'Hero title')

  // …and below the fold, which is where the mouse used to stop. The frame is scrolled to its foot
  // rather than by a fixed amount, so the point is computed from a rect past that scroll and the
  // check does not depend on how tall the example page happens to be this month.
  await frame().evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(500)
  // Whichever instrumented element sits lowest in the frame: the point of the check is the region
  // a real click used to miss, which was everything past about 540 px down the page.
  const lowest = await frame().evaluate(() => [...document.querySelectorAll('[data-paramrig-id]')]
    .map(el => ({ el, id: el.getAttribute('data-paramrig-id'), instance: el.getAttribute('data-paramrig-instance'), y: el.getBoundingClientRect().y, h: el.getBoundingClientRect().height }))
    .filter(item => item.h > 16 && item.y + item.h < innerHeight)
    // A rect is not a target: an element scrolled out of its own overflow container still reports
    // one, and a click there lands on whatever is really painted at that point.
    .filter(item => { const r = item.el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === item.el || item.el.contains(hit) })
    .sort((a, b) => b.y - a.y)
    .map(({ id, instance, y, h }) => ({ id, instance, y, h }))[0])
  const selector = lowest.instance ? `[data-paramrig-id="${lowest.id}"][data-paramrig-instance="${lowest.instance}"]` : `[data-paramrig-id="${lowest.id}"]`
  const low = await pointInFrame(page, selector)
  log(`NOTE the low click is on ${selector} at y ${Math.round(low.y)}, ${Math.round(low.y) < reach ? 'within' : 'beyond'} the reach`)
  await page.mouse.move(low.x, low.y)
  await page.waitForTimeout(120)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(700)
  const picked = await page.locator('.web-inspector-head strong').innerText()
  /*
   * 540 px is not a round number: it is where a real click used to stop being heard, walked at 40 px
   * steps and recorded in the prompt 1 report. The check is that the point is past it and that what
   * was under the pointer is what got selected — not that the example page is any particular height.
   */
  const OLD_DEAD_ZONE = 540
  check('a real click far down the preview selects too', Math.round(low.y) > OLD_DEAD_ZONE && picked !== 'Hero title' && picked !== 'Project controls', `${Math.round(low.y)} px down, past ${OLD_DEAD_ZONE}, selected ${JSON.stringify(picked)}`)
  await frame().evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)

  // Nothing is left selected for the scripts that follow.
  await page.keyboard.press('Escape')
})
