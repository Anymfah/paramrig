/*
 * The preview's size and the toolbar around it. A 1440 preset in a stage 1120 wide used to overflow
 * and be cut off while the zoom stayed at 100%; the size button read "1120 px" with a gap between
 * the label and its chevron, and the state was a 6 px dot whose only words lived in a tooltip that
 * disappeared entirely at 390.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { run, OUTPUT } from './lib.mjs'
import { openWorkspace } from './web-lib.mjs'

export default run('web-viewport', async ({ page, check, log, shot }) => {
  mkdirSync(join(OUTPUT, 'web-viewport'), { recursive: true })
  await openWorkspace(page)

  const size = () => page.locator('.web-size-trigger').innerText()
  const stage = () => page.evaluate(() => {
    const box = document.querySelector('.web-preview-stage')
    const frame = document.querySelector('.web-preview-size')
    return { stage: Math.round(box.clientWidth), shown: Math.round(frame.getBoundingClientRect().width), frame: Number(document.querySelector('iframe').getAttribute('width')) }
  })
  // The trigger toggles, and choosing a preset leaves the popover open: clicking again would shut
  // it rather than open it.
  const openSize = async () => {
    if (await page.locator('.web-view-popover').count() === 0) await page.locator('.web-size-trigger').click()
    await page.waitForSelector('.web-view-popover')
    await page.waitForTimeout(250)
  }
  const closeSize = async () => {
    if (await page.locator('.web-view-popover').count() > 0) { await page.keyboard.press('Escape'); await page.waitForTimeout(300) }
  }
  const zoomValue = () => page.locator('.web-view-popover .select-trigger__value').innerText()

  const fluid = await stage()
  log(`NOTE available width ${fluid.stage}, preview ${fluid.shown}`)
  check('the preview opens at the width it has', Math.abs(fluid.shown - fluid.stage) <= 2, JSON.stringify(fluid))

  // A preset wider than the stage.
  await openSize()
  await page.locator('.web-viewport-presets button[aria-label="Desktop"]').click()
  await page.waitForTimeout(600)
  const desktop = await stage()
  log(`NOTE desktop preset: ${JSON.stringify(desktop)} trigger ${JSON.stringify(await size())}`)
  check('the preset gives the page the viewport it asked for', desktop.frame === 1440, String(desktop.frame))
  check('and it is shown whole rather than cut off', desktop.shown <= desktop.stage + 2, JSON.stringify(desktop))
  check('the zoom says it is fitting the width', await zoomValue() === 'Fit width', await zoomValue())
  await closeSize()
  const tip = await page.locator('.web-size-trigger').hover().then(async () => { await page.waitForTimeout(500); return page.getByRole('tooltip').innerText() }).catch(() => '')
  log(`NOTE size tooltip: ${JSON.stringify(tip)}`)
  check('and the size button says so too', /fitted to \d+%/.test(tip), tip)
  await shot('web-viewport/desktop-preset-1440.png')

  // Back to the width that is actually there.
  await page.mouse.move(700, 500)
  await openSize()
  await page.locator('.web-viewport-presets button[aria-label="Available width"]').click()
  await page.waitForTimeout(600)
  check('leaving the preset puts the zoom back to 100%', await zoomValue() === '100%', await zoomValue())
  const ladder = await page.evaluate(async () => {
    const trigger = [...document.querySelectorAll('.web-view-popover .select-trigger')].at(-1)
    trigger.click()
    await new Promise(r => setTimeout(r, 300))
    return [...document.querySelectorAll('[role="option"]')].map(o => o.textContent)
  })
  log(`NOTE zoom ladder: ${JSON.stringify(ladder)}`)
  check('the zoom ladder goes above 100% as well as below', JSON.stringify(ladder) === JSON.stringify(['50%', '75%', '100%', '150%', '200%', 'Fit width']), JSON.stringify(ladder))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  // Escape hands focus back to the trigger; that is not a request for its tooltip.
  const ghost = await page.getByRole('tooltip').count()
  check('closing the size menu does not open its tooltip', ghost === 0, String(ghost))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // The page picker is as wide as what it says.
  const picker = await page.evaluate(() => {
    const trigger = document.querySelector('.web-page-picker .select-trigger')
    const value = trigger.querySelector('.select-trigger__value').getBoundingClientRect()
    const icon = trigger.querySelector('svg').getBoundingClientRect()
    return { width: Math.round(trigger.getBoundingClientRect().width), gap: Math.round(icon.left - value.right) }
  })
  log(`NOTE page picker: ${JSON.stringify(picker)}`)
  check('the page picker fits its label', picker.width < 100, JSON.stringify(picker))
  check('the chevron sits against the label', picker.gap < 12, JSON.stringify(picker))

  // The state.
  const dot = await page.evaluate(() => {
    const el = document.querySelector('.web-toolbar .web-status-dot')
    return el ? Math.round(el.getBoundingClientRect().width) : null
  })
  check('the state dot is big enough to see', dot === 8, String(dot))

  // …and at 390, where the dot is not on screen at all, it is in the project menu.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(600)
  await page.locator('.web-project-button').click()
  await page.waitForTimeout(400)
  const menu = await page.locator('[role="menu"]').innerText()
  const status = await page.locator('.web-sync').getAttribute('aria-label')
  log(`NOTE project menu at 390: ${JSON.stringify(menu.split('\n')[0])} · toolbar says ${JSON.stringify(status)}`)
  check('the state is readable in the project menu', menu.split('\n')[0] === status, `${menu.split('\n')[0]} vs ${status}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await shot('web-viewport/toolbar-390.png')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(400)
})
