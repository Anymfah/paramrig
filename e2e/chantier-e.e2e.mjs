import { run } from './lib.mjs'

/** Chantier E, first half: text that runs along an outline. */
export default run('chantier-e', async ({ page, check, helpers, shot }) => {
  await helpers.newDocument()

  // A circle and a text, then attach one to the other.
  await page.keyboard.press('o')
  await helpers.drag({ x: 200, y: 180 }, { x: 500, y: 480 })
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('t')
  await helpers.clickAt({ x: 250, y: 550 })
  await page.waitForTimeout(300)
  await page.keyboard.type('Around the circle')
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const scene = await helpers.doc()
  check('the scene holds a circle and a text', scene.elements.length === 2 && scene.elements.some((element) => element.kind === 'text'),
    JSON.stringify(scene.elements.map((element) => element.kind)))

  // 1. Attach to path, from the command palette, with both selected.
  await page.locator('#main').focus()
  await page.keyboard.press('v')
  await page.keyboard.press('Meta+a')
  await page.waitForTimeout(200)
  await page.keyboard.press('Meta+/')
  await page.waitForSelector('.vector-palette__input')
  await page.keyboard.type('Attach to path')
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const attached = (await helpers.doc()).elements.find((element) => element.kind === 'text')
  check('the text is attached to the circle', !!attached?.textPath?.elementId && !!attached.textPath.d,
    JSON.stringify(attached?.textPath && { elementId: attached.textPath.elementId, offset: attached.textPath.offset, d: attached.textPath.d?.slice(0, 20) }))
  check('the text takes the box of the outline it rides', Math.round(attached.width) === 300 && Math.round(attached.height) === 300,
    JSON.stringify({ width: attached.width, height: attached.height }))

  // 2. On the canvas it renders as a textPath against a hidden path in the defs.
  const rendered = await page.evaluate(() => {
    const node = document.querySelector('[data-vector-element] textPath')
    if (!node) return null
    const href = node.getAttribute('href')
    return { href, offset: node.getAttribute('startOffset'), target: !!document.querySelector(href), text: node.textContent }
  })
  check('the canvas hangs the text on a path in the defs', !!rendered && rendered.target && rendered.text === 'Around the circle', JSON.stringify(rendered))
  await shot('chantier-e-textpath.png')

  // 3. The offset moves it along, in one undo entry.
  const offset = page.getByLabel('Path offset', { exact: true }).first()
  await offset.fill('35')
  await offset.press('Enter')
  await page.waitForTimeout(300)
  check('the offset field moves the text along the path',
    Math.abs(((await helpers.doc()).elements.find((element) => element.kind === 'text').textPath.offset) - 0.35) < 0.01,
    String((await helpers.doc()).elements.find((element) => element.kind === 'text').textPath.offset))
  const startOffset = await page.getAttribute('[data-vector-element] textPath', 'startOffset')
  check('the rendered start offset follows it', startOffset === '35%', String(startOffset))

  // 4. Moving the circle carries the text with it.
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  // Through the layer list: the attached text now covers the same box as the circle.
  await page.locator('.vector-layer__select', { hasText: 'Ellipse' }).first().click()
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  const before = (await helpers.doc()).elements.find((element) => element.kind === 'text').textPath.d
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  const after = (await helpers.doc()).elements.find((element) => element.kind === 'text').textPath.d
  check('moving the outline carries the text with it', before !== after, JSON.stringify({ before: before.slice(0, 24), after: after.slice(0, 24) }))

  // 5. The export carries the same construction.
  const exported = await helpers.captureExport(async () => {
    await page.click('[aria-label="Export"]')
    await page.waitForSelector('.vector-export-menu')
    await page.locator('.vector-export__chip', { hasText: 'SVG' }).click()
    await page.click('[data-action="export"]')
  })
  check('the export hangs the text on a path of its own',
    !!exported && exported.text.includes('<textPath href="#') && exported.text.includes('startOffset="35%"'),
    exported ? exported.text.split('\n').find((line) => line.includes('textPath'))?.slice(0, 140) ?? 'no textPath' : 'no download')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 6. Detaching puts it back on its own baseline.
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.locator('.vector-layer__select', { hasText: 'Around' }).first().click()
  await page.waitForTimeout(300)
  await page.click('[data-action="detach-path"]')
  await page.waitForTimeout(300)
  check('detaching gives the text its own baseline back', !(await helpers.doc()).elements.find((element) => element.kind === 'text').textPath)
  check('and it stops rendering as a textPath', (await page.$$('[data-vector-element] textPath')).length === 0)
})
