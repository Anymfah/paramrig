import { run } from './lib.mjs'

/** Chantier 7: G, R and S do what Blender's do, and write one history entry each. */
export default run('scene-transform', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  const box = await helpers.viewportBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  const cube = async () => {
    const stored = await helpers.scene()
    return stored.objects.find((object) => object.name === 'Cube')
  }

  await page.mouse.click(centre.x, centre.y)
  await page.waitForTimeout(300)
  // Not "there are three objects": which one the click landed on is the whole premise of the rest.
  const selected = await page.locator('.scene-properties input[type="text"]').first().inputValue().catch(() => '')
  check('the click landed on the cube, and not on a glyph in front of it', selected === 'Cube', selected || 'nothing selected')

  // G X 2 Enter moves exactly two metres along X, whatever the pointer did.
  await page.locator('#main').focus()
  await page.mouse.move(centre.x, centre.y)
  await page.keyboard.press('KeyG')
  await page.waitForTimeout(120)
  const hudVisible = await page.locator('.scene-hud').count()
  check('the readout appears beside the pointer', hudVisible === 1, String(hudVisible))
  const header = await page.locator('.scene-modal-header').textContent().catch(() => null)
  check('and the modal header says what the keys do', !!header && header.length > 0, header ?? 'none')
  await page.keyboard.press('KeyX')
  await page.keyboard.press('Digit2')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const moved = await cube()
  check('G X 2 moves the cube exactly two metres along X',
    Math.abs(moved.transform.position[0] - 2) < 1e-6 && Math.abs(moved.transform.position[1]) < 1e-6,
    JSON.stringify(moved.transform.position))
  check('and the readout is gone once it is over', await page.locator('.scene-hud').count() === 0)

  // R Z 90 turns it a quarter turn about Z.
  await page.keyboard.press('KeyR')
  await page.waitForTimeout(80)
  await page.keyboard.press('KeyZ')
  await page.keyboard.press('Digit9')
  await page.keyboard.press('Digit0')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const turned = await cube()
  check('R Z 90 turns it a quarter turn about Z', Math.abs(turned.transform.rotation[2] - 90) < 1e-4,
    JSON.stringify(turned.transform.rotation.map((value) => Math.round(value * 1000) / 1000)))

  // S 2 doubles it.
  await page.keyboard.press('KeyS')
  await page.waitForTimeout(80)
  await page.keyboard.press('Digit2')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const scaled = await cube()
  check('S 2 doubles it', scaled.transform.scale.every((value) => Math.abs(value - 2) < 1e-6),
    JSON.stringify(scaled.transform.scale))

  // Escape puts everything back, and leaves nothing behind it.
  await page.keyboard.press('KeyG')
  await page.waitForTimeout(80)
  await page.mouse.move(centre.x + 160, centre.y + 90)
  await page.waitForTimeout(80)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const restored = await cube()
  check('Escape restores the transform it started from',
    Math.abs(restored.transform.position[0] - 2) < 1e-6 && Math.abs(restored.transform.position[1]) < 1e-6,
    JSON.stringify(restored.transform.position))

  // A press and release that moved nothing is not an edit.
  await page.keyboard.press('KeyG')
  await page.waitForTimeout(80)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)

  // One session, one undo.
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  const undone = await cube()
  check('one undo takes back the whole scale, and no more',
    undone.transform.scale.every((value) => Math.abs(value - 1) < 1e-6) && Math.abs(undone.transform.rotation[2] - 90) < 1e-4,
    JSON.stringify({ scale: undone.transform.scale, rotation: undone.transform.rotation[2] }))

  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  const back = await cube()
  check('and two more take back the turn and the move',
    Math.abs(back.transform.position[0]) < 1e-6 && Math.abs(back.transform.rotation[2]) < 1e-4,
    JSON.stringify({ position: back.transform.position, rotation: back.transform.rotation }))

  await shot('scene-transform-1440.png')
})
