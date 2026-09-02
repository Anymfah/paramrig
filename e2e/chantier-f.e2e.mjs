import { run } from './lib.mjs'

/** Chantier F, first half: a fill made of another object, stamped. */
export default run('chantier-f', async ({ page, check, helpers, shot }) => {
  await helpers.newDocument()

  // A small tile shape, and a big rectangle to fill with it.
  await page.keyboard.press('r')
  await helpers.drag({ x: 120, y: 120 }, { x: 520, y: 420 })
  await page.waitForTimeout(200)
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('o')
  await helpers.drag({ x: 600, y: 120 }, { x: 640, y: 160 })
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await page.keyboard.press('Meta+a')
  await page.waitForTimeout(200)

  // 1. Define the pattern: the topmost object becomes the tile of the ones under it.
  await page.keyboard.press('Meta+/')
  await page.waitForSelector('.vector-palette__input')
  await page.keyboard.type('Define pattern')
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const state = await helpers.doc()
  const filled = state.elements.find((element) => element.kind === 'rectangle')
  const tile = state.elements.find((element) => element.kind === 'ellipse')
  check('the rectangle is filled with a pattern pointing at the ellipse',
    filled?.fills?.[0]?.type === 'pattern' && filled.fills[0].sourceId === tile?.id,
    JSON.stringify(filled?.fills?.[0]))
  check('the tile itself steps out of the drawing', tile?.visible === false, String(tile?.visible))

  // 2. The canvas paints it through a <pattern> that draws the object.
  const painted = await page.evaluate(() => {
    const node = document.querySelector('[data-vector-element] path')
    const fill = node?.getAttribute('fill') ?? ''
    const pattern = fill.startsWith('url(#') ? document.querySelector(fill.slice(5, -1).replace(/^/, '#')) : null
    return pattern ? {
      tag: pattern.tagName,
      width: pattern.getAttribute('width'),
      height: pattern.getAttribute('height'),
      stamps: pattern.querySelectorAll('g').length,
      paths: pattern.querySelectorAll('path').length,
    } : { fill }
  })
  check('the fill is a pattern whose cell is the tile box', painted.tag === 'pattern' && painted.width === '40' && painted.height === '40',
    JSON.stringify(painted))
  check('and the cell draws the object', painted.paths > 0, JSON.stringify(painted))
  await shot('chantier-f-grid.png')

  // 3. Brick doubles the cell and stamps twice. The pattern's settings sit in the layer's popover.
  await helpers.openPaint('fill')
  await page.locator('.vector-paint-popover .control--select', { hasText: 'Repeat' }).locator('.segment__opt', { hasText: 'Brick' }).first().click({ force: true })
  await page.waitForTimeout(400)
  const brick = await page.evaluate(() => {
    const node = document.querySelector('[data-vector-element] path')
    const fill = node?.getAttribute('fill') ?? ''
    const pattern = document.querySelector(fill.slice(5, -1).replace(/^/, '#'))
    return { height: pattern?.getAttribute('height'), stamps: pattern?.querySelectorAll('g').length }
  })
  check('a brick is two rows tall and stamps twice', brick.height === '80' && brick.stamps === 2, JSON.stringify(brick))

  // 4. Angle and scale ride on the pattern transform.
  const angle = page.locator('.vector-paint-popover').getByLabel('Angle', { exact: true }).first()
  await angle.fill('30')
  await angle.press('Enter')
  await page.waitForTimeout(400)
  const transform = await page.evaluate(() => {
    const node = document.querySelector('[data-vector-element] path')
    const fill = node?.getAttribute('fill') ?? ''
    return document.querySelector(fill.slice(5, -1).replace(/^/, '#'))?.getAttribute('patternTransform')
  })
  check('the angle rides on the pattern transform', transform?.includes('rotate(30)'), String(transform))
  await shot('chantier-f-brick.png')

  // 5. Editing the tile changes every fill that uses it.
  await page.locator('.vector-layer__select', { hasText: 'Ellipse' }).first().click()
  await page.waitForTimeout(300)
  const tilePath = () => page.evaluate(() => {
    const node = [...document.querySelectorAll('[data-vector-element] path')].find((item) => (item.getAttribute('fill') ?? '').startsWith('url(#'))
    const fill = node?.getAttribute('fill') ?? ''
    return document.querySelector(`${fill.slice(5, -1).replace(/^/, '#')} path`)?.getAttribute('d') ?? ''
  })
  const before = await tilePath()
  const height = page.locator('[data-section="position"]').getByLabel('H', { exact: true }).first()
  await height.fill('12')
  await height.press('Enter')
  await page.waitForTimeout(400)
  const after = await tilePath()
  const tileNow = (await helpers.doc()).elements.find((element) => element.kind === 'ellipse')
  check('editing the object redraws every fill that stamps it', before !== after,
    JSON.stringify({ before: before.slice(0, 40), after: after.slice(0, 40), height: tileNow?.height }))

  // 6. The export carries the same construction.
  const exported = await helpers.captureExport(async () => {
    await page.click('[aria-label="Export"]')
    await page.waitForSelector('.vector-export-menu')
    await page.locator('.vector-export__chip', { hasText: 'SVG' }).click()
    await page.click('[data-action="export"]')
  })
  check('the export carries the pattern and its transform',
    !!exported && exported.text.includes('<pattern id=') && exported.text.includes('patternTransform="') && exported.text.includes('rotate(30)'),
    exported ? exported.text.split('\n').find((line) => line.includes('<pattern'))?.slice(0, 160) ?? 'no pattern' : 'no download')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 7. It survives a reload.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(500)
  const reloaded = (await helpers.doc()).elements.find((element) => element.kind === 'rectangle')
  check('the pattern survives a reload', reloaded?.fills?.[0]?.type === 'pattern' && reloaded.fills[0].angle === 30,
    JSON.stringify(reloaded?.fills?.[0]))
  check('and still paints', (await page.$$('pattern')).length > 0)
})
