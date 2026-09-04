/**
 * Deterministic GLSL MVP compiler for the canonical material graph.
 * Generates fragment/vertex evaluation code that mirrors evaluateMaterialGraphAt,
 * with an in-memory cache keyed by the reachable subgraph topology and
 * structural (non-uniform) settings only. Numeric/color node settings are
 * emitted as uniforms so uniform-only patches skip recompilation. Layout,
 * unreachable nodes, unused settings, and outputBlend are omitted from the key.
 *
 * Operational guide: docs/shader-mvp/guide-glsl-integration.md
 */

import type {
  MaterialGraphDocument,
  MaterialGraphNode,
  MaterialGraphNodeSettings,
  MaterialGraphNodeType,
  MaterialGraphColorValue,
} from './material-graph';
import {
  MATERIAL_GRAPH_SURFACE_BLEND_CONSTANTS,
  materialGraphBlendFieldSeed,
} from './material-graph.ts';
import type { MaterialRecipeSlotMode } from './material-recipe';

export const MATERIAL_GRAPH_GLSL_VERSION = 1 as const;

/**
 * Resource budgets for intermediate compiled graphs and the shared program
 * cache. Since D2-1, `maxReachableNodes` is a budget **per recipe instance**:
 * the depth cap (R-04) bounds a composition to a handful of recipes, and a
 * composed program is allowed that many times the single-recipe budget.
 */
export const MATERIAL_GRAPH_GLSL_BUDGETS = {
  /** Reachable nodes allowed per recipe instance. */
  maxReachableNodes: 64,
  /** Recipe instances a chain reaches at the depth cap; reported, not enforced. */
  maxRecipes: 3,
  maxUniformBindings: 96,
  maxCacheEntries: 32,
} as const;

export type MaterialGraphGlslOutputBlend = NonNullable<MaterialGraphNodeSettings['outputBlend']>;

export type MaterialGraphGlslSurfaceMode = 'physical' | 'unlit';

export type MaterialGraphGlslUniformKind = 'float' | 'vec3' | 'vec4' | 'bool';

/** One graph setting bound as a GLSL uniform (patchable without recompile). */
export interface MaterialGraphGlslUniformBinding {
  name: string;
  kind: MaterialGraphGlslUniformKind;
  nodeId: string;
  settingKey: string;
  value: number | boolean | MaterialGraphColorValue | [number, number, number];
}

export type MaterialGraphGlslUniformValues = Record<
  string,
  number | boolean | MaterialGraphColorValue | [number, number, number]
>;

/** Patch strategy for a graph edit relative to the currently bound program. */
export type MaterialGraphPatchStrategy = 'uniform-only' | 'incremental-recompile' | 'noop';

export interface MaterialGraphGlslBudgetReport {
  reachableNodeCount: number;
  uniformBindingCount: number;
  cacheEntryCount: number;
  /** Recipe instances in the reachable graph; 1 for a plain material. */
  recipeCount: number;
  /** Per-recipe node budget. */
  maxReachableNodes: number;
  /** `maxReachableNodes` × `recipeCount` — what the graph is actually held to. */
  maxReachableNodesTotal: number;
  maxRecipes: number;
  maxUniformBindings: number;
  maxCacheEntries: number;
  withinBudget: boolean;
  /** Nodes over the total budget, by how many — what the Recipe view shows (§6.5). */
  reachableNodeOverflow: number;
  exceeded: Array<'reachableNodes' | 'uniformBindings' | 'cacheEntries'>;
}

export interface CompiledMaterialGraphGlsl {
  version: typeof MATERIAL_GRAPH_GLSL_VERSION;
  cacheKey: string;
  usedNodeTypes: MaterialGraphNodeType[];
  reachableNodeIds: string[];
  /** True when the reachable surface graph has a connected normal input. */
  usesNormalOutput: boolean;
  /** True when the reachable surface graph has a connected displacement input. */
  usesDisplacementOutput: boolean;
  /** material-output blend mode for Three.js material state (not baked into GLSL). */
  outputBlend: MaterialGraphGlslOutputBlend;
  /** Connected surface shading mode (`unlit-surface` → unlit). */
  surfaceMode: MaterialGraphGlslSurfaceMode;
  /** Shared procedural helpers (hash/noise/wave/voronoi). */
  helpersSource: string;
  /** `void prismorphic_evaluate_graph(...)` definition. */
  evaluateFunctionSource: string;
  /** Uniform declarations required by the generated program. */
  uniformsSource: string;
  /** MeshPhysicalMaterial.onBeforeCompile fragment injection chunk. */
  physicalFragmentChunk: string;
  timeUniformName: 'uPrismorphicTime';
  /** Uniform bindings for patchable node settings (values refreshed on cache hits). */
  uniforms: MaterialGraphGlslUniformBinding[];
  /** Flat map of uniform name → current value (for uniform-only patches). */
  uniformValues: MaterialGraphGlslUniformValues;
  /** Budget snapshot for this intermediate compiled graph. */
  budgetReport: MaterialGraphGlslBudgetReport;
  fromCache: boolean;
}

export interface MaterialGraphGlslCacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  maxEntries: number;
}

type PortKind = 'scalar' | 'color' | 'vector' | 'shader';

type PortRef = {
  expr: string;
  kind: PortKind;
};

const glslCache = new Map<string, CompiledMaterialGraphGlsl>();
const glslCacheOrder: string[] = [];
let cacheHits = 0;
let cacheMisses = 0;
let cacheEvictions = 0;

/** Clears the GLSL compile cache (shader-registry releasePrograms). */
export function clearMaterialGraphGlslCache(): void {
  glslCache.clear();
  glslCacheOrder.length = 0;
  cacheHits = 0;
  cacheMisses = 0;
  cacheEvictions = 0;
}

/** Returns current compile-cache statistics. */
export function getMaterialGraphGlslCacheStats(): MaterialGraphGlslCacheStats {
  return {
    size: glslCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    evictions: cacheEvictions,
    maxEntries: MATERIAL_GRAPH_GLSL_BUDGETS.maxCacheEntries,
  };
}

/**
 * True when reachable-node or uniform-binding hard budgets are exceeded.
 * Cache-entry pressure is handled by LRU eviction and does not refuse bind.
 */
export function isMaterialGraphGlslHardBudgetExceeded(
  report: MaterialGraphGlslBudgetReport,
): boolean {
  return report.exceeded.includes('reachableNodes') || report.exceeded.includes('uniformBindings');
}

/**
 * Returns a cached compile when the program key matches; otherwise compiles
 * and stores the result. Deterministic for canonically equivalent graphs.
 * Uniform-only setting edits keep the same key; values are refreshed per call.
 * `outputBlend` is derived per call (not part of the program key / GLSL body).
 * Graphs that exceed hard node/uniform budgets are compiled for diagnostics
 * but never inserted into the program cache.
 */
export function getCachedMaterialGraphGlsl(graph: MaterialGraphDocument): CompiledMaterialGraphGlsl {
  const cacheKey = materialGraphGlslCacheKey(graph);
  const outputBlend = resolveOutputBlendFromGraph(graph);
  const surfaceMode = resolveSurfaceModeFromGraph(graph);
  const uniforms = collectUniformBindings(graph);
  const uniformValues = uniformValuesFromBindings(uniforms);
  const budgetReport = evaluateMaterialGraphGlslBudgets(graph, uniforms.length);
  const hardBudgetExceeded = isMaterialGraphGlslHardBudgetExceeded(budgetReport);
  const cached = hardBudgetExceeded ? undefined : glslCache.get(cacheKey);
  if (cached) {
    cacheHits += 1;
    touchCacheEntry(cacheKey);
    return {
      ...cached,
      fromCache: true,
      cacheKey,
      outputBlend,
      surfaceMode,
      uniforms,
      uniformValues,
      budgetReport,
    };
  }
  cacheMisses += 1;
  const compiled = compileMaterialGraphGlsl(graph);
  // Refuse cache insertion when hard budgets are exceeded (limit+1 must not land in cache).
  if (!hardBudgetExceeded) {
    storeCompiledInCache(cacheKey, { ...compiled, fromCache: false });
  }
  return compiled;
}

/**
 * Resolves how to apply `next` relative to `previous` for the bound GLSL program.
 * Same structural key → uniform-only (or noop when values also match).
 * Different structural key → incremental recompile.
 */
export function resolveMaterialGraphPatchStrategy(
  previous: MaterialGraphDocument,
  next: MaterialGraphDocument,
): MaterialGraphPatchStrategy {
  const previousKey = materialGraphGlslCacheKey(previous);
  const nextKey = materialGraphGlslCacheKey(next);
  if (previousKey !== nextKey) {
    return 'incremental-recompile';
  }
  const previousValues = uniformValuesFromBindings(collectUniformBindings(previous));
  const nextValues = uniformValuesFromBindings(collectUniformBindings(next));
  if (JSON.stringify(previousValues) === JSON.stringify(nextValues)) {
    const previousBlend = resolveOutputBlendFromGraph(previous);
    const nextBlend = resolveOutputBlendFromGraph(next);
    if (previousBlend === nextBlend) {
      return 'noop';
    }
  }
  return 'uniform-only';
}

/**
 * Number of recipe instances a reachable graph unfolds. Each surface-blend
 * joins one more guest to the mix, so the count is readable from the graph
 * alone — no composition extension needed, which keeps the budget honest for
 * a hand-wired graph too.
 */
function countRecipeInstances(graph: MaterialGraphDocument, reachable: Set<string>): number {
  let blends = 0;
  for (const node of graph.nodes) {
    if (node.type === 'surface-blend' && reachable.has(node.id)) blends += 1;
  }
  return blends + 1;
}

/** Evaluates resource budgets for an intermediate compiled graph. */
export function evaluateMaterialGraphGlslBudgets(
  graph: MaterialGraphDocument,
  uniformBindingCount = collectUniformBindings(graph).length,
): MaterialGraphGlslBudgetReport {
  const reachable = collectReachableNodeIds(graph);
  const reachableNodeCount = reachable.size;
  const recipeCount = countRecipeInstances(graph, reachable);
  const maxReachableNodesTotal = MATERIAL_GRAPH_GLSL_BUDGETS.maxReachableNodes * recipeCount;
  const cacheEntryCount = glslCache.size;
  const exceeded: MaterialGraphGlslBudgetReport['exceeded'] = [];
  if (reachableNodeCount > maxReachableNodesTotal) {
    exceeded.push('reachableNodes');
  }
  if (uniformBindingCount > MATERIAL_GRAPH_GLSL_BUDGETS.maxUniformBindings) {
    exceeded.push('uniformBindings');
  }
  if (cacheEntryCount > MATERIAL_GRAPH_GLSL_BUDGETS.maxCacheEntries) {
    exceeded.push('cacheEntries');
  }
  return {
    reachableNodeCount,
    uniformBindingCount,
    cacheEntryCount,
    recipeCount,
    maxReachableNodes: MATERIAL_GRAPH_GLSL_BUDGETS.maxReachableNodes,
    maxReachableNodesTotal,
    maxRecipes: MATERIAL_GRAPH_GLSL_BUDGETS.maxRecipes,
    maxUniformBindings: MATERIAL_GRAPH_GLSL_BUDGETS.maxUniformBindings,
    maxCacheEntries: MATERIAL_GRAPH_GLSL_BUDGETS.maxCacheEntries,
    withinBudget: exceeded.length === 0,
    reachableNodeOverflow: Math.max(0, reachableNodeCount - maxReachableNodesTotal),
    exceeded,
  };
}

/** Stable public program cache key (topology + structural settings only). */
export function getMaterialGraphGlslCacheKey(graph: MaterialGraphDocument): string {
  return materialGraphGlslCacheKey(graph);
}

/** Collects current uniform bindings for a graph (no compile). */
export function collectMaterialGraphGlslUniforms(
  graph: MaterialGraphDocument,
): MaterialGraphGlslUniformBinding[] {
  return collectUniformBindings(graph);
}

function storeCompiledInCache(cacheKey: string, compiled: CompiledMaterialGraphGlsl): void {
  if (glslCache.has(cacheKey)) {
    touchCacheEntry(cacheKey);
    glslCache.set(cacheKey, compiled);
    return;
  }
  while (glslCache.size >= MATERIAL_GRAPH_GLSL_BUDGETS.maxCacheEntries && glslCacheOrder.length > 0) {
    const oldest = glslCacheOrder.shift();
    if (!oldest) break;
    if (glslCache.delete(oldest)) {
      cacheEvictions += 1;
    }
  }
  glslCache.set(cacheKey, compiled);
  glslCacheOrder.push(cacheKey);
}

function touchCacheEntry(cacheKey: string): void {
  const index = glslCacheOrder.indexOf(cacheKey);
  if (index >= 0) {
    glslCacheOrder.splice(index, 1);
  }
  glslCacheOrder.push(cacheKey);
}

function uniformValuesFromBindings(
  bindings: MaterialGraphGlslUniformBinding[],
): MaterialGraphGlslUniformValues {
  const values: MaterialGraphGlslUniformValues = {};
  for (const binding of bindings) {
    values[binding.name] = binding.value;
  }
  return values;
}

/** Compiles a canonical material graph into deterministic GLSL sources (no cache write). */
export function compileMaterialGraphGlsl(graph: MaterialGraphDocument): CompiledMaterialGraphGlsl {
  const cacheKey = materialGraphGlslCacheKey(graph);
  const reachable = collectReachableNodeIds(graph);
  const ordered = topologicalOrder(graph, reachable);
  const usedNodeTypes = [...new Set(ordered.map((node) => node.type))];
  const usesNormalOutput = graph.edges.some(
    (edge) => reachable.has(edge.toNode) && edge.toPort === 'normal',
  );
  const usesDisplacementOutput = graph.edges.some(
    (edge) => reachable.has(edge.toNode) && edge.toPort === 'displacement',
  );
  const ports = new Map<string, PortRef>();
  const body: string[] = [];
  const uniformBindings: MaterialGraphGlslUniformBinding[] = [];

  // One function per recipe instance when the graph is a composition (§5.1);
  // otherwise the whole graph is inlined exactly as it was before D2-1.
  const plan = planRecipePartitions(graph, reachable, ordered);
  const recipeFunctions: string[] = [];

  pushCoordinatePreamble(body);
  body.push('  vec4 _surface_baseColor = vec4(0.82, 0.84, 0.88, 1.0);');
  body.push('  float _surface_metallic = 0.0;');
  body.push('  float _surface_roughness = 0.5;');
  body.push('  float _surface_transmission = 0.55;');
  body.push('  vec4 _surface_tint = vec4(0.82, 0.84, 0.88, 1.0);');
  body.push('  vec4 _surface_emission = vec4(0.0, 0.0, 0.0, 1.0);');
  body.push('  float _surface_opacity = 1.0;');
  body.push('  vec3 _surface_normal = vec3(0.0, 0.0, 1.0);');
  body.push('  float _surface_displacement = 0.0;');
  body.push('  bool _surface_emission_driven = false;');
  body.push('  bool _surface_normal_driven = false;');
  body.push('  bool _surface_displacement_driven = false;');
  body.push('  bool _surface_unlit = false;');
  body.push('  bool _surface_connected = false;');
  // How far a blend owns the surface's colour. A textured host multiplies the
  // graph's colour into its map, which leaves an invited recipe as a faint
  // tint; the runtime needs this to hand the albedo over where the mask says
  // the guest is, and it stays 0 for a graph with no blend in it.
  body.push('  float _blend_authority = 0.0;');
  body.push('  bool _output_enabled = true;');

  if (plan) {
    for (const partition of plan.partitions) {
      recipeFunctions.push(emitRecipeFunction(graph, partition, uniformBindings));
    }
    for (const partition of plan.partitions) {
      emitRecipeCall(graph, partition, plan, ports, body, uniformBindings);
    }
    for (const blend of plan.blends) {
      emitNode(graph, blend, ports, body, uniformBindings);
    }
  } else {
    for (const node of ordered) {
      emitNode(graph, node, ports, body, uniformBindings);
    }
  }

  const outputBlend = resolveOutputBlendFromGraph(graph);
  const surfaceMode = resolveSurfaceModeFromGraph(graph);
  const output = ordered.find((node) => node.type === 'material-output');
  if (output) {
    const enabledUniform = ensureUniform(
      uniformBindings,
      output,
      'outputEnabled',
      'bool',
      nodeSettings(output).outputEnabled !== false,
    );
    body.push(`  _output_enabled = ${enabledUniform};`);
    const surfaceIn = readInput(graph, ports, output.id, 'surface');
    if (surfaceIn?.kind === 'shader') {
      body.push(`  _surface_baseColor = ${surfaceIn.expr}_baseColor;`);
      body.push(`  _surface_metallic = ${surfaceIn.expr}_metallic;`);
      body.push(`  _surface_roughness = ${surfaceIn.expr}_roughness;`);
      body.push(`  _surface_transmission = ${surfaceIn.expr}_transmission;`);
      body.push(`  _surface_tint = ${surfaceIn.expr}_tint;`);
      body.push(`  _surface_emission = ${surfaceIn.expr}_emission;`);
      body.push(`  _surface_opacity = ${surfaceIn.expr}_opacity;`);
      body.push(`  _surface_normal = ${surfaceIn.expr}_normal;`);
      body.push(`  _surface_displacement = ${surfaceIn.expr}_displacement;`);
      body.push(`  _surface_emission_driven = ${surfaceIn.expr}_emissionDriven;`);
      body.push(`  _surface_normal_driven = ${surfaceIn.expr}_normalDriven;`);
      body.push(`  _surface_displacement_driven = ${surfaceIn.expr}_displacementDriven;`);
      body.push(`  _surface_unlit = ${surfaceIn.expr}_unlit;`);
      body.push('  _surface_connected = true;');
    }
  }

  body.push('  if (!_surface_connected || !_output_enabled) {');
  body.push('    outBaseColor = vec4(0.42, 0.43, 0.46, 0.08);');
  body.push('    outMetallic = 0.0;');
  body.push('    outRoughness = 1.0;');
  body.push('    outTransmission = 0.0;');
  body.push('    outEmission = vec4(0.0);');
  body.push('    outOpacity = 0.08;');
  body.push('    outNormal = vec3(0.0, 0.0, 1.0);');
  body.push('    outDisplacement = 0.0;');
  body.push('    outEnabled = false;');
  body.push('    outEmissionDriven = false;');
  body.push('    outNormalDriven = false;');
  body.push('    outDisplacementDriven = false;');
  body.push('    outUnlit = false;');
  body.push('    outAlbedoAuthority = 0.0;');
  body.push('    return;');
  body.push('  }');
  body.push('  outBaseColor = _surface_tint;');
  body.push('  outMetallic = clamp(_surface_metallic, 0.0, 1.0);');
  body.push('  outRoughness = clamp(_surface_roughness, 0.0, 1.0);');
  body.push('  outTransmission = clamp(_surface_transmission, 0.0, 1.0);');
  body.push('  outEmission = _surface_emission;');
  body.push('  outOpacity = clamp(_surface_opacity, 0.0, 1.0);');
  body.push('  outNormal = _surface_normal;');
  body.push('  outDisplacement = clamp(_surface_displacement, 0.0, 1.0);');
  body.push('  outEnabled = true;');
  body.push('  outEmissionDriven = _surface_emission_driven;');
  body.push('  outNormalDriven = _surface_normal_driven;');
  body.push('  outDisplacementDriven = _surface_displacement_driven;');
  body.push('  outUnlit = _surface_unlit;');
  body.push('  outAlbedoAuthority = clamp(_blend_authority, 0.0, 1.0);');

  const helpersSource = buildHelpersSource();
  const uniforms = [...uniformBindings].sort((a, b) => compareStrings(a.name, b.name));
  const uniformsSource = [
    'uniform float uPrismorphicTime;',
    ...uniforms.map((binding) => `uniform ${binding.kind} ${binding.name};`),
  ].join('\n');
  const evaluateFunctionSource = [
    ...(plan ? [PRISM_SURFACE_STRUCT_SOURCE, ...recipeFunctions, ''] : []),
    'void prismorphic_evaluate_graph(',
    '  vec2 uv,',
    '  vec3 objectPosition,',
    '  vec3 viewDirection,',
    '  float elapsedSeconds,',
    '  out vec4 outBaseColor,',
    '  out float outMetallic,',
    '  out float outRoughness,',
    '  out float outTransmission,',
    '  out vec4 outEmission,',
    '  out float outOpacity,',
    '  out vec3 outNormal,',
    '  out float outDisplacement,',
    '  out bool outEnabled,',
    '  out bool outEmissionDriven,',
    '  out bool outNormalDriven,',
    '  out bool outDisplacementDriven,',
    '  out bool outUnlit,',
    '  out float outAlbedoAuthority',
    ') {',
    ...body,
    '}',
  ].join('\n');

  // Reference chunk mirroring injectCompiledGraphShader surface apply.
  // Do not assign the legacy Three transmission local — removed in r170; glass
  // transmission is driven via material.transmission in the production injector.
  const physicalFragmentChunk = [
    uniformsSource,
    helpersSource,
    evaluateFunctionSource,
    '',
    '// Prismorphic MVP graph injection — uses vPrismorphicUv (not USE_UV / vUv).',
    'vec4 prismorphicBaseColor;',
    'float prismorphicMetallic;',
    'float prismorphicRoughness;',
    'float prismorphicTransmission;',
    'vec4 prismorphicEmission;',
    'float prismorphicOpacity;',
    'vec3 prismorphicNormalTs;',
    'float prismorphicDisplacement;',
    'bool prismorphicOutputEnabled;',
    'bool prismorphicEmissionDriven;',
    'bool prismorphicNormalDriven;',
    'bool prismorphicDisplacementDriven;',
    'bool prismorphicUnlit;',
    'float prismorphicAlbedoAuthority;',
    'prismorphic_evaluate_graph(',
    '  vPrismorphicUv,',
    '  vPrismorphicPosition,',
    '  normalize(vec3(',
    '    dot(normalize(vViewPosition), vPrismorphicAxisXView),',
    '    dot(normalize(vViewPosition), vPrismorphicAxisYView),',
    '    dot(normalize(vViewPosition), vPrismorphicAxisZView)',
    '  )),',
    '  uPrismorphicTime,',
    '  prismorphicBaseColor,',
    '  prismorphicMetallic,',
    '  prismorphicRoughness,',
    '  prismorphicTransmission,',
    '  prismorphicEmission,',
    '  prismorphicOpacity,',
    '  prismorphicNormalTs,',
    '  prismorphicDisplacement,',
    '  prismorphicOutputEnabled,',
    '  prismorphicEmissionDriven,',
    '  prismorphicNormalDriven,',
    '  prismorphicDisplacementDriven,',
    '  prismorphicUnlit,',
    '  prismorphicAlbedoAuthority',
    ');',
    'if (prismorphicOutputEnabled) {',
    '  diffuseColor = vec4(prismorphicBaseColor.rgb, prismorphicOpacity);',
    '  metalnessFactor = prismorphicMetallic;',
    '  roughnessFactor = prismorphicRoughness;',
    '  // Transmission applied via material.transmission in the production injector (Three r170).',
    '  if (prismorphicEmissionDriven) {',
    '    float prismorphicEmissionPeak = max(max(prismorphicEmission.r, prismorphicEmission.g), prismorphicEmission.b);',
    '    totalEmissiveRadiance = prismorphicEmission.rgb * max(prismorphicEmissionPeak, 0.35);',
    '  }',
    '  if (prismorphicUnlit) {',
    '    // Neutralize physical lighting; drive color via emissive for flat unlit output.',
    '    metalnessFactor = 0.0;',
    '    roughnessFactor = 1.0;',
    '    totalEmissiveRadiance = diffuseColor.rgb;',
    '  }',
    '} else {',
    '  diffuseColor = vec4(0.42, 0.43, 0.46, 0.08);',
    '  metalnessFactor = 0.0;',
    '  roughnessFactor = 1.0;',
    '  totalEmissiveRadiance = vec3(0.0);',
    '}',
  ].join('\n');

  const uniformValues = uniformValuesFromBindings(uniforms);
  const budgetReport = evaluateMaterialGraphGlslBudgets(graph, uniforms.length);

  return {
    version: MATERIAL_GRAPH_GLSL_VERSION,
    cacheKey,
    usedNodeTypes,
    reachableNodeIds: [...reachable].sort(compareStrings),
    usesNormalOutput,
    usesDisplacementOutput,
    outputBlend,
    surfaceMode,
    helpersSource,
    evaluateFunctionSource,
    uniformsSource,
    physicalFragmentChunk,
    timeUniformName: 'uPrismorphicTime',
    uniforms,
    uniformValues,
    budgetReport,
    fromCache: false,
  };
}

function emitNode(
  graph: MaterialGraphDocument,
  node: MaterialGraphNode,
  ports: Map<string, PortRef>,
  body: string[],
  uniforms: MaterialGraphGlslUniformBinding[],
): void {
  const id = glslId(node.id);
  const settings = nodeSettings(node);
  body.push(`  // node ${node.type} (${node.id})`);

  switch (node.type) {
    case 'value': {
      const name = `${id}_value`;
      const uniform = ensureUniform(uniforms, node, 'scalarValue', 'float', settings.scalarValue ?? 0.5);
      body.push(`  float ${name} = ${uniform};`);
      ports.set(portKey(node.id, 'value'), { expr: name, kind: 'scalar' });
      return;
    }
    case 'rgb': {
      const name = `${id}_color`;
      const uniform = ensureUniform(
        uniforms,
        node,
        'rgbColor',
        'vec4',
        parseHexColor(settings.rgbColor, [0.2, 0.55, 0.95, 1]),
      );
      body.push(`  vec4 ${name} = ${uniform};`);
      ports.set(portKey(node.id, 'color'), { expr: name, kind: 'color' });
      return;
    }
    case 'time': {
      const speed = ensureUniform(uniforms, node, 'timeSpeed', 'float', settings.timeSpeed ?? 1);
      const offset = ensureUniform(uniforms, node, 'timeOffset', 'float', settings.timeOffset ?? 0);
      body.push(`  float ${id}_time = elapsedSeconds * ${speed} + ${offset};`);
      body.push(`  float ${id}_sin = sin(${id}_time);`);
      body.push(`  float ${id}_cos = cos(${id}_time);`);
      ports.set(portKey(node.id, 'time'), { expr: `${id}_time`, kind: 'scalar' });
      ports.set(portKey(node.id, 'sin'), { expr: `${id}_sin`, kind: 'scalar' });
      ports.set(portKey(node.id, 'cos'), { expr: `${id}_cos`, kind: 'scalar' });
      return;
    }
    case 'base-color': {
      const name = `${id}_color`;
      const uniform = ensureUniform(
        uniforms,
        node,
        'rgbColor',
        'vec4',
        parseHexColor(settings.rgbColor, [0.82, 0.84, 0.88, 1]),
      );
      body.push(`  vec4 ${name} = ${uniform};`);
      ports.set(portKey(node.id, 'color'), { expr: name, kind: 'color' });
      return;
    }
    case 'metallic':
    case 'roughness': {
      const fallback = node.type === 'metallic' ? 0 : 0.5;
      const name = `${id}_value`;
      const uniform = ensureUniform(uniforms, node, 'scalarValue', 'float', settings.scalarValue ?? fallback);
      body.push(`  float ${name} = ${uniform};`);
      ports.set(portKey(node.id, 'value'), { expr: name, kind: 'scalar' });
      return;
    }
    case 'emission': {
      const name = `${id}_color`;
      const uniform = ensureUniform(
        uniforms,
        node,
        'rgbColor',
        'vec4',
        parseHexColor(settings.rgbColor, [0, 0, 0, 1]),
      );
      body.push(`  vec4 ${name} = ${uniform};`);
      ports.set(portKey(node.id, 'color'), { expr: name, kind: 'color' });
      return;
    }
    case 'opacity': {
      const name = `${id}_value`;
      const uniform = ensureUniform(uniforms, node, 'scalarValue', 'float', settings.scalarValue ?? 1);
      body.push(`  float ${name} = clamp(${uniform}, 0.0, 1.0);`);
      ports.set(portKey(node.id, 'value'), { expr: name, kind: 'scalar' });
      return;
    }
    case 'normal': {
      const name = `${id}_vector`;
      const ux = ensureUniform(uniforms, node, 'vectorX', 'float', settings.vectorX ?? 0);
      const uy = ensureUniform(uniforms, node, 'vectorY', 'float', settings.vectorY ?? 0);
      const uz = ensureUniform(uniforms, node, 'vectorZ', 'float', settings.vectorZ ?? 1);
      body.push(`  vec3 ${name} = vec3(${ux}, ${uy}, ${uz});`);
      ports.set(portKey(node.id, 'vector'), { expr: name, kind: 'vector' });
      return;
    }
    case 'displacement': {
      const name = `${id}_value`;
      const uniform = ensureUniform(uniforms, node, 'scalarValue', 'float', settings.scalarValue ?? 0);
      body.push(`  float ${name} = clamp(${uniform}, 0.0, 1.0);`);
      ports.set(portKey(node.id, 'value'), { expr: name, kind: 'scalar' });
      return;
    }
    case 'texture-coordinate': {
      const name = `${id}_uv`;
      const coordinate = settings.coordinateSpace === 'Object'
        ? '_object'
        : settings.coordinateSpace === 'Generated'
          ? '_generated'
          : '_uv';
      body.push(`  vec3 ${name} = ${coordinate};`);
      ports.set(portKey(node.id, 'uv'), { expr: name, kind: 'vector' });
      return;
    }
    case 'mapping': {
      const input = asVectorExpr(readInput(graph, ports, node.id, 'vector'), '_uv');
      const name = `${id}_vector`;
      const mx = ensureUniform(uniforms, node, 'mappingX', 'float', settings.mappingX ?? 1);
      const my = ensureUniform(uniforms, node, 'mappingY', 'float', settings.mappingY ?? 1);
      const mz = ensureUniform(uniforms, node, 'mappingZ', 'float', settings.mappingZ ?? 0);
      body.push(
        `  vec3 ${name} = vec3((${input}).x * ${mx}, (${input}).y * ${my}, (${input}).z + ${mz});`,
      );
      ports.set(portKey(node.id, 'vector'), { expr: name, kind: 'vector' });
      return;
    }
    case 'noise-texture': {
      const input = asVectorExpr(readInput(graph, ports, node.id, 'vector'), '_uv');
      const name = `${id}_factor`;
      const detail = ensureUniform(uniforms, node, 'noiseDetail', 'float', settings.noiseDetail ?? 4);
      const scale = ensureUniform(uniforms, node, 'noiseScale', 'float', settings.noiseScale ?? 1);
      const seed = ensureUniform(uniforms, node, 'noiseSeed', 'float', settings.noiseSeed ?? 0);
      const warp = ensureUniform(uniforms, node, 'noiseWarp', 'float', settings.noiseWarp ?? 0);
      const lacunarity = ensureUniform(
        uniforms,
        node,
        'noiseLacunarity',
        'float',
        settings.noiseLacunarity ?? 2,
      );
      const gain = ensureUniform(uniforms, node, 'noiseGain', 'float', settings.noiseGain ?? 0.5);
      const mode = settings.noiseMode === 'Ridged' ? 1 : settings.noiseMode === 'Turbulence' ? 2 : 0;
      body.push(
        `  float ${name} = prismorphic_fbm3((${input}) * ${scale}, ${detail}, ${lacunarity}, ${gain}, ${seed}, ${warp}, ${mode});`,
      );
      ports.set(portKey(node.id, 'factor'), { expr: name, kind: 'scalar' });
      return;
    }
    case 'wave-texture': {
      const input = asVectorExpr(readInput(graph, ports, node.id, 'vector'), '_uv');
      const name = `${id}_factor`;
      const waveType = settings.waveType ?? 'Sine';
      const waveCode = waveType === 'Saw' ? 1 : waveType === 'Triangle' ? 2 : 0;
      const scale = ensureUniform(uniforms, node, 'waveScale', 'float', settings.waveScale ?? 5);
      const distortion = ensureUniform(
        uniforms,
        node,
        'waveDistortion',
        'float',
        settings.waveDistortion ?? 0.25,
      );
      body.push(
        `  float ${name} = prismorphic_wave((${input}).x, (${input}).y, ${waveCode}, ${scale}, ${distortion});`,
      );
      ports.set(portKey(node.id, 'factor'), { expr: name, kind: 'scalar' });
      return;
    }
    case 'voronoi-texture': {
      const input = asVectorExpr(readInput(graph, ports, node.id, 'vector'), '_uv');
      const scale = ensureUniform(uniforms, node, 'voronoiScale', 'float', settings.voronoiScale ?? 4);
      const randomness = ensureUniform(
        uniforms,
        node,
        'voronoiRandomness',
        'float',
        settings.voronoiRandomness ?? 0.75,
      );
      body.push(`  vec4 ${id}_voronoi;`);
      body.push(
        `  ${id}_voronoi = prismorphic_voronoi((${input}).x, (${input}).y, ${scale}, ${randomness});`,
      );
      body.push(`  float ${id}_distance = ${id}_voronoi.w;`);
      body.push(`  vec4 ${id}_color = vec4(${id}_voronoi.xyz, 1.0);`);
      ports.set(portKey(node.id, 'distance'), { expr: `${id}_distance`, kind: 'scalar' });
      ports.set(portKey(node.id, 'color'), { expr: `${id}_color`, kind: 'color' });
      return;
    }
    case 'color-ramp': {
      const factor = asScalarExpr(readInput(graph, ports, node.id, 'factor'), '0.5');
      const start = ensureUniform(
        uniforms,
        node,
        'rampStart',
        'vec4',
        parseHexColor(settings.rampStart, [0.05, 0.08, 0.16, 1]),
      );
      const end = ensureUniform(
        uniforms,
        node,
        'rampEnd',
        'vec4',
        parseHexColor(settings.rampEnd, [0.55, 0.95, 1, 1]),
      );
      const mid = ensureUniform(uniforms, node, 'rampMidpoint', 'float', settings.rampMidpoint ?? 0.5);
      const interp = settings.rampInterpolation ?? 'Linear';
      // The midpoint moves where the ramp turns over, whatever shape follows
      // it. Applying it only on some branches left `Ease` ramps with a bound
      // uniform no shader line ever read, so the control that drives it moved
      // nothing on screen.
      body.push(`  float ${id}_t = clamp(${factor}, 0.0, 1.0);`);
      body.push(
        `  ${id}_t = ${id}_t < ${mid} ? (${id}_t / max(${mid}, 1e-8)) * 0.5 : 0.5 + ((${id}_t - ${mid}) / max(1e-8, 1.0 - ${mid})) * 0.5;`,
      );
      if (interp === 'Ease') {
        body.push(`  ${id}_t = ${id}_t * ${id}_t * (3.0 - 2.0 * ${id}_t);`);
      } else if (interp === 'Constant') {
        // The remap sends the midpoint to 0.5, so the step sits there now.
        body.push(`  ${id}_t = ${id}_t < 0.5 ? 0.0 : 1.0;`);
      }
      body.push(`  vec4 ${id}_color = mix(${start}, ${end}, clamp(${id}_t, 0.0, 1.0));`);
      ports.set(portKey(node.id, 'color'), { expr: `${id}_color`, kind: 'color' });
      return;
    }
    case 'math': {
      const a = asScalarExpr(readInput(graph, ports, node.id, 'a'), '0.0');
      const b = asScalarExpr(readInput(graph, ports, node.id, 'b'), '0.0');
      const op = settings.mathOperation ?? 'Add';
      let expr = `(${a}) + (${b})`;
      if (op === 'Subtract') expr = `(${a}) - (${b})`;
      else if (op === 'Multiply') expr = `(${a}) * (${b})`;
      else if (op === 'Divide') expr = `(abs(${b}) < 1e-8 ? 0.0 : (${a}) / (${b}))`;
      else if (op === 'Power') expr = `pow(max(${a}, 0.0), ${b})`;
      else if (op === 'Minimum') expr = `min(${a}, ${b})`;
      else if (op === 'Maximum') expr = `max(${a}, ${b})`;
      body.push(`  float ${id}_value = ${expr};`);
      ports.set(portKey(node.id, 'value'), { expr: `${id}_value`, kind: 'scalar' });
      return;
    }
    case 'mix': {
      const a = asColorExpr(readInput(graph, ports, node.id, 'a'), 'vec4(0.0, 0.0, 0.0, 1.0)');
      const b = asColorExpr(readInput(graph, ports, node.id, 'b'), 'vec4(1.0, 1.0, 1.0, 1.0)');
      const mixDefault = ensureUniform(uniforms, node, 'mixFactor', 'float', settings.mixFactor ?? 0.5);
      const factor = asScalarExpr(readInput(graph, ports, node.id, 'factor'), mixDefault);
      body.push(`  vec4 ${id}_color = mix(${a}, ${b}, clamp(${factor}, 0.0, 1.0));`);
      ports.set(portKey(node.id, 'color'), { expr: `${id}_color`, kind: 'color' });
      return;
    }
    case 'map-range': {
      const value = asScalarExpr(readInput(graph, ports, node.id, 'value'), '0.0');
      const fromMin = ensureUniform(uniforms, node, 'mapFromMin', 'float', settings.mapFromMin ?? 0);
      const fromMax = ensureUniform(uniforms, node, 'mapFromMax', 'float', settings.mapFromMax ?? 1);
      const toMin = ensureUniform(uniforms, node, 'mapToMin', 'float', settings.mapToMin ?? 0);
      const toMax = ensureUniform(uniforms, node, 'mapToMax', 'float', settings.mapToMax ?? 1);
      const clampMapped = ensureUniform(
        uniforms,
        node,
        'mapClamp',
        'bool',
        settings.mapClamp !== false,
      );
      body.push(`  float ${id}_span = ${fromMax} - ${fromMin};`);
      body.push(
        `  float ${id}_normalized = abs(${id}_span) < 1e-8 ? 0.0 : ((${value}) - ${fromMin}) / ${id}_span;`,
      );
      body.push(`  float ${id}_mapped = ${toMin} + ${id}_normalized * (${toMax} - ${toMin});`);
      body.push(
        `  float ${id}_value = ${clampMapped} ? clamp(${id}_mapped, min(${toMin}, ${toMax}), max(${toMin}, ${toMax})) : ${id}_mapped;`,
      );
      ports.set(portKey(node.id, 'value'), { expr: `${id}_value`, kind: 'scalar' });
      return;
    }
    case 'invert': {
      const factor = asScalarExpr(readInput(graph, ports, node.id, 'factor'), '0.0');
      body.push(`  float ${id}_factor = 1.0 - (${factor});`);
      ports.set(portKey(node.id, 'factor'), { expr: `${id}_factor`, kind: 'scalar' });
      return;
    }
    case 'fresnel': {
      const ior = ensureUniform(uniforms, node, 'fresnelIor', 'float', settings.fresnelIor ?? 1.45);
      const power = ensureUniform(uniforms, node, 'fresnelPower', 'float', settings.fresnelPower ?? 5);
      const authoredBias = ensureUniform(uniforms, node, 'fresnelBias', 'float', settings.fresnelBias ?? 0.02);
      const intensity = ensureUniform(uniforms, node, 'fresnelIntensity', 'float', settings.fresnelIntensity ?? 1);
      const invert = ensureUniform(uniforms, node, 'fresnelInvert', 'bool', settings.fresnelInvert ?? false);
      const tint = ensureUniform(
        uniforms,
        node,
        'fresnelColor',
        'vec4',
        parseHexColor(settings.fresnelColor, [0.239216, 0.921569, 1, 1]),
      );
      // Prefer a geometric normal from object position (sphere/gem-friendly), then
      // fall back to +Z. Facing uses the object-space view direction so the rim
      // tracks the camera instead of a fixed object axis.
      body.push(`  vec3 ${id}_normal = length(_object) > 1e-5 ? normalize(_object) : vec3(0.0, 0.0, 1.0);`);
      body.push(`  vec3 ${id}_view = length(_view_dir) > 1e-5 ? normalize(_view_dir) : vec3(0.0, 0.0, 1.0);`);
      body.push(`  float ${id}_facing = abs(dot(${id}_normal, ${id}_view));`);
      body.push(`  float ${id}_ior = clamp(${ior}, 1.0, 2.5);`);
      body.push(`  float ${id}_f0 = pow((${id}_ior - 1.0) / (${id}_ior + 1.0), 2.0);`);
      body.push(`  float ${id}_bias = max(clamp(${authoredBias}, 0.0, 1.0), ${id}_f0);`);
      body.push(`  float ${id}_rim = clamp(${id}_bias + (1.0 - ${id}_bias) * pow(1.0 - clamp(${id}_facing, 0.0, 1.0), clamp(${power}, 0.25, 12.0)), 0.0, 1.0);`);
      body.push(`  ${id}_rim = ${invert} ? 1.0 - ${id}_rim : ${id}_rim;`);
      body.push(`  float ${id}_factor = clamp(${id}_rim, 0.0, 1.0);`);
      body.push(`  float ${id}_scale = ${id}_rim * clamp(${intensity}, 0.0, 8.0);`);
      // Allow HDR rim contribution so emissiveIntensity can bloom without clipping.
      body.push(`  vec4 ${id}_color = vec4(max(${tint}.rgb * ${id}_scale, 0.0), ${tint}.a);`);
      ports.set(portKey(node.id, 'factor'), { expr: `${id}_factor`, kind: 'scalar' });
      ports.set(portKey(node.id, 'color'), { expr: `${id}_color`, kind: 'color' });
      return;
    }
    case 'prism-dispersion': {
      const color = asColorExpr(readInput(graph, ports, node.id, 'color'), 'vec4(0.55, 0.95, 1.0, 1.0)');
      const factor = asScalarExpr(readInput(graph, ports, node.id, 'factor'), '0.5');
      const spectrum = ensureUniform(uniforms, node, 'prismSpectrum', 'float', settings.prismSpectrum ?? 0.62);
      const strength = ensureUniform(uniforms, node, 'prismStrength', 'float', settings.prismStrength ?? 1);
      body.push(`  vec4 ${id}_in = ${color};`);
      body.push(`  float ${id}_f = ${factor};`);
      body.push(
        `  vec4 ${id}_color = vec4(clamp(${id}_in.r + ${strength} * ${spectrum} * 0.15 * ${id}_f, 0.0, 1.0), clamp(${id}_in.g * (1.0 - ${strength} * 0.15 + ${strength} * ${id}_f * 0.2), 0.0, 1.0), clamp(${id}_in.b + ${strength} * (1.0 - ${spectrum}) * 0.1, 0.0, 1.0), ${id}_in.a);`,
      );
      ports.set(portKey(node.id, 'color'), { expr: `${id}_color`, kind: 'color' });
      return;
    }
    case 'scanlines': {
      const input = asVectorExpr(readInput(graph, ports, node.id, 'vector'), '_uv');
      const axis = settings.scanlineAxis ?? 'Y';
      body.push(`  vec3 ${id}_in = ${input};`);
      const coord = axis === 'X' ? `${id}_in.x` : axis === 'Z' ? `${id}_in.z` : `${id}_in.y`;
      const other1 = axis === 'X' ? `${id}_in.y` : `${id}_in.x`;
      const other2 = axis === 'Z' ? `${id}_in.y` : `${id}_in.z`;
      const density = ensureUniform(uniforms, node, 'scanlineDensity', 'float', settings.scanlineDensity ?? 96);
      const thickness = ensureUniform(uniforms, node, 'scanlineThickness', 'float', settings.scanlineThickness ?? 0.22);
      const softness = ensureUniform(uniforms, node, 'scanlineSoftness', 'float', settings.scanlineSoftness ?? 0.08);
      const intensity = ensureUniform(uniforms, node, 'scanlineIntensity', 'float', settings.scanlineIntensity ?? 1);
      const speed = ensureUniform(uniforms, node, 'scanlineSpeed', 'float', settings.scanlineSpeed ?? 0.35);
      const distortion = ensureUniform(uniforms, node, 'scanlineDistortion', 'float', settings.scanlineDistortion ?? 0.35);
      const phase = ensureUniform(uniforms, node, 'scanlinePhase', 'float', settings.scanlinePhase ?? 0);
      body.push(
        `  float ${id}_factor = prismorphic_scanlines(${coord}, ${other1}, ${other2}, ${density}, ${thickness}, ${softness}, ${intensity}, ${speed}, ${distortion}, ${phase}, elapsedSeconds);`,
      );
      ports.set(portKey(node.id, 'factor'), { expr: `${id}_factor`, kind: 'scalar' });
      return;
    }
    case 'domain-warp': {
      const input = asVectorExpr(readInput(graph, ports, node.id, 'vector'), '_uv');
      const amount = ensureUniform(uniforms, node, 'warpAmount', 'float', settings.warpAmount ?? 0.35);
      const scale = ensureUniform(uniforms, node, 'warpScale', 'float', settings.warpScale ?? 2);
      const speed = ensureUniform(uniforms, node, 'warpSpeed', 'float', settings.warpSpeed ?? 0.15);
      const seed = ensureUniform(uniforms, node, 'warpSeed', 'float', settings.warpSeed ?? 0);
      body.push(
        `  vec3 ${id}_vector = prismorphic_domain_warp(${input}, ${amount}, ${scale}, ${speed}, ${seed}, elapsedSeconds);`,
      );
      ports.set(portKey(node.id, 'vector'), { expr: `${id}_vector`, kind: 'vector' });
      return;
    }
    case 'glitch-bands': {
      const input = asVectorExpr(readInput(graph, ports, node.id, 'vector'), '_uv');
      body.push(`  vec3 ${id}_in = ${input};`);
      const amount = ensureUniform(uniforms, node, 'glitchAmount', 'float', settings.glitchAmount ?? 0.18);
      const frequency = ensureUniform(uniforms, node, 'glitchFrequency', 'float', settings.glitchFrequency ?? 14);
      const bandSize = ensureUniform(uniforms, node, 'glitchBandSize', 'float', settings.glitchBandSize ?? 0.08);
      const offsetAmount = ensureUniform(uniforms, node, 'glitchOffset', 'float', settings.glitchOffset ?? 0.12);
      const duration = ensureUniform(uniforms, node, 'glitchDuration', 'float', settings.glitchDuration ?? 0.22);
      const speed = ensureUniform(uniforms, node, 'glitchSpeed', 'float', settings.glitchSpeed ?? 0.55);
      const seed = ensureUniform(uniforms, node, 'glitchSeed', 'float', settings.glitchSeed ?? 17);
      body.push(
        `  vec2 ${id}_glitch = prismorphic_glitch_bands(${id}_in.y, ${amount}, ${frequency}, ${bandSize}, ${offsetAmount}, ${duration}, ${speed}, ${seed}, elapsedSeconds);`,
      );
      body.push(`  float ${id}_factor = ${id}_glitch.x;`);
      body.push(`  float ${id}_offset = ${id}_glitch.y;`);
      body.push(`  vec3 ${id}_vector = ${id}_in + vec3(${id}_offset, 0.0, 0.0);`);
      ports.set(portKey(node.id, 'factor'), { expr: `${id}_factor`, kind: 'scalar' });
      ports.set(portKey(node.id, 'offset'), { expr: `${id}_offset`, kind: 'scalar' });
      ports.set(portKey(node.id, 'vector'), { expr: `${id}_vector`, kind: 'vector' });
      return;
    }
    case 'digital-fragments': {
      const input = asVectorExpr(readInput(graph, ports, node.id, 'vector'), '_uv');
      body.push(`  vec3 ${id}_in = ${input};`);
      const scale = ensureUniform(uniforms, node, 'fragmentScale', 'float', settings.fragmentScale ?? 64);
      const density = ensureUniform(uniforms, node, 'fragmentDensity', 'float', settings.fragmentDensity ?? 0.22);
      const threshold = ensureUniform(uniforms, node, 'fragmentThreshold', 'float', settings.fragmentThreshold ?? 0.82);
      const seed = ensureUniform(uniforms, node, 'fragmentSeed', 'float', settings.fragmentSeed ?? 31);
      const speed = ensureUniform(uniforms, node, 'fragmentSpeed', 'float', settings.fragmentSpeed ?? 0.2);
      body.push(
        `  float ${id}_factor = prismorphic_digital_fragments(${id}_in.xy, ${scale}, ${density}, ${threshold}, ${seed}, ${speed}, elapsedSeconds);`,
      );
      ports.set(portKey(node.id, 'factor'), { expr: `${id}_factor`, kind: 'scalar' });
      return;
    }
    case 'chromatic-split': {
      const color = asColorExpr(readInput(graph, ports, node.id, 'color'), 'vec4(0.55, 0.95, 1.0, 1.0)');
      const factor = asScalarExpr(readInput(graph, ports, node.id, 'factor'), '0.0');
      const strength = ensureUniform(uniforms, node, 'chromaStrength', 'float', settings.chromaStrength ?? 0.22);
      const edgeBias = ensureUniform(uniforms, node, 'chromaEdgeBias', 'float', settings.chromaEdgeBias ?? 0.55);
      const cyan = ensureUniform(
        uniforms,
        node,
        'chromaCyan',
        'vec4',
        parseHexColor(settings.chromaCyan, [0.239216, 0.921569, 1, 1]),
      );
      const magenta = ensureUniform(
        uniforms,
        node,
        'chromaMagenta',
        'vec4',
        parseHexColor(settings.chromaMagenta, [0.788235, 0.447059, 1, 1]),
      );
      body.push(`  vec4 ${id}_in = ${color};`);
      body.push(
        `  float ${id}_amount = clamp(clamp(${factor}, 0.0, 1.0) * ${strength} * (0.5 + ${edgeBias} * 0.5), 0.0, 1.0);`,
      );
      body.push(`  vec3 ${id}_fringe = (${cyan}.rgb + ${magenta}.rgb) * 0.5;`);
      body.push(`  vec3 ${id}_rgb = clamp(mix(${id}_in.rgb, ${id}_fringe, ${id}_amount), 0.0, 1.0);`);
      body.push(`  vec4 ${id}_color = vec4(${id}_rgb, ${id}_in.a);`);
      ports.set(portKey(node.id, 'color'), { expr: `${id}_color`, kind: 'color' });
      return;
    }
    case 'pulse': {
      const speed = ensureUniform(uniforms, node, 'pulseSpeed', 'float', settings.pulseSpeed ?? 0.45);
      const amount = ensureUniform(uniforms, node, 'pulseAmount', 'float', settings.pulseAmount ?? 0.35);
      const phase = ensureUniform(uniforms, node, 'pulsePhase', 'float', settings.pulsePhase ?? 0);
      const sharpness = ensureUniform(uniforms, node, 'pulseSharpness', 'float', settings.pulseSharpness ?? 1.5);
      body.push(`  float ${id}_factor = prismorphic_pulse(${speed}, ${amount}, ${phase}, ${sharpness}, elapsedSeconds);`);
      ports.set(portKey(node.id, 'factor'), { expr: `${id}_factor`, kind: 'scalar' });
      return;
    }
    case 'pbr-surface': {
      const emissionIn = readInput(graph, ports, node.id, 'emission');
      const normalIn = readInput(graph, ports, node.id, 'normal');
      const displacementIn = readInput(graph, ports, node.id, 'displacement');
      emitSurfacePorts(graph, ports, body, id, node.id, {
        baseColor: asColorExpr(readInput(graph, ports, node.id, 'baseColor'), 'vec4(0.82, 0.84, 0.88, 1.0)'),
        metallic: asScalarExpr(readInput(graph, ports, node.id, 'metallic'), '0.0'),
        roughness: asScalarExpr(readInput(graph, ports, node.id, 'roughness'), '0.5'),
        transmission: '0.55',
        emission: asColorExpr(emissionIn, 'vec4(0.0, 0.0, 0.0, 1.0)'),
        opacity: asScalarExpr(readInput(graph, ports, node.id, 'opacity'), '1.0'),
        normal: asVectorExpr(normalIn, 'vec3(0.0, 0.0, 1.0)'),
        displacement: asScalarExpr(displacementIn, '0.0'),
        emissionDriven: Boolean(emissionIn),
        normalDriven: Boolean(normalIn),
        displacementDriven: Boolean(displacementIn),
        unlit: false,
        tintFromBase: true,
      });
      ports.set(portKey(node.id, 'shader'), { expr: id, kind: 'shader' });
      return;
    }
    case 'unlit-surface': {
      emitSurfacePorts(graph, ports, body, id, node.id, {
        baseColor: asColorExpr(readInput(graph, ports, node.id, 'baseColor'), 'vec4(0.82, 0.84, 0.88, 1.0)'),
        metallic: '0.0',
        roughness: '1.0',
        transmission: '0.0',
        emission: 'vec4(0.0, 0.0, 0.0, 1.0)',
        opacity: '1.0',
        normal: 'vec3(0.0, 0.0, 1.0)',
        displacement: '0.0',
        emissionDriven: false,
        normalDriven: false,
        displacementDriven: false,
        unlit: true,
        tintFromBase: true,
      });
      ports.set(portKey(node.id, 'shader'), { expr: id, kind: 'shader' });
      return;
    }
    case 'glass-surface': {
      const tint = asColorExpr(readInput(graph, ports, node.id, 'tint'), 'vec4(0.82, 0.84, 0.88, 1.0)');
      const transmissionFallback = ensureUniform(
        uniforms,
        node,
        'surfaceTransmission',
        'float',
        settings.surfaceTransmission ?? 0.55,
      );
      emitSurfacePorts(graph, ports, body, id, node.id, {
        baseColor: tint,
        metallic: '0.0',
        roughness: asScalarExpr(readInput(graph, ports, node.id, 'roughness'), '0.5'),
        transmission: asScalarExpr(readInput(graph, ports, node.id, 'transmission'), transmissionFallback),
        emission: 'vec4(0.0, 0.0, 0.0, 1.0)',
        opacity: '1.0',
        normal: 'vec3(0.0, 0.0, 1.0)',
        displacement: '0.0',
        emissionDriven: false,
        normalDriven: false,
        displacementDriven: false,
        unlit: false,
        tintFromBase: true,
      });
      ports.set(portKey(node.id, 'shader'), { expr: id, kind: 'shader' });
      return;
    }
    case 'surface-blend': {
      emitSurfaceBlend(graph, node, ports, body, id);
      return;
    }
    case 'material-output':
      return;
    default:
      return;
  }
}

/**
 * Emits one slot operator (D2-1 §4.2). The mode is structural, so the branch is
 * taken here and the shader carries only the operator the slot chose: the host
 * keeps its body, the guest lends its skin.
 */
function emitSurfaceBlend(
  graph: MaterialGraphDocument,
  node: MaterialGraphNode,
  ports: Map<string, PortRef>,
  body: string[],
  id: string,
): void {
  const hostRef = readInput(graph, ports, node.id, 'host');
  const guestRef = readInput(graph, ports, node.id, 'guest');
  const host = hostRef?.kind === 'shader' ? hostRef.expr : null;
  const guest = guestRef?.kind === 'shader' ? guestRef.expr : null;

  // A half-wired blend passes through the surface it does have, so an
  // unfinished composition still reaches the output instead of going dark.
  if (!host || !guest) {
    const single = host ?? guest;
    if (single) ports.set(portKey(node.id, 'shader'), { expr: single, kind: 'shader' });
    return;
  }

  const constants = MATERIAL_GRAPH_SURFACE_BLEND_CONSTANTS;
  const mode: MaterialRecipeSlotMode = nodeSettings(node).blendMode ?? 'over';
  const maskRef = readInput(graph, ports, node.id, 'mask');
  const amountRef = readInput(graph, ports, node.id, 'amount');


  // §4.2 reads the coverage ramp over the host noise; a constant field would
  // saturate the ramp and leave the Quantity slider inert over most of its
  // travel, so an unwired mask falls back on a field of its own.
  const defaultField = `prismorphic_fbm3(_object * ${glslFloat(constants.defaultFieldScale)}, ${glslFloat(constants.defaultFieldDetail)}, 2.0, 0.5, ${glslFloat(materialGraphBlendFieldSeed(node.id))}, 0.0, 0)`;
  body.push(`  float ${id}_amount = clamp(${asScalarExpr(amountRef, '1.0')}, 0.0, 1.0);`);
  body.push(`  float ${id}_field = clamp(${asScalarExpr(maskRef, defaultField)}, 0.0, 1.0);`);
  body.push(
    `  float ${id}_edge0 = 1.0 - ${id}_amount * ${glslFloat(constants.coverageGain)};`,
  );
  body.push(
    `  float ${id}_coverage = smoothstep(${id}_edge0, ${id}_edge0 + ${glslFloat(constants.coverageSoftness)}, ${id}_field);`,
  );
  body.push(`  float ${id}_mask = ${blendMaskExpr(mode, id, host, constants)};`);
  body.push(`  _blend_authority = max(_blend_authority, ${id}_mask);`);

  if (mode === 'inside') {
    body.push(
      `  vec4 ${id}_inclusion = vec4(${guest}_baseColor.rgb * ${glslFloat(constants.insideGuestAlbedo)} * mix(vec3(1.0), ${host}_tint.rgb, ${glslFloat(constants.insideHostTint)}), ${guest}_baseColor.a);`,
    );
    body.push(`  vec4 ${id}_baseColor = mix(${host}_baseColor, ${id}_inclusion, ${id}_mask);`);
    // The host keeps its relief, and most of its reflection: an inclusion sits
    // in the volume rather than replacing the skin. It does bring some of its
    // own, or a guest's Glossy and Metallic sliders would move nothing.
    body.push(
      `  float ${id}_reflectance = ${id}_mask * ${glslFloat(constants.insideReflectanceShare)};`,
    );
    body.push(
      `  float ${id}_metallic = mix(${host}_metallic, ${guest}_metallic, ${id}_reflectance);`,
    );
    body.push(
      `  float ${id}_roughness = mix(${host}_roughness, ${guest}_roughness, ${id}_reflectance);`,
    );
    body.push(
      `  float ${id}_transmission = ${host}_transmission * (1.0 - ${id}_mask * ${glslFloat(1 - constants.insideTransmissionDrop)});`,
    );
    body.push(`  vec4 ${id}_tint = mix(${host}_tint, ${id}_inclusion, ${id}_mask);`);
    body.push(
      `  vec4 ${id}_emission = vec4(${host}_emission.rgb + ${guest}_emission.rgb * ${id}_mask * ${glslFloat(constants.insideEmission)}, ${host}_emission.a);`,
    );
    body.push(`  float ${id}_opacity = ${host}_opacity;`);
    body.push(`  vec3 ${id}_normal = ${host}_normal;`);
    body.push(`  float ${id}_displacement = ${host}_displacement;`);
    body.push(`  bool ${id}_normalDriven = ${host}_normalDriven;`);
    body.push(`  bool ${id}_displacementDriven = ${host}_displacementDriven;`);
  } else {
    const keepHostRelief = mode === 'edge';
    body.push(`  vec4 ${id}_baseColor = mix(${host}_baseColor, ${guest}_baseColor, ${id}_mask);`);
    body.push(`  float ${id}_metallic = mix(${host}_metallic, ${guest}_metallic, ${id}_mask);`);
    body.push(`  float ${id}_roughness = mix(${host}_roughness, ${guest}_roughness, ${id}_mask);`);
    body.push(
      `  float ${id}_transmission = mix(${host}_transmission, ${guest}_transmission, ${id}_mask);`,
    );
    body.push(`  vec4 ${id}_tint = mix(${host}_tint, ${guest}_tint, ${id}_mask);`);
    body.push(
      `  vec4 ${id}_emission = vec4(${host}_emission.rgb + ${guest}_emission.rgb * ${id}_mask, ${host}_emission.a);`,
    );
    body.push(`  float ${id}_opacity = mix(${host}_opacity, ${guest}_opacity, ${id}_mask);`);
    body.push(
      keepHostRelief
        ? `  vec3 ${id}_normal = ${host}_normal;`
        : `  vec3 ${id}_normal = mix(${host}_normal, ${guest}_normal, ${id}_mask);`,
    );
    body.push(
      keepHostRelief
        ? `  float ${id}_displacement = ${host}_displacement;`
        : `  float ${id}_displacement = mix(${host}_displacement, ${guest}_displacement, ${id}_mask);`,
    );
    body.push(
      keepHostRelief
        ? `  bool ${id}_normalDriven = ${host}_normalDriven;`
        : `  bool ${id}_normalDriven = ${host}_normalDriven || ${guest}_normalDriven;`,
    );
    body.push(
      keepHostRelief
        ? `  bool ${id}_displacementDriven = ${host}_displacementDriven;`
        : `  bool ${id}_displacementDriven = ${host}_displacementDriven || ${guest}_displacementDriven;`,
    );
  }

  body.push(`  bool ${id}_emissionDriven = ${host}_emissionDriven || ${guest}_emissionDriven;`);
  // Unlit only survives when neither side asks to be lit.
  body.push(`  bool ${id}_unlit = ${host}_unlit && ${guest}_unlit;`);
  ports.set(portKey(node.id, 'shader'), { expr: id, kind: 'shader' });
}

/** Effective mask per slot mode (D2-1 §4.2). */
function blendMaskExpr(
  mode: MaterialRecipeSlotMode,
  id: string,
  host: string,
  constants: typeof MATERIAL_GRAPH_SURFACE_BLEND_CONSTANTS,
): string {
  switch (mode) {
    case 'inside':
      return `clamp(${id}_coverage * (${glslFloat(constants.insideTransmissionFloor)} + ${glslFloat(constants.insideTransmissionSpan)} * clamp(${host}_transmission, 0.0, 1.0)), 0.0, 1.0)`;
    case 'cavity':
      return `clamp(${id}_coverage * ${id}_field, 0.0, 1.0)`;
    case 'veins':
      return `clamp(clamp(${id}_field * ${glslFloat(constants.veinsGain)}, 0.0, 1.0) * ${id}_amount, 0.0, 1.0)`;
    case 'edge':
      return `clamp(${id}_field * ${glslFloat(constants.edgeFresnelGain)} * ${id}_amount + ${id}_coverage * ${glslFloat(constants.edgeCoverage)}, 0.0, 1.0)`;
    case 'over':
    default:
      return `${id}_coverage`;
  }
}


/* ---------------------------------------------------------------------------
 * Recipe partitioning (D2-1 §5.1)
 * ------------------------------------------------------------------------- */

type GraphEdge = MaterialGraphDocument['edges'][number];

interface RecipePartition {
  /** Instance name, used verbatim in the GLSL function name. */
  name: string;
  nodes: MaterialGraphNode[];
  /** Ports produced here and read outside; they become out-params. */
  exports: { nodeId: string; portId: string; kind: PortKind; param: string }[];
  /** Blend whose `guest` this partition feeds; null for the root recipe. */
  guestOfBlendId: string | null;
}

interface RecipePartitionPlan {
  partitions: RecipePartition[];
  blends: MaterialGraphNode[];
  /** Reachable nodes each blend owns through its `guest` edge, blend id → set. */
  dominatedByBlend: Map<string, Set<string>>;
}

/** The surface a recipe function hands back, matching MaterialGraphSurfaceValue. */
const PRISM_SURFACE_STRUCT_SOURCE = [
  'struct PrismSurface {',
  '  vec4 baseColor;',
  '  float metallic;',
  '  float roughness;',
  '  float transmission;',
  '  vec4 tint;',
  '  vec4 emission;',
  '  float opacity;',
  '  vec3 normal;',
  '  float displacement;',
  '  bool emissionDriven;',
  '  bool normalDriven;',
  '  bool displacementDriven;',
  '  bool unlit;',
  '};',
  '',
].join('\n');

const SURFACE_FIELDS = [
  'baseColor',
  'metallic',
  'roughness',
  'transmission',
  'tint',
  'emission',
  'opacity',
  'normal',
  'displacement',
  'emissionDriven',
  'normalDriven',
  'displacementDriven',
  'unlit',
] as const;

function pushCoordinatePreamble(body: string[]): void {
  body.push('  vec3 _uv = vec3(uv, 0.0);');
  body.push('  vec3 _object = objectPosition;');
  body.push('  vec3 _view_dir = viewDirection;');
  body.push('  vec3 _generated = objectPosition * 0.5 + 0.5;');
}

function glslTypeForKind(kind: PortKind): string {
  switch (kind) {
    case 'scalar':
      return 'float';
    case 'color':
      return 'vec4';
    case 'vector':
      return 'vec3';
    case 'shader':
      return 'PrismSurface';
  }
}

/**
 * Splits a reachable graph into one partition per recipe instance, with the
 * surface-blend nodes hoisted into the program body: the program calls the
 * recipe functions, then applies the blends (§5.1).
 *
 * A guest partition is the dominator set of its blend's `guest` edge — the
 * nodes whose every path to the output runs through that edge. What is left is
 * the root recipe. Returns null when the split would not be clean (no blend, or
 * a partition reading a port produced outside it), and the compiler inlines the
 * whole graph exactly as it did before D2-1.
 */
function planRecipePartitions(
  graph: MaterialGraphDocument,
  reachable: Set<string>,
  ordered: MaterialGraphNode[],
): RecipePartitionPlan | null {
  const blends = ordered.filter((node) => node.type === 'surface-blend');
  if (blends.length === 0) return null;
  const outputNode = ordered.find((node) => node.type === 'material-output');
  if (!outputNode) return null;

  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    if (!reachable.has(edge.fromNode) || !reachable.has(edge.toNode)) continue;
    const from = outgoing.get(edge.fromNode);
    if (from) from.push(edge);
    else outgoing.set(edge.fromNode, [edge]);
    const to = incoming.get(edge.toNode);
    if (to) to.push(edge);
    else incoming.set(edge.toNode, [edge]);
  }

  const seam = new Set<string>([outputNode.id, ...blends.map((node) => node.id)]);
  const dominatedByBlend = new Map<string, Set<string>>();
  const assigned = new Map<string, string>();
  const partitions: RecipePartition[] = [];
  const usedNames = new Set<string>();

  const claim = (nodes: MaterialGraphNode[], key: string, fallbackName: string): void => {
    for (const node of nodes) assigned.set(node.id, key);
    let name = partitionName(nodes, fallbackName);
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${partitionName(nodes, fallbackName)}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);
    partitions.push({
      name,
      nodes,
      exports: [],
      guestOfBlendId: key === 'root' ? null : key,
    });
  };

  for (const blend of blends) {
    const guestEdge = (incoming.get(blend.id) ?? []).find((edge) => edge.toPort === 'guest');
    if (!guestEdge) continue;
    const dominated = dominatedByEdge(reachable, incoming, outputNode.id, guestEdge);
    dominatedByBlend.set(blend.id, dominated);
    const nodes = ordered.filter(
      (node) => dominated.has(node.id) && !seam.has(node.id) && !assigned.has(node.id),
    );
    if (nodes.length === 0) continue;
    claim(nodes, blend.id, blend.id);
  }

  const rootNodes = ordered.filter((node) => !assigned.has(node.id) && !seam.has(node.id));
  if (rootNodes.length === 0) return null;
  claim(rootNodes, 'root', 'root');

  const partitionOf = (nodeId: string): string | undefined =>
    seam.has(nodeId) ? 'seam' : assigned.get(nodeId);

  for (const partition of partitions) {
    const key = partition.guestOfBlendId ?? 'root';
    // Self-contained or nothing: an expert who wires a host node straight into
    // a guest breaks the split, and the flat path still renders it correctly.
    for (const node of partition.nodes) {
      for (const edge of incoming.get(node.id) ?? []) {
        if (partitionOf(edge.fromNode) !== key) return null;
      }
    }
    const seen = new Set<string>();
    for (const node of partition.nodes) {
      for (const edge of outgoing.get(node.id) ?? []) {
        if (partitionOf(edge.toNode) === key) continue;
        const exportKey = `${edge.fromNode}:${edge.fromPort}`;
        if (seen.has(exportKey)) continue;
        seen.add(exportKey);
        const kind = node.outputs.find((port) => port.id === edge.fromPort)?.tone;
        if (!kind) return null;
        partition.exports.push({
          nodeId: edge.fromNode,
          portId: edge.fromPort,
          kind,
          param: `out_${glslId(edge.fromNode)}_${edge.fromPort}`,
        });
      }
    }
    if (partition.exports.length === 0) return null;
  }

  return { partitions, blends, dominatedByBlend };
}

/** Nodes whose every path to the output runs through `removed`. */
function dominatedByEdge(
  reachable: Set<string>,
  incoming: Map<string, GraphEdge[]>,
  outputId: string,
  removed: GraphEdge,
): Set<string> {
  const stillReaches = new Set<string>([outputId]);
  const stack = [outputId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const edge of incoming.get(current) ?? []) {
      if (edge === removed || stillReaches.has(edge.fromNode)) continue;
      stillReaches.add(edge.fromNode);
      stack.push(edge.fromNode);
    }
  }
  const dominated = new Set<string>();
  for (const nodeId of reachable) {
    if (!stillReaches.has(nodeId)) dominated.add(nodeId);
  }
  return dominated;
}

/**
 * Instance name of a partition: the longest dotted prefix its nodes share,
 * which is the instanceId the unfolding gave them (§3.2). Falls back to the
 * blend id when they share nothing, so the function still gets a name.
 */
function partitionName(nodes: MaterialGraphNode[], fallback: string): string {
  const segments = nodes.map((node) => node.id.split('.').slice(0, -1));
  let common = segments[0] ?? [];
  for (const candidate of segments) {
    let index = 0;
    while (index < common.length && index < candidate.length && common[index] === candidate[index]) {
      index += 1;
    }
    common = common.slice(0, index);
  }
  return glslId(common.length > 0 ? common.join('.') : fallback);
}

/** Emits `void prismorphic_recipe_<instance>(…)` for one partition. */
function emitRecipeFunction(
  graph: MaterialGraphDocument,
  partition: RecipePartition,
  uniforms: MaterialGraphGlslUniformBinding[],
): string {
  const ports = new Map<string, PortRef>();
  const body: string[] = [];
  pushCoordinatePreamble(body);
  for (const node of partition.nodes) {
    emitNode(graph, node, ports, body, uniforms);
  }
  for (const item of partition.exports) {
    const ref = ports.get(portKey(item.nodeId, item.portId));
    if (!ref) {
      body.push(`  // unresolved export ${item.nodeId}.${item.portId}`);
      body.push(`  ${item.param} = ${defaultExportExpr(item.kind)};`);
      continue;
    }
    if (item.kind === 'shader') {
      for (const field of SURFACE_FIELDS) {
        body.push(`  ${item.param}.${field} = ${ref.expr}_${field};`);
      }
    } else {
      body.push(`  ${item.param} = ${ref.expr};`);
    }
  }
  return [
    `void prismorphic_recipe_${partition.name}(`,
    '  vec2 uv,',
    '  vec3 objectPosition,',
    '  vec3 viewDirection,',
    '  float elapsedSeconds,',
    partition.exports
      .map((item, index) => {
        const comma = index === partition.exports.length - 1 ? '' : ',';
        return `  out ${glslTypeForKind(item.kind)} ${item.param}${comma}`;
      })
      .join('\n'),
    ') {',
    ...body,
    '}',
    '',
  ].join('\n');
}

function defaultExportExpr(kind: PortKind): string {
  switch (kind) {
    case 'scalar':
      return '0.0';
    case 'color':
      return 'vec4(0.0, 0.0, 0.0, 1.0)';
    case 'vector':
      return 'vec3(0.0, 0.0, 1.0)';
    case 'shader':
      return 'PrismSurface(vec4(0.0), 0.0, 1.0, 0.0, vec4(0.0), vec4(0.0), 1.0, vec3(0.0, 0.0, 1.0), 0.0, false, false, false, false)';
  }
}

/**
 * Calls one recipe function from the program body and unpacks its out-params
 * into the locals the rest of the emitter reads, so blends and the output block
 * are written the same way whether the graph was split or inlined.
 *
 * A guest sitting `inside` its host is sampled at coordinates pushed back along
 * the view by `blendDepth` — the inclusion reads as volume, not as paint.
 */
function emitRecipeCall(
  _graph: MaterialGraphDocument,
  partition: RecipePartition,
  plan: RecipePartitionPlan,
  ports: Map<string, PortRef>,
  body: string[],
  uniforms: MaterialGraphGlslUniformBinding[],
): void {
  const locals: string[] = [];
  for (const item of partition.exports) {
    // GLSL reserves identifiers containing two consecutive underscores, and
    // node locals all start with `n_`, so call temporaries take an `r_` prefix.
    const local = `r_${glslId(item.nodeId)}_${item.portId}`;
    locals.push(local);
    body.push(`  ${glslTypeForKind(item.kind)} ${local};`);
  }

  const depth = guestDepthExpr(partition, plan, uniforms);
  const uvArg = depth ? `uv - viewDirection.xy * ${depth}` : 'uv';
  const positionArg = depth ? `objectPosition - viewDirection * ${depth}` : 'objectPosition';

  body.push(
    `  prismorphic_recipe_${partition.name}(${[uvArg, positionArg, 'viewDirection', 'elapsedSeconds', ...locals].join(', ')});`,
  );

  for (const [index, item] of partition.exports.entries()) {
    const local = locals[index]!;
    const id = glslId(item.nodeId);
    if (item.kind === 'shader') {
      for (const field of SURFACE_FIELDS) {
        body.push(`  ${surfaceFieldType(field)} ${id}_${field} = ${local}.${field};`);
      }
      ports.set(portKey(item.nodeId, item.portId), { expr: id, kind: 'shader' });
    } else {
      const name = `v_${id}_${item.portId}`;
      body.push(`  ${glslTypeForKind(item.kind)} ${name} = ${local};`);
      ports.set(portKey(item.nodeId, item.portId), { expr: name, kind: item.kind });
    }
  }
}

function surfaceFieldType(field: (typeof SURFACE_FIELDS)[number]): string {
  switch (field) {
    case 'baseColor':
    case 'tint':
    case 'emission':
      return 'vec4';
    case 'normal':
      return 'vec3';
    case 'emissionDriven':
    case 'normalDriven':
    case 'displacementDriven':
    case 'unlit':
      return 'bool';
    default:
      return 'float';
  }
}

/**
 * Total view-space offset a guest partition is sampled at: the `blendDepth` of
 * its own slot when that slot is `inside`, plus the depth of every `inside`
 * slot it sits under. A guest of a guest travels with its host, so the mask the
 * host exports and the surface the guest returns stay in the same frame.
 */
function guestDepthExpr(
  partition: RecipePartition,
  plan: RecipePartitionPlan,
  uniforms: MaterialGraphGlslUniformBinding[],
): string | null {
  if (!partition.guestOfBlendId) return null;
  const terms: string[] = [];
  for (const blend of plan.blends) {
    const owns =
      blend.id === partition.guestOfBlendId ||
      Boolean(plan.dominatedByBlend.get(blend.id)?.has(partition.guestOfBlendId));
    if (!owns) continue;
    const settings = nodeSettings(blend);
    if ((settings.blendMode ?? 'over') !== 'inside') continue;
    terms.push(ensureUniform(uniforms, blend, 'blendDepth', 'float', settings.blendDepth ?? 0.06));
  }
  return terms.length > 0 ? `(${terms.join(' + ')})` : null;
}

function emitSurfacePorts(
  _graph: MaterialGraphDocument,
  _ports: Map<string, PortRef>,
  body: string[],
  id: string,
  _nodeId: string,
  values: {
    baseColor: string;
    metallic: string;
    roughness: string;
    transmission: string;
    emission: string;
    opacity: string;
    normal: string;
    displacement: string;
    emissionDriven: boolean;
    normalDriven: boolean;
    displacementDriven: boolean;
    unlit: boolean;
    tintFromBase: boolean;
  },
): void {
  body.push(`  vec4 ${id}_baseColor = ${values.baseColor};`);
  body.push(`  float ${id}_metallic = clamp(${values.metallic}, 0.0, 1.0);`);
  body.push(`  float ${id}_roughness = clamp(${values.roughness}, 0.0, 1.0);`);
  body.push(`  float ${id}_transmission = clamp(${values.transmission}, 0.0, 1.0);`);
  body.push(`  vec4 ${id}_emission = ${values.emission};`);
  body.push(`  float ${id}_opacity = clamp(${values.opacity}, 0.0, 1.0);`);
  body.push(`  vec3 ${id}_normal = ${values.normal};`);
  body.push(`  float ${id}_displacement = clamp(${values.displacement}, 0.0, 1.0);`);
  body.push(`  bool ${id}_emissionDriven = ${glslBool(values.emissionDriven)};`);
  body.push(`  bool ${id}_normalDriven = ${glslBool(values.normalDriven)};`);
  body.push(`  bool ${id}_displacementDriven = ${glslBool(values.displacementDriven)};`);
  body.push(`  bool ${id}_unlit = ${glslBool(values.unlit)};`);
  body.push(`  vec4 ${id}_tint = ${values.tintFromBase ? `${id}_baseColor` : values.baseColor};`);
}

function buildHelpersSource(): string {
  return `
float prismorphic_hash2(float x, float y, float seed) {
  float s = sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - floor(s);
}

float prismorphic_hash3(vec3 p, float seed) {
  return prismorphic_hash2(
    p.x + p.z * 37.17,
    p.y + p.z * 11.73,
    seed
  );
}

float prismorphic_value_noise3(vec3 p, float seed) {
  vec3 cell = floor(p);
  vec3 local = fract(p);
  vec3 smoothLocal = local * local * (3.0 - 2.0 * local);
  float n000 = prismorphic_hash3(cell + vec3(0.0, 0.0, 0.0), seed);
  float n100 = prismorphic_hash3(cell + vec3(1.0, 0.0, 0.0), seed);
  float n010 = prismorphic_hash3(cell + vec3(0.0, 1.0, 0.0), seed);
  float n110 = prismorphic_hash3(cell + vec3(1.0, 1.0, 0.0), seed);
  float n001 = prismorphic_hash3(cell + vec3(0.0, 0.0, 1.0), seed);
  float n101 = prismorphic_hash3(cell + vec3(1.0, 0.0, 1.0), seed);
  float n011 = prismorphic_hash3(cell + vec3(0.0, 1.0, 1.0), seed);
  float n111 = prismorphic_hash3(cell + vec3(1.0, 1.0, 1.0), seed);
  float z0 = mix(mix(n000, n100, smoothLocal.x), mix(n010, n110, smoothLocal.x), smoothLocal.y);
  float z1 = mix(mix(n001, n101, smoothLocal.x), mix(n011, n111, smoothLocal.x), smoothLocal.y);
  return mix(z0, z1, smoothLocal.z);
}

float prismorphic_fbm3(
  vec3 p,
  float detail,
  float lacunarity,
  float gain,
  float seed,
  float warp,
  int mode
) {
  vec3 warped = p;
  if (warp > 0.0001) {
    vec3 q = vec3(
      prismorphic_value_noise3(p * 0.55, seed + 19.0),
      prismorphic_value_noise3(p * 0.55 + vec3(17.0, 0.0, 0.0), seed + 41.0),
      prismorphic_value_noise3(p * 0.55 + vec3(0.0, 29.0, 0.0), seed + 73.0)
    ) - 0.5;
    warped += q * warp;
  }
  float amplitude = 1.0;
  float frequency = 1.0;
  float total = 0.0;
  float weight = 0.0;
  int octaves = int(clamp(floor(detail + 0.5), 1.0, 8.0));
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float sampleValue = prismorphic_value_noise3(warped * frequency, seed + float(i) * 13.0);
    if (mode == 1) {
      sampleValue = pow(1.0 - abs(sampleValue * 2.0 - 1.0), 2.0);
    } else if (mode == 2) {
      sampleValue = abs(sampleValue * 2.0 - 1.0);
    }
    total += sampleValue * amplitude;
    weight += amplitude;
    amplitude *= clamp(gain, 0.1, 0.9);
    frequency *= clamp(lacunarity, 1.2, 4.0);
  }
  return weight > 0.0 ? clamp(total / weight, 0.0, 1.0) : 0.5;
}

float prismorphic_noise(float u, float v, float detail) {
  return prismorphic_fbm3(vec3(u, v, 0.0), detail, 2.0, 0.5, 0.0, 0.0, 0);
}

float prismorphic_wave(float u, float v, int waveType, float scale, float distortion) {
  float phase = u * scale + v * scale * distortion;
  float wrapped = fract(phase);
  if (waveType == 1) {
    return wrapped;
  }
  if (waveType == 2) {
    return wrapped < 0.5 ? wrapped * 2.0 : 2.0 - wrapped * 2.0;
  }
  return 0.5 + 0.5 * sin(phase * 3.141592653589793 * 2.0);
}

vec4 prismorphic_voronoi(float u, float v, float scale, float randomness) {
  float gx = u * scale;
  float gy = v * scale;
  float cellX = floor(gx);
  float cellY = floor(gy);
  float bestSquared = 1e20;
  vec3 bestColor = vec3(0.5);
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      float cx = cellX + float(ox);
      float cy = cellY + float(oy);
      float jitterX = (prismorphic_hash2(cx, cy, 1.0) - 0.5) * randomness;
      float jitterY = (prismorphic_hash2(cx, cy, 2.0) - 0.5) * randomness;
      float px = cx + 0.5 + jitterX;
      float py = cy + 0.5 + jitterY;
      float dx = gx - px;
      float dy = gy - py;
      float distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < bestSquared) {
        bestSquared = distanceSquared;
        bestColor = vec3(
          prismorphic_hash2(cx, cy, 3.0),
          prismorphic_hash2(cx, cy, 4.0),
          prismorphic_hash2(cx, cy, 5.0)
        );
      }
    }
  }
  return vec4(bestColor, clamp(sqrt(bestSquared), 0.0, 1.0));
}

float prismorphic_scanlines(
  float coord,
  float other1,
  float other2,
  float density,
  float thickness,
  float softness,
  float intensity,
  float speed,
  float distortion,
  float phase,
  float elapsedSeconds
) {
  float warp = distortion * 0.028 * (
    sin(other1 * 6.283185307179586 * 1.7 + elapsedSeconds * 0.6) +
    0.55 * sin(other2 * 6.283185307179586 * 2.3 - elapsedSeconds * 0.4) +
    0.35 * sin((other1 + other2) * 6.283185307179586 * 0.85 + elapsedSeconds * 0.22)
  );
  float scroll = elapsedSeconds * speed + phase;
  float dens = max(density, 0.5);
  float p = (coord + warp) * dens + scroll;
  float f = p - floor(p);
  float d = abs(f - 0.5);
  float halfThickness = clamp(thickness, 0.01, 0.95) * 0.5;
  // Keep AA density-aware without fwidth — helpers also compile in the vertex
  // stage for displacement evaluation where derivatives are unavailable.
  float soft = max(min(softness, halfThickness), halfThickness * (0.15 + dens * 0.0015));
  float line = 1.0 - smoothstep(halfThickness, halfThickness + soft, d);
  // Irregular brightness per line — premium holograms are never flat bands.
  float lineId = floor(p);
  float irregular = 0.55 + 0.45 * prismorphic_hash2(lineId, dens * 0.13, 19.0);
  float secondary = 0.7 + 0.3 * sin(lineId * 1.7 + other1 * 8.0 + elapsedSeconds * 0.9);
  return clamp(line * irregular * secondary, 0.0, 1.0) * intensity;
}

vec3 prismorphic_domain_warp(
  vec3 p,
  float amount,
  float scale,
  float speed,
  float seed,
  float elapsedSeconds
) {
  float t = elapsedSeconds * speed;
  float ox = (prismorphic_value_noise3(vec3((p.x + t) * scale, p.y * scale, p.z * scale), seed + 11.0) - 0.5) * 2.0 * amount;
  float oy = (prismorphic_value_noise3(vec3(p.x * scale, (p.y + t) * scale, p.z * scale), seed + 47.0) - 0.5) * 2.0 * amount;
  float oz = (prismorphic_value_noise3(vec3(p.x * scale, p.y * scale, (p.z + t) * scale), seed + 91.0) - 0.5) * 2.0 * amount;
  return p + vec3(ox, oy, oz);
}

vec2 prismorphic_glitch_bands(
  float y,
  float amount,
  float frequency,
  float bandSize,
  float offsetAmount,
  float duration,
  float speed,
  float seed,
  float elapsedSeconds
) {
  float row = y * frequency;
  float band = floor(row);
  float local = row - band;
  float tw = elapsedSeconds * speed;
  float window = floor(tw);
  float windowPhase = tw - window;
  float r = prismorphic_hash2(band + 0.5, window + 0.5, seed);
  float r2 = prismorphic_hash2(band + 3.7, window + 1.3, seed + 19.0);
  float activeBand = r < amount ? 1.0 : 0.0;
  float temporal = 1.0 - smoothstep(0.0, max(duration, 1e-4), windowPhase);
  float strip = abs(local - r2) < bandSize * 0.5 ? 1.0 : 0.0;
  float mask = activeBand * temporal * strip;
  float offset = mask * offsetAmount * (r2 * 2.0 - 1.0);
  return vec2(mask, offset);
}

float prismorphic_digital_fragments(
  vec2 uv,
  float scale,
  float density,
  float threshold,
  float seed,
  float speed,
  float elapsedSeconds
) {
  float cellX = floor(uv.x * scale);
  float cellY = floor(uv.y * scale);
  float base = prismorphic_hash2(cellX, cellY, seed);
  float window = floor(elapsedSeconds * speed);
  float flicker = prismorphic_hash2(cellX + 1.3, cellY + 2.7, seed + window * 7.0 + 3.0);
  float present = base < density ? 1.0 : 0.0;
  float visible = flicker > threshold ? 1.0 : 0.0;
  return present * visible;
}

float prismorphic_pulse(
  float speed,
  float amount,
  float phase,
  float sharpness,
  float elapsedSeconds
) {
  float s = 0.5 + 0.5 * sin(elapsedSeconds * speed + phase);
  float shaped = pow(clamp(s, 0.0, 1.0), max(sharpness, 1e-4));
  return clamp((1.0 - amount) + amount * shaped, 0.0, 1.0);
}
`.trim();
}

function readInput(
  graph: MaterialGraphDocument,
  ports: Map<string, PortRef>,
  nodeId: string,
  portId: string,
): PortRef | undefined {
  const edge = graph.edges.find((item) => item.toNode === nodeId && item.toPort === portId);
  if (!edge) return undefined;
  return ports.get(portKey(edge.fromNode, edge.fromPort));
}

function asScalarExpr(ref: PortRef | undefined, fallback: string): string {
  if (!ref) return fallback;
  if (ref.kind === 'scalar') return ref.expr;
  if (ref.kind === 'color') return `((${ref.expr}).r + (${ref.expr}).g + (${ref.expr}).b) / 3.0`;
  if (ref.kind === 'vector') return `((${ref.expr}).x + (${ref.expr}).y + (${ref.expr}).z) / 3.0`;
  return fallback;
}

function asColorExpr(ref: PortRef | undefined, fallback: string): string {
  if (!ref) return fallback;
  if (ref.kind === 'color') return ref.expr;
  if (ref.kind === 'scalar') {
    return `vec4(clamp(${ref.expr}, 0.0, 1.0), clamp(${ref.expr}, 0.0, 1.0), clamp(${ref.expr}, 0.0, 1.0), 1.0)`;
  }
  if (ref.kind === 'vector') {
    return `vec4(clamp((${ref.expr}).x, 0.0, 1.0), clamp((${ref.expr}).y, 0.0, 1.0), clamp((${ref.expr}).z, 0.0, 1.0), 1.0)`;
  }
  return fallback;
}

function asVectorExpr(ref: PortRef | undefined, fallback: string): string {
  if (!ref) return fallback;
  if (ref.kind === 'vector') return ref.expr;
  if (ref.kind === 'scalar') return `vec3(${ref.expr}, ${ref.expr}, ${ref.expr})`;
  if (ref.kind === 'color') return `(${ref.expr}).rgb`;
  return fallback;
}

/**
 * Node ids the compiled shader actually evaluates.
 *
 * Exposed so an interface can refuse to offer a control the shader will never
 * read: a slider bound to an unreachable node moves its uniform, gets patched
 * onto the material, and changes nothing on screen.
 */
export function listReachableMaterialGraphNodeIds(graph: MaterialGraphDocument): ReadonlySet<string> {
  return collectReachableNodeIds(graph);
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
  for (const [toNode, fromNodes] of incoming) {
    incoming.set(toNode, [...new Set(fromNodes)].sort(compareStrings));
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

/**
 * Kahn topological order with deterministic ready-set and adjacency sorting
 * so inverted node/edge arrays still emit identical GLSL.
 *
 * Keeps one adjacency occurrence per edge (matching indegree). Deduplicating
 * adjacency alone would stall fan-out graphs where one node feeds multiple
 * ports of the same target (e.g. rgb → mix.a and rgb → mix.b).
 */
function topologicalOrder(graph: MaterialGraphDocument, reachable: Set<string>): MaterialGraphNode[] {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of reachable) indegree.set(id, 0);
  for (const item of graph.edges) {
    if (!reachable.has(item.fromNode) || !reachable.has(item.toNode)) continue;
    adjacency.set(item.fromNode, [...(adjacency.get(item.fromNode) ?? []), item.toNode]);
    indegree.set(item.toNode, (indegree.get(item.toNode) ?? 0) + 1);
  }
  for (const [fromNode, toNodes] of adjacency) {
    adjacency.set(fromNode, [...toNodes].sort(compareStrings));
  }
  const queue = [...reachable]
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort(compareStrings);
  const ordered: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    ordered.push(current);
    for (const next of adjacency.get(current) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
        queue.sort(compareStrings);
      }
    }
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return ordered
    .map((id) => nodeById.get(id))
    .filter((node): node is MaterialGraphNode => Boolean(node));
}

function nodeSettings(node: MaterialGraphNode): MaterialGraphNodeSettings {
  return node.settings ?? {};
}

function portKey(nodeId: string, portId: string): string {
  return `${nodeId}:${portId}`;
}

/**
 * Maps a canonical node id to a unique GLSL identifier.
 * Encodes every non [A-Za-z0-9] UTF-16 code unit so surrogate pairs (emoji) and
 * punctuation never collide (`a😀` ≠ `a😁`, `a-b` ≠ `a_b`).
 */
function glslId(nodeId: string): string {
  let encoded = '';
  for (let i = 0; i < nodeId.length; i += 1) {
    const codeUnit = nodeId.charCodeAt(i);
    const char = nodeId[i]!;
    if (/[a-zA-Z0-9]/.test(char)) {
      encoded += char;
    } else {
      encoded += `_${codeUnit.toString(16)}_`;
    }
  }
  if (!encoded) encoded = 'empty';
  return `n_${encoded}`;
}

function glslFloat(value: number): string {
  if (!Number.isFinite(value)) return '0.0';
  const text = String(value);
  return text.includes('.') || /e/i.test(text) ? text : `${text}.0`;
}

function glslBool(value: boolean): string {
  return value ? 'true' : 'false';
}

/* Unused here: the scene's copy has no node that emits a vec4 literal. Kept for the diff. */
export function glslVec4(color: MaterialGraphColorValue): string {
  return `vec4(${glslFloat(color[0])}, ${glslFloat(color[1])}, ${glslFloat(color[2])}, ${glslFloat(color[3])})`;
}

function parseHexColor(hex: string | undefined, fallback: MaterialGraphColorValue): MaterialGraphColorValue {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return [...fallback] as MaterialGraphColorValue;
  const raw = Number.parseInt(hex.slice(1), 16);
  return [((raw >> 16) & 255) / 255, ((raw >> 8) & 255) / 255, (raw & 255) / 255, 1];
}

/**
 * Stable GLSL program cache key from the reachable subgraph and structural
 * (non-uniform) settings only. Uniform-patchable numeric/color settings,
 * unreachable nodes/edges, layout (x/y/frames), port labels, edge id/tone,
 * unused settings, and `outputBlend` are omitted so they cannot bust the
 * program cache.
 */
function materialGraphGlslCacheKey(graph: MaterialGraphDocument): string {
  const reachable = collectReachableNodeIds(graph);
  const nodes = graph.nodes
    .filter((node) => reachable.has(node.id))
    .map((node) => ({
      id: node.id,
      type: node.type,
      settings: canonicalizeStructuralGlslSettings(node.type, node.settings ?? {}),
    }))
    .sort((a, b) => compareStrings(a.id, b.id));

  const edges = graph.edges
    .filter((edge) => reachable.has(edge.fromNode) && reachable.has(edge.toNode))
    .map((edge) => ({
      fromNode: edge.fromNode,
      fromPort: edge.fromPort,
      toNode: edge.toNode,
      toPort: edge.toPort,
    }))
    .sort((a, b) =>
      compareStrings(
        `${a.fromNode}\0${a.fromPort}\0${a.toNode}\0${a.toPort}`,
        `${b.fromNode}\0${b.fromPort}\0${b.toNode}\0${b.toPort}`,
      ),
    );

  return JSON.stringify({
    version: graph.version,
    nodes,
    edges,
  });
}

/**
 * Structural settings that change the generated GLSL program shape (control
 * flow / opcode). Uniform-patchable keys are intentionally absent.
 */
const STRUCTURAL_GLSL_SETTINGS_KEYS_BY_TYPE: Record<
  MaterialGraphNodeType,
  readonly (keyof MaterialGraphNodeSettings)[]
> = {
  value: [],
  rgb: [],
  time: [],
  'base-color': [],
  metallic: [],
  roughness: [],
  emission: [],
  opacity: [],
  normal: [],
  displacement: [],
  'texture-coordinate': ['coordinateSpace'],
  mapping: [],
  'noise-texture': ['noiseMode'],
  'wave-texture': ['waveType'],
  'voronoi-texture': [],
  'color-ramp': ['rampInterpolation'],
  math: ['mathOperation'],
  mix: [],
  'map-range': [],
  invert: [],
  fresnel: [],
  'prism-dispersion': [],
  scanlines: ['scanlineAxis'],
  'domain-warp': [],
  'glitch-bands': [],
  'digital-fragments': [],
  'chromatic-split': [],
  pulse: [],
  'pbr-surface': [],
  'unlit-surface': [],
  'glass-surface': [],
  // The slot mode picks the operator, so it reshapes the generated program.
  'surface-blend': ['blendMode'],
  'material-output': [],
};

/** Settings that change generated GLSL structure for a given node type. */
function canonicalizeStructuralGlslSettings(
  type: MaterialGraphNodeType,
  settings: MaterialGraphNodeSettings,
): Record<string, unknown> {
  const allowed = STRUCTURAL_GLSL_SETTINGS_KEYS_BY_TYPE[type] ?? [];
  const record = settings as Record<string, unknown>;
  const entries: [string, unknown][] = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined) {
      entries.push([key, record[key]]);
    }
  }
  entries.sort(([left], [right]) => compareStrings(left, right));
  return Object.fromEntries(entries);
}

/**
 * Uniform-patchable setting keys per node type. Changing only these values
 * keeps the program cache key stable and applies via uniform-only patches.
 */
const UNIFORM_GLSL_SETTINGS_BY_TYPE: Partial<
  Record<
    MaterialGraphNodeType,
    readonly { key: keyof MaterialGraphNodeSettings; kind: MaterialGraphGlslUniformKind; fallback: unknown }[]
  >
> = {
  value: [{ key: 'scalarValue', kind: 'float', fallback: 0.5 }],
  rgb: [{ key: 'rgbColor', kind: 'vec4', fallback: '#3399F2' }],
  time: [
    { key: 'timeSpeed', kind: 'float', fallback: 1 },
    { key: 'timeOffset', kind: 'float', fallback: 0 },
  ],
  'base-color': [{ key: 'rgbColor', kind: 'vec4', fallback: '#D1D6E0' }],
  metallic: [{ key: 'scalarValue', kind: 'float', fallback: 0 }],
  roughness: [{ key: 'scalarValue', kind: 'float', fallback: 0.5 }],
  emission: [{ key: 'rgbColor', kind: 'vec4', fallback: '#000000' }],
  opacity: [{ key: 'scalarValue', kind: 'float', fallback: 1 }],
  normal: [
    { key: 'vectorX', kind: 'float', fallback: 0 },
    { key: 'vectorY', kind: 'float', fallback: 0 },
    { key: 'vectorZ', kind: 'float', fallback: 1 },
  ],
  displacement: [{ key: 'scalarValue', kind: 'float', fallback: 0 }],
  mapping: [
    { key: 'mappingX', kind: 'float', fallback: 1 },
    { key: 'mappingY', kind: 'float', fallback: 1 },
    { key: 'mappingZ', kind: 'float', fallback: 0 },
  ],
  'noise-texture': [
    { key: 'noiseDetail', kind: 'float', fallback: 4 },
    { key: 'noiseScale', kind: 'float', fallback: 1 },
    { key: 'noiseSeed', kind: 'float', fallback: 0 },
    { key: 'noiseWarp', kind: 'float', fallback: 0 },
    { key: 'noiseLacunarity', kind: 'float', fallback: 2 },
    { key: 'noiseGain', kind: 'float', fallback: 0.5 },
  ],
  'wave-texture': [
    { key: 'waveScale', kind: 'float', fallback: 5 },
    { key: 'waveDistortion', kind: 'float', fallback: 0.25 },
  ],
  'voronoi-texture': [
    { key: 'voronoiScale', kind: 'float', fallback: 4 },
    { key: 'voronoiRandomness', kind: 'float', fallback: 0.75 },
  ],
  'color-ramp': [
    { key: 'rampStart', kind: 'vec4', fallback: '#0D1429' },
    { key: 'rampEnd', kind: 'vec4', fallback: '#8CF2FF' },
    { key: 'rampMidpoint', kind: 'float', fallback: 0.5 },
  ],
  mix: [{ key: 'mixFactor', kind: 'float', fallback: 0.5 }],
  'map-range': [
    { key: 'mapFromMin', kind: 'float', fallback: 0 },
    { key: 'mapFromMax', kind: 'float', fallback: 1 },
    { key: 'mapToMin', kind: 'float', fallback: 0 },
    { key: 'mapToMax', kind: 'float', fallback: 1 },
    { key: 'mapClamp', kind: 'bool', fallback: true },
  ],
  fresnel: [
    { key: 'fresnelIor', kind: 'float', fallback: 1.45 },
    { key: 'fresnelPower', kind: 'float', fallback: 5 },
    { key: 'fresnelBias', kind: 'float', fallback: 0.02 },
    { key: 'fresnelIntensity', kind: 'float', fallback: 1 },
    { key: 'fresnelInvert', kind: 'bool', fallback: false },
    { key: 'fresnelColor', kind: 'vec4', fallback: '#3DEBFF' },
  ],
  scanlines: [
    { key: 'scanlineDensity', kind: 'float', fallback: 96 },
    { key: 'scanlineThickness', kind: 'float', fallback: 0.22 },
    { key: 'scanlineSoftness', kind: 'float', fallback: 0.08 },
    { key: 'scanlineIntensity', kind: 'float', fallback: 1 },
    { key: 'scanlineSpeed', kind: 'float', fallback: 0.35 },
    { key: 'scanlineDistortion', kind: 'float', fallback: 0.35 },
    { key: 'scanlinePhase', kind: 'float', fallback: 0 },
  ],
  'domain-warp': [
    { key: 'warpAmount', kind: 'float', fallback: 0.35 },
    { key: 'warpScale', kind: 'float', fallback: 2 },
    { key: 'warpSpeed', kind: 'float', fallback: 0.15 },
    { key: 'warpSeed', kind: 'float', fallback: 0 },
  ],
  'glitch-bands': [
    { key: 'glitchAmount', kind: 'float', fallback: 0.18 },
    { key: 'glitchFrequency', kind: 'float', fallback: 14 },
    { key: 'glitchBandSize', kind: 'float', fallback: 0.08 },
    { key: 'glitchOffset', kind: 'float', fallback: 0.12 },
    { key: 'glitchDuration', kind: 'float', fallback: 0.22 },
    { key: 'glitchSpeed', kind: 'float', fallback: 0.55 },
    { key: 'glitchSeed', kind: 'float', fallback: 17 },
  ],
  'digital-fragments': [
    { key: 'fragmentScale', kind: 'float', fallback: 64 },
    { key: 'fragmentDensity', kind: 'float', fallback: 0.22 },
    { key: 'fragmentThreshold', kind: 'float', fallback: 0.82 },
    { key: 'fragmentSeed', kind: 'float', fallback: 31 },
    { key: 'fragmentSpeed', kind: 'float', fallback: 0.2 },
  ],
  'chromatic-split': [
    { key: 'chromaStrength', kind: 'float', fallback: 0.22 },
    { key: 'chromaEdgeBias', kind: 'float', fallback: 0.55 },
    { key: 'chromaCyan', kind: 'vec4', fallback: '#3DEBFF' },
    { key: 'chromaMagenta', kind: 'vec4', fallback: '#C972FF' },
  ],
  pulse: [
    { key: 'pulseSpeed', kind: 'float', fallback: 0.45 },
    { key: 'pulseAmount', kind: 'float', fallback: 0.35 },
    { key: 'pulsePhase', kind: 'float', fallback: 0 },
    { key: 'pulseSharpness', kind: 'float', fallback: 1.5 },
  ],
  'prism-dispersion': [
    { key: 'prismSpectrum', kind: 'float', fallback: 0.62 },
    { key: 'prismStrength', kind: 'float', fallback: 1 },
  ],
  'glass-surface': [{ key: 'surfaceTransmission', kind: 'float', fallback: 0.55 }],
  // Setting the depth of an inclusion is a uniform-only patch, like the amount.
  'surface-blend': [{ key: 'blendDepth', kind: 'float', fallback: 0.06 }],
  'material-output': [{ key: 'outputEnabled', kind: 'bool', fallback: true }],
};

function collectUniformBindings(graph: MaterialGraphDocument): MaterialGraphGlslUniformBinding[] {
  const reachable = collectReachableNodeIds(graph);
  const bindings: MaterialGraphGlslUniformBinding[] = [];
  const ordered = topologicalOrder(graph, reachable);
  for (const node of ordered) {
    const specs = UNIFORM_GLSL_SETTINGS_BY_TYPE[node.type] ?? [];
    const settings = nodeSettings(node);
    for (const spec of specs) {
      const raw = (settings as Record<string, unknown>)[spec.key];
      const value = resolveUniformValue(spec.kind, raw, spec.fallback);
      ensureUniform(bindings, node, spec.key, spec.kind, value);
    }
  }
  return [...bindings].sort((a, b) => compareStrings(a.name, b.name));
}

function ensureUniform(
  uniforms: MaterialGraphGlslUniformBinding[],
  node: MaterialGraphNode,
  settingKey: string,
  kind: MaterialGraphGlslUniformKind,
  value: MaterialGraphGlslUniformBinding['value'],
): string {
  const name = uniformName(node.id, settingKey);
  const existing = uniforms.find((item) => item.name === name);
  if (existing) {
    existing.value = value;
    existing.kind = kind;
    return name;
  }
  uniforms.push({
    name,
    kind,
    nodeId: node.id,
    settingKey,
    value,
  });
  return name;
}

function uniformName(nodeId: string, settingKey: string): string {
  return `uPrismorphic_${glslId(nodeId)}_${settingKey}`;
}

function resolveUniformValue(
  kind: MaterialGraphGlslUniformKind,
  raw: unknown,
  fallback: unknown,
): MaterialGraphGlslUniformBinding['value'] {
  if (kind === 'bool') {
    if (typeof raw === 'boolean') return raw;
    if (typeof fallback === 'boolean') return fallback;
    return true;
  }
  if (kind === 'float') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof fallback === 'number') return fallback;
    return 0;
  }
  if (kind === 'vec4') {
    if (typeof raw === 'string') return parseHexColor(raw, [0, 0, 0, 1]);
    if (Array.isArray(raw) && raw.length >= 3) {
      return [
        Number(raw[0]) || 0,
        Number(raw[1]) || 0,
        Number(raw[2]) || 0,
        Number(raw[3] ?? 1) || 1,
      ] as MaterialGraphColorValue;
    }
    if (typeof fallback === 'string') return parseHexColor(fallback, [0, 0, 0, 1]);
    return [0, 0, 0, 1];
  }
  if (Array.isArray(raw) && raw.length >= 3) {
    return [Number(raw[0]) || 0, Number(raw[1]) || 0, Number(raw[2]) || 0] as [number, number, number];
  }
  return [0, 0, 0];
}

function resolveOutputBlendFromGraph(graph: MaterialGraphDocument): MaterialGraphGlslOutputBlend {
  const output = graph.nodes.find((node) => node.type === 'material-output');
  return resolveOutputBlend(output ? nodeSettings(output).outputBlend : undefined);
}

function resolveSurfaceModeFromGraph(graph: MaterialGraphDocument): MaterialGraphGlslSurfaceMode {
  const output = graph.nodes.find((node) => node.type === 'material-output');
  if (!output) return 'physical';
  const surfaceEdge = graph.edges.find(
    (edge) => edge.toNode === output.id && edge.toPort === 'surface',
  );
  if (!surfaceEdge) return 'physical';
  const surfaceNode = graph.nodes.find((node) => node.id === surfaceEdge.fromNode);
  return surfaceNode?.type === 'unlit-surface' ? 'unlit' : 'physical';
}

function resolveOutputBlend(
  value: MaterialGraphNodeSettings['outputBlend'],
): MaterialGraphGlslOutputBlend {
  if (value === 'Alpha blend' || value === 'Additive') return value;
  return 'Opaque';
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
