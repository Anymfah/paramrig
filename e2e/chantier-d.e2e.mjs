import { run } from './lib.mjs'

/** Chantier D: strokes whose width changes along their length. */
export default run('chantier-d', async ({ page, check, helpers, shot }) => {
  await helpers.newDocument()

  // A plain open path drawn with the pen: two clicks and Enter.
  await page.keyboard.press('p')
  await helpers.clickAt({ x: 150, y: 300 })
  await helpers.clickAt({ x: 550, y: 300 })
  await page.locator('#main').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const drawn = await helpers.doc()
  check('the pen leaves an open path', drawn.elements.length === 1 && drawn.elements[0].kind === 'path', JSON.stringify(drawn.elements.map((e) => e.kind)))

  await page.locator('#main').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await helpers.clickAt({ x: 350, y: 300 })
  await page.waitForTimeout(200)
  check('the path is selected before the width tool comes out', (await page.$$('[data-vector-element][data-selected]')).length === 1)

  // 1. ⇧W picks up the width tool.
  await page.locator('#main').focus()
  await page.keyboard.press('Shift+W')
  check('⇧W selects the width tool', await page.getAttribute('.vector-canvas', 'data-tool') === 'width')

  // 2. Dragging away from the line sets a width point there.
  await helpers.drag({ x: 350, y: 300 }, { x: 350, y: 320 })
  const profiled = (await helpers.doc()).elements[0]
  check('a drag across the line adds a width point', !!profiled.strokeProfile && profiled.strokeProfile.length === 3,
    JSON.stringify(profiled.strokeProfile))
  const middle = profiled.strokeProfile?.find((point) => point.t > 0.4 && point.t < 0.6)
  check('the width follows how far the pointer went', !!middle && Math.abs(middle.width * profiled.strokeWidth - 40) < 6,
    JSON.stringify({ point: middle, strokeWidth: profiled.strokeWidth }))

  // 3. It is one undo entry, and it paints as a fill rather than a stroke.
  const painted = await page.evaluate(() => {
    const node = document.querySelector('[data-vector-element] path')
    return node ? { fill: node.getAttribute('fill'), stroke: node.getAttribute('stroke'), d: node.getAttribute('d')?.slice(0, 24) } : null
  })
  check('the profiled stroke paints as a filled shape', !!painted && painted.fill !== 'none' && painted.stroke === 'none', JSON.stringify(painted))
  await shot('chantier-d-profile.png')
  await page.locator('#main').focus()
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(250)
  check('one undo takes the whole drag back', !(await helpers.doc()).elements[0].strokeProfile, JSON.stringify((await helpers.doc()).elements[0].strokeProfile))
  await page.keyboard.press('Meta+Shift+z')
  await page.waitForTimeout(250)

  // 4. Delete removes the point under the pointer.
  const at = await helpers.toClient({ x: 350, y: 300 })
  await page.mouse.move(at.x, at.y)
  await page.waitForTimeout(200)
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(250)
  const trimmed = (await helpers.doc()).elements[0]
  check('Delete takes the point back out', !trimmed.strokeProfile || trimmed.strokeProfile.length === 2, JSON.stringify(trimmed.strokeProfile))

  // 5. The export carries the flattened shape and says so.
  await helpers.drag({ x: 250, y: 300 }, { x: 250, y: 325 })
  await page.waitForTimeout(200)
  const exported = await helpers.captureExport(async () => {
    await page.click('[aria-label="Export"]')
    await page.waitForSelector('.vector-export-menu')
    await page.locator('.vector-export__chip', { hasText: 'SVG' }).click()
    await page.click('[data-action="export"]')
  })
  check('the export flattens it to a filled path and says so',
    !!exported && exported.text.includes('Variable-width strokes are flattened') && !exported.text.includes('stroke-width="8"'),
    exported ? exported.text.split('\n').find((line) => line.includes('flattened')) ?? 'no note' : 'no download')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 6. It survives a reload, and Reset puts the even width back.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(400)
  check('the profile survives a reload', !!(await helpers.doc()).elements[0].strokeProfile, JSON.stringify((await helpers.doc()).elements[0].strokeProfile))
  await page.locator('.vector-layer__select').first().click()
  await page.waitForTimeout(300)
  await page.click('[data-action="reset-stroke-width"]')
  await page.waitForTimeout(300)
  check('Reset gives back an even width', !(await helpers.doc()).elements[0].strokeProfile)
})
