import { run } from './lib.mjs'

/**
 * Chantier R: shape keys.
 *
 * A shape key is a difference from the mesh as it is stored, and everything worth checking follows
 * from that one sentence: scrubbing a key changes what is drawn and never the document's mesh,
 * sculpting with a key on writes the key rather than the mesh, and a controller bound to the key's
 * value moves the model in the frame after it is moved.
 */

/** A grid of quads, flat on the ground, to shape. Sized through the page: `seedScene` sends source. */
const buildGrid = (stored) => {
  const side = window.__side
  const span = side + 1
  const vertices = []
  const vertexIds = []
  for (let row = 0; row < span; row += 1) {
    for (let column = 0; column < span; column += 1) {
      vertices.push(column - side / 2, row - side / 2, 0)
      vertexIds.push(row * span + column)
    }
  }
  const faces = []
  const faceIds = []
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const slot = row * span + column
      faces.push([slot, slot + 1, slot + span + 1, slot + span])
      faceIds.push(faceIds.length)
    }
  }
  return {
    objects: [{
      id: 'object-slab',
      name: 'Slab',
      kind: 'mesh',
      collectionId: stored.collections[0].id,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [8 / side, 8 / side, 8 / side] },
      visible: true,
      selectable: true,
      renderable: true,
      data: { kind: 'mesh', meshId: 'mesh-slab' },
      modifiers: [],
      materialSlots: [],
    }, ...stored.objects.filter((object) => object.kind !== 'mesh')],
    meshes: {
      'mesh-slab': {
        vertices,
        vertexIds,
        nextVertexId: span * span,
        edges: [],
        faces,
        faceIds,
        nextFaceId: faces.length,
        attributes: { face: { smooth: faces.map(() => true), material: faces.map(() => 0) }, edge: {}, vertex: {} },
      },
    },
    view: {
      ...stored.view,
      mode: 'object',
      target: [0, 0, 0],
      yaw: 25,
      pitch: 42,
      distance: 14,
      sculpt: { ...stored.view.sculpt, size: 110, strength: 1.5 },
    },
  }
}

/** How tall the drawn object is: the one number that says whether a key is doing anything. */
const drawnHeight = (page) => page.evaluate(() => {
  // The slab alone: the scene's own bounds hold the light and the camera, which are metres tall and
  // would drown the millimetres a shape key moves.
  const box = window.__paramrigScene.bounds(['object-slab'])
  return box ? box.max[2] - box.min[2] : 0
})

export default run('scene-shape-keys', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  await page.evaluate(() => { window.__side = 32 })
  await helpers.seedScene(buildGrid)
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })

  const box = await helpers.viewportBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(400)

  /* ------------------------------------------------------------- a key is made */

  await page.locator('.scene-properties__tab[aria-label="Data"]').click()
  await page.waitForTimeout(400)
  const section = page.locator('[data-section="data-mesh-shape-keys"]')
  await section.waitFor()
  if (await section.getAttribute('data-open') === 'false') await section.locator('.scene-section__title').click()
  check('Data carries a Shape keys section, and it says what a key is for',
    /No shape keys/.test(await section.innerText()), (await section.innerText()).split('\n').slice(0, 2).join(' / '))
  await section.locator('.scene-button', { hasText: 'Add' }).click()
  await page.waitForTimeout(500)
  const made = (await helpers.scene()).objects.find((object) => object.id === 'object-slab')
  check('Add makes a key, holding no difference yet',
    made.shapeKeys?.length === 1 && Object.keys(made.shapeKeys[0].offsets).length === 0,
    `${made.shapeKeys?.length ?? 0} keys, ${Object.keys(made.shapeKeys?.[0]?.offsets ?? {}).length} offsets`)

  /* -------------------------------------------------- sculpting writes the key */

  await page.getByLabel('Key', { exact: true }).first().fill('1')
  await page.getByLabel('Key', { exact: true }).first().press('Enter')
  await page.waitForTimeout(400)

  await page.locator('button.scene-header__mode').click()
  await page.locator('[role="menuitemradio"]', { hasText: 'Sculpt mode' }).click()
  await page.waitForTimeout(600)

  const meshBefore = JSON.stringify(Object.values((await helpers.scene()).meshes)[0].vertices)
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.5)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(box.x + box.width * (0.42 + 0.014 * step), box.y + box.height * 0.5)
    await page.waitForTimeout(30)
  }
  await page.mouse.up()
  await page.waitForTimeout(900)

  const shaped = (await helpers.scene()).objects.find((object) => object.id === 'object-slab')
  const offsets = Object.keys(shaped.shapeKeys[0].offsets).length
  check('a stroke with a key on goes into the key', offsets > 20, `${offsets} vertices offset`)
  check('and the mesh itself is exactly where it was',
    JSON.stringify(Object.values((await helpers.scene()).meshes)[0].vertices) === meshBefore, 'unchanged')
  const raised = await drawnHeight(page)
  check('while what is drawn has the shape in it', raised > 0.05, `${raised.toFixed(3)} m tall`)
  log(`MEASURE a stroke into a shape key: ${offsets} offsets, ${raised.toFixed(3)} m of relief`)
  await shot('scene-shape-keys-sculpted-1440.png')

  /* ------------------------------------------------------- the value scrubs it */

  await page.locator('button.scene-header__mode').click()
  await page.locator('[role="menuitemradio"]', { hasText: 'Object mode' }).click()
  await page.waitForTimeout(500)
  await page.locator('.scene-properties__tab[aria-label="Data"]').click()
  await page.waitForTimeout(300)
  await page.getByLabel('Key', { exact: true }).first().fill('0')
  await page.getByLabel('Key', { exact: true }).first().press('Enter')
  await page.waitForTimeout(600)
  const flat = await drawnHeight(page)
  check('turning the key off gives the model back exactly as it was modelled',
    flat < 0.001, `${flat.toFixed(4)} m tall`)

  /* ------------------------------------------------------------ I keys a channel */

  /*
   * Blender's I makes an action out of nothing. Here it makes a *control* out of nothing and keys
   * that — one animation system rather than two — so what this checks is the whole chain: the press
   * makes three controls, the keyframes land on them, and the playhead moves the model.
   */
  await page.locator('#main').focus()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.press('KeyI')
  await page.waitForSelector('[role="menu"]')
  const channels = await page.locator('[role="menu"] [role="menuitem"]').allInnerTexts()
  check('I offers the channels Blender offers', channels.join(' / ').includes('Location'), channels.join(' / '))
  await page.locator('[role="menuitem"]', { hasText: 'Location, rotation and scale' }).click()
  await page.waitForTimeout(900)

  const keyed = await helpers.scene()
  const tracks = keyed.rig?.animation?.tracks ?? []
  check('one press makes the controls the channels need and keys them all',
    (keyed.rig?.parameters?.length ?? 0) >= 9 && tracks.length >= 9,
    `${keyed.rig?.parameters?.length ?? 0} controls, ${tracks.length} tracks`)
  check('and the transport appears, because there is now something to play',
    await page.locator('[aria-label="Playback"]').count() === 1,
    `${await page.locator('[aria-label="Playback"]').count()} transports`)

  // A second keyframe, a second apart, with the object somewhere else.
  await page.locator('[aria-label="Step forward one frame"]').click({ clickCount: 30, delay: 10 })
  await page.waitForTimeout(400)
  const frameText = await page.locator('.scene-status__frame').innerText()
  const frame = Number(/Frame (\d+)/.exec(frameText)?.[1] ?? 0)
  check('the transport counts frames, and steps one at a time', frame > 0, frameText)

  await page.locator('#main').focus()
  await page.keyboard.press('KeyG')
  await page.waitForTimeout(200)
  await page.keyboard.press('KeyZ')
  await page.keyboard.type('3')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.press('KeyI')
  await page.waitForSelector('[role="menu"]')
  await page.locator('[role="menuitem"]', { hasText: 'Location, rotation and scale' }).click()
  await page.waitForTimeout(900)

  const twice = (await helpers.scene()).rig.animation.tracks
  const keysPerTrack = Math.max(...twice.map((track) => track.keyframes.length))
  check('a second press at a later frame leaves two keyframes on the channel that changed',
    keysPerTrack === 2, `${keysPerTrack} keyframes at most`)

  /** Where the object is drawn, which is what an animation is for. */
  const drawnAt = () => page.evaluate(() => {
    const bounds = window.__paramrigScene.bounds(['object-slab'])
    return bounds ? (bounds.min[2] + bounds.max[2]) / 2 : 0
  })
  const atEnd = await drawnAt()
  await page.locator('[aria-label="Step back one frame"]').click({ clickCount: 30, delay: 10 })
  await page.waitForTimeout(600)
  const atStart = await drawnAt()
  check('and the playhead moves the model between them',
    Math.abs(atEnd - atStart) > 1, `${atStart.toFixed(2)} at the start, ${atEnd.toFixed(2)} at the end`)
  log(`MEASURE the keyed slide: ${atStart.toFixed(2)} m at frame 0, ${atEnd.toFixed(2)} m at frame 30`)

  // And the field a curve drives says so, in the animation's own colour. The Object tab is where
  // the location lives, and the location is what has just been keyed.
  await page.locator('.scene-properties__tab[aria-label="Object"]').click()
  await page.waitForTimeout(400)
  const animated = await page.locator('.scene-exposable[data-animated]').count()
  check('an animated field is marked as one', animated > 0, `${animated} fields`)
  await shot('scene-shape-keys-animated-1440.png')

  await page.locator('[aria-label="Play"]').click()
  await page.waitForTimeout(700)
  const playing = await page.locator('[aria-label="Pause"]').count()
  check('and it plays', playing === 1, `${playing} pause buttons`)
  await page.locator('[aria-label="Pause"]').click()
  await page.waitForTimeout(300)

  /* -------------------------------------------------- and a controller drives it */

  await page.locator('.scene-properties__tab[aria-label="Data"]').click()
  await page.waitForTimeout(400)
  await page.getByLabel(/^Expose Key/).first().click()
  await page.waitForSelector('[aria-label="Expose as control"]')
  await page.locator('[aria-label="Expose as control"] button', { hasText: 'Expose' }).click()
  await page.waitForTimeout(600)
  const rig = (await helpers.scene()).rig
  check('the ◇ makes a control out of the key’s value',
    (rig?.bindings ?? []).some((binding) => binding.property === 'shapeKeys[Key].value'),
    `${rig?.parameters?.length ?? 0} parameters, ${(rig?.bindings ?? []).map((binding) => binding.property).join(', ')}`)

  await page.locator('.scene-properties__tab[aria-label="Controls"]').click()
  await page.waitForTimeout(400)
  // Controls opens in Edit, which is where a rig is built; Tune is where it is played.
  await page.locator('.scene-properties button', { hasText: /^Tune$/ }).first().click()
  await page.waitForTimeout(300)
  await page.getByLabel('Key', { exact: true }).first().fill('1')
  await page.getByLabel('Key', { exact: true }).first().press('Enter')
  await page.waitForTimeout(700)
  const driven = await drawnHeight(page)
  check('and moving the control moves the model', driven > 0.05, `${driven.toFixed(3)} m tall`)
  log(`MEASURE the control at 1: ${driven.toFixed(3)} m of relief`)
  await shot('scene-shape-keys-control-1440.png')
})
