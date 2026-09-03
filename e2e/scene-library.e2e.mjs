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
  check('and draws it a card picture', await page.locator('.rig-card .scene-thumb').count() === 1)
  const summary = await page.locator('.rig-card', { hasText: 'Untitled' }).locator('p').first().textContent()
  check('the card says what it is', summary === 'Scene · 3 objects', summary)
  log(`MEASURE library cards: ${cards.length}`)

  await shot('scene-library-1440.png')
})
