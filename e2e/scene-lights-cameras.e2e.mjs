import { run } from './lib.mjs'

/**
 * Chantier J: what a light is shaped like, and what the camera sees.
 *
 * The two checks that matter are the ones a panel cannot make on its own: a handle dragged on the
 * spot's cone has to reach the document, and the camera view has to show the frame the camera will
 * actually render — which is why the capture is taken and the frame is measured against the render
 * aspect rather than merely photographed.
 */
export default run('scene-lights-cameras', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })

  /* --------------------------------------------------- a spot, and its handle */

  await page.locator('.scene-outliner__row', { hasText: 'Light' }).first().click()
  await page.waitForTimeout(300)
  await page.locator('.scene-properties__tab[aria-label="Data"]').click()
  await page.waitForSelector('.scene-section[data-section="data-light"]')
  // The startup light is a point; a spot is what has a cone to drag.
  await page.locator('.scene-section[data-section="data-light"] .segment__opt', { hasText: 'Spot' }).first().click()
  await page.waitForTimeout(500)
  let scene = await helpers.scene()
  let light = scene.objects.find((object) => object.name === 'Light')
  check('the light becomes a spot', light.data.light === 'spot', light.data.light)

  const grip = page.locator('.scene-light-handles__grip').first()
  check('and its cone offers a handle', await grip.count() === 1, `${await grip.count()} handles`)
  const before = light.data.spotAngle
  const box = await grip.boundingBox()
  const centre = await page.evaluate(() => {
    const line = document.querySelector('.scene-light-handles__stem')
    const svg = document.querySelector('.scene-light-handles').getBoundingClientRect()
    return { x: svg.left + Number(line.getAttribute('x1')), y: svg.top + Number(line.getAttribute('y1')) }
  })
  // Dragged away from the axis, so the cone widens: the same gesture a person makes.
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const away = { x: centre.x + (from.x - centre.x) * 1.8, y: centre.y + (from.y - centre.y) * 1.8 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(away.x, away.y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  scene = await helpers.scene()
  light = scene.objects.find((object) => object.name === 'Light')
  check('dragging the handle widens the cone in the document',
    light.data.spotAngle > before + 5, `${before}° → ${light.data.spotAngle.toFixed(1)}°`)
  log(`MEASURE spot angle after the drag: ${light.data.spotAngle.toFixed(1)}°`)
  await shot('scene-lights-spot-1440.png')

  /* ------------------------------------------------------------ camera view */

  await page.locator('#main').focus()
  await page.keyboard.press('Numpad0')
  await page.waitForTimeout(700)
  scene = await helpers.scene()
  check('Numpad 0 looks through the active camera', scene.view.camera?.looking === true,
    JSON.stringify(scene.view.camera ?? null))

  const frame = await page.evaluate(() => {
    const rect = document.querySelector('.scene-camera-frame__border')
    if (!rect) return null
    return {
      width: Number(rect.getAttribute('width')),
      height: Number(rect.getAttribute('height')),
      x: Number(rect.getAttribute('x')),
      y: Number(rect.getAttribute('y')),
    }
  })
  check('the passe-partout draws the frame the camera will render',
    !!frame && Math.abs(frame.width / frame.height - 16 / 9) < 0.01,
    frame ? `${frame.width.toFixed(0)}×${frame.height.toFixed(0)}` : 'none')
  await shot('scene-camera-view-1440.png')

  // What is inside the frame is what the camera sees: the cube should be inside it, since the
  // startup camera is aimed at the origin.
  const cubeAt = await helpers.project3d([0, 0, 0])
  const viewport = await helpers.viewportBox()
  const inside = cubeAt && frame
    && cubeAt.local[0] > frame.x && cubeAt.local[0] < frame.x + frame.width
    && cubeAt.local[1] > frame.y && cubeAt.local[1] < frame.y + frame.height
  check('and the cube the camera is aimed at falls inside it', !!inside,
    cubeAt ? `${cubeAt.local[0].toFixed(0)},${cubeAt.local[1].toFixed(0)} in ${frame?.width.toFixed(0)}×${frame?.height.toFixed(0)}` : 'not projected')
  void viewport

  /* ------------------------------------------------- leaving, and camera to view */

  await page.keyboard.press('Numpad0')
  await page.waitForTimeout(500)
  scene = await helpers.scene()
  check('Numpad 0 again leaves it, standing where the camera stood',
    scene.view.camera?.looking === false, JSON.stringify(scene.view.camera ?? null))

  // Turn the view somewhere of its own, then give that to the camera.
  await page.keyboard.press('Numpad4')
  await page.keyboard.press('Numpad8')
  await page.waitForTimeout(400)
  const turned = await helpers.scene()
  await page.keyboard.press('Control+Alt+Numpad0')
  await page.waitForTimeout(600)
  scene = await helpers.scene()
  const camera = scene.objects.find((object) => object.data.kind === 'camera')
  check('⌃⌥Numpad 0 moves the camera to the view and looks through it',
    scene.view.camera?.looking === true
      && Math.abs(camera.transform.rotation[2] - (180 - turned.view.yaw)) < 0.5,
    `camera z ${camera.transform.rotation[2].toFixed(1)}° against view yaw ${turned.view.yaw.toFixed(1)}°`)

  /* --------------------------------------------------- lock camera to view */

  // Through the sidebar rather than through storage: the switch is the thing being tested.
  await page.locator('#main').focus()
  await page.keyboard.press('KeyN')
  await page.waitForSelector('.scene-sidebar')
  await page.locator('.scene-sidebar__tab', { hasText: 'View' }).click()
  await page.waitForTimeout(200)
  await page.locator('.control--switch', { hasText: 'Lock camera to view' }).locator('button[role="switch"]').click()
  await page.waitForTimeout(400)
  const lockState = await helpers.scene()
  check('the sidebar switch locks the camera to the view', lockState.view.camera?.lock === true,
    JSON.stringify(lockState.view.camera ?? null))
  await page.locator('#main').focus()
  const locked = await helpers.scene()
  const placed = locked.objects.find((object) => object.data.kind === 'camera').transform.position
  await page.keyboard.press('Numpad6')
  await page.waitForTimeout(600)
  scene = await helpers.scene()
  const moved = scene.objects.find((object) => object.data.kind === 'camera').transform.position
  check('with the camera locked to the view, navigating moves the camera itself',
    Math.hypot(moved[0] - placed[0], moved[1] - placed[1], moved[2] - placed[2]) > 0.01,
    `${placed.map((value) => value.toFixed(2)).join(', ')} → ${moved.map((value) => value.toFixed(2)).join(', ')}`)
  check('and the view is still looking through it', scene.view.camera?.looking === true,
    JSON.stringify(scene.view.camera ?? null))
})
