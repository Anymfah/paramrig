import { run } from './lib.mjs'

/**
 * Chantier C in the browser: E, I and ⌃B as gestures rather than as functions.
 *
 * The unit tests already prove the geometry. What only a browser can prove is that the key opens a
 * gesture, that the pointer drives it, that the header says which keys are live, that a typed
 * number lands exactly, that the wheel adds a segment and that Escape puts everything back.
 */
export default run('scene-extrude-bevel', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const scene = () => helpers.scene()
  const meshOf = async () => {
    const document = await scene()
    return document.meshes[document.objects.find((object) => object.data.kind === 'mesh').data.meshId]
  }
  const counts = async () => {
    const mesh = await meshOf()
    return { vertices: mesh.vertexIds.length, edges: mesh.edges.length, faces: mesh.faces.length }
  }
  const hud = () => page.locator('.scene-hud').textContent()

  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  await page.keyboard.press('Digit3')
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(250)
  check('the whole cube is open with every face selected', (await counts()).faces === 6, JSON.stringify(await counts()))

  /* ------------------------------------------------------------------ extrude */

  // One face: the top one, picked by projecting its centre.
  await page.keyboard.down('Alt')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(200)
  const mesh = await meshOf()
  const top = mesh.faces
    .map((loop, slot) => ({ slot, z: loop.reduce((total, corner) => total + mesh.vertices[corner * 3 + 2], 0) / loop.length }))
    .sort((a, b) => b.z - a.z)[0]
  const topCentre = [0, 1, 2].map((axis) => (
    mesh.faces[top.slot].reduce((total, corner) => total + mesh.vertices[corner * 3 + axis], 0) / mesh.faces[top.slot].length
  ))
  const at = await helpers.project3d(topCentre)
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(300)
  check('clicking the top face selects one face',
    (await page.locator('.scene-status__stats').textContent()).includes('Faces 1/6'),
    await page.locator('.scene-status__stats').textContent())

  await page.mouse.move(at.x, at.y)
  await page.locator('#main').focus()
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(300)
  check('E opens a gesture and says so beside the pointer', (await hud()).length > 0, await hud())
  const header = await page.locator('.scene-modal-header').textContent()
  check('and the header lists the keys that are live', header.includes('Escape') && header.includes('X Y Z'), header)

  // A typed number is exact, whatever the pointer did.
  await page.keyboard.press('Digit2')
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const extruded = await counts()
  check('E with a typed 2 raises the face and leaves the cube closed',
    extruded.vertices === 12 && extruded.faces === 10, JSON.stringify(extruded))
  const raised = await meshOf()
  const lifted = Math.max(...raised.vertexIds.map((_, slot) => raised.vertices[slot * 3 + 2]))
  check('and the face is exactly two metres up', Math.abs(lifted - 3) < 1e-6, `${lifted} m`)
  await shot('scene-extrude-bevel-extruded.png')

  // The whole gesture is one step in the history.
  await page.keyboard.press('Control+KeyZ')
  await page.waitForTimeout(400)
  check('one undo takes back the whole extrusion', (await counts()).faces === 6, JSON.stringify(await counts()))
  await page.keyboard.press('Control+Shift+KeyZ')
  await page.waitForTimeout(400)
  check('and redo puts it back', (await counts()).faces === 10, JSON.stringify(await counts()))

  /* -------------------------------------------------------------------- inset */

  await page.mouse.move(centre.x, centre.y - 60)
  await page.locator('#main').focus()
  await page.keyboard.press('KeyI')
  await page.waitForTimeout(250)
  const insetHud = await hud()
  check('I opens the inset gesture with its own readout', insetHud.includes('Thickness'), insetHud)
  await page.keyboard.press('Period')
  await page.keyboard.press('Digit3')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const inset = await counts()
  check('I with a typed 0.3 insets the face', inset.faces === 14 && inset.vertices === 16, JSON.stringify(inset))

  /* -------------------------------------------------------------------- bevel */

  await page.keyboard.press('Digit2')
  await page.waitForTimeout(200)
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(200)
  await page.keyboard.down('Alt')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(200)

  // One edge of the base, found through the id buffer.
  const current = await meshOf()
  let edgeAt = null
  for (let edge = 0; edge < current.edges.length && !edgeAt; edge += 1) {
    const [a, b] = current.edges[edge]
    const middle = [0, 1, 2].map((axis) => (current.vertices[a * 3 + axis] + current.vertices[b * 3 + axis]) / 2)
    const where = await helpers.project3d(middle)
    if (!where) continue
    const found = await page.evaluate(([x, y]) => window.__paramrigScene.pickElements(x, y, 8), where.local)
    if (found.edge) edgeAt = where
  }
  await page.mouse.click(edgeAt.x, edgeAt.y)
  await page.waitForTimeout(300)
  const beforeBevel = await counts()

  await page.mouse.move(edgeAt.x, edgeAt.y)
  await page.locator('#main').focus()
  await page.keyboard.press('Control+KeyB')
  await page.waitForTimeout(250)
  const bevelHud = await hud()
  check('⌃B opens the bevel with width, segments and profile in its readout',
    bevelHud.includes('Width') && bevelHud.includes('Segments') && bevelHud.includes('Profile'), bevelHud)

  // The wheel adds segments, without the view moving.
  const distanceBefore = (await scene()).view.distance
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(150)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(200)
  const segmentsHud = await hud()
  check('the wheel adds segments rather than zooming', segmentsHud.includes('Segments 3'), segmentsHud)
  check('and the view has not moved', Math.abs((await scene()).view.distance - distanceBefore) < 1e-6,
    `${(await scene()).view.distance} vs ${distanceBefore}`)

  await page.keyboard.press('Period')
  await page.keyboard.press('Digit2')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const bevelled = await counts()
  check('⌃B at three segments adds the strip it promised',
    bevelled.faces > beforeBevel.faces && bevelled.vertices > beforeBevel.vertices,
    JSON.stringify({ before: beforeBevel, after: bevelled }))
  await shot('scene-extrude-bevel-bevelled.png')

  /* ---------------------------------------------------------------- F9 replay */

  await page.keyboard.press('F9')
  await page.waitForSelector('.scene-redo__body')
  const segments = page.locator('.scene-redo__body .control', { hasText: 'Segments' }).locator('input').first()
  await segments.fill('1')
  await segments.press('Enter')
  await page.waitForTimeout(500)
  const replayed = await counts()
  check('F9 re-runs the bevel with one segment instead of three',
    replayed.faces < bevelled.faces, JSON.stringify({ three: bevelled, one: replayed }))

  /* ------------------------------------------------------------------ Escape */

  const settled = await counts()
  await page.mouse.move(centre.x, centre.y)
  await page.locator('#main').focus()
  await page.keyboard.press('KeyA')
  await page.keyboard.press('Digit3')
  await page.waitForTimeout(200)
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(200)
  await page.mouse.move(centre.x + 60, centre.y - 60)
  await page.waitForTimeout(150)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check('Escape leaves the mesh exactly as it was', JSON.stringify(await counts()) === JSON.stringify(settled),
    JSON.stringify({ before: settled, after: await counts() }))
  check('and the readout is gone', (await page.locator('.scene-hud').count()) === 0 || !(await hud()),
    String(await page.locator('.scene-hud').count()))

  const errors = await page.evaluate(() => window.__paramrigErrors ?? [])
  check('no console errors of our own', errors.length === 0, errors.join(' | '))
})
