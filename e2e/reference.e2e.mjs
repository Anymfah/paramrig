import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, BASE } from './lib.mjs'

/**
 * The before / after record of the tidying pass: the same four states, captured and measured, so
 * the two runs can be put side by side. `PARAMRIG_PHASE` picks the folder.
 */
const PHASE = process.env.PARAMRIG_PHASE ?? 'after'
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'reference', PHASE)

export default run(`reference-${PHASE}`, async ({ page, check, log, helpers }) => {
  mkdirSync(DIR, { recursive: true })
  const shot = (file) => page.screenshot({ path: join(DIR, file) })

  const toolbarControls = () => page.evaluate(() => {
    const bar = document.querySelector('.vector-toolbar')
    if (!bar) return 0
    return [...bar.querySelectorAll('button, [role="button"], input:not([type="file"]), a')]
      .filter((node) => node.offsetParent !== null && node.getBoundingClientRect().width > 0).length
  })
  const openSections = () => page.evaluate(() => {
    const body = document.querySelector('.vector-inspector__body')
    if (!body) return 0
    return [...body.querySelectorAll('section')].filter((node) => node.getBoundingClientRect().height > 0).length
  })
  const inspectorHeight = () => page.evaluate(() => {
    const body = document.querySelector('.vector-inspector__body')
    return body ? Math.round(body.scrollHeight) : 0
  })

  await helpers.newDocument()
  await page.waitForTimeout(300)

  const bars = await toolbarControls()
  const emptySections = await openSections()
  log(`MEASURE toolbar controls at 1440: ${bars}`)
  log(`MEASURE sections with nothing selected: ${emptySections}`)
  await shot('empty-1440.png')
  check('the empty state was captured', bars > 0)

  await page.keyboard.press('r')
  await helpers.drag({ x: 180, y: 150 }, { x: 460, y: 340 })
  await page.waitForTimeout(250)
  const rectSections = await openSections()
  const rectHeight = await inspectorHeight()
  log(`MEASURE sections with one rectangle: ${rectSections}`)
  log(`MEASURE inspector content height for a rectangle: ${rectHeight}px`)
  await shot('rectangle-1440.png')
  check('a rectangle was drawn and inspected', rectHeight > 0)

  await page.locator('#main').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const nodeSections = await openSections()
  const nodeHeight = await inspectorHeight()
  log(`MEASURE sections in node mode: ${nodeSections}`)
  log(`MEASURE inspector content height in node mode: ${nodeHeight}px`)
  await shot('nodes-1440.png')
  check('node mode was captured', await page.locator('.vector-canvas[data-tool="node"]').count() === 1)

  await page.setViewportSize({ width: 320, height: 720 })
  await page.waitForTimeout(400)
  await shot('rectangle-320.png')
  const narrowBars = await toolbarControls()
  log(`MEASURE toolbar controls at 320: ${narrowBars}`)
  check('the narrow layout was captured', narrowBars > 0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.waitForTimeout(300)
  await shot('rectangle-1440-light.png')
  check('the light theme was captured', await page.evaluate(() => document.documentElement.dataset.theme) === 'light')
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  log(`Saved to e2e/reference/${PHASE} from ${BASE}`)
})
