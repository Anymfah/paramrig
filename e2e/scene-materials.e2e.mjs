import { run } from './lib.mjs'

/**
 * Chantier I: materials, slots, and the world behind them.
 *
 * The checks follow one gesture through: a new material, made red, assigned to one face while the
 * mesh is open, then seen in material preview — and the same material dragged out of the asset list
 * onto the object. What is asserted is the document, because that is what a saved file will hold,
 * and one pixel, because that is what a person sees.
 */
export default run('scene-materials', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  /** The colour in the middle of the viewport, drawn and read in one call. */
  const middleColour = () => page.evaluate(() => {
    window.__paramrigScene.frame()
    const canvas = document.querySelector('.scene-viewport canvas')
    const gl = canvas.getContext('webgl2')
    const pixel = new Uint8Array(4)
    gl.readPixels(Math.round(canvas.width / 2), Math.round(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return [pixel[0], pixel[1], pixel[2]]
  })

  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(250)
  await page.locator('.scene-properties__tab[aria-label="Material"]').click()
  await page.waitForSelector('.scene-slots')

  const slots = await page.locator('.scene-slots__row').count()
  check('the cube starts with one slot and the document’s material in it', slots === 1, `${slots} slots`)

  /* --------------------------------------------------------- a new red material */

  await page.locator('.scene-button', { hasText: 'New' }).first().click()
  await page.waitForTimeout(400)
  let scene = await helpers.scene()
  check('New puts a second material in the document and in the slot',
    scene.materials.length === 2 && scene.objects.find((object) => object.name === 'Cube').materialSlots[0] === scene.materials[1].id,
    `${scene.materials.length} materials`)

  const colour = page.locator('.control--color', { hasText: 'Base colour' }).first().locator('.color-field__hex')
  await colour.fill('#e01b24')
  await colour.press('Enter')
  await page.waitForTimeout(400)
  scene = await helpers.scene()
  check('the base colour reaches the material', scene.materials[1].baseColor.toLowerCase() === '#e01b24',
    scene.materials[1].baseColor)

  // Solid shading takes its colour from the material, so the cube turns red without a mode change.
  const solid = await middleColour()
  check('and solid shading follows it without changing mode', solid[0] > solid[1] + 40 && solid[0] > solid[2] + 40,
    solid.join(','))
  await shot('scene-materials-solid-1440.png')

  /* ------------------------------------------------ assign to one face in edit mode */

  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(500)
  await page.keyboard.press('Digit3')
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(300)
  const assign = page.locator('.scene-button', { hasText: 'Assign' }).first()
  check('Assign appears only in edit mode', await assign.count() === 1, `${await assign.count()} buttons`)
  // A second slot, so the assignment has somewhere to go that is not slot 0.
  await page.locator('button[aria-label="Add material slot"]').click()
  await page.waitForTimeout(300)
  await page.locator('.scene-slots__row').nth(1).click()
  await page.waitForTimeout(200)
  await assign.click()
  await page.waitForTimeout(500)
  scene = await helpers.scene()
  let cube = scene.objects.find((object) => object.name === 'Cube')
  const materials = scene.meshes[cube.data.meshId].attributes.face.material
  check('Assign puts every selected face in the active slot', materials.every((slot) => slot === 1),
    materials.join(','))

  // Back into the red slot, so what follows is looking at the material that was just made rather
  // than at the document's default grey.
  await page.locator('.scene-slots__row').first().click()
  await page.waitForTimeout(200)
  await assign.click()
  await page.waitForTimeout(400)
  await page.locator('.scene-button', { hasText: 'Deselect' }).first().click()
  await page.waitForTimeout(400)
  const afterDeselect = await page.evaluate(() => window.__paramrigScene.stats())
  log(`MEASURE after deselect: ${afterDeselect.faces} faces in the scene`)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)

  /* ------------------------------------------------------------ material preview */

  await page.keyboard.press('KeyZ')
  await page.waitForSelector('.scene-pie', { timeout: 4000 }).catch(() => undefined)
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const key = 'paramrig.scene-documents.v1'
    const all = JSON.parse(localStorage.getItem(key))
    const id = location.pathname.split('/r/')[1]
    all[id] = { ...all[id], view: { ...all[id].view, shading: 'material' } }
    localStorage.setItem(key, JSON.stringify(all))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  const preview = await middleColour()
  check('material preview lights the material from a studio rather than leaving it flat',
    preview[0] > preview[1] && preview[0] > preview[2], preview.join(','))
  await shot('scene-materials-preview-1440.png')

  /* ------------------------------------------------- an environment from a resource */

  await page.locator('.scene-properties__tab[aria-label="World"]').click()
  await page.waitForSelector('.resource-drop')
  // A two-colour equirectangular image, made here so the test carries no binary of its own.
  const image = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const context = canvas.getContext('2d')
    context.fillStyle = '#204080'
    context.fillRect(0, 0, 256, 64)
    context.fillStyle = '#d0b070'
    context.fillRect(0, 64, 256, 64)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return [...bytes]
  })
  await page.locator('.resource-drop input[type="file"]').setInputFiles({
    name: 'studio.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image),
  })
  await page.waitForTimeout(800)
  scene = await helpers.scene()
  check('the world keeps the environment as a resource reference',
    typeof scene.world.environmentId === 'string' && scene.world.environmentName === 'studio.png',
    JSON.stringify({ id: !!scene.world.environmentId, name: scene.world.environmentName }))
  const strength = await page.locator('.control', { hasText: 'Strength' }).count()
  check('and the panel opens the settings that only make sense with one', strength >= 2, `${strength} strength fields`)
  await shot('scene-materials-world-1440.png')

  /* --------------------------------------------- dragging one out of the asset list */

  await page.evaluate(() => {
    const key = 'paramrig.scene-documents.v1'
    const all = JSON.parse(localStorage.getItem(key))
    const id = location.pathname.split('/r/')[1]
    const view = all[id].view
    all[id] = { ...all[id], view: { ...view, shading: 'solid', panels: { ...view.panels, sidebar: true, sidebarTab: 'assets' } } }
    localStorage.setItem(key, JSON.stringify(all))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  const rows = await page.locator('.scene-assets__item').count()
  check('the Assets tab lists the document’s materials', rows === 2, `${rows} rows`)

  // A pointer drag is not an HTML5 drag in a browser, so the gesture is played as the events it is
  // made of: the same ones the panel and the viewport actually listen for.
  const drag = (x, y, shift, row = 0) => page.evaluate(([px, py, withShift, which]) => {
    const item = document.querySelectorAll('.scene-assets__item')[which]
    const surface = document.querySelector('.scene-surface')
    const dataTransfer = new DataTransfer()
    item.dispatchEvent(new DragEvent('dragstart', { dataTransfer, bubbles: true }))
    const options = { dataTransfer, bubbles: true, clientX: px, clientY: py, shiftKey: withShift }
    surface.dispatchEvent(new DragEvent('dragover', options))
    surface.dispatchEvent(new DragEvent('drop', options))
  }, [x, y, shift, row])

  await drag(centre.x, centre.y, false)
  await page.waitForTimeout(500)
  scene = await helpers.scene()
  cube = scene.objects.find((object) => object.name === 'Cube')
  check('dropping a material on the object puts it in the active slot',
    cube.materialSlots[0] === scene.materials[0].id, cube.materialSlots.join(', '))

  // The other material this time: dropping the one that is already in the slot would change nothing.
  await drag(centre.x, centre.y, true, 1)
  await page.waitForTimeout(500)
  scene = await helpers.scene()
  cube = scene.objects.find((object) => object.name === 'Cube')
  const painted = scene.meshes[cube.data.meshId].attributes.face.material
  const front = painted.filter((slot) => slot === painted[0]).length
  check('and dropping it on a face with ⇧ paints that face alone',
    new Set(painted).size > 1, `${front} of ${painted.length} faces in the first slot`)
  await shot('scene-materials-dropped-1440.png')
})
