import { run } from './lib.mjs'

/**
 * Chantier M: a scene that carries its own controls.
 *
 * The document is seeded rather than built by hand — exposing a field is the next chantier's work,
 * and what is being tested here is what happens once a binding exists: the editor draws the scene
 * as the controls say, the workbench tunes it, and the switch between the two moves one viewport
 * rather than building a second.
 */
export default run('scene-rig', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })

  /* ------------------------------------------------- a control on a subdivision */

  await helpers.seedScene((document) => {
    const cube = document.objects.find((object) => object.data.kind === 'mesh')
    const modifier = {
      id: 'modifier-detail',
      kind: 'subsurf',
      name: 'Subdivision',
      enabled: { viewport: true, render: true, editMode: true, onCage: false },
      params: { levels: 1, renderLevels: 2, simple: false, optimalDisplay: false, boundarySmooth: 'all', useCreases: true },
    }
    return {
      objects: document.objects.map((object) => (object.id === cube.id ? { ...object, modifiers: [modifier] } : object)),
      rig: {
        groups: [{ id: 'main', label: 'Main' }],
        parameters: [
          { kind: 'number', id: 'detail', label: 'Detail', group: 'main', min: 0, max: 4, step: 1, defaultValue: 1 },
          { kind: 'number', id: 'lift', label: 'Lift', group: 'main', min: 0, max: 4, step: 0.1, defaultValue: 0 },
        ],
        bindings: [
          { id: 'binding-detail', objectId: cube.id, property: 'modifiers[modifier-detail].levels', parameterId: 'detail' },
          { id: 'binding-lift', objectId: cube.id, property: 'transform.position.z', parameterId: 'lift' },
        ],
      },
    }
  })

  const scene = await helpers.scene()
  check('the document keeps its rig through storage and the sanitiser',
    scene.rig?.bindings?.length === 2 && scene.rig.parameters.length === 2,
    JSON.stringify({ bindings: scene.rig?.bindings?.length ?? 0, parameters: scene.rig?.parameters?.length ?? 0 }))

  const drawn = await page.evaluate(() => window.__paramrigScene.stats())
  check('the editor draws the scene as its controls say, not as the mesh is stored',
    drawn.vertices > 8, `${drawn.vertices} vertices drawn against 8 stored`)
  log(`MEASURE with the control at its default: ${drawn.vertices} vertices, ${drawn.triangles} triangles`)
  await shot('scene-rig-edit-1440.png')

  const contexts = await page.evaluate(() => window.__paramrigSceneLeaks?.viewports ?? 0)
  check('one viewport is alive in the editor', contexts === 1, `${contexts} viewports`)

  /* ------------------------------------------------------------- into Tune mode */

  const documentId = await page.evaluate(() => location.pathname.split('/r/')[1])
  await page.evaluate(() => {
    // The workbench remembers the mode per document; this is the switch the Controls tab will make.
    const key = 'paramrig.scene-inspector.v1'
    const prefs = JSON.parse(localStorage.getItem(key) ?? '{}')
    const id = location.pathname.split('/r/')[1]
    prefs.modes = { ...(prefs.modes ?? {}), [id]: 'tune' }
    localStorage.setItem(key, JSON.stringify(prefs))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.scene-preview', { timeout: 20000 })
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })

  check('Tune mode shows the scene rather than a message', await page.locator('.scene-preview canvas').count() === 1,
    `${await page.locator('.scene-preview canvas').count()} canvases`)
  const inspector = await page.locator('.inspector, [aria-label="Controls"]').count()
  check('and the workbench puts its inspector beside it', inspector > 0, `${inspector} inspectors`)
  await shot('scene-rig-tune-1440.png')

  const tuned = await page.evaluate(() => window.__paramrigSceneLeaks?.viewports ?? 0)
  check('still one viewport: the same one, moved', tuned === 1, `${tuned} viewports`)

  // Tuning means looking at the thing while its controls turn, so the view is the preview's own.
  // A point off the origin, since orbiting turns around the origin and would leave it where it is.
  const beforeOrbit = await page.evaluate(() => window.__paramrigScene.project([2, 0, 0]))
  await page.keyboard.down('Alt')
  // Hovered through the locator rather than by raw coordinates: Playwright scrolls it into view and
  // hit-tests it, which is what puts the pointer where the element actually is.
  await page.locator('.scene-preview__surface').hover({ modifiers: ['Alt'] })
  await page.mouse.down()
  const from = await page.locator('.scene-preview__surface').boundingBox()
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(from.x + from.width / 2 + step * 20, from.y + from.height / 2)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await page.waitForTimeout(600)
  const afterOrbit = await page.evaluate(() => window.__paramrigScene.project([2, 0, 0]))
  check('the preview can be orbited without touching the document',
    !!beforeOrbit && !!afterOrbit && Math.abs(afterOrbit[0] - beforeOrbit[0]) + Math.abs(afterOrbit[1] - beforeOrbit[1]) > 1,
    `${beforeOrbit?.map((value) => value.toFixed(2)).join(',')} → ${afterOrbit?.map((value) => value.toFixed(2)).join(',')}`)

  /* -------------------------------------------------- a control moves the scene */

  const before = await page.evaluate(() => window.__paramrigScene.stats().vertices)
  const field = page.locator('.control', { hasText: 'Detail' }).first().locator('input').first()
  await field.fill('3')
  await field.press('Enter')
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => window.__paramrigScene.stats().vertices)
  check('turning a control up subdivides the mesh it drives', after > before, `${before} → ${after} vertices`)
  log(`MEASURE the control at 3: ${after} vertices`)

  /* ------------------------------------------------------------- back to Edit */

  await page.locator('.workspace-toolbar button', { hasText: 'Edit' }).first().click()
  await page.waitForSelector('.scene-stage', { timeout: 20000 })
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  const back = await page.evaluate(() => window.__paramrigSceneLeaks?.viewports ?? 0)
  check('and back in the editor it is still the one viewport', back === 1, `${back} viewports`)

  const kept = await page.evaluate(() => window.__paramrigScene.stats().vertices)
  check('the editor draws what the control was left at', kept === after, `${kept} against ${after}`)

  /* ------------------------------------------- what the switch must not lose */

  // The view and the selection belong to the person rather than to the mode: crossing to Tune and
  // back is a change of what is on screen, not a reason to be put back at the start.
  await page.locator('.scene-outliner__row', { hasText: 'Cube' }).first().click()
  await page.waitForTimeout(300)
  const box = await helpers.viewportBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down({ button: 'middle' })
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(box.x + box.width / 2 + step * 12, box.y + box.height / 2 + step * 4)
    await page.waitForTimeout(16)
  }
  await page.mouse.up({ button: 'middle' })
  await page.waitForTimeout(700)
  const beforeSwitch = {
    view: (await helpers.scene()).view,
    selected: await page.locator('.scene-status__stats span').first().textContent(),
  }

  // The switch a person makes, from the Controls tab, rather than a reload with the mode seeded.
  await page.locator('.scene-properties__tab[aria-label="Controls"]').click()
  await page.waitForSelector('.scene-controls__mode', { timeout: 10000 })
  await page.locator('.scene-controls__mode button', { hasText: 'Tune' }).click()
  await page.waitForSelector('.scene-preview canvas', { timeout: 20000 })
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })

  // Tune is not a picture: the viewport keeps drawing and the view can still be turned.
  const framesBefore = await page.evaluate(() => window.__paramrigScene.frames())
  await page.locator('.scene-preview__surface').hover({ modifiers: ['Alt'] })
  await page.keyboard.down('Alt')
  await page.mouse.down()
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(box.x + box.width / 2 + step * 14, box.y + box.height / 2)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await page.waitForTimeout(500)
  const framesAfter = await page.evaluate(() => window.__paramrigScene.frames())
  check('Tune keeps drawing rather than freezing on a frame', framesAfter > framesBefore,
    `${framesBefore} → ${framesAfter} frames`)

  await page.locator('.workspace-toolbar button', { hasText: 'Edit' }).first().click()
  await page.waitForSelector('.scene-stage', { timeout: 20000 })
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  await page.waitForTimeout(600)
  const afterSwitch = {
    view: (await helpers.scene()).view,
    selected: await page.locator('.scene-status__stats span').first().textContent(),
  }
  check('and the crossing keeps the view it was left at',
    Math.abs(afterSwitch.view.yaw - beforeSwitch.view.yaw) < 1 && Math.abs(afterSwitch.view.pitch - beforeSwitch.view.pitch) < 1,
    `${beforeSwitch.view.yaw.toFixed(1)}/${beforeSwitch.view.pitch.toFixed(1)} → ${afterSwitch.view.yaw.toFixed(1)}/${afterSwitch.view.pitch.toFixed(1)}`)
  check('and the selection', afterSwitch.selected === beforeSwitch.selected,
    `${beforeSwitch.selected} → ${afterSwitch.selected}`)
  void documentId
})
