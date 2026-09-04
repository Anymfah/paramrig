/**
 * Production MeshPhysicalMaterial GLSL injection for compiled graph programs.
 * Shared by shaderRegistry and the WebGL verify harness (exact same path).
 *
 * Operational guide: docs/shader-mvp/guide-glsl-integration.md
 */

export type CompiledGraphShaderSources = {
  uniformsSource: string;
  helpersSource: string;
  evaluateFunctionSource: string;
  /** Omitted by legacy callers; absence preserves the previous full injection. */
  usesNormalOutput?: boolean;
  /** Omitted by legacy callers; absence preserves the previous full injection. */
  usesDisplacementOutput?: boolean;
};

export type GraphShaderUniformBinding = {
  name: string;
  kind: 'float' | 'vec3' | 'vec4' | 'bool';
  value: number | boolean | readonly number[];
};

export type GraphShaderProgramParameters = {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, unknown>;
};

export type PrismorphicTimeUniform = { value: number };

export type PrismorphicMaterialParameterUniform = {
  value: number | boolean | number[];
};

export type PrismorphicMaterialParameterUniforms = {
  uPrismorphicHasBaseColor: PrismorphicMaterialParameterUniform;
  uPrismorphicBaseColor: PrismorphicMaterialParameterUniform;
  uPrismorphicHasMetallic: PrismorphicMaterialParameterUniform;
  uPrismorphicMetallic: PrismorphicMaterialParameterUniform;
  uPrismorphicHasRoughness: PrismorphicMaterialParameterUniform;
  uPrismorphicRoughness: PrismorphicMaterialParameterUniform;
  uPrismorphicHasTransmission: PrismorphicMaterialParameterUniform;
  uPrismorphicTransmission: PrismorphicMaterialParameterUniform;
  uPrismorphicHasPrismStrength: PrismorphicMaterialParameterUniform;
  uPrismorphicPrismStrength: PrismorphicMaterialParameterUniform;
  uPrismorphicNoiseScale: PrismorphicMaterialParameterUniform;
  uPrismorphicPatternContrast: PrismorphicMaterialParameterUniform;
  uPrismorphicUvScaleX: PrismorphicMaterialParameterUniform;
  uPrismorphicUvScaleY: PrismorphicMaterialParameterUniform;
  uPrismorphicNormalStrength: PrismorphicMaterialParameterUniform;
  uPrismorphicParallaxEnabled: PrismorphicMaterialParameterUniform;
  uPrismorphicParallaxDepth: PrismorphicMaterialParameterUniform;
  uPrismorphicParallaxSteps: PrismorphicMaterialParameterUniform;
  uPrismorphicInteriorLayers: PrismorphicMaterialParameterUniform;
  uPrismorphicInteriorDepth: PrismorphicMaterialParameterUniform;
  uPrismorphicInteriorGlow: PrismorphicMaterialParameterUniform;
  uPrismorphicEmissiveIntensity: PrismorphicMaterialParameterUniform;
  uPrismorphicAnimationEnabled: PrismorphicMaterialParameterUniform;
  uPrismorphicAnimationSpeed: PrismorphicMaterialParameterUniform;
  uPrismorphicAnimationAmount: PrismorphicMaterialParameterUniform;
  uPrismorphicAnimationMode: PrismorphicMaterialParameterUniform;
  uPrismorphicAnimationSeed: PrismorphicMaterialParameterUniform;
  uPrismorphicAnimationPaused: PrismorphicMaterialParameterUniform;
  uPrismorphicAnimationTime: PrismorphicMaterialParameterUniform;
  /** Debug view: paint the blend's mask instead of the surface. */
  uPrismorphicMaskView: PrismorphicMaterialParameterUniform;
};

const PRISMORPHIC_MATERIAL_PARAMETER_UNIFORMS = `
uniform bool uPrismorphicMaskView;
uniform bool uPrismorphicHasBaseColor;
uniform vec4 uPrismorphicBaseColor;
uniform bool uPrismorphicHasMetallic;
uniform float uPrismorphicMetallic;
uniform bool uPrismorphicHasRoughness;
uniform float uPrismorphicRoughness;
uniform bool uPrismorphicHasTransmission;
uniform float uPrismorphicTransmission;
uniform bool uPrismorphicHasPrismStrength;
uniform float uPrismorphicPrismStrength;
uniform float uPrismorphicNoiseScale;
uniform float uPrismorphicPatternContrast;
uniform float uPrismorphicUvScaleX;
uniform float uPrismorphicUvScaleY;
uniform float uPrismorphicNormalStrength;
uniform bool uPrismorphicParallaxEnabled;
uniform float uPrismorphicParallaxDepth;
uniform float uPrismorphicParallaxSteps;
uniform float uPrismorphicInteriorLayers;
uniform float uPrismorphicInteriorDepth;
uniform float uPrismorphicInteriorGlow;
uniform float uPrismorphicEmissiveIntensity;
uniform bool uPrismorphicAnimationEnabled;
uniform float uPrismorphicAnimationSpeed;
uniform float uPrismorphicAnimationAmount;
uniform float uPrismorphicAnimationMode;
uniform float uPrismorphicAnimationSeed;
uniform bool uPrismorphicAnimationPaused;
uniform float uPrismorphicAnimationTime;
`;

const PRISMORPHIC_UV_VARYING = 'varying vec2 vPrismorphicUv;';
const PRISMORPHIC_POSITION_VARYING = 'varying vec3 vPrismorphicPosition;';
const PRISMORPHIC_OBJECT_FRAME_VARYINGS = `
varying vec3 vPrismorphicObjectNormal;
varying vec3 vPrismorphicAxisXView;
varying vec3 vPrismorphicAxisYView;
varying vec3 vPrismorphicAxisZView;
`;

/** Fragment-only tangent frame (uses dFdx/dFdy); matches Three.js getTangentFrame. */
const PRISMORPHIC_TANGENT_FRAME = `
#ifndef PRISMORPHIC_TANGENT_FRAME
#define PRISMORPHIC_TANGENT_FRAME
mat3 prismorphic_tangent_frame(vec3 eyePos, vec3 surfNorm, vec2 uvCoord) {
  vec3 q0 = dFdx(eyePos);
  vec3 q1 = dFdy(eyePos);
  vec2 st0 = dFdx(uvCoord);
  vec2 st1 = dFdy(uvCoord);
  vec3 q1perp = cross(q1, surfNorm);
  vec3 q0perp = cross(surfNorm, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * scale, B * scale, surfNorm);
}
#endif
`;

/**
 * Port of the proven Anym Core material. It extends Three.js parallaxUV with
 * signed relief, perspective correction, triplanar projection, spectral split
 * and a second rear-volume read. Triplanar object-space sampling is essential:
 * it removes the spherical UV seam and keeps depth coherent while orbiting.
 */
const PRISMORPHIC_PARALLAX_HELPERS = `
#ifndef PRISMORPHIC_PARALLAX_HELPERS
#define PRISMORPHIC_PARALLAX_HELPERS
float prismorphic_blend_overlay(float base, float blend) {
  return base < 0.5
    ? 2.0 * base * blend
    : 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

vec3 prismorphic_blend_overlay(vec3 base, vec3 blend) {
  return vec3(
    prismorphic_blend_overlay(base.r, blend.r),
    prismorphic_blend_overlay(base.g, blend.g),
    prismorphic_blend_overlay(base.b, blend.b)
  );
}

float prismorphic_median3(float a, float b, float c) {
  return max(min(a, b), min(max(a, b), c));
}

vec2 prismorphic_rotate_uv(vec2 uv, vec2 cosineSine) {
  return vec2(
    uv.x * cosineSine.x - uv.y * cosineSine.y,
    uv.x * cosineSine.y + uv.y * cosineSine.x
  );
}

vec2 prismorphic_project_x(vec3 objectPosition) {
  return prismorphic_rotate_uv(objectPosition.zy, vec2(0.956305, 0.292372))
    + vec2(0.137, 0.421);
}

vec2 prismorphic_project_y(vec3 objectPosition) {
  return prismorphic_rotate_uv(objectPosition.xz, vec2(0.857167, -0.515038))
    + vec2(0.613, 0.233);
}

vec2 prismorphic_project_z(vec3 objectPosition) {
  return prismorphic_rotate_uv(objectPosition.xy, vec2(0.731354, 0.681998))
    + vec2(0.347, 0.769);
}

float prismorphic_animation_amount() {
  if (!uPrismorphicAnimationEnabled || uPrismorphicAnimationPaused) return 0.0;
  return clamp(uPrismorphicAnimationAmount, 0.0, 1.0);
}

float prismorphic_animation_phase(float axisPhase) {
  return uPrismorphicAnimationTime * max(uPrismorphicAnimationSpeed, 0.0)
    + axisPhase
    + uPrismorphicAnimationSeed * 0.61803398875;
}

float prismorphic_hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

vec2 prismorphic_flow_field(vec2 uv, float phase, float octave) {
  vec2 primary = vec2(
    sin(uv.y * (5.2 + octave) + phase * 0.73 + cos(uv.x * 3.1)),
    cos(uv.x * (4.7 + octave * 0.8) - phase * 0.61 + sin(uv.y * 3.7))
  );
  vec2 secondary = vec2(
    sin((uv.x + uv.y) * (9.4 + octave) - phase * 0.41),
    cos((uv.x - uv.y) * (8.2 + octave) + phase * 0.37)
  );
  return primary * 0.68 + secondary * 0.32;
}

// Animation modes are intentionally material-specific:
// 0 lava, 1 water, 2 flame, 3 hologram, 4 energy,
// 5 crystal, 6 spectral film, 7 organic, 8 restrained shimmer.
float prismorphic_animation_mode() {
  return floor(uPrismorphicAnimationMode + 0.5);
}

// The visible skin moves only for genuinely fluid materials. Lava crust,
// crystal facets, scan holograms and crafted surfaces remain object-locked.
vec2 prismorphic_surface_uv(vec2 uv, float axisPhase) {
  float amount = prismorphic_animation_amount();
  if (amount < 0.00001) return uv;
  float phase = prismorphic_animation_phase(axisPhase);
  float mode = prismorphic_animation_mode();
  if (mode > 0.5 && mode < 1.5) {
    vec2 current = prismorphic_flow_field(uv, phase, 0.0);
    return uv + current * (0.012 * amount)
      + vec2(phase * 0.0012, -phase * 0.0007) * amount;
  }
  if (mode > 1.5 && mode < 2.5) {
    vec2 turbulence = prismorphic_flow_field(uv * vec2(1.1, 0.72), phase, 1.7);
    return uv + vec2(turbulence.x * 0.014, turbulence.y * 0.005 - phase * 0.018)
      * amount;
  }
  if (mode > 3.5 && mode < 4.5) {
    vec2 plasma = prismorphic_flow_field(uv, phase * 1.18, 2.4);
    return uv + plasma * (0.009 * amount);
  }
  if (mode > 6.5 && mode < 7.5) {
    vec2 cellular = prismorphic_flow_field(uv * 0.72, phase * 0.48, 0.6);
    return uv + cellular * (0.0038 * amount);
  }
  return uv;
}

// Interior advection is independent from the stable skin. This is what gives
// glass, ice and plasma actual depth instead of moving like a printed decal.
vec2 prismorphic_volume_uv(vec2 uv, float axisPhase, float layer) {
  float amount = prismorphic_animation_amount();
  if (amount < 0.00001) return uv;
  float phase = prismorphic_animation_phase(axisPhase);
  float mode = prismorphic_animation_mode();
  if (mode < 0.5) {
    // Lava: the basalt shell stays fixed; deep heat convection moves slowly.
    vec2 convection = prismorphic_flow_field(uv * 0.82, phase * 0.34 + layer, 0.8);
    return uv + convection * (0.006 * amount * (0.65 + layer * 0.22));
  }
  if (mode < 1.5) {
    vec2 current = prismorphic_flow_field(uv * (0.88 + layer * 0.09), phase + layer, layer);
    return uv + current * (0.021 * amount)
      + vec2(phase * 0.0024, -phase * 0.0015) * amount * (1.0 + layer * 0.16);
  }
  if (mode < 2.5) {
    vec2 lick = prismorphic_flow_field(uv * vec2(0.94, 0.64), phase + layer, 2.1);
    return uv + vec2(lick.x * 0.022, lick.y * 0.008 - phase * 0.045)
      * amount * (0.75 + layer * 0.18);
  }
  if (mode < 3.5) return uv;
  if (mode < 4.5) {
    vec2 vortex = prismorphic_flow_field(uv * (0.9 + layer * 0.1), phase * 1.25, 3.2);
    return uv + vortex * (0.018 * amount * (0.8 + layer * 0.25));
  }
  if (mode < 5.5) {
    vec2 inclusionDrift = vec2(
      sin(phase * 0.21 + layer * 1.73 + axisPhase),
      cos(phase * 0.17 - layer * 1.31 - axisPhase)
    );
    return uv + inclusionDrift * (0.012 * amount * (0.7 + layer * 0.32));
  }
  if (mode < 6.5) {
    vec2 spectralDrift = vec2(sin(phase * 0.32 + layer), cos(phase * 0.27 - layer));
    return uv + spectralDrift * (0.0045 * amount);
  }
  if (mode < 7.5) {
    vec2 migration = prismorphic_flow_field(uv * 0.76, phase * 0.52 + layer, 1.1);
    return uv + migration * (0.009 * amount);
  }
  return uv;
}

float prismorphic_animation_envelope(vec2 uv, float axisPhase) {
  float amount = prismorphic_animation_amount();
  if (amount < 0.00001) return 1.0;
  float phase = prismorphic_animation_phase(axisPhase);
  float mode = prismorphic_animation_mode();
  float envelope = 1.0;
  if (mode < 0.5) {
    float convection = sin(uv.x * 8.2 + phase * 0.61 + sin(uv.y * 5.7 - phase * 0.24));
    float secondary = sin((uv.x - uv.y) * 14.0 - phase * 0.37);
    envelope = 0.72 + (convection * 0.5 + secondary * 0.5) * 0.18 + 0.18;
  } else if (mode < 1.5) {
    float causticA = abs(sin(uv.x * 13.0 + phase) * cos(uv.y * 11.0 - phase * 0.73));
    float causticB = abs(sin((uv.x + uv.y) * 8.0 - phase * 0.44));
    envelope = 0.78 + pow(mix(causticA, causticB, 0.42), 2.2) * 0.46;
  } else if (mode < 2.5) {
    float tongue = sin(uv.x * 9.0 + sin(uv.y * 4.0 - phase) - phase * 1.3);
    envelope = 0.58 + (tongue * 0.5 + 0.5) * 0.72;
  } else if (mode < 3.5) {
    // Hologram look is authored in the material graph (scanlines/glitch nodes).
    // Keep only a subtle pulse so the runtime profile does not paint coarse bands.
    float pulse = 0.5 + 0.5 * sin(phase * 1.35 + uv.y * 3.0);
    envelope = 0.92 + pulse * 0.12;
  } else if (mode < 4.5) {
    float pulseA = sin(length(uv - vec2(0.5)) * 19.0 - phase * 2.4);
    float pulseB = sin((uv.x - uv.y) * 12.0 + phase * 1.3);
    envelope = 0.7 + (pulseA * 0.58 + pulseB * 0.42) * 0.18 + 0.2;
  } else if (mode < 5.5) {
    float cell = prismorphic_hash21(floor(uv * 18.0));
    float twinkle = pow(0.5 + 0.5 * sin(phase * (0.7 + cell * 1.8) + cell * 31.0), 8.0);
    envelope = 0.86 + twinkle * 0.42;
  } else if (mode < 6.5) {
    envelope = 0.9 + 0.1 * sin(phase * 0.8 + uv.x * 7.0 - uv.y * 5.0);
  } else if (mode < 7.5) {
    envelope = 0.82 + 0.18 * sin(phase * 0.63 + uv.x * 6.0 + sin(uv.y * 5.0));
  } else {
    envelope = 0.96 + 0.04 * sin(phase * 1.1 + (uv.x + uv.y) * 24.0);
  }
  return mix(1.0, envelope, amount);
}

vec3 prismorphic_animation_color_grade(vec2 uv, float axisPhase) {
  float amount = prismorphic_animation_amount();
  if (amount < 0.00001) return vec3(1.0);
  float phase = prismorphic_animation_phase(axisPhase);
  float mode = prismorphic_animation_mode();
  if (mode > 2.5 && mode < 3.5) {
    // Subtle cyan grade only — spectral breakup lives in the chromatic-split node.
    float chroma = sin(uv.y * 9.0 - phase * 0.8) * 0.5 + 0.5;
    return mix(vec3(1.0), vec3(0.9 + chroma * 0.06, 0.98, 1.05), amount * 0.18);
  }
  if (mode > 3.5 && mode < 4.5) {
    float chroma = sin(phase * 1.4 + uv.x * 8.0 - uv.y * 6.0);
    return mix(vec3(1.0), vec3(0.92 - chroma * 0.06, 1.0, 1.08 + chroma * 0.08), amount * 0.42);
  }
  if (mode > 5.5 && mode < 6.5) {
    vec3 spectral = vec3(
      1.0 + sin(phase + uv.x * 7.0) * 0.12,
      1.0 + sin(phase + 2.094395 + uv.y * 6.0) * 0.1,
      1.0 + sin(phase + 4.188790 - (uv.x + uv.y) * 4.0) * 0.13
    );
    return mix(vec3(1.0), spectral, amount * 0.7);
  }
  return vec3(1.0);
}

vec3 prismorphic_sample_parallax(
  vec2 uvBase,
  vec3 viewDirection,
  vec3 tangentAxis,
  vec3 bitangentAxis,
  vec3 normalAxis,
  float axisPhase
) {
#if defined(USE_MAP) && defined(USE_BUMPMAP)
  vec2 uvScaled = uvBase * max(
    vec2(0.1),
    vec2(uPrismorphicUvScaleX, uPrismorphicUvScaleY)
  );
  vec2 surfaceUv = prismorphic_surface_uv(uvScaled, axisPhase);
  float displacement = texture2D(bumpMap, surfaceUv).r;
  float parallaxHeight = (displacement * 2.0 - 1.0) * 1.10;

  vec3 viewTangent = normalize(vec3(
    dot(viewDirection, tangentAxis),
    dot(viewDirection, bitangentAxis),
    dot(viewDirection, normalAxis)
  ));
  // Keep the displacement stable on back-facing axis projections. Using the
  // signed Z component here made the offset jump whenever an axis crossed its
  // tangent plane, which appeared as a straight triplanar seam on spheres.
  float perspectiveDenominator = max(0.28, abs(viewTangent.z));
  float boundedDepth = min(uPrismorphicParallaxDepth, 1.5) * 0.22;
  vec2 offset = (viewTangent.xy / perspectiveDenominator)
    * (parallaxHeight * boundedDepth);
  offset = clamp(offset, vec2(-0.24), vec2(0.24));
  vec2 parallaxUv = prismorphic_volume_uv(surfaceUv + offset, axisPhase, 1.0);

  vec3 topColor = texture2D(map, surfaceUv).rgb;
  vec3 bottomColor = texture2D(map, parallaxUv).rgb;
  float animationMode = prismorphic_animation_mode();
  float animationAmount = prismorphic_animation_amount();
  if (animationAmount > 0.00001 && animationMode > 0.5 && animationMode < 7.5) {
    vec2 secondaryUv = prismorphic_volume_uv(
      surfaceUv + offset * 0.58,
      axisPhase + 1.173,
      2.0
    );
    vec3 secondaryLayer = texture2D(map, secondaryUv).rgb;
    float layerMix = animationMode < 1.5
      ? 0.34
      : animationMode > 4.5 && animationMode < 5.5
        ? 0.46
        : 0.24;
    bottomColor = mix(bottomColor, secondaryLayer, layerMix * animationAmount);
  }
  vec2 spectralSplit = offset * (0.22 + abs(parallaxHeight) * 0.28);
  float spectralStrength = uPrismorphicHasPrismStrength
    ? clamp(uPrismorphicPrismStrength, 0.0, 1.0)
    : 0.0;
  float prismAmount = clamp(
    length(spectralSplit) * (7.0 + uPrismorphicParallaxDepth * 11.0),
    0.0,
    1.0
  ) * spectralStrength;
  float opticalBody = clamp(
    (uPrismorphicHasTransmission ? uPrismorphicTransmission : 0.0)
      + spectralStrength * 0.35
      + clamp(uPrismorphicInteriorGlow, 0.0, 4.0) * 0.12,
    0.0,
    1.0
  );
  // Opaque PBR materials need their photographic albedo intact. Overlaying a
  // dark texture with a displaced copy crushed its pores and grain into a
  // muddy low-frequency body. Optical materials still use the deeper overlay;
  // solids interpolate between surface and displaced layers instead.
  float solidDepthMix = clamp(
    0.16 + abs(parallaxHeight) * 0.16 + uPrismorphicParallaxDepth * 0.72,
    0.12,
    0.58
  );
  vec3 solidColor = mix(topColor, bottomColor, solidDepthMix);
  vec3 opticalColor = prismorphic_blend_overlay(topColor, bottomColor);
  vec3 volumeColor = mix(solidColor, opticalColor, opticalBody);
  float signatureContrast = mix(
    0.88,
    1.34,
    smoothstep(0.05, 0.95, clamp(uPrismorphicPatternContrast, 0.05, 0.95))
  );
  // Expand contrast where it was authored: on screen, not in linear light.
  // volumeColor comes straight out of an sRGB texture read, so it is linear —
  // and a 0.46 pivot sits above almost the whole dark half of that range. With
  // the default patternContrast of 0.68 the gain is 1.24, which pushed every
  // channel below 0.089 linear (sRGB 84/255) through zero and clamped it to
  // black. Walnut wood, mean albedo 0.054/0.023/0.010 linear, lost its colour
  // entirely and rendered as bare environment specular.
  // sqrt/square is a gamma-2.0 stand-in: it puts the pivot back at perceptual
  // mid-grey without paying for six pow() per triplanar axis.
  vec3 signaturePerceptual = sqrt(max(volumeColor, vec3(0.0)));
  signaturePerceptual = clamp(
    (signaturePerceptual - vec3(0.46)) * signatureContrast + vec3(0.46),
    0.0,
    1.0
  );
  volumeColor = signaturePerceptual * signaturePerceptual;
  float signatureLuminance = dot(volumeColor, vec3(0.299, 0.587, 0.114));
  float signatureSaturation = 1.0 + max(0.0, uPrismorphicPatternContrast - 0.5) * 0.42;
  volumeColor = clamp(
    mix(vec3(signatureLuminance), volumeColor, signatureSaturation),
    0.0,
    1.0
  );
  // Build the spectral split from two full RGB reads plus the already sampled
  // surface/depth colors. The previous six single-channel reads fetched the
  // same texels repeatedly and were one of the largest costs of every axis.
  vec3 spectralColor = vec3(bottomColor.r, topColor.g, bottomColor.b);
  // Subtle prism materials already receive physical iridescence/dispersion.
  // Reserve the two additional texture reads for a clearly visible split.
  if (spectralStrength >= 0.25 && prismAmount > 0.0005) {
    vec3 spectralPositive = texture2D(
      map,
      parallaxUv + spectralSplit * 0.55
    ).rgb;
    vec3 spectralNegative = texture2D(
      map,
      parallaxUv - spectralSplit * 0.55
    ).rgb;
    vec3 depthDispersion = vec3(
      spectralPositive.r,
      bottomColor.g,
      spectralNegative.b
    );
    vec3 surfaceDispersion = vec3(
      spectralNegative.r,
      topColor.g,
      spectralPositive.b
    );
    spectralColor = prismorphic_blend_overlay(surfaceDispersion, depthDispersion);
  }
  volumeColor = mix(
    volumeColor,
    prismorphic_blend_overlay(volumeColor, spectralColor),
    prismAmount * 0.34
  );
  volumeColor += spectralColor * prismAmount
    * (0.03 + uPrismorphicParallaxDepth * 0.05);
  volumeColor *= mix(1.0, 1.08, spectralStrength);
  volumeColor *= prismorphic_animation_color_grade(surfaceUv, axisPhase);
#ifdef USE_EMISSIVEMAP
  vec2 emissionUv = animationMode < 0.5
    ? mix(surfaceUv, parallaxUv, 0.68)
    : prismorphic_volume_uv(mix(surfaceUv, parallaxUv, 0.68), axisPhase, 0.35);
  vec3 internalEmission = texture2D(emissiveMap, emissionUv).rgb
    * prismorphic_animation_envelope(surfaceUv, axisPhase);
  volumeColor += internalEmission
    * (0.42 + clamp(uPrismorphicInteriorGlow, 0.0, 4.0) * 0.34);
#endif
  volumeColor *= mix(
    1.0,
    0.78 + clamp(uPrismorphicInteriorGlow, 0.0, 4.0) * 0.06,
    opticalBody
  );

  float luminance = dot(volumeColor, vec3(0.299, 0.587, 0.114));
  vec3 tintColor = mix(vec3(0.82, 0.91, 1.0), uPrismorphicBaseColor.rgb, 0.15);
  return mix(volumeColor, luminance * tintColor, 0.10 * opticalBody);
#else
  return vec3(0.0);
#endif
}

vec3 prismorphic_triplanar_parallax(
  vec3 objectPosition,
  vec3 objectNormal,
  vec3 viewDirection,
  vec3 axisXView,
  vec3 axisYView,
  vec3 axisZView
) {
  // Keep one branch-free volume projection. A dominant-axis branch looks
  // cheaper on paper but diverges across sphere fragments and performs worse
  // on tiled/mobile GPUs than the predictable three-axis workload.
  vec3 sampleX = prismorphic_sample_parallax(
    prismorphic_project_x(objectPosition),
    viewDirection,
    axisZView,
    axisYView,
    axisXView,
    0.0
  );
  vec3 sampleY = prismorphic_sample_parallax(
    prismorphic_project_y(objectPosition),
    viewDirection,
    axisXView,
    axisZView,
    axisYView,
    2.094395
  );
  vec3 sampleZ = prismorphic_sample_parallax(
    prismorphic_project_z(objectPosition),
    viewDirection,
    axisXView,
    axisYView,
    axisZView,
    4.188790
  );

  vec3 directionalWeights = pow(max(abs(objectNormal), vec3(1e-4)), vec3(8.0));
  directionalWeights /= directionalWeights.x + directionalWeights.y + directionalWeights.z;
  vec3 directionalColor = sampleX * directionalWeights.x
    + sampleY * directionalWeights.y
    + sampleZ * directionalWeights.z;
  vec3 volumeMedian = max(
    min(sampleX, sampleY),
    min(max(sampleX, sampleY), sampleZ)
  );
  float transitionSupport = (1.0 - max(
    max(directionalWeights.x, directionalWeights.y),
    directionalWeights.z
  )) * 0.58;
  return mix(directionalColor, volumeMedian, transitionSupport);
}

// The rear-volume contribution is deliberately subtle after lighting, so it
// does not need to repeat the full signed-relief, spectral and emissive stack.
// Three volume-locked albedo reads preserve the authored interior structure
// while avoiding a second full triplanar parallax evaluation per fragment.
vec3 prismorphic_triplanar_rear(
  vec3 objectPosition,
  vec3 objectNormal
) {
#ifdef USE_MAP
  vec2 scale = max(
    vec2(0.1),
    vec2(uPrismorphicUvScaleX, uPrismorphicUvScaleY)
  );
  vec3 sampleX = texture2D(
    map,
    prismorphic_volume_uv(prismorphic_project_x(objectPosition) * scale, 0.0, 1.65)
  ).rgb;
  vec3 sampleY = texture2D(
    map,
    prismorphic_volume_uv(prismorphic_project_y(objectPosition) * scale, 2.094395, 1.65)
  ).rgb;
  vec3 sampleZ = texture2D(
    map,
    prismorphic_volume_uv(prismorphic_project_z(objectPosition) * scale, 4.188790, 1.65)
  ).rgb;
  vec3 weights = pow(max(abs(normalize(objectNormal)), vec3(1e-4)), vec3(7.0));
  weights /= weights.x + weights.y + weights.z;
  vec3 directionalColor = sampleX * weights.x + sampleY * weights.y + sampleZ * weights.z;
  vec3 volumeMedian = max(min(sampleX, sampleY), min(max(sampleX, sampleY), sampleZ));
  float transitionSupport = (1.0 - max(max(weights.x, weights.y), weights.z)) * 0.48;
  return mix(directionalColor, volumeMedian, transitionSupport);
#else
  return vec3(0.0);
#endif
}

float prismorphic_triplanar_height(vec3 objectPosition, vec3 objectNormal) {
#ifdef USE_BUMPMAP
  vec2 scale = max(
    vec2(0.1),
    vec2(uPrismorphicUvScaleX, uPrismorphicUvScaleY)
  );
  float heightX = texture2D(
    bumpMap,
    prismorphic_surface_uv(prismorphic_project_x(objectPosition) * scale, 0.0)
  ).r;
  float heightY = texture2D(
    bumpMap,
    prismorphic_surface_uv(prismorphic_project_y(objectPosition) * scale, 2.094395)
  ).r;
  float heightZ = texture2D(
    bumpMap,
    prismorphic_surface_uv(prismorphic_project_z(objectPosition) * scale, 4.188790)
  ).r;
  // Match the color projection instead of averaging three unrelated height
  // fields. The old average erased two thirds of the useful high-frequency
  // slope, which made 2K relief look blurred during close inspection.
  vec3 weights = pow(max(abs(normalize(objectNormal)), vec3(1e-4)), vec3(7.0));
  weights /= weights.x + weights.y + weights.z;
  return heightX * weights.x + heightY * weights.y + heightZ * weights.z;
#else
  return 0.5;
#endif
}
#endif
`;

// Object-space view direction. Fragment shaders expose vViewPosition; vertex
// displacement evaluation reconstructs the eye vector from modelViewMatrix.
const EVALUATE_VIEW_DIR_FRAGMENT = `
      normalize(vec3(
        dot(normalize(vViewPosition), vPrismorphicAxisXView),
        dot(normalize(vViewPosition), vPrismorphicAxisYView),
        dot(normalize(vViewPosition), vPrismorphicAxisZView)
      ))`;

const EVALUATE_VIEW_DIR_VERTEX = `
      normalize(vec3(
        dot(normalize((modelViewMatrix * vec4(vPrismorphicPosition, 1.0)).xyz), vPrismorphicAxisXView),
        dot(normalize((modelViewMatrix * vec4(vPrismorphicPosition, 1.0)).xyz), vPrismorphicAxisYView),
        dot(normalize((modelViewMatrix * vec4(vPrismorphicPosition, 1.0)).xyz), vPrismorphicAxisZView)
      ))`;

const EVALUATE_CALL_ARGS_FRAGMENT = `
      vPrismorphicUv,
      vPrismorphicPosition,
      ${EVALUATE_VIEW_DIR_FRAGMENT},
      uPrismorphicTime,
      prismorphicBaseColor,
      prismorphicMetallic,
      prismorphicRoughness,
      prismorphicTransmission,
      prismorphicEmission,
      prismorphicOpacity,
      prismorphicNormalTs,
      prismorphicDisplacement,
      prismorphicOutputEnabled,
      prismorphicEmissionDriven,
      prismorphicNormalDriven,
      prismorphicDisplacementDriven,
      prismorphicUnlit,
      prismorphicAlbedoAuthority
`;

const EVALUATE_CALL_ARGS_VERTEX = `
      vPrismorphicUv,
      vPrismorphicPosition,
      ${EVALUATE_VIEW_DIR_VERTEX},
      uPrismorphicTime,
      prismorphicBaseColor,
      prismorphicMetallic,
      prismorphicRoughness,
      prismorphicTransmission,
      prismorphicEmission,
      prismorphicOpacity,
      prismorphicNormalTs,
      prismorphicDisplacement,
      prismorphicOutputEnabled,
      prismorphicEmissionDriven,
      prismorphicNormalDriven,
      prismorphicDisplacementDriven,
      prismorphicUnlit,
      prismorphicAlbedoAuthority
`;

/**
 * Applies the production vertex + fragment graph injection and binds uniforms.
 * This is the exact path used by bindCompiledGraphShader.onBeforeCompile.
 */
export function applyCompiledGraphShaderInjection(
  shader: GraphShaderProgramParameters,
  compiled: CompiledGraphShaderSources,
  timeUniform: PrismorphicTimeUniform,
  graphUniforms: GraphShaderUniformBinding[] = [],
  materialParameterUniforms: PrismorphicMaterialParameterUniforms =
    createPrismorphicMaterialParameterUniforms(),
): void {
  shader.uniforms.uPrismorphicTime = timeUniform;
  for (const binding of graphUniforms) {
    shader.uniforms[binding.name] = { value: cloneUniformValue(binding.value) };
  }
  for (const [name, uniform] of Object.entries(materialParameterUniforms)) {
    shader.uniforms[name] = uniform;
  }
  injectCompiledGraphVertexShader(shader, compiled);
  injectCompiledGraphFragmentShader(shader, compiled);
}

export function createPrismorphicMaterialParameterUniforms(): PrismorphicMaterialParameterUniforms {
  return {
    uPrismorphicMaskView: { value: false },
    uPrismorphicHasBaseColor: { value: false },
    uPrismorphicBaseColor: { value: [1, 1, 1, 1] },
    uPrismorphicHasMetallic: { value: false },
    uPrismorphicMetallic: { value: 0 },
    uPrismorphicHasRoughness: { value: false },
    uPrismorphicRoughness: { value: 0.5 },
    uPrismorphicHasTransmission: { value: false },
    uPrismorphicTransmission: { value: 0 },
    uPrismorphicHasPrismStrength: { value: false },
    uPrismorphicPrismStrength: { value: 1 },
    uPrismorphicNoiseScale: { value: 1 },
    uPrismorphicPatternContrast: { value: 0.5 },
    uPrismorphicUvScaleX: { value: 1 },
    uPrismorphicUvScaleY: { value: 1 },
    uPrismorphicNormalStrength: { value: 1 },
    uPrismorphicParallaxEnabled: { value: false },
    uPrismorphicParallaxDepth: { value: 0 },
    uPrismorphicParallaxSteps: { value: 12 },
    uPrismorphicInteriorLayers: { value: 1 },
    uPrismorphicInteriorDepth: { value: 0 },
    uPrismorphicInteriorGlow: { value: 0 },
    uPrismorphicEmissiveIntensity: { value: 1 },
    uPrismorphicAnimationEnabled: { value: false },
    uPrismorphicAnimationSpeed: { value: 0 },
    uPrismorphicAnimationAmount: { value: 0 },
    uPrismorphicAnimationMode: { value: 0 },
    uPrismorphicAnimationSeed: { value: 0 },
    uPrismorphicAnimationPaused: { value: false },
    uPrismorphicAnimationTime: { value: 0 },
  };
}

/** Clones a uniform value so Three.js owns a mutable copy. */
export function cloneUniformValue(
  value: number | boolean | readonly number[],
): number | boolean | number[] {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return Array.from(value);
}

/** Injects UV varying, evaluate helpers, and displacement into the vertex shader. */
export function injectCompiledGraphVertexShader(
  shader: GraphShaderProgramParameters,
  compiled: CompiledGraphShaderSources,
): void {
  const usesGraphDisplacement = compiled.usesDisplacementOutput !== false;
  if (!shader.vertexShader.includes('vPrismorphicUv')) {
    shader.vertexShader = `${PRISMORPHIC_UV_VARYING}\n${PRISMORPHIC_POSITION_VARYING}\n${PRISMORPHIC_OBJECT_FRAME_VARYINGS}\n${shader.vertexShader}`;
  }
  if (usesGraphDisplacement && !shader.vertexShader.includes('prismorphic_evaluate_graph')) {
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `${PRISMORPHIC_MATERIAL_PARAMETER_UNIFORMS}\n${compiled.uniformsSource}\n${compiled.helpersSource}\n${compiled.evaluateFunctionSource}\n\nvoid main() {`,
    );
  }
  if (!shader.vertexShader.includes('vPrismorphicUv = uv')) {
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `void main() {
\tvPrismorphicUv = uv;
\tvPrismorphicPosition = position;
\tvPrismorphicObjectNormal = normalize(normal);
\tvPrismorphicAxisXView = normalize(mat3(modelViewMatrix) * vec3(1.0, 0.0, 0.0));
\tvPrismorphicAxisYView = normalize(mat3(modelViewMatrix) * vec3(0.0, 1.0, 0.0));
\tvPrismorphicAxisZView = normalize(mat3(modelViewMatrix) * vec3(0.0, 0.0, 1.0));`,
    );
  }

  const displacementInjection = `
  {
    vec4 prismorphicBaseColor;
    float prismorphicMetallic;
    float prismorphicRoughness;
    float prismorphicTransmission;
    vec4 prismorphicEmission;
    float prismorphicOpacity;
    vec3 prismorphicNormalTs;
    float prismorphicDisplacement;
    bool prismorphicOutputEnabled;
    bool prismorphicEmissionDriven;
    bool prismorphicNormalDriven;
    bool prismorphicDisplacementDriven;
    bool prismorphicUnlit;
    float prismorphicAlbedoAuthority;
    prismorphic_evaluate_graph(${EVALUATE_CALL_ARGS_VERTEX}
    );
    if (prismorphicOutputEnabled && prismorphicDisplacementDriven) {
      transformed += normalize( objectNormal ) * prismorphicDisplacement;
    }
#ifdef USE_DISPLACEMENTMAP
    else {
      transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
    }
#endif
  }
`;

  if (usesGraphDisplacement && shader.vertexShader.includes('#include <displacementmap_vertex>')) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <displacementmap_vertex>',
      displacementInjection,
    );
  }
}

/** Injects UV, tangent frame, evaluate helpers, normal and surface into the fragment shader. */
export function injectCompiledGraphFragmentShader(
  shader: GraphShaderProgramParameters,
  compiled: CompiledGraphShaderSources,
): void {
  const usesGraphNormal = compiled.usesNormalOutput !== false;
  if (!shader.fragmentShader.includes('vPrismorphicUv')) {
    shader.fragmentShader = `${PRISMORPHIC_UV_VARYING}\n${PRISMORPHIC_POSITION_VARYING}\n${PRISMORPHIC_OBJECT_FRAME_VARYINGS}\n${shader.fragmentShader}`;
  }
  if (usesGraphNormal && !shader.fragmentShader.includes('prismorphic_tangent_frame')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `${PRISMORPHIC_TANGENT_FRAME}\nvoid main() {`,
    );
  }
  if (!shader.fragmentShader.includes('prismorphic_evaluate_graph')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `${PRISMORPHIC_MATERIAL_PARAMETER_UNIFORMS}\n${PRISMORPHIC_PARALLAX_HELPERS}\n${compiled.uniformsSource}\n${compiled.helpersSource}\n${compiled.evaluateFunctionSource}\n\nvoid main() {`,
    );
  }

  // Locals shared by normal + surface injections (single evaluate call).
  if (!shader.fragmentShader.includes('bool prismorphicGraphSampled')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `void main() {
	vec4 prismorphicBaseColor;
	float prismorphicMetallic;
	float prismorphicRoughness;
	float prismorphicTransmission;
	vec4 prismorphicEmission;
	float prismorphicOpacity;
	vec3 prismorphicNormalTs;
	float prismorphicDisplacement;
	bool prismorphicOutputEnabled = false;
	bool prismorphicEmissionDriven = false;
	bool prismorphicNormalDriven = false;
	bool prismorphicDisplacementDriven = false;
	bool prismorphicUnlit = false;
	float prismorphicAlbedoAuthority = 0.0;
	bool prismorphicGraphSampled = false;
	bool prismorphicParallaxSampled = false;
	vec3 prismorphicParallaxIce = vec3(0.0);
	vec3 prismorphicParallaxRearIce = vec3(0.0);
	float prismorphicParallaxFresnel = 0.0;
	float prismorphicParallaxBaseWeight = 1.0;
	float prismorphicParallaxBackFace = 0.0;`,
    );
  }

  const sampleGraphForNormal = usesGraphNormal
    ? `if (!prismorphicGraphSampled) {
    prismorphic_evaluate_graph(${EVALUATE_CALL_ARGS_FRAGMENT}
    );
    prismorphicGraphSampled = true;
  }`
    : '';
  const applyGraphNormal = usesGraphNormal
    ? `if (prismorphicOutputEnabled && prismorphicNormalDriven) {
    vec3 prismN = normalize(prismorphicNormalTs);
    float sx = clamp(abs(prismN.x) * 2.0, 0.0, 4.0);
    float sy = clamp(abs(prismN.y) * 2.0, 0.0, 4.0);
    if (sx < 1e-6) sx = 1.0;
    if (sy < 1e-6) sy = 1.0;
    prismN.x *= sx;
    prismN.y *= sy;
#if defined( USE_NORMALMAP_TANGENTSPACE )
    normal = normalize( tbn * prismN );
#else
    mat3 tbnPrism = prismorphic_tangent_frame( -vViewPosition, normal, vPrismorphicUv );
    normal = normalize( tbnPrism * prismN );
#endif
  }`
    : '';

  const sampleAndApplyNormal = `
  ${sampleGraphForNormal}
  if (uPrismorphicParallaxEnabled) {
    // Remove the legacy UV normal/bump contribution and rebuild the relief
    // from the exact same continuous object-space field as the parallax body.
    // Mixing both projections was the source of the remaining meridian seam.
    normal = nonPerturbedNormal;
#ifdef USE_BUMPMAP
    float prismorphicSeamlessHeight = prismorphic_triplanar_height(
      vPrismorphicPosition,
      vPrismorphicObjectNormal
    );
    float prismorphicSeamlessNormalStrength = max(
      max(abs(bumpScale) * 12.0, uPrismorphicNormalStrength * 1.8),
      0.22
    );
#if defined(USE_NORMALMAP_TANGENTSPACE)
    // Compatibility path for documents that still need a conventional normal
    // texture. Parallax presets pass their authored strength through the
    // dedicated uniform, so the redundant 2K normal map can stay off the GPU.
    prismorphicSeamlessNormalStrength = max(
      prismorphicSeamlessNormalStrength,
      (abs(normalScale.x) + abs(normalScale.y)) * 0.9
    );
#endif
    vec2 prismorphicSeamlessGradient = vec2(
      dFdx(prismorphicSeamlessHeight),
      dFdy(prismorphicSeamlessHeight)
    ) * prismorphicSeamlessNormalStrength;
    normal = perturbNormalArb(
      -vViewPosition,
      normal,
      prismorphicSeamlessGradient,
      faceDirection
    );
#endif
  }
  ${applyGraphNormal}
`;

  const applySurface = `
  if (!prismorphicGraphSampled) {
    prismorphic_evaluate_graph(${EVALUATE_CALL_ARGS_FRAGMENT}
    );
    prismorphicGraphSampled = true;
  }
  if (prismorphicOutputEnabled) {
    float prismorphicPanelMix = uPrismorphicHasPrismStrength
      ? clamp(uPrismorphicPrismStrength, 0.0, 1.0)
      : 1.0;
    vec4 prismorphicPanelBaseColor = uPrismorphicHasBaseColor
      ? uPrismorphicBaseColor
      : diffuseColor;
#ifdef USE_MAP
    if (uPrismorphicParallaxEnabled) {
#if defined(USE_BUMPMAP)
      float prismorphicFaceDirection = gl_FrontFacing ? 1.0 : -1.0;
      vec3 prismorphicObjectNormal = normalize(vPrismorphicObjectNormal)
        * prismorphicFaceDirection;
      vec3 prismorphicViewDirection = normalize(vViewPosition);
      vec3 prismorphicAxisX = normalize(vPrismorphicAxisXView);
      vec3 prismorphicAxisY = normalize(vPrismorphicAxisYView);
      vec3 prismorphicAxisZ = normalize(vPrismorphicAxisZView);

      prismorphicParallaxIce = prismorphic_triplanar_parallax(
        vPrismorphicPosition,
        prismorphicObjectNormal,
        prismorphicViewDirection,
        prismorphicAxisX,
        prismorphicAxisY,
        prismorphicAxisZ
      );

      vec3 prismorphicViewObject = vec3(
        dot(prismorphicViewDirection, prismorphicAxisX),
        dot(prismorphicViewDirection, prismorphicAxisY),
        dot(prismorphicViewDirection, prismorphicAxisZ)
      );
      float prismorphicBackfaceRead = clamp(
        uPrismorphicInteriorGlow * 0.10,
        0.0,
        0.40
      );
      vec3 prismorphicRearPosition = vPrismorphicPosition
        - prismorphicViewObject * (0.85 + prismorphicBackfaceRead * 1.65)
        - prismorphicObjectNormal * (0.18 + uPrismorphicParallaxDepth * 0.30);
      float prismorphicRearOpticalHint =
        (uPrismorphicHasTransmission ? uPrismorphicTransmission : 0.0)
        + (uPrismorphicHasPrismStrength ? uPrismorphicPrismStrength : 0.0) * 0.38
        + uPrismorphicInteriorGlow * 0.12;
      if (prismorphicRearOpticalHint > 0.0005) {
        prismorphicParallaxRearIce = prismorphic_triplanar_rear(
          prismorphicRearPosition,
          -prismorphicObjectNormal
        );
      }
      prismorphicParallaxFresnel = pow(
        1.0 - clamp(dot(prismorphicViewDirection, prismorphicObjectNormal), 0.0, 1.0),
        1.6
      );
      prismorphicParallaxBaseWeight = mix(
        prismorphicPanelMix,
        max(0.05, prismorphicPanelMix - 0.45),
        prismorphicParallaxFresnel
      );
      prismorphicParallaxBackFace = gl_FrontFacing ? 0.0 : 1.0;
      prismorphicParallaxSampled = true;

      // Feed the physical BRDF with the same triplanar body that will receive
      // Anym's post-lighting rear-volume composition below.
      // Replace the old UV read completely: even a small remainder can reveal
      // the sphere meridian once normal and parallax highlights move over it.
      diffuseColor.rgb = diffuse * prismorphicParallaxIce;
#endif
    }
    // Three has already multiplied diffuseColor by the authored color map.
    // Treat graph color as a non-destructive tint so hybrid texture + node
    // materials keep their real albedo instead of being flattened to a solid.
    vec3 prismorphicTintedAlbedo =
      mix(diffuseColor.rgb, diffuseColor.rgb * prismorphicBaseColor.rgb, prismorphicPanelMix);
    // A blend is the exception: where its mask says an invited recipe owns the
    // surface, that recipe's colour has to replace the host's map rather than
    // tint it, or the guest reads as a faint stain on the host's texture.
    float prismorphicOwn = clamp(prismorphicAlbedoAuthority, 0.0, 1.0) * prismorphicPanelMix;
    if (uPrismorphicMaskView) {
      // Answers "where is my guest?" and nothing else. It rides the unlit path
      // below so no lighting reads through the grey, and nothing about the
      // document changes to show it.
      diffuseColor = vec4(vec3(clamp(prismorphicAlbedoAuthority, 0.0, 1.0)), 1.0);
      prismorphicUnlit = true;
      prismorphicEmissionDriven = false;
    }
    diffuseColor = vec4(
      mix(prismorphicTintedAlbedo, prismorphicBaseColor.rgb, prismorphicOwn),
      mix(diffuseColor.a, diffuseColor.a * prismorphicOpacity, prismorphicPanelMix)
    );
#else
    diffuseColor = vec4(
      mix(prismorphicPanelBaseColor.rgb, prismorphicBaseColor.rgb, prismorphicPanelMix),
      mix(prismorphicPanelBaseColor.a, prismorphicOpacity, prismorphicPanelMix)
    );
#endif
    metalnessFactor = uPrismorphicHasMetallic
      ? clamp(uPrismorphicMetallic, 0.0, 1.0)
      : prismorphicMetallic;
    float prismorphicAuthoredRoughness = uPrismorphicHasRoughness
      ? clamp(uPrismorphicRoughness, 0.0, 1.0)
      : prismorphicRoughness;
#ifdef USE_ROUGHNESSMAP
    if (uPrismorphicParallaxEnabled) {
      vec2 prismorphicRoughnessScale = max(
        vec2(0.1),
        vec2(uPrismorphicUvScaleX, uPrismorphicUvScaleY)
      );
      vec3 prismorphicRoughnessWeights = pow(
        max(abs(normalize(vPrismorphicObjectNormal)), vec3(1e-4)),
        vec3(8.0)
      );
      prismorphicRoughnessWeights /= prismorphicRoughnessWeights.x
        + prismorphicRoughnessWeights.y
        + prismorphicRoughnessWeights.z;
      float prismorphicRoughnessX = texture2D(
        roughnessMap,
        prismorphic_surface_uv(prismorphic_project_x(vPrismorphicPosition) * prismorphicRoughnessScale, 0.0)
      ).g;
      float prismorphicRoughnessY = texture2D(
        roughnessMap,
        prismorphic_surface_uv(prismorphic_project_y(vPrismorphicPosition) * prismorphicRoughnessScale, 2.094395)
      ).g;
      float prismorphicRoughnessZ = texture2D(
        roughnessMap,
        prismorphic_surface_uv(prismorphic_project_z(vPrismorphicPosition) * prismorphicRoughnessScale, 4.188790)
      ).g;
      float prismorphicDirectionalRoughness = prismorphicRoughnessX * prismorphicRoughnessWeights.x
        + prismorphicRoughnessY * prismorphicRoughnessWeights.y
        + prismorphicRoughnessZ * prismorphicRoughnessWeights.z;
      float prismorphicRoughnessTransition = (1.0 - max(
        max(prismorphicRoughnessWeights.x, prismorphicRoughnessWeights.y),
        prismorphicRoughnessWeights.z
      )) * 0.58;
      float prismorphicSeamlessRoughness = mix(
        prismorphicDirectionalRoughness,
        prismorphic_median3(prismorphicRoughnessX, prismorphicRoughnessY, prismorphicRoughnessZ),
        prismorphicRoughnessTransition
      );
      // Treat the authored texture as micro-variation around the graph's
      // roughness control. Multiplying by the raw (often physically authored)
      // value collapsed glass and metals toward zero roughness, producing
      // aliased, cheap-looking mirror bands and making the UI slider nonlinear.
      float prismorphicRoughnessModulation = mix(
        0.72,
        1.08,
        clamp(prismorphicSeamlessRoughness, 0.0, 1.0)
      );
      roughnessFactor = clamp(
        prismorphicAuthoredRoughness * prismorphicRoughnessModulation,
        0.015,
        1.0
      );
    }
#else
    roughnessFactor = prismorphicAuthoredRoughness;
#endif
#ifdef USE_EMISSIVEMAP
    if (uPrismorphicParallaxEnabled) {
      // The emissive texture is already sampled by the continuous volume
      // projection above; discard Three's UV-mapped copy to avoid a glow seam.
      totalEmissiveRadiance = vec3(0.0);
    }
#endif
    // Transmission is applied later via material.transmission (Three r170 no longer
    // exposes a mutable transmission local before lights — assigning a missing
    // identifier breaks glass / USE_TRANSMISSION programs).
    if (prismorphicEmissionDriven) {
      // Graph emission replaces the physical emissive color. Scale by the
      // authored emissiveIntensity uniform so Essential controls still drive
      // brightness when parallax zeros the emissive map.
      totalEmissiveRadiance = prismorphicEmission.rgb * max(uPrismorphicEmissiveIntensity, 0.35)
        * prismorphic_animation_envelope(vPrismorphicUv, 0.0)
        * prismorphic_animation_color_grade(vPrismorphicUv, 0.0);
    }
    if (prismorphicUnlit) {
      // Neutralize physical lighting contributions; drive flat color via emissive.
      metalnessFactor = 0.0;
      roughnessFactor = 1.0;
      totalEmissiveRadiance = diffuseColor.rgb;
    }
  } else {
    diffuseColor = vec4(0.42, 0.43, 0.46, 0.08);
    metalnessFactor = 0.0;
    roughnessFactor = 1.0;
    totalEmissiveRadiance = vec3(0.0);
  }
`;

  // After lighting accumulates into reflectedLight, zero physical terms for unlit.
  const neutralizeUnlitLighting = `
  if (prismorphicOutputEnabled && prismorphicUnlit) {
    reflectedLight.directDiffuse = vec3(0.0);
    reflectedLight.directSpecular = vec3(0.0);
    reflectedLight.indirectDiffuse = vec3(0.0);
    reflectedLight.indirectSpecular = vec3(0.0);
    totalEmissiveRadiance = diffuseColor.rgb;
  }
`;

  // Final Anym Core composition happens after the physical BRDF has produced
  // outgoingLight. This is what makes the shifted layer read behind the shell
  // instead of looking like another diffuse decal on its surface.
  const applyParallaxVolume = `
#if defined(USE_MAP) && defined(USE_BUMPMAP)
  if (prismorphicParallaxSampled && !prismorphicUnlit) {
    float prismorphicOpticalStrength = clamp(
      (uPrismorphicHasTransmission ? uPrismorphicTransmission : 0.0)
        + (uPrismorphicHasPrismStrength ? uPrismorphicPrismStrength : 0.0) * 0.38
        + uPrismorphicInteriorGlow * 0.12,
      0.0,
      1.0
    );
    vec3 prismorphicOpticalLight = mix(
      prismorphicParallaxIce,
      outgoingLight + prismorphicParallaxIce * 0.35,
      prismorphicParallaxBaseWeight
    );
    outgoingLight = mix(outgoingLight, prismorphicOpticalLight, prismorphicOpticalStrength);

    float prismorphicBackfaceRead = clamp(
      uPrismorphicInteriorGlow * 0.10,
      0.0,
      0.40
    );
    float prismorphicRearRead = clamp(
      prismorphicBackfaceRead * (0.22 + prismorphicParallaxFresnel * 0.55),
      0.0,
      0.55
    );
    outgoingLight += prismorphicParallaxRearIce * prismorphicRearRead * prismorphicOpticalStrength
      * (0.08 + (1.0 - prismorphicParallaxBaseWeight) * 0.18);
    outgoingLight += prismorphicParallaxIce * prismorphicParallaxBackFace
      * (0.04 + prismorphicParallaxFresnel * 0.05 + prismorphicBackfaceRead * 0.06)
      * prismorphicOpticalStrength;

    float prismorphicRim = pow(prismorphicParallaxFresnel, 1.5);
    vec3 prismorphicSignatureTint = mix(
      vec3(0.24, 0.48, 1.0),
      max(uPrismorphicBaseColor.rgb, vec3(0.08)),
      0.45
    );
    outgoingLight += prismorphicSignatureTint * prismorphicRim * 0.09
      * prismorphicOpticalStrength;
    float prismorphicHeadOn = max(0.0, 1.0 - prismorphicParallaxFresnel);
    outgoingLight += vec3(0.82, 0.92, 1.15)
      * pow(prismorphicHeadOn, 20.0) * 0.045 * prismorphicOpticalStrength;
    float prismorphicCrackness = smoothstep(
      0.38,
      1.0,
      max(
        max(prismorphicParallaxIce.r, prismorphicParallaxIce.g),
        prismorphicParallaxIce.b
      )
    );
    outgoingLight += vec3(0.28, 0.56, 1.0)
      * prismorphicCrackness * 0.0324 * max(1.0, uPrismorphicInteriorGlow)
      * prismorphicOpticalStrength;
  }
#endif
`;

  // Three r170 transmission_fragment reads the `transmission` uniform into
  // material.transmission. Replace the include so the graph drives that slot.
  const transmissionFragmentOverride = `
#ifdef USE_TRANSMISSION
  material.transmission = prismorphicGraphSampled
    ? ((prismorphicOutputEnabled && !prismorphicUnlit)
      ? (uPrismorphicHasTransmission
        ? clamp(uPrismorphicTransmission, 0.0, 1.0)
        : clamp(prismorphicTransmission, 0.0, 1.0))
      : 0.0)
    : transmission;
  material.transmissionAlpha = 1.0;
  material.thickness = thickness;
  material.attenuationDistance = attenuationDistance;
  material.attenuationColor = attenuationColor;
  #ifdef USE_TRANSMISSIONMAP
    if (uPrismorphicParallaxEnabled) {
      vec2 prismorphicTransmissionScale = max(
        vec2(0.1),
        vec2(uPrismorphicUvScaleX, uPrismorphicUvScaleY)
      );
      float prismorphicTransmissionVolume = (
        texture2D(transmissionMap, prismorphic_project_x(vPrismorphicPosition) * prismorphicTransmissionScale).r
        + texture2D(transmissionMap, prismorphic_project_y(vPrismorphicPosition) * prismorphicTransmissionScale).r
        + texture2D(transmissionMap, prismorphic_project_z(vPrismorphicPosition) * prismorphicTransmissionScale).r
      ) / 3.0;
      material.transmission *= prismorphicTransmissionVolume;
    } else {
      material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
    }
  #endif
  #ifdef USE_THICKNESSMAP
    if (uPrismorphicParallaxEnabled) {
      vec2 prismorphicThicknessScale = max(
        vec2(0.1),
        vec2(uPrismorphicUvScaleX, uPrismorphicUvScaleY)
      );
      float prismorphicThicknessVolume = (
        texture2D(thicknessMap, prismorphic_project_x(vPrismorphicPosition) * prismorphicThicknessScale).g
        + texture2D(thicknessMap, prismorphic_project_y(vPrismorphicPosition) * prismorphicThicknessScale).g
        + texture2D(thicknessMap, prismorphic_project_z(vPrismorphicPosition) * prismorphicThicknessScale).g
      ) / 3.0;
      material.thickness *= prismorphicThicknessVolume;
    } else {
      material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
    }
  #endif
  vec3 pos = vWorldPosition;
  vec3 v = normalize( cameraPosition - pos );
  vec3 n = inverseTransformDirection( normal, viewMatrix );
  vec4 transmitted = getIBLVolumeRefraction(
    n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
    pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
    material.attenuationColor, material.attenuationDistance );
  material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
  totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif
`;

  // The parallax path fully replaces Three's UV-space map, roughness, bump /
  // normal and emissive reads. Avoid sampling those maps once in the stock
  // chunks only to overwrite their results with the seamless volume values.
  if (shader.fragmentShader.includes('#include <map_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `if (!uPrismorphicParallaxEnabled) {\n#include <map_fragment>\n}`,
    );
  }
  if (shader.fragmentShader.includes('#include <roughnessmap_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  if (!uPrismorphicParallaxEnabled) {
    vec4 texelRoughness = texture2D(roughnessMap, vRoughnessMapUv);
    roughnessFactor *= texelRoughness.g;
  }
#endif`,
    );
  }
  if (shader.fragmentShader.includes('#include <normal_fragment_maps>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `if (!uPrismorphicParallaxEnabled) {\n#include <normal_fragment_maps>\n}\n${sampleAndApplyNormal}`,
    );
  }

  if (shader.fragmentShader.includes('#include <emissivemap_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `if (!uPrismorphicParallaxEnabled) {\n#include <emissivemap_fragment>\n}\n${applySurface}`,
    );
  } else if (shader.fragmentShader.includes('#include <lights_physical_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_physical_fragment>',
      `${applySurface}\n#include <lights_physical_fragment>`,
    );
  } else {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `${applySurface}\n#include <opaque_fragment>`,
    );
  }

  if (shader.fragmentShader.includes('#include <lights_fragment_end>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>\n${neutralizeUnlitLighting}`,
    );
  } else if (shader.fragmentShader.includes('#include <opaque_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `${neutralizeUnlitLighting}\n#include <opaque_fragment>`,
    );
  }

  if (shader.fragmentShader.includes('#include <transmission_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <transmission_fragment>',
      transmissionFragmentOverride,
    );
  }

  if (shader.fragmentShader.includes('#include <opaque_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `${applyParallaxVolume}\n#include <opaque_fragment>`,
    );
  }
}
