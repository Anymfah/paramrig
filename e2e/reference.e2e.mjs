import { mkdirSync, writeFileSync } from 'node:fs'
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

  const measures = []
  const record = (label, value) => {
    measures.push(`${label}: ${value}`)
    log(`MEASURE ${label}: ${value}`)
  }
  const toolbarControls = () => page.evaluate(() => {
    const bar = document.querySelector('.vector-toolbar')
    if (!bar) return 0
    return [...bar.querySelectorAll('button, [role="button"], input:not([type="file"]), a')]
      .filter((node) => node.offsetParent !== null && node.getBoundingClientRect().width > 0).length
  })
  /** A split button and the zoom stepper each read as one control, however many buttons they hold. */
  const toolbarClusters = () => page.evaluate(() => {
    const bar = document.querySelector('.vector-toolbar')
    if (!bar) return 0
    const seen = new Set()
    let count = 0
    for (const node of bar.querySelectorAll('button, input:not([type="file"])')) {
      if (node.offsetParent === null) continue
      const cluster = node.closest('.vector-tool-menu, .vector-toolbar__zoom')
      if (cluster) { if (seen.has(cluster)) continue; seen.add(cluster) }
      count += 1
    }
    return count
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
  record('toolbar controls at 1440', bars)
  record('toolbar control clusters at 1440', await toolbarClusters())
  record('sections with nothing selected', emptySections)
  await shot('empty-1440.png')
  check('the empty state was captured', bars > 0)

  await page.keyboard.press('r')
  await helpers.drag({ x: 180, y: 150 }, { x: 460, y: 340 })
  await page.waitForTimeout(250)
  const rectSections = await openSections()
  const rectHeight = await inspectorHeight()
  record('sections with one rectangle', rectSections)
  record('inspector content height for a rectangle', `${rectHeight}px`)
  await shot('rectangle-1440.png')
  check('a rectangle was drawn and inspected', rectHeight > 0)

  await page.locator('#main').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const nodeSections = await openSections()
  const nodeHeight = await inspectorHeight()
  record('sections in node mode', nodeSections)
  record('inspector content height in node mode', `${nodeHeight}px`)
  await shot('nodes-1440.png')
  check('node mode was captured', await page.locator('.vector-canvas[data-tool="node"]').count() === 1)

  await page.setViewportSize({ width: 320, height: 720 })
  await page.waitForTimeout(400)
  await shot('rectangle-320.png')
  const narrowBars = await toolbarControls()
  record('toolbar controls at 320', narrowBars)
  check('the narrow layout was captured', narrowBars > 0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.waitForTimeout(300)
  await shot('rectangle-1440-light.png')
  check('the light theme was captured', await page.evaluate(() => document.documentElement.dataset.theme) === 'light')
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  writeFileSync(join(DIR, 'measurements.txt'), `${measures.join('\n')}\n`)
  log(`Saved to e2e/reference/${PHASE} from ${BASE}`)
})
