import { run } from './lib.mjs'

/**
 * Chantier L: the files a scene goes out as, and comes back from.
 *
 * Every check here is about what actually leaves the browser: the bytes of the download, and what
 * the document holds after those same bytes are dropped back in. A round trip through a format is
 * the only test of a format worth having.
 */
export default run('scene-io', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })

  const openFileMenu = async () => {
    // Closed first: a menu that is already open would be shut by a click on its own trigger.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    await page.locator('.scene-file__button').click()
    await page.waitForSelector('.scene-file-menu')
  }

  /* ------------------------------------------------------------ export glTF */

  const glb = await helpers.captureDownload(async () => {
    await openFileMenu()
    await page.locator('.menu__item', { hasText: 'Export glTF' }).first().click()
  })
  const magic = glb ? String.fromCharCode(...glb.head.slice(0, 4)) : ''
  check('Export glTF writes a GLB, magic and all', magic === 'glTF' && glb.size > 500,
    `${glb?.download ?? 'nothing'} · ${glb?.size ?? 0} bytes · ${magic}`)
  log(`MEASURE the startup scene as a GLB: ${glb?.size ?? 0} bytes`)

  /* ------------------------------------------------------------- export OBJ */

  const obj = await helpers.captureExport(async () => {
    await openFileMenu()
    await page.locator('.menu__item', { hasText: 'Export OBJ' }).first().click()
  })
  const lines = (obj?.text ?? '').split('\n')
  check('Export OBJ writes the cube as eight vertices and six faces',
    lines.filter((line) => line.startsWith('v ')).length === 8
      && lines.filter((line) => line.startsWith('f ')).length === 6,
    `${lines.filter((line) => line.startsWith('v ')).length} v, ${lines.filter((line) => line.startsWith('f ')).length} f`)
  check('and keeps the quads rather than triangulating them',
    lines.filter((line) => line.startsWith('f ')).every((line) => line.trim().split(/\s+/).length === 5),
    lines.find((line) => line.startsWith('f ')) ?? 'no faces')

  /* ------------------------------------------------------------- export STL */

  const stl = await helpers.captureDownload(async () => {
    await openFileMenu()
    await page.locator('.menu__item', { hasText: 'Export STL' }).first().click()
  })
  // 84 bytes of header and count, fifty a triangle: a cube is twelve.
  check('Export STL writes a binary file of twelve triangles', stl?.size === 84 + 12 * 50,
    `${stl?.download ?? 'nothing'} · ${stl?.size ?? 0} bytes`)

  /* --------------------------------------------------- import the same file back */

  // The OBJ that was just written, dropped on the viewport as a file from the desktop would be.
  const box = await helpers.viewportBox()
  await page.evaluate(async ([text, x, y]) => {
    const file = new File([text], 'ring.obj', { type: 'model/obj' })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    const surface = document.querySelector('.scene-surface')
    surface.dispatchEvent(new DragEvent('dragover', { dataTransfer, bubbles: true, clientX: x, clientY: y }))
    surface.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, clientX: x, clientY: y }))
  }, [obj?.text ?? '', box.x + box.width / 2, box.y + box.height / 2])
  await page.waitForTimeout(1200)
  let scene = await helpers.scene()
  const imported = scene.objects.find((object) => object.name.startsWith('Cube.'))
  check('an OBJ dropped on the viewport arrives as an object of its own',
    !!imported, scene.objects.map((object) => object.name).join(', '))
  const mesh = imported ? scene.meshes[imported.data.meshId] : null
  check('with the same topology it left as',
    !!mesh && mesh.vertexIds.length === 8 && mesh.faces.length === 6,
    mesh ? `${mesh.vertexIds.length}/${mesh.edges.length}/${mesh.faces.length}` : 'no mesh')
  await shot('scene-io-imported-1440.png')

  /* ---------------------------------------------------------------- F12 */

  // A small output, so the render is quick and the check is about the size rather than the wait.
  await page.evaluate(() => {
    const key = 'paramrig.scene-documents.v1'
    const all = JSON.parse(localStorage.getItem(key))
    const id = location.pathname.split('/r/')[1]
    all[id] = { ...all[id], output: { width: 320, height: 240, percentage: 100, transparent: false } }
    localStorage.setItem(key, JSON.stringify(all))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  await page.locator('#main').focus()
  await page.keyboard.press('F12')
  await page.waitForSelector('.scene-render')
  const png = await helpers.captureDownload(async () => {
    await page.waitForSelector('.scene-render__frame img', { timeout: 30000 })
    await page.locator('.scene-render button', { hasText: 'Save' }).click()
  })
  const signature = png ? png.head.slice(0, 8).join(',') : ''
  check('F12 renders the scene and saves it as a PNG',
    signature === '137,80,78,71,13,10,26,10', `${png?.download ?? 'nothing'} · ${signature}`)
  // The PNG's own header says how big it is: width and height are big-endian at byte 16.
  const width = png ? (png.head[16] << 24) + (png.head[17] << 16) + (png.head[18] << 8) + png.head[19] : 0
  const height = png ? (png.head[20] << 24) + (png.head[21] << 16) + (png.head[22] << 8) + png.head[23] : 0
  check('at the size Scene · Output asks for', width === 320 && height === 240, `${width}×${height}`)
  await shot('scene-io-render-1440.png')
  await page.locator('.scene-render button', { hasText: 'Close' }).click()
})
