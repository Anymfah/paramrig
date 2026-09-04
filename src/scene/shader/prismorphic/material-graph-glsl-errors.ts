/**
 * Parses WebGL/GLSL shader info logs and localizes them to graph nodes using
 * the `// node <type> (<id>)` markers emitted by compileMaterialGraphGlsl.
 */

import type { ValidationMessage } from './material.ts';

export type GlslShaderStage = 'vertex' | 'fragment';

export interface ParsedGlslInfoLogEntry {
  /** Exact compiler line text (trimmed), preserved for the editor. */
  exactMessage: string;
  severity: 'error' | 'warning' | 'info';
  line: number | null;
  column: number | null;
}

export interface LocalizedGlslCompileError {
  stage: GlslShaderStage;
  /** Exact GLSL compiler message for display in the editor. */
  exactMessage: string;
  severity: 'error' | 'warning' | 'info';
  line: number | null;
  column: number | null;
  nodeId: string | null;
  nodeType: string | null;
  /** Localized JSON-style field path when a node marker is found. */
  field: string;
}

const NODE_MARKER = /\/\/\s*node\s+([^\s(]+)\s*\(([^)]+)\)/;

/**
 * Parses ANGLE / desktop GLSL info-log lines into structured entries.
 * Keeps the exact compiler text for editor display.
 */
export function parseGlslShaderInfoLog(infoLog: string): ParsedGlslInfoLogEntry[] {
  const entries: ParsedGlslInfoLogEntry[] = [];
  const lines = infoLog.split(/\r?\n/);

  for (const raw of lines) {
    const text = raw.trim();
    if (!text) continue;

    // Formats: "ERROR: 0:12: message", "0(12) : error C0000: ...", "ERROR: 12:3: ..."
    const angle = text.match(/^(ERROR|WARNING|INFO)\s*:\s*(?:\d+:)?(\d+)(?::(\d+))?\s*:\s*(.+)$/i);
    const desktop = text.match(/^(\d+)\((\d+)\)\s*:\s*(error|warning|info)\b\s*(.*)$/i);
    const bareLine = text.match(/^(ERROR|WARNING|INFO)\s*:\s*(.+)$/i);

    if (angle) {
      entries.push({
        exactMessage: text,
        severity: (angle[1] ?? 'error').toLowerCase() as 'error' | 'warning' | 'info',
        line: Number(angle[2]),
        column: angle[3] ? Number(angle[3]) : null,
      });
      continue;
    }
    if (desktop) {
      entries.push({
        exactMessage: text,
        severity: (desktop[3] ?? 'error').toLowerCase() as 'error' | 'warning' | 'info',
        line: Number(desktop[2]),
        column: null,
      });
      continue;
    }
    if (bareLine) {
      entries.push({
        exactMessage: text,
        severity: (bareLine[1] ?? 'error').toLowerCase() as 'error' | 'warning' | 'info',
        line: null,
        column: null,
      });
      continue;
    }

    entries.push({
      exactMessage: text,
      severity: /warn/i.test(text) ? 'warning' : 'error',
      line: null,
      column: null,
    });
  }

  return entries;
}

/**
 * Builds a line→node map from GLSL source that contains `// node type (id)` markers.
 */
export function buildGlslNodeLineIndex(
  source: string,
): Array<{ line: number; nodeType: string; nodeId: string }> {
  const index: Array<{ line: number; nodeType: string; nodeId: string }> = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i]?.match(NODE_MARKER);
    if (!match) continue;
    index.push({ line: i + 1, nodeType: match[1] ?? '', nodeId: match[2] ?? '' });
  }
  return index;
}

function findNearestNode(
  line: number | null,
  index: Array<{ line: number; nodeType: string; nodeId: string }>,
): { nodeType: string; nodeId: string } | null {
  if (line === null || index.length === 0) return null;
  let best: { line: number; nodeType: string; nodeId: string } | null = null;
  for (const entry of index) {
    if (entry.line <= line) {
      best = entry;
    } else {
      break;
    }
  }
  return best ? { nodeType: best.nodeType, nodeId: best.nodeId } : null;
}

/**
 * Localizes parsed GLSL info-log entries to graph nodes when possible.
 */
export function localizeGlslCompileErrors(
  infoLog: string,
  stage: GlslShaderStage,
  sourceForLocalization: string,
): LocalizedGlslCompileError[] {
  const parsed = parseGlslShaderInfoLog(infoLog);
  const index = buildGlslNodeLineIndex(sourceForLocalization);

  return parsed.map((entry) => {
    const node = findNearestNode(entry.line, index);
    const field = node
      ? `extensions['prismorphic.graph'].nodes[${node.nodeId}]`
      : `extensions['prismorphic.shader'].${stage}`;
    return {
      stage,
      exactMessage: entry.exactMessage,
      severity: entry.severity,
      line: entry.line,
      column: entry.column,
      nodeId: node?.nodeId ?? null,
      nodeType: node?.nodeType ?? null,
      field,
    };
  });
}

/**
 * Converts localized GLSL compile errors into ValidationMessage entries that
 * preserve the exact compiler text in `message`.
 */
export function glslCompileErrorsToValidationMessages(
  errors: readonly LocalizedGlslCompileError[],
): ValidationMessage[] {
  return errors.map((error) => {
    const location = [
      error.stage,
      error.line !== null ? `line ${error.line}` : null,
      error.column !== null ? `col ${error.column}` : null,
      error.nodeId ? `node ${error.nodeType ?? '?'}(${error.nodeId})` : null,
    ]
      .filter(Boolean)
      .join(', ');

    return {
      code: 'MAT_SHADER_COMPILE_FAILED',
      severity: error.severity === 'info' ? 'warning' : error.severity,
      field: error.field,
      // Exact GLSL compiler message first so the editor can show it verbatim.
      message: location ? `${error.exactMessage} [${location}]` : error.exactMessage,
    };
  });
}

/**
 * Convenience: info log + stage + graph evaluate source → validation messages.
 */
export function diagnoseGlslCompileInfoLog(
  infoLog: string,
  stage: GlslShaderStage,
  sourceForLocalization: string,
): ValidationMessage[] {
  if (!infoLog.trim()) return [];
  return glslCompileErrorsToValidationMessages(
    localizeGlslCompileErrors(infoLog, stage, sourceForLocalization),
  );
}
