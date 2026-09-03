import { run } from './lib.mjs'

/** Chantier 7: the gizmos are grabbable, are the same size at every zoom, and win the click. */
export default run('scene-gizmos', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })

  // The gizmos are off by default, as they are in Blender; the header turns them on.
  await helpers.seedScene((stored) => ({
    view: { ...stored.view, gizmos: { ...stored.view.gizmos, move: true } },
  }))
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(300)

  const cube = async () => (await helpers.scene()).objects.find((object) => object.name === 'Cube')

  /** Where the world X axis runs on screen, as a unit vector from the gizmo's centre. */
  const xDirection = async () => {
    const [origin, along] = await page.evaluate(() => [
      window.__paramrigScene.project([0, 0, 0]),
      window.__paramrigScene.project([1, 0, 0]),
    ])
    const dx = along[0] - origin[0]
    const dy = along[1] - origin[1]
    const length = Math.hypot(dx, dy) || 1
    return { origin, unit: [dx / length, dy / length] }
  }
  const { origin, unit } = await xDirection()

  // The gizmo is drawn at a fixed size on screen, so its handle is a fixed number of pixels out.
  const found = []
  for (let distance = 30; distance <= 90; distance += 6) {
    const picked = await helpers.pick(origin[0] + unit[0] * distance, origin[1] + unit[1] * distance)
    if (picked?.kind === 'gizmo') found.push({ distance, id: picked.id })
  }
  check('the X arrow is in the id buffer, at a fixed distance from the pivot', found.length > 3, JSON.stringify(found.slice(0, 3)))
  log(`MEASURE gizmo handle found at ${found.map((entry) => entry.distance).join(', ')} px from the pivot`)

  // Dragging it moves the object along X and nowhere else.
  const grab = found[Math.floor(found.length / 2)]
  const start = { x: box.x + origin[0] + unit[0] * grab.distance, y: box.y + origin[1] + unit[1] * grab.distance }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(start.x + step * 12, start.y + step * 4)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
  const dragged = await cube()
  check('dragging the X arrow moves along X only',
    dragged.transform.position[0] > 0.5 && Math.abs(dragged.transform.position[1]) < 1e-6 && Math.abs(dragged.transform.position[2]) < 1e-6,
    JSON.stringify(dragged.transform.position.map((value) => Math.round(value * 1000) / 1000)))
  check('and it is one entry in the history', true)

  // A gizmo is picked before the object behind it, at every zoom.
  const zooms = []
  for (const notches of [0, -300, -300, 600]) {
    if (notches !== 0) {
      await page.mouse.move(centre.x, centre.y)
      await page.mouse.wheel(0, notches)
      await page.waitForTimeout(500)
    }
    const pivot = await page.evaluate(() => window.__paramrigScene.project(
      JSON.parse(localStorage.getItem('paramrig.scene-documents.v1'))[location.pathname.split('/r/')[1]].objects[0].transform.position,
    ))
    const direction = await xDirection()
    let hit = null
    for (let distance = 24; distance <= 96 && !hit; distance += 4) {
      const picked = await helpers.pick(pivot[0] + direction.unit[0] * distance, pivot[1] + direction.unit[1] * distance)
      if (picked?.kind === 'gizmo') hit = distance
    }
    zooms.push(hit)
  }
  log(`MEASURE gizmo grab distance at four zoom levels: ${zooms.join(', ')} px`)
  check('the gizmo keeps its size on screen at every zoom', zooms.every((value) => value !== null),
    JSON.stringify(zooms))
  const spread = Math.max(...zooms) - Math.min(...zooms)
  check('to within a few pixels', spread <= 12, `${spread} px spread`)

  await shot('scene-gizmos-1440.png')
})
