import { run } from './lib.mjs'

/** Chantier E, second half: fonts the document brings with it. */
export default run('chantier-e2', async ({ page, check, helpers, shot }) => {
  await helpers.newDocument()
  await page.keyboard.press('t')
  await helpers.clickAt({ x: 200, y: 300 })
  await page.waitForTimeout(300)
  await page.keyboard.type('Hamburgefonstiv')
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('v')
  await page.locator('.vector-layer__select').first().click()
  await page.waitForSelector('.vector-font__trigger', { timeout: 5000 })

  // 1. The picker lists the app's faces and the Google families, each in its own face.
  await page.click('.vector-font__trigger')
  await page.waitForSelector('.vector-font__popover')
  const headings = await page.$$eval('.vector-font__heading', (nodes) => nodes.map((node) => node.textContent))
  check('the list is grouped by where a font comes from', headings.includes('Available here') && headings.includes('Google Fonts'), JSON.stringify(headings))
  const rendered = await page.$$eval('.vector-font__option', (nodes) => nodes.length)
  const total = await page.evaluate(() => Math.round(document.querySelector('.vector-font__list > div').getBoundingClientRect().height / 34))
  check('only the rows in view are rendered', rendered < total, JSON.stringify({ rendered, total }))
  const previewed = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.vector-font__name')].find((node) => node.textContent === 'Georgia')
    return row ? getComputedStyle(row).fontFamily : null
  })
  check('each row previews its own face', previewed?.includes('Georgia'), String(previewed))

  // 2. Searching narrows it.
  await page.fill('[aria-label="Search fonts"]', 'mono')
  await page.waitForTimeout(200)
  const found = await page.$$eval('.vector-font__name', (nodes) => nodes.map((node) => node.textContent))
  check('the search narrows the list', found.length > 0 && found.every((name) => name.toLowerCase().includes('mono')), JSON.stringify(found))

  // 3. Picking a Google family loads it, records it on the document, and draws with it.
  await page.fill('[aria-label="Search fonts"]', 'Space Grotesk')
  await page.waitForTimeout(200)
  await page.locator('.vector-font__option', { hasText: 'Space Grotesk' }).first().click()
  await page.waitForTimeout(2500)
  const state = await helpers.doc()
  check('the document records the family it borrowed', state.fonts?.some((font) => font.family === 'Space Grotesk' && font.source === 'google'),
    JSON.stringify(state.fonts))
  check('the text is set in it', state.elements[0].fontFamily === 'Space Grotesk', String(state.elements[0].fontFamily))
  const loaded = await page.evaluate(() => [...document.fonts].some((face) => face.family === 'Space Grotesk' && face.status === 'loaded'))
  check('the page really has the face, not a fallback', loaded, String(loaded))
  const drawn = await page.evaluate(() => {
    const node = document.querySelector('[data-vector-element] text')
    return node ? { family: node.getAttribute('font-family'), width: Math.round(node.getBBox().width) } : null
  })
  check('the canvas draws with it', drawn?.family?.includes('Space Grotesk'), JSON.stringify(drawn))
  await shot('chantier-e2-google.png')

  // 4. The export carries the face inline, so a PNG matches the canvas.
  const exported = await helpers.captureExport(async () => {
    await page.click('[aria-label="Export"]')
    await page.waitForSelector('.vector-export-menu')
    await page.locator('.vector-export__chip', { hasText: 'SVG' }).click()
    await page.click('[data-action="export"]')
  })
  check('the exported file embeds the font it uses',
    !!exported && exported.text.includes("font-family:'Space Grotesk'") && exported.text.includes('base64,'),
    exported ? String(exported.text.match(/@font-face\{font-family:'[^']+'/g)) : 'no download')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 5. The exported file draws the same width as the canvas: the face travelled with it.
  const widths = await page.evaluate(async (svg) => {
    const node = document.querySelector('[data-vector-element] text')
    const canvasWidth = node.getBBox().width
    const holder = document.createElement('div')
    holder.style.cssText = 'position:fixed;left:-9999px;top:0'
    holder.innerHTML = svg
    document.body.append(holder)
    await document.fonts.ready
    const exportedText = holder.querySelector('text')
    const exportedWidth = exportedText.getBBox().width
    holder.remove()
    return { canvasWidth: Math.round(canvasWidth), exportedWidth: Math.round(exportedWidth) }
  }, exported.text)
  check('the exported text measures the same as the one on the canvas',
    Math.abs(widths.canvasWidth - widths.exportedWidth) <= 2, JSON.stringify(widths))

  // 6. It survives a reload: the document knows which font to fetch again.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(2500)
  const reloaded = await page.evaluate(() => [...document.fonts].some((face) => face.family === 'Space Grotesk'))
  check('the font is fetched again when the document is reopened', reloaded, String(reloaded))

  // 7. A Google family arrives as a woff2, which cannot be read for outlines, and the tooltip says so.
  await page.locator('.vector-layer__select').first().click()
  await page.waitForTimeout(400)
  const outline = page.locator('[data-action="outline-text"]')
  check('Outline text is out of reach for a woff2', await outline.isDisabled())
  await page.locator('[data-action="outline-text"]').hover({ force: true })
  await page.waitForTimeout(700)
  const reason = await page.evaluate(() => [...document.querySelectorAll('.tooltip, [role="tooltip"]')].map((node) => node.textContent).join(' | '))
  check('and says why, rather than simply refusing', reason.includes('woff2'), reason.slice(0, 120))

  // 8. An imported TrueType file can be outlined.
  await page.click('.vector-font__trigger')
  await page.waitForSelector('.vector-font__popover')
  await page.setInputFiles('.vector-font__popover input[type="file"]', '/workspace/public/fonts/PublicSans.ttf')
  await page.waitForTimeout(1200)
  const imported = await helpers.doc()
  check('an imported file joins the document with its bytes',
    imported.fonts?.some((font) => font.source === 'file' && font.format === 'ttf' && (font.data?.length ?? 0) > 1000),
    JSON.stringify(imported.fonts?.map((font) => [font.family, font.source, font.format, font.data?.length ?? 0])))
  check('the text is set in the imported face', imported.elements[0].fontFamily === 'PublicSans', String(imported.elements[0].fontFamily))
  await page.waitForTimeout(300)
  const canOutline = !(await page.locator('[data-action="outline-text"]').isDisabled())
  check('Outline text is offered for it', canOutline)
  await page.locator('[data-action="outline-text"]').click()
  await page.waitForTimeout(1500)
  const outlined = (await helpers.doc()).elements[0]
  check('outlining turns the letters into a path', outlined.kind === 'path' && !!outlined.network && outlined.network.segments.length > 20,
    JSON.stringify({ kind: outlined.kind, segments: outlined.network?.segments.length }))
  await shot('chantier-e2-outlined.png')
})
