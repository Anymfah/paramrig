/**
 * Typed structure for the Prismorphic material JSON format (schema v1.0.0).
 * Normative reference: SPECIFICATION_FORMAT_JSON_MATERIAU_D1-3.md
 * JSON Schema: schemas/material.schema.json
 */

import type { PrismorphicGraphExtension } from './material-graph';
import type { PrismorphicCompositionExtension } from './material-recipe';

export const MATERIAL_SCHEMA_VERSION = '1.1.0' as const;

export type MaterialSchemaVersion = typeof MATERIAL_SCHEMA_VERSION | `${number}.${number}.${number}`;

export type MaterialKind = 'pbr' | 'procedural' | 'unlit';

export type FallbackKind = 'pbr' | 'unlit';

export type ParameterType = 'color' | 'scalar' | 'vec2' | 'vec3' | 'texture' | 'enum' | 'bool';

export type RgbaColor = [number, number, number, number];

export type Vec2 = [number, number];

export type Vec3 = [number, number, number];

export type TextureColorSpace = 'srgb' | 'srgb-linear' | 'non-color';

export type TextureWrapMode = 'repeat' | 'clamp' | 'mirror';

export type TextureUsage = 'color' | 'normal' | 'data' | 'height';

export type TextureChannel = 'r' | 'g' | 'b' | 'a' | 'rgb';

export type AlphaMode = 'opaque' | 'mask' | 'blend';

export type MaterialSide = 'front' | 'back' | 'double';

export type ValidationStatus = 'valid' | 'warning' | 'invalid' | 'degraded';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type MaterialSourceType = 'gltf' | 'preset' | 'duplicate' | 'manual';

export interface TextureValue {
  uri: string;
  /** Stable content-addressed key used by the editor asset library. */
  assetId?: string;
  /** Intended interpretation; lets import and runtime choose safe color-space defaults. */
  usage?: TextureUsage;
  /** Optional channel selection for packed material maps. */
  channel?: TextureChannel;
  colorSpace?: TextureColorSpace;
  wrapS?: TextureWrapMode;
  wrapT?: TextureWrapMode;
  flipY?: boolean;
  maxSize?: number;
}

export interface ParameterBase {
  label?: string;
  group?: string;
  exposed?: boolean;
}

export interface ColorParameter extends ParameterBase {
  type: 'color';
  value: RgbaColor;
  default?: RgbaColor;
}

export interface ScalarParameter extends ParameterBase {
  type: 'scalar';
  value: number;
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface Vec2Parameter extends ParameterBase {
  type: 'vec2';
  value: Vec2;
  default?: Vec2;
  min?: number;
  max?: number;
  step?: number;
}

export interface Vec3Parameter extends ParameterBase {
  type: 'vec3';
  value: Vec3;
  default?: Vec3;
  min?: number;
  max?: number;
  step?: number;
}

export interface TextureParameter extends ParameterBase {
  type: 'texture';
  value: TextureValue;
  default?: TextureValue;
}

export interface EnumParameter extends ParameterBase {
  type: 'enum';
  value: string;
  default?: string;
  options: [string, ...string[]];
}

export interface BoolParameter extends ParameterBase {
  type: 'bool';
  value: boolean;
  default?: boolean;
}

export type MaterialParameter =
  | ColorParameter
  | ScalarParameter
  | Vec2Parameter
  | Vec3Parameter
  | TextureParameter
  | EnumParameter
  | BoolParameter;

export type MaterialParameters = Record<string, MaterialParameter>;

export interface PbrRequiredParameters {
  baseColor: ColorParameter;
  metallic: ScalarParameter;
  roughness: ScalarParameter;
}

export interface PbrOptionalParameters {
  emissive?: ColorParameter;
  emissiveIntensity?: ScalarParameter;
  specularIntensity?: ScalarParameter;
  specularColor?: ColorParameter;
  opacity?: ScalarParameter;
  normalScale?: Vec2Parameter;
  bumpScale?: ScalarParameter;
  displacementScale?: ScalarParameter;
  displacementBias?: ScalarParameter;
  occlusionStrength?: ScalarParameter;
  clearcoat?: ScalarParameter;
  clearcoatRoughness?: ScalarParameter;
  anisotropy?: ScalarParameter;
  anisotropyRotation?: ScalarParameter;
  sheen?: ScalarParameter;
  sheenColor?: ColorParameter;
  sheenRoughness?: ScalarParameter;
  transmission?: ScalarParameter;
  thickness?: ScalarParameter;
  attenuationColor?: ColorParameter;
  attenuationDistance?: ScalarParameter;
  ior?: ScalarParameter;
  iridescence?: ScalarParameter;
  iridescenceIOR?: ScalarParameter;
  iridescenceThicknessMin?: ScalarParameter;
  iridescenceThicknessMax?: ScalarParameter;
  dispersion?: ScalarParameter;
  envMapIntensity?: ScalarParameter;
  alphaMode?: EnumParameter;
  alphaCutoff?: ScalarParameter;
  doubleSided?: BoolParameter;
  baseColorMap?: TextureParameter;
  metallicRoughnessMap?: TextureParameter;
  metalnessMap?: TextureParameter;
  roughnessMap?: TextureParameter;
  normalMap?: TextureParameter;
  bumpMap?: TextureParameter;
  displacementMap?: TextureParameter;
  occlusionMap?: TextureParameter;
  emissiveMap?: TextureParameter;
  transmissionMap?: TextureParameter;
  thicknessMap?: TextureParameter;
  clearcoatMap?: TextureParameter;
  clearcoatRoughnessMap?: TextureParameter;
  iridescenceMap?: TextureParameter;
}

export type PbrParameters = PbrRequiredParameters & PbrOptionalParameters & MaterialParameters;

export interface UnlitRequiredParameters {
  baseColor: ColorParameter;
}

export interface UnlitOptionalParameters {
  baseColorMap?: TextureParameter;
  alphaMode?: EnumParameter;
}

export type UnlitParameters = UnlitRequiredParameters & UnlitOptionalParameters & MaterialParameters;

export type ProceduralParameters = MaterialParameters;

export interface GltfMaterialSource {
  type: 'gltf';
  assetUri?: string;
  gltfMaterialIndex?: number;
  gltfMaterialName?: string;
}

export interface PresetMaterialSource {
  type: 'preset';
  presetId?: string;
}

export interface DuplicateMaterialSource {
  type: 'duplicate';
  duplicatedFrom?: string;
}

export interface ManualMaterialSource {
  type: 'manual';
}

export type MaterialSource =
  | GltfMaterialSource
  | PresetMaterialSource
  | DuplicateMaterialSource
  | ManualMaterialSource;

export interface RenderHints {
  transparent?: boolean;
  depthWrite?: boolean;
  depthTest?: boolean;
  renderOrder?: number;
  side?: MaterialSide;
}

export interface ValidationMessage {
  code: string;
  message: string;
  severity: ValidationSeverity;
  field?: string;
  /** Actionable guidance for incomplete or mistyped graphs (editor panel). */
  guidance?: string;
}

export interface MaterialMetadata {
  createdAt: string;
  updatedAt: string;
  author: string;
  validationStatus: ValidationStatus;
  validationMessages?: ValidationMessage[];
  budgetReport?: Record<string, boolean | number | string>;
}

export interface PrismorphicShaderExtension {
  injectUniforms?: string[];
}

export type MaterialExtensions = {
  'prismorphic.shader'?: PrismorphicShaderExtension;
  'prismorphic.graph'?: PrismorphicGraphExtension;
  /** Recipe tree of a composed material (D2-1). The unfolded graph stays authoritative. */
  'prismorphic.composition'?: PrismorphicCompositionExtension;
} & Record<string, unknown>;

export interface MaterialDocumentBase {
  schemaVersion: MaterialSchemaVersion;
  id: string;
  name: string;
  description?: string;
  /** SPDX-style or free-form license label for the material definition. */
  license?: string;
  tags?: string[];
  source?: MaterialSource;
  renderHints?: RenderHints;
  metadata: MaterialMetadata;
  extensions?: MaterialExtensions;
}

export interface PbrMaterialDocument extends MaterialDocumentBase {
  kind: 'pbr';
  parameters: PbrParameters;
}

export interface ProceduralMaterialDocument extends MaterialDocumentBase {
  kind: 'procedural';
  shaderRef: string;
  fallbackKind: FallbackKind;
  parameters: ProceduralParameters;
}

export interface UnlitMaterialDocument extends MaterialDocumentBase {
  kind: 'unlit';
  parameters: UnlitParameters;
}

/**
 * Root document exchanged by the editor and Three.js runtime.
 */
export type PrismorphicMaterialDocument =
  | PbrMaterialDocument
  | ProceduralMaterialDocument
  | UnlitMaterialDocument;

export type MaterialDocumentByKind<K extends MaterialKind> = Extract<PrismorphicMaterialDocument, { kind: K }>;

export type ParameterValue<T extends MaterialParameter> = T['value'];

export type ParameterValueByType<T extends ParameterType> = Extract<MaterialParameter, { type: T }>['value'];

export function isPbrMaterialDocument(
  document: PrismorphicMaterialDocument,
): document is PbrMaterialDocument {
  return document.kind === 'pbr';
}

export function isProceduralMaterialDocument(
  document: PrismorphicMaterialDocument,
): document is ProceduralMaterialDocument {
  return document.kind === 'procedural';
}

export function isUnlitMaterialDocument(
  document: PrismorphicMaterialDocument,
): document is UnlitMaterialDocument {
  return document.kind === 'unlit';
}

export function isMaterialParameterOfType<T extends ParameterType>(
  parameter: MaterialParameter,
  type: T,
): parameter is Extract<MaterialParameter, { type: T }> {
  return parameter.type === type;
}

export type MaterialTextureLoadState = 'loading' | 'ready' | 'error';

export interface MaterialTextureLoadEvent {
  parameterKey: string;
  uri: string;
  state: MaterialTextureLoadState;
  message?: string;
}

export interface MaterialTextureLoaderLike {
  load(
    uri: string,
    onLoad?: (texture: unknown) => void,
    onProgress?: (event: unknown) => void,
    onError?: (error: unknown) => void,
  ): unknown;
}

/** Loader contract sketch for the Three.js runtime (implementation is application code). */
export interface MaterialLoadOptions {
  strict?: boolean;
  textureLoader?: MaterialTextureLoaderLike;
  /** Resolves document-relative, built-in, or editor asset URIs before loading. */
  resolveTextureUri?: (value: TextureValue, doc: PrismorphicMaterialDocument) => string;
  /** Receives asynchronous texture lifecycle updates without making material creation async. */
  onTextureStateChange?: (event: MaterialTextureLoadEvent) => void;
}

export interface MaterialLoadResult {
  threeMaterial: unknown;
  status: ValidationStatus;
  messages: ValidationMessage[];
}

export type LoadPrismorphicMaterial = (
  doc: PrismorphicMaterialDocument,
  options?: MaterialLoadOptions,
) => MaterialLoadResult;
