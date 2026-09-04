import { run } from './lib.mjs'

/**
 * Chantier S: curves and text.
 *
 * A curve is not drawn — it is evaluated into a surface, and everything downstream treats that
 * surface as it would any mesh. So the checks follow that sentence: adding a circle gives an object
 * with no depth, a bevel gives it depth, editing a knot moves what is drawn, and a text object
 * turns eight letters into geometry that can be converted into a mesh and kept.
 */

/** The box the drawn object occupies, in metres, or nothing when it draws nothing. */
const boundsOf = (page, id) => page.evaluate((objectId) => {
  const box = window.__paramrigScene.bounds([objectId])
  return box ? { x: box.max[0] - box.min[0], y: box.max[1] - box.min[1], z: box.max[2] - box.min[2] } : null
}, id)

export default run('scene-curves-text', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  const box = await helpers.viewportBox()
  const scene = () => helpers.scene()

  // The cube is added at the origin and so is the curve; one of them has to go for either to be seen.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)
  await page.locator('#main').focus()
  await page.keyboard.press('KeyX')
  await page.waitForTimeout(400)
  await page.locator('[role="menuitem"], .scene-confirm button', { hasText: 'Delete' }).first().click()
  await page.waitForTimeout(500)

  /* --------------------------------------------------------- a Bézier circle */

  await page.locator('.scene-header__menus button', { hasText: 'Add' }).first().click()
  await page.waitForSelector('[role="menuitem"]', { timeout: 10000 })
  await page.locator('[role="menuitem"]', { hasText: 'Bézier circle' }).first().click()
  await page.waitForTimeout(600)

  const added = (await scene()).objects.find((object) => object.kind === 'curve')
  check('Add ▸ Bézier circle makes a curve of four knots',
    !!added && added.data.splines?.[0]?.points?.length === 4 && added.data.splines[0].cyclic === true,
    added ? `${added.data.splines[0].points.length} knots, cyclic ${added.data.splines[0].cyclic}` : 'no curve')
  const curveId = added?.id
  const flat = await boundsOf(page, curveId)
  check('and it is drawn as a filled disc with no depth at all',
    !!flat && flat.z < 0.001 && flat.x > 1.9 && flat.x < 2.1,
    flat ? `${flat.x.toFixed(2)} × ${flat.y.toFixed(2)} × ${flat.z.toFixed(3)} m` : 'nothing drawn')

  /* ------------------------------------------------------------- the bevel */

  await page.locator('.scene-properties__tab[aria-label="Data"]').click()
  await page.waitForTimeout(400)
  const geometry = page.locator('[data-section="data-curve-geometry"]')
  await geometry.waitFor()
  if (await geometry.getAttribute('data-open') === 'false') await geometry.locator('.scene-section__title').click()
  await page.waitForTimeout(200)
  check('the Data tab names the curve and counts its knots',
    /Splines/.test(await page.locator('[data-section="data-curve"]').innerText()),
    (await page.locator('[data-section="data-curve"]').innerText()).replace(/\n/g, ' / ').slice(0, 90))

  const bevel = geometry.getByLabel('Bevel depth', { exact: true }).first()
  await bevel.fill('0.2')
  await bevel.press('Enter')
  await page.waitForTimeout(700)
  const tube = await boundsOf(page, curveId)
  check('a bevel sweeps the curve into a tube, thick in every direction',
    !!tube && Math.abs(tube.z - 0.4) < 0.02 && Math.abs(tube.x - 2.4) < 0.05,
    tube ? `${tube.x.toFixed(2)} × ${tube.y.toFixed(2)} × ${tube.z.toFixed(2)} m` : 'nothing drawn')
  log(`MEASURE bevelled circle: ${tube ? `${tube.x.toFixed(2)} × ${tube.y.toFixed(2)} × ${tube.z.toFixed(2)} m` : 'nothing'}`)
  await shot('scene-curve-bevel-1440.png')

  /* ------------------------------------------------------ editing one knot */

  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(600)
  check('Tab opens the curve for editing', (await scene()).view.mode === 'edit', (await scene()).view.mode)

  const stats = await page.locator('.scene-status__stats').textContent()
  check('the status bar counts the knots and their handles', /Verts 0\/12/.test(stats), stats)

  // The knot at (-1, 0, 0), which is where the circle starts.
  const knot = await helpers.project3d([-1, 0, 0])
  await page.mouse.click(knot.x, knot.y)
  await page.waitForTimeout(400)
  const selected = await page.locator('.scene-status__stats').textContent()
  check('a click takes hold of the knot under the pointer', /Verts [1-3]\/12/.test(selected), selected)

  const before = await boundsOf(page, curveId)
  await page.keyboard.press('KeyG')
  await page.mouse.move(knot.x - 90, knot.y)
  await page.waitForTimeout(150)
  await page.mouse.click(knot.x - 90, knot.y)
  await page.waitForTimeout(600)
  const after = await boundsOf(page, curveId)
  check('G moves the knot, and the curve it draws goes with it',
    !!after && !!before && after.x > before.x + 0.3,
    `${before?.x.toFixed(2)} m → ${after?.x.toFixed(2)} m across`)
  const moved = (await scene()).objects.find((object) => object.id === curveId)
  check('and the handles came with the knot rather than staying behind',
    Math.abs(moved.data.splines[0].points[0].left[0] - moved.data.splines[0].points[0].co[0]) < 0.001,
    `knot ${moved.data.splines[0].points[0].co.map((v) => v.toFixed(2)).join(', ')}`)
  await shot('scene-curve-edit-1440.png')

  /* --------------------------------------------- the menu the curve replaces */

  const menus = await page.locator('.scene-header__menus button').allInnerTexts()
  check('edit mode offers Curve rather than Vertex, Edge and Face',
    menus.includes('Curve') && !menus.includes('Vertex'), menus.join(', '))

  // ⌥C on a ring opens it, which is the one change a person can read off the drawn curve at once.
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(300)
  await page.keyboard.press('Alt+KeyC')
  await page.waitForTimeout(600)
  const opened = (await scene()).objects.find((object) => object.id === curveId)
  check('⌥C opens the ring, and ⌥C again closes it', opened.data.splines[0].cyclic === false, `cyclic ${opened.data.splines[0].cyclic}`)
  await page.keyboard.press('Alt+KeyC')
  await page.waitForTimeout(500)

  // V sets the handle type on everything selected; the redo panel then offers the other three.
  await page.keyboard.press('KeyV')
  await page.waitForTimeout(600)
  const aligned = (await scene()).objects.find((object) => object.id === curveId)
  check('V sets the handle type of every selected knot',
    aligned.data.splines[0].points.every((point) => point.leftType === 'aligned' && point.rightType === 'aligned'),
    aligned.data.splines[0].points.map((point) => point.leftType).join(', '))

  const knots = (await scene()).objects.find((object) => object.id === curveId).data.splines[0].points.length
  await page.locator('.scene-header__menus button', { hasText: 'Curve' }).first().click()
  await page.waitForSelector('[role="menuitem"]', { timeout: 10000 })
  await page.locator('[role="menuitem"]', { hasText: 'Subdivide' }).first().click()
  await page.waitForTimeout(700)
  const cut = (await scene()).objects.find((object) => object.id === curveId).data.splines[0].points.length
  check('Subdivide puts a knot in the middle of every selected span', cut === knots * 2, `${knots} → ${cut} knots`)

  await page.keyboard.press('Control+KeyZ')
  await page.waitForTimeout(500)
  // Undo restores the mode along with everything else, so leaving is waited for rather than assumed.
  for (let attempt = 0; attempt < 5 && (await scene()).view.mode !== 'object'; attempt += 1) {
    await page.locator('#main').focus()
    await page.keyboard.press('Tab')
    await page.waitForTimeout(400)
  }
  check('Tab closes the curve again', (await scene()).view.mode === 'object', (await scene()).view.mode)

  /* ---------------------------------------------------------------- the text */

  await page.locator('.scene-header__menus button', { hasText: 'Add' }).first().click()
  await page.waitForSelector('[role="menuitem"]', { timeout: 10000 })
  await page.locator('[role="menuitem"]', { hasText: 'Text' }).first().click()
  await page.waitForTimeout(900)
  const text = (await scene()).objects.find((object) => object.kind === 'text')
  check('Add ▸ Text makes a text object with a body and a font', !!text && text.data.body === 'Text' && !!text.data.font,
    text ? `${text.data.body} in ${text.data.font}` : 'no text object')
  const textId = text?.id

  const drawn = await page.waitForFunction((id) => {
    const found = window.__paramrigScene.bounds([id])
    return found && found.max[0] - found.min[0] > 0.5 ? { x: found.max[0] - found.min[0] } : null
  }, textId, { timeout: 15000 }).then((handle) => handle.jsonValue()).catch(() => null)
  check('the font arrives and the letters are drawn without a reload', !!drawn, drawn ? `${drawn.x.toFixed(2)} m wide` : 'nothing drawn')

  await page.locator('.scene-properties__tab[aria-label="Data"]').click()
  await page.waitForTimeout(400)
  const body = page.locator('[data-section="data-text"]').getByLabel('Body', { exact: true }).first()
  await body.fill('ParamRig')
  await body.press('Enter')
  await page.waitForTimeout(700)
  const textGeometry = page.locator('[data-section="data-text-geometry"]')
  if (await textGeometry.getAttribute('data-open') === 'false') await textGeometry.locator('.scene-section__title').click()
  const extrude = textGeometry.getByLabel('Extrude', { exact: true }).first()
  await extrude.fill('0.12')
  await extrude.press('Enter')
  await page.waitForTimeout(800)

  const word = await boundsOf(page, textId)
  check('“ParamRig” is eight letters wide and as deep as the extrude asks',
    !!word && word.x > 3 && Math.abs(word.z - 0.24) < 0.01,
    word ? `${word.x.toFixed(2)} × ${word.y.toFixed(2)} × ${word.z.toFixed(2)} m` : 'nothing drawn')
  log(`MEASURE extruded ParamRig: ${word ? `${word.x.toFixed(2)} × ${word.y.toFixed(2)} × ${word.z.toFixed(2)} m` : 'nothing'}`)

  // Framed, so the capture is of the letters rather than of the scene they sit in.
  await page.locator('#main').focus()
  await page.keyboard.press('NumpadDecimal')
  await page.waitForTimeout(700)
  await shot('scene-text-extruded-1440.png')

  /* ------------------------------------------------------------ the convert */

  const counted = Object.keys((await scene()).meshes).length
  await page.locator('[data-section="data-text-geometry"] .scene-button', { hasText: 'To mesh' }).click()
  await page.waitForTimeout(900)
  const converted = (await scene()).objects.find((object) => object.id === textId)
  const meshes = (await scene()).meshes
  const built = converted?.data.kind === 'mesh' ? meshes[converted.data.meshId] : null
  check('Convert to mesh replaces the text with the geometry it was drawing',
    converted?.kind === 'mesh' && !!built && built.faces.length > 100,
    built ? `${built.vertexIds.length} vertices, ${built.faces.length} faces` : `still ${converted?.kind}`)
  check('and it is a mesh the document holds, not one made on the way past',
    Object.keys(meshes).length === counted + 1, `${counted} → ${Object.keys(meshes).length} meshes`)

  await page.keyboard.press('Control+KeyZ')
  await page.waitForTimeout(700)
  const undone = (await scene()).objects.find((object) => object.id === textId)
  check('one undo brings the text back, still saying what it said',
    undone?.kind === 'text' && undone.data.body === 'ParamRig', `${undone?.kind}: ${undone?.data.body ?? '—'}`)
})
