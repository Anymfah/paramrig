import { run } from './lib.mjs'

/** Chantier D, second half: strokes stamped with a brush. */
export default run('chantier-d-brush', async ({ page, check, helpers, shot }) => {
  await helpers.newDocument()
  await page.keyboard.press('p')
  await helpers.clickAt({ x: 150, y: 250 })
  await helpers.clickAt({ x: 350, y: 400 })
  await helpers.clickAt({ x: 550, y: 250 })
  await page.locator('#main').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await helpers.clickAt({ x: 350, y: 400 })
  // The brush, like the rest of the contour's numbers, is folded under the Stroke section.
  await page.click('.vector-fold__head')
  await page.waitForSelector('[aria-label="Brush"]', { timeout: 4000 })
  check('a stroked path offers the brush section', true)
  // A wider stroke, so the stamps are big enough to tell apart.
  const widthField = page.locator('.vector-fold__panel').getByLabel('Width', { exact: true }).first()
  await widthField.fill('12')
  await widthField.press('Enter')
  await page.waitForTimeout(300)

  // 1. The three brushes that ship are on the list, with a preview.
  const options = await page.$$eval('[aria-label="Brush"] .segment__opt span, [aria-label="Brush"] [role="option"]', (nodes) => nodes.map((node) => node.textContent))
  check('the three brushes that ship are offered', ['Round', 'Calligraphic', 'Dashed'].every((name) => options.includes(name)), JSON.stringify(options))

  // 2. Picking one stamps the stroke.
  await page.locator('[aria-label="Brush"] .segment__opt', { hasText: 'Calligraphic' }).first().click()
  await page.waitForTimeout(400)
  const brushed = (await helpers.doc()).elements[0]
  check('picking a brush is stored on the object', brushed.brush?.id === 'brush-calligraphic', JSON.stringify(brushed.brush))
  const painted = await page.evaluate(() => {
    const node = document.querySelector('[data-vector-element] path')
    const d = node?.getAttribute('d') ?? ''
    return node ? { fill: node.getAttribute('fill'), stroke: node.getAttribute('stroke'), moves: (d.match(/M/g) ?? []).length, length: d.length } : null
  })
  // The stamps stay separate sub-paths and paint as one band under the non-zero rule.
  check('a brushed stroke paints as a run of filled stamps', !!painted && painted.stroke === 'none' && painted.moves > 5 && painted.length > 200,
    JSON.stringify(painted))
  check('they paint as one band, not a chain of holes', await page.getAttribute('[data-vector-element] path', 'fill-rule') === 'nonzero',
    String(await page.getAttribute('[data-vector-element] path', 'fill-rule')))
  check('the preview shows the brush', (await page.$$('[aria-label="Brush"] .vector-brush__preview')).length === 1)
  await shot('chantier-d-brush.png')

  // 3. Spacing changes the number of stamps.
  const before = painted.moves
  const spacing = page.getByLabel('Spacing', { exact: true }).first()
  await spacing.fill('200')
  await spacing.press('Enter')
  await page.waitForTimeout(400)
  const sparse = await page.evaluate(() => ((document.querySelector('[data-vector-element] path')?.getAttribute('d') ?? '').match(/M/g) ?? []).length
  )
  check('a wider spacing leaves fewer stamps', sparse < before / 2, JSON.stringify({ dense: before, sparse }))

  // 4. It survives the export and a reload.
  const exported = await helpers.captureExport(async () => {
    await page.click('[aria-label="Export"]')
    await page.waitForSelector('.vector-export-menu')
    await page.locator('.vector-export__chip', { hasText: 'SVG' }).click()
    await page.click('[data-action="export"]')
  })
  check('the export carries the stamps, flattened, and says so',
    !!exported && exported.text.includes('flattened to filled paths') && (exported.text.match(/M/g) ?? []).length > 5,
    exported ? String((exported.text.match(/M/g) ?? []).length) : 'no download')
  await page.keyboard.press('Escape')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(400)
  check('the brush survives a reload', (await helpers.doc()).elements[0].brush?.id === 'brush-calligraphic')

  // 5. A shape can become a brush of its own.
  await page.locator('#main').focus()
  await page.keyboard.press('r')
  await helpers.drag({ x: 600, y: 500 }, { x: 660, y: 560 })
  await page.waitForTimeout(300)
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await helpers.clickAt({ x: 630, y: 530 })
  await page.waitForTimeout(300)
  const define = page.locator('[data-action="define-brush"]')
  check('a rectangle cannot become a brush until it is a path', await define.isDisabled())
  await page.locator('#main').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const state = await helpers.doc()
  check('the scene now holds two objects', state.elements.length === 2, String(state.elements.length))
})
