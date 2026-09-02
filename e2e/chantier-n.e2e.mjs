import { run } from './lib.mjs'

/** Controllers: exposing a field, driving the drawing with it, and tuning it in the workbench. */
export default run('chantier-n', async ({ page, check, log, helpers }) => {
  await helpers.newDocument()
  await page.keyboard.press('r')
  await helpers.drag({ x: 180, y: 160 }, { x: 480, y: 360 })
  await page.waitForTimeout(300)
  const id = page.url().split('/r/')[1]

  // The ◇ is quiet until the line is hovered, and the popover offers the control.
  const widthField = page.locator('[data-section="position"] .vector-exposable').nth(2)
  check('a field carries the expose diamond', await widthField.locator('.vector-expose').count() === 1)
  await widthField.hover()
  await widthField.locator('.vector-expose').click()
  await page.waitForSelector('.vector-expose-popover')
  const popover = await page.locator('.vector-expose-popover').innerText()
  const prefilled = await page.locator('.vector-expose-popover input').first().inputValue()
  check('the popover prefills the name from the object and the property', prefilled === 'Rectangle · Width', prefilled)
  check('and says what kind of control it will be', popover.includes('number'), popover.replace(/\n/g, ' / '))
  await page.click('[data-action="expose"]')
  await page.waitForTimeout(600)

  const doc = await helpers.doc()
  check('the document gains a control', doc.rig?.parameters?.length === 1, JSON.stringify(doc.rig?.parameters?.[0]))
  check('and a binding onto the width', doc.rig?.bindings?.[0]?.property === 'width', JSON.stringify(doc.rig?.bindings?.[0]))
  check('the control starts where the drawing already is', doc.rig?.parameters?.[0]?.defaultValue === 300, String(doc.rig?.parameters?.[0]?.defaultValue))
  check('exposing moves to the Controls tab', await page.locator('#vector-tab-controls[aria-selected="true"]').count() === 1)

  // Turning the knob redraws the rectangle; the raw document is left alone.
  const knob = page.locator('.vector-controls .inspector .number-value__input').first()
  await knob.fill('500')
  await knob.press('Enter')
  await page.waitForTimeout(500)
  const drawn = await page.evaluate(() => {
    const world = document.querySelector('.vector-world').getScreenCTM()
    const box = document.querySelector('[data-vector-element]').getBoundingClientRect()
    return Math.round(box.width / world.a)
  })
  check('the drawing follows the control', drawn === 500, String(drawn))
  check('the document itself is untouched', (await helpers.doc()).elements[0].width === 300, String((await helpers.doc()).elements[0].width))

  // The bound field is driven: the diamond is lit, and it offers a way out.
  await page.click('#vector-tab-design')
  await page.waitForTimeout(300)
  const bound = page.locator('[data-section="position"] .vector-exposable[data-bound]')
  check('the bound field is marked as driven', await bound.count() === 1)
  const shownWidth = await bound.locator('.number-value__input').inputValue()
  check('and reads the resolved value', shownWidth === '500', shownWidth)

  // Tune mode hands the document to the workbench.
  await page.click('#vector-tab-controls')
  await page.waitForTimeout(200)
  await page.click('.vector-controls__mode button:has-text("Tune")')
  await page.waitForTimeout(800)
  check('Tune opens the workbench', await page.locator('.vector-rig-preview').count() === 1)
  check('and the editor is gone', await page.locator('.vector-toolbar').count() === 0)
  const tuned = await page.locator('.inspector .number-value__input').first().inputValue()
  check('the value carries across', tuned === '500', tuned)

  // A snapshot in the workbench, then back to the editor.
  await page.click('[aria-label="Snapshot"]')
  await page.waitForTimeout(400)
  await page.click('#inspector-tab-snapshots')
  await page.waitForTimeout(300)
  check('a snapshot can be taken there', await page.locator('.snapshot-row').count() === 1)
  await page.click('.workspace-toolbar button:has-text("Edit")')
  await page.waitForTimeout(800)
  check('Edit comes back to the editor', await page.locator('.vector-toolbar').count() === 1)
  const modes = await page.evaluate(() => JSON.parse(localStorage.getItem('paramrig.vector-inspector.v1') ?? '{}').modes ?? {})
  check('the mode is remembered', modes[id] === 'edit', JSON.stringify(modes))

  // Unbinding leaves the drawing as it was.
  await page.locator('.vector-layer__select').first().click()
  await page.waitForTimeout(300)
  await page.click('#vector-tab-design')
  await page.waitForTimeout(300)
  await page.locator('[data-section="position"] .vector-exposable[data-bound] .vector-expose--bound').click()
  await page.waitForTimeout(200)
  await page.click('[data-action="unbind"]')
  await page.waitForTimeout(500)
  check('unbinding drops the binding, not the control', ((await helpers.doc()).rig?.bindings ?? []).length === 0 && ((await helpers.doc()).rig?.parameters ?? []).length === 1)
  check('and the drawing is its own again', (await helpers.doc()).elements[0].width === 300)

  // Dragging a control from the list back onto a field binds it again.
  await page.click('#vector-tab-controls')
  await page.waitForTimeout(200)
  await page.click('[data-section="control-bindings"] .vector-section__title')
  await page.waitForTimeout(200)
  check('the bindings section lists the control', await page.locator('[data-control]').count() === 1)

  // A second control with nothing behind it.
  await page.click('[data-action="add-control"] >> nth=0')
  await page.waitForTimeout(500)
  check('Add control makes one with no binding', ((await helpers.doc()).rig?.parameters ?? []).length === 2, JSON.stringify(((await helpers.doc()).rig?.parameters ?? []).map((p) => p.id)))

  // Deleting a control takes its bindings with it.
  await page.click('[data-control] .icon-btn >> nth=0')
  await page.waitForTimeout(200)
  await page.click('[data-action="delete-control"]')
  await page.waitForTimeout(500)
  check('deleting a control removes it', ((await helpers.doc()).rig?.parameters ?? []).length === 1)
})
