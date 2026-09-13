import { buildScene as build, exportGltf as write, type GltfExportOptions } from './gltfRuntime'
import { initializeSceneResources } from '../appResources'
import type { SceneDocument } from '../types'
export * from './gltfRuntime'
export function buildScene(document: SceneDocument, options: GltfExportOptions = {}) { initializeSceneResources(); return build(document, options) }
export function exportGltf(document: SceneDocument, options: GltfExportOptions = {}) { initializeSceneResources(); return write(document, options) }
