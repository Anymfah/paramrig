import { measureThumbnail, type LabThumbnail } from './thumbnail'
import { buildLabArchitecture } from '../shuffle-architectures'
import { mulberry32 } from '@paramrig/audio/random'
import { EASE_IN, EASE_OUT } from '@paramrig/audio/curves'
import { renderPatch } from '@paramrig/audio'
import { makeMod, makePerformer, silentLayer, sanitizeAudioPatch } from '@paramrig/audio'
import { clamp, probePatch, probeStereo } from '../shuffle-draw'
import { LAYER_SECTIONS, SCENE_COUNT, STEP_COUNT } from '@paramrig/audio/fields'
import { macroAmount } from '../macros'
import type { AudioPatch, Layer, ModSlot, Performer, Stereo } from '@paramrig/audio'
import { adjustReference, labMacros, makeLabSound } from './design'
import { fingerprint, LAB_VERSION, DURATION_MIN, DURATION_MAX, type LabCriteria, type LabRequest, type LabRole, type LabSound, type LabSource, type Contribution } from './model'
import { nameSound } from './names'
import { analyseShape, analyseSpectrum, waveEnvelope, type LabShape, type LabSpectrum } from './analysis'
import { buildExploration } from './exploration'
import { buildDiscovery, describeLabRecipe, usesDiscovery } from './discovery'
import { isLegacyFamily } from './catalog'
import { validateLabCriteria, validateLabRequest, validateLabSampleRate, validateLabSeed } from './criteria'
import { applyEnding } from './search-design'
import { assertReferenceSelections, DEFAULT_SELECTIONS, minimumGestureMs } from './selections'
import { balanceIdentityResonators } from './family-identity'

const routeAt = (i: number) => ({ target: (['target', 'targetB', 'targetC', 'targetD'] as const)[i]!, depth: (['depth', 'depthB', 'depthC', 'depthD'] as const)[i]! })

export function fitDuration(input: AudioPatch, seconds: number): AudioPatch {
  const patch = structuredClone(input)
  const ratio = seconds / patch.duration
  patch.duration = seconds
  patch.layers.forEach((layer) => {
    layer.offset = clamp(layer.offset * ratio, 0, Math.min(1, seconds * 0.85))
    const life = seconds - layer.offset
    for (const key of ['attack', 'hold', 'decay', 'release'] as const) layer.amp[key] = Math.min(2, layer.amp[key] * ratio)
    const total = layer.amp.attack + layer.amp.hold + layer.amp.decay + layer.amp.release
    if (total > life) for (const key of ['attack', 'hold', 'decay', 'release'] as const) layer.amp[key] *= life / total
    for (const slot of ['insertA', 'insertB', 'insertC'] as const) if (layer[slot].kind === 'body') layer[slot].decay = clamp(layer[slot].decay * ratio, 0.01, Math.min(3, life))
  })
  patch.mods.forEach((mod) => {
    if (mod.kind === 'lfo') mod.rate = clamp(mod.rate / ratio, 0.1, 40)
    else for (const key of ['delay', 'attack', 'hold', 'decay', 'release'] as const) mod[key] = clamp(mod[key] * ratio, 0, key === 'delay' ? 1 : 2)
  })
  for (const slot of ['x', 'y', 'z'] as const) {
    const fx = patch.fx[slot]
    if (fx.kind === 'delay') fx.time = clamp(fx.time * ratio, 0.001, Math.min(1, seconds * 0.32))
    if (fx.kind === 'reverb') { fx.size = Math.min(fx.size, 0.12 + seconds * 0.18); fx.mix = Math.min(fx.mix, 0.24) }
  }
  patch.master.fadeOut = clamp(patch.master.fadeOut * ratio, 0.003, Math.min(0.5, seconds * 0.18))
  if (patch.gestures) patch.gestures = patch.gestures.map((take) => ({ ...take, start: take.start * ratio, duration: take.duration * ratio }))
  return patch
}

function patternMotion(patch: AudioPatch, motion: LabCriteria['motion']): void {
  if (motion === 'natural') return
  if (motion === 'continuous') {
    patch.performers.forEach((p) => { for (let n = 0; n < 4; n++) { const { target, depth } = routeAt(n); if (p[target].endsWith('.gain')) p[depth] *= 0.2 } })
    return
  }
  const row = Array.from({ length: STEP_COUNT }, (_, i) => {
    if (motion === 'pulsed') return i % 4 === 0 ? 1 : 0.24
    if (motion === 'stuttering') return [0, 1, 4, 6, 7, 11, 14].includes(i) ? 1 : 0.08
    if (motion === 'accelerating') return [0, 6, 10, 12, 13, 14, 15].includes(i) ? 1 : 0.1
    return Math.pow(1 - i / STEP_COUNT, 1.5)
  })
  patch.performers[0] = makePerformer({ enabled: true, shape: 'curve', rate: motion === 'stuttering' ? 2 : 1,
    target: 'layers[0].gain', depth: 0.68, targetB: 'layers[1].gain', depthB: 0.5,
    patterns: Array.from({ length: SCENE_COUNT }, () => [...row]),
  })
}

function traits(patch: AudioPatch, criteria: LabCriteria, random: () => number): void {
  patch.layers.forEach((layer, i) => {
    if (!layer.enabled) return
    const base = i === 0
    if (criteria.material === 'metal') {
      if (layer.source.kind === 'noise') layer.source.colour = 'metallic'
      layer.insertC = { ...layer.insertC, kind: 'body', place: 'post', amount: base ? 0.08 : 0.18,
        profile: 'plate', frequency: base ? layer.pitch.start * 2.7 : 480 + random() * 1800, spread: 0.72, decay: 0.13, character: 0.56 }
    } else if (criteria.material === 'glass') {
      layer.insertC = { ...layer.insertC, kind: 'body', place: 'post', amount: 0.15, profile: 'glass', frequency: 540 + random() * 2400, spread: 0.4, decay: 0.35 }
    } else if (criteria.material === 'liquid') {
      layer.filterA = { ...layer.filterA, kind: 'bandpass', resonance: 0.4, envAmount: 1.8, cutoff: base ? 500 : 1800 }
      layer.pitch.vibratoRate = 7 + random() * 9; layer.pitch.vibratoDepth = 0.8
    } else if (criteria.material === 'air' && !base) {
      layer.source.kind = 'noise'; layer.source.colour = 'pink'
      layer.filterA.kind = 'highpass'; layer.filterA.cutoff = 700 + random() * 2400
      layer.insertA.kind = 'off'; layer.insertB.kind = 'off'; layer.insertC.kind = 'off'
    } else if (criteria.material === 'electrical') {
      layer.source.fmIndex = clamp(layer.source.fmIndex + 0.6, 0, 4)
      layer.source.fmRatio = 3.17
      layer.insertB = { ...layer.insertB, kind: 'ring', ratio: 1.47, amount: 0.1 }
    }
    if (criteria.character === 'mechanical') { layer.pitch.jitter = 3; layer.source.fmRatio = 2.73 }
    if (criteria.character === 'futuristic' && layer.source.kind !== 'noise') { layer.source.kind = 'table'; layer.source.table = base ? 'titan' : 'formant'; layer.source.position = 0.2 + random() * 0.5 }
    if (criteria.character === 'organic') { layer.pitch.vibratoRate = 3.7; layer.pitch.vibratoDepth = 0.22; layer.source.fmIndex *= 0.65 }
    if (criteria.character === 'alien') { layer.source.fmRatio = 1.413; layer.filterA.kind = 'formant'; layer.filterA.cutoff = 330 + random() * 900 }
    if (criteria.character === 'industrial') layer.insertA = { ...layer.insertA, kind: 'drive', drive: 0.28, amount: 0.3 }
    if (criteria.weight === 'heavy' && base && layer.source.kind !== 'noise') layer.pitch.start = clamp(layer.pitch.start * 0.62, 35, 180)
    if (criteria.weight === 'light') { if (layer.pitch.start < 180) layer.pitch.start *= 2; layer.amp.release *= 0.7 }
  })
  if (criteria.type === 'rise') {
    patch.layers.forEach((l) => { if (l.enabled) { l.pitch.slide = 14 + random() * 16; l.pitch.slideCurve = EASE_IN; l.amp.attack = patch.duration * 0.6; l.amp.hold = patch.duration * 0.12; l.amp.sustain = 0.3 } })
  }
  if (criteria.type === 'fall') patch.layers.forEach((l) => { l.pitch.slide = -18 - random() * 12; l.pitch.slideCurve = EASE_OUT })
  if (criteria.type === 'pulse') patternMotion(patch, 'pulsed')
  if (criteria.type === 'drone') patch.layers.forEach((l) => { if (l.enabled) { l.amp.attack = 0.06; l.amp.hold = patch.duration * 0.65; l.amp.sustain = 0.45; l.pitch.slide *= 0.1 } })
  patternMotion(patch, criteria.motion)
  // Every recipe offers four audible controls, including sparse impacts with no free LFO yet.
  if (!patch.mods.some((m) => m.enabled) && !patch.performers.some((m) => m.enabled)) patch.mods[2] = makeMod({ enabled: true, target: 'layers[0].cutoff', depth: 0.08, rate: 6 })
  if (!labMacros(patch, criteria)[0]!.destinations.length) {
    const layer = patch.layers.find((l) => l.enabled)!
    layer.insertA = { ...layer.insertA, kind: 'drive', drive: 0.12, amount: 0.2 }
  }
}

export function enforceExclusions(patch: AudioPatch, criteria: LabCriteria): void {
  for (const layer of patch.layers) {
    if (!layer.enabled) continue
    if (criteria.avoid.includes('piercing')) {
      layer.routing = 'series'; layer.filterB.kind = 'lowpass'; layer.filterB.cutoff = Math.min(layer.filterB.cutoff, 5200); layer.filterB.resonance = Math.min(0.2, layer.filterB.resonance); layer.filterB.envAmount = Math.min(0, layer.filterB.envAmount)
      layer.source.fmIndex = Math.min(layer.source.fmIndex, 1.4)
      // Inserts run after the filters, even in their pre-amp position. Reduce the processes
      // that could recreate the harsh edge after the low-pass, rather than moving them.
      for (const slot of ['insertA', 'insertB', 'insertC'] as const) {
        layer[slot].amount = Math.min(layer[slot].amount, 0.1)
        layer[slot].drive = Math.min(layer[slot].drive, 0.15)
        if (layer[slot].kind === 'body') layer[slot].frequency = Math.min(layer[slot].frequency, 3000)
      }
    }
    if (criteria.avoid.includes('sub')) {
      layer.filterA.kind = 'highpass'; layer.filterA.cutoff = Math.max(160, layer.filterA.cutoff > 1000 ? 160 : layer.filterA.cutoff); layer.filterA.resonance = 0.08; layer.filterA.envAmount = Math.max(0, layer.filterA.envAmount)
      // Ring modulation and modal resonators can create bass after the high-pass.
      for (const slot of ['insertA', 'insertB', 'insertC'] as const) if (['ring', 'body', 'comb'].includes(layer[slot].kind)) layer[slot].kind = 'off'
    }
    if (criteria.avoid.includes('click')) layer.amp.attack = Math.max(layer.amp.attack, Math.min(0.018, patch.duration * 0.25))
  }
  if (criteria.avoid.includes('reverb')) for (const slot of ['x', 'y', 'z'] as const) if (patch.fx[slot].kind === 'reverb') patch.fx[slot].kind = 'off'
  if (criteria.avoid.includes('piercing')) patch.fx.tone = Math.min(patch.fx.tone, -0.25)
}

function seconds(criteria: LabCriteria, random: () => number): number {
  if (!Number.isFinite(criteria.minMs) || !Number.isFinite(criteria.maxMs) || criteria.minMs < DURATION_MIN || criteria.maxMs > DURATION_MAX) throw new Error(`Duration must be between ${DURATION_MIN} and ${DURATION_MAX} ms.`)
  if (criteria.minMs > criteria.maxMs) throw new Error('Minimum duration must not exceed maximum duration.')
  const min = Math.max(criteria.minMs, minimumGestureMs(criteria))
  return Math.round(Math.exp(Math.log(min) + random() * Math.log(criteria.maxMs / min))) / 1000
}

/** Frozen recipe path for the curated demos, whose output gains were calibrated by seed. */
export function generateSignatureSound(criteria: LabCriteria, seed: number): LabSound {
  if (!isLegacyFamily(criteria.type)) throw new Error('Curated signatures use the original twelve families. Use generateSound for the full catalog.')
  const random = mulberry32(seed)
  let patch = buildLabArchitecture(criteria.type, random, seed % 10000)
  patch = fitDuration(patch, seconds(criteria, random))
  traits(patch, criteria, random)
  patch = fitDuration(patch, patch.duration)
  enforceExclusions(patch, criteria)
  patch = sanitizeAudioPatch(patch)
  return makeLabSound(patch, criteria, { kind: 'generated', recipe: criteria.type, seed, version: LAB_VERSION, parentIds: [] }, nameSound(criteria, seed))
}

export function generateSound(criteria: LabCriteria, seed: number, recentRecipes: readonly string[] = []): LabSound {
  validateLabCriteria(criteria)
  validateLabSeed(seed)
  criteria = { ...DEFAULT_SELECTIONS, ...criteria }
  const random = mulberry32(seed)
  const duration = seconds(criteria, random)
  const design: { patch: AudioPatch; roles: LabRole[]; recipe: string; resolved?: LabCriteria } = usesDiscovery(criteria)
    ? buildDiscovery(criteria, seed, duration, recentRecipes) : buildExploration(criteria, random, seed, duration, recentRecipes)
  let patch = fitDuration(design.patch, duration)
  applyEnding(patch, criteria)
  const recipe = describeLabRecipe(design.recipe)
  // Directed movement can sustain an exciter that the original recipe only struck briefly.
  if (recipe && (recipe.subtype || recipe.chord || criteria.motion !== 'natural')) balanceIdentityResonators(patch)
  enforceExclusions(patch, criteria)
  // Excluding sub resonances can remove the only grain destination of a sparse noise design.
  if (!labMacros(patch, criteria)[0]!.destinations.length) {
    const layer = patch.layers.find((l) => l.enabled)!
    layer.insertA = { ...layer.insertA, kind: 'drive', drive: 0.12, amount: 0.1 }
  }
  patch = sanitizeAudioPatch(patch)
  const sound = makeLabSound(patch, criteria, { kind: 'generated', recipe: design.recipe, seed, version: LAB_VERSION, parentIds: [] }, nameSound(design.resolved ?? criteria, seed))
  sound.roles = design.resolved ? patch.layers.map((layer, i) => layer.enabled ? design.roles[i] ?? 'unknown' : 'unknown') : design.roles
  return sound
}

const parentOf = (sound: LabSound): LabSource => ({ id: sound.id, name: sound.name, patch: structuredClone(sound.patch), rig: structuredClone(sound.rig), roles: [...sound.roles] })

export function varySound(request: LabRequest, seed: number): LabSound {
  validateLabCriteria(request.criteria)
  validateLabSeed(seed)
  const original = request.reference
  if (!original) throw new Error('Choose a reference first.')
  assertReferenceSelections(request.criteria, original.criteria)
  const base = adjustReference(original, request.values ?? original.controls.map((i) => macroAmount(original.macros[i]!)))
  const random = mulberry32(seed)
  const span = request.amount === 'strong' ? 0.27 : request.amount === 'medium' ? 0.16 : 0.07
  const values = base.controls.map((index, control) => request.locks?.[control] ? macroAmount(base.macros[index]!) : clamp(macroAmount(base.macros[index]!) + (random() * 2 - 1) * span, 0, 1))
  if (base.controls.every((_, i) => request.locks?.[i]) && !request.varyDuration) throw new Error('Unlock a macro to create variations, or enable duration variation.')
  let child = adjustReference(base, values)
  if (request.varyDuration) child = { ...child, patch: fitDuration(child.patch, seconds(request.criteria, random)) }
  const duration = child.patch.duration * 1000
  if (duration < request.criteria.minMs - 0.01 || duration > request.criteria.maxMs + 0.01) throw new Error('The reference is outside this duration range. Enable duration variation or adjust the range.')
  // Constraints may require an edit to the body: ask for a new reference instead of hiding it.
  if (JSON.stringify(base.criteria.avoid) !== JSON.stringify(request.criteria.avoid)) throw new Error('Generate a new reference to change exclusions.')
  child = { ...child, id: `lab-${seed}-${fingerprint(child.patch)}`, name: `${original.name} variation`, criteria: { ...request.criteria },
    origin: { kind: 'variation', recipe: original.origin.recipe, version: LAB_VERSION, seed, parentIds: [original.id], settings: { values: request.values ? [...request.values] : undefined, locks: request.locks ? [...request.locks] : undefined, amount: request.amount ?? 'subtle', varyDuration: request.varyDuration ?? false } },
    parents: [parentOf(original)], fingerprint: fingerprint(child.patch) }
  return child
}

function dependencyGroup(patch: AudioPatch, first: number): Set<number> {
  const result = new Set<number>()
  const visiting = new Set<number>()
  const visit = (index: number) => {
    if (visiting.has(index)) throw new Error('This contribution has a cyclic phase-modulation route.')
    if (result.has(index)) return
    const layer = patch.layers[index]
    if (!layer?.enabled) throw new Error('This contribution depends on an inactive layer.')
    visiting.add(index)
    if (layer.source.fmIndex > 0 && layer.source.pmFrom !== 'internal') visit(Number(layer.source.pmFrom.replace('layer', '')))
    visiting.delete(index); result.add(index)
  }
  visit(first)
  return result
}

function remapMod<T extends ModSlot | Performer>(mod: T, mapping: Map<number, number>): T | null {
  const copy = structuredClone(mod)
  for (let n = 0; n < 4; n++) {
    const { target, depth } = routeAt(n)
    const match = /^layers\[(\d)\]\.(\w+)$/.exec(copy[target])
    const next = match ? mapping.get(Number(match[1])) : undefined
    copy[target] = next === undefined ? 'off' : `layers[${next}].${match![2]}`
    if (next === undefined) copy[depth] = 0
  }
  return [copy.target, copy.targetB, copy.targetC, copy.targetD].some((t) => t !== 'off') ? copy : null
}

function fusionSourceIssue(principal: LabSound, donor: LabSound): string | null {
  if (principal.id === donor.id) return 'Choose two different sounds.'
  if (fingerprint(principal.patch) !== principal.fingerprint || fingerprint(donor.patch) !== donor.fingerprint) return 'These sounds changed outside Labs. Generate fresh references before fusing.'
  if (!principal.roles.includes('body') || donor.roles.every((r) => r === 'unknown')) return 'Layer roles are unknown. Use sounds generated in Labs for guided fusion.'
  if (principal.patch.gestures?.some((g) => g.enabled) || donor.patch.gestures?.some((g) => g.enabled)) return 'Recorded gestures need to be resolved in Instrument before guided fusion.'
  return null
}

const hasRoutes = (mod: ModSlot | Performer) => [0, 1, 2, 3].some((n) => { const { target, depth } = routeAt(n); return mod[target] !== 'off' && mod[depth] !== 0 })

/** Share identical drivers before consuming another slot; never drop a donor's live route. */
function installFusionRoute(patch: AudioPatch, key: 'mods' | 'performers', input: ModSlot | Performer, scene: number): boolean {
  const moved = structuredClone(input)
  if (key === 'performers') {
    const performer = moved as Performer
    performer.patterns = performer.patterns.map(() => [...performer.patterns[scene]!])
    performer.curves = performer.curves.map(() => [...performer.curves[scene]!])
  }
  const routes = [0, 1, 2, 3].map(routeAt).filter(({ target, depth }) => moved[target] !== 'off' && moved[depth] !== 0)
  const driver = (mod: ModSlot | Performer) => JSON.stringify(Object.fromEntries(Object.entries(mod).filter(([key]) => !/^(target|depth)[BCD]?$/.test(key))))
  for (const existing of patch[key]) {
    if (!existing.enabled || driver(existing) !== driver(moved)) continue
    const free = [0, 1, 2, 3].map(routeAt).filter(({ target, depth }) => existing[target] === 'off' || existing[depth] === 0)
    if (free.length < routes.length) continue
    routes.forEach((route, n) => { existing[free[n]!.target] = moved[route.target]; existing[free[n]!.depth] = moved[route.depth] })
    return true
  }
  const slot = patch[key].findIndex((mod) => !mod.enabled || !hasRoutes(mod))
  if (slot < 0) return false
  if (key === 'mods') patch.mods[slot] = moved as ModSlot
  else patch.performers[slot] = moved as Performer
  return true
}

function fusionLayerOptions(donor: LabSound, contribution: Contribution): number[] {
  const preferred: LabRole[] = contribution === 'attack' ? ['attack', 'mechanism', 'body'] : contribution === 'resonance' ? ['resonance', 'tail', 'texture'] : ['texture', 'mechanism', 'resonance']
  const options = preferred.flatMap((role) => donor.roles.flatMap((r, i) => r === role && donor.patch.layers[i]?.enabled ? [i] : []))
  // A noise body can supply texture even when the recipe has no separate texture layer.
  if (contribution === 'texture') donor.patch.layers.forEach((layer, i) => { if (layer.enabled && layer.source.kind === 'noise' && donor.roles[i] === 'body') options.push(i) })
  return options
}

function buildFusionPatch(a: LabSound, b: LabSound, contribution: Contribution, influence: number, selected: number): { patch: AudioPatch; roles: LabRole[] } {
  const patch = structuredClone(a.patch)
  const roles = [...a.roles]
  if (contribution === 'motion') {
    const mapping = new Map<number, number>()
    b.roles.forEach((role, i) => {
      const match = a.roles.findIndex((r, n) => r === role && a.patch.layers[n]?.enabled && ![...mapping.values()].includes(n))
      if (match >= 0) mapping.set(i, match)
    })
    let added = 0
    for (const key of ['mods', 'performers'] as const) {
      for (const mod of b.patch[key]) {
        if (!mod.enabled) continue
        const moved = remapMod(mod, mapping)
        if (!moved) continue
        // Core pitch/gain accents are protected. Motion contributes timbre, not a new rhythm to the body.
        for (let n = 0; n < 4; n++) { const { target, depth } = routeAt(n); if (/\.(pitch|gain)$/.test(moved[target])) { moved[target] = 'off'; moved[depth] = 0 } else moved[depth] *= influence }
        if (!hasRoutes(moved)) continue
        if (installFusionRoute(patch, key, moved, b.patch.scene)) added++
      }
    }
    if (!added) throw new Error('No compatible modulation slot is available without changing the body.')
  } else {
    const extractAttack = contribution === 'attack' && b.roles[selected] === 'body'
    const donorGroup = dependencyGroup(b.patch, selected)
    const protectedLayers = new Set<number>()
    a.roles.forEach((role, i) => { if (a.patch.layers[i]?.enabled && (role === 'body' || role === 'attack')) dependencyGroup(a.patch, i).forEach((n) => protectedLayers.add(n)) })
    const available = patch.layers.flatMap((_, i) => !protectedLayers.has(i) ? [i] : [])
    if (donorGroup.size > available.length) throw new Error('This contribution and its dependencies do not fit beside the protected body. Try another contributor.')
    const mapping = new Map<number, number>()
    // Retire complete optional groups, never leave a retained layer pointing at a replacement.
    available.forEach((i) => { patch.layers[i] = silentLayer(); roles[i] = 'unknown' })
    const retained = new Map([...protectedLayers].map((i) => [i, i]))
    patch.mods = patch.mods.map((m) => remapMod(m, retained) ?? { ...m, enabled: false })
    patch.performers = patch.performers.map((m) => remapMod(m, retained) ?? { ...m, enabled: false })
    ;[...donorGroup].forEach((index, n) => mapping.set(index, available[n]!))
    for (const [index, target] of mapping) {
      const layer: Layer = structuredClone(b.patch.layers[index]!)
      layer.gain *= influence
      if (layer.source.pmFrom !== 'internal') {
        const source = mapping.get(Number(layer.source.pmFrom.replace('layer', '')))
        layer.source.pmFrom = source === undefined ? 'internal' : `layer${source}` as Layer['source']['pmFrom']
      }
      layer.offset = contribution === 'attack' ? 0 : clamp(layer.offset / b.patch.duration * a.patch.duration, 0, Math.min(1, a.patch.duration * 0.8))
      layer.routing = 'series'; layer.filterB.kind = 'highpass'; layer.filterB.cutoff = 150; layer.filterB.resonance = 0.08
      if (extractAttack) {
        // Borrow the onset of a body-only impact, not a second sustained body.
        const total = layer.amp.attack + layer.amp.hold + layer.amp.decay + layer.amp.release
        const ratio = Math.min(1, Math.min(0.18, a.patch.duration * 0.4) / Math.max(0.001, total))
        for (const key of ['attack', 'hold', 'decay', 'release'] as const) layer.amp[key] *= ratio
        layer.amp.sustain = 0
      }
      patch.layers[target] = layer; roles[target] = extractAttack ? 'attack' : b.roles[index]!
    }
    for (const key of ['mods', 'performers'] as const) {
      for (const mod of b.patch[key]) {
        if (!mod.enabled) continue
        const moved = remapMod(mod, mapping)
        if (!moved) continue
        if (extractAttack) for (let n = 0; n < 4; n++) {
          const { target, depth } = routeAt(n)
          if (moved[target].endsWith('.gain')) { moved[target] = 'off'; moved[depth] = 0 }
        }
        if (!hasRoutes(moved)) continue
        if (!installFusionRoute(patch, key, moved, b.patch.scene)) throw new Error('The contributor needs more modulation slots than are available. Try another contribution or contributor.')
      }
    }
  }
  return { patch, roles }
}

/** Preflight and execution use the same planner, including PM and modulation capacity. */
function planFusion(a: LabSound, b: LabSound, contribution: Contribution, influence: number, variant = 0) {
  const issue = fusionSourceIssue(a, b)
  if (issue) throw new Error(issue)
  const options = contribution === 'motion' ? [-1] : fusionLayerOptions(b, contribution)
  if (!options.length) throw new Error(`The contributor has no compatible ${contribution} layer. Try another contribution.`)
  let failure: unknown
  // Prefer a dedicated role, but try every compatible group before declaring the pair impossible.
  const firstRole = b.roles[options[0]!]
  const preferredCount = options.filter((i) => b.roles[i] === firstRole).length
  const offset = Math.floor(variant * preferredCount)
  const ordered = [...options.slice(offset, preferredCount), ...options.slice(0, offset), ...options.slice(preferredCount)]
  for (const selected of ordered) {
    try { return buildFusionPatch(a, b, contribution, influence, selected) }
    catch (error) { failure ??= error }
  }
  throw failure
}

export function fusionCompatibility(principal: LabSound, donor: LabSound, contribution: Contribution): string | null {
  try { planFusion(principal, donor, contribution, 0.4); return null }
  catch (error) { return error instanceof Error ? error.message : 'These sounds cannot supply this contribution.' }
}

export function fuseSounds(request: LabRequest, seed: number): LabSound {
  validateLabCriteria(request.criteria)
  validateLabSeed(seed)
  const a = request.reference, b = request.contributor
  if (!a || !b) throw new Error('Choose a principal and a contributor from the reserve.')
  assertReferenceSelections(request.criteria, a.criteria)
  const contribution = request.contribution ?? 'texture'
  const random = mulberry32(seed)
  const influence = clamp((request.influence ?? 0.4) * (0.85 + random() * 0.3), 0.05, 0.85)
  const planned = planFusion(a, b, contribution, influence, random())
  let patch = planned.patch
  const roles = planned.roles
  const duration = clamp(a.patch.duration * 1000, request.criteria.minMs, request.criteria.maxMs) / 1000
  patch = fitDuration(patch, duration)
  enforceExclusions(patch, request.criteria)
  const result = makeLabSound(sanitizeAudioPatch(patch), request.criteria, { kind: 'fusion', recipe: a.origin.recipe, version: LAB_VERSION, seed, parentIds: [a.id, b.id], contribution, settings: { influence: request.influence ?? 0.4 } }, `${a.name} × ${b.name}`)
  result.roles = roles; result.parents = [parentOf(a), parentOf(b)]
  return result
}

export type LabRender = { sound: LabSound; samples: Stereo; peak: number; rms: number; preview: number[]; thumbnail?: LabThumbnail; spectrum: LabSpectrum; wave: Float32Array; shape: LabShape }

/** Everything the bench draws from a rendered sound, measured once where the DSP ran. */
export function measureRender(samples: Stereo, rate: number): Omit<LabRender, 'sound'> & { finite: boolean } {
  const measured = probeStereo(samples)
  const preview = Array.from({ length: 112 }, (_, column) => {
    const from = Math.floor(column * samples.left.length / 112)
    const to = Math.floor((column + 1) * samples.left.length / 112)
    let peak = 0
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples.left[i]!), Math.abs(samples.right[i]!))
    return peak
  })
  const spectrum = measured.finite ? analyseSpectrum(samples, rate) : { columns: 1, rows: 1, values: new Float32Array(1), minHz: 40, maxHz: rate / 2 }
  return { samples, peak: measured.peak, rms: measured.rms, preview, thumbnail: measureThumbnail(samples), finite: measured.finite, spectrum,
    wave: measured.finite ? waveEnvelope(samples) : new Float32Array(2),
    shape: analyseShape(measured.finite ? samples : { left: new Float32Array(1), right: new Float32Array(1) }) }
}

export function renderCandidate(sound: LabSound, rate: number): LabRender | null {
  validateLabSampleRate(rate)
  // The oscillator otherwise clamps at Nyquist, silently collapsing the upper chord tones.
  if (describeLabRecipe(sound.origin.recipe)?.chord && sound.patch.layers.some((layer, i) =>
    [0, 2, 3].includes(i) && layer.enabled && layer.pitch.start * 2 ** ((layer.pitch.vibratoDepth + layer.source.detune / 100) / 12) >= rate * 0.49)) return null
  const probe = probePatch(sound.patch, rate)
  if (!probe.finite || probe.peak < 1e-5 || probe.peak > 48 || probe.mono < probe.peak * 0.08) return null
  let source = sound.patch
  let layerBoost = 1
  if (sound.origin.kind === 'generated' && describeLabRecipe(sound.origin.recipe) && probe.peak < 0.82 / 3) {
    // Narrow-band or soft exciters can run out of master gain. Layer levels are applied
    // after inserts and PM capture, so a common boost preserves timbre and dependencies.
    // Stay within the editable layer range and verify the actual final render below.
    const highest = Math.max(...source.layers.filter((l) => l.enabled).map((l) => l.gain))
    layerBoost = Math.max(1, Math.min(0.82 / (probe.peak * 3), LAYER_SECTIONS.root.gain!.max! / Math.max(highest, 1e-9)))
    if (layerBoost > 1) source = { ...source, layers: source.layers.map((layer) => layer.enabled ? { ...layer, gain: Math.min(LAYER_SECTIONS.root.gain!.max!, layer.gain * layerBoost) } : layer) }
  }
  // No arbitrary minimum gain: high-energy candidates must be able to attenuate enough.
  const gain = sound.origin.kind === 'variation' ? source.master.gain : clamp(0.82 / (probe.peak * layerBoost), 0, 3)
  const patch = { ...source, master: { ...source.master, gain } }
  const samples = renderPatch(patch, rate)
  const measured = measureRender(samples, rate)
  if (!measured.finite || measured.peak > 0.99 || measured.peak < 0.04 || measured.rms < 0.001) return null
  const key = fingerprint(patch)
  const { finite: _finite, ...rest } = measured
  return { ...rest, sound: { ...sound, patch, fingerprint: key, preview: { fingerprint: key, bins: measured.preview, detail: measured.thumbnail } } }
}

export function createLabBatch(request: LabRequest, rate: number, onCandidate?: (candidate: LabRender) => void): { results: LabRender[]; issue: string } {
  try { validateLabRequest(request, rate) } catch (error) { return { results: [], issue: error instanceof Error ? error.message : 'Invalid Labs request.' } }
  const count = Math.max(1, Math.min(4, request.count ?? 4))
  const results: LabRender[] = []
  const recentRecipes = [...(request.recentRecipes ?? [])].slice(-8)
  const seen = new Set<string>()
  if (request.mode === 'vary' && request.reference) seen.add(fingerprint(adjustReference(request.reference, request.values ?? request.reference.controls.map((i) => macroAmount(request.reference!.macros[i]!))).patch))
  let issue = ''
  for (let attempt = 0; attempt < 12 && results.length < count; attempt++) {
    try {
      const seed = (request.seed + attempt * 7919) >>> 0
      const sound = request.mode === 'create' ? generateSound(request.criteria, seed, recentRecipes) : request.mode === 'vary' ? varySound(request, seed) : fuseSounds(request, seed)
      const candidate = renderCandidate(sound, rate)
      if (!candidate) { issue = count === 1 ? 'That attempt did not pass the audio checks. Try again, widen the duration range or change the material.' : 'Some candidates did not pass the audio checks. Try a wider duration range or another material.'; continue }
      const key = fingerprint(candidate.sound.patch)
      if (seen.has(key)) continue
      seen.add(key); results.push(candidate)
      if (request.mode === 'create') recentRecipes.push(candidate.sound.origin.recipe)
      onCandidate?.(candidate)
    } catch (error) { issue = error instanceof Error ? error.message : 'This combination could not be rendered.'; break }
  }
  return { results, issue: results.length >= count ? '' : issue || 'No distinct variation was available with these constraints.' }
}
