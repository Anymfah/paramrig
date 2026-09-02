import { run } from './lib.mjs'

/** The left rail: Layers, and everything the document reuses. */
export default run('chantier-m', async ({ page, check, log, helpers }) => {
  await helpers.newDocument()
  await page.waitForTimeout(200)

  check('the rail has two tabs', await page.locator('.vector-layers__tabs [role="tab"]').count() === 2)
  await page.click('#vector-rail-tab-assets')
  await page.waitForTimeout(300)
  const groups = await page.locator('.vector-assets .vector-section').evaluateAll((nodes) => nodes.map((node) => node.dataset.section))
  check('assets lists the five families', groups.join(',') === 'assets-components,assets-styles,assets-brushes,assets-patterns,assets-fonts', groups.join(','))
  const empties = await page.locator('.vector-assets .vector-empty').allInnerTexts()
  check('an empty family says what it is for', empties.some((text) => text.startsWith('No components')), empties.join(' / '))

  const brushRows = await page.locator('[data-section="assets-brushes"] .vector-asset').count()
  check('the three brushes that ship are listed', brushRows === 3, String(brushRows))
  const thumb = await page.locator('[data-section="assets-brushes"] .vector-asset__thumb').first().evaluate((node) => Math.round(node.getBoundingClientRect().width))
  check('a line carries a 40 pixel thumbnail', thumb === 40, String(thumb))

  // A style made from a fill turns up in the rail.
  await page.click('#vector-rail-tab-layers')
  await page.locator('#main').focus()
  await page.keyboard.press('r')
  await helpers.drag({ x: 150, y: 150 }, { x: 400, y: 340 })
  await page.waitForTimeout(300)
  const popover = await helpers.openPaint('fill')
  await popover.locator('[data-action="create-fill-style"]').click()
  await page.waitForTimeout(400)
  await page.click('#vector-rail-tab-assets')
  await page.waitForTimeout(300)
  const styleNames = await page.locator('[data-section="assets-styles"] .vector-asset__name').allInnerTexts()
  check('a new style appears in the rail', styleNames.length === 1, styleNames.join(','))
  check('the inspector no longer lists the styles', await page.locator('.vector-inspector [data-section="styles"]').count() === 0)

  // Renaming through the ⋯ menu writes to the document.
  await page.click('[data-section="assets-styles"] .vector-asset .icon-btn')
  await page.waitForTimeout(200)
  await page.click('.menu__item:has-text("Rename")')
  await page.waitForTimeout(200)
  const input = page.locator('.vector-asset__input')
  await input.fill('Ink')
  await input.press('Enter')
  await page.waitForTimeout(400)
  const styles = (await helpers.doc()).styles ?? []
  check('renaming a style writes it down', styles[0]?.name === 'Ink', JSON.stringify(styles.map((s) => s.name)))

  // Select users picks the objects that follow it.
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.click('[data-section="assets-styles"] .vector-asset .icon-btn')
  await page.waitForTimeout(200)
  await page.click('.menu__item:has-text("Select users")')
  await page.waitForTimeout(400)
  check('select users selects what follows the style', await page.locator('[data-vector-element][data-selected]').count() === 1)

  // Duplicating adds a second one.
  await page.click('[data-section="assets-styles"] .vector-asset .icon-btn >> nth=0')
  await page.waitForTimeout(200)
  await page.click('.menu__item:has-text("Duplicate")')
  await page.waitForTimeout(400)
  check('duplicating a style adds a copy', ((await helpers.doc()).styles ?? []).length === 2, JSON.stringify(((await helpers.doc()).styles ?? []).map((s) => s.name)))

  // A component can be dragged onto the canvas.
  await page.click('#vector-rail-tab-layers')
  await page.locator('#main').focus()
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(200)
  await page.keyboard.press('Alt+Meta+k')
  await page.waitForTimeout(500)
  await page.click('#vector-rail-tab-assets')
  await page.waitForTimeout(300)
  const componentRows = await page.locator('[data-section="assets-components"] .vector-asset').count()
  check('a component turns up in the rail', componentRows === 1, String(componentRows))
  const draggable = await page.locator('[data-section="assets-components"] .vector-asset__open').getAttribute('draggable')
  check('a component can be dragged out', draggable === 'true', String(draggable))
  const before = (await helpers.doc()).elements.length
  await page.click('[data-section="assets-components"] .vector-asset__open')
  await page.waitForTimeout(500)
  const after = (await helpers.doc()).elements.length
  check('clicking it places an instance', after > before, `${before} → ${after}`)
})
