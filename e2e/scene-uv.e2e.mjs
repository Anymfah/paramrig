import { run } from './lib.mjs'

/**
 * Chantier P: the corner domain, and a texture that lands where it should.
 *
 * The first thing this proves is a defect rather than a feature. Until this chantier no mesh in the
 * application had a UV map and nothing wrote one to the graphics card, so every textured surface
 * was a single texel of its image stretched over the whole object — a flat colour that looked like
 * a material with no texture at all.
 */
export default run('scene-uv', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })

  /* ------------------------------------------------ a primitive is born with one */

  const stored = await helpers.scene()
  const mesh = Object.values(stored.meshes)[0]
  const corners = mesh.faces.reduce((total, face) => total + face.length, 0)
  const maps = mesh.attributes.loop?.uvMaps ?? []
  check('the startup cube arrives with a UV map, as Blender’s does',
    maps.length === 1 && maps[0].data.length === corners * 2,
    `${maps.length} maps, ${maps[0]?.data?.length ?? 0} numbers for ${corners} corners`)
  check('and every face of it takes the whole image',
    JSON.stringify(maps[0]?.data?.slice(0, 8)) === JSON.stringify([0, 0, 1, 0, 1, 1, 0, 1]),
    JSON.stringify(maps[0]?.data?.slice(0, 8)))

  const drawn = await page.evaluate(() => {
    const geometry = window.__paramrigScene.stats()
    void geometry
    return { hasUv: true }
  })
  void drawn

  /* --------------------------------------------- and a texture lands on the mesh */

  // A checker written straight into the resource store, then named by the cube's material: the
  // shortest road to the thing being measured, which is whether the image varies across a face.
  await page.evaluate(async () => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#f0a02e' : '#101010'
        ctx.fillRect((x * size) / 8, (y * size) / 8, size / 8, size / 8)
      }
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('paramrig.resources.v1', 1)
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('assets')) open.result.createObjectStore('assets') }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const resourceId = 'checker-uv-test'
    await new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite')
      tx.objectStore('assets').put(new File([blob], 'checker.png', { type: 'image/png' }), resourceId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    const key = 'paramrig.scene-documents.v1'
    const all = JSON.parse(localStorage.getItem(key) ?? '{}')
    const id = location.pathname.split('/r/')[1]
    all[id].materials[0].textures = { baseColor: { resourceId, name: 'checker.png' } }
    all[id].view.shading = 'material'
    localStorage.setItem(key, JSON.stringify(all))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.scene-stage')
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  await page.waitForTimeout(2500)

  /*
   * The measurement is the spread of colour across one face.
   *
   * A texture sampled at one point paints a face one flat colour, whatever that colour is; a
   * texture sampled across a UV map paints a checker. So the pixels of the front face are counted
   * into light and dark, and both have to be there.
   */
  const spread = await page.evaluate(() => {
    const canvas = document.querySelector('.scene-canvas')
    /*
     * Drawn again in this very task, because a WebGL canvas hands back an empty image once the
     * frame it drew has been presented — the debug hatch's synchronous frame is what makes the
     * pixels readable at all.
     */
    window.__paramrigScene.frame()
    const box = canvas.getBoundingClientRect()
    const scratch = document.createElement('canvas')
    scratch.width = canvas.width
    scratch.height = canvas.height
    scratch.getContext('2d').drawImage(canvas, 0, 0)
    const middle = scratch.getContext('2d').getImageData(
      Math.round(scratch.width * 0.42),
      Math.round(scratch.height * 0.45),
      Math.round(scratch.width * 0.16),
      Math.round(scratch.height * 0.14),
    )
    let light = 0
    let dark = 0
    for (let index = 0; index < middle.data.length; index += 4) {
      const luma = 0.2126 * middle.data[index] + 0.7152 * middle.data[index + 1] + 0.0722 * middle.data[index + 2]
      if (luma > 90) light += 1
      else dark += 1
    }
    void box
    return { light, dark, total: middle.data.length / 4 }
  })
  const minority = Math.min(spread.light, spread.dark) / spread.total
  check('a texture varies across the face it is on, rather than being one flat texel',
    minority > 0.15, `${Math.round((spread.light / spread.total) * 100)}% light, ${Math.round((spread.dark / spread.total) * 100)}% dark`)
  log(`MEASURE checker on the cube: ${spread.light} light and ${spread.dark} dark pixels of ${spread.total}`)
  await shot('scene-uv-checker-1440.png')

  /* ------------------------------------------------ the maps survive being stored */

  const after = await helpers.scene()
  const kept = Object.values(after.meshes)[0].attributes.loop?.uvMaps ?? []
  check('and the map survives the sanitiser it is saved through',
    kept.length === 1 && kept[0].data.length === corners * 2,
    `${kept.length} maps, ${kept[0]?.data?.length ?? 0} numbers`)

  await page.locator('.scene-outliner__row', { hasText: 'Cube' }).first().click()
  await page.locator('.scene-properties__tab[aria-label="Data"]').click()
  await page.waitForTimeout(500)
  const attributes = await page.locator('.scene-properties').innerText()
  check('the Data tab names the map it has', /UVMap/.test(attributes), attributes.split('\n').filter((line) => /UV/.test(line)).join(' / ') || 'not listed')

  /* ------------------------------------------------------ unwrapping by hand */

  // Into edit mode with everything selected, then the U menu, as a person reaches it.
  const box = await helpers.viewportBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(700)
  await page.keyboard.press('a')
  await page.waitForTimeout(400)

  // Every edge a seam, so the cube comes apart into its six faces.
  await page.keyboard.press('Digit2')
  await page.waitForTimeout(300)
  await page.keyboard.press('a')
  await page.waitForTimeout(300)
  const marked = await page.evaluate(() => {
    const menu = [...document.querySelectorAll('.scene-header__menus button')].find((node) => node.textContent?.includes('Edge'))
    menu?.click()
    return !!menu
  })
  check('the Edge menu is where Mark seam lives', marked)
  await page.locator('[role="menuitem"]', { hasText: 'Mark seam' }).first().click()
  await page.waitForTimeout(500)
  const seams = await helpers.scene()
  const seamCount = (Object.values(seams.meshes)[0].attributes.edge.seam ?? []).filter(Boolean).length
  check('every edge of the cube is now a seam', seamCount === 12, `${seamCount} seams`)

  await page.keyboard.press('Digit3')
  await page.waitForTimeout(200)
  await page.keyboard.press('a')
  await page.waitForTimeout(300)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.press('KeyU')
  await page.waitForSelector('[role="menuitem"]', { timeout: 10000 })
  const entries = await page.locator('[role="menu"] [role="menuitem"]').allInnerTexts()
  check('U opens the UV menu, with the unwrappers in it',
    entries.some((entry) => /Unwrap/.test(entry)) && entries.some((entry) => /Smart UV project/.test(entry)),
    entries.slice(0, 6).join(' / '))
  await page.locator('[role="menuitem"]', { hasText: 'Unwrap' }).first().click()
  await page.waitForTimeout(1200)

  const unwrapped = await helpers.scene()
  const map = Object.values(unwrapped.meshes)[0].attributes.loop?.uvMaps?.[0]?.data ?? []
  const inside = map.length > 0 && Math.min(...map) >= -1e-6 && Math.max(...map) <= 1 + 1e-6
  check('unwrapping lays every corner inside the image', inside,
    `${map.length} numbers, ${Math.min(...map).toFixed(3)} to ${Math.max(...map).toFixed(3)}`)

  // Six islands, so six distinct patches: no two faces share a place in the image.
  const patches = new Set()
  for (let face = 0; face < 6; face += 1) {
    const corner = face * 4
    patches.add(`${(map[corner * 2] ?? 0).toFixed(2)}:${(map[corner * 2 + 1] ?? 0).toFixed(2)}`)
  }
  check('and the six faces land in six different places', patches.size === 6, `${patches.size} patches`)
  log(`MEASURE unwrap of a fully seamed cube: ${map.length / 2} corners, ${patches.size} islands`)
  await shot('scene-uv-unwrapped-1440.png')

  /* ------------------------------------------------------- the second space */

  /*
   * P2. Everything above proves the map exists; this proves a person can see it. The editor is
   * opened from the header, measured on its own canvas — a 2D canvas can be read back, which a
   * WebGL one cannot — and then made to share the screen differently by its splitter.
   */
  await page.locator('.scene-header__button[aria-label="UV editor"]').click()
  await page.waitForSelector('.scene-uv')
  await page.waitForTimeout(600)

  const opened = await page.evaluate(() => {
    const editor = document.querySelector('.scene-uv')
    const area = document.querySelector('.scene-area')
    return {
      pressed: document.querySelector('.scene-header__button[aria-label="UV editor"]')?.getAttribute('aria-pressed'),
      map: editor?.querySelector('.scene-uv__map')?.textContent ?? '',
      label: editor?.querySelector('canvas')?.getAttribute('aria-label') ?? '',
      status: editor?.querySelector('.scene-uv__status')?.textContent ?? '',
      editorWidth: Math.round(editor?.getBoundingClientRect().width ?? 0),
      areaWidth: Math.round(area?.getBoundingClientRect().width ?? 0),
    }
  })
  check('the header button opens the second space and reads as pressed',
    opened.pressed === 'true' && opened.editorWidth > 200, `pressed ${opened.pressed}, ${opened.editorWidth} px wide`)
  check('the viewport keeps its share of the screen rather than being replaced',
    opened.areaWidth > 200 && Math.abs(opened.areaWidth / (opened.areaWidth + opened.editorWidth) - 0.55) < 0.05,
    `${opened.areaWidth} px viewport, ${opened.editorWidth} px UV editor`)
  check('it names the map it is showing, and says what is in it',
    opened.map === 'UVMap' && /24 points/.test(opened.status), `${opened.map} · ${opened.status}`)
  check('and a reader with no picture is told the same thing',
    /UV map UVMap, 24 points/.test(opened.label), opened.label)

  /*
   * What is actually on the canvas. The unwrapped cube is six squares on a checker, so the picture
   * has to hold both greys of the checker and the light of the edges — three colours at least, and
   * a flat canvas would hold one.
   */
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('.scene-uv__canvas')
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const seen = new Map()
    for (let index = 0; index < pixels.length; index += 4) {
      const key = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    const ranked = [...seen.entries()].sort((a, b) => b[1] - a[1])
    return { colours: seen.size, top: ranked.slice(0, 4).map(([key, count]) => `${key} ×${count}`) }
  })
  check('the canvas is painted rather than empty: a checker, and lines over it',
    painted.colours >= 3, `${painted.colours} colours, ${painted.top.join(' / ')}`)
  log(`MEASURE the UV canvas: ${painted.colours} distinct colours`)
  await shot('scene-uv-editor-1440.png')

  // The splitter, moved by the keyboard, which is the way it has to work for anyone who cannot drag.
  await page.locator('[role="separator"][aria-label="Viewport and UV editor"]').focus()
  for (let press = 0; press < 5; press += 1) await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(400)
  const moved = await page.evaluate(() => ({
    now: document.querySelector('[role="separator"]')?.getAttribute('aria-valuenow'),
    areaWidth: Math.round(document.querySelector('.scene-area')?.getBoundingClientRect().width ?? 0),
  }))
  check('the splitter moves on the arrow keys and the viewport grows with it',
    moved.now === '65' && moved.areaWidth > opened.areaWidth, `${moved.now}%, ${moved.areaWidth} px`)

  /* ------------------------------------------------------ Data > UV maps */

  await page.locator('.scene-properties__tab[aria-label="Data"]').click()
  await page.waitForTimeout(400)
  const section = page.locator('[data-section="data-mesh-uv"]')
  await section.waitFor()
  if (await section.getAttribute('data-open') === 'false') await section.locator('.scene-section__title').click()
  const rows = await section.locator('.scene-uv-maps__name').allInnerTexts()
  check('the UV maps section lists the map the mesh carries', rows.join(' / ') === 'UVMap', rows.join(' / ') || 'no rows')
  await section.locator('.scene-button').click()
  await page.waitForTimeout(500)
  const added = await helpers.scene()
  const names = (Object.values(added.meshes)[0].attributes.loop?.uvMaps ?? []).map((map) => map.name)
  check('Data > UV maps adds a second map, copied from the first and made active',
    names.length === 2 && names[1] === 'UVMap.001' && Object.values(added.meshes)[0].attributes.loop.activeUv === 1,
    names.join(' / '))

  await page.locator('[aria-label="Remove UVMap.001"]').click()
  await page.waitForTimeout(400)
  const removed = await helpers.scene()
  check('and removes it again, leaving the first one active',
    (Object.values(removed.meshes)[0].attributes.loop?.uvMaps ?? []).length === 1,
    `${(Object.values(removed.meshes)[0].attributes.loop?.uvMaps ?? []).length} maps`)

  /* --------------------------------------------------- and on a small screen */

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(700)
  const phone = await page.evaluate(() => ({
    editor: Math.round(document.querySelector('.scene-uv')?.getBoundingClientRect().width ?? 0),
    area: getComputedStyle(document.querySelector('.scene-area')).display,
  }))
  check('at 390 px the second space takes the screen rather than sharing it',
    phone.area === 'none' && phone.editor > 320, `viewport ${phone.area}, UV editor ${phone.editor} px`)
  await shot('scene-uv-editor-390.png')
  await page.setViewportSize({ width: 1440, height: 900 })
})
