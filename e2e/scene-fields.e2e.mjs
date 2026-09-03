import { run } from './lib.mjs'

/** Chantier 8: the fields of the properties editor, and the outliner's drag. */
export default run('scene-fields', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)
  await page.locator('.scene-properties__tab[aria-label="Object"]').click()
  await page.waitForTimeout(250)

  const cube = async () => (await helpers.scene()).objects.find((object) => object.name === 'Cube')
  const steps = () => page.evaluate(() => document.querySelectorAll('.scene-history__step').length)
  const locationX = page.locator('.scene-axes', { hasText: 'Location' }).locator('input').first()

  // Typing a number.
  await locationX.fill('3')
  await locationX.press('Enter')
  await page.waitForTimeout(400)
  check('a typed number reaches the object', Math.abs((await cube()).transform.position[0] - 3) < 1e-6,
    JSON.stringify((await cube()).transform.position))

  // An expression, and a unit.
  await locationX.fill('1/4')
  await locationX.press('Enter')
  await page.waitForTimeout(400)
  check('a field takes an expression', Math.abs((await cube()).transform.position[0] - 0.25) < 1e-6,
    String((await cube()).transform.position[0]))
  await locationX.fill('40cm')
  await locationX.press('Enter')
  await page.waitForTimeout(400)
  check('and a unit', Math.abs((await cube()).transform.position[0] - 0.4) < 1e-6, String((await cube()).transform.position[0]))

  // Escape restores what was there before the field was focused.
  await locationX.click()
  await locationX.fill('99')
  await locationX.press('Escape')
  await page.waitForTimeout(400)
  check('Escape puts back the value the field started with', Math.abs((await cube()).transform.position[0] - 0.4) < 1e-6,
    String((await cube()).transform.position[0]))

  // One scrub is one history entry, however many frames it took.
  await page.locator('.scene-properties__tab[aria-label="History"]').click()
  await page.waitForTimeout(250)
  const before = await steps()
  await page.locator('.scene-properties__tab[aria-label="Object"]').click()
  await page.waitForTimeout(250)
  const field = await locationX.boundingBox()
  await page.mouse.move(field.x + field.width / 2, field.y + field.height / 2)
  await page.mouse.down()
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(field.x + field.width / 2 + step * 6, field.y + field.height / 2)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(500)
  const scrubbed = (await cube()).transform.position[0]
  check('a scrub moves the value', Math.abs(scrubbed - 0.4) > 0.05, String(scrubbed))
  await page.locator('.scene-properties__tab[aria-label="History"]').click()
  await page.waitForTimeout(300)
  const after = await steps()
  log(`MEASURE history steps around one scrub: ${before} → ${after}`)
  check('and leaves exactly one entry in the history, whatever the frame count', after === before + 1,
    `${before} → ${after}`)

  // The outliner drags one object onto another to parent it.
  const child = page.locator('.scene-outliner__row', { hasText: 'Light' }).first()
  const parent = page.locator('.scene-outliner__row', { hasText: 'Cube' }).first()
  const from = await child.boundingBox()
  const onto = await parent.boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 6, { steps: 3 })
  await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 8 })
  await page.waitForTimeout(150)
  const indicator = await page.locator('.scene-outliner__row[data-drop-edge]').count()
  const hint = await page.locator('.scene-outliner__drop-hint').textContent().catch(() => '')
  check('the drag shows where it would land', indicator >= 1, `${indicator} indicators, hint ${JSON.stringify(hint)}`)
  await page.mouse.up()
  await page.waitForTimeout(500)
  const parented = await helpers.scene()
  const light = parented.objects.find((object) => object.name === 'Light')
  const cubeId = parented.objects.find((object) => object.name === 'Cube').id
  check('and dropping one row on another parents it', light.parentId === cubeId,
    `parentId ${light.parentId ?? 'none'} against ${cubeId}`)

  await shot('scene-fields-1440.png')
})
