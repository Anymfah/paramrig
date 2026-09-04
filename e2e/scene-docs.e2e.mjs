import { run, BASE } from './lib.mjs'

/**
 * Chantier M4: what someone building a scene rig reads, and what happens when they hand one over.
 *
 * The page is checked against the parser rather than against itself — the paths it lists are the
 * ones the app accepts, so a table gone stale is a failure here rather than a surprise later.
 */
export default run('scene-docs', async ({ page, check, log, shot }) => {
  await page.goto(`${BASE}/docs/scene-rigs`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.docs-table', { timeout: 10000 })

  const rows = await page.locator('.docs-table tbody tr code').allInnerTexts()
  check('the page lists every family of path a binding may name',
    ['transform.position.x', 'visible', 'modifiers[<id>].<param>', 'light.power', 'camera.focalLength',
      'materials[<id>].baseColor', 'world.strength', 'cursor.position.x', 'mesh.vertices[<index>].x']
      .every((path) => rows.includes(path)),
    `${rows.length} rows`)
  log(`MEASURE scene rig docs: ${rows.length} property rows`)

  const code = await page.locator('.docs-code').innerText()
  check('and carries a whole file, rig and all',
    code.includes('"paramrig.scene"') && code.includes('"bindings"') && code.includes('modifiers[round].levels'))
  const approximations = await page.locator('h2', { hasText: 'Known approximations' }).count()
  check('and says what it does not do', approximations === 1)
  await shot('scene-docs-1440.png')

  await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' })
  check('the docs index links to it', await page.locator('a[href="/docs/scene-rigs"]').count() === 1)

  /* ------------------------------------ a scene file, dropped on the library */

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.removeItem('paramrig.scene-documents.v1')
    localStorage.removeItem('paramrig.drafts.v1')
  })
  await page.reload({ waitUntil: 'networkidle' })

  const dropped = await page.evaluate(async () => {
    const mesh = {
      vertices: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
      vertexIds: [0, 1, 2, 3],
      nextVertexId: 4,
      edges: [[0, 1], [1, 2], [2, 3], [3, 0]],
      faces: [[0, 1, 2, 3]],
      faceIds: [0],
      nextFaceId: 1,
      attributes: { face: { smooth: [false], material: [0] }, edge: { crease: [0, 0, 0, 0], sharp: [false, false, false, false], seam: [false, false, false, false] } },
    }
    const project = {
      format: 'paramrig.scene',
      formatVersion: 1,
      kind: 'scene',
      document: {
        version: 1,
        id: 'scene-dropped-test',
        name: 'Dropped scene',
        objects: [{
          id: 'plate', name: 'Plate', kind: 'mesh', collectionId: 'collection-scene',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          visible: true, selectable: true, renderable: true,
          data: { kind: 'mesh', meshId: 'mesh-plate' },
          modifiers: [],
          materialSlots: ['material-plate'],
        }],
        meshes: { 'mesh-plate': mesh },
        collections: [{ id: 'collection-scene', name: 'Scene Collection' }],
        materials: [{
          id: 'material-plate', name: 'Plate', baseColor: '#cccccc', metallic: 0, roughness: 0.5,
          specular: 0.5, ior: 1.45, transmission: 0, emission: '#000000', emissionStrength: 0,
          alpha: 1, normalStrength: 1, backfaceCulling: false, blendMode: 'opaque',
        }],
        world: { color: '#3b3b3b', strength: 1 },
        cursor: { position: [0, 0, 0], rotation: [0, 0, 0] },
        units: { system: 'metric', scale: 1 },
        rig: {
          groups: [{ id: 'main', label: 'Main' }],
          parameters: [{ kind: 'number', id: 'lift', label: 'Lift', group: 'main', min: 0, max: 4, step: 0.1, defaultValue: 1 }],
          bindings: [{ id: 'b', objectId: 'plate', property: 'transform.position.z', parameterId: 'lift' }],
        },
        createdAt: '2026-09-04T00:00:00.000Z',
        updatedAt: '2026-09-04T00:00:00.000Z',
      },
    }
    const file = new File([JSON.stringify(project)], 'dropped.paramrig.json', { type: 'application/json' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    const shell = document.querySelector('.shell')
    shell.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    shell.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const stored = JSON.parse(localStorage.getItem('paramrig.scene-documents.v1') ?? '{}')['scene-dropped-test']
    return {
      path: location.pathname,
      controls: stored?.rig?.parameters?.length ?? 0,
      bindings: stored?.rig?.bindings?.length ?? 0,
      note: document.querySelector('.status-msg')?.textContent ?? '',
    }
  })
  log(`MEASURE dropped scene: ${JSON.stringify(dropped)}`)
  check('a dropped scene opens its document', dropped.path === '/r/scene-dropped-test', dropped.path)
  check('and brings its rig with it, in one file',
    dropped.controls === 1 && dropped.bindings === 1, JSON.stringify({ controls: dropped.controls, bindings: dropped.bindings }))

  // The reader is told what was dropped, rather than left to notice a missing control later.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const reported = await page.evaluate(async () => {
    const bad = { format: 'paramrig.scene', formatVersion: 1, kind: 'scene', document: { version: 1, id: 'scene-damaged', name: 'Damaged', objects: [], meshes: {}, collections: [{ id: 'collection-scene', name: 'Scene Collection' }], materials: [], world: { color: '#3b3b3b', strength: 1 }, cursor: { position: [0, 0, 0], rotation: [0, 0, 0] }, units: { system: 'metric', scale: 1 }, rig: { groups: [{ id: 'main', label: 'Main' }], parameters: [{ kind: 'number', id: 'lift', label: 'Lift', group: 'main', min: 0, max: 4, step: 0.1, defaultValue: 1 }], bindings: [{ id: 'orphan', objectId: 'nowhere', property: 'transform.position.z', parameterId: 'lift' }] }, createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z' } }
    const file = new File([JSON.stringify(bad)], 'damaged.paramrig.json', { type: 'application/json' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    const shell = document.querySelector('.shell')
    shell.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    shell.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 900))
    return [...document.querySelectorAll('.status-msg')].map((node) => node.textContent).join(' | ')
  })
  check('a binding pointing at nothing is reported rather than dropped in silence',
    /binding/.test(reported), reported || 'nothing said')
})
