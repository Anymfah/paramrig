/**
 * Direct ParamRig adaptation of the Helios Ray production planet path:
 * - shaders/glsl/noise/noise-functions.glsl
 * - shaders/glsl/noise/terrain-functions.glsl
 * - shaders/glsl/body/celestial-body.vert.glsl
 * - shaders/glsl/body/celestial-body.frag.glsl
 *
 * Removed here because the rig does not need them: server heightmaps,
 * terraforming, craters, painted zones, rings, ice/liquid/plasma and tree
 * shadows. The terrain equation, seeded FBM, domain warp, shelf shaping,
 * finite-difference bump normal, height texture lookup and filmic shoulder
 * retain the Helios implementation and parameter names.
 */

const heliosNoise = /* glsl */ `
vec4 permuteSeeded(vec4 x, float seed) {
  float s = mod(seed, 289.0);
  return mod(((x * 34.0) + 1.0) * x + s, 289.0);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float simplex3Seeded(vec3 v, float seed) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = permuteSeeded(
    permuteSeeded(
      permuteSeeded(i.z + vec4(0.0, i1.z, i2.z, 1.0), seed)
        + i.y + vec4(0.0, i1.y, i2.y, 1.0),
      seed
    ) + i.x + vec4(0.0, i1.x, i2.x, 1.0),
    seed
  );
  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m *= m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fractal3Seeded(
  vec3 v,
  float sharpness,
  float period,
  float persistence,
  float lacunarity,
  int octaves,
  float seed
) {
  float n = 0.0;
  float a = 1.0;
  float maxAmp = 0.0;
  float currentPeriod = period;
  for (int i = 0; i < 12; i++) {
    if (i >= octaves) break;
    n += a * simplex3Seeded(v / currentPeriod, seed);
    a *= persistence;
    maxAmp += a;
    currentPeriod /= lacunarity;
  }
  return n / max(maxAmp, 0.0001);
}
`

const terrainParameters = /* glsl */ `
uniform int type;
uniform float seed;
uniform float radius;
uniform float amplitude;
uniform float sharpness;
uniform float offset;
uniform float period;
uniform float persistence;
uniform float lacunarity;
uniform int octaves;
uniform float warpStrength;
uniform float warpScale;
uniform float hemisphereContrast;
uniform float hemisphereAngle;
uniform float continentalShelf;
uniform float continentalDropoff;
uniform float continentalDepth;
uniform float noiseBlend;
uniform int noiseBlendType;
`

const heliosTerrain = /* glsl */ `
${heliosNoise}

struct TerrainParams {
  int type;
  float seed;
  float amplitude;
  float sharpness;
  float offset;
  float period;
  float persistence;
  float lacunarity;
  int octaves;
  float warpStrength;
  float warpScale;
  float hemisphereContrast;
  float hemisphereAngle;
  float continentalShelf;
  float continentalDropoff;
  float continentalDepth;
  float noiseBlend;
  int noiseBlendType;
};

float evaluateNoise(
  int noiseType,
  vec3 v,
  float sampleSeed,
  float sampleAmplitude,
  float sampleSharpness,
  float samplePeriod,
  float samplePersistence,
  float sampleLacunarity,
  int sampleOctaves
) {
  float h = 0.0;
  if (noiseType == 1) {
    h = sampleAmplitude * simplex3Seeded(v / samplePeriod, sampleSeed);
  } else if (noiseType == 2) {
    h = sampleAmplitude * fractal3Seeded(
      v,
      sampleSharpness,
      samplePeriod,
      samplePersistence,
      sampleLacunarity,
      sampleOctaves,
      sampleSeed
    );
    h = sampleAmplitude * pow(max(0.0, (h + 1.0) / 2.0), sampleSharpness);
  } else if (noiseType == 3) {
    h = fractal3Seeded(
      v,
      sampleSharpness,
      samplePeriod,
      samplePersistence,
      sampleLacunarity,
      sampleOctaves,
      sampleSeed
    );
    h = sampleAmplitude * pow(max(0.0, 1.0 - abs(h)), sampleSharpness);
  }
  return h;
}

TerrainParams terrainParams() {
  TerrainParams p;
  p.type = type;
  p.seed = seed;
  p.amplitude = amplitude;
  p.sharpness = sharpness;
  p.offset = offset;
  p.period = period;
  p.persistence = persistence;
  p.lacunarity = lacunarity;
  p.octaves = octaves;
  p.warpStrength = warpStrength;
  p.warpScale = warpScale;
  p.hemisphereContrast = hemisphereContrast;
  p.hemisphereAngle = hemisphereAngle;
  p.continentalShelf = continentalShelf;
  p.continentalDropoff = continentalDropoff;
  p.continentalDepth = continentalDepth;
  p.noiseBlend = noiseBlend;
  p.noiseBlendType = noiseBlendType;
  return p;
}

float terrainHeightS(TerrainParams p, vec3 v) {
  if (p.warpStrength > 0.001) {
    float wx = simplex3Seeded(v / p.warpScale, p.seed + 31.0);
    float wy = simplex3Seeded(v / p.warpScale + vec3(7.3), p.seed + 71.0);
    float wz = simplex3Seeded(v / p.warpScale + vec3(13.7), p.seed + 113.0);
    v += p.warpStrength * vec3(wx, wy, wz);
  }

  float h = evaluateNoise(
    p.type,
    v,
    p.seed,
    p.amplitude,
    p.sharpness,
    p.period,
    p.persistence,
    p.lacunarity,
    p.octaves
  );
  if (p.noiseBlend > 0.001) {
    float h2 = evaluateNoise(
      p.noiseBlendType,
      v,
      p.seed,
      p.amplitude,
      p.sharpness,
      p.period,
      p.persistence,
      p.lacunarity,
      p.octaves
    );
    h = mix(h, h2, p.noiseBlend);
  }
  if (p.hemisphereContrast > 0.001) {
    vec3 axis = vec3(sin(p.hemisphereAngle), cos(p.hemisphereAngle), 0.0);
    h *= 1.0 + p.hemisphereContrast * dot(normalize(v), axis);
  }
  if (p.continentalShelf > 0.001) {
    float above = max(0.0, h - p.continentalShelf);
    float below = min(0.0, h - p.continentalShelf);
    float basinFloor = -p.continentalDepth * (1.0 - exp(below * p.continentalDropoff));
    h = p.continentalShelf + above + basinFloor;
  }
  float result = max(0.0, h + p.offset);
  if (result < 0.03) {
    float floorNoise = simplex3Seeded(v * 200.0, p.seed + 500.0) * 0.5 + 0.5;
    float floorDetail = floorNoise * 0.025 * p.amplitude;
    float floorBlend = 1.0 - smoothstep(0.0, 0.03, result);
    result += floorDetail * floorBlend;
  }
  return result;
}
`

export const terrainVertexShader = /* glsl */ `
attribute vec3 tangent;
${terrainParameters}
varying vec3 fragPosition;
varying vec3 fragNormal;
varying vec3 fragTangent;
varying vec3 fragBitangent;
varying float vTerrainHeight;
${heliosTerrain}

void main() {
  TerrainParams p = terrainParams();
  float h = terrainHeightS(p, position);
  vTerrainHeight = h;
  vec3 displaced = position * (radius + h);
  fragPosition = position;
  fragNormal = normal;
  fragTangent = tangent;
  fragBitangent = normalize(cross(normal, tangent));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`

export const terrainFragmentShader = /* glsl */ `
${terrainParameters}
uniform sampler2D terrainColorMap;
uniform sampler2D terrainBumpMap;
uniform float terrainColorHMax;
uniform float bumpStrength;
uniform float bumpOffset;
uniform float specularThreshold;
uniform float ambientIntensity;
uniform float diffuseIntensity;
uniform float specularIntensity;
uniform float shininess;
uniform float fillLightIntensity;
uniform float cameraTorchIntensity;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 uCameraPosition;
uniform vec3 uCameraDirection;
varying vec3 fragPosition;
varying vec3 fragNormal;
varying vec3 fragTangent;
varying vec3 fragBitangent;
varying float vTerrainHeight;
${heliosTerrain}

void main() {
  TerrainParams p = terrainParams();
  float h = vTerrainHeight;
  float hColor = clamp(h / max(0.0001, terrainColorHMax), 0.0, 1.0);
  vec3 positionOnBody = fragPosition * (radius + h);
  vec3 dx = bumpOffset * fragTangent;
  vec3 dy = bumpOffset * fragBitangent;
  float hDx = terrainHeightS(p, fragPosition + dx);
  float hDy = terrainHeightS(p, fragPosition + dy);
  vec3 positionDx = (fragPosition + dx) * (radius + hDx);
  vec3 positionDy = (fragPosition + dy) * (radius + hDy);
  vec3 bumpNormal = normalize(cross(positionDx - positionOnBody, positionDy - positionOnBody));
  float latitude = 0.5 - normalize(fragPosition).y * 0.5;
  float localBumpStrength = texture2D(terrainBumpMap, vec2(latitude, hColor)).r;
  vec3 N = normalize(mix(fragNormal, bumpNormal, bumpStrength * localBumpStrength));
  vec3 L = normalize(lightDirection);
  vec3 V = normalize(uCameraPosition - positionOnBody);
  vec3 R = normalize(reflect(-L, N));

  float diffuse = diffuseIntensity * max(0.0, dot(N, L));
  float fillDiffuse = fillLightIntensity * max(0.0, dot(N, V));
  float spot = max(0.0, dot(uCameraDirection, -V));
  spot *= spot;
  float face = max(0.0, dot(N, V));
  float sunFacing = dot(uCameraDirection, lightDirection);
  float torchMask = smoothstep(0.0, 0.2, sunFacing);
  float torchDiffuse = cameraTorchIntensity * face * spot * 2.5 * torchMask;
  float specularFalloff = clamp(
    (specularThreshold - h) / max(0.0001, specularThreshold),
    0.0,
    1.0
  );
  float specular = specularFalloff * specularIntensity *
    pow(max(dot(V, R), 0.0), shininess);
  float light = ambientIntensity + diffuse + fillDiffuse + torchDiffuse + specular;

  vec3 finalColor = texture2D(terrainColorMap, vec2(latitude, hColor)).rgb;
  float slope = 1.0 - clamp(dot(N, normalize(fragPosition)), 0.0, 1.0);
  float mineral = simplex3Seeded(fragPosition * 54.0, seed + 1207.0) * 0.5 + 0.5;
  finalColor *= mix(0.92, 1.04, mineral);
  finalColor = mix(finalColor, finalColor * 0.7, smoothstep(0.025, 0.22, slope) * 0.42);

  vec3 litColor = light * finalColor * lightColor;
  const float TM_KNEE = 0.75;
  const float TM_WHITE = 1.0;
  float luminance = dot(litColor, vec3(0.2126, 0.7152, 0.0722));
  if (luminance > TM_KNEE) {
    float over = luminance - TM_KNEE;
    float compressed = TM_KNEE + over / (1.0 + over / (TM_WHITE - TM_KNEE));
    litColor *= compressed / luminance;
  }
  gl_FragColor = vec4(litColor, 1.0);
}
`
