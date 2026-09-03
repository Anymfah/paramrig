import { run } from './lib.mjs'

/** Chantier 3: the viewport draws, reads back, survives a lost context, and idles. */
export default run('scene-viewport', async ({ page, check, log, helpers, shot }) => {
  const started = Date.now()
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  await page.waitForFunction(() => window.__paramrigScene.frames() > 0, null, { timeout: 15000 })
  const firstFrame = await page.evaluate(() => window.__paramrigScene.firstFrame())
  log(`MEASURE first frame after ${Date.now() - started} ms of script time, ${Math.round(firstFrame)} ms after load`)
  check('the first frame arrives under 1.5 s', firstFrame < 1500, `${Math.round(firstFrame)} ms`)

  const stats = await page.evaluate(() => window.__paramrigScene.stats())
  check('the scene holds one mesh of eight vertices, twelve edges and six faces',
    stats.meshes === 1 && stats.vertices === 8 && stats.edges === 12 && stats.faces === 6,
    JSON.stringify({ meshes: stats.meshes, vertices: stats.vertices, edges: stats.edges, faces: stats.faces }))
  check('it draws three objects', stats.objects === 3, String(stats.objects))
  check('multisampling is on', stats.samples >= 4, `${stats.samples} samples`)

  // A viewport with nothing happening must not be asking for frames.
  const before = await page.evaluate(() => window.__paramrigScene.invalidateCount())
  await page.waitForTimeout(700)
  const after = await page.evaluate(() => window.__paramrigScene.invalidateCount())
  check('nothing is drawn while nothing happens', before === after, `${before} → ${after}`)

  const framesBefore = await page.evaluate(() => window.__paramrigScene.stats().frames)
  await page.waitForTimeout(500)
  const framesAfter = await page.evaluate(() => window.__paramrigScene.stats().frames)
  check('and no frames are drawn either', framesBefore === framesAfter, `${framesBefore} → ${framesAfter}`)

  // The cube is at the origin; its projection must land inside the viewport.
  const origin = await page.evaluate(() => window.__paramrigScene.project([0, 0, 0]))
  const box = await helpers.viewportBox()
  check('the origin projects inside the viewport', !!origin && origin[0] > 0 && origin[0] < box.width && origin[1] > 0 && origin[1] < box.height,
    JSON.stringify(origin))

  const picked = await page.evaluate(([x, y]) => window.__paramrigScene.pickObject(x, y), origin)
  check('the id buffer finds the cube under the middle of the view', !!picked, String(picked))

  await shot('scene-viewport-1440.png')

  // Losing the context is a thing browsers do; the viewport has to come back without a reload.
  const lost = await page.evaluate(() => window.__paramrigScene.loseContext())
  check('the test can force a context loss', lost === true)
  await page.waitForTimeout(200)
  await page.evaluate(() => window.__paramrigScene.restoreContext())
  await page.waitForTimeout(600)
  const restored = await page.evaluate(() => window.__paramrigScene.stats())
  check('the scene is whole again after the context comes back',
    restored.meshes === 1 && restored.vertices === 8 && restored.contextLost >= 1,
    JSON.stringify({ meshes: restored.meshes, vertices: restored.vertices, lost: restored.contextLost }))
  const pickedAgain = await page.evaluate(([x, y]) => window.__paramrigScene.pickObject(x, y), origin)
  check('and the cube is still pickable', !!pickedAgain, String(pickedAgain))
  await shot('scene-viewport-restored-1440.png')

  // Closing a scene has to give the card back everything it was lent.
  const held = await page.evaluate(() => window.__paramrigScene.stats())
  log(`MEASURE while open: ${held.geometries} geometries, ${held.textures} textures`)
  check('a viewport holds geometry while it is open', held.geometries > 0, `${held.geometries} geometries`)
  // Back to the library the way a person leaves: within the application, not by reloading it —
  // a reload would throw the window away and take the counters with it.
  await page.goBack()
  await page.waitForSelector('.rig-grid')
  await page.waitForTimeout(600)
  const leaks = await page.evaluate(() => window.__paramrigSceneLeaks ?? null)
  log(`MEASURE after closing: ${JSON.stringify(leaks)}`)
  check('and gives all of it back when the scene is closed',
    !!leaks && leaks.viewports === 0 && leaks.geometries === 0 && leaks.textures === 0,
    JSON.stringify(leaks))
  check('and the debug hatch goes with it', await page.evaluate(() => !window.__paramrigScene))

  await page.goForward()
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 15000 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.waitForTimeout(400)
  await shot('scene-viewport-1440-light.png')
  check('the light theme renders too', await page.locator('.scene-canvas').count() === 1)
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
})
