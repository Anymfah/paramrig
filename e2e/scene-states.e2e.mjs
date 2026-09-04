import { run } from './lib.mjs'

/**
 * The states the editor is judged by, photographed.
 *
 * Prompt 4 asks for the same five pictures before the work and after it, so that the bilan can put
 * them side by side rather than assert that nothing was disturbed. They are taken by one script for
 * exactly that reason: two scripts would drift, and a comparison between two different framings
 * says nothing at all.
 *
 * The captures land in `e2e/output/state-*.png`; whoever runs it copies them into
 * `e2e/reference/scene/before/` or `after/`, which is a decision about which run counts rather than
 * something the script can know.
 */
export default run('scene-states', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })

  /** What a state is worth measuring by, alongside its picture. */
  const measure = async (name) => {
    const header = await page.locator('.scene-header .scene-menu__trigger, .scene-header button').count()
    const sections = await page.locator('.scene-properties .scene-section[data-open="true"]').count()
    const height = await page.evaluate(() => {
      const body = document.querySelector('.scene-properties__body')
      return body ? Math.round(body.scrollHeight) : 0
    })
    log(`MEASURE ${name}: ${header} header controls, ${sections} open sections, ${height}px of properties`)
  }

  /* ------------------------------------------------------------ nothing selected */

  await page.locator('#main').focus()
  await page.keyboard.press('Alt+KeyA')
  await page.waitForTimeout(400)
  await shot('state-empty-1440.png')
  await measure('empty at 1440')

  /* -------------------------------------------------------------- a cube selected */

  await page.locator('.scene-outliner__row', { hasText: 'Cube' }).first().click()
  await page.waitForTimeout(400)
  await shot('state-cube-1440.png')
  await measure('cube selected at 1440')

  /* ------------------------------------------------------------------ edit mode */

  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(700)
  await shot('state-edit-1440.png')
  await measure('edit mode at 1440')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(500)

  /* ------------------------------------------------------------ the Modifiers tab */

  await page.locator('.scene-properties__tab[aria-label="Modifiers"]').click()
  await page.waitForSelector('.scene-modifiers')
  await page.locator('.scene-modifiers__add .scene-menu__trigger').click()
  await page.waitForSelector('.scene-menu[role="menu"]')
  await page.locator('.scene-menu__item', { hasText: 'Subdivision' }).first().dispatchEvent('click')
  await page.waitForTimeout(600)
  await shot('state-modifiers-1440.png')
  await measure('the Modifiers tab at 1440')
  const stack = (await helpers.scene()).objects.find((object) => object.name === 'Cube').modifiers
  check('the Modifiers tab is photographed with a modifier on it', stack.length === 1, `${stack.length} modifiers`)

  /* ------------------------------------------------------------------- at 320 px */

  await page.setViewportSize({ width: 320, height: 720 })
  await page.waitForTimeout(600)
  await shot('state-mobile-320.png')
  await measure('at 320')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(300)

  check('every state was photographed', true, 'five captures')
})
