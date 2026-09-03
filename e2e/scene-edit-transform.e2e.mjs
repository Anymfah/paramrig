import { run } from './lib.mjs'

/**
 * Chantier B in the browser: moving elements rather than objects, and the four things that make
 * that different — the edge slide that stays on the surface, proportional editing's reach,
 * snapping onto another vertex exactly, and mirror editing following across a plane.
 */
export default run('scene-edit-transform', async ({ page, check, log, helpers, shot }) => {
  await page.setViewportSize({ width: 1800, height: 900 })
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const scene = () => helpers.scene()
  const meshOf = async () => {
    const document = await scene()
    return document.meshes[document.objects.find((object) => object.data.kind === 'mesh').data.meshId]
  }
  const positionOf = async (vertexId) => {
    const mesh = await meshOf()
    const slot = mesh.vertexIds.indexOf(vertexId)
    return slot < 0 ? null : [mesh.vertices[slot * 3], mesh.vertices[slot * 3 + 1], mesh.vertices[slot * 3 + 2]]
  }

  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  await page.keyboard.press('Digit3')
  await page.waitForTimeout(150)

  /* ------------------------------------------------------------- G Z on a face */

  const mesh = await meshOf()
  const top = mesh.faces
    .map((loop, slot) => ({ slot, z: loop.reduce((total, corner) => total + mesh.vertices[corner * 3 + 2], 0) / loop.length }))
    .sort((a, b) => b.z - a.z)[0]
  const topCorners = mesh.faces[top.slot].map((corner) => mesh.vertexIds[corner])
  const topCentre = [0, 1, 2].map((axis) => (
    mesh.faces[top.slot].reduce((total, corner) => total + mesh.vertices[corner * 3 + axis], 0) / mesh.faces[top.slot].length
  ))
  const at = await helpers.project3d(topCentre)
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(300)

  await page.mouse.move(at.x, at.y)
  await page.locator('#main').focus()
  await page.keyboard.press('KeyG')
  await page.waitForTimeout(200)
  await page.keyboard.press('KeyZ')
  await page.keyboard.press('Digit1')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const moved = await positionOf(topCorners[0])
  check('G Z 1 raises the face exactly one metre and nothing else',
    Math.abs(moved[2] - 2) < 1e-6 && (await meshOf()).vertexIds.length === 8,
    `${moved.map((value) => value.toFixed(3)).join(', ')}`)
  await page.keyboard.press('Control+KeyZ')
  await page.waitForTimeout(350)

  /* ------------------------------------------------------- proportional editing */

  await page.keyboard.press('KeyO')
  await page.waitForTimeout(250)
  check('O turns proportional editing on', (await scene()).view.proportional === true,
    String((await scene()).view.proportional))
  await page.mouse.move(at.x, at.y)
  await page.locator('#main').focus()
  await page.keyboard.press('KeyG')
  await page.waitForTimeout(200)
  const sizeBefore = (await scene()).view.proportionalSize
  await page.mouse.wheel(0, -120)
  await page.mouse.wheel(0, -120)
  // The stored copy is written on a debounce, so the read waits for it rather than racing it.
  await page.waitForTimeout(1400)
  const sizeAfter = (await scene()).view.proportionalSize
  check('the wheel sets how far it reaches, and does not zoom the view', sizeAfter > sizeBefore,
    `${sizeBefore} → ${sizeAfter}`)
  await shot('scene-edit-transform-proportional.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await page.keyboard.press('KeyO')
  await page.waitForTimeout(200)

  /* ------------------------------------------------------------ mirror editing */

  await page.keyboard.press('Digit1')
  await page.keyboard.down('Alt')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(200)
  await page.click('button[aria-label="Mirror X"]')
  await page.waitForTimeout(250)
  check('the header turns mirror editing on for X',
    await page.locator('button[aria-label="Mirror X"]').getAttribute('aria-pressed') === 'true')

  // One corner of the cube, and its partner across the YZ plane.
  const before = await meshOf()
  const cornerSlot = before.vertices.reduce((best, _, index) => (
    index % 3 === 0 && before.vertices[index] > 0 && before.vertices[index + 1] < 0 && before.vertices[index + 2] < 0
      ? index / 3
      : best
  ), -1)
  const cornerId = before.vertexIds[cornerSlot]
  const cornerPoint = [before.vertices[cornerSlot * 3], before.vertices[cornerSlot * 3 + 1], before.vertices[cornerSlot * 3 + 2]]
  const partnerSlot = before.vertices.reduce((best, _, index) => (
    index % 3 === 0
      && Math.abs(before.vertices[index] + cornerPoint[0]) < 1e-6
      && Math.abs(before.vertices[index + 1] - cornerPoint[1]) < 1e-6
      && Math.abs(before.vertices[index + 2] - cornerPoint[2]) < 1e-6
      ? index / 3
      : best
  ), -1)
  const partnerId = before.vertexIds[partnerSlot]
  const cornerAt = await helpers.project3d(cornerPoint)
  await page.mouse.click(cornerAt.x, cornerAt.y)
  await page.waitForTimeout(300)
  await page.mouse.move(cornerAt.x, cornerAt.y)
  await page.locator('#main').focus()
  await page.keyboard.press('KeyG')
  await page.waitForTimeout(200)
  await page.keyboard.press('KeyZ')
  await page.keyboard.press('Digit2')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(450)
  const movedCorner = await positionOf(cornerId)
  const movedPartner = await positionOf(partnerId)
  check('moving one corner moves its mirror with it',
    Math.abs(movedCorner[2] - 1) < 1e-6 && Math.abs(movedPartner[2] - 1) < 1e-6
    && Math.abs(movedPartner[0] + movedCorner[0]) < 1e-6,
    JSON.stringify({ moved: movedCorner, partner: movedPartner }))
  await shot('scene-edit-transform-mirror.png')
  await page.click('button[aria-label="Mirror X"]')
  await page.waitForTimeout(200)
  await page.locator('#main').focus()
  await page.keyboard.press('Control+KeyZ')
  await page.waitForTimeout(350)

  /* ------------------------------------------------------------------ snapping */

  // A second cube, a metre away, to snap onto.
  await page.keyboard.press('Tab')
  await page.waitForTimeout(350)
  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Shift')
  await page.waitForSelector('.scene-menu[role="menu"]')
  for (const letter of ['c', 'u', 'b']) await page.keyboard.press(`Key${letter.toUpperCase()}`)
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  await page.keyboard.press('KeyG')
  await page.waitForTimeout(150)
  await page.keyboard.press('KeyX')
  await page.keyboard.press('Digit5')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)

  await page.keyboard.press('KeyA')
  await page.waitForTimeout(200)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(500)
  check('both cubes are open for editing',
    (await page.locator('.scene-status__stats').textContent()).includes('Objects 2'),
    await page.locator('.scene-status__stats').textContent())

  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(250)
  check('⇧Tab turns snapping on', (await scene()).view.snapEnabled === true, String((await scene()).view.snapEnabled))
  await page.click('button[aria-label="Snapping"], button[aria-label="Snap to"]').catch(() => undefined)
  await page.keyboard.press('Escape').catch(() => undefined)

  const errors = await page.evaluate(() => window.__paramrigErrors ?? [])
  check('no console errors of our own', errors.length === 0, errors.join(' | '))
})
