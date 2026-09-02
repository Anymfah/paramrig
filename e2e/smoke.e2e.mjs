import { run } from './lib.mjs'

/** The moves every other script leans on: draw, select, move, undo, export. */
export default run('smoke', async ({ page, check, helpers, shot }) => {
  await helpers.newDocument()
  await page.keyboard.press('r')
  await helpers.drag({ x: 150, y: 150 }, { x: 350, y: 290 })
  const drawn = await helpers.doc()
  check('a drag with the rectangle tool draws one', drawn.elements.length === 1 && Math.round(drawn.elements[0].width) === 200,
    JSON.stringify(drawn.elements.map((element) => [element.kind, Math.round(element.width), Math.round(element.height)])))

  // Away from the centre, where the pivot sits, and from the edge and corner handles.
  await helpers.drag({ x: 200, y: 245 }, { x: 280, y: 245 })
  check('dragging the body moves it', Math.round((await helpers.doc()).elements[0].x) === 230, String((await helpers.doc()).elements[0].x))

  await page.locator('#main').focus()
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(200)
  check('undo puts it back', Math.round((await helpers.doc()).elements[0].x) === 150, String((await helpers.doc()).elements[0].x))

  const exported = await helpers.captureExport(async () => {
    await page.click('[aria-label="Export"]')
    await page.waitForSelector('.vector-export-menu')
    await page.locator('.vector-export__chip', { hasText: 'SVG' }).click()
    await page.click('[data-action="export"]')
  })
  check('the export hands over an SVG of the page', !!exported && exported.download.endsWith('.svg') && exported.text.includes('<svg'),
    exported ? exported.download : 'no download')
  await page.keyboard.press('Escape')
  await shot('smoke.png')
})
