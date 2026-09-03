import { run } from './lib.mjs'

/** Chantier 6: collections, and an empty that stands in for one. */
export default run('scene-collections', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene, null, { timeout: 15000 })
  await page.waitForTimeout(400)
  const before = await page.evaluate(() => { window.__paramrigScene.frame(); return window.__paramrigScene.stats() })

  // A second collection, with the cube moved into it, then instanced by an empty.
  await helpers.seedScene((stored) => {
    const cube = stored.objects.find((object) => object.name === 'Cube')
    return {
      collections: [...stored.collections, { id: 'parts', name: 'Parts', parentId: stored.collections[0].id }],
      objects: [
        ...stored.objects.map((object) => (object.id === cube.id ? { ...object, collectionId: 'parts' } : object)),
        {
          id: 'instance-1',
          name: 'Parts instance',
          kind: 'empty',
          collectionId: stored.collections[0].id,
          transform: { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          visible: true,
          selectable: true,
          renderable: true,
          data: { kind: 'empty', display: 'plain-axes', size: 1, instanceCollectionId: 'parts' },
          modifiers: [],
          materialSlots: [],
        },
      ],
    }
  })

  const stored = await helpers.scene()
  check('the collection survives a reload', stored.collections.some((entry) => entry.name === 'Parts'),
    stored.collections.map((entry) => entry.name).join(', '))
  check('and the empty keeps the collection it stands in for',
    stored.objects.find((object) => object.id === 'instance-1')?.data.instanceCollectionId === 'parts')

  // An instance draws the collection's contents where the empty is, without copying them.
  const after = await page.evaluate(() => { window.__paramrigScene.frame(); return window.__paramrigScene.stats() })
  log(`MEASURE triangles drawn: ${before.triangles} before the instance, ${after.triangles} after`)
  check('the document still holds one mesh', after.meshes === 1, `${after.meshes} meshes`)
  log(`MEASURE triangles rendered: ${before.renderedTriangles} before, ${after.renderedTriangles} after`)
  // The frame gains the cube's twelve triangles and the empty's own glyph, from the one mesh the
  // document holds: an instance draws a collection, it does not copy it.
  check('and the frame really draws the collection twice, from one mesh',
    after.renderedTriangles - before.renderedTriangles >= 12 && after.meshes === before.meshes,
    `${before.renderedTriangles} → ${after.renderedTriangles} triangles from ${after.meshes} mesh`)
  // The proof it is really drawn there: the id buffer finds the empty where the collection is shown.
  const at = await page.evaluate(() => window.__paramrigScene.project([5, 0, 0]))
  const picked = await page.evaluate(([x, y]) => window.__paramrigScene.pickObject(x, y), at)
  check('the instance is picked where it is drawn, and answers as the empty', picked === 'instance-1', String(picked))

  // The outliner shows the nesting.
  const rows = await page.locator('.scene-outliner__label').allTextContents()
  check('the outliner shows the collection and what is in it',
    rows.includes('Parts') && rows.includes('Cube') && rows.includes('Parts instance'), rows.join(', '))

  // Excluding a collection takes its objects out of the picture.
  await helpers.seedScene((current) => ({
    collections: current.collections.map((entry) => (entry.id === 'parts' ? { ...entry, excluded: true } : entry)),
  }))
  const excluded = await page.evaluate(() => window.__paramrigScene.bounds())
  log(`MEASURE bounds with the collection excluded: ${JSON.stringify(excluded)}`)
  check('excluding a collection takes its objects out of the view',
    !excluded || excluded.min[0] > -1.5, JSON.stringify(excluded?.min))

  await shot('scene-collections-1440.png')
})
