import { run } from './lib.mjs'

/** Chantier G: turning a picture into paths. */
export default run('chantier-g', async ({ page, check, helpers, shot }) => {
  await helpers.newDocument()

  // A picture made in the page: a black disc on white, the classic thing to trace.
  const png = await page.evaluate(() => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size, size)
    context.fillStyle = '#101010'
    context.beginPath()
    context.arc(size / 2, size / 2, 90, 0, Math.PI * 2)
    context.fill()
    return canvas.toDataURL('image/png')
  })
  await page.evaluate((data) => {
    const key = 'paramrig.vector-documents.v1'
    const all = JSON.parse(localStorage.getItem(key) ?? '{}')
    const id = location.pathname.split('/r/')[1]
    all[id] = {
      ...all[id],
      elements: [{
        id: 'photo', kind: 'image', name: 'Photo', x: 150, y: 120, width: 300, height: 300, rotation: 0,
        fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false,
        image: data, imageWidth: 256, imageHeight: 256,
      }],
    }
    localStorage.setItem(key, JSON.stringify(all))
  }, png)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.vector-toolbar')
  await page.waitForTimeout(500)
  check('the picture is on the canvas', (await helpers.doc()).elements[0].kind === 'image')

  // 1. The command opens on a selected picture, with a live preview.
  await page.locator('.vector-layer__select').first().click()
  await page.waitForTimeout(300)
  await page.locator('#main').focus()
  await page.keyboard.press('Meta+/')
  await page.waitForSelector('.vector-palette__input')
  await page.keyboard.type('Trace image')
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.vector-trace', { timeout: 5000 })
  await page.waitForTimeout(800)
  const preview = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('.vector-trace__preview path')]
    return { count: paths.length, fill: paths[0]?.getAttribute('fill'), length: paths[0]?.getAttribute('d')?.length ?? 0 }
  })
  check('the preview traces the picture as the dialog opens', preview.count === 1 && preview.length > 50, JSON.stringify(preview))
  // The edge of the disc is anti-aliased, so the average of what was masked is a shade off.
  check('and paints it in the colour it found', /^#1[0-9A-F]1[0-9A-F]1[0-9A-F]$/i.test(preview.fill ?? ''), String(preview.fill))
  await shot('chantier-g-dialog.png')

  // 2. Moving the threshold changes what comes out.
  const threshold = page.locator('.vector-trace').getByLabel('Threshold', { exact: true }).first()
  await threshold.fill('2')
  await threshold.press('Enter')
  await page.waitForTimeout(600)
  const dark = await page.$$eval('.vector-trace__preview path', (nodes) => nodes.length)
  check('a threshold that dark finds nothing', dark === 0, String(dark))
  await threshold.fill('50')
  await threshold.press('Enter')
  await page.waitForTimeout(600)

  // 3. Tracing puts a path on the canvas and hides the picture under it.
  await page.click('[data-action="trace"]')
  await page.waitForTimeout(2500)
  const state = await helpers.doc()
  const traced = state.elements.find((element) => element.kind === 'path')
  check('the trace lands as a path', !!traced && traced.network.segments.length > 8,
    JSON.stringify({ kind: traced?.kind, segments: traced?.network?.segments.length, fill: traced?.fill }))
  check('the picture stays, hidden under its drawing', state.elements[0].kind === 'image' && state.elements[0].visible === false)
  // The disc covers seven tenths of the picture: the path lands inside the picture, centred on it.
  const centre = { x: traced.x + traced.width / 2, y: traced.y + traced.height / 2 }
  check('the path sits on the picture, centred where the disc was',
    traced.x > 150 && traced.x + traced.width < 450 && Math.abs(centre.x - 300) < 6 && Math.abs(centre.y - 270) < 6,
    JSON.stringify({ x: traced.x, width: traced.width, centre }))
  await shot('chantier-g-traced.png')

  // 4. One undo takes the whole trace back.
  await page.locator('#main').focus()
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(400)
  const undone = await helpers.doc()
  check('one undo takes the whole trace back', undone.elements.length === 1 && undone.elements[0].visible === true,
    JSON.stringify(undone.elements.map((element) => [element.kind, element.visible])))
  await page.keyboard.press('Meta+Shift+z')
  await page.waitForTimeout(400)

  // 5. The result is a path like any other: node editing works on it.
  await page.locator('.vector-layer__select').first().click()
  await page.waitForTimeout(300)
  await page.locator('#main').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  check('the traced path opens in node editing', await page.getAttribute('.vector-canvas', 'data-tool') === 'node')
  check('and shows its nodes', (await page.$$('[data-vector-node]')).length > 8, String((await page.$$('[data-vector-node]')).length))
})
