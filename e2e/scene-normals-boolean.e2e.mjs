import { headerControl, run } from './lib.mjs'

/**
 * Chantier F in the browser: the overlays that show a mesh's winding, and the operators that fix it.
 *
 * Face orientation is the only way to see a mesh that has been turned inside out, and a mesh that
 * has been turned inside out is the commonest reason a boolean comes out wrong — so the two belong
 * in one script, and the check that matters is that the picture changes when the winding does.
 */
export default run('scene-normals-boolean', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const scene = () => helpers.scene()
  const meshOf = async () => {
    const document = await scene()
    return document.meshes[document.objects.find((object) => object.data.kind === 'mesh').data.meshId]
  }
  /** The signed volume of the mesh: positive when its faces face outwards. */
  const volume = async () => {
    const mesh = await meshOf()
    let total = 0
    for (const loop of mesh.faces) {
      for (let index = 1; index + 1 < loop.length; index += 1) {
        const [a, b, c] = [loop[0], loop[index], loop[index + 1]].map((corner) => [
          mesh.vertices[corner * 3], mesh.vertices[corner * 3 + 1], mesh.vertices[corner * 3 + 2],
        ])
        total += (
          a[0] * (b[1] * c[2] - b[2] * c[1])
          - a[1] * (b[0] * c[2] - b[2] * c[0])
          + a[2] * (b[0] * c[1] - b[1] * c[0])
        ) / 6
      }
    }
    return total
  }
  /**
   * The colour in the middle of the viewport. The frame is drawn and read in one call on purpose:
   * a WebGL canvas keeps its drawing buffer only until the task that drew it ends, so reading it
   * from a second call gives black however carefully the render was asked for.
   */
  const middleColour = async () => page.evaluate(() => {
    window.__paramrigScene.frame()
    const canvas = document.querySelector('.scene-viewport canvas')
    const gl = canvas.getContext('webgl2')
    const pixel = new Uint8Array(4)
    gl.readPixels(Math.round(canvas.width / 2), Math.round(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return [pixel[0], pixel[1], pixel[2]]
  })

  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  await page.keyboard.press('Digit3')
  await page.keyboard.press('KeyA')
  await page.waitForTimeout(250)

  const outward = await volume()
  check('the cube starts wound outwards', outward > 0, outward.toFixed(3))

  /* ------------------------------------------------------- the orientation overlay */

  const solid = await middleColour()
  const overlays = await headerControl(page, 'button[aria-label="Overlays"]')
  await overlays.dispatchEvent('click')
  await page.waitForSelector('[role="menu"][aria-label="Overlays"]')
  await page.locator('[role="menu"][aria-label="Overlays"] [role^="menuitem"]', { hasText: 'Face orientation' })
    .first()
    .dispatchEvent('click')
  await page.waitForTimeout(500)
  const oriented = await middleColour()
  check('face orientation paints the front faces blue',
    oriented[2] > oriented[0] && JSON.stringify(oriented) !== JSON.stringify(solid),
    `solid ${solid.join(',')} → oriented ${oriented.join(',')}`)
  await shot('scene-normals-face-orientation.png')

  /* ------------------------------------------------------------- flip and recalculate */

  await page.locator('#main').focus()
  await page.keyboard.press('F3')
  await page.waitForSelector('.scene-palette__input')
  await page.keyboard.type('Flip')
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const flipped = await volume()
  check('flipping every face turns the cube inside out', flipped < 0, flipped.toFixed(3))
  const inside = await middleColour()
  check('and the overlay goes red where it was blue', inside[0] > inside[2],
    `${inside.join(',')}`)
  await shot('scene-normals-inside-out.png')

  await page.keyboard.press('Shift+KeyN')
  await page.waitForTimeout(500)
  const fixed = await volume()
  check('⇧N winds it outwards again', fixed > 0, fixed.toFixed(3))
  const repaired = await middleColour()
  check('and the overlay is blue again', repaired[2] > repaired[0], repaired.join(','))

  /* ------------------------------------------------------------------ boolean */

  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  // A second cube, offset so that the two overlap in one corner.
  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Shift')
  await page.waitForSelector('.scene-menu[role="menu"]')
  for (const letter of ['c', 'u', 'b']) await page.keyboard.press(`Key${letter.toUpperCase()}`)
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  await page.keyboard.press('KeyG')
  await page.waitForTimeout(150)
  await page.keyboard.press('KeyX')
  await page.keyboard.press('Digit1')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const two = await scene()
  check('there are two cubes, one metre apart', two.objects.filter((object) => object.data.kind === 'mesh').length === 2,
    `${two.objects.length} objects`)

  await page.keyboard.press('KeyA')
  await page.waitForTimeout(250)
  await page.keyboard.press('F3')
  await page.waitForSelector('.scene-palette__input')
  await page.keyboard.type('Boolean union')
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const united = await scene()
  const meshes = united.objects.filter((object) => object.data.kind === 'mesh')
  check('the union leaves one object', meshes.length === 1, `${meshes.length} meshes`)
  const unionVolume = await volume()
  // Two two-metre cubes offset by one metre along X overlap in a 1 x 2 x 2 box: 8 + 8 - 4 = 12.
  check('and its volume is the two cubes less what they shared',
    Math.abs(unionVolume - 12) / 12 < 0.02, `${unionVolume.toFixed(3)} m³, expected 12`)
  await shot('scene-normals-boolean-union.png')

  /* --------------------------------------------------------------------- spin */

  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(250)
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  await page.keyboard.press('Digit3')
  await page.waitForTimeout(200)
  // One face, not the whole cube: a closed mesh spun a whole turn welds back onto itself and comes
  // out as it went in, which is right and is not what this check is about. A single face has a rim,
  // and a rim is what a sweep bridges.
  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(300)
  const beforeSpin = (await meshOf()).faces.length
  await page.keyboard.press('F3')
  await page.waitForSelector('.scene-palette__input')
  await page.keyboard.type('Spin')
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  // The palette starts the gesture, as a menu entry does in Blender; Enter keeps what it made.
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  const spun = (await meshOf()).faces.length
  check('spin sweeps the selection into a ring of faces', spun > beforeSpin, `${beforeSpin} → ${spun} faces`)
  await shot('scene-normals-spin.png')

  const errors = await page.evaluate(() => window.__paramrigErrors ?? [])
  check('no console errors of our own', errors.length === 0, errors.join(' | '))
})
