import { run } from './lib.mjs'

/** Chantier F, second half: mesh gradients. */
export default run('chantier-f2', async ({ page, check, helpers, shot }) => {
  await helpers.newDocument()
  await page.keyboard.press('r')
  await helpers.drag({ x: 150, y: 150 }, { x: 550, y: 450 })
  await page.waitForTimeout(300)
  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.locator('.vector-layer__select').first().click()
  await page.waitForSelector('.vector-paints')

  // 1. Switching the fill to a mesh paints one and shows its knots.
  // Five fill types means the segmented control gives way to a menu.
  await page.locator('.vector-paints').locator('button[role="combobox"]').first().click()
  await page.waitForTimeout(200)
  await page.getByRole('option', { name: 'Mesh', exact: true }).click()
  await page.waitForTimeout(500)
  const paint = (await helpers.doc()).elements[0].fills?.[0]
  check('the fill becomes a mesh of one patch', paint?.type === 'mesh' && paint.mesh.rows === 1 && paint.mesh.points.length === 4,
    JSON.stringify(paint?.mesh && { rows: paint.mesh.rows, cols: paint.mesh.cols, points: paint.mesh.points.length }))
  const painted = await page.evaluate(() => {
    const node = document.querySelector('[data-vector-element] path')
    const fill = node?.getAttribute('fill') ?? ''
    const pattern = fill.startsWith('url(#') ? document.querySelector(fill.slice(5, -1).replace(/^/, '#')) : null
    return pattern ? { cells: pattern.querySelectorAll('path').length, first: pattern.querySelector('path')?.getAttribute('d') } : { fill }
  })
  check('it paints as a field of flat cells', painted.cells > 100, JSON.stringify(painted))
  check('the knots are on the canvas', (await page.$$('.vector-mesh__knot')).length === 4, String((await page.$$('.vector-mesh__knot')).length))
  await shot('chantier-f2-mesh.png')

  // 2. Dragging a knot moves the colour with it, in one undo entry.
  const before = painted.first
  await helpers.drag({ x: 150, y: 150 }, { x: 350, y: 300 })
  await page.waitForTimeout(400)
  const moved = (await helpers.doc()).elements[0].fills[0].mesh.points[0]
  check('a knot follows the pointer', Math.abs(moved.x - 0.5) < 0.05 && Math.abs(moved.y - 0.5) < 0.05, JSON.stringify(moved))
  const after = await page.evaluate(() => {
    const node = document.querySelector('[data-vector-element] path')
    const fill = node?.getAttribute('fill') ?? ''
    return document.querySelector(`${fill.slice(5, -1).replace(/^/, '#')} path`)?.getAttribute('d')
  })
  // The colour at the corner is still the corner's; what moves is where the field is stretched.
  check('and the field is redrawn around it', typeof after === 'string' && after !== before, JSON.stringify({ before, after }))
  await page.locator('#main').focus()
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(300)
  check('one undo takes the whole drag back', (await helpers.doc()).elements[0].fills[0].mesh.points[0].x === 0,
    String((await helpers.doc()).elements[0].fills[0].mesh.points[0].x))

  // 3. A double-click adds a row and a column through the point.
  // Off the centre, where the pivot handle sits.
  const at = await helpers.toClient({ x: 300, y: 250 })
  await page.mouse.dblclick(at.x, at.y)
  await page.waitForTimeout(400)
  const split = (await helpers.doc()).elements[0].fills[0].mesh
  check('a double-click adds a row and a column', split.rows === 2 && split.cols === 2 && split.points.length === 9,
    JSON.stringify({ rows: split.rows, cols: split.cols, points: split.points.length }))
  check('and puts a knot where it was clicked', Math.abs(split.points[4].x - 0.375) < 0.05 && Math.abs(split.points[4].y - 0.333) < 0.05,
    JSON.stringify(split.points[4]))

  // 4. The inspector paints the knot the canvas has selected.
  await page.locator('.vector-mesh__hit').nth(4).click()
  await page.waitForTimeout(300)
  const knotField = page.locator('.vector-paints').locator('.control--color', { hasText: 'Knot' }).locator('.color-field__hex')
  check('the selected knot offers its colour', await knotField.count() === 1, String(await knotField.count()))
  await knotField.fill('#FF0000')
  await knotField.press('Enter')
  await page.waitForTimeout(400)
  check('changing it repaints the mesh', (await helpers.doc()).elements[0].fills[0].mesh.points[4].color === '#FF0000',
    String((await helpers.doc()).elements[0].fills[0].mesh.points[4].color))
  await shot('chantier-f2-split.png')

  // 5. The export carries the same field of cells.
  const exported = await helpers.captureExport(async () => {
    await page.click('[aria-label="Export"]')
    await page.waitForSelector('.vector-export-menu')
    await page.locator('.vector-export__chip', { hasText: 'SVG' }).click()
    await page.click('[data-action="export"]')
  })
  check('the export carries the mesh as its own field of cells',
    !!exported && exported.text.includes('<pattern id=') && (exported.text.match(/shape-rendering="crispEdges"/g) ?? []).length > 100,
    exported ? String((exported.text.match(/shape-rendering="crispEdges"/g) ?? []).length) : 'no download')
  // No cell is exactly the knot's colour: a cell carries the colour at its middle, a step away.
  const reds = [...(exported?.text.match(/fill="#([0-9A-F]{6})"/g) ?? [])]
    .map((match) => match.slice(7, 13))
    .filter((hex) => Number.parseInt(hex.slice(0, 2), 16) > 200 && Number.parseInt(hex.slice(2, 4), 16) < 80)
  check('and the cells around the red knot are red', reds.length > 5, `${reds.length} red cells, e.g. ${reds.slice(0, 3).join(', ')}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 6. It survives a reload.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(500)
  const reloaded = (await helpers.doc()).elements[0].fills?.[0]
  check('the mesh survives a reload', reloaded?.type === 'mesh' && reloaded.mesh.points.length === 9, JSON.stringify(reloaded?.mesh?.points?.length))
})
