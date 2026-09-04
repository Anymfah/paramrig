import { run } from './lib.mjs'

/**
 * Chantier M3: making a rig with the mouse rather than by seeding one.
 *
 * The point of the diamond is that nobody should ever edit a rig by hand, so this walks the whole
 * of it through the interface — press ◇ on a field, name the control, find it in the Controls tab,
 * turn it, watch the scene move, then unbind it. Nothing here writes to the document but the editor.
 */
export default run('scene-expose', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })

  await page.locator('.scene-outliner__row', { hasText: 'Cube' }).first().click()
  await page.locator('.scene-properties__tab[aria-label="Object"]').click()
  await page.waitForSelector('.scene-section[data-section="object-transform"]', { timeout: 10000 })

  /* --------------------------------------------------------- exposing a field */

  const diamonds = await page.locator('.scene-exposable .scene-expose').count()
  check('every field of the Object tab that can be driven carries a diamond',
    diamonds >= 9, `${diamonds} diamonds`)

  // Location Z: the third field of the first axes row of the transform section.
  const row = page.locator('.scene-section[data-section="object-transform"] .scene-axes').first()
    .locator('.scene-exposable').nth(2)
  await row.hover()
  await row.locator('.scene-expose').click()
  await page.waitForSelector('.scene-expose-popover', { timeout: 10000 })
  const suggested = await page.locator('.scene-expose-popover input').first().inputValue()
  check('the popover names the control after the field it came from',
    /Cube/.test(suggested) && /Z/.test(suggested), suggested)
  await shot('scene-expose-popover-1440.png')

  // The field is labelled by a <label> element rather than an attribute, so it is found by role.
  const max = page.locator('.scene-expose-popover').getByLabel('Max')
  await max.fill('3')
  await max.press('Enter')
  await page.locator('.scene-expose-popover button[data-action="expose"]').click()
  await page.waitForTimeout(500)

  const stored = await helpers.scene()
  const rig = stored?.rig ?? null
  check('the document now carries a control and the binding that drives the field',
    rig?.parameters?.length === 1 && rig.bindings.length === 1 && rig.bindings[0].property === 'transform.position.z',
    JSON.stringify({ parameters: rig?.parameters?.length ?? 0, property: rig?.bindings?.[0]?.property ?? null }))
  check('and the control was given the range that was typed', rig?.parameters?.[0]?.max === 3, `max ${rig?.parameters?.[0]?.max}`)

  const lit = await row.locator('.scene-expose--bound').count()
  check('the field says it is driven', lit === 1, `${lit} lit diamonds on the row`)
  await shot('scene-expose-bound-1440.png')

  /* ------------------------------------------------------ turning it in Controls */

  await page.locator('.scene-properties__tab[aria-label="Controls"]').click()
  await page.waitForSelector('.scene-controls__list', { timeout: 10000 })
  const named = await page.locator('.scene-controls__row .scene-controls__name').first().textContent()
  const drives = await page.locator('.scene-controls__row .scene-controls__drives').first().textContent()
  check('the Controls tab lists it and says what it drives',
    named?.includes('Cube') && drives?.includes('Location Z'), `${named} → ${drives}`)

  const before = await page.evaluate(() => window.__paramrigScene.bounds())
  const control = page.locator('.scene-controls__inspector .control').first().locator('input').first()
  await control.fill('2')
  await control.press('Enter')
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => window.__paramrigScene.bounds())
  const lifted = (after?.min?.[2] ?? 0) - (before?.min?.[2] ?? 0)
  check('turning the control moves the scene the viewport draws', lifted > 1.5, `the cube rose by ${lifted.toFixed(2)}`)
  log(`MEASURE the control at 2 lifts the drawn cube from z=${before?.min?.[2]?.toFixed(2)} to z=${after?.min?.[2]?.toFixed(2)}`)

  const kept = await helpers.scene()
  const storedZ = kept.objects.find((object) => object.name === 'Cube')?.transform.position[2]
  check('and leaves the document alone: the control is the only thing that moved',
    storedZ === stored.objects.find((object) => object.name === 'Cube')?.transform.position[2],
    `stored z stays ${storedZ}`)
  await shot('scene-expose-controls-1440.png')

  /* ------------------------------------------------------------------ unbinding */

  await page.locator('.scene-properties__tab[aria-label="Object"]').click()
  await page.waitForSelector('.scene-section[data-section="object-transform"]', { timeout: 10000 })
  await row.hover()
  await row.locator('.scene-expose--bound').click()
  await page.locator('.menu__item[data-action="unbind"]').click()
  await page.waitForTimeout(500)
  const unbound = (await helpers.scene())?.rig ?? null
  check('unbinding takes the binding and keeps the control',
    unbound?.bindings?.length === 0 && unbound.parameters.length === 1,
    JSON.stringify({ bindings: unbound?.bindings?.length ?? 0, parameters: unbound?.parameters?.length ?? 0 }))
})
