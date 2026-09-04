import {
  MATERIAL_GRAPH_MATH_OPERATIONS,
  MATERIAL_GRAPH_NODE_TYPES,
  MATERIAL_GRAPH_NOISE_MODES,
  MATERIAL_GRAPH_PORTS_BY_TYPE,
  MATERIAL_GRAPH_WAVE_TYPES,
  type MaterialGraphNodeSettings,
  type MaterialGraphNodeType,
  type MaterialGraphPort,
  type MaterialGraphPortTone,
} from '@/scene/shader/prismorphic/material-graph'

/**
 * What a shader node *is*, as one entry rather than as five tables.
 *
 * Prismorphic hard-codes its node kinds in tables spread across its editor — one for the labels,
 * one for the categories, one for the ports, one for the defaults, and a switch for the widgets.
 * That works when the list is fixed. Here it is not: the point of the editor is that a node can be
 * added, so the five tables become one registry, and everything that draws or reads a node reads
 * it. The compiler is the vendored copy and keeps its own switch; the registry is what tells the
 * *editor* what a node has, which is the half that changes.
 *
 * The ports come from the copy rather than from here, because they are the compiler's own contract:
 * a port this registry invented would be a socket that compiles to nothing.
 */

export type ShaderSocketTone = MaterialGraphPortTone

export type ShaderSocket = { id: string; label: string; tone: ShaderSocketTone }

/** A field on a node, named by the setting it writes. The kit's own controls draw them. */
export type ShaderWidget =
  | { kind: 'number'; setting: keyof MaterialGraphNodeSettings; label: string; min: number; max: number; step: number }
  | { kind: 'colour'; setting: keyof MaterialGraphNodeSettings; label: string }
  | { kind: 'switch'; setting: keyof MaterialGraphNodeSettings; label: string }
  | { kind: 'select'; setting: keyof MaterialGraphNodeSettings; label: string; options: ReadonlyArray<{ value: string; label: string }> }
  | { kind: 'vector'; settings: [keyof MaterialGraphNodeSettings, keyof MaterialGraphNodeSettings, keyof MaterialGraphNodeSettings]; label: string }

export type ShaderNodeType = {
  type: MaterialGraphNodeType
  label: string
  /** Which of Blender's menus it belongs under, using Blender's own names for them. */
  category: 'Input' | 'Output' | 'Shader' | 'Texture' | 'Color' | 'Vector' | 'Converter' | 'Optics'
  inputs: ShaderSocket[]
  outputs: ShaderSocket[]
  defaults: Partial<MaterialGraphNodeSettings>
  widgets: ShaderWidget[]
  /** One line for the palette, so a person adding a node knows what they are adding. */
  description?: string
}

const number = (
  setting: keyof MaterialGraphNodeSettings,
  label: string,
  min: number,
  max: number,
  step: number,
): ShaderWidget => ({ kind: 'number', setting, label, min, max, step })

const colour = (setting: keyof MaterialGraphNodeSettings, label: string): ShaderWidget => ({ kind: 'colour', setting, label })
const toggle = (setting: keyof MaterialGraphNodeSettings, label: string): ShaderWidget => ({ kind: 'switch', setting, label })
const choose = (
  setting: keyof MaterialGraphNodeSettings,
  label: string,
  values: readonly string[],
): ShaderWidget => ({ kind: 'select', setting, label, options: values.map((value) => ({ value, label: value })) })

/** The ports the compiler declares for a type, which is the only place they can honestly come from. */
function socketsOf(type: MaterialGraphNodeType): { inputs: ShaderSocket[]; outputs: ShaderSocket[] } {
  const ports = MATERIAL_GRAPH_PORTS_BY_TYPE[type]
  const read = (list: readonly MaterialGraphPort[]): ShaderSocket[] => list.map((port) => ({ ...port }))
  return { inputs: read(ports.inputs), outputs: read(ports.outputs) }
}

type Entry = Omit<ShaderNodeType, 'inputs' | 'outputs'>

/**
 * The nodes this build ships.
 *
 * The names are Blender's wherever a node means the same thing — a person who knows Blender should
 * find "Color Ramp" under Color and "Math" under Converter — and Prismorphic's where the node is
 * its own: nothing in Blender is a Prism Dispersion. `pbr-surface` is labelled Principled BSDF
 * because that is what it is: the base colour, metallic, roughness, emission and alpha subset the
 * scene's own material already speaks, as a node.
 */
const ENTRIES: Entry[] = [
  {
    type: 'value',
    label: 'Value',
    category: 'Input',
    defaults: { scalarValue: 0.5 },
    widgets: [number('scalarValue', 'Value', -100, 100, 0.01)],
    description: 'One number, for anything that takes one.',
  },
  {
    type: 'rgb',
    label: 'RGB',
    category: 'Input',
    defaults: { rgbColor: '#EBF5FF' },
    widgets: [colour('rgbColor', 'Colour')],
    description: 'One colour, chosen rather than computed.',
  },
  {
    type: 'base-color',
    label: 'Base Colour',
    category: 'Input',
    defaults: { rgbColor: '#EBF5FF' },
    widgets: [colour('rgbColor', 'Colour')],
    description: 'The material’s own base colour, as a node.',
  },
  {
    type: 'metallic',
    label: 'Metallic',
    category: 'Input',
    defaults: { scalarValue: 0 },
    widgets: [number('scalarValue', 'Metallic', 0, 1, 0.01)],
  },
  {
    type: 'roughness',
    label: 'Roughness',
    category: 'Input',
    defaults: { scalarValue: 0.5 },
    widgets: [number('scalarValue', 'Roughness', 0, 1, 0.01)],
  },
  {
    type: 'emission',
    label: 'Emission',
    category: 'Input',
    defaults: { rgbColor: '#000000' },
    widgets: [colour('rgbColor', 'Colour')],
  },
  {
    type: 'opacity',
    label: 'Alpha',
    category: 'Input',
    defaults: { scalarValue: 1 },
    widgets: [number('scalarValue', 'Alpha', 0, 1, 0.01)],
  },
  {
    type: 'normal',
    label: 'Normal',
    category: 'Vector',
    defaults: { vectorX: 0, vectorY: 0, vectorZ: 1 },
    widgets: [{ kind: 'vector', settings: ['vectorX', 'vectorY', 'vectorZ'], label: 'Direction' }],
  },
  {
    type: 'displacement',
    label: 'Displacement',
    category: 'Vector',
    defaults: { scalarValue: 0 },
    widgets: [number('scalarValue', 'Height', -10, 10, 0.01)],
  },
  {
    type: 'time',
    label: 'Time',
    category: 'Input',
    defaults: { timeSpeed: 1, timeOffset: 0 },
    widgets: [number('timeSpeed', 'Speed', -10, 10, 0.01), number('timeOffset', 'Offset', -100, 100, 0.01)],
    description: 'Seconds since the material was compiled, for anything that moves.',
  },
  {
    type: 'texture-coordinate',
    label: 'Texture Coordinate',
    category: 'Input',
    defaults: { coordinateSpace: 'UV', uvChannel: 0 },
    widgets: [
      choose('coordinateSpace', 'Space', ['UV', 'Object', 'World', 'Screen']),
      number('uvChannel', 'UV map', 0, 7, 1),
    ],
  },
  {
    type: 'mapping',
    label: 'Mapping',
    category: 'Vector',
    defaults: { mappingX: 1, mappingY: 1, mappingZ: 0 },
    widgets: [{ kind: 'vector', settings: ['mappingX', 'mappingY', 'mappingZ'], label: 'Scale' }],
  },
  {
    type: 'noise-texture',
    label: 'Noise Texture',
    category: 'Texture',
    defaults: { noiseDetail: 4, noiseMode: 'FBM', noiseSeed: 0, noiseWarp: 0.35, noiseLacunarity: 2, noiseGain: 0.5 },
    widgets: [
      choose('noiseMode', 'Mode', MATERIAL_GRAPH_NOISE_MODES),
      number('noiseDetail', 'Detail', 1, 8, 1),
      number('noiseLacunarity', 'Lacunarity', 1, 4, 0.01),
      number('noiseGain', 'Gain', 0, 1, 0.01),
      number('noiseWarp', 'Warp', 0, 2, 0.01),
      number('noiseSeed', 'Seed', 0, 999, 1),
    ],
  },
  {
    type: 'wave-texture',
    label: 'Wave Texture',
    category: 'Texture',
    defaults: { waveType: 'Sine', waveScale: 5, waveDistortion: 0.25 },
    widgets: [
      choose('waveType', 'Wave', MATERIAL_GRAPH_WAVE_TYPES),
      number('waveScale', 'Scale', 0, 64, 0.1),
      number('waveDistortion', 'Distortion', 0, 4, 0.01),
    ],
  },
  {
    type: 'voronoi-texture',
    label: 'Voronoi Texture',
    category: 'Texture',
    defaults: { voronoiScale: 4, voronoiRandomness: 0.75 },
    widgets: [number('voronoiScale', 'Scale', 0, 64, 0.1), number('voronoiRandomness', 'Randomness', 0, 1, 0.01)],
  },
  {
    type: 'scanlines',
    label: 'Scanlines',
    category: 'Texture',
    defaults: {
      scanlineAxis: 'Y',
      scanlineDensity: 96,
      scanlineThickness: 0.22,
      scanlineSoftness: 0.08,
      scanlineIntensity: 1,
      scanlineSpeed: 0.35,
      scanlineDistortion: 0.35,
      scanlinePhase: 0,
    },
    widgets: [
      choose('scanlineAxis', 'Axis', ['X', 'Y', 'Z']),
      number('scanlineDensity', 'Density', 1, 512, 1),
      number('scanlineThickness', 'Thickness', 0, 1, 0.01),
      number('scanlineSoftness', 'Softness', 0, 1, 0.01),
      number('scanlineIntensity', 'Intensity', 0, 4, 0.01),
      number('scanlineSpeed', 'Speed', -8, 8, 0.01),
      number('scanlineDistortion', 'Distortion', 0, 4, 0.01),
      number('scanlinePhase', 'Phase', -8, 8, 0.01),
    ],
  },
  {
    type: 'domain-warp',
    label: 'Domain Warp',
    category: 'Vector',
    defaults: { warpAmount: 0.35, warpScale: 2, warpSpeed: 0.15, warpSeed: 0 },
    widgets: [
      number('warpAmount', 'Amount', 0, 4, 0.01),
      number('warpScale', 'Scale', 0, 32, 0.01),
      number('warpSpeed', 'Speed', -8, 8, 0.01),
      number('warpSeed', 'Seed', 0, 999, 1),
    ],
  },
  {
    type: 'glitch-bands',
    label: 'Glitch Bands',
    category: 'Texture',
    defaults: {
      glitchAmount: 0.18,
      glitchFrequency: 14,
      glitchBandSize: 0.08,
      glitchOffset: 0.12,
      glitchDuration: 0.22,
      glitchSpeed: 0.55,
      glitchSeed: 17,
    },
    widgets: [
      number('glitchAmount', 'Amount', 0, 2, 0.01),
      number('glitchFrequency', 'Frequency', 0, 64, 0.1),
      number('glitchBandSize', 'Band size', 0, 1, 0.01),
      number('glitchOffset', 'Offset', -1, 1, 0.01),
      number('glitchDuration', 'Duration', 0, 4, 0.01),
      number('glitchSpeed', 'Speed', -8, 8, 0.01),
      number('glitchSeed', 'Seed', 0, 999, 1),
    ],
  },
  {
    type: 'digital-fragments',
    label: 'Digital Fragments',
    category: 'Texture',
    defaults: { fragmentScale: 64, fragmentDensity: 0.22, fragmentThreshold: 0.82, fragmentSeed: 31, fragmentSpeed: 0.2 },
    widgets: [
      number('fragmentScale', 'Scale', 1, 512, 1),
      number('fragmentDensity', 'Density', 0, 1, 0.01),
      number('fragmentThreshold', 'Threshold', 0, 1, 0.01),
      number('fragmentSpeed', 'Speed', -8, 8, 0.01),
      number('fragmentSeed', 'Seed', 0, 999, 1),
    ],
  },
  {
    type: 'chromatic-split',
    label: 'Chromatic Split',
    category: 'Optics',
    defaults: { chromaStrength: 0.22, chromaEdgeBias: 0.55, chromaCyan: '#3DEBFF', chromaMagenta: '#C972FF' },
    widgets: [
      number('chromaStrength', 'Strength', 0, 2, 0.01),
      number('chromaEdgeBias', 'Edge bias', 0, 1, 0.01),
      colour('chromaCyan', 'Cyan'),
      colour('chromaMagenta', 'Magenta'),
    ],
  },
  {
    type: 'pulse',
    label: 'Pulse',
    category: 'Converter',
    defaults: { pulseSpeed: 0.45, pulseAmount: 0.35, pulsePhase: 0, pulseSharpness: 1.5 },
    widgets: [
      number('pulseSpeed', 'Speed', -8, 8, 0.01),
      number('pulseAmount', 'Amount', 0, 4, 0.01),
      number('pulsePhase', 'Phase', -8, 8, 0.01),
      number('pulseSharpness', 'Sharpness', 0, 8, 0.01),
    ],
  },
  {
    type: 'color-ramp',
    label: 'Color Ramp',
    category: 'Color',
    defaults: { rampStart: '#36D7F4', rampEnd: '#E84DFF', rampMidpoint: 0.5, rampInterpolation: 'Linear' },
    widgets: [
      colour('rampStart', 'From'),
      colour('rampEnd', 'To'),
      number('rampMidpoint', 'Midpoint', 0, 1, 0.01),
      choose('rampInterpolation', 'Interpolation', ['Linear', 'Ease', 'Constant']),
    ],
  },
  {
    type: 'math',
    label: 'Math',
    category: 'Converter',
    defaults: { mathOperation: 'Multiply' },
    widgets: [choose('mathOperation', 'Operation', MATERIAL_GRAPH_MATH_OPERATIONS)],
  },
  {
    type: 'mix',
    label: 'Mix Color',
    category: 'Color',
    defaults: { mixFactor: 0.5 },
    widgets: [number('mixFactor', 'Factor', 0, 1, 0.01)],
  },
  {
    type: 'map-range',
    label: 'Map Range',
    category: 'Converter',
    defaults: { mapFromMin: 0, mapFromMax: 1, mapToMin: 0, mapToMax: 1, mapClamp: true },
    widgets: [
      number('mapFromMin', 'From min', -100, 100, 0.01),
      number('mapFromMax', 'From max', -100, 100, 0.01),
      number('mapToMin', 'To min', -100, 100, 0.01),
      number('mapToMax', 'To max', -100, 100, 0.01),
      toggle('mapClamp', 'Clamp'),
    ],
  },
  {
    type: 'invert',
    label: 'Invert Color',
    category: 'Color',
    defaults: {},
    widgets: [],
  },
  {
    type: 'fresnel',
    label: 'Fresnel',
    category: 'Optics',
    defaults: {
      fresnelIor: 1.45,
      fresnelPower: 5,
      fresnelBias: 0.02,
      fresnelIntensity: 1,
      fresnelInvert: false,
      fresnelColor: '#3DEBFF',
    },
    widgets: [
      number('fresnelIor', 'IOR', 1, 3, 0.01),
      number('fresnelPower', 'Power', 0, 16, 0.01),
      number('fresnelBias', 'Bias', 0, 1, 0.01),
      number('fresnelIntensity', 'Intensity', 0, 4, 0.01),
      colour('fresnelColor', 'Colour'),
      toggle('fresnelInvert', 'Invert'),
    ],
  },
  {
    type: 'prism-dispersion',
    label: 'Prism Dispersion',
    category: 'Optics',
    defaults: { prismSpectrum: 0.62, prismAberration: 0.18, prismSeed: 24 },
    widgets: [
      number('prismSpectrum', 'Spectrum', 0, 2, 0.01),
      number('prismAberration', 'Aberration', 0, 2, 0.01),
      number('prismSeed', 'Seed', 0, 999, 1),
    ],
  },
  {
    type: 'pbr-surface',
    label: 'Principled BSDF',
    category: 'Shader',
    defaults: {},
    widgets: [],
    description: 'Base colour, metallic, roughness, emission and alpha — the subset the material speaks.',
  },
  {
    type: 'unlit-surface',
    label: 'Emission Shader',
    category: 'Shader',
    defaults: {},
    widgets: [],
    description: 'The colour as it is, lit by nothing.',
  },
  {
    type: 'glass-surface',
    label: 'Glass BSDF',
    category: 'Shader',
    defaults: { surfaceTransmission: 0.55 },
    widgets: [number('surfaceTransmission', 'Transmission', 0, 1, 0.01)],
  },
  {
    type: 'surface-blend',
    label: 'Mix Shader',
    category: 'Shader',
    defaults: { blendMode: 'over', blendDepth: 0.06 },
    widgets: [
      choose('blendMode', 'Mode', ['over', 'inside']),
      number('blendDepth', 'Depth', 0, 1, 0.001),
    ],
  },
  {
    type: 'material-output',
    label: 'Material Output',
    category: 'Output',
    defaults: { outputEnabled: true, outputBlend: 'Opaque' },
    widgets: [
      toggle('outputEnabled', 'Enabled'),
      choose('outputBlend', 'Blend', ['Opaque', 'Alpha blend', 'Additive']),
    ],
  },
]

const registry = new Map<string, ShaderNodeType>()

for (const entry of ENTRIES) registry.set(entry.type, { ...entry, ...socketsOf(entry.type) })

/**
 * Adds or replaces a node type.
 *
 * The registry is injectable so that a node can arrive without the tables being edited — which is
 * the whole reason it exists. A type the compiler has never heard of will draw and connect and
 * compile to nothing, so anything added here needs the copy to know it too.
 */
export function registerShaderNodeType(entry: ShaderNodeType): void {
  registry.set(entry.type, entry)
}

export function shaderNodeType(type: string): ShaderNodeType | null {
  return registry.get(type) ?? null
}

export function shaderNodeTypes(): ShaderNodeType[] {
  return [...registry.values()]
}

/** The palette's order: Blender's menus, and within each the order the registry declares. */
export const SHADER_CATEGORIES: ShaderNodeType['category'][] = [
  'Input', 'Output', 'Shader', 'Texture', 'Color', 'Vector', 'Converter', 'Optics',
]

/** What a fresh node of this type carries, which is what the compiler reads when nothing is set. */
export function defaultShaderSettings(type: string): Partial<MaterialGraphNodeSettings> {
  return { ...(registry.get(type)?.defaults ?? {}) }
}

/** Every type the compiler knows; a registry missing one of these would be a menu with a hole in it. */
export function compilerNodeTypes(): readonly MaterialGraphNodeType[] {
  return MATERIAL_GRAPH_NODE_TYPES
}
