import { run } from './lib.mjs'

/**
 * Chantier U: the shader editor.
 *
 * "Use nodes" is a change of representation rather than of appearance, so the first thing to check
 * is that it changes nothing: the graph a conversion makes is the Principled it came from. After
 * that, the editor's own gestures — the palette, a cable made with the keyboard, a node's field
 * driven by a control — and the one rule that keeps a graph a graph: no loops.
 */

const materialOf = async (helpers) => {
  const document = await helpers.scene()
  return document.materials[0]
}

export default run('scene-shader', async ({ page, check, log, helpers, shot }) => {
  await helpers.newScene()
  await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
  const box = await helpers.viewportBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(400)

  /* ------------------------------------------------------------- the space */

  await page.locator('button[aria-label="Shader editor"]').click()
  // The engine is thousands of modules in development, so the space is a placeholder for a moment.
  await page.waitForSelector('.graph', { timeout: 30000 })
  await page.waitForTimeout(400)
  check('the header opens the shader editor beside the viewport',
    (await helpers.scene()).view.shader?.open === true, JSON.stringify((await helpers.scene()).view.shader))
  check('and the viewport is still there, sharing the room',
    (await page.locator('.scene-viewport').count()) === 1, 'one viewport')

  /*
   * The graph gets most of the room: the space is beside the viewport *and* beside the properties,
   * and its own sidebar hides itself when the pane is narrow — which is right, and which would
   * leave this script nothing to type into.
   */
  const splitter = page.locator('[aria-label="Viewport and shader editor"]')
  await splitter.focus()
  for (let step = 0; step < 12; step += 1) await splitter.press('ArrowLeft')
  await page.waitForTimeout(400)

  const nodes = await page.locator('.graph-node').count()
  check('a material with no graph is drawn as the graph its Principled describes', nodes === 7, `${nodes} nodes`)
  const cables = await page.locator('.graph__cable').count()
  check('with a cable from every field into the surface, and the surface out', cables === 6, `${cables} cables`)

  /* -------------------------------------------------------------- use nodes */

  const before = await materialOf(helpers)
  await page.locator('.scene-shader__header').getByLabel('Use nodes').click()
  await page.waitForTimeout(700)
  const after = await materialOf(helpers)
  check('Use nodes writes the graph onto the material and leaves its fields alone',
    after.useNodes === true && !!after.graph && after.baseColor === before.baseColor,
    `useNodes ${after.useNodes}, base colour ${after.baseColor}`)
  check('and the graph it wrote is the Principled it came from',
    after.graph.nodes.length === 7 && after.graph.nodes.some((node) => node.type === 'pbr-surface'),
    after.graph.nodes.map((node) => node.type).join(', '))

  /* ---------------------------------------------------------- adding a node */

  await page.locator('.graph').click({ position: { x: 60, y: 300 } })
  await page.keyboard.press('Shift+KeyA')
  const palette = page.locator('[role="dialog"][aria-label="Add node"]')
  await palette.waitFor({ timeout: 10000 })
  await palette.getByLabel('Filter nodes').fill('noise')
  await page.waitForTimeout(200)
  await palette.locator('.graph-palette__entry').first().click()
  await page.waitForTimeout(700)
  const withNoise = await materialOf(helpers)
  check('⇧A opens the palette, and what is chosen lands in the graph',
    withNoise.graph.nodes.some((node) => node.type === 'noise-texture'),
    withNoise.graph.nodes.map((node) => node.type).join(', '))
  const noiseId = withNoise.graph.nodes.find((node) => node.type === 'noise-texture')?.id

  /* --------------------------------------------------------- a cable, by key */

  const noise = page.locator(`[data-node="${noiseId}"]`)
  await noise.getByLabel('Factor, output').focus()
  await noise.getByLabel('Factor, output').press('Enter')
  const surface = page.locator('[data-node="pbr-surface"]')
  check('a socket that would take the cable is lit before it is let go',
    await surface.getByLabel('Roughness, input').getAttribute('data-compatible') !== null, 'lit')
  await surface.getByLabel('Roughness, input').press('Enter')
  await page.waitForTimeout(700)
  const joined = await materialOf(helpers)
  check('Enter on one socket and Enter on another makes the cable',
    joined.graph.edges.some((edge) => edge.fromNode === noiseId && edge.toPort === 'roughness'),
    joined.graph.edges.filter((edge) => edge.toNode === 'pbr-surface').map((edge) => edge.toPort).join(', '))
  check('and the cable it replaced is gone: an input takes one',
    joined.graph.edges.filter((edge) => edge.toNode === 'pbr-surface' && edge.toPort === 'roughness').length === 1,
    'one cable in the roughness')
  await shot('scene-shader-graph-1440.png')

  /* ------------------------------------------------------------ the setting */

  await noise.locator('.graph-node__header').click()
  await page.waitForTimeout(400)
  /*
   * The node carries its own fields, and the sidebar repeats them for the node that is selected —
   * except in a pane too narrow to hold both, where the sidebar stands aside. So the field is typed
   * into on the node, which is where it is in either case, and the sidebar is checked when it is there.
   */
  const sidebar = page.locator('.scene-shader__sidebar')
  const sidebarShown = await sidebar.isVisible()
  check('the sidebar names the node that was clicked, when there is room for it',
    !sidebarShown || /Noise Texture/.test(await sidebar.innerText()),
    sidebarShown ? (await sidebar.innerText()).split('\n')[1] ?? '' : 'no room, and it stood aside')
  const detail = noise.getByLabel('Detail', { exact: true }).first()
  await detail.fill('7')
  await detail.press('Enter')
  await page.waitForTimeout(700)
  const tuned = await materialOf(helpers)
  check('a node’s field writes into the graph',
    tuned.graph.nodes.find((node) => node.id === noiseId)?.settings?.noiseDetail === 7,
    String(tuned.graph.nodes.find((node) => node.id === noiseId)?.settings?.noiseDetail))

  /* ---------------------------------------------------------------- the undo */

  // One step, not two: a field that reports its value twice must not be two things to undo.
  await page.locator('.scene-properties__tab[aria-label="History"]').click().catch(() => {})
  await page.waitForTimeout(400)
  const steps = await page.locator('.scene-history__label').allInnerTexts()
  check('a typed number is one step of history rather than two',
    steps.filter((label) => label === 'Node setting').length === 1, steps.slice(-5).join(' · '))
  await page.locator('#main').focus()
  const detailOf = async () => (await materialOf(helpers)).graph.nodes.find((node) => node.id === noiseId)?.settings?.noiseDetail
  await page.keyboard.press('Control+KeyZ')
  for (let attempt = 0; attempt < 12 && await detailOf() === 7; attempt += 1) await page.waitForTimeout(200)
  const undone = await detailOf()
  check('one undo takes back the last change to the graph', undone !== 7, String(undone))

  /* ------------------------------------------------------------- the refusal */

  await surface.getByLabel('Shader, output').press('Enter')
  await noise.getByLabel('Vector, input').press('Enter')
  await page.waitForTimeout(500)
  const message = await page.locator('.scene-status__message').innerText()
  check('two sockets that do not carry the same thing are refused, and it says why',
    /do not carry the same thing/.test(message), message)

  /* ------------------------------------------------------------ the budgets */

  /*
   * Five hundred nodes, panned. The prompt's number, and the reason for it is that a node editor
   * that stutters at a hundred is one nobody builds a real material in. The graph is seeded rather
   * than drawn: five hundred clicks is not a test, it is an afternoon.
   */
  // The page saves on a debounce, so its own write must land before this one replaces it.
  await page.waitForTimeout(1200)
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('paramrig.scene-documents.v1') ?? '{}')
    const id = location.pathname.split('/r/')[1]
    const document = store[id]
    const nodes = []
    const edges = []
    for (let index = 0; index < 500; index += 1) {
      nodes.push({
        id: `v-${index}`,
        type: 'value',
        x: (index % 25) * 260,
        y: Math.floor(index / 25) * 120,
        inputs: [],
        outputs: [{ id: 'value', label: 'Value', tone: 'scalar' }],
        settings: { scalarValue: 0.5 },
      })
      if (index > 0 && index % 25 !== 0) {
        edges.push({
          id: `e-${index}`,
          fromNode: `v-${index - 1}`,
          fromPort: 'value',
          toNode: `v-${index}`,
          toPort: 'value',
          tone: 'scalar',
        })
      }
    }
    document.materials[0].graph = { version: 2, nodes, edges, frames: [] }
    document.materials[0].useNodes = true
    store[id] = document
    localStorage.setItem('paramrig.scene-documents.v1', JSON.stringify(store))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.graph-node', { timeout: 30000 })
  await page.waitForTimeout(600)
  const drawn = await page.locator('.graph-node').count()
  check('five hundred nodes are drawn', drawn === 500, `${drawn} nodes`)

  /*
   * What a frame costs when nothing is happening, so the pan's number can be read against it rather
   * than against a hope. A browser sharing a machine with four development stacks does not hand out
   * sixteen-millisecond frames for free.
   */
  const idle = await page.evaluate(async () => {
    const frames = []
    let last = performance.now()
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now()
        frames.push(now - last)
        last = now
        if (frames.length < 60) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    const sorted = frames.slice(5).sort((a, b) => a - b)
    return sorted.reduce((total, value) => total + value, 0) / sorted.length
  })
  log(`MEASURE the same page doing nothing: ${idle.toFixed(1)} ms a frame`)

  const pan = await page.evaluate(async () => {
    const surface = document.querySelector('.graph')
    const box = surface.getBoundingClientRect()
    const send = (type, x, y, buttons) => surface.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 1, clientX: x, clientY: y, buttons, button: type === 'pointermove' ? -1 : 1,
    }))
    const frames = []
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      frames.push(now - last)
      last = now
      if (frames.length < 90) requestAnimationFrame(tick)
    }
    send('pointerdown', box.left + box.width / 2, box.top + box.height / 2, 4)
    requestAnimationFrame(tick)
    for (let step = 0; step < 60; step += 1) {
      send('pointermove', box.left + box.width / 2 + step * 4, box.top + box.height / 2 + step, 4)
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    send('pointerup', box.left + box.width / 2, box.top + box.height / 2, 0)
    const sorted = frames.slice(5).sort((a, b) => a - b)
    return { mean: sorted.reduce((total, value) => total + value, 0) / sorted.length, p95: sorted[Math.floor(sorted.length * 0.95)] }
  })
  log(`MEASURE pan over 500 nodes: ${pan.mean.toFixed(1)} ms mean, ${pan.p95.toFixed(1)} ms p95`)
  check('panning five hundred nodes costs no more than the page costs standing still',
    pan.mean < Math.max(20, idle * 1.35), `${pan.mean.toFixed(1)} ms panning against ${idle.toFixed(1)} ms idle`)

  /* A forty-node graph compiled, which is the other number the prompt asks for. */
  const compile = await page.evaluate(async () => {
    const module = await import('/src/scene/shader/prismorphic/material-graph-glsl.ts')
    const nodes = []
    const edges = []
    /*
     * A chain rather than a heap: the compiler only walks what the output can reach, so
     * thirty-eight nodes sitting on their own would compile to nothing and the number would be a
     * lie. Each one takes the last one's answer.
     */
    for (let index = 0; index < 38; index += 1) {
      nodes.push({
        id: `n-${index}`,
        type: 'math',
        x: index * 40,
        y: 0,
        inputs: [{ id: 'a', label: 'Value', tone: 'scalar' }, { id: 'b', label: 'Value', tone: 'scalar' }],
        outputs: [{ id: 'value', label: 'Value', tone: 'scalar' }],
        settings: { mathOperation: 'Multiply' },
      })
      if (index > 0) {
        edges.push({ id: `c-${index}`, fromNode: `n-${index - 1}`, fromPort: 'value', toNode: `n-${index}`, toPort: 'a', tone: 'scalar' })
      }
    }
    nodes.push({
      id: 'surface',
      type: 'pbr-surface',
      x: 2000,
      y: 0,
      inputs: [
        { id: 'baseColor', label: 'Base color', tone: 'color' },
        { id: 'metallic', label: 'Metallic', tone: 'scalar' },
        { id: 'roughness', label: 'Roughness', tone: 'scalar' },
        { id: 'emission', label: 'Emission', tone: 'color' },
        { id: 'opacity', label: 'Opacity', tone: 'scalar' },
        { id: 'normal', label: 'Normal', tone: 'vector' },
        { id: 'displacement', label: 'Displacement', tone: 'scalar' },
      ],
      outputs: [{ id: 'shader', label: 'Shader', tone: 'shader' }],
      settings: {},
    })
    nodes.push({
      id: 'out',
      type: 'material-output',
      x: 2300,
      y: 0,
      inputs: [{ id: 'surface', label: 'Surface', tone: 'shader' }],
      outputs: [],
      settings: { outputEnabled: true, outputBlend: 'Opaque' },
    })
    edges.push({ id: 'e-r', fromNode: 'n-37', fromPort: 'value', toNode: 'surface', toPort: 'roughness', tone: 'scalar' })
    edges.push({ id: 'e-s', fromNode: 'surface', fromPort: 'shader', toNode: 'out', toPort: 'surface', tone: 'shader' })
    const graph = { version: 2, nodes, edges, frames: [] }
    module.clearMaterialGraphGlslCache()
    const started = performance.now()
    const compiled = module.compileMaterialGraphGlsl(graph)
    const cold = performance.now() - started
    const again = performance.now()
    module.getCachedMaterialGraphGlsl(graph)
    return { cold, warm: performance.now() - again, nodes: compiled.reachableNodeIds.length }
  })
  log(`MEASURE a forty-node graph compiled: ${compile.cold.toFixed(1)} ms cold, ${compile.warm.toFixed(2)} ms from the cache, ${compile.nodes} nodes reached`)
  check('a forty-node graph compiles in a fraction of a frame, and every node of it is reached',
    compile.cold < 50 && compile.nodes >= 40, `${compile.cold.toFixed(1)} ms for ${compile.nodes} nodes`)
})
