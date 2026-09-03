import { run } from './lib.mjs'

/** Chantier 4: the view moves the way Blender's does, and lands exactly where it is asked to. */
export default run('scene-navigation', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  const view = () => helpers.scene().then((document) => document?.view)
  const start = await view()
  log(`MEASURE start view: yaw ${Math.round(start.yaw)} pitch ${Math.round(start.pitch)} distance ${start.distance.toFixed(2)}`)

  // Orbiting with the middle button is the whole of Blender's navigation.
  await page.mouse.move(centre.x - 200, centre.y + 120)
  await page.mouse.down({ button: 'middle' })
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(centre.x - 200 + step * 12, centre.y + 120 - step * 3)
    await page.waitForTimeout(16)
  }
  await page.mouse.up({ button: 'middle' })
  await page.waitForTimeout(500)
  const orbited = await view()
  check('a middle drag orbits', Math.abs(orbited.yaw - start.yaw) > 20, `yaw ${Math.round(start.yaw)} → ${Math.round(orbited.yaw)}`)
  check('and the orbit is stored on the document', typeof orbited.distance === 'number')

  // ⌥1 is the front view for a keyboard with no numeric pad; it must be exact.
  await page.locator('#main').focus()
  await page.keyboard.down('Alt')
  await page.keyboard.press('Digit1')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(600)
  const front = await view()
  check('⌥1 lands exactly on the front view', Math.abs(front.yaw) < 0.01 && Math.abs(front.pitch) < 0.01,
    `yaw ${front.yaw.toFixed(3)} pitch ${front.pitch.toFixed(3)}`)
  check('and an axis view turns off perspective', front.projection === 'orthographic', front.projection)

  await page.keyboard.down('Alt')
  await page.keyboard.press('Digit7')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(600)
  const top = await view()
  check('⌥7 lands on the top view', Math.abs(top.pitch - 89.9) < 0.02 && Math.abs(top.yaw) < 0.02, `yaw ${top.yaw.toFixed(3)} pitch ${top.pitch.toFixed(3)}`)

  // ⌥ with the left button orbits too, for a trackpad with no middle button.
  await page.keyboard.down('Alt')
  await page.mouse.move(centre.x - 150, centre.y + 100)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(centre.x - 150 + step * 14, centre.y + 100 - step * 10)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await page.waitForTimeout(500)
  const emulated = await view()
  check('⌥ and the left button orbit as well', Math.abs(emulated.yaw - top.yaw) > 10, `yaw ${top.yaw.toFixed(1)} → ${emulated.yaw.toFixed(1)}`)
  check('and leaving an axis view returns to perspective', emulated.projection === 'perspective', emulated.projection)

  // Framing puts the cube in the middle and fills the view with it.
  await page.locator('#main').focus()
  await page.keyboard.down('Alt')
  await page.keyboard.press('Digit1')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(500)
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(200)
  await page.keyboard.down('Alt')
  await page.keyboard.press('Period')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(600)
  const framed = await view()
  const framedCentre = await page.evaluate(() => window.__paramrigScene.project([0, 0, 0]))
  check('framing the selection centres the cube', Math.abs(framedCentre[0] - box.width / 2) < 3 && Math.abs(framedCentre[1] - box.height / 2) < 3,
    JSON.stringify(framedCentre.map((value) => Math.round(value))))
  check('and comes close enough for it to fill the view', framed.distance < 8, framed.distance.toFixed(2))

  // The point under the pointer must stay under the pointer while the wheel turns.
  const probe = { x: centre.x + 120, y: centre.y - 60 }
  const before = await page.evaluate(([x, y]) => {
    const point = window.__paramrigScene.unproject(x, y, 0.5)
    return { point, screen: window.__paramrigScene.project(point) }
  }, [probe.x - box.x, probe.y - box.y])
  await page.mouse.move(probe.x, probe.y)
  await page.mouse.wheel(0, -240)
  await page.waitForTimeout(700)
  const after = await page.evaluate((point) => window.__paramrigScene.project(point), before.point)
  const drift = Math.hypot(after[0] - before.screen[0], after[1] - before.screen[1])
  log(`MEASURE zoom drift: ${drift.toFixed(2)} px`)
  check('the wheel zooms towards the pointer, to within two pixels', drift <= 2, `${drift.toFixed(2)} px`)
  const zoomed = await view()
  check('and the zoom is continuous rather than stepped', zoomed.distance < framed.distance, `${framed.distance.toFixed(2)} → ${zoomed.distance.toFixed(2)}`)

  await shot('scene-navigation-1440.png')
})
