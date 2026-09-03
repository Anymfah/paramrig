import { run } from './lib.mjs'

/** Chantier 7: the T bar's tools — the region selections, the annotations and the rulers. */
export default run('scene-tools', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  const tools = await page.locator('.scene-toolbar button').count()
  check('the toolbar offers the tools of this prompt', tools >= 8, `${tools} buttons`)

  // A box drag over the cube selects it.
  await page.mouse.move(centre.x - 220, centre.y - 180)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(centre.x - 220 + step * 55, centre.y - 180 + step * 45)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(300)
  const stats = await page.locator('.scene-status__stats').textContent()
  check('a box drag selects what it covers', stats.includes('Objects 1/3') || stats.includes('Objects 2/3'), stats)

  // The annotate tool draws a stroke into the document, and never into the history.
  await page.locator('.scene-toolbar button[aria-label="Annotate"]').click()
  await page.waitForTimeout(150)
  await page.mouse.move(centre.x - 150, centre.y + 120)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(centre.x - 150 + step * 22, centre.y + 120 - step * 8)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
  const drawn = await helpers.scene()
  check('the annotate tool leaves a stroke on the document',
    (drawn.annotations ?? []).length === 1 && drawn.annotations[0].points.length > 5,
    `${(drawn.annotations ?? []).length} strokes, ${drawn.annotations?.[0]?.points.length ?? 0} points`)

  // The measure tool leaves a ruler, and its length is the distance between its ends.
  await page.locator('.scene-toolbar button[aria-label="Measure"]').click()
  await page.waitForTimeout(150)
  await page.mouse.move(centre.x - 100, centre.y + 200)
  await page.mouse.down()
  await page.mouse.move(centre.x + 100, centre.y + 200, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const measured = await helpers.scene()
  const ruler = (measured.measurements ?? [])[0]
  check('the measure tool leaves a ruler', !!ruler, `${(measured.measurements ?? []).length} rulers`)
  if (ruler) {
    const length = Math.hypot(ruler.to[0] - ruler.from[0], ruler.to[1] - ruler.from[1], ruler.to[2] - ruler.from[2])
    log(`MEASURE ruler length: ${length.toFixed(3)} m`)
    check('and it spans a real distance', length > 0.5, `${length.toFixed(3)} m`)
  }

  // Neither of them is an edit: undo takes back the box selection's predecessor, not the note.
  await page.locator('#main').focus()
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  const afterUndo = await helpers.scene()
  check('a note and a ruler are not edits, so undo leaves them alone',
    (afterUndo.annotations ?? []).length === 1 && (afterUndo.measurements ?? []).length === 1,
    `${(afterUndo.annotations ?? []).length} strokes, ${(afterUndo.measurements ?? []).length} rulers`)

  await page.locator('.scene-toolbar button[aria-label="Select box"]').click()
  await shot('scene-tools-1440.png')
})
