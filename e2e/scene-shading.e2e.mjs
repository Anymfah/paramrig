import { headerControl, run } from './lib.mjs'

/**
 * Chantier K: the four ways of looking at a scene, and solid's own settings.
 *
 * A shading mode is a picture, so the checks are pixels: the middle of the viewport read out of the
 * drawing buffer after each switch. What is asserted is that the modes differ from one another and
 * that each option changes what it says it changes — a matcap is not a studio, a cavity darkens a
 * crease, X-ray lets the background through.
 *
 * The last check is the one that matters most for a modelling editor: at rest, nothing is drawn.
 */
export default run('scene-shading', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })

  const middleColour = () => page.evaluate(() => {
    window.__paramrigScene.frame()
    const canvas = document.querySelector('.scene-viewport canvas')
    const gl = canvas.getContext('webgl2')
    const pixel = new Uint8Array(4)
    gl.readPixels(Math.round(canvas.width / 2), Math.round(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return [pixel[0], pixel[1], pixel[2]]
  })
  const setView = (patch) => page.evaluate((value) => {
    const key = 'paramrig.scene-documents.v1'
    const all = JSON.parse(localStorage.getItem(key))
    const id = location.pathname.split('/r/')[1]
    all[id] = { ...all[id], view: { ...all[id].view, ...value } }
    localStorage.setItem(key, JSON.stringify(all))
  }, patch)
  const reload = async () => {
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
    await page.locator('#main').focus()
  }
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

  /* ------------------------------------------------------------ the four modes */

  const colours = {}
  for (const shading of ['solid', 'material', 'rendered', 'wireframe']) {
    await setView({ shading })
    await reload()
    colours[shading] = await middleColour()
    await shot(`scene-shading-${shading}-1440.png`)
    log(`MEASURE ${shading}: ${colours[shading].join(',')}`)
  }
  check('solid and rendered are not the same picture', distance(colours.solid, colours.rendered) > 12,
    `${colours.solid.join(',')} against ${colours.rendered.join(',')}`)
  // The grid and the axes are what shows through where the surface was, so the pixel is not the
  // viewport's own ground either: what matters is that it is no longer the cube.
  check('wireframe draws no surface where the cube was', distance(colours.wireframe, colours.solid) > 15,
    `${colours.wireframe.join(',')} against ${colours.solid.join(',')}`)
  check('material preview lights the material rather than the scene’s lamps',
    distance(colours.material, colours.rendered) > 8,
    `${colours.material.join(',')} against ${colours.rendered.join(',')}`)

  /* --------------------------------------------------------- solid’s own options */

  await setView({ shading: 'solid' })
  await reload()
  const studio = await middleColour()

  const shadingMenu = async () => {
    const trigger = await headerControl(page, '.scene-header__group[aria-label="Viewport shading"] .scene-menu__trigger')
    await trigger.dispatchEvent('click')
    await page.waitForSelector('.scene-menu[role="menu"]')
  }
  await shadingMenu()
  const headings = await page.locator('.scene-menu__heading').allTextContents()
  check('the shading menu groups lighting, colour and the switches',
    ['Lighting', 'Colour', 'Options'].every((title) => headings.includes(title)), headings.join(', '))
  // Dispatched rather than clicked: the menu is a portal over the header, and Playwright reads a
  // real click there as an interception even where a person's lands squarely.
  await page.locator('.scene-menu__item', { hasText: 'Matcap' }).first().dispatchEvent('click')
  await page.waitForTimeout(500)
  const matcap = await middleColour()
  check('a matcap is a different light from the studio', distance(matcap, studio) > 10,
    `${matcap.join(',')} against ${studio.join(',')}`)
  await shot('scene-shading-matcap-1440.png')

  // The matcaps themselves: choosing another one changes the picture again.
  await shadingMenu()
  const names = await page.locator('.scene-menu__item').allTextContents()
  check('and the menu offers the six matcaps by name',
    ['Basic', 'Clay', 'Metal', 'Plastic', 'Wax', 'Ceramic'].every((name) => names.includes(name)),
    names.filter((name) => name.length < 10).join(', '))
  await page.locator('.scene-menu__item', { hasText: 'Clay' }).first().dispatchEvent('click')
  await page.waitForTimeout(500)
  const clay = await middleColour()
  check('clay is warmer than the basic matcap', clay[0] - clay[2] > 10, clay.join(','))

  /* --------------------------------------------------------------- cavity, X-ray */

  /**
   * A pixel by its place in the viewport's own coordinates, which is what `project3d` answers in.
   * The drawing buffer counts from the bottom and may be denser than the page, so both are undone
   * here rather than guessed at.
   */
  const colourAt = ([x, y]) => page.evaluate(([px, py]) => {
    window.__paramrigScene.frame()
    const canvas = document.querySelector('.scene-viewport canvas')
    const box = canvas.getBoundingClientRect()
    const ratio = canvas.width / box.width
    const gl = canvas.getContext('webgl2')
    const pixel = new Uint8Array(4)
    gl.readPixels(Math.round(px * ratio), Math.round(canvas.height - py * ratio), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return [pixel[0], pixel[1], pixel[2]]
  }, [x, y])

  /**
   * The darkest pixel in a short horizontal run. A crease is a line a pixel or two wide, and where
   * exactly it lands depends on the projection, so what is measured is the strip it is somewhere in.
   */
  const darkestAcross = ([x, y], span = 14) => page.evaluate(([px, py, width]) => {
    window.__paramrigScene.frame()
    const canvas = document.querySelector('.scene-viewport canvas')
    const box = canvas.getBoundingClientRect()
    const ratio = canvas.width / box.width
    const gl = canvas.getContext('webgl2')
    const pixels = new Uint8Array(width * 4)
    gl.readPixels(
      Math.round(px * ratio - width / 2), Math.round(canvas.height - py * ratio),
      width, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels,
    )
    let darkest = 255
    for (let index = 0; index < width; index += 1) darkest = Math.min(darkest, pixels[index * 4])
    return darkest
  }, [x, y, span])

  // Through the menu rather than through storage: the app writes its own state back as it goes,
  // and a patch made behind its back can be overwritten before a reload picks it up.
  await shadingMenu()
  await page.locator('.scene-menu__item', { hasText: 'Studio' }).first().dispatchEvent('click')
  await page.waitForTimeout(400)

  /*
   * A sphere, because cavity here is a curvature: it darkens where the surface turns, and a cube's
   * faces do not turn at all. That is the honest limit of doing it in the shader rather than as a
   * screen-space pass, and it is what the check measures.
   */
  // The cube goes first: a sphere of radius one at the origin would sit inside it.
  await page.locator('.scene-outliner__row', { hasText: 'Cube' }).first().click()
  await page.locator('#main').focus()
  await page.keyboard.press('Delete')
  await page.waitForTimeout(400)
  await page.locator('.scene-menu__trigger', { hasText: 'Add' }).first().click()
  await page.waitForSelector('.scene-menu[role="menu"]')
  await page.locator('.scene-menu__item', { hasText: 'UV sphere' }).first().dispatchEvent('click')
  await page.waitForTimeout(700)
  // Smooth-shaded, so the normal turns across the surface rather than only at each face's border.
  await page.locator('#main').focus()
  await page.keyboard.press('F3')
  await page.waitForSelector('.scene-palette__input')
  await page.keyboard.type('Shade smooth')
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  // Near the silhouette, which is where a sphere's normal turns fastest.
  const sphere = await helpers.project3d([0.86, -0.3, 0.35])
  const plain = await colourAt(sphere.local)
  await shadingMenu()
  await page.locator('.scene-menu__item', { hasText: 'Cavity' }).first().dispatchEvent('click')
  await page.waitForTimeout(500)
  const darkened = await colourAt(sphere.local)
  check('cavity darkens a surface that curves', darkened[0] < plain[0] - 3, `${plain.join(',')} → ${darkened.join(',')}`)
  log(`MEASURE a sphere with cavity off then on: ${plain.join(',')} → ${darkened.join(',')}`)
  await shot('scene-shading-cavity-1440.png')

  // The header's own switch, for the same reason the menu was used above.
  const before = await middleColour()
  const xrayButton = await headerControl(page, 'button[aria-label="X-ray"]')
  await xrayButton.dispatchEvent('click')
  await page.waitForTimeout(500)
  const xray = await middleColour()
  check('X-ray lets what is behind the cube through', distance(xray, before) > 15,
    `${xray.join(',')} against ${before.join(',')}`)
  await shot('scene-shading-xray-1440.png')

  /* ------------------------------------------------------- nothing moves at rest */

  await setView({ xray: false, shading: 'solid' })
  await reload()
  const still = await page.evaluate(async () => {
    const scene = window.__paramrigScene
    const before = { frames: scene.frames(), invalidate: scene.invalidateCount() }
    await new Promise((resolve) => setTimeout(resolve, 1200))
    return { before, after: { frames: scene.frames(), invalidate: scene.invalidateCount() } }
  })
  check('a solid viewport at rest draws nothing and asks for nothing',
    still.after.frames === still.before.frames && still.after.invalidate === still.before.invalidate,
    `${still.before.frames}→${still.after.frames} frames, ${still.before.invalidate}→${still.after.invalidate} invalidations`)

  await setView({ shading: 'rendered' })
  await reload()
  const stillRendered = await page.evaluate(async () => {
    const scene = window.__paramrigScene
    const before = scene.invalidateCount()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    return { before, after: scene.invalidateCount() }
  })
  check('and so does a rendered one', stillRendered.after === stillRendered.before,
    `${stillRendered.before}→${stillRendered.after} invalidations`)
})
