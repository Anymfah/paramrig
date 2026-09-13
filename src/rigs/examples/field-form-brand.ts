import { DOCUMENT_TARGET, type VectorBinding, type BindingTransform } from '@/vector/rig'
import type { VectorDocument, VectorElement, VectorNetwork } from '@/vector/types'
import { TEXT_FACES } from '@/vector/text'

export const FIELD_FORM_BRAND_ID = 'vector-example-field-form-brand'

// An authored identity, not a logo generator. Geometry and type hierarchy are deliberate;
// only decisions that genuinely propagate across the manual are exposed as controls.
const colour = { paper: '#F2EFE7', ink: '#202922', field: '#254E3D', lime: '#D7F06F' } as const
type Colour = keyof typeof colour
type Options = Partial<VectorElement>
const elements: VectorElement[] = []
const bindings: VectorBinding[] = []
const W = 1280
const H = 900
const GAP = 48
let pageId = ''
let ox = 0
let oy = 0

function bind(elementId: string, property: string, parameterId: string, transform?: BindingTransform) {
  bindings.push({ id: `${elementId}-${property}`, elementId, property, parameterId, ...(transform ? { transform } : {}) })
}

function shape(id: string, x: number, y: number, width: number, height: number, fill: Colour | 'none', options: Options = {}) {
  const element: VectorElement = {
    id, name: id.replaceAll('-', ' '), kind: 'rectangle', x: ox + x, y: oy + y,
    width, height, rotation: 0, fill: fill === 'none' ? 'none' : colour[fill],
    stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false,
    parentId: pageId, ...options,
  }
  elements.push(element)
  if (fill !== 'none') bind(id, 'fill', fill)
  return element
}

function text(id: string, value: string, x: number, y: number, width: number, size = 20, fill: Colour = 'ink', options: Options = {}) {
  return shape(id, x, y, width, size * (size >= 40 ? 1.12 : 1.5) * (value.split('\n').length + 1), fill, {
    kind: 'text', text: value, fontFamily: 'Public Sans', fontSize: size,
    fontWeight: size >= 40 ? 600 : 400, lineHeight: size >= 40 ? 1.08 : 1.5,
    letterSpacing: size >= 40 ? -size * 0.045 : 0, textSizing: 'fixed', textAlign: 'left',
    ...options,
  })
}

function small(id: string, value: string, x: number, y: number, width = 500, fill: Colour = 'ink') {
  return text(id, value, x, y, width, 12, fill, { fontWeight: 600, letterSpacing: 1.1, lineHeight: 1.3, height: 40 })
}

function rule(id: string, x: number, y: number, width: number, fill: Colour = 'ink') {
  return shape(id, x, y, width, 1, fill, { opacity: 0.24 })
}

// Two F forms, one rotated 180 degrees, on the original ten-unit grid.
const thresholdPoints = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 4], [4, 4], [4, 6], [2, 6], [2, 10], [0, 10]]
export const FIELD_FORM_MARK: VectorNetwork = {
  nodes: [false, true].flatMap((reverse, part) => thresholdPoints.map(([x, y], index) => ({
    id: `f${part}-${index}`, x: (reverse ? 10 - x! : x!) / 10, y: (reverse ? 10 - y! : y!) / 10,
  }))),
  segments: [0, 1].flatMap((part) => thresholdPoints.map((_, index) => ({
    id: `s${part}-${index}`, a: `f${part}-${index}`, b: `f${part}-${(index + 1) % thresholdPoints.length}`,
  }))),
}

function mark(id: string, x: number, y: number, size: number, fill: Colour | 'none' = 'ink', options: Options = {}) {
  return shape(id, x, y, size, size, fill, { kind: 'path', network: structuredClone(FIELD_FORM_MARK), ...options })
}

function wordmark(id: string, x: number, y: number, width: number, size: number, fill: Colour = 'ink') {
  const result = text(id, 'Field / Form', x, y, width, size, fill, { fontWeight: 600, lineHeight: 1.08 })
  bind(id, 'text', 'brand-name')
  return result
}

function tagline(id: string, x: number, y: number, width: number, size = 20, fill: Colour = 'ink') {
  text(id, 'Places made for shared life.', x, y, width, size, fill)
  bind(id, 'text', 'tagline')
}

function campaign(id: string, x: number, y: number, width: number, size: number, fill: Colour = 'ink') {
  text(id, 'Room for everyone.', x, y, width, size, fill)
  bind(id, 'text', 'campaign')
}

function page(index: number, title: string, fill: Colour = 'paper', foreground: Colour = 'ink') {
  pageId = `page-${index}`
  ox = ((index - 1) % 2) * (W + GAP)
  oy = Math.floor((index - 1) / 2) * (H + GAP)
  shape(pageId, 0, 0, W, H, fill, { kind: 'frame', name: `${String(index).padStart(2, '0')} — ${title}`, parentId: undefined, clipContent: true })
  small(`${pageId}-section`, title.toUpperCase(), 64, 40, 800, foreground)
  small(`${pageId}-edition`, 'IDENTITY MANUAL     /     2026', 920, 40, 296, foreground)
  rule(`${pageId}-top-rule`, 64, 76, W - 128, foreground)
  rule(`${pageId}-bottom-rule`, 64, 842, W - 128, foreground)
  wordmark(`${pageId}-signature`, 64, 858, 300, 14, foreground)
  small(`${pageId}-folio`, `${String(index).padStart(2, '0')}   /   08`, 1136, 860, 80, foreground)
}

page(1, 'Field notes / A shared ground', 'field', 'paper')
wordmark('cover-wordmark', 56, 116, 1160, 144, 'paper')
mark('cover-mark', 64, 350, 360, 'lime')
small('cover-practice', 'ARCHITECTURE\n& THE COMMON GOOD', 680, 354, 440, 'lime')
text('cover-statement', 'Good places\nbegin between us.', 676, 414, 540, 64, 'paper')
tagline('cover-tagline', 680, 620, 500, 24, 'paper')
text('cover-positioning', 'An independent practice shaping everyday spaces with the people who use them.', 680, 692, 450, 20, 'paper')
small('cover-concept', 'A FICTIONAL PRACTICE. A WORKING IDENTITY SYSTEM.', 64, 784, 900, 'paper')

page(2, 'The mark / Two forms. One shared space.')
text('mark-title', 'Built from the same ground.', 64, 112, 1140, 56)
shape('construction-ground', 64, 216, 496, 400, 'lime')
for (let i = 0; i <= 10; i++) {
  shape(`construction-v-${i}`, 152 + i * 24, 288, 1, 240, 'ink', { opacity: 0.14 })
  shape(`construction-h-${i}`, 152, 288 + i * 24, 240, 1, 'ink', { opacity: 0.14 })
}
mark('construction-mark', 152, 288, 240)
small('construction-caption', '10 × 10 GRID     /     STEM = 2 UNITS', 96, 564, 420)
shape('clearspace-box', 704, 240, 168, 168, 'none', { stroke: colour.ink, strokeWidth: 1, strokeDash: [4, 4] })
bind('clearspace-box', 'stroke', 'ink')
mark('clearspace-mark', 728, 264, 120)
small('clearspace-x', 'x', 708, 258, 24)
text('clearspace-copy', 'Leave one stem width (x) clear on every side. Nothing enters this space.', 928, 252, 288, 18)
rule('lockup-rule', 656, 440, 560)
mark('lockup-positive', 656, 484, 64)
wordmark('lockup-name', 744, 487, 472, 48)
small('lockup-caption', 'HORIZONTAL LOCKUP     /     GAP ≈ 2x', 656, 556, 560)
shape('lockup-reverse-field', 656, 592, 560, 56, 'ink')
mark('lockup-reverse', 680, 604, 32, 'paper')
wordmark('lockup-reverse-name', 724, 604, 304, 26, 'paper')
small('lockup-reverse-label', 'REVERSED', 1080, 612, 112, 'paper')
text('mark-rationale', 'Two F forms face one another, one rotated through 180 degrees. Their shared grid joins Field and Form in a single, balanced symbol.', 64, 660, 496, 20)
small('minimum-label', 'SCREEN MINIMUM', 656, 660, 240)
mark('minimum-16', 656, 704, 16)
mark('minimum-24', 720, 704, 24)
mark('minimum-32', 792, 704, 32)
text('minimum-caption', '16 / 24 / 32 px\nUse the symbol alone below a 120 px lockup.', 656, 760, 560, 16)

page(3, 'Colour / The field, not the decoration')
text('colour-title', 'Quiet ground.\nA living accent.', 64, 116, 700, 64)
text('colour-intro', 'Paper carries the content. Ink carries the words. Field anchors the identity. Lime marks an invitation, never a paragraph.', 832, 128, 384, 20)
const swatches: { key: Colour; name: string; role: string; width: number; fg: Colour; share: string }[] = [
  { key: 'paper', name: '01 / Paper', role: 'Space & long-form reading', width: 288, fg: 'ink', share: '55%' },
  { key: 'field', name: '02 / Field', role: 'Identity & large surfaces', width: 288, fg: 'paper', share: '30%' },
  { key: 'ink', name: '03 / Ink', role: 'Type & monochrome', width: 288, fg: 'paper', share: '10%' },
  { key: 'lime', name: '04 / Lime', role: 'Invitation & emphasis', width: 288, fg: 'ink', share: '5%' },
]
let sx = 64
for (const swatch of swatches) {
  shape(`${swatch.key}-swatch`, sx, 328, swatch.width, 288, swatch.key)
  small(`${swatch.key}-name`, swatch.name.toUpperCase(), sx + 24, 352, swatch.width - 48, swatch.fg)
  text(`${swatch.key}-share`, swatch.share, sx + 24, 404, swatch.width - 48, 64, swatch.fg)
  text(`${swatch.key}-hex`, colour[swatch.key], sx + 24, 558, swatch.width - 48, 20, swatch.fg)
  bind(`${swatch.key}-hex`, 'text', swatch.key)
  text(`${swatch.key}-role`, swatch.role, sx + 8, 640, swatch.width - 32, 16)
  sx += swatch.width
}
rule('paper-chip-edge', 64, 615, 288)
let ratioX = 64
for (const swatch of swatches) {
  const width = 1152 * Number.parseInt(swatch.share) / 100
  shape(`${swatch.key}-ratio`, ratioX, 692, width, 8, swatch.key)
  ratioX += width
}
rule('colour-ratio-edge', 64, 700, 1152)
text('colour-use', 'Starting proportions, not a quota. Use one dominant field per composition. Never give all four colours equal weight.', 64, 716, 496, 18)
text('colour-access', 'Text pairs: Ink / Paper, Paper / Field, Ink / Lime. Recheck contrast after changing colours. Keep Lime off Paper for small text.', 656, 716, 560, 18)
small('colour-print', 'MASTER: sRGB HEX. CONVERT WITH THE PRINTER’S ICC PROFILE; APPROVE A PHYSICAL PROOF.', 64, 808, 1152)

page(4, 'Typography / Public, precise, human')
text('type-family', 'Public Sans', 60, 110, 1156, 112)
small('type-family-note', 'HEADLINES ABOVE     /     BODY FAMILY BELOW', 64, 254, 1100)
text('type-body-family', 'Public Sans', 64, 284, 560, 22)
text('type-hero', 'Aa', 48, 320, 520, 300, 'field', { fontWeight: 600, letterSpacing: -20, height: 320 })
text('type-glyphs', 'ABCDEFGHIJKLM\nNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789  & / — ( )', 64, 666, 512, 24)
const roles = [
  { id: 'display', label: 'DISPLAY', size: 80, weight: 600, leading: 1.08, tracking: -3.6, sample: 'Shared life.', y: 328 },
  { id: 'heading', label: 'HEADING', size: 40, weight: 600, leading: 1.08, tracking: -1.8, sample: 'A place to belong.', y: 484 },
  { id: 'body', label: 'BODY', size: 20, weight: 400, leading: 1.5, tracking: 0, sample: 'Start with the people who live here.\nListen first. Draw what comes next.', y: 608 },
  { id: 'caption', label: 'CAPTION', size: 12, weight: 600, leading: 1.3, tracking: 1.1, sample: 'PROJECT NOTES   /   2026', y: 744 },
]
for (const role of roles) {
  rule(`type-${role.id}-rule`, 656, role.y - 16, 560)
  small(`type-${role.id}-spec`, role.label, 656, role.y, 112)
  small(`type-${role.id}-size`, String(role.size), 784, role.y, 56)
  small(`type-${role.id}-weight`, String(role.weight), 848, role.y, 56)
  small(`type-${role.id}-leading`, String(role.leading), 912, role.y, 56)
  text(`type-${role.id}-sample`, role.sample, 656, role.y + 32, 560, role.size, 'ink', {
    fontWeight: role.weight, lineHeight: role.leading, letterSpacing: role.tracking,
  })
}

page(5, 'Graphic language / Leave room')
text('layout-title', 'Structure makes\nspace for life.', 64, 112, 720, 64)
text('layout-intro', 'A six-column grid. A generous edge. One decisive crop. The identity should feel composed, never filled in.', 832, 128, 384, 20)
shape('grid-sheet', 64, 320, 560, 392, 'field')
for (let i = 0; i < 6; i++) shape(`grid-column-${i}`, 96 + i * 84, 352, 72, 328, 'paper', { opacity: 0.07 })
small('grid-kicker', 'NEIGHBOURHOOD NOTES', 96, 360, 440, 'lime')
text('grid-headline', 'Common\nground.', 92, 408, 420, 64, 'paper')
mark('grid-crop', 456, 548, 136, 'lime')
small('grid-label', '6 COLUMNS  /  12 GUTTER  /  32 MARGIN', 64, 736, 560)
shape('language-sample', 656, 320, 560, 200, 'lime')
for (let i = 0; i < 4; i++) mark(`language-unit-${i}`, 684 + i * 132, 364, 112, 'field')
small('language-caption', 'REPEAT THE SYMBOL. KEEP ITS COUNTERFORMS OPEN.', 656, 544, 560)
text('image-direction-title', 'Photograph use, not perfection.', 656, 600, 560, 28, 'ink', { fontWeight: 600 })
text('image-direction', 'Eye-level spaces, people in context, natural light, honest materials. Keep verticals straight and colour restrained. No empty luxury interiors or staged handshakes.', 656, 656, 560, 18)
text('layout-rules', 'Align left. Work in multiples of 8. Keep text off busy images. Crop the graphic motif, never the identifying logo.', 64, 784, 1152, 16)

page(6, 'Stationery / Useful things, well made')
text('stationery-title', 'The everyday carries the brand.', 64, 112, 1152, 56)
shape('letter-stage', 64, 224, 608, 560, 'lime')
shape('letter-sheet', 168, 248, 368, 520, 'paper')
mark('letter-mark', 200, 280, 24)
wordmark('letter-name', 320, 280, 188, 20)
rule('letter-rule', 200, 332, 304)
small('letter-reference', 'PROJECT / 026     —     14 MAY 2026', 200, 356, 304)
text('letter-title', 'A more useful\nshared courtyard.', 200, 408, 304, 32, 'ink', { fontWeight: 600, lineHeight: 1.15, letterSpacing: -1 })
text('letter-copy', 'Dear neighbours,\n\nThank you for walking the site with us. Your notes about shade, access and places to sit are now part of the next drawing.\n\nWe will bring the revised plan to the open studio on Saturday.', 200, 512, 304, 12)
rule('letter-footer-rule', 200, 704, 304)
text('letter-footer', 'Architecture & the common good\nhello@fieldform.example', 200, 716, 304, 10)
shape('card-front', 772, 224, 408, 264, 'field')
mark('card-mark', 804, 256, 72, 'lime')
wordmark('card-name', 804, 392, 344, 40, 'paper')
shape('card-back', 772, 520, 408, 264, 'paper', { stroke: colour.ink, strokeWidth: 1 })
bind('card-back', 'stroke', 'ink')
small('card-role', 'PROJECT ENQUIRIES', 804, 552, 344)
tagline('card-tagline', 804, 600, 344, 24)
text('card-contact', 'hello@fieldform.example\nfieldform.example', 804, 704, 344, 16)
small('stationery-spec', 'ARTWORK STUDIES  /  A4 LETTERHEAD  /  85 × 55 mm CARD  /  UNCOATED STOCK, NO GLOSS', 64, 808, 1152)

page(7, 'Campaign / An invitation to take part', 'ink', 'paper')
shape('poster-paper', 64, 120, 528, 672, 'lime')
wordmark('poster-name', 96, 148, 440, 28)
campaign('poster-headline', 92, 224, 456, 80)
mark('poster-mark', 96, 448, 240)
small('poster-event', 'OPEN STUDIO\nSATURDAY  /  10:00—16:00', 376, 608, 192)
rule('poster-rule', 96, 724, 464)
text('poster-location', 'Bring your ideas for the neighbourhood.', 96, 748, 464, 16)
shape('social-field', 656, 120, 560, 440, 'field')
mark('social-mark', 688, 152, 48, 'lime')
wordmark('social-name', 952, 160, 232, 24, 'paper')
campaign('social-headline', 684, 248, 480, 72, 'paper')
small('social-event', 'YOUR STREET. YOUR SAY.     SATURDAY, 10:00.', 688, 488, 496, 'lime')
text('campaign-principle', 'An invitation,\nnot an announcement.', 656, 608, 560, 40, 'paper')
text('campaign-rule', 'Lead with the public benefit. Keep the time and place visible. One message, one action; no logo wallpaper behind the headline.', 656, 724, 560, 18, 'paper')

page(8, 'Use & handoff / Keep it recognisable')
text('handoff-title', 'The same voice. Every scale.', 64, 112, 1152, 56)
shape('web-surface', 64, 224, 752, 368, 'field')
mark('web-mark', 96, 252, 32, 'lime')
wordmark('web-name', 144, 256, 240, 24, 'paper')
text('web-nav', 'Work     Practice     Contact', 524, 260, 260, 12, 'paper')
text('web-headline', 'Good places\nbegin between us.', 92, 324, 484, 56, 'paper')
shape('web-action', 96, 512, 208, 48, 'lime')
text('web-action-label', 'Explore the projects  ↗', 112, 526, 176, 14)
mark('web-feature', 604, 372, 144, 'lime')
shape('mobile-surface', 864, 224, 352, 368, 'lime')
mark('mobile-mark', 896, 256, 24)
wordmark('mobile-name', 944, 256, 240, 20)
campaign('mobile-headline', 892, 332, 296, 48)
tagline('mobile-tagline', 896, 488, 288, 16)
small('digital-caption', 'DESKTOP & COMPACT LAYOUT STUDIES  /  PRESERVE MARGINS BEFORE SHRINKING TYPE', 64, 616, 1152)
small('misuse-title', 'KEEP THE MARK INTACT', 64, 672, 520)
mark('misuse-stretch', 64, 716, 48, 'ink', { width: 80 })
rule('misuse-stretch-strike', 60, 740, 88)
text('misuse-stretch-label', 'No stretching', 64, 784, 176, 14)
mark('misuse-rotate', 272, 716, 48, 'ink', { rotation: 18 })
rule('misuse-rotate-strike', 260, 740, 72)
text('misuse-rotate-label', 'No rotation', 256, 784, 176, 14)
mark('misuse-outline', 464, 716, 48, 'none', { stroke: colour.ink, strokeWidth: 1 })
bind('misuse-outline', 'stroke', 'ink')
text('misuse-outline-label', 'No outlining', 448, 784, 176, 14)
small('handoff-label', 'BEFORE RELEASE', 656, 672, 560)
text('handoff-checklist', 'Use the vector master. Check 16 px and monochrome.\nRecheck contrast and long names after tuning.\nEmbed fonts for export. Proof print colour and bleed.\nKeep the legal name, URL and contact details verified.', 656, 712, 560, 16)

// Bind authored roles, not arbitrary global resizing: the reference grid and minimum-size
// specimens remain exact, while applications can be tuned without deforming the master mark.
const copyControls = [
  { id: 'headline', label: 'Brand headline', targets: ['cover-statement', 'web-headline'] },
  { id: 'positioning', label: 'Practice description', targets: ['cover-positioning'] },
  { id: 'practice', label: 'Practice label', targets: ['cover-practice'] },
  { id: 'contact', label: 'Contact details', targets: ['card-contact', 'letter-footer'] },
  { id: 'event', label: 'Event details', targets: ['poster-event', 'social-event'] },
  { id: 'action', label: 'Website action', targets: ['web-action-label'] },
]
// These shared fields start with the same wording wherever they are used.
for (const id of ['letter-footer', 'social-event']) {
  const element = elements.find(item => item.id === id)!
  element.text = elements.find(item => item.id === (id === 'letter-footer' ? 'card-contact' : 'poster-event'))!.text
}
for (const control of copyControls) for (const id of control.targets) bind(id, 'text', control.id)
// Fit the default copy's measured line counts without moving any artwork.
for (const [id, height] of Object.entries({ 'clearspace-copy': 81, 'mark-rationale': 90, 'colour-intro': 90, 'layout-intro': 90, 'image-direction': 81, 'letter-copy': 144 })) {
  elements.find(element => element.id === id)!.height = height
}
bind(DOCUMENT_TARGET, 'background', 'workspace-background')
bind(DOCUMENT_TARGET, 'fontFamily', 'font-family')
bind('type-family', 'text', 'font-family')
bind('type-body-family', 'text', 'body-font-family')
bindings.push({ id: 'body-font-scope', elementId: DOCUMENT_TARGET, property: 'fontFamily', parameterId: 'body-font-family',
  elementIds: elements.filter(element => element.kind === 'text' && (element.fontSize ?? 0) < 40 && !bindings.some(binding => binding.elementId === element.id && binding.parameterId === 'brand-name')).map(element => element.id) })

for (const element of elements) {
  if (element.kind !== 'text') continue
  const display = (element.fontSize ?? 0) >= 40 && element.id !== 'type-hero'
  const body = (element.fontSize ?? 0) >= 16 && (element.fontSize ?? 0) <= 24 && element.fontWeight === 400
  if (display) {
    bind(element.id, 'fontWeight', 'display-weight')
    bind(element.id, 'lineHeight', 'display-leading')
    bind(element.id, 'letterSpacing', 'display-tracking', { scale: element.fontSize! / 100 })
  }
  if (body) {
    bind(element.id, 'fontWeight', 'body-weight')
    bind(element.id, 'lineHeight', 'body-leading')
  }
}
for (const role of ['display', 'heading', 'body']) {
  bind(`type-${role}-weight`, 'text', role === 'body' ? 'body-weight' : 'display-weight')
  bind(`type-${role}-leading`, 'text', role === 'body' ? 'body-leading' : 'display-leading')
}
for (const id of ['cover-statement', 'web-headline', 'poster-headline', 'social-headline', 'mobile-headline']) {
  const element = elements.find(item => item.id === id)!
  bind(id, 'fontSize', 'headline-scale', { scale: element.fontSize! / 100 })
}
function scaleMark(id: string, parameterId: string) {
  const element = elements.find(item => item.id === id)!
  bind(id, 'width', parameterId, { scale: element.width / 100 })
  bind(id, 'height', parameterId, { scale: element.height / 100 })
}
for (const id of ['cover-mark', 'card-mark', 'letter-mark', 'poster-mark', 'social-mark', 'web-mark', 'mobile-mark']) scaleMark(id, 'symbol-scale')
for (let i = 0; i < 4; i++) {
  const id = `language-unit-${i}`
  scaleMark(id, 'motif-scale')
  bind(id, 'x', 'motif-gap', { scale: i, offset: 684 + 112 * i })
}
for (const element of elements.filter(item => item.height === 1 && item.opacity === 0.24)) bind(element.id, 'opacity', 'rule-opacity', { scale: 0.01 })

const numberControls = [
  { id: 'display-weight', label: 'Display weight', group: 'typography', fontParameter: 'font-family', min: 1, max: 1000, step: 1, defaultValue: 600 },
  { id: 'display-tracking', label: 'Display tracking', group: 'typography', min: -6, max: 0, step: 0.1, defaultValue: -4.5, unit: '%' },
  { id: 'display-leading', label: 'Display line height', group: 'typography', min: 1, max: 1.3, step: 0.01, defaultValue: 1.08 },
  { id: 'body-weight', label: 'Body weight', group: 'typography', fontParameter: 'body-font-family', min: 1, max: 1000, step: 1, defaultValue: 400 },
  { id: 'body-leading', label: 'Body line height', group: 'typography', min: 1.3, max: 1.8, step: 0.05, defaultValue: 1.5 },
  { id: 'headline-scale', label: 'Application headline size', group: 'typography', min: 70, max: 110, step: 1, defaultValue: 100, unit: '%' },
  { id: 'symbol-scale', label: 'Application symbol size', group: 'graphics', min: 60, max: 120, step: 1, defaultValue: 100, unit: '%' },
  { id: 'motif-scale', label: 'Motif size', group: 'graphics', min: 50, max: 100, step: 1, defaultValue: 100, unit: '%' },
  { id: 'motif-gap', label: 'Motif spacing', group: 'graphics', min: 4, max: 20, step: 1, defaultValue: 20, unit: 'px' },
  { id: 'rule-opacity', label: 'Rule opacity', group: 'graphics', min: 10, max: 60, step: 1, defaultValue: 24, unit: '%' },
]

export const fieldFormBrandDocument: VectorDocument = {
  version: 1, id: FIELD_FORM_BRAND_ID, name: 'Field / Form brand system',
  background: 'none', width: W * 2 + GAP, height: H * 4 + GAP * 3,
  elements, guides: [], swatches: Object.values(colour),
  exportPresets: [
    { id: 'brand-page-svg', name: 'Selected page · SVG', target: 'frame', format: 'svg', scale: 1, transparent: false },
    { id: 'brand-page-pdf', name: 'Selected page · PDF', target: 'frame', format: 'pdf', scale: 1, transparent: false },
    { id: 'brand-overview-png', name: 'All eight pages · PNG', target: 'document', format: 'png', scale: 1, transparent: false },
  ],
  rig: {
    // Category tabs would hide these groups inside the vector editor's compact inspector.
    groups: [{ id: 'identity', label: 'Identity' }, { id: 'palette', label: 'Palette & workspace' }, { id: 'typography', label: 'Typography' }, { id: 'graphics', label: 'Symbol & graphic language' }],
    parameters: [
      { kind: 'text', id: 'brand-name', label: 'Brand name', group: 'identity', defaultValue: 'Field / Form' },
      { kind: 'text', id: 'tagline', label: 'Tagline', group: 'identity', defaultValue: 'Places made for shared life.' },
      { kind: 'text', id: 'campaign', label: 'Campaign headline', group: 'identity', defaultValue: 'Room for everyone.' },
      ...copyControls.map(control => ({ kind: 'text' as const, id: control.id, label: control.label, group: 'identity', multiline: control.id !== 'action', defaultValue: elements.find(item => item.id === control.targets[0])!.text! })),
      { kind: 'color', id: 'workspace-background', label: 'Workspace background', group: 'palette', defaultValue: 'none', allowNone: true },
      ...Object.entries(colour).map(([id, value]) => ({
        kind: 'color' as const, id, label: id[0]!.toUpperCase() + id.slice(1), group: 'palette', defaultValue: value,
      })),
      { kind: 'preset', id: 'type-pairing', label: 'Type pairing', group: 'typography', defaultValue: 'original', options: [
        { value: 'original', label: 'Original', values: { 'font-family': 'Public Sans', 'body-font-family': 'Public Sans', 'display-weight': 600, 'body-weight': 400, 'display-tracking': -4.5, 'display-leading': 1.08, 'body-leading': 1.5 } },
        { value: 'architectural', label: 'Architectural', values: { 'font-family': 'Space Grotesk', 'body-font-family': 'Public Sans', 'display-weight': 600, 'body-weight': 400, 'display-tracking': -3, 'display-leading': 1.08, 'body-leading': 1.5 } },
        { value: 'editorial', label: 'Editorial', values: { 'font-family': 'Source Serif 4', 'body-font-family': 'Public Sans', 'display-weight': 500, 'body-weight': 400, 'display-tracking': -2, 'display-leading': 1.08, 'body-leading': 1.5 } },
        { value: 'humanist', label: 'Humanist', values: { 'font-family': 'Public Sans', 'body-font-family': 'Source Serif 4', 'display-weight': 600, 'body-weight': 400, 'display-tracking': -4, 'display-leading': 1.08, 'body-leading': 1.6 } },
        { value: 'custom', label: 'Custom', values: {} },
      ] },
      { kind: 'select', view: 'font-library', id: 'font-family', label: 'Headline font', group: 'typography', defaultValue: 'Public Sans', options: TEXT_FACES.map(face => ({ value: face.value, label: face.label })) },
      { kind: 'select', view: 'font-library', id: 'body-font-family', label: 'Body font', group: 'typography', defaultValue: 'Public Sans', options: TEXT_FACES.map(face => ({ value: face.value, label: face.label })) },
      ...numberControls.map(control => ({ kind: 'number' as const, ...control })),
    ],
    bindings,
  },
  createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T23:00:00.000Z',
}
