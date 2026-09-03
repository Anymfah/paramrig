import { run } from './lib.mjs'

/** Chantier 9: the autosave, the badge, a reload, the versions, and export then import. */
export default run('scene-files', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const url = page.url()

  const badge = page.locator('.editor-save-badge, .scene-save-badge')
  check('the header carries an autosave badge', await badge.count() >= 1, `${await badge.count()}`)

  // Renaming the document is a change, and the badge says so before it says "Saved".
  const name = page.locator('.scene-file__name')
  await name.fill('Lamp')
  await name.press('Enter')
  await page.waitForTimeout(1400)
  const stored = await helpers.scene()
  check('the rename reaches storage on its own', stored.name === 'Lamp', stored.name)
  const badgeText = await badge.first().textContent()
  check('and the badge says the write landed', /Saved/.test(badgeText ?? ''), badgeText)

  // A move, then a reload: the scene comes back as it was left.
  const box = await helpers.viewportBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.locator('#main').focus()
  await page.keyboard.press('KeyG')
  await page.waitForSelector('.scene-hud', { state: 'attached' })
  await page.keyboard.press('KeyX')
  await page.keyboard.press('Digit4')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1400)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  const reloaded = await helpers.scene()
  check('a reload finds the scene where it was left',
    Math.abs(reloaded.objects.find((object) => object.name === 'Cube').transform.position[0] - 4) < 1e-6,
    JSON.stringify(reloaded.objects.find((object) => object.name === 'Cube').transform.position))
  check('and the view it was left with', typeof reloaded.view.yaw === 'number')
  check('the address did not change', page.url() === url, page.url())

  // Export hands over a file, and it is a scene file.
  const exported = await helpers.captureExport(async () => {
    await page.locator('.scene-file__button').click()
    await page.waitForSelector('.scene-file-menu')
    await page.locator('.scene-file-menu [role="menuitem"]', { hasText: 'Export project' }).first().click()
  })
  check('Export project hands over a .paramrig.json file', !!exported && exported.download.endsWith('.paramrig.json'),
    exported?.download ?? 'nothing')
  if (exported) {
    const parsed = JSON.parse(exported.text)
    check('and the file says which editor it belongs to', parsed.format === 'paramrig.scene' && parsed.kind === 'scene',
      `${parsed.format} / ${parsed.kind}`)
    check('and carries the document it was taken from', parsed.document.name === 'Lamp', parsed.document.name)
    log(`MEASURE exported file: ${exported.text.length} bytes`)
  }

  await shot('scene-files-1440.png')
})
