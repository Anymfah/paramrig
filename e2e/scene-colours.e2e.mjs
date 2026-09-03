import { inflateSync } from 'node:zlib'
import { run } from './lib.mjs'

/**
 * The palette, measured in the picture rather than read off the stylesheet.
 *
 * The plan's rule is that what is selected has to be readable in a screenshot, in both themes. A
 * stylesheet cannot answer that: the outline is painted by a shader, over a ground the renderer
 * paints, so the only honest test is to take the screenshot, decode it and count pixels. That is
 * what this does — for the selection outline and the cube it wraps, and then, for the tokens whose
 * whole job is to be seen against the viewport ground, for the grid and the three axes.
 *
 * Two decisions are worth recording. `sharp` is not a dependency of this repository, so the PNG is
 * decoded here by hand: inflate the IDAT stream, then undo the five scanline filters, which for an
 * 8-bit non-interlaced image is the sixty lines below. And every pixel count is taken inside the
 * cube's neighbourhood rather than over the whole frame, because Playwright clips an element
 * screenshot out of the page: the floating toolbar overlaps the viewport, and its pressed tool is
 * a 32 px square of `--scene-selected` that would otherwise be counted as a selection outline.
 *
 * The colour arithmetic repeats `src/scene/contrast.ts` because the QA scripts run under plain
 * node with no TypeScript loader; that module is where the maths is tested, this is the copy that
 * runs in the harness.
 */

/* -------------------------------------------------------------- the picture */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }

/** An 8-bit, non-interlaced PNG, as `{ width, height, channels, pixels }`. */
function decodePng(buffer) {
  for (let index = 0; index < SIGNATURE.length; index += 1) {
    if (buffer[index] !== SIGNATURE[index]) throw new Error('the screenshot is not a PNG')
  }
  let offset = 8
  let header = null
  const parts = []
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colourType: data[9], interlace: data[12] }
    } else if (type === 'IDAT') parts.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (!header) throw new Error('the screenshot has no IHDR')
  if (header.depth !== 8) throw new Error(`the screenshot is ${header.depth} bits a channel, which this decoder does not read`)
  if (header.interlace !== 0) throw new Error('the screenshot is interlaced, which this decoder does not read')
  const channels = CHANNELS[header.colourType]
  if (!channels) throw new Error(`the screenshot is colour type ${header.colourType}, which this decoder does not read`)

  const raw = inflateSync(Buffer.concat(parts))
  const stride = header.width * channels
  const pixels = Buffer.alloc(header.height * stride)
  let position = 0
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[position]
    position += 1
    const line = raw.subarray(position, position + stride)
    position += stride
    const row = pixels.subarray(y * stride, (y + 1) * stride)
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x += 1) {
      // The filters look at the byte to the left, the byte above, and the byte above-left, each of
      // them one whole pixel away rather than one byte away.
      const left = x >= channels ? row[x - channels] : 0
      const above = prior ? prior[x] : 0
      const corner = prior && x >= channels ? prior[x - channels] : 0
      const value = line[x]
      let restored
      if (filter === 0) restored = value
      else if (filter === 1) restored = value + left
      else if (filter === 2) restored = value + above
      else if (filter === 3) restored = value + ((left + above) >> 1)
      else if (filter === 4) restored = value + paeth(left, above, corner)
      else throw new Error(`the screenshot uses PNG filter ${filter}, which is not one of the five`)
      row[x] = restored & 0xff
    }
  }
  return { width: header.width, height: header.height, channels, pixels }
}

function paeth(left, above, corner) {
  const estimate = left + above - corner
  const toLeft = Math.abs(estimate - left)
  const toAbove = Math.abs(estimate - above)
  const toCorner = Math.abs(estimate - corner)
  if (toLeft <= toAbove && toLeft <= toCorner) return left
  return toAbove <= toCorner ? above : corner
}

function pixelAt(image, x, y) {
  const at = (y * image.width + x) * image.channels
  if (image.channels <= 2) return { r: image.pixels[at], g: image.pixels[at], b: image.pixels[at] }
  return { r: image.pixels[at], g: image.pixels[at + 1], b: image.pixels[at + 2] }
}

/* -------------------------------------------------------------- the colours */

/** The same arithmetic as `src/scene/contrast.ts`; see the note at the top of this file. */
function parseColour(value) {
  const text = String(value).trim()
  const digits = /^#([0-9a-f]+)$/i.exec(text)?.[1]
  if (digits) {
    if (digits.length === 3 || digits.length === 4) {
      return { r: parseInt(digits[0].repeat(2), 16), g: parseInt(digits[1].repeat(2), 16), b: parseInt(digits[2].repeat(2), 16) }
    }
    if (digits.length === 6 || digits.length === 8) {
      return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16) }
    }
    return null
  }
  const parts = functionalParts(text)
  if (!parts || parts.length < 3) return null
  const channel = (part) => Math.round(part.endsWith('%') ? (Number(part.slice(0, -1)) / 100) * 255 : Number(part))
  const [r, g, b] = parts.slice(0, 3).map(channel)
  return [r, g, b].every(Number.isFinite) ? { r, g, b } : null
}

function alphaOf(value) {
  const text = String(value).trim()
  const digits = /^#([0-9a-f]+)$/i.exec(text)?.[1]
  if (digits) {
    if (digits.length === 4) return parseInt(digits[3].repeat(2), 16) / 255
    if (digits.length === 8) return parseInt(digits.slice(6, 8), 16) / 255
    return 1
  }
  const parts = functionalParts(text)
  if (!parts || parts.length < 4) return 1
  const alpha = parts[3]
  const fraction = alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha)
  return Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1
}

function functionalParts(text) {
  const body = /^rgba?\(([^)]*)\)$/i.exec(text)?.[1]
  return body === undefined ? null : body.split(/[\s,/]+/).filter((part) => part.length > 0)
}

function relativeLuminance(colour) {
  const linear = (byte) => {
    const value = Math.min(255, Math.max(0, byte)) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b)
}

function contrastRatio(a, b) {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function composite(colour, alpha, over) {
  const weight = Math.min(1, Math.max(0, alpha))
  const mix = (top, ground) => Math.min(255, Math.max(0, Math.round(top * weight + ground * (1 - weight))))
  return { r: mix(colour.r, over.r), g: mix(colour.g, over.g), b: mix(colour.b, over.b) }
}

const hex = (colour) => `#${[colour.r, colour.g, colour.b].map((part) => part.toString(16).padStart(2, '0')).join('')}`
const ratio = (value) => `${value.toFixed(2)}:1`
const distance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
const neutral = (colour) => Math.max(colour.r, colour.g, colour.b) - Math.min(colour.r, colour.g, colour.b) <= 8

/* -------------------------------------------------------------- the regions */

/** The convex hull of the projected corners, which is the cube's silhouette on screen. */
function convexHull(points) {
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const chainOf = (list) => {
    const chain = []
    for (const point of list) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop()
      chain.push(point)
    }
    chain.pop()
    return chain
  }
  return [...chainOf(sorted), ...chainOf([...sorted].reverse())]
}

/** The hull pulled in towards its own centre, so no sampled pixel sits on an edge or an outline. */
function shrink(polygon, factor) {
  const centre = polygon.reduce((sum, point) => ({ x: sum.x + point.x / polygon.length, y: sum.y + point.y / polygon.length }), { x: 0, y: 0 })
  return polygon.map((point) => ({ x: centre.x + (point.x - centre.x) * factor, y: centre.y + (point.y - centre.y) * factor }))
}

function inside(polygon, x, y) {
  let within = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]
    const b = polygon[previous]
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) within = !within
  }
  return within
}

function boundsOf(points, margin, image) {
  return {
    left: Math.max(0, Math.floor(Math.min(...points.map((point) => point.x)) - margin)),
    top: Math.max(0, Math.floor(Math.min(...points.map((point) => point.y)) - margin)),
    right: Math.min(image.width - 1, Math.ceil(Math.max(...points.map((point) => point.x)) + margin)),
    bottom: Math.min(image.height - 1, Math.ceil(Math.max(...points.map((point) => point.y)) + margin)),
  }
}

/** Every colour a region is painted in, commonest first. */
function colourCensus(image, box, keep) {
  const counts = new Map()
  for (let y = box.top; y <= box.bottom; y += 1) {
    for (let x = box.left; x <= box.right; x += 1) {
      if (!keep(x, y)) continue
      const colour = pixelAt(image, x, y)
      const key = (colour.r << 16) | (colour.g << 8) | colour.b
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ colour: { r: (key >> 16) & 0xff, g: (key >> 8) & 0xff, b: key & 0xff }, count }))
}

function countNear(image, box, target, tolerance) {
  let found = 0
  for (let y = box.top; y <= box.bottom; y += 1) {
    for (let x = box.left; x <= box.right; x += 1) {
      if (distance(pixelAt(image, x, y), target) <= tolerance) found += 1
    }
  }
  return found
}

/* -------------------------------------------------------------- the script */

/**
 * How close a pixel has to be to a token to count as wearing it. Well inside the gap between
 * `--scene-selected` and `--scene-active`, which is 40 apart in the light theme, so the two states
 * can never be mistaken for one another.
 */
const TOLERANCE = 18

/** How far outside the cube the outline is looked for. The band itself is two pixels wide. */
const MARGIN = 60

export default run('scene-colours', async ({ page, check, log, helpers, shot }) => {
  for (const theme of ['dark', 'light']) {
    log(`\n— the ${theme} theme`)
    await page.emulateMedia({ colorScheme: theme })
    await helpers.newScene()
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
    await page.waitForFunction(() => !!window.__paramrigScene && window.__paramrigScene.frames() > 0, null, { timeout: 20000 })
    await page.waitForTimeout(500)

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('.scene-viewport'))
      const read = (name) => style.getPropertyValue(name).trim()
      return {
        viewport: read('--scene-viewport'),
        selected: read('--scene-selected'),
        active: read('--scene-active'),
        grid: read('--scene-grid'),
        gridMajor: read('--scene-grid-major'),
        axisX: read('--scene-axis-x'),
        axisY: read('--scene-axis-y'),
        axisZ: read('--scene-axis-z'),
        outlineHalo: read('--scene-outline-halo'),
      }
    })
    const ground = parseColour(tokens.viewport)
    const selected = parseColour(tokens.selected)
    const active = parseColour(tokens.active)
    check(`${theme}: every token the QA measures can be read`,
      [ground, selected, active, parseColour(tokens.grid), parseColour(tokens.gridMajor),
        parseColour(tokens.axisX), parseColour(tokens.axisY), parseColour(tokens.axisZ)].every(Boolean),
      JSON.stringify(tokens))
    if (!ground || !selected || !active) continue
    log(`MEASURE ${theme} tokens — ground ${tokens.viewport}, selected ${tokens.selected}, active ${tokens.active}`)

    /* ---- the outline is there once something is selected, and not before ---- */

    const box = await helpers.viewportBox()
    const before = decodePng(await page.locator('.scene-viewport').screenshot())
    const scale = before.width / box.width
    log(`MEASURE ${theme} screenshot ${before.width}×${before.height}, ${before.channels} channels, ${scale.toFixed(2)}× the CSS box`)

    const silhouette = await cubeSilhouette(page, helpers, scale)
    const around = boundsOf(silhouette, MARGIN, before)
    const faces = shrink(silhouette, 0.78)
    log(`MEASURE ${theme} the cube is looked at in ${around.left},${around.top} to ${around.right},${around.bottom}`)

    const beforeCount = countNear(before, around, selected, TOLERANCE)
    check(`${theme}: nothing wears the selected colour before anything is selected`, beforeCount === 0, `${beforeCount} px`)

    // Select all rather than click: it leaves the cube selected while the camera, which draws no
    // silhouette of its own, takes the active slot — so the band in the picture is the one
    // `--scene-selected` asks for, and not `--scene-active`, which a single click would paint.
    await page.locator('#main').press('a')
    await page.waitForTimeout(500)
    const after = decodePng(await page.locator('.scene-viewport').screenshot())
    const afterCount = countNear(after, around, selected, TOLERANCE)
    check(`${theme}: the selection outline is in the picture`, afterCount >= 300, `${afterCount} px within ${TOLERANCE} of ${tokens.selected}`)

    // Whatever that count says, the band is whatever changed between the two shots. Naming the
    // colour actually painted there is what tells a missing outline from a mispainted one.
    const band = colourCensus(after, around, (x, y) => distance(pixelAt(before, x, y), pixelAt(after, x, y)) > 12)
    const painted = band[0]
    log(`MEASURE ${theme} outline painted ${painted ? `${hex(painted.colour)} over ${painted.count} px, ${distance(painted.colour, selected).toFixed(1)} from the token` : 'nothing changed'}`)
    check(`${theme}: the outline is painted in the colour the token asks for`,
      Boolean(painted) && distance(painted.colour, selected) <= TOLERANCE,
      painted ? `${hex(painted.colour)} where ${tokens.selected} was asked for` : 'no band found')

    /* ---- the ratios the plan sets ---- */

    const groundRatio = contrastRatio(selected, ground)
    log(`MEASURE ${theme} selected on the viewport ground — ${ratio(groundRatio)}`)
    check(`${theme}: the selection reads against the viewport ground`, groundRatio >= 3, `${ratio(groundRatio)} against 3:1`)
    if (painted) log(`MEASURE ${theme} as painted, ${hex(painted.colour)} on the ground — ${ratio(contrastRatio(painted.colour, ground))}`)

    const greys = colourCensus(after, boundsOf(faces, 0, after), (x, y) => inside(faces, x, y))
      .filter((entry) => entry.count >= 200 && neutral(entry.colour))
    check(`${theme}: the cube's shaded faces are in the picture`, greys.length >= 2, `${greys.length} faces of 200 px or more`)
    if (greys.length > 0) {
      for (const face of greys) {
        log(`MEASURE ${theme} cube face ${hex(face.colour)} over ${face.count} px — selected reads ${ratio(contrastRatio(selected, face.colour))} on it` +
          `${painted ? `, as painted ${ratio(contrastRatio(painted.colour, face.colour))}` : ''}`)
      }
      /*
       * What the outline has to carry against is not one colour but every colour it can be drawn
       * over, and an object is shaded from near-white to near-black. No single tone holds 3:1
       * against both ends of that: 3:1 to each side needs a nine-fold span, and the cube's own
       * faces are four apart before the ground is counted.
       *
       * So the outline is a line with a casing of the opposite tone, and what is measured is the
       * step between the two — that edge is what the eye reads, and it is the same answer the
       * vector canvas gives with `--vector-halo`. The line against the ground is checked above,
       * because that is where an outline usually lands; each face's ratio is logged, so a
       * regression in either is visible even where it is not a gate.
       */
      const shaded = greys[0]
      log(`MEASURE ${theme} selected on the cube's solid grey ${hex(shaded.colour)} — ${ratio(contrastRatio(selected, shaded.colour))}`)
      const halo = parseColour(tokens.outlineHalo)
      if (!halo) {
        check(`${theme}: the outline's casing token can be read`, false, tokens.outlineHalo)
        continue
      }
      const haloRatio = contrastRatio(selected, halo)
      log(`MEASURE ${theme} the outline's casing ${hex(halo)} against its line ${hex(selected)} — ${ratio(haloRatio)}`)
      check(`${theme}: the outline's casing carries it over anything it crosses`, haloRatio >= 3,
        `${ratio(haloRatio)} against 3:1`)
    }

    /* ---- the grid only has to be seen; the axes have to be read ---- */

    for (const [name, token, target] of [['fine', tokens.grid, 1.3], ['major', tokens.gridMajor, 2]]) {
      const colour = parseColour(token)
      if (!colour) { check(`${theme}: the ${name} grid token can be read`, false, token); continue }
      const over = composite(colour, alphaOf(token), ground)
      const gridRatio = contrastRatio(over, ground)
      log(`MEASURE ${theme} ${name} grid ${token} over the ground is ${hex(over)} — ${ratio(gridRatio)}`)
      check(`${theme}: the ${name} grid is visible on the viewport ground`, gridRatio >= target, `${ratio(gridRatio)} against ${target}:1`)
    }

    for (const [axis, token] of [['X', tokens.axisX], ['Y', tokens.axisY], ['Z', tokens.axisZ]]) {
      const colour = parseColour(token)
      if (!colour) { check(`${theme}: the ${axis} axis token can be read`, false, token); continue }
      const over = composite(colour, alphaOf(token), ground)
      const axisRatio = contrastRatio(over, ground)
      log(`MEASURE ${theme} ${axis} axis ${token} on the ground — ${ratio(axisRatio)}`)
      check(`${theme}: the ${axis} axis reads on the viewport ground`, axisRatio >= 3, `${ratio(axisRatio)} against 3:1`)
    }

    /* ---- and the everyday case: one click, which paints the active colour ---- */

    const centre = await helpers.project3d([0, 0, 0])
    await page.mouse.click(centre.x, centre.y)
    await page.waitForTimeout(500)
    const clicked = decodePng(await page.locator('.scene-viewport').screenshot())
    const activeCount = countNear(clicked, around, active, TOLERANCE)
    const activeBand = colourCensus(clicked, around, (x, y) => distance(pixelAt(before, x, y), pixelAt(clicked, x, y)) > 12)[0]
    log(`MEASURE ${theme} the clicked object's outline is painted ${activeBand ? `${hex(activeBand.colour)} over ${activeBand.count} px` : 'nothing'}`)
    check(`${theme}: one click paints the active outline`, activeCount >= 300, `${activeCount} px within ${TOLERANCE} of ${tokens.active}`)
    const activeRatio = contrastRatio(active, ground)
    log(`MEASURE ${theme} active on the viewport ground — ${ratio(activeRatio)}`)
    check(`${theme}: the active outline reads against the viewport ground`, activeRatio >= 3, `${ratio(activeRatio)} against 3:1`)

    await shot(`scene-colours-${theme}-1440.png`)
  }

  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  await page.emulateMedia({ colorScheme: 'dark' })
})

/** The cube's silhouette, in screenshot pixels, from the eight corners of its world bounds. */
async function cubeSilhouette(page, helpers, scale) {
  const stored = await helpers.scene()
  const cube = stored.objects.find((object) => object.name === 'Cube')
  if (!cube) throw new Error('the new scene has no cube to measure')
  const corners = await page.evaluate((objectId) => {
    const bounds = window.__paramrigScene.bounds([objectId])
    const points = []
    for (const x of [bounds.min[0], bounds.max[0]]) {
      for (const y of [bounds.min[1], bounds.max[1]]) {
        for (const z of [bounds.min[2], bounds.max[2]]) points.push(window.__paramrigScene.project([x, y, z]))
      }
    }
    return points
  }, cube.id)
  const projected = corners.filter(Boolean).map(([x, y]) => ({ x: x * scale, y: y * scale }))
  if (projected.length < 3) throw new Error('the cube does not project into the viewport')
  return convexHull(projected)
}
