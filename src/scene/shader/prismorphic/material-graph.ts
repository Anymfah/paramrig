/**
 * Canonical editable material graph stored on the material document.
 * Serialized at extensions['prismorphic.graph'] so export/import preserve topology.
 */

import type { MaterialKind, MaterialParameter, PrismorphicMaterialDocument, RgbaColor } from './material';
import type { MaterialRecipeInterface, MaterialRecipeSlotMode } from './material-recipe';
import { isMaterialRecipeSlotMode, sanitizeMaterialRecipeInterface } from './material-recipe.ts';

export const MATERIAL_GRAPH_EXTENSION_KEY = 'prismorphic.graph' as const;

export const MATERIAL_GRAPH_LEGACY_VERSION = 1 as const;

export const MATERIAL_GRAPH_VERSION = 2 as const;

export type MaterialGraphVersion =
  | typeof MATERIAL_GRAPH_LEGACY_VERSION
  | typeof MATERIAL_GRAPH_VERSION;

export type MaterialGraphPortTone = 'vector' | 'scalar' | 'color' | 'shader';

export type MaterialGraphNodeType =
  | 'base-color'
  | 'metallic'
  | 'value'
  | 'rgb'
  | 'time'
  | 'texture-coordinate'
  | 'mapping'
  | 'noise-texture'
  | 'wave-texture'
  | 'voronoi-texture'
  | 'color-ramp'
  | 'math'
  | 'mix'
  | 'map-range'
  | 'invert'
  | 'fresnel'
  | 'prism-dispersion'
  | 'scanlines'
  | 'domain-warp'
  | 'glitch-bands'
  | 'digital-fragments'
  | 'chromatic-split'
  | 'pulse'
  | 'roughness'
  | 'emission'
  | 'opacity'
  | 'normal'
  | 'displacement'
  | 'pbr-surface'
  | 'unlit-surface'
  | 'glass-surface'
  | 'surface-blend'
  | 'material-output';

export type MaterialGraphMathOperation =
  | 'Add'
  | 'Subtract'
  | 'Multiply'
  | 'Divide'
  | 'Power'
  | 'Minimum'
  | 'Maximum';

export type MaterialGraphWaveType = 'Sine' | 'Saw' | 'Triangle';

/** Scan axis sampled by the scanlines node (structural: changes GLSL program). */
export type MaterialGraphScanlineAxis = 'X' | 'Y' | 'Z';

/** Fractal profile used by the procedural noise node. */
export type MaterialGraphNoiseMode = 'FBM' | 'Ridged' | 'Turbulence';

export interface MaterialGraphPort {
  id: string;
  label: string;
  tone: MaterialGraphPortTone;
}

export interface MaterialGraphNodeSettings {
  coordinateSpace?: 'UV' | 'Generated' | 'Object';
  uvChannel?: number;
  mappingX?: number;
  mappingY?: number;
  mappingZ?: number;
  noiseDetail?: number;
  /** Frequency multiplier for procedural noise coordinates. */
  noiseScale?: number;
  /** Fractal profile. Ridged is suited to stone/cracks; Turbulence to fluids/energy. */
  noiseMode?: MaterialGraphNoiseMode;
  /** Stable phase offset for authoring variations without moving the mapping node. */
  noiseSeed?: number;
  /** Domain-warp amount applied before the octave stack. */
  noiseWarp?: number;
  /** Frequency multiplier between octaves. */
  noiseLacunarity?: number;
  /** Amplitude multiplier between octaves. */
  noiseGain?: number;
  scalarValue?: number;
  rgbColor?: string;
  /** Multiplier applied to elapsed seconds for Time node outputs. */
  timeSpeed?: number;
  /** Constant offset added after scaling elapsed seconds. */
  timeOffset?: number;
  mathOperation?: MaterialGraphMathOperation;
  mixFactor?: number;
  waveType?: MaterialGraphWaveType;
  waveScale?: number;
  waveDistortion?: number;
  voronoiScale?: number;
  voronoiRandomness?: number;
  mapFromMin?: number;
  mapFromMax?: number;
  mapToMin?: number;
  mapToMax?: number;
  mapClamp?: boolean;
  rampStart?: string;
  rampEnd?: string;
  rampMidpoint?: number;
  rampInterpolation?: 'Linear' | 'Ease' | 'Constant';
  prismSpectrum?: number;
  prismAberration?: number;
  prismSeed?: number;
  /** User-facing dispersion amount bound to the prism node. */
  prismStrength?: number;
  /** Index of refraction used by the Fresnel node. */
  fresnelIor?: number;
  /** Artistic falloff exponent layered over physical F0. */
  fresnelPower?: number;
  /** Minimum edge response before the falloff is applied. */
  fresnelBias?: number;
  /** Output multiplier applied to the Fresnel factor and color port. */
  fresnelIntensity?: number;
  /** Inverts the Fresnel rim (core-facing instead of edge-facing) when true. */
  fresnelInvert?: boolean;
  /** Tint used by the Fresnel color output port. */
  fresnelColor?: string;
  /** Axis sampled by the scanlines node. */
  scanlineAxis?: MaterialGraphScanlineAxis;
  /** Number of scanlines across the scan axis. */
  scanlineDensity?: number;
  /** Relative thickness of each scanline band. */
  scanlineThickness?: number;
  /** Anti-aliased edge softness for scanline bands. */
  scanlineSoftness?: number;
  /** Output multiplier applied to the scanline factor. */
  scanlineIntensity?: number;
  /** Vertical scroll speed of the scanline pattern (× elapsed seconds). */
  scanlineSpeed?: number;
  /** Low-frequency warp applied to the scan axis using the other axes. */
  scanlineDistortion?: number;
  /** Constant phase offset added to the scanline scroll. */
  scanlinePhase?: number;
  /** Displacement magnitude applied by the domain-warp node. */
  warpAmount?: number;
  /** Frequency of the domain-warp noise field. */
  warpScale?: number;
  /** Animation speed of the domain-warp noise field (× elapsed seconds). */
  warpSpeed?: number;
  /** Stable seed offset for the domain-warp noise field. */
  warpSeed?: number;
  /** Probability a band glitches within a time window. */
  glitchAmount?: number;
  /** Number of candidate horizontal bands. */
  glitchFrequency?: number;
  /** Relative height of the glitched strip inside a band. */
  glitchBandSize?: number;
  /** Horizontal offset magnitude emitted by a glitch. */
  glitchOffset?: number;
  /** Fraction of the time window during which a glitch is visible. */
  glitchDuration?: number;
  /** Time-window rate for glitch bands (× elapsed seconds). */
  glitchSpeed?: number;
  /** Stable seed offset for glitch band randomness. */
  glitchSeed?: number;
  /** Grid resolution of the digital-fragments node. */
  fragmentScale?: number;
  /** Fraction of grid cells eligible to light up. */
  fragmentDensity?: number;
  /** Flicker threshold above which an eligible cell is visible. */
  fragmentThreshold?: number;
  /** Stable seed offset for digital-fragments randomness. */
  fragmentSeed?: number;
  /** Temporal flicker rate for digital fragments (× elapsed seconds). */
  fragmentSpeed?: number;
  /** Strength of the chromatic split fringe. */
  chromaStrength?: number;
  /** Concentration of the chromatic split toward high-factor edges. */
  chromaEdgeBias?: number;
  /** Cyan side of the chromatic split fringe. */
  chromaCyan?: string;
  /** Magenta side of the chromatic split fringe. */
  chromaMagenta?: string;
  /** Pulse rate of the pulse node (× elapsed seconds). */
  pulseSpeed?: number;
  /** Depth of the pulse envelope below 1. */
  pulseAmount?: number;
  /** Constant phase offset added to the pulse. */
  pulsePhase?: number;
  /** Shaping exponent applied to the pulse envelope. */
  pulseSharpness?: number;
  /** Fallback transmission when a glass surface input is not connected. */
  surfaceTransmission?: number;
  /** Camera-dependent height-field depth used by the glass volume shader. */
  parallaxDepth?: number;
  /** Ray-march sample count for parallax occlusion mapping. */
  parallaxSteps?: number;
  /** Number of authored samples/shells behind the outer glass surface. */
  interiorLayers?: number;
  /** UV/geometric separation between internal inclusions. */
  interiorDepth?: number;
  /** Emissive caustic contribution of the internal volume. */
  interiorGlow?: number;
  /** Slot mode driving a surface-blend node: the slot decides, never the user (R-03). */
  blendMode?: MaterialRecipeSlotMode;
  /** View-space offset applied to the guest coordinates in `inside` mode. */
  blendDepth?: number;
  vectorX?: number;
  vectorY?: number;
  vectorZ?: number;
  outputEnabled?: boolean;
  outputBlend?: 'Opaque' | 'Alpha blend' | 'Additive';
}

export interface MaterialGraphNode {
  id: string;
  type: MaterialGraphNodeType;
  x: number;
  y: number;
  inputs: MaterialGraphPort[];
  outputs: MaterialGraphPort[];
  settings?: MaterialGraphNodeSettings;
}

export interface MaterialGraphEdge {
  id: string;
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
  tone: MaterialGraphPortTone;
}

export interface MaterialGraphFrame {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone: 'cyan' | 'violet' | 'gold';
}

export type MaterialGraphControlPlacement = 'essential' | 'advanced';

export type MaterialGraphControlCurve = 'linear' | 'ease-in' | 'ease-out' | 'smoothstep';

export interface MaterialGraphControlTarget {
  nodeId: string;
  setting: keyof MaterialGraphNodeSettings;
  /** Selects one component when the source parameter is a vector or color. */
  parameterComponent?: 0 | 1 | 2 | 3;
  inputRange?: [number, number];
  outputRange?: [number, number];
  curve?: MaterialGraphControlCurve;
  clamp?: boolean;
}

/**
 * Declarative bridge between a document parameter and one or more graph node
 * settings. Parameters remain the source of truth; resolved node settings are
 * derived for evaluation/GLSL and never need a second ad-hoc state mapping.
 */
export interface MaterialGraphControl {
  id: string;
  parameterKey: string;
  label: string;
  placement: MaterialGraphControlPlacement;
  group: string;
  targets: MaterialGraphControlTarget[];
  variation?: {
    enabled: boolean;
    weight: number;
  };
}

/** Canonical graph payload embedded in the material JSON document. */
export interface MaterialGraphDocument {
  version: MaterialGraphVersion;
  nodes: MaterialGraphNode[];
  edges: MaterialGraphEdge[];
  frames: MaterialGraphFrame[];
  controls?: MaterialGraphControl[];
  /**
   * Recipe interface (D2-1). Optional: a graph without one stays a valid
   * material, it simply cannot be invited into another recipe's slot.
   */
  recipe?: MaterialRecipeInterface;
}

export type PrismorphicGraphExtension = MaterialGraphDocument

export type MaterialGraphColorValue = [number, number, number, number];
export type MaterialGraphVectorValue = [number, number, number];

export type MaterialGraphPortValue =
  | { kind: 'scalar'; value: number }
  | { kind: 'color'; value: MaterialGraphColorValue }
  | { kind: 'vector'; value: MaterialGraphVectorValue }
  | { kind: 'shader'; value: MaterialGraphSurfaceValue };

export interface MaterialGraphSurfaceValue {
  baseColor: MaterialGraphColorValue;
  metallic: number;
  roughness: number;
  transmission: number;
  tint: MaterialGraphColorValue;
  emission: MaterialGraphColorValue;
  opacity: number;
  normal: MaterialGraphVectorValue;
  displacement: number;
}

/** Full evaluation of node outputs along paths that reach material-output. */
export interface MaterialGraphEvaluation {
  /** Values keyed by `${nodeId}:${portId}` for nodes on the output path. */
  ports: Record<string, MaterialGraphPortValue>;
  surface: MaterialGraphSurfaceValue | null;
  reachableNodeIds: string[];
}

/** Concrete preview/runtime consequences of graph topology and output settings. */
export interface MaterialGraphEffects {
  surfaceConnected: boolean;
  outputEnabled: boolean;
  outputBlend: NonNullable<MaterialGraphNodeSettings['outputBlend']>;
  baseColorConnected: boolean;
  metallicConnected: boolean;
  roughnessConnected: boolean;
  emissionConnected: boolean;
  opacityConnected: boolean;
  normalConnected: boolean;
  displacementConnected: boolean;
  prismConnected: boolean;
  transmissionConnected: boolean;
  noiseConnected: boolean;
  waveConnected: boolean;
  voronoiConnected: boolean;
  /** True when a Time node reaches the material output path. */
  timeConnected: boolean;
  proceduralTextureConnected: boolean;
  prismSpectrum: number;
  prismAberration: number;
  prismSeed: number;
  noiseDetail: number;
  waveType: MaterialGraphWaveType;
  waveScale: number;
  waveDistortion: number;
  voronoiScale: number;
  voronoiRandomness: number;
  mappingScale: [number, number, number];
  /** Evaluated surface tint/base color reaching the output (null when disconnected). */
  evaluatedColor: MaterialGraphColorValue | null;
  /** Evaluated roughness scalar reaching the surface (null when disconnected). */
  evaluatedRoughness: number | null;
  /** Evaluated metallic scalar reaching the surface (null when disconnected). */
  evaluatedMetallic: number | null;
  /** Evaluated transmission scalar reaching the surface (null when disconnected). */
  evaluatedTransmission: number | null;
  /** Evaluated emission color reaching the surface (null when disconnected). */
  evaluatedEmission: MaterialGraphColorValue | null;
  /** Evaluated opacity scalar reaching the surface (null when disconnected). */
  evaluatedOpacity: number | null;
  /** Evaluated normal vector reaching the surface (null when disconnected). */
  evaluatedNormal: MaterialGraphVectorValue | null;
  /** Evaluated displacement scalar reaching the surface (null when disconnected). */
  evaluatedDisplacement: number | null;
  /** True when roughness is driven by converters/textures/values, not only a leaf parameter node. */
  computedRoughness: boolean;
  /** True when color/tint is driven by converters/textures/values. */
  computedColor: boolean;
  /** True when metallic is driven by converters/values. */
  computedMetallic: boolean;
  /** True when transmission is driven by converters/values. */
  computedTransmission: boolean;
  /** True when emission is driven by converters/values. */
  computedEmission: boolean;
  /** True when opacity is driven by converters/values. */
  computedOpacity: boolean;
  /** True when normal is driven by converters/values. */
  computedNormal: boolean;
  /** True when displacement is driven by converters/values. */
  computedDisplacement: boolean;
  /** Sampled procedural factor from wave/noise/voronoi on the output path. */
  evaluatedProceduralFactor: number | null;
  /** Sampled procedural color from voronoi/mix/rgb on the output path. */
  evaluatedProceduralColor: MaterialGraphColorValue | null;
  /** Full port evaluation for nodes connected to the output. */
  evaluation: MaterialGraphEvaluation;
}

export const MATERIAL_GRAPH_MATH_OPERATIONS = [
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Power',
  'Minimum',
  'Maximum',
] as const satisfies readonly MaterialGraphMathOperation[];

export const MATERIAL_GRAPH_WAVE_TYPES = [
  'Sine',
  'Saw',
  'Triangle',
] as const satisfies readonly MaterialGraphWaveType[];

export const MATERIAL_GRAPH_NOISE_MODES = [
  'FBM',
  'Ridged',
  'Turbulence',
] as const satisfies readonly MaterialGraphNoiseMode[];

export const MATERIAL_GRAPH_NODE_TYPES = [
  'base-color',
  'metallic',
  'value',
  'rgb',
  'time',
  'texture-coordinate',
  'mapping',
  'noise-texture',
  'wave-texture',
  'voronoi-texture',
  'color-ramp',
  'math',
  'mix',
  'map-range',
  'invert',
  'fresnel',
  'prism-dispersion',
  'scanlines',
  'domain-warp',
  'glitch-bands',
  'digital-fragments',
  'chromatic-split',
  'pulse',
  'roughness',
  'emission',
  'opacity',
  'normal',
  'displacement',
  'pbr-surface',
  'unlit-surface',
  'glass-surface',
  'surface-blend',
  'material-output',
] as const satisfies readonly MaterialGraphNodeType[];

export const MATERIAL_GRAPH_PORTS_BY_TYPE: Record<
  MaterialGraphNodeType,
  { inputs: MaterialGraphPort[]; outputs: MaterialGraphPort[] }
> = {
  'base-color': { inputs: [], outputs: [{ id: 'color', label: 'Color', tone: 'color' }] },
  metallic: { inputs: [], outputs: [{ id: 'value', label: 'Value', tone: 'scalar' }] },
  value: { inputs: [], outputs: [{ id: 'value', label: 'Value', tone: 'scalar' }] },
  rgb: { inputs: [], outputs: [{ id: 'color', label: 'Color', tone: 'color' }] },
  time: {
    inputs: [],
    outputs: [
      { id: 'time', label: 'Time', tone: 'scalar' },
      { id: 'sin', label: 'Sin', tone: 'scalar' },
      { id: 'cos', label: 'Cos', tone: 'scalar' },
    ],
  },
  'texture-coordinate': { inputs: [], outputs: [{ id: 'uv', label: 'UV', tone: 'vector' }] },
  mapping: {
    inputs: [{ id: 'vector', label: 'Vector', tone: 'vector' }],
    outputs: [{ id: 'vector', label: 'Vector', tone: 'vector' }],
  },
  'noise-texture': {
    inputs: [{ id: 'vector', label: 'Vector', tone: 'vector' }],
    outputs: [{ id: 'factor', label: 'Factor', tone: 'scalar' }],
  },
  'wave-texture': {
    inputs: [{ id: 'vector', label: 'Vector', tone: 'vector' }],
    outputs: [{ id: 'factor', label: 'Factor', tone: 'scalar' }],
  },
  'voronoi-texture': {
    inputs: [{ id: 'vector', label: 'Vector', tone: 'vector' }],
    outputs: [
      { id: 'distance', label: 'Distance', tone: 'scalar' },
      { id: 'color', label: 'Color', tone: 'color' },
    ],
  },
  'color-ramp': {
    inputs: [{ id: 'factor', label: 'Factor', tone: 'scalar' }],
    outputs: [{ id: 'color', label: 'Color', tone: 'color' }],
  },
  math: {
    inputs: [
      { id: 'a', label: 'Value', tone: 'scalar' },
      { id: 'b', label: 'Value', tone: 'scalar' },
    ],
    outputs: [{ id: 'value', label: 'Value', tone: 'scalar' }],
  },
  mix: {
    inputs: [
      { id: 'a', label: 'A', tone: 'color' },
      { id: 'b', label: 'B', tone: 'color' },
      { id: 'factor', label: 'Factor', tone: 'scalar' },
    ],
    outputs: [{ id: 'color', label: 'Result', tone: 'color' }],
  },
  'map-range': {
    inputs: [{ id: 'value', label: 'Value', tone: 'scalar' }],
    outputs: [{ id: 'value', label: 'Result', tone: 'scalar' }],
  },
  invert: {
    inputs: [{ id: 'factor', label: 'Factor', tone: 'scalar' }],
    outputs: [{ id: 'factor', label: 'Factor', tone: 'scalar' }],
  },
  fresnel: {
    inputs: [],
    outputs: [
      { id: 'factor', label: 'Factor', tone: 'scalar' },
      { id: 'color', label: 'Color', tone: 'color' },
    ],
  },
  'prism-dispersion': {
    inputs: [
      { id: 'color', label: 'Color', tone: 'color' },
      { id: 'factor', label: 'Factor', tone: 'scalar' },
    ],
    outputs: [{ id: 'color', label: 'Color', tone: 'color' }],
  },
  scanlines: {
    inputs: [{ id: 'vector', label: 'Vector', tone: 'vector' }],
    outputs: [{ id: 'factor', label: 'Factor', tone: 'scalar' }],
  },
  'domain-warp': {
    inputs: [{ id: 'vector', label: 'Vector', tone: 'vector' }],
    outputs: [{ id: 'vector', label: 'Vector', tone: 'vector' }],
  },
  'glitch-bands': {
    inputs: [{ id: 'vector', label: 'Vector', tone: 'vector' }],
    outputs: [
      { id: 'factor', label: 'Factor', tone: 'scalar' },
      { id: 'offset', label: 'Offset', tone: 'scalar' },
      { id: 'vector', label: 'Vector', tone: 'vector' },
    ],
  },
  'digital-fragments': {
    inputs: [{ id: 'vector', label: 'Vector', tone: 'vector' }],
    outputs: [{ id: 'factor', label: 'Factor', tone: 'scalar' }],
  },
  'chromatic-split': {
    inputs: [
      { id: 'color', label: 'Color', tone: 'color' },
      { id: 'factor', label: 'Factor', tone: 'scalar' },
    ],
    outputs: [{ id: 'color', label: 'Color', tone: 'color' }],
  },
  pulse: {
    inputs: [],
    outputs: [{ id: 'factor', label: 'Factor', tone: 'scalar' }],
  },
  roughness: { inputs: [], outputs: [{ id: 'value', label: 'Value', tone: 'scalar' }] },
  emission: { inputs: [], outputs: [{ id: 'color', label: 'Color', tone: 'color' }] },
  opacity: { inputs: [], outputs: [{ id: 'value', label: 'Value', tone: 'scalar' }] },
  normal: { inputs: [], outputs: [{ id: 'vector', label: 'Normal', tone: 'vector' }] },
  displacement: { inputs: [], outputs: [{ id: 'value', label: 'Height', tone: 'scalar' }] },
  'pbr-surface': {
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
  },
  'unlit-surface': {
    inputs: [{ id: 'baseColor', label: 'Base color', tone: 'color' }],
    outputs: [{ id: 'shader', label: 'Shader', tone: 'shader' }],
  },
  'glass-surface': {
    inputs: [
      { id: 'tint', label: 'Tint', tone: 'color' },
      { id: 'roughness', label: 'Roughness', tone: 'scalar' },
      { id: 'transmission', label: 'Transmission', tone: 'scalar' },
    ],
    outputs: [{ id: 'shader', label: 'Shader', tone: 'shader' }],
  },
  'surface-blend': {
    inputs: [
      { id: 'host', label: 'Host', tone: 'shader' },
      { id: 'guest', label: 'Guest', tone: 'shader' },
      { id: 'mask', label: 'Mask', tone: 'scalar' },
      { id: 'amount', label: 'Amount', tone: 'scalar' },
    ],
    outputs: [{ id: 'shader', label: 'Shader', tone: 'shader' }],
  },
  'material-output': {
    inputs: [{ id: 'surface', label: 'Surface', tone: 'shader' }],
    outputs: [],
  },
};

/** Kind-scoped node catalog shared by sanitizer, editor palette, and compile effects. */
export const MATERIAL_GRAPH_NODE_TYPES_BY_KIND: Record<
  MaterialKind,
  readonly MaterialGraphNodeType[]
> = {
  procedural: [
    'base-color',
    'metallic',
    'value',
    'rgb',
    'time',
    'texture-coordinate',
    'mapping',
    'noise-texture',
    'wave-texture',
    'voronoi-texture',
    'color-ramp',
    'math',
    'mix',
    'map-range',
    'invert',
    'fresnel',
    'prism-dispersion',
    'scanlines',
    'domain-warp',
    'glitch-bands',
    'digital-fragments',
    'chromatic-split',
    'pulse',
    'roughness',
    'emission',
    'opacity',
    'normal',
    'displacement',
    'pbr-surface',
    'unlit-surface',
    'glass-surface',
    'surface-blend',
    'material-output',
  ],
  pbr: [
    'base-color',
    'metallic',
    'value',
    'rgb',
    'time',
    'texture-coordinate',
    'mapping',
    'noise-texture',
    'wave-texture',
    'voronoi-texture',
    'color-ramp',
    'math',
    'mix',
    'map-range',
    'invert',
    'fresnel',
    'prism-dispersion',
    'scanlines',
    'domain-warp',
    'glitch-bands',
    'digital-fragments',
    'chromatic-split',
    'pulse',
    'roughness',
    'emission',
    'opacity',
    'normal',
    'displacement',
    'pbr-surface',
    'glass-surface',
    'surface-blend',
    'material-output',
  ],
  unlit: ['base-color', 'unlit-surface', 'material-output'],
};

/**
 * Operator constants of the `surface-blend` node (D2-1 §4.2). They are the
 * reference values of the spec: tunable from the node inspector and meant to
 * be trimmed by eye on the Three.js render, not frozen here.
 */
export const MATERIAL_GRAPH_SURFACE_BLEND_CONSTANTS = {
  /** Width of the coverage ramp. */
  coverageSoftness: 0.22,
  /** How fast the amount eats into the coverage ramp. */
  coverageGain: 1.15,
  /** A guest inside a solid host still shows; inside a clear one it shows more. */
  insideTransmissionFloor: 0.55,
  insideTransmissionSpan: 0.45,
  /** Inside, the guest keeps part of its albedo and takes the host's tint. */
  insideGuestAlbedo: 0.78,
  insideHostTint: 0.35,
  /**
   * How much of its own reflectance a guest brings to an inclusion.
   *
   * The host used to keep all of it, which is defensible for a faint
   * inclusion and makes a guest's Glossy and Metallic sliders inert at any
   * quantity — they moved a uniform the blend then discarded.
   */
  insideReflectanceShare: 0.7,
  /** The host keeps most of its transmission where a guest sits inside it. */
  insideTransmissionDrop: 0.3,
  insideEmission: 0.6,
  /** Veins read the pattern hot. */
  veinsGain: 1.4,
  /** Edges ride the host Fresnel, with a trace of plain coverage. */
  edgeFresnelGain: 2.2,
  edgeCoverage: 0.15,
  /**
   * Frequency of the field a blend falls back on when no mask is wired (§4.2
   * reads the coverage ramp over "bruit"). Without it the field is a constant
   * and the coverage ramp saturates, which makes the Quantity slider do
   * nothing over most of its travel.
   */
  defaultFieldScale: 2.6,
  defaultFieldDetail: 4,
} as const;

/** Stable per-blend seed so two blends in one mix do not share a field. */
export function materialGraphBlendFieldSeed(nodeId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < nodeId.length; index += 1) {
    hash ^= nodeId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash % 6400) / 100;
}

const WORLD_COORDINATE_LIMIT = 10_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function edge(
  fromNode: string,
  fromPort: string,
  toNode: string,
  toPort: string,
  tone: MaterialGraphPortTone,
): MaterialGraphEdge {
  return {
    id: `${fromNode}:${fromPort}->${toNode}:${toPort}`,
    fromNode,
    fromPort,
    toNode,
    toPort,
    tone,
  };
}

function withPorts(
  id: string,
  type: MaterialGraphNodeType,
  x: number,
  y: number,
  settings?: MaterialGraphNodeSettings,
): MaterialGraphNode {
  const ports = MATERIAL_GRAPH_PORTS_BY_TYPE[type];
  return {
    id,
    type,
    x,
    y,
    inputs: ports.inputs.map((port) => ({ ...port })),
    outputs: ports.outputs.map((port) => ({ ...port })),
    settings,
  };
}

function outputBlendForDocument(
  document: PrismorphicMaterialDocument,
): MaterialGraphNodeSettings['outputBlend'] {
  const alphaMode = document.parameters.alphaMode;
  return alphaMode?.type === 'enum' && alphaMode.value === 'blend' ? 'Alpha blend' : 'Opaque';
}

const CONTROL_LABEL_BY_PARAMETER: Record<string, string> = {
  roughness: 'Surface Feel',
  transmission: 'Glass Character',
  baseColor: 'Color & Light',
  noiseScale: 'Detail',
  metallic: 'Metal Character',
  emissiveIntensity: 'Glow',
  prismStrength: 'Prism Character',
  ior: 'Optical Density',
  uvScale: 'Pattern Scale',
};

function controlId(parameterKey: string): string {
  return `control-${parameterKey.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

function formatControlLabel(parameterKey: string): string {
  return CONTROL_LABEL_BY_PARAMETER[parameterKey] ?? parameterKey
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function targetsForParameter(
  parameterKey: string,
  graph: MaterialGraphDocument,
): MaterialGraphControlTarget[] {
  const nodes = (type: MaterialGraphNodeType) => graph.nodes.filter((node) => node.type === type);
  const targets: MaterialGraphControlTarget[] = [];
  const add = (
    type: MaterialGraphNodeType,
    setting: keyof MaterialGraphNodeSettings,
    extras: Omit<MaterialGraphControlTarget, 'nodeId' | 'setting'> = {},
  ): void => {
    for (const node of nodes(type)) {
      if (node.settings?.[setting] !== undefined) continue;
      targets.push({ nodeId: node.id, setting, ...extras });
    }
  };

  switch (parameterKey) {
    case 'baseColor':
      add('base-color', 'rgbColor');
      break;
    case 'metallic':
      add('metallic', 'scalarValue');
      break;
    case 'roughness':
      add('roughness', 'scalarValue');
      break;
    case 'emissive':
      add('emission', 'rgbColor');
      break;
    case 'opacity':
      add('opacity', 'scalarValue');
      break;
    case 'displacementScale':
      add('displacement', 'scalarValue');
      break;
    case 'noiseScale':
      add('noise-texture', 'noiseScale');
      break;
    case 'ior':
      add('fresnel', 'fresnelIor');
      break;
    case 'prismStrength':
      add('prism-dispersion', 'prismStrength');
      add('prism-dispersion', 'prismSpectrum', {
        inputRange: [0, 1],
        outputRange: [0.35, 1],
        curve: 'smoothstep',
        clamp: true,
      });
      break;
    case 'transmission':
      add('glass-surface', 'surfaceTransmission');
      break;
    case 'parallaxDepth':
      add('glass-surface', 'parallaxDepth');
      break;
    case 'parallaxSteps':
      add('glass-surface', 'parallaxSteps');
      break;
    case 'interiorLayers':
      add('glass-surface', 'interiorLayers');
      break;
    case 'interiorDepth':
      add('glass-surface', 'interiorDepth');
      break;
    case 'interiorGlow':
      add('glass-surface', 'interiorGlow');
      break;
    case 'uvScale':
      add('mapping', 'mappingX', { parameterComponent: 0 });
      add('mapping', 'mappingY', { parameterComponent: 1 });
      break;
  }
  return targets;
}

/** Adds default bindings for legacy graphs without overwriting authored controls. */
export function ensureMaterialGraphControls(
  document: PrismorphicMaterialDocument,
  graph: MaterialGraphDocument,
): MaterialGraphDocument {
  const authored = graph.controls ?? [];
  const represented = new Set(authored.map((control) => control.parameterKey));
  const inferred: MaterialGraphControl[] = [];
  for (const [parameterKey, parameter] of Object.entries(document.parameters)) {
    if (represented.has(parameterKey)) continue;
    const targets = targetsForParameter(parameterKey, graph);
    if (targets.length === 0) continue;
    inferred.push({
      id: controlId(parameterKey),
      parameterKey,
      label: CONTROL_LABEL_BY_PARAMETER[parameterKey] ?? parameter.label ?? formatControlLabel(parameterKey),
      placement: parameter.exposed === false || parameter.group === 'advanced' ? 'advanced' : 'essential',
      group: parameter.group ?? 'surface',
      targets,
      variation: {
        enabled: parameter.type === 'scalar' || parameter.type === 'vec2' || parameter.type === 'vec3',
        weight: parameterKey === 'roughness' || parameterKey === 'noiseScale' ? 1 : 0.65,
      },
    });
  }
  if (authored.length === 0 && inferred.length === 0 && graph.version === MATERIAL_GRAPH_VERSION) {
    return graph;
  }
  return {
    ...graph,
    version: MATERIAL_GRAPH_VERSION,
    controls: [...authored, ...inferred],
  };
}

function curveValue(value: number, curve: MaterialGraphControlCurve): number {
  const t = clamp(value, 0, 1);
  switch (curve) {
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'smoothstep':
      return t * t * (3 - 2 * t);
    default:
      return t;
  }
}

function inverseCurveValue(value: number, curve: MaterialGraphControlCurve): number {
  const target = clamp(value, 0, 1);
  if (curve === 'ease-in') return Math.sqrt(target);
  if (curve === 'ease-out') return 1 - Math.sqrt(1 - target);
  if (curve !== 'smoothstep') return target;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 18; index += 1) {
    const middle = (low + high) / 2;
    if (curveValue(middle, 'smoothstep') < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function mapControlNumber(value: number, target: MaterialGraphControlTarget): number {
  if (!target.inputRange && !target.outputRange) return value;
  const input = target.inputRange ?? [0, 1];
  const output = target.outputRange ?? input;
  const span = input[1] - input[0];
  const normalized = Math.abs(span) < 1e-8 ? 0 : (value - input[0]) / span;
  const curved = curveValue(target.clamp === false ? normalized : clamp(normalized, 0, 1), target.curve ?? 'linear');
  const mapped = output[0] + curved * (output[1] - output[0]);
  return target.clamp === false ? mapped : clamp(mapped, Math.min(...output), Math.max(...output));
}

function unmapControlNumber(value: number, target: MaterialGraphControlTarget): number {
  if (!target.inputRange && !target.outputRange) return value;
  const input = target.inputRange ?? [0, 1];
  const output = target.outputRange ?? input;
  const span = output[1] - output[0];
  const normalized = Math.abs(span) < 1e-8 ? 0 : (value - output[0]) / span;
  const uncurved = inverseCurveValue(
    target.clamp === false ? normalized : clamp(normalized, 0, 1),
    target.curve ?? 'linear',
  );
  const mapped = input[0] + uncurved * (input[1] - input[0]);
  return target.clamp === false ? mapped : clamp(mapped, Math.min(...input), Math.max(...input));
}

function rgbaToHexColor(value: readonly number[]): string {
  return `#${value.slice(0, 3).map((component) => Math.round(clamp(component, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function resolveTargetValue(
  parameter: MaterialParameter,
  target: MaterialGraphControlTarget,
): string | number | boolean | undefined {
  if (parameter.type === 'scalar') return mapControlNumber(parameter.value, target);
  if (parameter.type === 'vec2' || parameter.type === 'vec3') {
    const component = Math.min(target.parameterComponent ?? 0, parameter.value.length - 1) as 0 | 1 | 2;
    const value = parameter.value[component];
    return typeof value === 'number' ? mapControlNumber(value, target) : undefined;
  }
  if (parameter.type === 'color') {
    if (target.parameterComponent !== undefined) {
      return mapControlNumber(parameter.value[target.parameterComponent] ?? 0, target);
    }
    return rgbaToHexColor(parameter.value);
  }
  if (parameter.type === 'bool') return parameter.value;
  if (parameter.type === 'enum') return parameter.value;
  return undefined;
}

/** Resolves parameter-backed node settings for CPU evaluation and uniform patches. */
export function resolveMaterialGraphControlBindings(
  document: PrismorphicMaterialDocument,
  graphInput: MaterialGraphDocument = resolveMaterialGraph(document),
): MaterialGraphDocument {
  const graph = ensureMaterialGraphControls(document, graphInput);
  if (!graph.controls?.length) return graph;
  const nodes = graph.nodes.map((node) => ({
    ...node,
    settings: node.settings ? { ...node.settings } : undefined,
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const control of graph.controls) {
    const parameter = document.parameters[control.parameterKey];
    if (!parameter) continue;
    for (const target of control.targets) {
      const node = nodeById.get(target.nodeId);
      if (!node) continue;
      const value = resolveTargetValue(parameter, target);
      if (value === undefined) continue;
      const settings = { ...(node.settings ?? {}) } as Record<string, unknown>;
      settings[target.setting] = value;
      node.settings = settings as MaterialGraphNodeSettings;
    }
  }
  return { ...graph, nodes };
}

export interface MaterialGraphControlInverseResult {
  parameterKey: string;
  value: MaterialParameter['value'];
}

/** Maps an inspector target edit back to its canonical document parameter. */
export function invertMaterialGraphControlTarget(
  document: PrismorphicMaterialDocument,
  graph: MaterialGraphDocument,
  nodeId: string,
  setting: keyof MaterialGraphNodeSettings,
  candidate: unknown,
): MaterialGraphControlInverseResult | null {
  const control = graph.controls?.find((entry) =>
    entry.targets.some((target) => target.nodeId === nodeId && target.setting === setting),
  );
  if (!control) return null;
  const target = control.targets.find((entry) => entry.nodeId === nodeId && entry.setting === setting);
  const parameter = document.parameters[control.parameterKey];
  if (!target || !parameter) return null;

  if (parameter.type === 'scalar' && typeof candidate === 'number' && Number.isFinite(candidate)) {
    return { parameterKey: control.parameterKey, value: unmapControlNumber(candidate, target) };
  }
  if ((parameter.type === 'vec2' || parameter.type === 'vec3') && typeof candidate === 'number' && Number.isFinite(candidate)) {
    const component = Math.min(target.parameterComponent ?? 0, parameter.value.length - 1) as 0 | 1 | 2;
    const next = [...parameter.value];
    if (component >= next.length) return null;
    next[component] = unmapControlNumber(candidate, target);
    return { parameterKey: control.parameterKey, value: next as MaterialParameter['value'] };
  }
  if (parameter.type === 'color' && typeof candidate === 'string' && /^#[0-9a-f]{6}$/i.test(candidate)) {
    const raw = Number.parseInt(candidate.slice(1), 16);
    return {
      parameterKey: control.parameterKey,
      value: [((raw >> 16) & 255) / 255, ((raw >> 8) & 255) / 255, (raw & 255) / 255, parameter.value[3] ?? 1],
    };
  }
  if (parameter.type === 'bool' && typeof candidate === 'boolean') {
    return { parameterKey: control.parameterKey, value: candidate };
  }
  if (parameter.type === 'enum' && typeof candidate === 'string' && parameter.options.includes(candidate)) {
    return { parameterKey: control.parameterKey, value: candidate };
  }
  return null;
}

/** Builds the kind-specific default editable graph, including ports on every node. */
export function createDefaultMaterialGraph(
  document: PrismorphicMaterialDocument,
): MaterialGraphDocument & { version: typeof MATERIAL_GRAPH_VERSION } {
  const outputBlend = outputBlendForDocument(document);
  if (document.kind === 'procedural') {
    return ensureMaterialGraphControls(document, {
      version: MATERIAL_GRAPH_VERSION,
      nodes: [
        withPorts('texture-coordinate', 'texture-coordinate', 1, 43),
        withPorts('mapping', 'mapping', 15, 42),
        withPorts('noise-texture', 'noise-texture', 30, 18),
        withPorts('color-ramp', 'color-ramp', 30, 59),
        withPorts('fresnel', 'fresnel', 52, 18),
        withPorts('prism-dispersion', 'prism-dispersion', 52, 42),
        withPorts('roughness', 'roughness', 75, 18),
        withPorts('glass-surface', 'glass-surface', 75, 46),
        withPorts('material-output', 'material-output', 90, 47, { outputBlend, outputEnabled: true }),
      ],
      edges: [
        edge('texture-coordinate', 'uv', 'mapping', 'vector', 'vector'),
        edge('mapping', 'vector', 'noise-texture', 'vector', 'vector'),
        edge('noise-texture', 'factor', 'prism-dispersion', 'factor', 'scalar'),
        edge('color-ramp', 'color', 'prism-dispersion', 'color', 'color'),
        edge('fresnel', 'factor', 'glass-surface', 'transmission', 'scalar'),
        edge('prism-dispersion', 'color', 'glass-surface', 'tint', 'color'),
        edge('roughness', 'value', 'glass-surface', 'roughness', 'scalar'),
        edge('glass-surface', 'shader', 'material-output', 'surface', 'shader'),
      ],
      // Lane frames mirror the AAA node-editor mockup columns.
      frames: [
        { id: 'lane-coordinates', label: 'Coordinates', x: 0.5, y: 8, width: 27, height: 78, tone: 'cyan' },
        { id: 'lane-pattern', label: 'Pattern', x: 26.5, y: 8, width: 20, height: 78, tone: 'violet' },
        { id: 'lane-optics', label: 'Optics', x: 48.5, y: 8, width: 20, height: 78, tone: 'gold' },
        { id: 'lane-surface', label: 'Surface', x: 70.5, y: 8, width: 16, height: 78, tone: 'cyan' },
        { id: 'lane-output', label: 'Output', x: 87, y: 8, width: 12, height: 78, tone: 'violet' },
      ],
    }) as MaterialGraphDocument & { version: typeof MATERIAL_GRAPH_VERSION };
  }

  if (document.kind === 'unlit') {
    return ensureMaterialGraphControls(document, {
      version: MATERIAL_GRAPH_VERSION,
      nodes: [
        withPorts('base-color', 'base-color', 22, 43),
        withPorts('unlit-surface', 'unlit-surface', 48, 43),
        withPorts('material-output', 'material-output', 69, 43, { outputBlend, outputEnabled: true }),
      ],
      edges: [
        edge('base-color', 'color', 'unlit-surface', 'baseColor', 'color'),
        edge('unlit-surface', 'shader', 'material-output', 'surface', 'shader'),
      ],
      frames: [],
    }) as MaterialGraphDocument & { version: typeof MATERIAL_GRAPH_VERSION };
  }

  return ensureMaterialGraphControls(document, {
    version: MATERIAL_GRAPH_VERSION,
    nodes: [
      withPorts('base-color', 'base-color', 18, 25),
      withPorts('metallic', 'metallic', 18, 48),
      withPorts('roughness', 'roughness', 18, 69),
      withPorts('pbr-surface', 'pbr-surface', 48, 40),
      withPorts('material-output', 'material-output', 69, 44, { outputBlend, outputEnabled: true }),
    ],
    edges: [
      edge('base-color', 'color', 'pbr-surface', 'baseColor', 'color'),
      edge('metallic', 'value', 'pbr-surface', 'metallic', 'scalar'),
      edge('roughness', 'value', 'pbr-surface', 'roughness', 'scalar'),
      edge('pbr-surface', 'shader', 'material-output', 'surface', 'shader'),
    ],
    frames: [],
  }) as MaterialGraphDocument & { version: typeof MATERIAL_GRAPH_VERSION };
}

/**
 * Reconstructs exact catalog ports for a node type.
 * Unknown port ids are discarded; missing catalog ports are restored.
 * Labels always come from the catalog so serialized graphs stay canonical.
 */
function sanitizePorts(
  declared: { inputs: MaterialGraphPort[]; outputs: MaterialGraphPort[] },
  _rawInputs: unknown,
  _rawOutputs: unknown,
): { inputs: MaterialGraphPort[]; outputs: MaterialGraphPort[] } {
  return {
    inputs: declared.inputs.map((port) => ({ ...port })),
    outputs: declared.outputs.map((port) => ({ ...port })),
  };
}

function sanitizeNodeSettings(value: unknown): MaterialGraphNodeSettings | undefined {
  if (!isPlainObject(value)) return undefined;
  const settings: MaterialGraphNodeSettings = {};
  if (value.coordinateSpace === 'UV' || value.coordinateSpace === 'Generated' || value.coordinateSpace === 'Object') {
    settings.coordinateSpace = value.coordinateSpace;
  }
  if (typeof value.uvChannel === 'number' && Number.isFinite(value.uvChannel)) {
    settings.uvChannel = Math.round(clamp(value.uvChannel, 0, 7));
  }
  for (const key of ['mappingX', 'mappingY', 'mappingZ'] as const) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) {
      settings[key] = clamp(value[key], -4, 4);
    }
  }
  if (typeof value.noiseDetail === 'number' && Number.isFinite(value.noiseDetail)) {
    settings.noiseDetail = clamp(value.noiseDetail, 0, 12);
  }
  if (typeof value.noiseScale === 'number' && Number.isFinite(value.noiseScale)) {
    settings.noiseScale = clamp(value.noiseScale, 0.05, 128);
  }
  if (value.noiseMode === 'FBM' || value.noiseMode === 'Ridged' || value.noiseMode === 'Turbulence') {
    settings.noiseMode = value.noiseMode;
  }
  if (typeof value.noiseSeed === 'number' && Number.isFinite(value.noiseSeed)) {
    settings.noiseSeed = clamp(value.noiseSeed, -1000, 1000);
  }
  if (typeof value.noiseWarp === 'number' && Number.isFinite(value.noiseWarp)) {
    settings.noiseWarp = clamp(value.noiseWarp, 0, 4);
  }
  if (typeof value.noiseLacunarity === 'number' && Number.isFinite(value.noiseLacunarity)) {
    settings.noiseLacunarity = clamp(value.noiseLacunarity, 1.2, 4);
  }
  if (typeof value.noiseGain === 'number' && Number.isFinite(value.noiseGain)) {
    settings.noiseGain = clamp(value.noiseGain, 0.1, 0.9);
  }
  if (typeof value.scalarValue === 'number' && Number.isFinite(value.scalarValue)) {
    settings.scalarValue = clamp(value.scalarValue, -100, 100);
  }
  if (typeof value.rgbColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.rgbColor)) {
    settings.rgbColor = value.rgbColor.toUpperCase();
  }
  if (typeof value.timeSpeed === 'number' && Number.isFinite(value.timeSpeed)) {
    settings.timeSpeed = clamp(value.timeSpeed, 0, 64);
  }
  if (typeof value.timeOffset === 'number' && Number.isFinite(value.timeOffset)) {
    settings.timeOffset = clamp(value.timeOffset, -1000, 1000);
  }
  if (
    value.mathOperation === 'Add' ||
    value.mathOperation === 'Subtract' ||
    value.mathOperation === 'Multiply' ||
    value.mathOperation === 'Divide' ||
    value.mathOperation === 'Power' ||
    value.mathOperation === 'Minimum' ||
    value.mathOperation === 'Maximum'
  ) {
    settings.mathOperation = value.mathOperation;
  }
  if (typeof value.mixFactor === 'number' && Number.isFinite(value.mixFactor)) {
    settings.mixFactor = clamp(value.mixFactor, 0, 1);
  }
  if (value.waveType === 'Sine' || value.waveType === 'Saw' || value.waveType === 'Triangle') {
    settings.waveType = value.waveType;
  }
  if (typeof value.waveScale === 'number' && Number.isFinite(value.waveScale)) {
    settings.waveScale = clamp(value.waveScale, 0.1, 64);
  }
  if (typeof value.waveDistortion === 'number' && Number.isFinite(value.waveDistortion)) {
    settings.waveDistortion = clamp(value.waveDistortion, 0, 1);
  }
  if (typeof value.voronoiScale === 'number' && Number.isFinite(value.voronoiScale)) {
    settings.voronoiScale = clamp(value.voronoiScale, 0.1, 64);
  }
  if (typeof value.voronoiRandomness === 'number' && Number.isFinite(value.voronoiRandomness)) {
    settings.voronoiRandomness = clamp(value.voronoiRandomness, 0, 1);
  }
  for (const key of ['mapFromMin', 'mapFromMax', 'mapToMin', 'mapToMax'] as const) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) {
      settings[key] = clamp(value[key], -100, 100);
    }
  }
  if (typeof value.mapClamp === 'boolean') {
    settings.mapClamp = value.mapClamp;
  }
  if (typeof value.rampStart === 'string' && /^#[0-9a-f]{6}$/i.test(value.rampStart)) {
    settings.rampStart = value.rampStart.toUpperCase();
  }
  if (typeof value.rampEnd === 'string' && /^#[0-9a-f]{6}$/i.test(value.rampEnd)) {
    settings.rampEnd = value.rampEnd.toUpperCase();
  }
  if (typeof value.rampMidpoint === 'number' && Number.isFinite(value.rampMidpoint)) {
    settings.rampMidpoint = clamp(value.rampMidpoint, 0.05, 0.95);
  }
  if (value.rampInterpolation === 'Linear' || value.rampInterpolation === 'Ease' || value.rampInterpolation === 'Constant') {
    settings.rampInterpolation = value.rampInterpolation;
  }
  if (typeof value.prismSpectrum === 'number' && Number.isFinite(value.prismSpectrum)) {
    settings.prismSpectrum = clamp(value.prismSpectrum, 0, 1);
  }
  if (typeof value.prismAberration === 'number' && Number.isFinite(value.prismAberration)) {
    settings.prismAberration = clamp(value.prismAberration, 0, 1);
  }
  if (typeof value.prismSeed === 'number' && Number.isFinite(value.prismSeed)) {
    settings.prismSeed = Math.round(clamp(value.prismSeed, 0, 64));
  }
  if (typeof value.prismStrength === 'number' && Number.isFinite(value.prismStrength)) {
    settings.prismStrength = clamp(value.prismStrength, 0, 1);
  }
  if (typeof value.fresnelIor === 'number' && Number.isFinite(value.fresnelIor)) {
    settings.fresnelIor = clamp(value.fresnelIor, 1, 2.5);
  }
  if (typeof value.fresnelPower === 'number' && Number.isFinite(value.fresnelPower)) {
    settings.fresnelPower = clamp(value.fresnelPower, 0.25, 12);
  }
  if (typeof value.fresnelBias === 'number' && Number.isFinite(value.fresnelBias)) {
    settings.fresnelBias = clamp(value.fresnelBias, 0, 1);
  }
  if (typeof value.fresnelIntensity === 'number' && Number.isFinite(value.fresnelIntensity)) {
    settings.fresnelIntensity = clamp(value.fresnelIntensity, 0, 8);
  }
  if (typeof value.fresnelInvert === 'boolean') {
    settings.fresnelInvert = value.fresnelInvert;
  }
  if (typeof value.fresnelColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.fresnelColor)) {
    settings.fresnelColor = value.fresnelColor.toUpperCase();
  }
  if (value.scanlineAxis === 'X' || value.scanlineAxis === 'Y' || value.scanlineAxis === 'Z') {
    settings.scanlineAxis = value.scanlineAxis;
  }
  if (typeof value.scanlineDensity === 'number' && Number.isFinite(value.scanlineDensity)) {
    settings.scanlineDensity = clamp(value.scanlineDensity, 0.5, 256);
  }
  if (typeof value.scanlineThickness === 'number' && Number.isFinite(value.scanlineThickness)) {
    settings.scanlineThickness = clamp(value.scanlineThickness, 0.01, 0.95);
  }
  if (typeof value.scanlineSoftness === 'number' && Number.isFinite(value.scanlineSoftness)) {
    settings.scanlineSoftness = clamp(value.scanlineSoftness, 0.001, 0.5);
  }
  if (typeof value.scanlineIntensity === 'number' && Number.isFinite(value.scanlineIntensity)) {
    settings.scanlineIntensity = clamp(value.scanlineIntensity, 0, 8);
  }
  if (typeof value.scanlineSpeed === 'number' && Number.isFinite(value.scanlineSpeed)) {
    settings.scanlineSpeed = clamp(value.scanlineSpeed, 0, 8);
  }
  if (typeof value.scanlineDistortion === 'number' && Number.isFinite(value.scanlineDistortion)) {
    settings.scanlineDistortion = clamp(value.scanlineDistortion, 0, 2);
  }
  if (typeof value.scanlinePhase === 'number' && Number.isFinite(value.scanlinePhase)) {
    settings.scanlinePhase = clamp(value.scanlinePhase, -10, 10);
  }
  if (typeof value.warpAmount === 'number' && Number.isFinite(value.warpAmount)) {
    settings.warpAmount = clamp(value.warpAmount, 0, 4);
  }
  if (typeof value.warpScale === 'number' && Number.isFinite(value.warpScale)) {
    settings.warpScale = clamp(value.warpScale, 0.1, 32);
  }
  if (typeof value.warpSpeed === 'number' && Number.isFinite(value.warpSpeed)) {
    settings.warpSpeed = clamp(value.warpSpeed, 0, 4);
  }
  if (typeof value.warpSeed === 'number' && Number.isFinite(value.warpSeed)) {
    settings.warpSeed = clamp(value.warpSeed, -1000, 1000);
  }
  if (typeof value.glitchAmount === 'number' && Number.isFinite(value.glitchAmount)) {
    settings.glitchAmount = clamp(value.glitchAmount, 0, 1);
  }
  if (typeof value.glitchFrequency === 'number' && Number.isFinite(value.glitchFrequency)) {
    settings.glitchFrequency = clamp(value.glitchFrequency, 1, 64);
  }
  if (typeof value.glitchBandSize === 'number' && Number.isFinite(value.glitchBandSize)) {
    settings.glitchBandSize = clamp(value.glitchBandSize, 0.01, 0.5);
  }
  if (typeof value.glitchOffset === 'number' && Number.isFinite(value.glitchOffset)) {
    settings.glitchOffset = clamp(value.glitchOffset, 0, 1);
  }
  if (typeof value.glitchDuration === 'number' && Number.isFinite(value.glitchDuration)) {
    settings.glitchDuration = clamp(value.glitchDuration, 0.05, 1);
  }
  if (typeof value.glitchSpeed === 'number' && Number.isFinite(value.glitchSpeed)) {
    settings.glitchSpeed = clamp(value.glitchSpeed, 0, 8);
  }
  if (typeof value.glitchSeed === 'number' && Number.isFinite(value.glitchSeed)) {
    settings.glitchSeed = clamp(value.glitchSeed, -1000, 1000);
  }
  if (typeof value.fragmentScale === 'number' && Number.isFinite(value.fragmentScale)) {
    settings.fragmentScale = clamp(value.fragmentScale, 1, 256);
  }
  if (typeof value.fragmentDensity === 'number' && Number.isFinite(value.fragmentDensity)) {
    settings.fragmentDensity = clamp(value.fragmentDensity, 0, 1);
  }
  if (typeof value.fragmentThreshold === 'number' && Number.isFinite(value.fragmentThreshold)) {
    settings.fragmentThreshold = clamp(value.fragmentThreshold, 0, 1);
  }
  if (typeof value.fragmentSeed === 'number' && Number.isFinite(value.fragmentSeed)) {
    settings.fragmentSeed = clamp(value.fragmentSeed, -1000, 1000);
  }
  if (typeof value.fragmentSpeed === 'number' && Number.isFinite(value.fragmentSpeed)) {
    settings.fragmentSpeed = clamp(value.fragmentSpeed, 0, 4);
  }
  if (typeof value.chromaStrength === 'number' && Number.isFinite(value.chromaStrength)) {
    settings.chromaStrength = clamp(value.chromaStrength, 0, 1);
  }
  if (typeof value.chromaEdgeBias === 'number' && Number.isFinite(value.chromaEdgeBias)) {
    settings.chromaEdgeBias = clamp(value.chromaEdgeBias, 0, 1);
  }
  if (typeof value.chromaCyan === 'string' && /^#[0-9a-f]{6}$/i.test(value.chromaCyan)) {
    settings.chromaCyan = value.chromaCyan.toUpperCase();
  }
  if (typeof value.chromaMagenta === 'string' && /^#[0-9a-f]{6}$/i.test(value.chromaMagenta)) {
    settings.chromaMagenta = value.chromaMagenta.toUpperCase();
  }
  if (typeof value.pulseSpeed === 'number' && Number.isFinite(value.pulseSpeed)) {
    settings.pulseSpeed = clamp(value.pulseSpeed, 0, 8);
  }
  if (typeof value.pulseAmount === 'number' && Number.isFinite(value.pulseAmount)) {
    settings.pulseAmount = clamp(value.pulseAmount, 0, 1);
  }
  if (typeof value.pulsePhase === 'number' && Number.isFinite(value.pulsePhase)) {
    settings.pulsePhase = clamp(value.pulsePhase, -10, 10);
  }
  if (typeof value.pulseSharpness === 'number' && Number.isFinite(value.pulseSharpness)) {
    settings.pulseSharpness = clamp(value.pulseSharpness, 0.25, 8);
  }
  if (typeof value.surfaceTransmission === 'number' && Number.isFinite(value.surfaceTransmission)) {
    settings.surfaceTransmission = clamp(value.surfaceTransmission, 0, 1);
  }
  if (typeof value.parallaxDepth === 'number' && Number.isFinite(value.parallaxDepth)) {
    settings.parallaxDepth = clamp(value.parallaxDepth, 0, 1.5);
  }
  if (typeof value.parallaxSteps === 'number' && Number.isFinite(value.parallaxSteps)) {
    settings.parallaxSteps = Math.round(clamp(value.parallaxSteps, 4, 32));
  }
  if (typeof value.interiorLayers === 'number' && Number.isFinite(value.interiorLayers)) {
    settings.interiorLayers = Math.round(clamp(value.interiorLayers, 1, 8));
  }
  if (typeof value.interiorDepth === 'number' && Number.isFinite(value.interiorDepth)) {
    settings.interiorDepth = clamp(value.interiorDepth, 0, 0.25);
  }
  if (typeof value.interiorGlow === 'number' && Number.isFinite(value.interiorGlow)) {
    settings.interiorGlow = clamp(value.interiorGlow, 0, 4);
  }
  for (const key of ['vectorX', 'vectorY', 'vectorZ'] as const) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) {
      settings[key] = clamp(value[key], -1, 1);
    }
  }
  if (isMaterialRecipeSlotMode(value.blendMode)) {
    settings.blendMode = value.blendMode;
  }
  if (typeof value.blendDepth === 'number' && Number.isFinite(value.blendDepth)) {
    settings.blendDepth = clamp(value.blendDepth, 0, 0.5);
  }
  if (typeof value.outputEnabled === 'boolean') {
    settings.outputEnabled = value.outputEnabled;
  }
  if (value.outputBlend === 'Opaque' || value.outputBlend === 'Alpha blend' || value.outputBlend === 'Additive') {
    settings.outputBlend = value.outputBlend;
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
}

const MATERIAL_GRAPH_SETTING_KEYS = new Set<keyof MaterialGraphNodeSettings>([
  'coordinateSpace', 'uvChannel', 'mappingX', 'mappingY', 'mappingZ', 'noiseDetail',
  'noiseScale', 'noiseMode', 'noiseSeed', 'noiseWarp', 'noiseLacunarity', 'noiseGain',
  'scalarValue', 'rgbColor', 'timeSpeed', 'timeOffset', 'mathOperation',
  'mixFactor', 'waveType', 'waveScale', 'waveDistortion', 'voronoiScale',
  'voronoiRandomness', 'mapFromMin', 'mapFromMax', 'mapToMin', 'mapToMax', 'mapClamp',
  'rampStart', 'rampEnd', 'rampMidpoint', 'rampInterpolation', 'prismSpectrum',
  'prismAberration', 'prismSeed', 'prismStrength', 'fresnelIor', 'fresnelPower',
  'fresnelBias', 'fresnelIntensity', 'fresnelInvert', 'fresnelColor',
  'scanlineAxis', 'scanlineDensity', 'scanlineThickness', 'scanlineSoftness',
  'scanlineIntensity', 'scanlineSpeed', 'scanlineDistortion', 'scanlinePhase',
  'warpAmount', 'warpScale', 'warpSpeed', 'warpSeed',
  'glitchAmount', 'glitchFrequency', 'glitchBandSize', 'glitchOffset',
  'glitchDuration', 'glitchSpeed', 'glitchSeed',
  'fragmentScale', 'fragmentDensity', 'fragmentThreshold', 'fragmentSeed', 'fragmentSpeed',
  'chromaStrength', 'chromaEdgeBias', 'chromaCyan', 'chromaMagenta',
  'pulseSpeed', 'pulseAmount', 'pulsePhase', 'pulseSharpness',
  'surfaceTransmission', 'parallaxDepth', 'parallaxSteps',
  'interiorLayers', 'interiorDepth', 'interiorGlow',
  'blendMode', 'blendDepth',
  'vectorX', 'vectorY', 'vectorZ', 'outputEnabled', 'outputBlend',
]);

function sanitizeControlRange(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const first = Number(value[0]);
  const second = Number(value[1]);
  return Number.isFinite(first) && Number.isFinite(second) && first !== second
    ? [first, second]
    : undefined;
}

function sanitizeGraphControls(
  value: unknown,
  nodeIds: ReadonlySet<string>,
): MaterialGraphControl[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const controls: MaterialGraphControl[] = [];
  const seenIds = new Set<string>();
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || seenIds.has(entry.id)) continue;
    if (typeof entry.parameterKey !== 'string' || typeof entry.label !== 'string') continue;
    if (!Array.isArray(entry.targets)) continue;
    const targets: MaterialGraphControlTarget[] = [];
    for (const rawTarget of entry.targets) {
      if (!isPlainObject(rawTarget) || typeof rawTarget.nodeId !== 'string' || !nodeIds.has(rawTarget.nodeId)) continue;
      if (typeof rawTarget.setting !== 'string' || !MATERIAL_GRAPH_SETTING_KEYS.has(rawTarget.setting as keyof MaterialGraphNodeSettings)) continue;
      const parameterComponent = rawTarget.parameterComponent;
      targets.push({
        nodeId: rawTarget.nodeId,
        setting: rawTarget.setting as keyof MaterialGraphNodeSettings,
        parameterComponent:
          parameterComponent === 0 || parameterComponent === 1 || parameterComponent === 2 || parameterComponent === 3
            ? parameterComponent
            : undefined,
        inputRange: sanitizeControlRange(rawTarget.inputRange),
        outputRange: sanitizeControlRange(rawTarget.outputRange),
        curve:
          rawTarget.curve === 'ease-in' || rawTarget.curve === 'ease-out' || rawTarget.curve === 'smoothstep'
            ? rawTarget.curve
            : 'linear',
        clamp: rawTarget.clamp !== false,
      });
    }
    seenIds.add(entry.id);
    controls.push({
      id: entry.id,
      parameterKey: entry.parameterKey,
      label: entry.label.trim() || formatControlLabel(entry.parameterKey),
      placement: entry.placement === 'advanced' ? 'advanced' : 'essential',
      group: typeof entry.group === 'string' && entry.group.trim() ? entry.group.trim() : 'surface',
      targets,
      variation: isPlainObject(entry.variation)
        ? {
            enabled: entry.variation.enabled !== false,
            weight: typeof entry.variation.weight === 'number' && Number.isFinite(entry.variation.weight)
              ? clamp(entry.variation.weight, 0, 1)
              : 0.5,
          }
        : undefined,
    });
  }
  return controls.length > 0 ? controls : undefined;
}

function createsCycle(
  edges: readonly MaterialGraphEdge[],
  fromNode: string,
  toNode: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const item of edges) {
    const targets = adjacency.get(item.fromNode);
    if (targets) targets.push(item.toNode);
    else adjacency.set(item.fromNode, [item.toNode]);
  }
  const pending = [toNode];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === fromNode) return true;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

/** Validates and normalizes an unknown graph payload for a material kind. */
export function sanitizeMaterialGraph(
  raw: unknown,
  kind: MaterialKind,
): MaterialGraphDocument | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    return null;
  }

  const allowedTypes = new Set(MATERIAL_GRAPH_NODE_TYPES_BY_KIND[kind]);
  const seenNodeIds = new Set<string>();
  const nodes: MaterialGraphNode[] = [];

  for (const entry of raw.nodes) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || seenNodeIds.has(entry.id)) continue;
    if (typeof entry.type !== 'string' || !allowedTypes.has(entry.type as MaterialGraphNodeType)) continue;
    if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) continue;
    const type = entry.type as MaterialGraphNodeType;
    const declared = MATERIAL_GRAPH_PORTS_BY_TYPE[type];
    const ports = sanitizePorts(declared, entry.inputs, entry.outputs);
    seenNodeIds.add(entry.id);
    nodes.push({
      id: entry.id,
      type,
      x: clamp(entry.x as number, -WORLD_COORDINATE_LIMIT, WORLD_COORDINATE_LIMIT),
      y: clamp(entry.y as number, -WORLD_COORDINATE_LIMIT, WORLD_COORDINATE_LIMIT),
      inputs: ports.inputs,
      outputs: ports.outputs,
      settings: sanitizeNodeSettings(entry.settings),
    });
  }

  if (nodes.length === 0) return null;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: MaterialGraphEdge[] = [];
  for (const item of raw.edges) {
    if (!isPlainObject(item)) continue;
    if (
      typeof item.fromNode !== 'string' ||
      typeof item.toNode !== 'string' ||
      typeof item.fromPort !== 'string' ||
      typeof item.toPort !== 'string'
    ) {
      continue;
    }
    const fromNode = nodeById.get(item.fromNode);
    const toNode = nodeById.get(item.toNode);
    if (!fromNode || !toNode || fromNode.id === toNode.id) continue;
    const fromPort = fromNode.outputs.find((port) => port.id === item.fromPort);
    const toPort = toNode.inputs.find((port) => port.id === item.toPort);
    if (!fromPort || !toPort || fromPort.tone !== toPort.tone) continue;
    if (edges.some((edgeItem) => edgeItem.toNode === toNode.id && edgeItem.toPort === toPort.id)) continue;
    if (createsCycle(edges, fromNode.id, toNode.id)) continue;
    edges.push({
      id:
        typeof item.id === 'string' && item.id.length > 0
          ? item.id
          : `${fromNode.id}:${fromPort.id}->${toNode.id}:${toPort.id}`,
      fromNode: fromNode.id,
      fromPort: fromPort.id,
      toNode: toNode.id,
      toPort: toPort.id,
      tone: fromPort.tone,
    });
  }

  const seenFrameIds = new Set<string>();
  const frames: MaterialGraphFrame[] = [];
  if (Array.isArray(raw.frames)) {
    for (const frame of raw.frames) {
      if (!isPlainObject(frame) || typeof frame.id !== 'string' || seenFrameIds.has(frame.id)) continue;
      if (typeof frame.label !== 'string' || !Number.isFinite(frame.x) || !Number.isFinite(frame.y)) continue;
      if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height)) continue;
      seenFrameIds.add(frame.id);
      frames.push({
        id: frame.id,
        label: frame.label.trim() || 'Untitled group',
        x: clamp(frame.x as number, -WORLD_COORDINATE_LIMIT, WORLD_COORDINATE_LIMIT),
        y: clamp(frame.y as number, -WORLD_COORDINATE_LIMIT, WORLD_COORDINATE_LIMIT),
        width: clamp(frame.width as number, 14, WORLD_COORDINATE_LIMIT),
        height: clamp(frame.height as number, 16, WORLD_COORDINATE_LIMIT),
        tone: frame.tone === 'violet' || frame.tone === 'gold' ? frame.tone : 'cyan',
      });
    }
  }

  const recipe = sanitizeMaterialRecipeInterface(raw.recipe, (value) =>
    sanitizeGraphControls(value, seenNodeIds),
  );

  return {
    version: MATERIAL_GRAPH_VERSION,
    nodes,
    edges,
    frames,
    controls: sanitizeGraphControls(raw.controls, seenNodeIds),
    ...(recipe ? { recipe } : {}),
  };
}

/** Reads the canonical graph from a material document, if present and valid. */
export function readMaterialGraph(
  document: PrismorphicMaterialDocument,
): MaterialGraphDocument | null {
  const extension = document.extensions?.[MATERIAL_GRAPH_EXTENSION_KEY];
  const graph = sanitizeMaterialGraph(extension, document.kind);
  return graph ? ensureMaterialGraphControls(document, graph) : null;
}

/** Returns the document graph or a kind-specific default. */
export function resolveMaterialGraph(
  document: PrismorphicMaterialDocument,
): MaterialGraphDocument {
  return readMaterialGraph(document) ?? createDefaultMaterialGraph(document);
}

function hasInputConnection(
  graph: MaterialGraphDocument,
  toType: MaterialGraphNodeType,
  toPort: string,
  fromType?: MaterialGraphNodeType,
): boolean {
  const targets = graph.nodes.filter((node) => node.type === toType);
  if (targets.length === 0) return false;
  return graph.edges.some((item) => {
    if (item.toPort !== toPort) return false;
    const toNode = targets.find((node) => node.id === item.toNode);
    if (!toNode) return false;
    if (!fromType) return true;
    const fromNode = graph.nodes.find((node) => node.id === item.fromNode);
    return fromNode?.type === fromType;
  });
}

function findNode(
  graph: MaterialGraphDocument,
  type: MaterialGraphNodeType,
): MaterialGraphNode | undefined {
  return graph.nodes.find((node) => node.type === type);
}

function portKey(nodeId: string, portId: string): string {
  return `${nodeId}:${portId}`;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function parseHexColor(hex: string | undefined, fallback: MaterialGraphColorValue): MaterialGraphColorValue {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return [...fallback] as MaterialGraphColorValue;
  const raw = Number.parseInt(hex.slice(1), 16);
  return [((raw >> 16) & 255) / 255, ((raw >> 8) & 255) / 255, (raw & 255) / 255, 1];
}

function mixColors(
  a: MaterialGraphColorValue,
  b: MaterialGraphColorValue,
  factor: number,
): MaterialGraphColorValue {
  const t = clamp01(factor);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

function applyMathOperation(
  operation: MaterialGraphMathOperation | undefined,
  a: number,
  b: number,
): number {
  switch (operation ?? 'Add') {
    case 'Subtract':
      return a - b;
    case 'Multiply':
      return a * b;
    case 'Divide':
      return Math.abs(b) < 1e-8 ? 0 : a / b;
    case 'Power':
      return Math.pow(Math.max(0, a), b);
    case 'Minimum':
      return Math.min(a, b);
    case 'Maximum':
      return Math.max(a, b);
    case 'Add':
    default:
      return a + b;
  }
}

function mapRangeValue(
  value: number,
  settings: MaterialGraphNodeSettings | undefined,
): number {
  const fromMin = settings?.mapFromMin ?? 0;
  const fromMax = settings?.mapFromMax ?? 1;
  const toMin = settings?.mapToMin ?? 0;
  const toMax = settings?.mapToMax ?? 1;
  const span = fromMax - fromMin;
  const normalized = Math.abs(span) < 1e-8 ? 0 : (value - fromMin) / span;
  const mapped = toMin + normalized * (toMax - toMin);
  return settings?.mapClamp === false ? mapped : clamp(mapped, Math.min(toMin, toMax), Math.max(toMin, toMax));
}

/** Samples Time node scalar outputs for an elapsed clock value. */
export function sampleTimeOutputs(
  elapsedSeconds: number,
  settings: Pick<MaterialGraphNodeSettings, 'timeSpeed' | 'timeOffset'> | undefined,
): { time: number; sin: number; cos: number } {
  const speed = settings?.timeSpeed ?? 1;
  const offset = settings?.timeOffset ?? 0;
  const time = elapsedSeconds * speed + offset;
  return {
    time,
    sin: Math.sin(time),
    cos: Math.cos(time),
  };
}

/** Deterministic hash in [0, 1) for procedural sampling. */
export function hash2D(x: number, y: number, seed = 0): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Samples a wave factor at UV coordinates using node settings. */
export function sampleWaveFactor(
  u: number,
  v: number,
  settings: Pick<MaterialGraphNodeSettings, 'waveType' | 'waveScale' | 'waveDistortion'> | undefined,
): number {
  const scale = settings?.waveScale ?? 5;
  const distortion = settings?.waveDistortion ?? 0.25;
  const phase = u * scale + v * scale * distortion;
  const wrapped = ((phase % 1) + 1) % 1;
  switch (settings?.waveType ?? 'Sine') {
    case 'Saw':
      return wrapped;
    case 'Triangle':
      return wrapped < 0.5 ? wrapped * 2 : 2 - wrapped * 2;
    case 'Sine':
    default:
      return 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  }
}

function smoothstep01(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Samples fine anti-aliased scanlines along the configured axis.
 * `elapsedSeconds` scrolls the pattern; distortion warps the scan axis using
 * a low-frequency function of the other axes. Output is in [0, intensity].
 */
export function sampleScanlines(
  vector: MaterialGraphVectorValue,
  elapsedSeconds: number,
  settings:
    | Pick<
        MaterialGraphNodeSettings,
        | 'scanlineAxis'
        | 'scanlineDensity'
        | 'scanlineThickness'
        | 'scanlineSoftness'
        | 'scanlineIntensity'
        | 'scanlineSpeed'
        | 'scanlineDistortion'
        | 'scanlinePhase'
      >
    | undefined,
): number {
  const axis = settings?.scanlineAxis ?? 'Y';
  const density = settings?.scanlineDensity ?? 96;
  const thickness = clamp(settings?.scanlineThickness ?? 0.22, 0.01, 0.95);
  const softness = Math.max(1e-4, settings?.scanlineSoftness ?? 0.08);
  const intensity = settings?.scanlineIntensity ?? 1;
  const speed = settings?.scanlineSpeed ?? 0.35;
  const distortion = settings?.scanlineDistortion ?? 0.35;
  const phase = settings?.scanlinePhase ?? 0;
  const coord = axis === 'X' ? vector[0] : axis === 'Z' ? vector[2] : vector[1];
  const other1 = axis === 'X' ? vector[1] : vector[0];
  const other2 = axis === 'Z' ? vector[1] : vector[2];
  const warp =
    distortion *
    0.02 *
    (Math.sin(other1 * Math.PI * 2 * 1.7 + elapsedSeconds * 0.6) +
      0.5 * Math.sin(other2 * Math.PI * 2 * 2.3 - elapsedSeconds * 0.4));
  const scroll = elapsedSeconds * speed + phase;
  const p = (coord + warp) * density + scroll;
  const f = p - Math.floor(p);
  const d = Math.abs(f - 0.5);
  const half = thickness * 0.5;
  const line = 1 - smoothstep01(half, half + softness, d);
  return clamp01(line) * intensity;
}

/**
 * Offsets an input vector by an animated value-noise field (domain warp).
 * Reuses the shared value-noise helper so GLSL and CPU stay conceptually aligned.
 */
export function sampleDomainWarp(
  vector: MaterialGraphVectorValue,
  elapsedSeconds: number,
  settings:
    | Pick<MaterialGraphNodeSettings, 'warpAmount' | 'warpScale' | 'warpSpeed' | 'warpSeed'>
    | undefined,
): MaterialGraphVectorValue {
  const amount = settings?.warpAmount ?? 0.35;
  const scale = settings?.warpScale ?? 2;
  const speed = settings?.warpSpeed ?? 0.15;
  const seed = settings?.warpSeed ?? 0;
  const [x, y, z] = vector;
  const t = elapsedSeconds * speed;
  const ox = (smoothNoise3D((x + t) * scale, y * scale, z * scale, seed + 11) - 0.5) * 2 * amount;
  const oy = (smoothNoise3D(x * scale, (y + t) * scale, z * scale, seed + 47) - 0.5) * 2 * amount;
  const oz = (smoothNoise3D(x * scale, y * scale, (z + t) * scale, seed + 91) - 0.5) * 2 * amount;
  return [x + ox, y + oy, z + oz];
}

/**
 * Samples rare, elegant horizontal band glitches. Bands stay stable inside a
 * short time window derived from floor(time * speed). Returns a 0..1 mask and a
 * signed horizontal offset amount.
 */
export function sampleGlitchBands(
  vector: MaterialGraphVectorValue,
  elapsedSeconds: number,
  settings:
    | Pick<
        MaterialGraphNodeSettings,
        | 'glitchAmount'
        | 'glitchFrequency'
        | 'glitchBandSize'
        | 'glitchOffset'
        | 'glitchDuration'
        | 'glitchSpeed'
        | 'glitchSeed'
      >
    | undefined,
): { factor: number; offset: number } {
  const amount = settings?.glitchAmount ?? 0.18;
  const frequency = settings?.glitchFrequency ?? 14;
  const bandSize = settings?.glitchBandSize ?? 0.08;
  const offsetAmount = settings?.glitchOffset ?? 0.12;
  const duration = Math.max(1e-4, settings?.glitchDuration ?? 0.22);
  const speed = settings?.glitchSpeed ?? 0.55;
  const seed = settings?.glitchSeed ?? 17;
  const row = vector[1] * frequency;
  const band = Math.floor(row);
  const local = row - band;
  const window = Math.floor(elapsedSeconds * speed);
  const windowPhase = elapsedSeconds * speed - window;
  const r = hash2D(band + 0.5, window + 0.5, seed);
  const r2 = hash2D(band + 3.7, window + 1.3, seed + 19);
  const activeBand = r < amount ? 1 : 0;
  const temporal = 1 - smoothstep01(0, duration, windowPhase);
  const strip = Math.abs(local - r2) < bandSize * 0.5 ? 1 : 0;
  const mask = activeBand * temporal * strip;
  return { factor: mask, offset: mask * offsetAmount * (r2 * 2 - 1) };
}

/**
 * Samples sparse digital fragments via hash thresholding on a grid, with a
 * slight temporal flicker derived from floor(time * speed).
 */
export function sampleDigitalFragments(
  vector: MaterialGraphVectorValue,
  elapsedSeconds: number,
  settings:
    | Pick<
        MaterialGraphNodeSettings,
        'fragmentScale' | 'fragmentDensity' | 'fragmentThreshold' | 'fragmentSeed' | 'fragmentSpeed'
      >
    | undefined,
): number {
  const scale = settings?.fragmentScale ?? 64;
  const density = settings?.fragmentDensity ?? 0.22;
  const threshold = settings?.fragmentThreshold ?? 0.82;
  const seed = settings?.fragmentSeed ?? 31;
  const speed = settings?.fragmentSpeed ?? 0.2;
  const cellX = Math.floor(vector[0] * scale);
  const cellY = Math.floor(vector[1] * scale);
  const base = hash2D(cellX, cellY, seed);
  const window = Math.floor(elapsedSeconds * speed);
  const flicker = hash2D(cellX + 1.3, cellY + 2.7, seed + window * 7 + 3);
  const present = base < density ? 1 : 0;
  const visible = flicker > threshold ? 1 : 0;
  return present * visible;
}

/**
 * Non-uniform slow pulse envelope in [0, 1] suitable for emission modulation.
 * `mix(1-amount, 1, pow(0.5+0.5*sin(time*speed+phase), sharpness))` then clamped.
 */
export function samplePulse(
  elapsedSeconds: number,
  settings:
    | Pick<MaterialGraphNodeSettings, 'pulseSpeed' | 'pulseAmount' | 'pulsePhase' | 'pulseSharpness'>
    | undefined,
): number {
  const speed = settings?.pulseSpeed ?? 0.45;
  const amount = settings?.pulseAmount ?? 0.35;
  const phase = settings?.pulsePhase ?? 0;
  const sharpness = Math.max(1e-4, settings?.pulseSharpness ?? 1.5);
  const s = 0.5 + 0.5 * Math.sin(elapsedSeconds * speed + phase);
  const shaped = Math.pow(clamp01(s), sharpness);
  return clamp01((1 - amount) + amount * shaped);
}

/** Samples voronoi distance/color at UV coordinates using node settings. */
export function sampleVoronoi(
  u: number,
  v: number,
  settings: Pick<MaterialGraphNodeSettings, 'voronoiScale' | 'voronoiRandomness'> | undefined,
): { distance: number; color: MaterialGraphColorValue } {
  const scale = settings?.voronoiScale ?? 4;
  const randomness = settings?.voronoiRandomness ?? 0.75;
  const gx = u * scale;
  const gy = v * scale;
  const cellX = Math.floor(gx);
  const cellY = Math.floor(gy);
  let best = Number.POSITIVE_INFINITY;
  let bestColor: MaterialGraphColorValue = [0.5, 0.5, 0.5, 1];
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const cx = cellX + ox;
      const cy = cellY + oy;
      const jitterX = (hash2D(cx, cy, 1) - 0.5) * randomness;
      const jitterY = (hash2D(cx, cy, 2) - 0.5) * randomness;
      const px = cx + 0.5 + jitterX;
      const py = cy + 0.5 + jitterY;
      const dx = gx - px;
      const dy = gy - py;
      const distance = Math.hypot(dx, dy);
      if (distance < best) {
        best = distance;
        bestColor = [hash2D(cx, cy, 3), hash2D(cx, cy, 4), hash2D(cx, cy, 5), 1];
      }
    }
  }
  return { distance: clamp01(best), color: bestColor };
}

function smoothNoise3D(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const hash = (ox: number, oy: number, oz: number): number =>
    hash2D(ix + ox + (iz + oz) * 37.17, iy + oy + (iz + oz) * 11.73, seed);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const x00 = lerp(hash(0, 0, 0), hash(1, 0, 0), sx);
  const x10 = lerp(hash(0, 1, 0), hash(1, 1, 0), sx);
  const x01 = lerp(hash(0, 0, 1), hash(1, 0, 1), sx);
  const x11 = lerp(hash(0, 1, 1), hash(1, 1, 1), sx);
  return lerp(lerp(x00, x10, sy), lerp(x01, x11, sy), sz);
}

function sampleNoiseFactor(
  x: number,
  y: number,
  z: number,
  settings: MaterialGraphNodeSettings | undefined,
): number {
  let px = x;
  let py = y;
  let pz = z;
  const seed = settings?.noiseSeed ?? 0;
  const warp = settings?.noiseWarp ?? 0;
  if (warp > 0) {
    px += (smoothNoise3D(x * 0.55, y * 0.55, z * 0.55, seed + 19) - 0.5) * warp;
    py += (smoothNoise3D(x * 0.55 + 17, y * 0.55, z * 0.55, seed + 41) - 0.5) * warp;
    pz += (smoothNoise3D(x * 0.55, y * 0.55 + 29, z * 0.55, seed + 73) - 0.5) * warp;
  }
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  const octaves = Math.max(1, Math.min(8, Math.round(settings?.noiseDetail ?? 4)));
  const lacunarity = settings?.noiseLacunarity ?? 2;
  const gain = settings?.noiseGain ?? 0.5;
  const mode = settings?.noiseMode ?? 'FBM';
  for (let i = 0; i < octaves; i += 1) {
    const raw = smoothNoise3D(px * frequency, py * frequency, pz * frequency, seed + i * 13);
    const sample = mode === 'Ridged'
      ? (1 - Math.abs(raw * 2 - 1)) ** 2
      : mode === 'Turbulence'
        ? Math.abs(raw * 2 - 1)
        : raw;
    total += sample * amplitude;
    weight += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return weight > 0 ? clamp01(total / weight) : 0.5;
}

function collectReachableNodeIds(graph: MaterialGraphDocument): Set<string> {
  const output = graph.nodes.find((node) => node.type === 'material-output');
  if (!output) return new Set();
  const incoming = new Map<string, string[]>();
  for (const item of graph.edges) {
    const list = incoming.get(item.toNode);
    if (list) list.push(item.fromNode);
    else incoming.set(item.toNode, [item.fromNode]);
  }
  const reachable = new Set<string>();
  const stack = [output.id];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const from of incoming.get(current) ?? []) stack.push(from);
  }
  return reachable;
}

function topologicalOrder(
  graph: MaterialGraphDocument,
  reachable: Set<string>,
): MaterialGraphNode[] {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of reachable) indegree.set(id, 0);
  for (const item of graph.edges) {
    if (!reachable.has(item.fromNode) || !reachable.has(item.toNode)) continue;
    adjacency.set(item.fromNode, [...(adjacency.get(item.fromNode) ?? []), item.toNode]);
    indegree.set(item.toNode, (indegree.get(item.toNode) ?? 0) + 1);
  }
  const queue = [...reachable].filter((id) => (indegree.get(id) ?? 0) === 0);
  const ordered: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    ordered.push(current);
    for (const next of adjacency.get(current) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return ordered
    .map((id) => nodeById.get(id))
    .filter((node): node is MaterialGraphNode => Boolean(node));
}

function readInputValue(
  graph: MaterialGraphDocument,
  ports: Record<string, MaterialGraphPortValue>,
  nodeId: string,
  portId: string,
): MaterialGraphPortValue | undefined {
  const edge = graph.edges.find((item) => item.toNode === nodeId && item.toPort === portId);
  if (!edge) return undefined;
  return ports[portKey(edge.fromNode, edge.fromPort)];
}

function asScalar(value: MaterialGraphPortValue | undefined, fallback: number): number {
  if (!value) return fallback;
  if (value.kind === 'scalar') return value.value;
  if (value.kind === 'color') {
    return (value.value[0] + value.value[1] + value.value[2]) / 3;
  }
  if (value.kind === 'vector') {
    return (value.value[0] + value.value[1] + value.value[2]) / 3;
  }
  return fallback;
}

function asColor(
  value: MaterialGraphPortValue | undefined,
  fallback: MaterialGraphColorValue,
): MaterialGraphColorValue {
  if (!value) return [...fallback] as MaterialGraphColorValue;
  if (value.kind === 'color') return [...value.value] as MaterialGraphColorValue;
  if (value.kind === 'scalar') {
    const s = clamp01(value.value);
    return [s, s, s, 1];
  }
  if (value.kind === 'vector') {
    return [clamp01(value.value[0]), clamp01(value.value[1]), clamp01(value.value[2]), 1];
  }
  return [...fallback] as MaterialGraphColorValue;
}

function asVector(
  value: MaterialGraphPortValue | undefined,
  fallback: MaterialGraphVectorValue,
): MaterialGraphVectorValue {
  if (!value) return [...fallback] as MaterialGraphVectorValue;
  if (value.kind === 'vector') return [...value.value] as MaterialGraphVectorValue;
  if (value.kind === 'scalar') return [value.value, value.value, value.value];
  if (value.kind === 'color') return [value.value[0], value.value[1], value.value[2]];
  return [...fallback] as MaterialGraphVectorValue;
}

/**
 * Effective mask of a surface-blend, per §4.2. `field` is the single scalar the
 * node receives on its Mask port: the host noise for `over`/`inside`, the host
 * pattern for `cavity`/`veins`, the host Fresnel for `edge`. Unwired it reads 1,
 * which makes the blend follow the amount alone.
 */
function surfaceBlendMask(
  mode: MaterialRecipeSlotMode,
  field: number,
  amount: number,
  hostTransmission: number,
): number {
  const constants = MATERIAL_GRAPH_SURFACE_BLEND_CONSTANTS;
  const edge0 = 1 - amount * constants.coverageGain;
  const coverage = smoothstep01(edge0, edge0 + constants.coverageSoftness, field);
  switch (mode) {
    case 'inside':
      return clamp01(
        coverage *
          (constants.insideTransmissionFloor +
            constants.insideTransmissionSpan * clamp01(hostTransmission)),
      );
    case 'cavity':
      return clamp01(coverage * field);
    case 'veins':
      return clamp01(clamp01(field * constants.veinsGain) * amount);
    case 'edge':
      return clamp01(field * constants.edgeFresnelGain * amount + coverage * constants.edgeCoverage);
    case 'over':
    default:
      return coverage;
  }
}

function addEmission(
  host: MaterialGraphColorValue,
  guest: MaterialGraphColorValue,
  scale: number,
): MaterialGraphColorValue {
  return [
    host[0] + guest[0] * scale,
    host[1] + guest[1] * scale,
    host[2] + guest[2] * scale,
    host[3],
  ];
}

/**
 * CPU mirror of the surface-blend operators (§4.2). The host keeps its body,
 * the guest lends its skin: `inside` leaves the host reflection and relief
 * untouched, `edge` leaves its normal alone, the other modes mix every channel.
 * `blendDepth` only offsets the guest coordinates, which has no meaning outside
 * the shader, so it is ignored here.
 */
function blendSurfaceValues(
  host: MaterialGraphSurfaceValue,
  guest: MaterialGraphSurfaceValue,
  mode: MaterialRecipeSlotMode,
  field: number,
  amount: number,
): MaterialGraphSurfaceValue {
  const constants = MATERIAL_GRAPH_SURFACE_BLEND_CONSTANTS;
  const m = surfaceBlendMask(mode, field, amount, host.transmission);

  if (mode === 'inside') {
    const inclusion = host.tint.map((channel, index) =>
      index === 3
        ? guest.baseColor[3]
        : (guest.baseColor[index] ?? 0) *
          constants.insideGuestAlbedo *
          (1 + (channel - 1) * constants.insideHostTint),
    ) as MaterialGraphColorValue;
    const baseColor = mixColors(host.baseColor, inclusion, m);
    return {
      baseColor,
      // The host keeps its reflection and its relief; only the volume changes.
      metallic: host.metallic,
      roughness: host.roughness,
      transmission: host.transmission * (1 - m * (1 - constants.insideTransmissionDrop)),
      tint: mixColors(host.tint, inclusion, m),
      emission: addEmission(host.emission, guest.emission, m * constants.insideEmission),
      opacity: host.opacity,
      normal: [...host.normal] as MaterialGraphVectorValue,
      displacement: host.displacement,
    };
  }

  const keepHostRelief = mode === 'edge';
  return {
    baseColor: mixColors(host.baseColor, guest.baseColor, m),
    metallic: host.metallic + (guest.metallic - host.metallic) * m,
    roughness: host.roughness + (guest.roughness - host.roughness) * m,
    transmission: host.transmission + (guest.transmission - host.transmission) * m,
    tint: mixColors(host.tint, guest.tint, m),
    emission: addEmission(host.emission, guest.emission, m),
    opacity: host.opacity + (guest.opacity - host.opacity) * m,
    normal: keepHostRelief
      ? ([...host.normal] as MaterialGraphVectorValue)
      : ([
          host.normal[0] + (guest.normal[0] - host.normal[0]) * m,
          host.normal[1] + (guest.normal[1] - host.normal[1]) * m,
          host.normal[2] + (guest.normal[2] - host.normal[2]) * m,
        ] as MaterialGraphVectorValue),
    displacement: keepHostRelief
      ? host.displacement
      : host.displacement + (guest.displacement - host.displacement) * m,
  };
}

function defaultSurface(): MaterialGraphSurfaceValue {
  return {
    baseColor: [0.82, 0.84, 0.88, 1],
    metallic: 0,
    roughness: 0.5,
    transmission: 0.55,
    tint: [0.82, 0.84, 0.88, 1],
    emission: [0, 0, 0, 1],
    opacity: 1,
    normal: [0, 0, 1],
    displacement: 0,
  };
}

function evaluateNodeOutputs(
  graph: MaterialGraphDocument,
  node: MaterialGraphNode,
  ports: Record<string, MaterialGraphPortValue>,
  uv: MaterialGraphVectorValue = [0.5, 0.5, 0],
  elapsedSeconds = 0,
): void {
  const settings = node.settings;
  const defaultUv: MaterialGraphVectorValue = [uv[0], uv[1], uv[2]];
  switch (node.type) {
    case 'value': {
      ports[portKey(node.id, 'value')] = {
        kind: 'scalar',
        value: settings?.scalarValue ?? 0.5,
      };
      return;
    }
    case 'rgb': {
      ports[portKey(node.id, 'color')] = {
        kind: 'color',
        value: parseHexColor(settings?.rgbColor, [0.2, 0.55, 0.95, 1]),
      };
      return;
    }
    case 'time': {
      const sampled = sampleTimeOutputs(elapsedSeconds, settings);
      ports[portKey(node.id, 'time')] = { kind: 'scalar', value: sampled.time };
      ports[portKey(node.id, 'sin')] = { kind: 'scalar', value: sampled.sin };
      ports[portKey(node.id, 'cos')] = { kind: 'scalar', value: sampled.cos };
      return;
    }
    case 'base-color': {
      ports[portKey(node.id, 'color')] = {
        kind: 'color',
        value: parseHexColor(settings?.rgbColor, [0.82, 0.84, 0.88, 1]),
      };
      return;
    }
    case 'metallic':
    case 'roughness': {
      ports[portKey(node.id, 'value')] = {
        kind: 'scalar',
        value: settings?.scalarValue ?? (node.type === 'metallic' ? 0 : 0.5),
      };
      return;
    }
    case 'emission': {
      ports[portKey(node.id, 'color')] = {
        kind: 'color',
        value: parseHexColor(settings?.rgbColor, [0, 0, 0, 1]),
      };
      return;
    }
    case 'opacity': {
      ports[portKey(node.id, 'value')] = {
        kind: 'scalar',
        value: clamp01(settings?.scalarValue ?? 1),
      };
      return;
    }
    case 'normal': {
      ports[portKey(node.id, 'vector')] = {
        kind: 'vector',
        value: [
          settings?.vectorX ?? 0,
          settings?.vectorY ?? 0,
          settings?.vectorZ ?? 1,
        ],
      };
      return;
    }
    case 'displacement': {
      ports[portKey(node.id, 'value')] = {
        kind: 'scalar',
        value: clamp(settings?.scalarValue ?? 0, 0, 1),
      };
      return;
    }
    case 'texture-coordinate': {
      ports[portKey(node.id, 'uv')] = { kind: 'vector', value: [...defaultUv] as MaterialGraphVectorValue };
      return;
    }
    case 'mapping': {
      const input = asVector(readInputValue(graph, ports, node.id, 'vector'), defaultUv);
      ports[portKey(node.id, 'vector')] = {
        kind: 'vector',
        value: [
          input[0] * (settings?.mappingX ?? 1),
          input[1] * (settings?.mappingY ?? 1),
          input[2] + (settings?.mappingZ ?? 0),
        ],
      };
      return;
    }
    case 'noise-texture': {
      const vector = asVector(readInputValue(graph, ports, node.id, 'vector'), defaultUv);
      const scale = settings?.noiseScale ?? 1;
      ports[portKey(node.id, 'factor')] = {
        kind: 'scalar',
        value: sampleNoiseFactor(
          vector[0] * scale,
          vector[1] * scale,
          vector[2] * scale,
          settings,
        ),
      };
      return;
    }
    case 'wave-texture': {
      const vector = asVector(readInputValue(graph, ports, node.id, 'vector'), defaultUv);
      ports[portKey(node.id, 'factor')] = {
        kind: 'scalar',
        value: sampleWaveFactor(vector[0], vector[1], settings),
      };
      return;
    }
    case 'voronoi-texture': {
      const vector = asVector(readInputValue(graph, ports, node.id, 'vector'), defaultUv);
      const sample = sampleVoronoi(vector[0], vector[1], settings);
      ports[portKey(node.id, 'distance')] = { kind: 'scalar', value: sample.distance };
      ports[portKey(node.id, 'color')] = { kind: 'color', value: sample.color };
      return;
    }
    case 'color-ramp': {
      const factor = asScalar(readInputValue(graph, ports, node.id, 'factor'), 0.5);
      const start = parseHexColor(settings?.rampStart, [0.05, 0.08, 0.16, 1]);
      const end = parseHexColor(settings?.rampEnd, [0.55, 0.95, 1, 1]);
      const mid = settings?.rampMidpoint ?? 0.5;
      // Mirrors the GLSL: the midpoint applies first, then the shape.
      let t = clamp01(factor);
      t = t < mid ? (t / Math.max(mid, 1e-8)) * 0.5 : 0.5 + ((t - mid) / Math.max(1e-8, 1 - mid)) * 0.5;
      if (settings?.rampInterpolation === 'Ease') {
        t = t * t * (3 - 2 * t);
      } else if (settings?.rampInterpolation === 'Constant') {
        t = t < 0.5 ? 0 : 1;
      }
      ports[portKey(node.id, 'color')] = { kind: 'color', value: mixColors(start, end, t) };
      return;
    }
    case 'math': {
      const a = asScalar(readInputValue(graph, ports, node.id, 'a'), 0);
      const b = asScalar(readInputValue(graph, ports, node.id, 'b'), 0);
      ports[portKey(node.id, 'value')] = {
        kind: 'scalar',
        value: applyMathOperation(settings?.mathOperation, a, b),
      };
      return;
    }
    case 'mix': {
      const a = asColor(readInputValue(graph, ports, node.id, 'a'), [0, 0, 0, 1]);
      const b = asColor(readInputValue(graph, ports, node.id, 'b'), [1, 1, 1, 1]);
      const factor = asScalar(readInputValue(graph, ports, node.id, 'factor'), settings?.mixFactor ?? 0.5);
      ports[portKey(node.id, 'color')] = { kind: 'color', value: mixColors(a, b, factor) };
      return;
    }
    case 'map-range': {
      const value = asScalar(readInputValue(graph, ports, node.id, 'value'), 0);
      ports[portKey(node.id, 'value')] = {
        kind: 'scalar',
        value: mapRangeValue(value, settings),
      };
      return;
    }
    case 'invert': {
      const factor = asScalar(readInputValue(graph, ports, node.id, 'factor'), 0);
      ports[portKey(node.id, 'factor')] = { kind: 'scalar', value: 1 - factor };
      return;
    }
    case 'fresnel': {
      const ior = clamp(settings?.fresnelIor ?? 1.45, 1, 2.5);
      const power = clamp(settings?.fresnelPower ?? 5, 0.25, 12);
      const authoredBias = clamp01(settings?.fresnelBias ?? 0.02);
      const intensity = clamp(settings?.fresnelIntensity ?? 1, 0, 8);
      const invert = settings?.fresnelInvert ?? false;
      const physicalF0 = ((ior - 1) / (ior + 1)) ** 2;
      const nx = (defaultUv[0] - 0.5) * 2;
      const ny = (defaultUv[1] - 0.5) * 2;
      const radial = clamp01(Math.hypot(nx, ny));
      const facing = Math.sqrt(Math.max(0, 1 - radial * radial));
      const bias = Math.max(authoredBias, physicalF0);
      let rim = clamp01(bias + (1 - bias) * ((1 - facing) ** power));
      if (invert) rim = 1 - rim;
      // Factor stays a bounded mask so legacy transmission wiring is unchanged.
      ports[portKey(node.id, 'factor')] = { kind: 'scalar', value: clamp01(rim) };
      const tint = parseHexColor(settings?.fresnelColor, [0.239216, 0.921569, 1, 1]);
      const scale = rim * intensity;
      ports[portKey(node.id, 'color')] = {
        kind: 'color',
        value: [
          clamp01(tint[0] * scale),
          clamp01(tint[1] * scale),
          clamp01(tint[2] * scale),
          tint[3],
        ],
      };
      return;
    }
    case 'prism-dispersion': {
      const color = asColor(readInputValue(graph, ports, node.id, 'color'), [0.55, 0.95, 1, 1]);
      const factor = asScalar(readInputValue(graph, ports, node.id, 'factor'), 0.5);
      const spectrum = settings?.prismSpectrum ?? 0.62;
      const strength = settings?.prismStrength ?? 1;
      ports[portKey(node.id, 'color')] = {
        kind: 'color',
        value: [
          clamp01(color[0] + strength * spectrum * 0.15 * factor),
          clamp01(color[1] * (1 - strength * 0.15 + strength * factor * 0.2)),
          clamp01(color[2] + strength * (1 - spectrum) * 0.1),
          color[3],
        ],
      };
      return;
    }
    case 'scanlines': {
      const vector = asVector(readInputValue(graph, ports, node.id, 'vector'), defaultUv);
      ports[portKey(node.id, 'factor')] = {
        kind: 'scalar',
        value: sampleScanlines(vector, elapsedSeconds, settings),
      };
      return;
    }
    case 'domain-warp': {
      const vector = asVector(readInputValue(graph, ports, node.id, 'vector'), defaultUv);
      ports[portKey(node.id, 'vector')] = {
        kind: 'vector',
        value: sampleDomainWarp(vector, elapsedSeconds, settings),
      };
      return;
    }
    case 'glitch-bands': {
      const vector = asVector(readInputValue(graph, ports, node.id, 'vector'), defaultUv);
      const sample = sampleGlitchBands(vector, elapsedSeconds, settings);
      ports[portKey(node.id, 'factor')] = { kind: 'scalar', value: sample.factor };
      ports[portKey(node.id, 'offset')] = { kind: 'scalar', value: sample.offset };
      ports[portKey(node.id, 'vector')] = {
        kind: 'vector',
        value: [vector[0] + sample.offset, vector[1], vector[2]],
      };
      return;
    }
    case 'digital-fragments': {
      const vector = asVector(readInputValue(graph, ports, node.id, 'vector'), defaultUv);
      ports[portKey(node.id, 'factor')] = {
        kind: 'scalar',
        value: sampleDigitalFragments(vector, elapsedSeconds, settings),
      };
      return;
    }
    case 'chromatic-split': {
      const color = asColor(readInputValue(graph, ports, node.id, 'color'), [0.55, 0.95, 1, 1]);
      const mask = clamp01(asScalar(readInputValue(graph, ports, node.id, 'factor'), 0));
      const strength = settings?.chromaStrength ?? 0.22;
      const edgeBias = settings?.chromaEdgeBias ?? 0.55;
      const cyan = parseHexColor(settings?.chromaCyan, [0.239216, 0.921569, 1, 1]);
      const magenta = parseHexColor(settings?.chromaMagenta, [0.788235, 0.447059, 1, 1]);
      const amount = clamp01(mask * strength * (0.5 + edgeBias * 0.5));
      // Split the fringe: cyan leans toward one edge, magenta toward the other.
      ports[portKey(node.id, 'color')] = {
        kind: 'color',
        value: [
          clamp01(color[0] + (cyan[0] - color[0]) * amount * 0.5 + (magenta[0] - color[0]) * amount * 0.5),
          clamp01(color[1] + (cyan[1] - color[1]) * amount * 0.5 + (magenta[1] - color[1]) * amount * 0.5),
          clamp01(color[2] + (cyan[2] - color[2]) * amount * 0.5 + (magenta[2] - color[2]) * amount * 0.5),
          color[3],
        ],
      };
      return;
    }
    case 'pulse': {
      ports[portKey(node.id, 'factor')] = {
        kind: 'scalar',
        value: samplePulse(elapsedSeconds, settings),
      };
      return;
    }
    case 'pbr-surface': {
      const surface = defaultSurface();
      surface.baseColor = asColor(readInputValue(graph, ports, node.id, 'baseColor'), surface.baseColor);
      surface.metallic = clamp01(asScalar(readInputValue(graph, ports, node.id, 'metallic'), surface.metallic));
      surface.roughness = clamp01(asScalar(readInputValue(graph, ports, node.id, 'roughness'), surface.roughness));
      surface.emission = asColor(readInputValue(graph, ports, node.id, 'emission'), surface.emission);
      surface.opacity = clamp01(asScalar(readInputValue(graph, ports, node.id, 'opacity'), surface.opacity));
      surface.normal = asVector(readInputValue(graph, ports, node.id, 'normal'), surface.normal);
      surface.displacement = clamp(
        asScalar(readInputValue(graph, ports, node.id, 'displacement'), surface.displacement),
        0,
        1,
      );
      surface.tint = [...surface.baseColor] as MaterialGraphColorValue;
      ports[portKey(node.id, 'shader')] = { kind: 'shader', value: surface };
      return;
    }
    case 'unlit-surface': {
      const surface = defaultSurface();
      surface.baseColor = asColor(readInputValue(graph, ports, node.id, 'baseColor'), surface.baseColor);
      surface.tint = [...surface.baseColor] as MaterialGraphColorValue;
      surface.metallic = 0;
      surface.roughness = 1;
      surface.transmission = 0;
      ports[portKey(node.id, 'shader')] = { kind: 'shader', value: surface };
      return;
    }
    case 'glass-surface': {
      const surface = defaultSurface();
      surface.tint = asColor(readInputValue(graph, ports, node.id, 'tint'), surface.tint);
      surface.baseColor = [...surface.tint] as MaterialGraphColorValue;
      surface.roughness = clamp01(asScalar(readInputValue(graph, ports, node.id, 'roughness'), surface.roughness));
      surface.transmission = clamp01(
        asScalar(
          readInputValue(graph, ports, node.id, 'transmission'),
          settings?.surfaceTransmission ?? surface.transmission,
        ),
      );
      surface.metallic = 0;
      ports[portKey(node.id, 'shader')] = { kind: 'shader', value: surface };
      return;
    }
    case 'surface-blend': {
      const hostValue = readInputValue(graph, ports, node.id, 'host');
      const guestValue = readInputValue(graph, ports, node.id, 'guest');
      const host = hostValue?.kind === 'shader' ? hostValue.value : null;
      const guest = guestValue?.kind === 'shader' ? guestValue.value : null;
      // A half-wired blend passes the surface it does have through, so an
      // unfinished composition still reaches the output instead of going dark.
      if (!host || !guest) {
        const single = host ?? guest;
        if (single) ports[portKey(node.id, 'shader')] = { kind: 'shader', value: { ...single } };
        return;
      }
      const amount = clamp01(asScalar(readInputValue(graph, ports, node.id, 'amount'), 1));
      const maskValue = readInputValue(graph, ports, node.id, 'mask');
      const constants = MATERIAL_GRAPH_SURFACE_BLEND_CONSTANTS;
      const field = maskValue
        ? clamp01(asScalar(maskValue, 1))
        : clamp01(
            sampleNoiseFactor(
              uv[0] * constants.defaultFieldScale,
              uv[1] * constants.defaultFieldScale,
              uv[2] * constants.defaultFieldScale,
              {
                noiseDetail: constants.defaultFieldDetail,
                noiseSeed: materialGraphBlendFieldSeed(node.id),
              },
            ),
          );
      ports[portKey(node.id, 'shader')] = {
        kind: 'shader',
        value: blendSurfaceValues(host, guest, settings?.blendMode ?? 'over', field, amount),
      };
      return;
    }
    case 'material-output':
      return;
    default:
      return;
  }
}

/**
 * Evaluates every node on a path connected to material-output at UV coordinates.
 * Texture-coordinate, mapping, noise/wave/voronoi, and converter chains are
 * sampled with the provided UV so preview textures follow real graph wiring.
 * Multiple instances of the same type are evaluated independently by node id.
 * `elapsedSeconds` drives Time nodes so animations come from the graph.
 */
export function evaluateMaterialGraphAt(
  graph: MaterialGraphDocument,
  u: number,
  v: number,
  elapsedSeconds = 0,
): MaterialGraphEvaluation {
  const reachable = collectReachableNodeIds(graph);
  const ports: Record<string, MaterialGraphPortValue> = {};
  const uv: MaterialGraphVectorValue = [u, v, 0];
  for (const node of topologicalOrder(graph, reachable)) {
    evaluateNodeOutputs(graph, node, ports, uv, elapsedSeconds);
  }

  let surface: MaterialGraphSurfaceValue | null = null;
  const output = graph.nodes.find((node) => node.type === 'material-output' && reachable.has(node.id));
  if (output) {
    const shader = readInputValue(graph, ports, output.id, 'surface');
    if (shader?.kind === 'shader') {
      surface = {
        baseColor: [...shader.value.baseColor] as MaterialGraphColorValue,
        metallic: shader.value.metallic,
        roughness: shader.value.roughness,
        transmission: shader.value.transmission,
        tint: [...shader.value.tint] as MaterialGraphColorValue,
        emission: [...(shader.value.emission ?? [0, 0, 0, 1])] as MaterialGraphColorValue,
        opacity: shader.value.opacity ?? 1,
        normal: [...(shader.value.normal ?? [0, 0, 1])] as MaterialGraphVectorValue,
        displacement: shader.value.displacement ?? 0,
      };
    }
  }

  return {
    ports,
    surface,
    reachableNodeIds: [...reachable],
  };
}

/**
 * Evaluates every node on a path connected to material-output.
 * Uses the graph center UV (0.5, 0.5) for texture sampling defaults.
 * Multiple instances of the same type are evaluated independently by node id.
 */
export function evaluateMaterialGraph(
  graph: MaterialGraphDocument,
  elapsedSeconds = 0,
): MaterialGraphEvaluation {
  return evaluateMaterialGraphAt(graph, 0.5, 0.5, elapsedSeconds);
}

/**
 * Builds an RGBA8 buffer by evaluating the full material graph at each texel UV.
 * Color comes from connected surface tint/baseColor paths (mix/math/map-range/invert included).
 * Pass `elapsedSeconds` so Time-driven graphs animate across frames.
 */
export function renderProceduralGraphTextureRGBA(
  graph: MaterialGraphDocument,
  size = 64,
  elapsedSeconds = 0,
): Uint8Array {
  const width = Math.max(1, Math.floor(size));
  const data = new Uint8Array(width * width * 4);
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / width;
      const evaluation = evaluateMaterialGraphAt(graph, u, v, elapsedSeconds);
      const color =
        evaluation.surface?.tint ??
        evaluation.surface?.baseColor ??
        ([1, 1, 1, 1] as MaterialGraphColorValue);
      const index = (y * width + x) * 4;
      data[index] = Math.round(clamp01(color[0]) * 255);
      data[index + 1] = Math.round(clamp01(color[1]) * 255);
      data[index + 2] = Math.round(clamp01(color[2]) * 255);
      data[index + 3] = 255;
    }
  }
  return data;
}

function firstReachableNode(
  graph: MaterialGraphDocument,
  reachable: Set<string>,
  type: MaterialGraphNodeType,
): MaterialGraphNode | undefined {
  return graph.nodes.find((node) => node.type === type && reachable.has(node.id));
}

function hasReachableOutgoing(
  graph: MaterialGraphDocument,
  reachable: Set<string>,
  type: MaterialGraphNodeType,
  fromPort?: string,
): boolean {
  return graph.edges.some((item) => {
    if (!reachable.has(item.fromNode) || !reachable.has(item.toNode)) return false;
    const fromNode = graph.nodes.find((node) => node.id === item.fromNode);
    if (fromNode?.type !== type) return false;
    return fromPort ? item.fromPort === fromPort : true;
  });
}

function averageReachableScalar(
  evaluation: MaterialGraphEvaluation,
  graph: MaterialGraphDocument,
  type: MaterialGraphNodeType,
  portId: string,
): number | null {
  const values: number[] = [];
  for (const node of graph.nodes) {
    if (node.type !== type || !evaluation.reachableNodeIds.includes(node.id)) continue;
    const value = evaluation.ports[portKey(node.id, portId)];
    if (value?.kind === 'scalar') values.push(value.value);
  }
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function firstReachableColor(
  evaluation: MaterialGraphEvaluation,
  graph: MaterialGraphDocument,
  type: MaterialGraphNodeType,
  portId: string,
): MaterialGraphColorValue | null {
  for (const node of graph.nodes) {
    if (node.type !== type || !evaluation.reachableNodeIds.includes(node.id)) continue;
    const value = evaluation.ports[portKey(node.id, portId)];
    if (value?.kind === 'color') return [...value.value] as MaterialGraphColorValue;
  }
  return null;
}

const COMPUTED_NODE_TYPES = new Set<MaterialGraphNodeType>([
  'value',
  'rgb',
  'time',
  'math',
  'mix',
  'map-range',
  'invert',
  'wave-texture',
  'voronoi-texture',
  'noise-texture',
  'color-ramp',
  'prism-dispersion',
  'scanlines',
  'domain-warp',
  'glitch-bands',
  'digital-fragments',
  'chromatic-split',
  'pulse',
  // Dedicated PBR leaf nodes are the single source of truth when connected.
  'emission',
  'opacity',
  'normal',
  'displacement',
]);

function surfaceInputDrivenByComputed(
  graph: MaterialGraphDocument,
  reachable: Set<string>,
  surfaceTypes: readonly MaterialGraphNodeType[],
  portId: string,
): boolean {
  const surfaceIds = new Set(
    graph.nodes
      .filter((node) => surfaceTypes.includes(node.type) && reachable.has(node.id))
      .map((node) => node.id),
  );
  if (surfaceIds.size === 0) return false;
  const incoming = new Map<string, MaterialGraphEdge[]>();
  for (const item of graph.edges) {
    if (!reachable.has(item.fromNode) || !reachable.has(item.toNode)) continue;
    const list = incoming.get(item.toNode);
    if (list) list.push(item);
    else incoming.set(item.toNode, [item]);
  }
  const stack: Array<{ nodeId: string; onlyPort?: string }> = [...surfaceIds].map((nodeId) => ({
    nodeId,
    onlyPort: portId,
  }));
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const visitKey = `${current.nodeId}:${current.onlyPort ?? '*'}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    for (const edge of incoming.get(current.nodeId) ?? []) {
      if (current.onlyPort && edge.toPort !== current.onlyPort) continue;
      const fromNode = graph.nodes.find((node) => node.id === edge.fromNode);
      if (!fromNode) continue;
      if (COMPUTED_NODE_TYPES.has(fromNode.type)) return true;
      stack.push({ nodeId: fromNode.id });
    }
  }
  return false;
}

/** Derives concrete effect flags and evaluated values from graph topology. */
export function evaluateMaterialGraphEffects(
  graph: MaterialGraphDocument,
  elapsedSeconds = 0,
): MaterialGraphEffects {
  const evaluation = evaluateMaterialGraph(graph, elapsedSeconds);
  const reachable = new Set(evaluation.reachableNodeIds);
  const output = findNode(graph, 'material-output');
  const prism = firstReachableNode(graph, reachable, 'prism-dispersion');
  const noise = firstReachableNode(graph, reachable, 'noise-texture');
  const wave = firstReachableNode(graph, reachable, 'wave-texture');
  const voronoi = firstReachableNode(graph, reachable, 'voronoi-texture');
  const mapping = firstReachableNode(graph, reachable, 'mapping');

  const surfaceConnected = evaluation.surface !== null;
  const noiseConnected = hasReachableOutgoing(graph, reachable, 'noise-texture', 'factor');
  const waveConnected = hasReachableOutgoing(graph, reachable, 'wave-texture', 'factor');
  const voronoiConnected =
    hasReachableOutgoing(graph, reachable, 'voronoi-texture', 'distance') ||
    hasReachableOutgoing(graph, reachable, 'voronoi-texture', 'color');
  const timeConnected = materialGraphUsesTime(graph);
  const scanlinesConnected = hasReachableOutgoing(graph, reachable, 'scanlines', 'factor');
  const proceduralTextureConnected =
    noiseConnected || waveConnected || voronoiConnected || scanlinesConnected;

  const waveFactor = averageReachableScalar(evaluation, graph, 'wave-texture', 'factor');
  const noiseFactor = averageReachableScalar(evaluation, graph, 'noise-texture', 'factor');
  const voronoiDistance = averageReachableScalar(evaluation, graph, 'voronoi-texture', 'distance');
  const voronoiColor = firstReachableColor(evaluation, graph, 'voronoi-texture', 'color');
  const mixColor = firstReachableColor(evaluation, graph, 'mix', 'color');
  const rgbColor = firstReachableColor(evaluation, graph, 'rgb', 'color');

  const proceduralFactors = [waveFactor, noiseFactor, voronoiDistance].filter(
    (value): value is number => typeof value === 'number',
  );
  const evaluatedProceduralFactor =
    proceduralFactors.length > 0
      ? proceduralFactors.reduce((sum, value) => sum + value, 0) / proceduralFactors.length
      : null;

  return {
    surfaceConnected,
    outputEnabled: output?.settings?.outputEnabled !== false,
    outputBlend: output?.settings?.outputBlend ?? 'Opaque',
    baseColorConnected:
      hasInputConnection(graph, 'pbr-surface', 'baseColor') ||
      hasInputConnection(graph, 'unlit-surface', 'baseColor') ||
      hasInputConnection(graph, 'glass-surface', 'tint'),
    metallicConnected: hasInputConnection(graph, 'pbr-surface', 'metallic'),
    roughnessConnected:
      hasInputConnection(graph, 'pbr-surface', 'roughness') ||
      hasInputConnection(graph, 'glass-surface', 'roughness'),
    emissionConnected: hasInputConnection(graph, 'pbr-surface', 'emission'),
    opacityConnected: hasInputConnection(graph, 'pbr-surface', 'opacity'),
    normalConnected: hasInputConnection(graph, 'pbr-surface', 'normal'),
    displacementConnected: hasInputConnection(graph, 'pbr-surface', 'displacement'),
    prismConnected: hasInputConnection(graph, 'glass-surface', 'tint', 'prism-dispersion'),
    transmissionConnected: hasInputConnection(graph, 'glass-surface', 'transmission'),
    noiseConnected,
    waveConnected,
    voronoiConnected,
    timeConnected,
    proceduralTextureConnected,
    prismSpectrum: clamp(prism?.settings?.prismSpectrum ?? 0.62, 0, 1),
    prismAberration: clamp(prism?.settings?.prismAberration ?? 0.18, 0, 1),
    prismSeed: Math.round(clamp(prism?.settings?.prismSeed ?? 24, 0, 64)),
    noiseDetail: clamp(noise?.settings?.noiseDetail ?? 4, 0, 12),
    waveType: wave?.settings?.waveType ?? 'Sine',
    waveScale: clamp(wave?.settings?.waveScale ?? 5, 0.1, 64),
    waveDistortion: clamp(wave?.settings?.waveDistortion ?? 0.25, 0, 1),
    voronoiScale: clamp(voronoi?.settings?.voronoiScale ?? 4, 0.1, 64),
    voronoiRandomness: clamp(voronoi?.settings?.voronoiRandomness ?? 0.75, 0, 1),
    mappingScale: [
      clamp(mapping?.settings?.mappingX ?? 1, -4, 4),
      clamp(mapping?.settings?.mappingY ?? 1, -4, 4),
      clamp(mapping?.settings?.mappingZ ?? 0, -4, 4),
    ],
    evaluatedColor: evaluation.surface
      ? ([...evaluation.surface.tint] as MaterialGraphColorValue)
      : mixColor ?? rgbColor ?? voronoiColor,
    evaluatedRoughness: evaluation.surface?.roughness ?? null,
    evaluatedMetallic: evaluation.surface?.metallic ?? null,
    evaluatedTransmission: evaluation.surface?.transmission ?? null,
    evaluatedEmission: evaluation.surface
      ? ([...evaluation.surface.emission] as MaterialGraphColorValue)
      : null,
    evaluatedOpacity: evaluation.surface?.opacity ?? null,
    evaluatedNormal: evaluation.surface
      ? ([...evaluation.surface.normal] as MaterialGraphVectorValue)
      : null,
    evaluatedDisplacement: evaluation.surface?.displacement ?? null,
    computedRoughness: surfaceInputDrivenByComputed(graph, reachable, ['pbr-surface', 'glass-surface'], 'roughness'),
    computedColor:
      surfaceInputDrivenByComputed(graph, reachable, ['pbr-surface', 'unlit-surface'], 'baseColor') ||
      surfaceInputDrivenByComputed(graph, reachable, ['glass-surface'], 'tint'),
    computedMetallic: surfaceInputDrivenByComputed(graph, reachable, ['pbr-surface'], 'metallic'),
    computedTransmission: surfaceInputDrivenByComputed(graph, reachable, ['glass-surface'], 'transmission'),
    computedEmission: surfaceInputDrivenByComputed(graph, reachable, ['pbr-surface'], 'emission'),
    computedOpacity: surfaceInputDrivenByComputed(graph, reachable, ['pbr-surface'], 'opacity'),
    computedNormal: surfaceInputDrivenByComputed(graph, reachable, ['pbr-surface'], 'normal'),
    computedDisplacement: surfaceInputDrivenByComputed(graph, reachable, ['pbr-surface'], 'displacement'),
    evaluatedProceduralFactor,
    evaluatedProceduralColor: mixColor ?? voronoiColor ?? rgbColor,
    evaluation,
  };
}

/**
 * Validates that every catalogued node declares coherent input/output ports.
 * Used by unit and integration checks across contract, editor, and preview layers.
 */
export function validateMaterialGraphPortCatalog(): {
  ok: true;
  nodeCount: number;
  proceduralCount: number;
} {
  const seen = new Set<string>();
  for (const type of MATERIAL_GRAPH_NODE_TYPES) {
    if (seen.has(type)) {
      throw new Error(`duplicate material graph node type: ${type}`);
    }
    seen.add(type);
    const ports = MATERIAL_GRAPH_PORTS_BY_TYPE[type];
    if (!ports) {
      throw new Error(`missing port architecture for ${type}`);
    }
    for (const side of ['inputs', 'outputs'] as const) {
      const ids = new Set<string>();
      for (const port of ports[side]) {
        if (!port.id || !port.label) {
          throw new Error(`${type}.${side} contains an incomplete port`);
        }
        if (ids.has(port.id)) {
          throw new Error(`${type}.${side} duplicates port id ${port.id}`);
        }
        if (port.tone !== 'vector' && port.tone !== 'scalar' && port.tone !== 'color' && port.tone !== 'shader') {
          throw new Error(`${type}.${side}.${port.id} has invalid tone`);
        }
        ids.add(port.id);
      }
    }
  }

  for (const kind of ['procedural', 'pbr', 'unlit'] as const) {
    for (const type of MATERIAL_GRAPH_NODE_TYPES_BY_KIND[kind]) {
      if (!seen.has(type)) {
        throw new Error(`${kind} catalog references unknown node type ${type}`);
      }
    }
  }

  return {
    ok: true,
    nodeCount: MATERIAL_GRAPH_NODE_TYPES.length,
    proceduralCount: MATERIAL_GRAPH_NODE_TYPES_BY_KIND.procedural.length,
  };
}

/** True when any Time node output reaches the material-output path. */
export function materialGraphUsesTime(graph: MaterialGraphDocument): boolean {
  const reachable = collectReachableNodeIds(graph);
  if (
    hasReachableOutgoing(graph, reachable, 'time', 'time') ||
    hasReachableOutgoing(graph, reachable, 'time', 'sin') ||
    hasReachableOutgoing(graph, reachable, 'time', 'cos')
  ) {
    return true;
  }
  // Nodes that consume elapsedSeconds directly without a Time input.
  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) continue;
    if (
      node.type === 'scanlines' ||
      node.type === 'domain-warp' ||
      node.type === 'glitch-bands' ||
      node.type === 'digital-fragments' ||
      node.type === 'pulse'
    ) {
      return true;
    }
  }
  return false;
}

function cloneDocument(document: PrismorphicMaterialDocument): PrismorphicMaterialDocument {
  return {
    ...document,
    parameters: { ...document.parameters },
    metadata: { ...document.metadata },
    extensions: document.extensions ? { ...document.extensions } : undefined,
    renderHints: document.renderHints ? { ...document.renderHints } : undefined,
  } as PrismorphicMaterialDocument;
}

function setScalarValue(
  document: PrismorphicMaterialDocument,
  key: string,
  value: number,
): void {
  const parameter = document.parameters[key];
  if (!parameter || parameter.type !== 'scalar') return;
  document.parameters[key] = { ...parameter, value };
}

function ensureScalarParameter(
  document: PrismorphicMaterialDocument,
  key: string,
  value: number,
  meta: { label: string; group: string; max?: number },
): void {
  const existing = document.parameters[key];
  if (existing?.type === 'scalar') {
    document.parameters[key] = { ...existing, value };
    return;
  }
  document.parameters[key] = {
    type: 'scalar',
    value,
    default: value,
    min: 0,
    max: meta.max ?? 1,
    step: 0.01,
    label: meta.label,
    group: meta.group,
    exposed: false,
  };
}

function setColorValue(
  document: PrismorphicMaterialDocument,
  key: string,
  value: RgbaColor,
): void {
  const parameter = document.parameters[key];
  if (!parameter || parameter.type !== 'color') return;
  document.parameters[key] = { ...parameter, value };
}

function setVec2Value(
  document: PrismorphicMaterialDocument,
  key: string,
  value: [number, number],
): void {
  const parameter = document.parameters[key];
  if (!parameter || parameter.type !== 'vec2') return;
  document.parameters[key] = { ...parameter, value };
}

function setEnumValue(
  document: PrismorphicMaterialDocument,
  key: string,
  value: string,
): void {
  const parameter = document.parameters[key];
  if (!parameter || parameter.type !== 'enum') return;
  if (!parameter.options.includes(value)) return;
  document.parameters[key] = { ...parameter, value };
}

function authoredColor(parameter: MaterialParameter | undefined, fallback: RgbaColor): RgbaColor {
  if (!parameter || parameter.type !== 'color') return fallback;
  return Array.isArray(parameter.default) ? ([...parameter.default] as RgbaColor) : ([...parameter.value] as RgbaColor);
}

function authoredScalar(parameter: MaterialParameter | undefined, fallback: number): number {
  if (!parameter || parameter.type !== 'scalar') return fallback;
  return typeof parameter.default === 'number' ? parameter.default : parameter.value;
}

/**
 * Writes the graph into extensions['prismorphic.graph'] and applies structural
 * parameter/render effects so preview and export reflect topology changes.
 */
export function commitMaterialGraph(
  document: PrismorphicMaterialDocument,
  graphInput: unknown,
): { document: PrismorphicMaterialDocument; graph: MaterialGraphDocument; effects: MaterialGraphEffects } {
  const previousGraph = readMaterialGraph(document);
  const previousEffects = previousGraph
    ? evaluateMaterialGraphEffects(resolveMaterialGraphControlBindings(document, previousGraph))
    : null;
  const graph =
    sanitizeMaterialGraph(graphInput, document.kind) ?? createDefaultMaterialGraph(document);
  const controlledGraph = ensureMaterialGraphControls(document, graph);
  const effects = evaluateMaterialGraphEffects(
    resolveMaterialGraphControlBindings(document, controlledGraph),
  );
  const next = cloneDocument(document);
  next.extensions = {
    ...next.extensions,
    [MATERIAL_GRAPH_EXTENSION_KEY]: controlledGraph,
  };

  const muted = !effects.outputEnabled || !effects.surfaceConnected;
  const wasMuted = previousEffects
    ? !previousEffects.outputEnabled || !previousEffects.surfaceConnected
    : false;

  if (effects.metallicConnected) {
    if (previousEffects && !previousEffects.metallicConnected && next.parameters.metallic?.type === 'scalar') {
      setScalarValue(next, 'metallic', authoredScalar(next.parameters.metallic, 0));
    }
  } else if (next.parameters.metallic?.type === 'scalar') {
    setScalarValue(next, 'metallic', 0);
  }

  if (effects.roughnessConnected) {
    if (effects.computedRoughness && typeof effects.evaluatedRoughness === 'number') {
      setScalarValue(next, 'roughness', clamp(effects.evaluatedRoughness, 0, 1));
    } else if (previousEffects && !previousEffects.roughnessConnected && next.parameters.roughness?.type === 'scalar') {
      setScalarValue(next, 'roughness', authoredScalar(next.parameters.roughness, 0.5));
    }
  } else if (next.parameters.roughness?.type === 'scalar') {
    setScalarValue(next, 'roughness', 1);
  }

  if (effects.metallicConnected && effects.computedMetallic && typeof effects.evaluatedMetallic === 'number') {
    setScalarValue(next, 'metallic', clamp(effects.evaluatedMetallic, 0, 1));
  }

  if (effects.baseColorConnected) {
    if (next.parameters.baseColor?.type === 'color') {
      const evaluated = effects.computedColor ? effects.evaluatedColor : null;
      const color = evaluated
        ? ([evaluated[0], evaluated[1], evaluated[2], evaluated[3]] as RgbaColor)
        : authoredColor(next.parameters.baseColor, [0.82, 0.84, 0.88, 1]);
      if (muted) {
        setColorValue(next, 'baseColor', [color[0], color[1], color[2], Math.min(color[3], 0.12)]);
      } else if (evaluated || (previousEffects && !previousEffects.baseColorConnected) || (wasMuted && !muted)) {
        setColorValue(next, 'baseColor', color);
      }
    }
  } else if (next.parameters.baseColor?.type === 'color') {
    setColorValue(next, 'baseColor', [0.42, 0.43, 0.46, muted ? 0.12 : 1]);
  }

  if (next.parameters.prismStrength?.type === 'scalar') {
    if (!effects.prismConnected || muted) {
      setScalarValue(next, 'prismStrength', 0);
    } else if (
      (previousEffects && !previousEffects.prismConnected) ||
      (wasMuted && !muted)
    ) {
      setScalarValue(next, 'prismStrength', authoredScalar(next.parameters.prismStrength, 0.65));
    }
  }

  // A regular PBR graph does not expose transmission as a surface port yet, so
  // transmission remains an authored physical-material property there. Only a
  // graph containing a glass surface owns the topology semantics that can mute
  // transmission when its input/surface is disconnected.
  const graphManagesTransmission = controlledGraph.nodes.some(
    (node) => node.type === 'glass-surface',
  );
  if (graphManagesTransmission && next.parameters.transmission?.type === 'scalar') {
    if (!effects.transmissionConnected || muted) {
      setScalarValue(next, 'transmission', 0);
    } else if (effects.computedTransmission && typeof effects.evaluatedTransmission === 'number') {
      setScalarValue(next, 'transmission', clamp(effects.evaluatedTransmission, 0, 1));
    } else if (
      (previousEffects && !previousEffects.transmissionConnected) ||
      (wasMuted && !muted)
    ) {
      setScalarValue(next, 'transmission', authoredScalar(next.parameters.transmission, 1));
    }
  }

  if (next.parameters.emissive?.type === 'color') {
    if (muted) {
      setColorValue(next, 'emissive', [0, 0, 0, 1]);
      if (next.parameters.emissiveIntensity?.type === 'scalar') {
        setScalarValue(next, 'emissiveIntensity', 0);
      }
    } else if (!effects.emissionConnected) {
      // Optional surface port: restore authored emissive when the graph stops driving it.
      if (
        previousEffects?.emissionConnected ||
        wasMuted
      ) {
        setColorValue(next, 'emissive', authoredColor(next.parameters.emissive, [0, 0, 0, 1]));
        if (next.parameters.emissiveIntensity?.type === 'scalar') {
          setScalarValue(next, 'emissiveIntensity', authoredScalar(next.parameters.emissiveIntensity, 1));
        }
      }
    } else if (effects.computedEmission && effects.evaluatedEmission) {
      const emission = effects.evaluatedEmission;
      setColorValue(next, 'emissive', [emission[0], emission[1], emission[2], emission[3] ?? 1]);
      const intensity = Math.max(emission[0], emission[1], emission[2]);
      if (next.parameters.emissiveIntensity?.type === 'scalar') {
        setScalarValue(next, 'emissiveIntensity', clamp(Math.max(intensity, 0.35), 0, 8));
      }
    } else if (
      (previousEffects && !previousEffects.emissionConnected) ||
      (wasMuted && !muted)
    ) {
      setColorValue(next, 'emissive', authoredColor(next.parameters.emissive, [0, 0, 0, 1]));
      if (next.parameters.emissiveIntensity?.type === 'scalar') {
        setScalarValue(next, 'emissiveIntensity', authoredScalar(next.parameters.emissiveIntensity, 1));
      }
    }
  }

  if (effects.opacityConnected) {
    if (effects.computedOpacity && typeof effects.evaluatedOpacity === 'number') {
      const opacity = clamp(effects.evaluatedOpacity, 0, 1);
      ensureScalarParameter(next, 'opacity', opacity, { label: 'Opacity', group: 'transparency' });
      if (next.parameters.baseColor?.type === 'color') {
        const color = next.parameters.baseColor.value;
        setColorValue(next, 'baseColor', [color[0], color[1], color[2], opacity]);
      }
      if (opacity < 0.999) {
        setEnumValue(next, 'alphaMode', 'blend');
        next.renderHints = {
          ...next.renderHints,
          transparent: true,
          depthWrite: false,
        };
      }
    } else if (
      previousEffects &&
      !previousEffects.opacityConnected &&
      next.parameters.opacity?.type === 'scalar'
    ) {
      setScalarValue(next, 'opacity', authoredScalar(next.parameters.opacity, 1));
    }
  } else if (previousEffects?.opacityConnected) {
    if (next.parameters.opacity?.type === 'scalar') {
      setScalarValue(next, 'opacity', authoredScalar(next.parameters.opacity, 1));
    }
    if (next.parameters.baseColor?.type === 'color') {
      const authored = authoredColor(next.parameters.baseColor, [0.82, 0.84, 0.88, 1]);
      setColorValue(next, 'baseColor', [
        next.parameters.baseColor.value[0],
        next.parameters.baseColor.value[1],
        next.parameters.baseColor.value[2],
        authored[3],
      ]);
    }
    // Opacity may have forced transparent preview hints; clear them when the port drops.
    if (!muted && effects.outputBlend === 'Opaque') {
      next.renderHints = {
        ...next.renderHints,
        transparent: false,
        depthWrite: true,
      };
    }
  }

  if (effects.normalConnected) {
    if (effects.computedNormal && effects.evaluatedNormal) {
      const normal = effects.evaluatedNormal;
      setVec2Value(next, 'normalScale', [
        clamp(Math.abs(normal[0]) * 2, 0, 4),
        clamp(Math.abs(normal[1]) * 2, 0, 4),
      ]);
    } else if (
      previousEffects &&
      !previousEffects.normalConnected &&
      next.parameters.normalScale?.type === 'vec2'
    ) {
      const authored = next.parameters.normalScale.default ?? next.parameters.normalScale.value;
      setVec2Value(next, 'normalScale', [authored[0], authored[1]]);
    }
  } else if (
    previousEffects?.normalConnected &&
    next.parameters.normalScale?.type === 'vec2'
  ) {
    const authored = next.parameters.normalScale.default ?? next.parameters.normalScale.value;
    setVec2Value(next, 'normalScale', [authored[0], authored[1]]);
  }

  if (effects.displacementConnected) {
    if (effects.computedDisplacement && typeof effects.evaluatedDisplacement === 'number') {
      ensureScalarParameter(next, 'displacementScale', clamp(effects.evaluatedDisplacement, 0, 1), {
        label: 'Displacement scale',
        group: 'advanced',
      });
    } else if (
      previousEffects &&
      !previousEffects.displacementConnected &&
      next.parameters.displacementScale?.type === 'scalar'
    ) {
      setScalarValue(next, 'displacementScale', authoredScalar(next.parameters.displacementScale, 0));
    }
  } else if (
    previousEffects?.displacementConnected &&
    next.parameters.displacementScale?.type === 'scalar'
  ) {
    setScalarValue(next, 'displacementScale', authoredScalar(next.parameters.displacementScale, 0));
  }

  if (next.parameters.noiseScale?.type === 'scalar') {
    if (!effects.proceduralTextureConnected || muted) {
      setScalarValue(next, 'noiseScale', 0.1);
    } else if (
      (previousEffects && !previousEffects.proceduralTextureConnected) ||
      (wasMuted && !muted)
    ) {
      setScalarValue(next, 'noiseScale', authoredScalar(next.parameters.noiseScale, 3.2));
    }
  }

  if (next.parameters.uvScale?.type === 'vec2' && effects.proceduralTextureConnected && !muted) {
    const parameter = next.parameters.uvScale;
    const nextValue: [number, number] = [
      Math.abs(effects.mappingScale[0]) || 1,
      Math.abs(effects.mappingScale[1]) || 1,
    ];
    if (parameter.value[0] !== nextValue[0] || parameter.value[1] !== nextValue[1]) {
      next.parameters.uvScale = {
        ...parameter,
        value: nextValue,
      };
    }
  }

  if (effects.outputBlend === 'Alpha blend' || effects.outputBlend === 'Additive' || muted) {
    setEnumValue(next, 'alphaMode', 'blend');
    next.renderHints = {
      ...next.renderHints,
      transparent: true,
      depthWrite: effects.outputBlend === 'Opaque' ? next.renderHints?.depthWrite : false,
    };
  } else if (effects.outputBlend === 'Opaque' && next.parameters.alphaMode?.type === 'enum') {
    setEnumValue(next, 'alphaMode', 'opaque');
  }

  if (muted) {
    next.renderHints = {
      ...next.renderHints,
      transparent: true,
      depthWrite: false,
    };
  }

  next.metadata = {
    ...next.metadata,
    updatedAt: new Date().toISOString(),
  };

  return { document: next, graph: controlledGraph, effects };
}

/** Stable fingerprint used to avoid redundant document writes. */
export function materialGraphFingerprint(graph: MaterialGraphDocument): string {
  return JSON.stringify({
    version: graph.version,
    nodes: graph.nodes,
    edges: graph.edges,
    frames: graph.frames,
    controls: graph.controls ?? [],
  });
}
