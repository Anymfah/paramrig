import { run } from './lib.mjs'

/** Chantier 5 and the finish: what the editor tells someone who has never opened it. */
export default run('scene-first-minute', async ({ page, check, log, helpers, shot }) => {
  // The hint is shown once ever, so the memory of having seen it is cleared first.
  await helpers.newScene()
  await page.evaluate(() => localStorage.removeItem('paramrig.scene-hints.v1'))
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  await page.waitForTimeout(300)

  const chip = page.locator('.scene-hints')
  check('a scene nobody has opened before shows the hint', await chip.count() === 1, `${await chip.count()} chips`)
  const text = await chip.textContent()
  check('and the hint names the gestures there is no other way to discover',
    text.includes('orbit') && text.includes('⇧A') && text.includes('F3'), text)
  check('it is announced politely rather than as an alert', await chip.getAttribute('aria-live') === 'polite',
    await chip.getAttribute('aria-live'))
  await shot('scene-first-minute-1440.png')

  // Moving the pointer is not an action; the hint stays.
  const box = await helpers.viewportBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(200)
  check('moving the pointer does not count as an action', await chip.count() === 1)

  // The first real action takes it away.
  await page.locator('#main').focus()
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(500)
  check('the first key takes it away', await page.locator('.scene-hints').count() === 0)

  // And it does not come back, on this or any other scene.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  await page.waitForTimeout(400)
  check('and it does not come back after a reload', await page.locator('.scene-hints').count() === 0)

  // What remains is the affordance that says where the keys are.
  const keymap = page.locator('.scene-hints__keymap')
  check('the status bar keeps a way to the keymap', await keymap.count() === 1, `${await keymap.count()}`)
  await keymap.click()
  await page.waitForSelector('.scene-keymap')
  const sections = await page.locator('.scene-keymap__section h3').allTextContents()
  log(`MEASURE keymap sections: ${sections.join(', ')}`)
  check('and it opens the keymap', sections.length > 3, sections.join(', '))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Escape closes it again', await page.locator('.scene-keymap').count() === 0)
})
