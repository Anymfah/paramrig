/**
 * Recipe interface and composition tree for the Recipe view (D2-1).
 *
 * A recipe is a canonical material graph plus an interface: intent sliders,
 * slots it offers to a guest, and what it exports when it is itself a guest.
 * The interface travels inside the existing graph extension
 * (`extensions['prismorphic.graph'].recipe`); the composition tree — which
 * recipe hosts which, in which slot — travels in its own namespaced extension
 * (`extensions['prismorphic.composition']`).
 *
 * The unfolded graph stays the source of truth: a runtime that ignores both
 * extensions still renders the document. Normative reference:
 * docs/deliverables/D2-1-vue-recette-composition.md
 */

import type { PrismorphicMaterialDocument, ValidationMessage } from './material.ts';
import type {
  MaterialGraphControl,
  MaterialGraphDocument,
  MaterialGraphNode,
} from './material-graph.ts';

export const MATERIAL_COMPOSITION_EXTENSION_KEY = 'prismorphic.composition' as const;

export const MATERIAL_COMPOSITION_VERSION = 1 as const;

/** R-04: root counts as level 1, so a guest of a guest is the last level. */
export const MATERIAL_COMPOSITION_MAX_DEPTH = 3 as const;

export const MATERIAL_RECIPE_SLOT_MODES = [
  'inside',
  'over',
  'cavity',
  'edge',
  'veins',
] as const;

export type MaterialRecipeSlotMode = (typeof MATERIAL_RECIPE_SLOT_MODES)[number];

/**
 * An intent is a MaterialGraphControl with a pair of adjectives. The bridge
 * from parameter to node settings is the existing one; only the wording and
 * the tooltip summary are new.
 */
export interface MaterialRecipeIntent extends MaterialGraphControl {
  /** Adjective pair, ordered 0 -> 1. */
  poles: { low: string; high: string };
  /** Readable copy of the targets, for the tooltip ("drives Roughness, Clearcoat"). */
  summary?: string;
}

/** A scalar port reference used as a mask or as the exported pattern. */
export interface MaterialRecipePortRef {
  nodeId: string;
  portId: string;
}

export interface MaterialRecipeSlot {
  id: string;
  /** "Inside", "On the surface", "In the cavities"… */
  label: string;
  /** "inclusions in the volume" — shown as a tooltip, or inline on touch. */
  hint: string;
  mode: MaterialRecipeSlotMode;
  /** Host scalar port used as the mask (cavity, veins). Absent: mask derived from the mode. */
  maskPort?: MaterialRecipePortRef;
  /** Coverage applied when a guest is dropped. 0..1 */
  defaultAmount: number;
}

export interface MaterialRecipeExports {
  /** Shader port of the recipe surface. Always present. */
  surface: { nodeId: string; portId: 'shader' };
  /** Scalar port of the main pattern, for the modes that need one. */
  pattern?: MaterialRecipePortRef;
  /**
   * Colour port the recipe lends as its skin when it is invited (R-02).
   *
   * A recipe whose albedo lives in a texture map cannot lend it: a Three
   * material samples one map, so a composed document has no second sampler for
   * a guest. The port named here is wired into the guest's own surface at
   * unfold time, which is why it does not have to be reachable in the recipe
   * itself — it can lie dormant until the recipe is invited.
   */
  albedo?: MaterialRecipePortRef;
}

export interface MaterialRecipeInterface {
  /** Intent sliders. */
  intents: MaterialRecipeIntent[];
  /** Slots this recipe offers to a guest. Order = display order. */
  slots: MaterialRecipeSlot[];
  /** What the recipe provides when it is invited. */
  exports: MaterialRecipeExports;
}

export interface MaterialCompositionNode {
  /** Instance id, prefix of the nodes and uniforms in the unfolded graph. */
  instanceId: string;
  /** Source recipe: embedded preset (`preset-…`), saved material, or `inline`. */
  recipeRef: string;
  /** Intent values, keyed by intent.id. Absent = the recipe default. */
  intents?: Record<string, number>;
  /** Guests, keyed by slot id. */
  guests?: Record<string, MaterialCompositionGuest>;
  /** True as soon as the expert edited this instance's graph. */
  detached?: boolean;
  /**
   * Hidden from the mix without being removed from it (D2-1 R-08): the guest
   * keeps its Quantity and its own guests, and the unfolder leaves it out.
   * Isolating one guest is the same thing said about all the others.
   */
  muted?: boolean;
}

export interface MaterialCompositionGuest extends MaterialCompositionNode {
  /** The "Amount", 0..1. */
  amount: number;
}

export interface PrismorphicCompositionExtension {
  version: typeof MATERIAL_COMPOSITION_VERSION;
  root: MaterialCompositionNode;
  /**
   * Recipe documents that no library can supply, kept with the composition.
   *
   * The host of a composition is usually a preset the editor can look up, but
   * it can also be the open material itself. That one has to be stored: once a
   * guest is folded into the document, the document is no longer the host, and
   * resolving the host from it again would bake the guest in for good.
   */
  recipes?: Record<string, PrismorphicMaterialDocument>;
}

/** Graph-level recipe interface diagnostics (family: material graph). */
export const MATERIAL_RECIPE_DIAGNOSTIC_CODES = [
  'GRAPH_RECIPE_SLOT_ID_DUPLICATE',
  'GRAPH_RECIPE_EXPORT_SURFACE_MISSING',
  'GRAPH_RECIPE_MASK_PORT_INVALID',
  'GRAPH_RECIPE_INTENT_TARGET_MISSING',
] as const;

export type MaterialRecipeDiagnosticCode = (typeof MATERIAL_RECIPE_DIAGNOSTIC_CODES)[number];

/** Document-level composition diagnostics. */
export const MATERIAL_COMPOSITION_DIAGNOSTIC_CODES = ['COMPOSITION_DEPTH_EXCEEDED'] as const;

export type MaterialCompositionDiagnosticCode =
  (typeof MATERIAL_COMPOSITION_DIAGNOSTIC_CODES)[number];

export interface MaterialRecipeDiagnostic extends ValidationMessage {
  code: MaterialRecipeDiagnosticCode | MaterialCompositionDiagnosticCode;
  guidance?: string;
  nodeId?: string;
  portId?: string;
  slotId?: string;
  intentId?: string;
  instanceId?: string;
}

const GRAPH_FIELD_PREFIX = "extensions['prismorphic.graph']";
const COMPOSITION_FIELD_PREFIX = `extensions['${MATERIAL_COMPOSITION_EXTENSION_KEY}']`;

/** Node types whose `shader` output can stand as a recipe surface export. */
const RECIPE_SURFACE_TYPES = new Set([
  'pbr-surface',
  'glass-surface',
  'unlit-surface',
  // A folded composition exports the blend that joins its host and its guests.
  'surface-blend',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function isMaterialRecipeSlotMode(value: unknown): value is MaterialRecipeSlotMode {
  return (MATERIAL_RECIPE_SLOT_MODES as readonly string[]).includes(value as string);
}

export function isMaterialRecipeDiagnosticCode(code: string): boolean {
  return (MATERIAL_RECIPE_DIAGNOSTIC_CODES as readonly string[]).includes(code);
}

export function isMaterialCompositionDiagnosticCode(code: string): boolean {
  return (MATERIAL_COMPOSITION_DIAGNOSTIC_CODES as readonly string[]).includes(code);
}

function sanitizePortRef(value: unknown): MaterialRecipePortRef | undefined {
  if (!isPlainObject(value)) return undefined;
  if (typeof value.nodeId !== 'string' || value.nodeId.length === 0) return undefined;
  if (typeof value.portId !== 'string' || value.portId.length === 0) return undefined;
  return { nodeId: value.nodeId, portId: value.portId };
}

function sanitizeSlots(value: unknown): MaterialRecipeSlot[] {
  if (!Array.isArray(value)) return [];
  const slots: MaterialRecipeSlot[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.id !== 'string' || entry.id.length === 0 || seen.has(entry.id)) continue;
    if (!isMaterialRecipeSlotMode(entry.mode)) continue;
    seen.add(entry.id);
    const maskPort = sanitizePortRef(entry.maskPort);
    slots.push({
      id: entry.id,
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : entry.id,
      hint: typeof entry.hint === 'string' ? entry.hint.trim() : '',
      mode: entry.mode,
      ...(maskPort ? { maskPort } : {}),
      defaultAmount:
        typeof entry.defaultAmount === 'number' && Number.isFinite(entry.defaultAmount)
          ? clamp01(entry.defaultAmount)
          : 0.5,
    });
  }
  return slots;
}

function sanitizeExports(value: unknown): MaterialRecipeExports | null {
  if (!isPlainObject(value)) return null;
  const surface = sanitizePortRef(value.surface);
  if (!surface || surface.portId !== 'shader') return null;
  const pattern = sanitizePortRef(value.pattern);
  const albedo = sanitizePortRef(value.albedo);
  return {
    surface: { nodeId: surface.nodeId, portId: 'shader' },
    ...(pattern ? { pattern } : {}),
    ...(albedo ? { albedo } : {}),
  };
}

function sanitizePoles(value: unknown): { low: string; high: string } | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.low !== 'string' || !value.low.trim()) return null;
  if (typeof value.high !== 'string' || !value.high.trim()) return null;
  return { low: value.low.trim(), high: value.high.trim() };
}

/**
 * Normalizes a raw recipe interface. `sanitizeControls` is injected by the
 * graph sanitizer so intents go through the exact same rules as controls.
 * Returns undefined when the payload cannot yield a usable interface — a graph
 * without an interface stays a valid material, it is simply not invitable.
 */
export function sanitizeMaterialRecipeInterface(
  raw: unknown,
  sanitizeControls: (value: unknown) => MaterialGraphControl[] | undefined,
): MaterialRecipeInterface | undefined {
  if (!isPlainObject(raw)) return undefined;
  const exportsValue = sanitizeExports(raw.exports);
  if (!exportsValue) return undefined;

  const intents: MaterialRecipeIntent[] = [];
  if (Array.isArray(raw.intents)) {
    const polesById = new Map<string, { low: string; high: string }>();
    const summaryById = new Map<string, string>();
    for (const entry of raw.intents) {
      if (!isPlainObject(entry) || typeof entry.id !== 'string') continue;
      const poles = sanitizePoles(entry.poles);
      if (poles) polesById.set(entry.id, poles);
      if (typeof entry.summary === 'string' && entry.summary.trim()) {
        summaryById.set(entry.id, entry.summary.trim());
      }
    }
    for (const control of sanitizeControls(raw.intents) ?? []) {
      const poles = polesById.get(control.id);
      // An intent without a pair of adjectives is a control, not an intent.
      if (!poles) continue;
      const summary = summaryById.get(control.id);
      intents.push({ ...control, poles, ...(summary ? { summary } : {}) });
    }
  }

  return { intents, slots: sanitizeSlots(raw.slots), exports: exportsValue };
}

function sanitizeIntentValues(value: unknown): Record<string, number> | undefined {
  if (!isPlainObject(value)) return undefined;
  const entries: [string, number][] = [];
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) entries.push([key, raw]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sanitizeCompositionNode(
  value: unknown,
  depth: number,
  seenInstanceIds: Set<string>,
): MaterialCompositionNode | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.instanceId !== 'string' || value.instanceId.length === 0) return null;
  if (typeof value.recipeRef !== 'string' || value.recipeRef.length === 0) return null;
  if (seenInstanceIds.has(value.instanceId)) return null;
  seenInstanceIds.add(value.instanceId);

  const node: MaterialCompositionNode = {
    instanceId: value.instanceId,
    recipeRef: value.recipeRef,
  };
  const intents = sanitizeIntentValues(value.intents);
  if (intents) node.intents = intents;
  if (value.detached === true) node.detached = true;
  if (value.muted === true) node.muted = true;

  // R-04: guests past the depth cap are dropped, and the raw payload keeps a
  // COMPOSITION_DEPTH_EXCEEDED diagnostic so nothing disappears silently.
  if (depth < MATERIAL_COMPOSITION_MAX_DEPTH && isPlainObject(value.guests)) {
    const guests: Record<string, MaterialCompositionGuest> = {};
    for (const [slotId, rawGuest] of Object.entries(value.guests)) {
      if (slotId.length === 0) continue;
      const child = sanitizeCompositionNode(rawGuest, depth + 1, seenInstanceIds);
      if (!child) continue;
      const rawAmount = isPlainObject(rawGuest) ? rawGuest.amount : undefined;
      guests[slotId] = {
        ...child,
        amount:
          typeof rawAmount === 'number' && Number.isFinite(rawAmount) ? clamp01(rawAmount) : 0.5,
      };
    }
    if (Object.keys(guests).length > 0) node.guests = guests;
  }

  return node;
}

/** Validates and normalizes an unknown composition payload. */
export function sanitizeMaterialComposition(
  raw: unknown,
): PrismorphicCompositionExtension | null {
  if (!isPlainObject(raw)) return null;
  if (raw.version !== MATERIAL_COMPOSITION_VERSION) return null;
  const root = sanitizeCompositionNode(raw.root, 1, new Set<string>());
  if (!root) return null;

  const extension: PrismorphicCompositionExtension = {
    version: MATERIAL_COMPOSITION_VERSION,
    root,
  };
  if (isPlainObject(raw.recipes)) {
    // Stored recipes are sanitized when they are instantiated; here the map
    // only needs to keep entries that look like a material document.
    const recipes: Record<string, PrismorphicMaterialDocument> = {};
    for (const [key, value] of Object.entries(raw.recipes)) {
      if (key.length > 0 && isPlainObject(value) && isPlainObject(value.parameters)) {
        recipes[key] = value as unknown as PrismorphicMaterialDocument;
      }
    }
    if (Object.keys(recipes).length > 0) extension.recipes = recipes;
  }
  return extension;
}

export interface MaterialCompositionEntry {
  node: MaterialCompositionNode;
  /** 1 for the root. */
  depth: number;
  /** Slot of the host that holds this instance; null for the root. */
  slotId: string | null;
  parentInstanceId: string | null;
}

/** Depth-first walk of a composition tree, host before guests. */
export function listMaterialCompositionNodes(
  root: MaterialCompositionNode,
): MaterialCompositionEntry[] {
  const entries: MaterialCompositionEntry[] = [];
  const walk = (
    node: MaterialCompositionNode,
    depth: number,
    slotId: string | null,
    parentInstanceId: string | null,
  ): void => {
    entries.push({ node, depth, slotId, parentInstanceId });
    // Hard stop well past the product cap so a hand-written cyclic payload
    // cannot spin here; the depth diagnostic reports the real breach.
    if (depth > 16) return;
    for (const [childSlotId, guest] of Object.entries(node.guests ?? {})) {
      walk(guest, depth + 1, childSlotId, node.instanceId);
    }
  };
  walk(root, 1, null, null);
  return entries;
}

/** Deepest level of a composition tree; 1 for a single recipe. */
export function materialCompositionDepth(root: MaterialCompositionNode): number {
  return listMaterialCompositionNodes(root).reduce((max, entry) => Math.max(max, entry.depth), 1);
}

function collectShaderPathToOutput(graph: MaterialGraphDocument): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.fromNode);
    if (list) list.push(edge.toNode);
    else outgoing.set(edge.fromNode, [edge.toNode]);
  }
  const outputIds = new Set(
    graph.nodes.filter((node) => node.type === 'material-output').map((node) => node.id),
  );
  const reaching = new Set<string>();
  for (const node of graph.nodes) {
    if (reaching.has(node.id)) continue;
    const stack = [node.id];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      if (outputIds.has(current)) {
        reaching.add(node.id);
        break;
      }
      stack.push(...(outgoing.get(current) ?? []));
    }
  }
  return reaching;
}

function findOutputWithTone(
  node: MaterialGraphNode | undefined,
  portId: string,
  tone: 'scalar' | 'color',
): boolean {
  return Boolean(node?.outputs.some((port) => port.id === portId && port.tone === tone));
}

function findScalarOutput(node: MaterialGraphNode | undefined, portId: string): boolean {
  return findOutputWithTone(node, portId, 'scalar');
}

/**
 * Diagnoses the recipe interface carried by a graph. Returns an empty list when
 * the graph declares no interface: that is a plain material, not an error.
 */
export function diagnoseMaterialRecipeInterface(
  graph: MaterialGraphDocument,
): MaterialRecipeDiagnostic[] {
  const recipe = graph.recipe;
  if (!recipe) return [];

  const messages: MaterialRecipeDiagnostic[] = [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const seenSlotIds = new Set<string>();
  for (const slot of recipe.slots) {
    if (seenSlotIds.has(slot.id)) {
      messages.push({
        code: 'GRAPH_RECIPE_SLOT_ID_DUPLICATE',
        severity: 'error',
        message: `Recipe slot id "${slot.id}" is declared more than once.`,
        field: `${GRAPH_FIELD_PREFIX}.recipe.slots[${slot.id}]`,
        slotId: slot.id,
        guidance: 'Give every slot of a recipe a unique id.',
      });
      continue;
    }
    seenSlotIds.add(slot.id);

    if (slot.maskPort && !findScalarOutput(nodeById.get(slot.maskPort.nodeId), slot.maskPort.portId)) {
      messages.push({
        code: 'GRAPH_RECIPE_MASK_PORT_INVALID',
        severity: 'error',
        message: `Slot "${slot.id}" masks on "${slot.maskPort.nodeId}.${slot.maskPort.portId}", which is not an existing scalar output.`,
        field: `${GRAPH_FIELD_PREFIX}.recipe.slots[${slot.id}].maskPort`,
        slotId: slot.id,
        nodeId: slot.maskPort.nodeId,
        portId: slot.maskPort.portId,
        guidance: 'Point maskPort at a scalar output of a node in this graph, or drop it to derive the mask from the mode.',
      });
    }
  }

  const surfaceNode = nodeById.get(recipe.exports.surface.nodeId);
  const reachesOutput = collectShaderPathToOutput(graph);
  if (!surfaceNode || !RECIPE_SURFACE_TYPES.has(surfaceNode.type) || !reachesOutput.has(surfaceNode.id)) {
    messages.push({
      code: 'GRAPH_RECIPE_EXPORT_SURFACE_MISSING',
      severity: 'error',
      message: `Recipe surface export "${recipe.exports.surface.nodeId}" is not a reachable surface node.`,
      field: `${GRAPH_FIELD_PREFIX}.recipe.exports.surface`,
      nodeId: recipe.exports.surface.nodeId,
      portId: 'shader',
      guidance: 'exports.surface must name a pbr-surface, glass-surface, unlit-surface or surface-blend node wired to Material Output.',
    });
  }

  if (recipe.exports.pattern && !findScalarOutput(nodeById.get(recipe.exports.pattern.nodeId), recipe.exports.pattern.portId)) {
    messages.push({
      // Same rule as a slot mask: both name a scalar port of this graph.
      code: 'GRAPH_RECIPE_MASK_PORT_INVALID',
      severity: 'error',
      message: `Recipe pattern export "${recipe.exports.pattern.nodeId}.${recipe.exports.pattern.portId}" is not an existing scalar output.`,
      field: `${GRAPH_FIELD_PREFIX}.recipe.exports.pattern`,
      nodeId: recipe.exports.pattern.nodeId,
      portId: recipe.exports.pattern.portId,
      guidance: 'exports.pattern must name a scalar output such as a noise, wave or voronoi factor.',
    });
  }

  if (
    recipe.exports.albedo &&
    !findOutputWithTone(nodeById.get(recipe.exports.albedo.nodeId), recipe.exports.albedo.portId, 'color')
  ) {
    messages.push({
      // Same rule as a slot mask and the pattern export: a port of this graph,
      // of the tone the export promises.
      code: 'GRAPH_RECIPE_MASK_PORT_INVALID',
      severity: 'error',
      message: `Recipe albedo export "${recipe.exports.albedo.nodeId}.${recipe.exports.albedo.portId}" is not an existing colour output.`,
      field: `${GRAPH_FIELD_PREFIX}.recipe.exports.albedo`,
      nodeId: recipe.exports.albedo.nodeId,
      portId: recipe.exports.albedo.portId,
      guidance: 'exports.albedo must name a colour output; it may sit off the output path until the recipe is invited.',
    });
  }

  for (const intent of recipe.intents) {
    for (const target of intent.targets) {
      if (nodeById.has(target.nodeId)) continue;
      messages.push({
        code: 'GRAPH_RECIPE_INTENT_TARGET_MISSING',
        severity: 'error',
        message: `Intent "${intent.id}" drives unknown node "${target.nodeId}".`,
        field: `${GRAPH_FIELD_PREFIX}.recipe.intents[${intent.id}].targets`,
        intentId: intent.id,
        nodeId: target.nodeId,
        guidance: 'Point every intent target at a node of this recipe, or remove the target.',
      });
    }
  }

  return messages;
}

/**
 * Diagnoses a raw composition payload (pre-sanitize) so a tree deeper than the
 * cap is reported instead of being silently truncated.
 */
export function diagnoseMaterialCompositionPayload(raw: unknown): MaterialRecipeDiagnostic[] {
  if (!isPlainObject(raw) || !isPlainObject(raw.root)) return [];
  const messages: MaterialRecipeDiagnostic[] = [];
  const walk = (value: unknown, depth: number, path: string): void => {
    if (!isPlainObject(value)) return;
    const instanceId = typeof value.instanceId === 'string' ? value.instanceId : '(unnamed)';
    if (depth > MATERIAL_COMPOSITION_MAX_DEPTH) {
      messages.push({
        code: 'COMPOSITION_DEPTH_EXCEEDED',
        severity: 'error',
        message: `Composition instance "${instanceId}" sits at level ${depth}; the cap is ${MATERIAL_COMPOSITION_MAX_DEPTH}.`,
        field: path,
        instanceId,
        guidance: `Fold the mix into a recipe, or remove a guest: a composition holds at most ${MATERIAL_COMPOSITION_MAX_DEPTH} levels.`,
      });
      return;
    }
    if (depth > 16 || !isPlainObject(value.guests)) return;
    for (const [slotId, guest] of Object.entries(value.guests)) {
      walk(guest, depth + 1, `${path}.guests[${slotId}]`);
    }
  };
  walk(raw.root, 1, `${COMPOSITION_FIELD_PREFIX}.root`);
  return messages;
}

/** Reads the composition tree from a material document, if present and valid. */
export function readMaterialComposition(
  document: PrismorphicMaterialDocument,
): PrismorphicCompositionExtension | null {
  return sanitizeMaterialComposition(document.extensions?.[MATERIAL_COMPOSITION_EXTENSION_KEY]);
}

/** Diagnoses the composition carried by a document, before sanitation. */
export function diagnoseMaterialDocumentComposition(
  document: PrismorphicMaterialDocument,
): MaterialRecipeDiagnostic[] {
  return diagnoseMaterialCompositionPayload(
    document.extensions?.[MATERIAL_COMPOSITION_EXTENSION_KEY],
  );
}
