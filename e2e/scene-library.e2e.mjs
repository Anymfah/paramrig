import { run } from './lib.mjs'

/** Chantier 2: a scene is a document the library makes, stores, lists and hands back. */
export default run('scene-library', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()

  const url = page.url()
  check('New scene opens a document of its own', /\/r\/scene-/.test(url), url)

  const stored = await helpers.scene()
  check('the startup scene is a cube, a light and a camera', JSON.stringify(stored?.objects?.map((object) => object.name)) === '["Cube","Light","Camera"]', JSON.stringify(stored?.objects?.map((object) => object.name)))
  const mesh = Object.values(stored?.meshes ?? {})[0]
  check('the cube is eight corners, twelve edges and six quads', mesh?.vertexIds?.length === 8 && mesh?.edges?.length === 12 && mesh?.faces?.length === 6,
    `${mesh?.vertexIds?.length}/${mesh?.edges?.length}/${mesh?.faces?.length}`)
  check('it names the collection the way Blender does', stored?.collections?.[0]?.name === 'Scene Collection', stored?.collections?.[0]?.name)

  await page.goto(`${page.url().split('/r/')[0]}/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.rig-card')
  const cards = await page.locator('.rig-card h2').allTextContents()
  check('the library lists the scene beside the examples', cards.includes('Untitled'), cards.slice(0, 4).join(', '))
  check('and draws it a card picture',
    await page.locator('.rig-card', { hasText: 'Untitled' }).locator('.scene-thumb').count() === 1)
  const summary = await page.locator('.rig-card', { hasText: 'Untitled' }).locator('p').first().textContent()
  check('the card says what it is', summary === 'Scene · 3 objects', summary)
  log(`MEASURE library cards: ${cards.length}`)

  /* --------------------------------------------------------- the bundled scene */

  const example = page.locator('.rig-card', { hasText: 'Paper lantern' }).first()
  check('the example scene the app ships with is listed', await example.count() === 1)
  check('with its own picture, drawn as its controls rest',
    await example.locator('.scene-thumb').count() === 1)
  const kind = await example.locator('p').first().textContent()
  check('and the card says it is a rig', kind === 'Scene · 5 controls', kind)
  await shot('scene-library-1440.png')

  await example.click()
  await page.waitForSelector('.scene-preview canvas, .scene-stage', { timeout: 20000 })
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  const drawn = await page.evaluate(() => window.__paramrigScene.stats())
  check('it opens and draws, subdivided and solidified as its controls say',
    drawn.vertices > 100, `${drawn.vertices} vertices, ${drawn.triangles} triangles`)
  log(`MEASURE the bundled example: ${drawn.vertices} vertices, ${drawn.triangles} triangles`)
  const untouched = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('paramrig.scene-documents.v1') ?? '{}')))
  check('and opening it does not copy it into storage: it is still the one the app ships',
    !untouched.includes('example-paper-lantern'), untouched.join(', ') || 'nothing stored')
  await shot('scene-library-example-1440.png')
})
