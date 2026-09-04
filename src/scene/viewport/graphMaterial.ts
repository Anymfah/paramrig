import type { MeshPhysicalMaterial } from 'three'

/**
 * A material whose surface is a graph.
 *
 * The engine that compiles one is seven and a half thousand lines of vendored code, and a scene
 * with no shader graph in it should not fetch a byte of it — so it is imported the first time a
 * graph is actually drawn, and the material is left as its Principled until it lands. The listener
 * is how the viewport learns to draw again.
 *
 * The patch itself is the copy's own: three.js has one `onBeforeCompile` per material, and this is
 * where the compiled programme is grafted onto a `MeshPhysicalMaterial`. The cache key names the
 * graph, so two materials with different graphs cannot share a compiled shader — and two with the
 * same one do.
 */

type Engine = {
  getCachedMaterialGraphGlsl: typeof import('@/scene/shader/prismorphic/material-graph-glsl').getCachedMaterialGraphGlsl
  applyCompiledGraphShaderInjection: typeof import('@/scene/shader/prismorphic/injectCompiledGraphShader').applyCompiledGraphShaderInjection
  createPrismorphicMaterialParameterUniforms: typeof import('@/scene/shader/prismorphic/injectCompiledGraphShader').createPrismorphicMaterialParameterUniforms
  sanitizeMaterialGraph: typeof import('@/scene/shader/prismorphic/material-graph').sanitizeMaterialGraph
}

let engine: Engine | null = null
let loading: Promise<Engine | null> | null = null
const listeners = new Set<() => void>()

/** The clock the graphs read, in seconds. One uniform object, shared by every graph material. */
const time = { value: 0 }

export function setGraphTime(seconds: number): void {
  time.value = seconds
}

/** Told when the engine lands, so what was drawn without it is drawn again. */
export function onGraphEngine(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function graphEngineReady(): boolean {
  return engine !== null
}

function loadEngine(): void {
  if (engine || loading) return
  loading = (async () => {
    try {
      const [glsl, inject, graph] = await Promise.all([
        import('@/scene/shader/prismorphic/material-graph-glsl'),
        import('@/scene/shader/prismorphic/injectCompiledGraphShader'),
        import('@/scene/shader/prismorphic/material-graph'),
      ])
      engine = {
        getCachedMaterialGraphGlsl: glsl.getCachedMaterialGraphGlsl,
        applyCompiledGraphShaderInjection: inject.applyCompiledGraphShaderInjection,
        createPrismorphicMaterialParameterUniforms: inject.createPrismorphicMaterialParameterUniforms,
        sanitizeMaterialGraph: graph.sanitizeMaterialGraph,
      }
      return engine
    } catch {
      return null
    }
  })().finally(() => {
    loading = null
    for (const listener of listeners) listener()
  })
}

export type GraphMaterialResult =
  /** The graph is drawn; the errors, if any, are the compiler's own. */
  | { state: 'compiled'; errors: string[]; nodes: number; uniforms: number }
  /** The engine is on its way; the material stays a Principled until it arrives. */
  | { state: 'loading' }
  | { state: 'refused'; reason: string }

/**
 * Grafts the compiled graph onto a physical material, or says why it could not.
 *
 * Called every time the material is written, which is every time anything about it changes. The
 * compiler's own cache means an unchanged graph costs a key lookup; a graph whose numbers moved but
 * whose shape did not is a uniform patch rather than a recompile, which is what the copy's cache is
 * for and what keeps a scrubbed slider from stuttering.
 */
export function applyGraphMaterial(material: MeshPhysicalMaterial, graph: unknown): GraphMaterialResult {
  if (!engine) {
    loadEngine()
    return { state: 'loading' }
  }
  const document = engine.sanitizeMaterialGraph(graph, 'procedural')
  if (!document) return { state: 'refused', reason: 'This graph is not one the engine can read.' }
  const compiled = engine.getCachedMaterialGraphGlsl(document)
  const key = compiled.cacheKey
  const uniforms = engine.createPrismorphicMaterialParameterUniforms()
  const inject = engine.applyCompiledGraphShaderInjection
  material.onBeforeCompile = (shader) => {
    inject(
      shader as unknown as Parameters<typeof inject>[0],
      compiled,
      time,
      compiled.uniforms.map((binding) => ({ name: binding.name, kind: binding.kind, value: binding.value })),
      uniforms,
    )
  }
  // Two graphs that compile to different programmes must not share one, and two that compile to the
  // same one should: the key is the compiler's own, which is exactly that statement.
  material.customProgramCacheKey = () => `graph-${key}`
  material.needsUpdate = true
  return {
    state: 'compiled',
    errors: [],
    nodes: compiled.reachableNodeIds.length,
    uniforms: compiled.uniforms.length,
  }
}

/** Puts a material back to its plain Principled, for a graph switched off or taken away. */
export function clearGraphMaterial(material: MeshPhysicalMaterial): void {
  if (!material.onBeforeCompile) return
  material.onBeforeCompile = () => {}
  material.customProgramCacheKey = () => ''
  material.needsUpdate = true
}
