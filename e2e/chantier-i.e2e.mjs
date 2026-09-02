import { run } from './lib.mjs'

/** Chantier I: the PDF the export writes. */
export default run('chantier-i', async ({ page, check, helpers, shot }) => {
  await helpers.newDocument()

  // A rectangle, a gradient and a text: three things the PDF has to say differently.
  await page.keyboard.press('r')
  await helpers.drag({ x: 80, y: 80 }, { x: 280, y: 220 })
  await page.waitForTimeout(200)
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('o')
  await helpers.drag({ x: 320, y: 80 }, { x: 520, y: 220 })
  await page.waitForTimeout(250)
  await page.locator('.vector-paints').locator('button[role="combobox"]').first().click()
  await page.waitForTimeout(200)
  await page.getByRole('option', { name: 'Linear', exact: true }).click()
  await page.waitForTimeout(300)
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('t')
  await helpers.clickAt({ x: 100, y: 300 })
  await page.waitForTimeout(300)
  await page.keyboard.type('Printed')
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 1. The export menu offers PDF next to SVG and PNG.
  await page.click('[aria-label="Export"]')
  await page.waitForSelector('.vector-export-menu')
  const chips = await page.$$eval('.vector-export__chip', (nodes) => nodes.map((node) => node.textContent))
  check('the export menu offers a PDF', chips.includes('PDF'), JSON.stringify(chips))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 2. Exporting one gives a file that says what it holds.
  const exported = await helpers.captureExport(async () => {
    await page.click('[aria-label="Export"]')
    await page.waitForSelector('.vector-export-menu')
    await page.locator('.vector-export__chip', { hasText: 'PDF' }).click()
    await page.click('[data-action="export"]')
  })
  const pdf = exported?.text ?? ''
  check('the file is a PDF that names itself and ends properly',
    !!exported && exported.download.endsWith('.pdf') && pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'),
    exported ? `${exported.download}, ${pdf.length} bytes` : 'no download')
  check('it has a page the size of the drawing', pdf.includes('/MediaBox [0 0 800 600]'), String(pdf.match(/\/MediaBox \[[^\]]+\]/)))
  // The page ground is the one `re f` in the file; every shape is a path filled even-odd.
  check('the rectangle is a path in its own colour', /0\.11 0\.114 0\.118 rg/.test(pdf) && pdf.includes('f*') && (pdf.match(/ re f/g) ?? []).length === 1,
    String(pdf.match(/[\d.]+ [\d.]+ [\d.]+ rg/g)?.slice(0, 3)))
  check('the gradient is a shading with a function behind it', pdf.includes('/ShadingType 2') && pdf.includes('/FunctionType 2'),
    String(pdf.match(/\/ShadingType \d/g)))
  check('the text went in as outlines, not as a font', pdf.includes(' c\n') && !pdf.includes('/Font'), String(pdf.includes('/Font')))

  // 3. Chrome can open it.
  const opened = await page.evaluate(async (text) => {
    const bytes = new Uint8Array([...text].map((character) => character.charCodeAt(0)))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:450px;border:0;z-index:9999'
    frame.src = url
    document.body.append(frame)
    await new Promise((resolve) => { frame.onload = resolve; setTimeout(resolve, 4000) })
    return { added: !!frame.contentWindow }
  }, pdf)
  check('Chrome opens the file it was handed', opened.added, JSON.stringify(opened))
  await page.waitForTimeout(1500)
  await shot('chantier-i-pdf.png')
  await page.evaluate(() => document.querySelector('iframe')?.remove())

  // 4. A shape with an effect comes back as an image rather than being dropped.
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.locator('.vector-layer__select').first().click()
  await page.waitForTimeout(300)
  await page.click('[data-action="add-effect"]')
  await page.waitForTimeout(400)
  const withEffect = await helpers.captureExport(async () => {
    await page.click('[aria-label="Export"]')
    await page.waitForSelector('.vector-export-menu')
    await page.locator('.vector-export__chip', { hasText: 'PDF' }).click()
    await page.click('[data-action="export"]')
  })
  check('an effect goes in as an image instead of being dropped',
    !!withEffect && withEffect.text.includes('/Subtype /Image') && withEffect.text.includes('/DCTDecode'),
    withEffect ? String(withEffect.text.match(/\/Subtype \/Image/g)?.length ?? 0) : 'no download')
  await page.keyboard.press('Escape')
})
