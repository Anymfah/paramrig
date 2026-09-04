/**
 * Advanced material-graph diagnostics: mandatory outputs, incomplete-graph
 * guidance, and complete edge typing checks with localized field paths.
 */

import type {
  MaterialKind,
  PrismorphicMaterialDocument,
  ValidationMessage,
  ValidationSeverity,
  ValidationStatus,
} from './material.ts';
import {
  MATERIAL_GRAPH_EXTENSION_KEY,
  MATERIAL_GRAPH_NODE_TYPES_BY_KIND,
  MATERIAL_GRAPH_PORTS_BY_TYPE,
  type MaterialGraphDocument,
  type MaterialGraphEdge,
  type MaterialGraphNode,
  type MaterialGraphNodeType,
  type MaterialGraphPortTone,
  commitMaterialGraph,
  evaluateMaterialGraphEffects,
  readMaterialGraph,
  resolveMaterialGraph,
  sanitizeMaterialGraph,
} from './material-graph.ts';
import { diagnoseMaterialDocumentComposition, diagnoseMaterialRecipeInterface } from './material-recipe.ts';

export const MATERIAL_GRAPH_DIAGNOSTIC_CODES = [
  'MAT_GRAPH_MISSING_OUTPUT',
  'MAT_GRAPH_INCOMPLETE_SURFACE',
  'MAT_GRAPH_INCOMPLETE',
  'MAT_GRAPH_TYPE_MISMATCH',
  'MAT_GRAPH_UNKNOWN_PORT',
  'MAT_GRAPH_UNKNOWN_NODE',
  'MAT_GRAPH_OUTPUT_MUTED',
  'MAT_SHADER_COMPILE_FAILED',
  // D2-1 recipe interface, carried inside the graph extension.
  'GRAPH_RECIPE_SLOT_ID_DUPLICATE',
  'GRAPH_RECIPE_EXPORT_SURFACE_MISSING',
  'GRAPH_RECIPE_MASK_PORT_INVALID',
  'GRAPH_RECIPE_INTENT_TARGET_MISSING',
  // D2-1 composition tree, carried in its own extension.
  'COMPOSITION_DEPTH_EXCEEDED',
] as const;

export type MaterialGraphDiagnosticCode = (typeof MATERIAL_GRAPH_DIAGNOSTIC_CODES)[number];

export interface MaterialGraphDiagnostic extends ValidationMessage {
  code: MaterialGraphDiagnosticCode;
  /** Actionable guidance for incomplete or mistyped graphs. */
  guidance?: string;
  nodeId?: string;
  portId?: string;
  edgeId?: string;
}

export interface MaterialGraphDiagnosticsResult {
  status: ValidationStatus;
  messages: MaterialGraphDiagnostic[];
  incomplete: boolean;
  /** Deduplicated incomplete-graph guidance lines for the editor. */
  guidance: string[];
}

const GRAPH_FIELD_PREFIX = `extensions['${MATERIAL_GRAPH_EXTENSION_KEY}']`;

const SURFACE_NODE_BY_KIND: Record<MaterialKind, MaterialGraphNodeType> = {
  pbr: 'pbr-surface',
  procedural: 'glass-surface',
  unlit: 'unlit-surface',
};

const COMPATIBLE_SURFACES_BY_KIND: Record<MaterialKind, ReadonlySet<MaterialGraphNodeType>> = {
  pbr: new Set(['pbr-surface', 'glass-surface']),
  procedural: new Set(['pbr-surface', 'glass-surface', 'unlit-surface']),
  unlit: new Set(['unlit-surface']),
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function graphNodeField(nodeId: string, portId?: string): string {
  if (portId) {
    return `${GRAPH_FIELD_PREFIX}.nodes[${nodeId}].inputs[${portId}]`;
  }
  return `${GRAPH_FIELD_PREFIX}.nodes[${nodeId}]`;
}

function graphEdgeField(edgeId: string): string {
  return `${GRAPH_FIELD_PREFIX}.edges[${edgeId}]`;
}

function pushDiagnostic(
  messages: MaterialGraphDiagnostic[],
  entry: MaterialGraphDiagnostic,
): void {
  messages.push(entry);
}

function isNonShaderError(message: ValidationMessage): boolean {
  return message.severity === 'error' && message.code !== 'MAT_SHADER_COMPILE_FAILED';
}

/**
 * Graph structural errors win over shader compile failures so export stays
 * blocked when Surface / typing is invalid — even if WebGL also failed.
 */
function resolveStatus(messages: readonly ValidationMessage[]): ValidationStatus {
  if (messages.some(isNonShaderError)) {
    return 'invalid';
  }
  if (messages.some((item) => item.code === 'MAT_SHADER_COMPILE_FAILED')) {
    return 'degraded';
  }
  if (messages.some((item) => item.severity === 'error')) {
    return 'invalid';
  }
  if (messages.some((item) => item.severity === 'warning')) {
    return 'warning';
  }
  return 'valid';
}

function findPortTone(
  node: MaterialGraphNode,
  side: 'inputs' | 'outputs',
  portId: string,
): MaterialGraphPortTone | null {
  const port = node[side].find((entry) => entry.id === portId);
  return port?.tone ?? null;
}

function diagnoseTypingOnEdges(
  nodes: readonly MaterialGraphNode[],
  edges: readonly MaterialGraphEdge[],
  messages: MaterialGraphDiagnostic[],
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  for (const edge of edges) {
    const fromNode = nodeById.get(edge.fromNode);
    const toNode = nodeById.get(edge.toNode);
    if (!fromNode) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_UNKNOWN_NODE',
        severity: 'error',
        message: `Edge "${edge.id}" references unknown source node "${edge.fromNode}".`,
        field: graphEdgeField(edge.id),
        edgeId: edge.id,
        nodeId: edge.fromNode,
        guidance: 'Remove the broken wire or restore the missing source node.',
      });
      continue;
    }
    if (!toNode) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_UNKNOWN_NODE',
        severity: 'error',
        message: `Edge "${edge.id}" references unknown target node "${edge.toNode}".`,
        field: graphEdgeField(edge.id),
        edgeId: edge.id,
        nodeId: edge.toNode,
        guidance: 'Remove the broken wire or restore the missing target node.',
      });
      continue;
    }

    const fromTone = findPortTone(fromNode, 'outputs', edge.fromPort);
    const toTone = findPortTone(toNode, 'inputs', edge.toPort);

    if (!fromTone) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_UNKNOWN_PORT',
        severity: 'error',
        message: `Node "${fromNode.id}" (${fromNode.type}) has no output port "${edge.fromPort}".`,
        field: `${GRAPH_FIELD_PREFIX}.nodes[${fromNode.id}].outputs[${edge.fromPort}]`,
        edgeId: edge.id,
        nodeId: fromNode.id,
        portId: edge.fromPort,
        guidance: `Use a declared output on ${fromNode.type}: ${fromNode.outputs.map((port) => port.id).join(', ') || '(none)'}.`,
      });
    }
    if (!toTone) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_UNKNOWN_PORT',
        severity: 'error',
        message: `Node "${toNode.id}" (${toNode.type}) has no input port "${edge.toPort}".`,
        field: graphNodeField(toNode.id, edge.toPort),
        edgeId: edge.id,
        nodeId: toNode.id,
        portId: edge.toPort,
        guidance: `Use a declared input on ${toNode.type}: ${toNode.inputs.map((port) => port.id).join(', ') || '(none)'}.`,
      });
    }
    if (fromTone && toTone && fromTone !== toTone) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_TYPE_MISMATCH',
        severity: 'error',
        message: `Type mismatch on edge "${edge.id}": ${fromNode.type}.${edge.fromPort} (${fromTone}) cannot connect to ${toNode.type}.${edge.toPort} (${toTone}).`,
        field: graphEdgeField(edge.id),
        edgeId: edge.id,
        nodeId: toNode.id,
        portId: edge.toPort,
        guidance: `Connect a ${toTone} output to ${toNode.type}.${edge.toPort}, or change the target port to accept ${fromTone}.`,
      });
    } else if (fromTone && edge.tone && edge.tone !== fromTone) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_TYPE_MISMATCH',
        severity: 'error',
        message: `Edge "${edge.id}" declares tone "${edge.tone}" but source port is "${fromTone}".`,
        field: graphEdgeField(edge.id),
        edgeId: edge.id,
        nodeId: fromNode.id,
        portId: edge.fromPort,
        guidance: `Update the edge tone to "${fromTone}" to match the source port.`,
      });
    }
  }
}

function diagnoseTypingOnRawPayload(
  raw: unknown,
  kind: MaterialKind,
  messages: MaterialGraphDiagnostic[],
): void {
  if (!isPlainObject(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    return;
  }

  const allowed = new Set(MATERIAL_GRAPH_NODE_TYPES_BY_KIND[kind]);
  const nodeById = new Map<string, { id: string; type: MaterialGraphNodeType }>();
  const declaredNodeIds = new Set<string>();

  for (const entry of raw.nodes) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || typeof entry.type !== 'string') continue;
    declaredNodeIds.add(entry.id);
    if (!allowed.has(entry.type as MaterialGraphNodeType)) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_UNKNOWN_NODE',
        severity: 'error',
        message: `Node "${entry.id}" uses unknown or forbidden type "${entry.type}" for kind "${kind}".`,
        field: graphNodeField(entry.id),
        nodeId: entry.id,
        guidance: `Use a node type allowed for ${kind}, or remove "${entry.id}".`,
      });
      continue;
    }
    if (!nodeById.has(entry.id)) {
      nodeById.set(entry.id, { id: entry.id, type: entry.type as MaterialGraphNodeType });
    }
  }

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

    const edgeId =
      typeof item.id === 'string' && item.id.length > 0
        ? item.id
        : `${item.fromNode}:${item.fromPort}->${item.toNode}:${item.toPort}`;
    const fromNode = nodeById.get(item.fromNode);
    const toNode = nodeById.get(item.toNode);
    if (!fromNode) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_UNKNOWN_NODE',
        severity: 'error',
        message: declaredNodeIds.has(item.fromNode)
          ? `Edge "${edgeId}" references forbidden or invalid source node "${item.fromNode}".`
          : `Edge "${edgeId}" references unknown source node "${item.fromNode}".`,
        field: graphEdgeField(edgeId),
        edgeId,
        nodeId: item.fromNode,
        guidance: 'Remove the broken wire or restore a valid source node.',
      });
      continue;
    }
    if (!toNode) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_UNKNOWN_NODE',
        severity: 'error',
        message: declaredNodeIds.has(item.toNode)
          ? `Edge "${edgeId}" references forbidden or invalid target node "${item.toNode}".`
          : `Edge "${edgeId}" references unknown target node "${item.toNode}".`,
        field: graphEdgeField(edgeId),
        edgeId,
        nodeId: item.toNode,
        guidance: 'Remove the broken wire or restore a valid target node.',
      });
      continue;
    }

    const fromPorts = MATERIAL_GRAPH_PORTS_BY_TYPE[fromNode.type]?.outputs ?? [];
    const toPorts = MATERIAL_GRAPH_PORTS_BY_TYPE[toNode.type]?.inputs ?? [];
    const fromPort = fromPorts.find((port) => port.id === item.fromPort);
    const toPort = toPorts.find((port) => port.id === item.toPort);

    if (!fromPort) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_UNKNOWN_PORT',
        severity: 'error',
        message: `Raw edge "${edgeId}" uses unknown output "${item.fromPort}" on ${fromNode.type}.`,
        field: `${GRAPH_FIELD_PREFIX}.nodes[${fromNode.id}].outputs[${item.fromPort}]`,
        edgeId,
        nodeId: fromNode.id,
        portId: item.fromPort,
        guidance: `Declared outputs: ${fromPorts.map((port) => `${port.id}:${port.tone}`).join(', ') || '(none)'}.`,
      });
      continue;
    }
    if (!toPort) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_UNKNOWN_PORT',
        severity: 'error',
        message: `Raw edge "${edgeId}" uses unknown input "${item.toPort}" on ${toNode.type}.`,
        field: graphNodeField(toNode.id, item.toPort),
        edgeId,
        nodeId: toNode.id,
        portId: item.toPort,
        guidance: `Declared inputs: ${toPorts.map((port) => `${port.id}:${port.tone}`).join(', ') || '(none)'}.`,
      });
      continue;
    }
    if (fromPort.tone !== toPort.tone) {
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_TYPE_MISMATCH',
        severity: 'error',
        message: `Type mismatch: ${fromNode.type}.${item.fromPort} (${fromPort.tone}) → ${toNode.type}.${item.toPort} (${toPort.tone}).`,
        field: graphEdgeField(edgeId),
        edgeId,
        nodeId: toNode.id,
        portId: item.toPort,
        guidance: `Connect a ${toPort.tone} source to ${toNode.type}.${item.toPort}. The incompatible wire will be rejected on sanitize.`,
      });
    } else if (typeof item.tone === 'string' && item.tone.length > 0 && item.tone !== fromPort.tone) {
      // Sanitize rewrites edge.tone from the source port; catch the raw mismatch first.
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_TYPE_MISMATCH',
        severity: 'error',
        message: `Edge "${edgeId}" declares tone "${item.tone}" but source port is "${fromPort.tone}".`,
        field: graphEdgeField(edgeId),
        edgeId,
        nodeId: fromNode.id,
        portId: item.fromPort,
        guidance: `Update the edge tone to "${fromPort.tone}" to match the source port.`,
      });
    }
  }
}

function diagnoseCompleteness(
  graph: MaterialGraphDocument,
  kind: MaterialKind,
  messages: MaterialGraphDiagnostic[],
): { incomplete: boolean; guidance: string[] } {
  const guidance: string[] = [];
  let incomplete = false;
  const effects = evaluateMaterialGraphEffects(graph);
  const outputNodes = graph.nodes.filter((node) => node.type === 'material-output');
  const expectedSurface = SURFACE_NODE_BY_KIND[kind];

  if (outputNodes.length === 0) {
    incomplete = true;
    const line =
      'Add a Material Output node and connect a surface shader to its Surface input.';
    guidance.push(line);
    pushDiagnostic(messages, {
      code: 'MAT_GRAPH_MISSING_OUTPUT',
      severity: 'error',
      message: 'Mandatory material-output node is missing.',
      field: `${GRAPH_FIELD_PREFIX}.nodes[material-output]`,
      guidance: line,
    });
    return { incomplete, guidance };
  }

  for (const output of outputNodes) {
    const surfaceEdge = graph.edges.find(
      (edge) => edge.toNode === output.id && edge.toPort === 'surface',
    );
    if (!surfaceEdge) {
      incomplete = true;
      const line = `Connect a ${expectedSurface} (or compatible surface) shader output to Material Output → Surface.`;
      guidance.push(line);
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_INCOMPLETE_SURFACE',
        severity: 'error',
        message: `Mandatory output "${output.id}" has no Surface connection.`,
        field: graphNodeField(output.id, 'surface'),
        nodeId: output.id,
        portId: 'surface',
        guidance: line,
      });
    } else {
      const fromNode = graph.nodes.find((node) => node.id === surfaceEdge.fromNode);
      if (fromNode && fromNode.type !== expectedSurface) {
        // Compatible surface kinds still satisfy the mandatory output; warn when kind mismatches.
        // A composed document reaches the output through its outermost blend.
        const surfaceTypes = new Set([
          'pbr-surface',
          'glass-surface',
          'unlit-surface',
          'surface-blend',
        ]);
        if (!surfaceTypes.has(fromNode.type)) {
          incomplete = true;
          const line = `Material Output Surface must receive a surface shader; "${fromNode.type}" is not a surface.`;
          guidance.push(line);
          pushDiagnostic(messages, {
            code: 'MAT_GRAPH_INCOMPLETE_SURFACE',
            severity: 'error',
            message: `Output "${output.id}" Surface is driven by non-surface node "${fromNode.id}" (${fromNode.type}).`,
            field: graphNodeField(output.id, 'surface'),
            nodeId: output.id,
            portId: 'surface',
            edgeId: surfaceEdge.id,
            guidance: line,
          });
        }
      }
    }

    if (output.settings?.outputEnabled === false) {
      const line = 'Enable Material Output to restore the live preview.';
      guidance.push(line);
      pushDiagnostic(messages, {
        code: 'MAT_GRAPH_OUTPUT_MUTED',
        severity: 'warning',
        message: `Material output "${output.id}" is muted (outputEnabled=false).`,
        field: `${graphNodeField(output.id)}.settings.outputEnabled`,
        nodeId: output.id,
        guidance: line,
      });
    }
  }

  if (!effects.surfaceConnected && !messages.some((item) => item.code === 'MAT_GRAPH_INCOMPLETE_SURFACE')) {
    incomplete = true;
    const line = 'The graph does not reach Material Output with a connected surface path.';
    guidance.push(line);
    pushDiagnostic(messages, {
      code: 'MAT_GRAPH_INCOMPLETE',
      severity: 'error',
      message: 'Incomplete graph: no surface reaches the material output.',
      field: `${GRAPH_FIELD_PREFIX}.edges`,
      guidance: line,
    });
  }

  const hasKindSurface = graph.nodes.some((node) => COMPATIBLE_SURFACES_BY_KIND[kind].has(node.type));
  if (!hasKindSurface) {
    incomplete = true;
    const line = `Add a ${expectedSurface} node and wire it to Material Output → Surface.`;
    guidance.push(line);
    pushDiagnostic(messages, {
      code: 'MAT_GRAPH_INCOMPLETE',
      severity: 'warning',
      message: `Expected ${expectedSurface} for kind "${kind}" is missing.`,
      field: `${GRAPH_FIELD_PREFIX}.nodes`,
      guidance: line,
    });
  }

  return { incomplete, guidance: [...new Set(guidance)] };
}

/**
 * Diagnoses a sanitized material graph for mandatory outputs, incompleteness,
 * and edge typing. Field paths localize each issue to a node, port, or edge.
 */
export function diagnoseMaterialGraph(
  graph: MaterialGraphDocument,
  kind: MaterialKind = 'procedural',
): MaterialGraphDiagnosticsResult {
  const messages: MaterialGraphDiagnostic[] = [];
  diagnoseTypingOnEdges(graph.nodes, graph.edges, messages);
  const { incomplete, guidance } = diagnoseCompleteness(graph, kind, messages);
  messages.push(...diagnoseMaterialRecipeInterface(graph));
  return {
    status: resolveStatus(messages),
    messages,
    incomplete,
    guidance,
  };
}

/**
 * Diagnoses a raw graph payload (pre-sanitize), including type mismatches that
 * sanitize would silently drop, then merges completeness checks on the sanitized form.
 */
export function diagnoseMaterialGraphPayload(
  raw: unknown,
  kind: MaterialKind,
): MaterialGraphDiagnosticsResult {
  const messages: MaterialGraphDiagnostic[] = [];
  diagnoseTypingOnRawPayload(raw, kind, messages);
  const sanitized = sanitizeMaterialGraph(raw, kind);
  if (!sanitized) {
    const line = 'Graph payload is missing nodes/edges or failed kind validation.';
    messages.push({
      code: 'MAT_GRAPH_INCOMPLETE',
      severity: 'error',
      message: 'Incomplete or invalid graph payload.',
      field: GRAPH_FIELD_PREFIX,
      guidance: line,
    });
    return {
      status: resolveStatus(messages),
      messages,
      incomplete: true,
      guidance: [line],
    };
  }

  const sanitizedResult = diagnoseMaterialGraph(sanitized, kind);
  const merged = [...messages, ...sanitizedResult.messages];
  const guidance = [...new Set([...messages.map((item) => item.guidance).filter(Boolean) as string[], ...sanitizedResult.guidance])];
  return {
    status: resolveStatus(merged),
    messages: merged,
    incomplete: sanitizedResult.incomplete || messages.some((item) => item.severity === 'error'),
    guidance,
  };
}

/** True when a validation code belongs to the material-graph diagnostics family. */
export function isMaterialGraphDiagnosticCode(code: string): boolean {
  return (MATERIAL_GRAPH_DIAGNOSTIC_CODES as readonly string[]).includes(code);
}

/**
 * Merges graph diagnostics into document metadata while preserving unrelated
 * validation messages (parameters, textures, schema, etc.).
 */
export function mergeMaterialGraphDiagnostics(
  document: PrismorphicMaterialDocument,
  diagnostics: MaterialGraphDiagnosticsResult,
  extraMessages: readonly ValidationMessage[] = [],
): PrismorphicMaterialDocument {
  const preserved = (document.metadata.validationMessages ?? []).filter(
    (message) => !isMaterialGraphDiagnosticCode(message.code),
  );
  const graphMessages: ValidationMessage[] = diagnostics.messages.map((message) => ({
    code: message.code,
    message: message.message,
    severity: message.severity,
    field: message.field,
    // Keep actionable incomplete-graph guidance so the Nodes panel can show it
    // after import even when the live (sanitized) graph no longer reproduces it.
    ...(typeof message.guidance === 'string' && message.guidance.length > 0
      ? { guidance: message.guidance }
      : {}),
  }));
  const messages = [...preserved, ...graphMessages, ...extraMessages];
  const status = statusFromMessages(messages);

  return {
    ...document,
    metadata: {
      ...document.metadata,
      validationStatus: status,
      validationMessages: messages.length > 0 ? messages : undefined,
      updatedAt: new Date().toISOString(),
    },
  };
}

function statusFromMessages(messages: readonly ValidationMessage[]): ValidationStatus {
  return resolveStatus(messages);
}

/** Runs diagnostics on the document graph (or default) and writes metadata. */
export function applyMaterialGraphDiagnosticsToDocument(
  document: PrismorphicMaterialDocument,
  extraMessages: readonly ValidationMessage[] = [],
): PrismorphicMaterialDocument {
  const graph = resolveMaterialGraph(document);
  const diagnostics = mergeMaterialCompositionDiagnostics(
    document,
    diagnoseMaterialGraph(graph, document.kind),
  );
  return mergeMaterialGraphDiagnostics(document, diagnostics, extraMessages);
}

/**
 * Commits a graph into the document then refreshes localized graph diagnostics
 * on metadata (mandatory outputs, incompleteness, typing).
 */
export function commitAndDiagnoseMaterialGraph(
  document: PrismorphicMaterialDocument,
  graphInput: unknown,
): {
  document: PrismorphicMaterialDocument;
  graph: MaterialGraphDocument;
  diagnostics: MaterialGraphDiagnosticsResult;
} {
  const { document: committed, graph } = commitMaterialGraph(document, graphInput);
  const diagnostics = mergeMaterialCompositionDiagnostics(
    committed,
    diagnoseMaterialGraph(graph, committed.kind),
  );
  return {
    document: mergeMaterialGraphDiagnostics(committed, diagnostics),
    graph,
    diagnostics,
  };
}

/** Reads the embedded graph and returns diagnostics without mutating the document. */
export function diagnoseMaterialDocumentGraph(
  document: PrismorphicMaterialDocument,
): MaterialGraphDiagnosticsResult {
  const graph = readMaterialGraph(document) ?? resolveMaterialGraph(document);
  return mergeMaterialCompositionDiagnostics(document, diagnoseMaterialGraph(graph, document.kind));
}

/**
 * Folds the document-level composition diagnostics into a graph result. The
 * composition lives in its own extension, so it can only be checked where the
 * document is at hand, but it shares the diagnostics family: a stale message is
 * stripped and rewritten by the same merge.
 */
export function mergeMaterialCompositionDiagnostics(
  document: PrismorphicMaterialDocument,
  result: MaterialGraphDiagnosticsResult,
): MaterialGraphDiagnosticsResult {
  const composition = diagnoseMaterialDocumentComposition(document) as MaterialGraphDiagnostic[];
  if (composition.length === 0) return result;
  const messages = [...result.messages, ...composition];
  const guidance = [
    ...new Set([
      ...result.guidance,
      ...(composition.map((item) => item.guidance).filter(Boolean) as string[]),
    ]),
  ];
  return { ...result, status: resolveStatus(messages), messages, guidance };
}

/** Severity helper for UI banners. */
export function highestDiagnosticSeverity(
  messages: readonly ValidationMessage[],
): ValidationSeverity | null {
  if (messages.some((item) => item.severity === 'error')) return 'error';
  if (messages.some((item) => item.severity === 'warning')) return 'warning';
  if (messages.some((item) => item.severity === 'info')) return 'info';
  return null;
}
