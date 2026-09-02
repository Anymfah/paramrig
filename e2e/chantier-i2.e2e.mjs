import { run } from './lib.mjs'

/** Chantier I, second half: what a document says about its colours. */
export default run('chantier-i2', async ({ page, check, helpers, shot }) => {
  await helpers.newDocument()
  await page.keyboard.press('r')
  await helpers.drag({ x: 150, y: 150 }, { x: 450, y: 350 })
  await page.waitForTimeout(300)
  await page.locator('.vector-paints').locator('.color-field__hex').first().fill('#FF0000')
  await page.locator('.vector-paints').locator('.color-field__hex').first().press('Enter')
  await page.waitForTimeout(400)

  // 1. An sRGB document says nothing extra.
  const plain = await page.evaluate(() => document.querySelector('[data-vector-element] path')?.getAttribute('style'))
  check('an sRGB document states its colours once', !plain || !plain.includes('display-p3'), String(plain))

  // 2. Turning the document to Display P3 states them twice.
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.waitForSelector('[aria-label="Page properties"]')
  await page.locator('.vector-inspector').locator('.segment__opt', { hasText: 'Display P3' }).first().click()
  await page.waitForTimeout(500)
  check('the document records the wider space', (await helpers.doc()).colorSpace === 'display-p3', String((await helpers.doc()).colorSpace))
  const wide = await page.evaluate(() => {
    const node = [...document.querySelectorAll('[data-vector-element] path')].find((item) => (item.getAttribute('fill') ?? '').startsWith('#'))
    if (!node) return { shapes: document.querySelectorAll('[data-vector-element]').length, attribute: null, style: null, computed: '' }
    return { attribute: node.getAttribute('fill'), style: node.getAttribute('style'), computed: getComputedStyle(node).fill }
  })
  check('the shape keeps its sRGB fallback and adds the wider colour',
    wide.attribute === '#FF0000' && (wide.style ?? '').includes('color(display-p3 1 0 0)'), JSON.stringify(wide))
  check('and the browser paints the wider one', wide.computed.includes('display-p3') || wide.computed.includes('color('), String(wide.computed))
  await shot('chantier-i2-p3.png')

  // 3. The picker reads the colour out in CMYK and says when it needs a wider screen.
  await page.locator('.vector-layer__select').first().click()
  await page.waitForTimeout(300)
  await page.locator('.vector-paints').locator('.color-swatch').first().click()
  await page.waitForSelector('.color-popover')
  const readout = await page.evaluate(() => ({
    cmyk: document.querySelector('.color-popover__cmyk')?.textContent,
    note: document.querySelector('.color-popover__note')?.textContent,
    gamut: document.querySelector('.color-popover__gamut')?.textContent,
  }))
  check('the picker reads the colour out in CMYK', readout.cmyk === '0 / 100 / 100 / 0', JSON.stringify(readout))
  check('and says that the read-out is indicative', (readout.note ?? '').includes('no profile'), String(readout.note))
  check('and marks a colour that needs a wider screen', (readout.gamut ?? '').includes('Outside sRGB'), String(readout.gamut))
  await shot('chantier-i2-picker.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 4. The exports carry it: the SVG states both, the PDF stays sRGB and says so by staying plain.
  const svg = await helpers.captureExport(async () => {
    await page.click('[aria-label="Export"]')
    await page.waitForSelector('.vector-export-menu')
    await page.locator('.vector-export__chip', { hasText: 'SVG' }).click()
    await page.click('[data-action="export"]')
  })
  check('the exported SVG states the colour twice', !!svg && svg.text.includes('fill="#FF0000"') && svg.text.includes('color(display-p3 1 0 0)'),
    svg ? String(svg.text.match(/style="fill:[^"]+"/)) : 'no download')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 5. And it survives a reload.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(400)
  check('the colour space survives a reload', (await helpers.doc()).colorSpace === 'display-p3')
})
