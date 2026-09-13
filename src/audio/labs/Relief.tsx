import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { audioContext } from '../playback'
import { SPECTRUM_COLUMNS, SPECTRUM_MIN_HZ, SPECTRUM_ROWS, spectrumPosition, type LabSpectrum } from './analysis'
import type { LabRender } from './generate'
import { markUniform, reliefMarks, type BusiestMoment, type MarkKind, type MarkUniform } from './marks'
import { ReliefGrips, type GripHandlers, type MarkLit } from './ReliefGrips'
import { RELIEF_VIEWS, type LabSound, type ReliefView } from './model'
import { RELIEF_DEPTH_FOCUS, RELIEF_GAMMA, frequencyLabel, frequencyTicks, heightOf, levelTicks, projectRelief, projectedDepth, unprojectedDepth, reliefLayout, timeTicks, type ReliefLayout } from './reliefLayout'
import type { LabPlaying } from './useLabs'

/**
 * The display's own colours. The relief is a screen, not a surface of the page: it keeps its
 * graphite and its cyan in either theme. CSS mirrors these as --labs-screen-*.
 */
const SCREEN = {
  edge: '#01080d', centre: '#031c24',
  low: '#064658', mid: '#00bcca', high: '#17fbe0', hot: '#71ffe4',
  grid: '#1b6873',
}
/** Line anatomy, in CSS pixels: a crisp core, and a soft halo drawn in the same pass. */
const LINE = { core: 0.28, halo: 1.2, haloGain: 0.07, gain: 1.28, xray: 0.07 }
/** Light belongs to the measured surface; it never changes its shape or adds idle motion. */
const GLASS = { body: '#025060', edge: '#49edd6', grazing: '#548cd9', strength: 0.85 }
const BLOOM = { strength: 0.4, radius: 0.12, threshold: 1.18 }
const MORPH_MS = 560
/** The view switcher's box, so the level scale can keep clear of it. */
const SWITCH_BOTTOM = 128

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
let webgl: boolean | null = null
function supportsWebGL(): boolean {
  if (webgl !== null) return webgl
  try {
    const canvas = document.createElement('canvas')
    webgl = !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch { webgl = false }
  return webgl
}

/* The same centred perspective as projectRelief: time across, depth towards the centre. */
const PROJECT = /* glsl */ `
uniform vec2 resolution;
uniform vec4 frame;
uniform vec3 shift;
vec2 projectPx(float t, float v, float level) {
  float focus = ${RELIEF_DEPTH_FOCUS.toFixed(4)};
  float focused = v / (focus + (1.0 - focus) * v);
  float scale = 1.0 / (1.0 + shift.x * focused);
  float depth = focused * (1.0 + shift.x) * scale;
  return vec2((frame.x + frame.y) * 0.5 + (frame.y - frame.x) * (t - 0.5) * scale, frame.z - shift.y * depth - frame.w * level * scale);
}
vec4 clipOf(vec2 px) {
  return vec4(px.x / resolution.x * 2.0 - 1.0, 1.0 - px.y / resolution.y * 2.0, 0.0, 1.0);
}
vec4 clipOf(vec2 px, float depth) {
  return vec4(px.x / resolution.x * 2.0 - 1.0, 1.0 - px.y / resolution.y * 2.0, clamp(depth, 0.0, 1.0) * 2.0 - 1.0, 1.0);
}
`
/*
 * One row of the spectrogram is one polyline, drawn as a strip of quads in screen space. Each
 * vertex reads its level and its two neighbours' from the texture, so the joins are mitred on
 * the curve the ear hears, and the width is a width in pixels whatever the slope.
 */
const RELIEF_VERTEX = /* glsl */ `
attribute float aT;
attribute float aRow;
attribute float aSide;
uniform sampler2D prev;
uniform sampler2D next;
uniform float morph;
uniform vec2 grid;
uniform float halfWidth;
uniform float gamma;
uniform float lift;
/*
 * The marks: the sound's own controls, each lit on the part of the relief that belongs to it — a
 * depth for Bite, a level for Grain, a time for Space, a point for Motion. A mark holds the row,
 * the time and the level it stands at, with -1 for whichever of the three it spans entirely, and
 * how lit it is; the bands say how wide it is in each.
 */
uniform vec4 marks[4];
uniform vec4 bands[4];
varying float vLevel;
varying float vAcross;
varying float vRow;
varying float vT;
varying float vMarkWide;
varying float vMarkLit;
varying float vMarkHot;
varying float vCrest;
${PROJECT}
float levelAt(float t) {
  vec2 uv = vec2((t * (grid.x - 1.0) + 0.5) / grid.x, (aRow * (grid.y - 1.0) + 0.5) / grid.y);
  return pow(clamp(mix(texture2D(prev, uv).r, texture2D(next, uv).r, morph), 0.0, 1.0), gamma);
}
void main() {
  float stepT = 1.0 / (grid.x - 1.0);
  float t0 = max(aT - stepT, 0.0);
  float t2 = min(aT + stepT, 1.0);
  float level = levelAt(aT);
  float before = levelAt(t0);
  float after = levelAt(t2);
  // Curvature lights the real crests, without introducing oscillations or decorative noise.
  vCrest = smoothstep(0.0, 0.012, max(0.0, level - (before + after) * 0.5));
  vec2 p0 = projectPx(t0, aRow, before);
  vec2 p1 = projectPx(aT, aRow, level);
  vec2 p2 = projectPx(t2, aRow, after);
  vec2 a = p1 - p0;
  vec2 b = p2 - p1;
  vec2 da = length(a) > 0.001 ? normalize(a) : normalize(b);
  vec2 db = length(b) > 0.001 ? normalize(b) : da;
  vec2 bend = da + db;
  vec2 tangent = length(bend) > 0.001 ? normalize(bend) : da;
  vec2 normal = vec2(-tangent.y, tangent.x);
  float miter = 1.0 / max(0.45, dot(normal, vec2(-da.y, da.x)));
  // A marked line is drawn wider as well as hotter: a rule laid over the terrain.
  vMarkWide = 0.0;
  vMarkLit = 0.0;
  vMarkHot = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 mark = marks[i];
    vec4 band = bands[i];
    if (band.x <= 0.0 && band.y <= 0.0 && band.z <= 0.0) continue;
    float glow = 1.0;
    if (mark.x >= 0.0) { float d = (aRow - mark.x) / band.x; glow *= exp(-d * d); }
    if (mark.y >= 0.0) { float d = (aT - mark.y) / band.y; glow *= exp(-d * d); }
    if (mark.z >= 0.0) { float d = (level - mark.z) / band.z; glow *= exp(-d * d); }
    vMarkWide = max(vMarkWide, glow * mark.w);
    vMarkLit = max(vMarkLit, glow * 1.1 * mark.w);
    vMarkHot = max(vMarkHot, glow * 0.7 * mark.w);
  }
  float reach = halfWidth * mix(1.0, 0.72, aRow) * (1.0 + vMarkWide * 0.9);
  gl_Position = clipOf(p1 + normal * aSide * reach * miter, aRow - lift);
  vLevel = level;
  vAcross = aSide * halfWidth * (1.0 + vMarkWide * 0.9);
  vRow = aRow;
  vT = aT;
}
`
const RELIEF_FRAGMENT = /* glsl */ `
uniform vec3 low;
uniform vec3 mid;
uniform vec3 high;
uniform vec3 hot;
uniform float core;
uniform float soft;
uniform float halo;
uniform float haloGain;
uniform float gain;
uniform float head;
uniform float xray;
varying float vLevel;
varying float vAcross;
varying float vRow;
varying float vT;
varying float vMarkWide;
varying float vMarkLit;
varying float vMarkHot;
varying float vCrest;
void main() {
  float d = abs(vAcross);
  float thick = core * (1.0 + vMarkWide * 1.4);
  float spread = halo * (1.0 + vMarkWide * 0.6);
  float line = 1.0 - smoothstep(thick - soft * 0.5, thick + soft * 0.5, d);
  float glow = exp(-0.5 * d * d / (spread * spread)) * haloGain;
  float level = clamp(vLevel, 0.0, 1.0);
  vec3 colour = mix(low, mid, smoothstep(0.03, 0.5, level));
  colour = mix(colour, high, smoothstep(0.5, 0.92, level));
  // Frequency depth shifts the luminous material from green-cyan towards blue.
  colour = mix(colour, vec3(0.2, 0.43, 0.9), vRow * 0.35);
  float away = (vT - head) / 0.011;
  float near = head < 0.0 ? 0.0 : exp(-away * away);
  float crest = vCrest * smoothstep(0.12, 0.65, level);
  colour = mix(colour, hot, clamp(near * 0.75 + smoothstep(0.68, 1.0, level) * 0.6 + crest * 0.45 + min(vMarkHot, 1.0), 0.0, 1.0));
  // Silent bands disappear instead of drawing a blue lid across the back of the relief.
  float energy = pow(level, 1.1);
  float depth = mix(1.0, 0.65, vRow);
  float ends = smoothstep(0.0, 0.02, vT) * smoothstep(1.0, 0.98, vT);
  float alpha = (line + glow) * ends * gain * xray * (energy * depth * (0.78 + crest * 0.48 + near * 1.3) + vMarkLit);
  // HDR emission is concentrated on the bright core; bloom leaves the fine dark lines separate.
  float emission = 1.0 + smoothstep(0.48, 1.0, level) * 0.8 + crest * 0.65;
  gl_FragColor = vec4(colour * alpha * emission, 1.0);
}
`
/* The relief's surface, written to the depth buffer and never to colour: it hides, it does not show. */
const OCCLUDER_VERTEX = /* glsl */ `
attribute float aT;
attribute float aRow;
uniform sampler2D prev;
uniform sampler2D next;
uniform float morph;
uniform vec2 grid;
uniform float gamma;
${PROJECT}
void main() {
  vec2 uv = vec2((aT * (grid.x - 1.0) + 0.5) / grid.x, (aRow * (grid.y - 1.0) + 0.5) / grid.y);
  float level = pow(clamp(mix(texture2D(prev, uv).r, texture2D(next, uv).r, morph), 0.0, 1.0), gamma);
  gl_Position = clipOf(projectPx(aT, aRow, level), aRow);
}
`
const OCCLUDER_FRAGMENT = /* glsl */ `
void main() { gl_FragColor = vec4(0.0); }
`
/* A thin translucent skin on the same spectrum as the contour lines and touch controls.
 * Central differences in the source texture give smooth normals, avoiding triangle-shaped
 * highlights. Nothing new is sampled or displaced to manufacture a more dramatic sound. */
const GLASS_VERTEX = /* glsl */ `
attribute float aT;
attribute float aRow;
uniform sampler2D prev;
uniform sampler2D next;
uniform float morph;
uniform vec2 grid;
uniform float gamma;
varying vec3 vNormal;
varying float vLevel;
varying vec2 vUv;
${PROJECT}
float heightAt(vec2 uv) {
  return pow(clamp(mix(texture2D(prev, uv).r, texture2D(next, uv).r, morph), 0.0, 1.0), gamma);
}
void main() {
  vec2 uv = vec2((aT * (grid.x - 1.0) + 0.5) / grid.x, (aRow * (grid.y - 1.0) + 0.5) / grid.y);
  vec2 stepSize = 1.0 / grid;
  float level = heightAt(uv);
  float dx = (heightAt(uv + vec2(stepSize.x, 0.0)) - heightAt(uv - vec2(stepSize.x, 0.0))) * grid.x / 6.0;
  float dy = (heightAt(uv + vec2(0.0, stepSize.y)) - heightAt(uv - vec2(0.0, stepSize.y))) * grid.y / 3.0;
  vNormal = normalize(vec3(-dx, -dy, 1.0));
  vLevel = level;
  vUv = vec2(aT, aRow);
  gl_Position = clipOf(projectPx(aT, aRow, level), aRow);
}
`
const GLASS_FRAGMENT = /* glsl */ `
uniform vec3 body;
uniform vec3 edge;
uniform vec3 grazing;
uniform float strength;
varying vec3 vNormal;
varying float vLevel;
varying vec2 vUv;
void main() {
  vec3 normal = normalize(vNormal);
  vec3 eye = normalize(vec3(0.0, -0.35, 1.0));
  vec3 light = normalize(vec3(-0.5, -0.35, 0.8));
  float facing = abs(dot(normal, eye));
  float rim = pow(1.0 - facing, 3.5);
  float shine = pow(max(0.0, dot(normal, normalize(eye + light))), 48.0);
  float diffuse = 0.2 + 0.8 * max(0.0, dot(normal, light));
  vec3 colour = mix(body * diffuse, grazing * diffuse, vUv.y * 0.3 + rim * 0.15);
  // Sparse cross-filaments lie on the measured surface and reveal its depth from above.
  // Their antialiasing follows screen derivatives, so they stay fine at every viewport.
  float lattice = vUv.x * 20.0;
  float distance = abs(fract(lattice + 0.5) - 0.5);
  float filament = 1.0 - smoothstep(0.0, max(0.001, fwidth(lattice) * 0.85), distance);
  colour += mix(grazing, edge, facing * 0.6) * filament * 0.10 * smoothstep(0.08, 0.5, vLevel);
  colour += edge * (rim * 0.48 + shine * 1.5) * smoothstep(0.04, 0.7, vLevel);
  float ends = smoothstep(0.0, 0.035, vUv.x) * smoothstep(0.0, 0.035, 1.0 - vUv.x);
  float energy = smoothstep(0.025, 0.62, vLevel);
  float alpha = strength * energy * ends * mix(1.0, 0.65, vUv.y);
  gl_FragColor = vec4(colour * alpha, 1.0);
}
`
const GRID_VERTEX = /* glsl */ `
attribute vec2 aA;
attribute vec2 aB;
attribute float aEnd;
attribute float aSide;
uniform float halfWidth;
varying float vAcross;
varying float vDepth;
${PROJECT}
void main() {
  vec2 pa = projectPx(aA.x, aA.y, 0.0);
  vec2 pb = projectPx(aB.x, aB.y, 0.0);
  vec2 dir = normalize(pb - pa);
  vec2 normal = vec2(-dir.y, dir.x);
  float depth = mix(aA.y, aB.y, aEnd);
  gl_Position = clipOf(mix(pa, pb, aEnd) + normal * aSide * halfWidth, depth + 0.004);
  vAcross = aSide * halfWidth;
  vDepth = depth;
}
`
const GRID_FRAGMENT = /* glsl */ `
uniform vec3 colour;
uniform float soft;
uniform float strength;
varying float vAcross;
varying float vDepth;
void main() {
  float line = 1.0 - smoothstep(0.5 - soft * 0.5, 0.5 + soft * 0.5, abs(vAcross));
  gl_FragColor = vec4(colour * line * strength * mix(1.0, 0.3, vDepth), 1.0);
}
`
const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
/* A low light under the relief, and a grain of dither so an 8-bit gradient never bands. */
const BACKDROP_FRAGMENT = /* glsl */ `
uniform vec3 edge;
uniform vec3 centre;
uniform vec2 resolution;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 q = (vUv - vec2(0.52, 0.32)) * vec2(resolution.x / max(resolution.y, 1.0) * 0.55, 1.0);
  vec3 colour = mix(centre, edge, smoothstep(0.05, 0.95, length(q)));
  colour += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(colour, 1.0);
}
`

function reliefGeometry(rows: number, columns: number): THREE.BufferGeometry {
  const count = rows * columns * 2
  const t = new Float32Array(count), row = new Float32Array(count), side = new Float32Array(count)
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      for (const s of [-1, 1]) { t[i] = c / (columns - 1); row[i] = rows > 1 ? r / (rows - 1) : 0; side[i] = s; i++ }
    }
  }
  const index = new (count > 65535 ? Uint32Array : Uint16Array)(rows * (columns - 1) * 6)
  let k = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = (r * columns + c) * 2
      index[k++] = a; index[k++] = a + 1; index[k++] = a + 2
      index[k++] = a + 1; index[k++] = a + 3; index[k++] = a + 2
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('aT', new THREE.BufferAttribute(t, 1))
  geometry.setAttribute('aRow', new THREE.BufferAttribute(row, 1))
  geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  return geometry
}

/** The surface under the lines, as triangles between neighbouring rows. */
function surfaceGeometry(rows: number, columns: number): THREE.BufferGeometry {
  const count = rows * columns
  const t = new Float32Array(count), row = new Float32Array(count)
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) { t[r * columns + c] = c / (columns - 1); row[r * columns + c] = rows > 1 ? r / (rows - 1) : 0 }
  const index = new (count > 65535 ? Uint32Array : Uint16Array)((rows - 1) * (columns - 1) * 6)
  let k = 0
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = r * columns + c, b = a + 1, d = a + columns, e = d + 1
      index[k++] = a; index[k++] = b; index[k++] = d; index[k++] = b; index[k++] = e; index[k++] = d
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('aT', new THREE.BufferAttribute(t, 1))
  geometry.setAttribute('aRow', new THREE.BufferAttribute(row, 1))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  return geometry
}

/** The floor: lines across time at a few depths, and lines into the depth at even times. */
function floorGeometry(across: number, deep: number): THREE.BufferGeometry {
  const segments: [number, number, number, number][] = []
  // The floor stays open at the back and right instead of fencing the relief with a frame.
  for (let i = 0; i < across; i++) segments.push([i / across, 0, i / across, 1])
  for (let j = 1; j < deep; j++) segments.push([0, j / deep, 1, j / deep])
  const n = segments.length * 4
  const a = new Float32Array(n * 2), b = new Float32Array(n * 2), end = new Float32Array(n), side = new Float32Array(n)
  const index: number[] = []
  segments.forEach(([ta, va, tb, vb], s) => {
    for (let q = 0; q < 4; q++) {
      const at = s * 4 + q
      a[at * 2] = ta; a[at * 2 + 1] = va; b[at * 2] = tb; b[at * 2 + 1] = vb
      end[at] = q >> 1; side[at] = q & 1 ? 1 : -1
    }
    const o = s * 4
    index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  geometry.setAttribute('aA', new THREE.BufferAttribute(a, 2))
  geometry.setAttribute('aB', new THREE.BufferAttribute(b, 2))
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(end, 1))
  geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1))
  geometry.setIndex(index)
  return geometry
}

/** Half floats: an 8-bit height steps visibly on a slow slope three hundred pixels tall. */
function makeTexture(columns: number, rows: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint16Array(columns * rows), columns, rows, THREE.RedFormat, THREE.HalfFloatType)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

/** The glow over the frame, when the renderer can afford it; the plain frame otherwise. */
function useComposer() {
  const { gl, scene, camera, size, viewport, invalidate } = useThree()
  const composer = useRef<EffectComposer | null>(null)
  useEffect(() => {
    let made: EffectComposer | null = null
    try {
      made = new EffectComposer(gl, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }))
      made.addPass(new RenderPass(scene, camera))
      made.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold))
      made.addPass(new OutputPass())
    } catch { made = null }
    composer.current = made
    invalidate()
    return () => {
      if (!made) return
      made.passes.forEach((pass) => pass.dispose())
      made.dispose()
      if (composer.current === made) composer.current = null
    }
  }, [gl, scene, camera, invalidate])
  useEffect(() => {
    const made = composer.current
    if (!made) return
    made.setPixelRatio(viewport.dpr)
    made.setSize(size.width, size.height)
    invalidate()
  }, [size.width, size.height, viewport.dpr, invalidate])
  useFrame((_, delta) => {
    const made = composer.current
    if (made) made.render(delta)
    else gl.render(scene, camera)
  }, 1)
}

function Scene({ spectrum, view, playing, marks, live }: {
  spectrum: LabSpectrum | null
  view: ReliefView
  playing: LabPlaying | null
  /** The sound's controls, each lit on the part of the relief that belongs to it. */
  marks: MarkUniform[]
  /** A hand is moving a control: the relief follows it rather than easing into place. */
  live: boolean
}) {
  const { size, viewport, invalidate } = useThree()
  const layout = useMemo(() => reliefLayout(size.width, size.height, view), [size.width, size.height, view])
  const columns = spectrum?.columns ?? SPECTRUM_COLUMNS
  const rows = spectrum?.rows ?? SPECTRUM_ROWS
  // Preserve the measured surface on a phone, but separate its visible filaments in screen space.
  const traceRows = size.width < 560 ? Math.min(48, rows) : rows
  const relief = useMemo(() => reliefGeometry(traceRows, columns), [traceRows, columns])
  const surface = useMemo(() => surfaceGeometry(rows, columns), [rows, columns])
  const floor = useMemo(() => floorGeometry(20, 9), [])
  const backdrop = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    return geometry
  }, [])
  useEffect(() => () => { relief.dispose(); surface.dispose() }, [relief, surface])
  useEffect(() => () => { floor.dispose(); backdrop.dispose() }, [floor, backdrop])
  const textures = useMemo(() => ({ prev: makeTexture(columns, rows), next: makeTexture(columns, rows) }), [columns, rows])
  useEffect(() => () => { textures.prev.dispose(); textures.next.dispose() }, [textures])

  const shared = useMemo(() => ({
    resolution: { value: new THREE.Vector2(1, 1) },
    frame: { value: new THREE.Vector4(0, 1, 1, 0) },
    shift: { value: new THREE.Vector3() },
  }), [])
  const materials = useMemo(() => {
    const additive = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation } as const
    const data = { prev: { value: null as THREE.Texture | null }, next: { value: null as THREE.Texture | null }, morph: { value: 1 }, grid: { value: new THREE.Vector2(SPECTRUM_COLUMNS, SPECTRUM_ROWS) }, gamma: { value: RELIEF_GAMMA } }
    const lineUniforms = (xray: number) => ({
      ...shared, ...data, xray: { value: xray }, lift: { value: 1.5 / (SPECTRUM_ROWS - 1) },
      halfWidth: { value: LINE.core + LINE.halo * 3 }, core: { value: LINE.core }, soft: { value: 1 }, halo: { value: LINE.halo },
      haloGain: { value: LINE.haloGain }, gain: { value: LINE.gain }, head: { value: -1 },
      marks: { value: Array.from({ length: 4 }, () => new THREE.Vector4(-1, -1, -1, 0)) },
      bands: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
      low: { value: new THREE.Color(SCREEN.low) }, mid: { value: new THREE.Color(SCREEN.mid) },
      high: { value: new THREE.Color(SCREEN.high) }, hot: { value: new THREE.Color(SCREEN.hot) },
    })
    const visible = lineUniforms(1)
    // The hidden parts share every value with the visible ones but their strength.
    const hidden = { ...visible, xray: { value: LINE.xray } }
    return {
      data,
      relief: new THREE.ShaderMaterial({ vertexShader: RELIEF_VERTEX, fragmentShader: RELIEF_FRAGMENT, ...additive, depthTest: true, depthFunc: THREE.LessEqualDepth, uniforms: visible }),
      xray: new THREE.ShaderMaterial({ vertexShader: RELIEF_VERTEX, fragmentShader: RELIEF_FRAGMENT, ...additive, depthTest: true, depthFunc: THREE.GreaterDepth, uniforms: hidden }),
      occluder: new THREE.ShaderMaterial({ vertexShader: OCCLUDER_VERTEX, fragmentShader: OCCLUDER_FRAGMENT, colorWrite: false, depthWrite: true, depthTest: true, depthFunc: THREE.LessEqualDepth, uniforms: { ...shared, ...data } }),
      glass: new THREE.ShaderMaterial({
        vertexShader: GLASS_VERTEX, fragmentShader: GLASS_FRAGMENT, ...additive, depthTest: true, depthFunc: THREE.LessEqualDepth,
        uniforms: { ...shared, ...data, body: { value: new THREE.Color(GLASS.body) }, edge: { value: new THREE.Color(GLASS.edge) }, grazing: { value: new THREE.Color(GLASS.grazing) }, strength: { value: GLASS.strength } },
      }),
      floor: new THREE.ShaderMaterial({
        vertexShader: GRID_VERTEX, fragmentShader: GRID_FRAGMENT, ...additive, depthTest: true, depthFunc: THREE.LessEqualDepth,
        uniforms: { ...shared, halfWidth: { value: 1.5 }, soft: { value: 1 }, strength: { value: 0.22 }, colour: { value: new THREE.Color(SCREEN.grid) } },
      }),
      backdrop: new THREE.ShaderMaterial({
        vertexShader: BACKDROP_VERTEX, fragmentShader: BACKDROP_FRAGMENT, depthTest: false, depthWrite: false,
        uniforms: { resolution: shared.resolution, edge: { value: new THREE.Color(SCREEN.edge) }, centre: { value: new THREE.Color(SCREEN.centre) } },
      }),
    }
  }, [shared])
  useEffect(() => () => { materials.relief.dispose(); materials.xray.dispose(); materials.occluder.dispose(); materials.glass.dispose(); materials.floor.dispose(); materials.backdrop.dispose() }, [materials])

  useEffect(() => {
    materials.data.prev.value = textures.prev
    materials.data.next.value = textures.next
    materials.data.grid.value.set(columns, rows)
    materials.relief.uniforms.lift!.value = 1.5 / Math.max(1, rows - 1)
    invalidate()
  }, [materials, textures, columns, rows, invalidate])
  useEffect(() => {
    const uniforms = materials.relief.uniforms
    for (let i = 0; i < 4; i++) {
      const mark = marks[i]
      uniforms.marks!.value[i]!.set(mark?.row ?? -1, mark?.time ?? -1, mark?.level ?? -1, uniforms.marks!.value[i]!.w)
      uniforms.bands!.value[i]!.set(mark?.rowBand ?? 0, mark?.timeBand ?? 0, mark?.levelBand ?? 0, 0)
    }
    invalidate()
  }, [materials, marks, invalidate])
  useEffect(() => {
    shared.resolution.value.set(Math.max(1, layout.w), Math.max(1, layout.h))
    shared.frame.value.set(layout.x0, layout.x1, layout.y0, layout.height)
    shared.shift.value.set(layout.perspective, layout.shiftY, 0)
    // The same rows overlap more in a small view. Reduce emitted light, preserving every bin.
    materials.relief.uniforms.gain!.value = LINE.gain * (layout.w < 560 ? 0.72 : 1)
    materials.glass.uniforms.strength!.value = GLASS.strength * (layout.w < 560 ? 0.75 : 1)
    invalidate()
  }, [layout, shared, materials, invalidate])
  useEffect(() => {
    // One device pixel of antialiasing, whatever the screen.
    materials.relief.uniforms.soft!.value = 1 / viewport.dpr
    materials.floor.uniforms.soft!.value = 1 / viewport.dpr
    invalidate()
  }, [materials, viewport.dpr, invalidate])

  const shown = useRef<{ spectrum: LabSpectrum | null; textures: typeof textures } | null>(null)
  const morphStart = useRef(-1)
  useEffect(() => {
    if (shown.current && spectrum === shown.current.spectrum && textures === shown.current.textures) return
    if (spectrum && (spectrum.columns !== columns || spectrum.rows !== rows)) return
    const uniforms = materials.data
    const before = textures.prev.image.data as Uint16Array
    const after = textures.next.image.data as Uint16Array
    // The picture on screen, mid-morph or not, is where the next one starts from.
    const at = uniforms.morph.value
    if (at >= 1) before.set(after)
    else for (let i = 0; i < before.length; i++) {
      const from = THREE.DataUtils.fromHalfFloat(before[i]!), to = THREE.DataUtils.fromHalfFloat(after[i]!)
      before[i] = THREE.DataUtils.toHalfFloat(from + (to - from) * at)
    }
    if (spectrum) for (let i = 0; i < after.length; i++) after[i] = THREE.DataUtils.toHalfFloat(spectrum.values[i] ?? 0)
    else after.fill(0)
    textures.prev.needsUpdate = true
    textures.next.needsUpdate = true
    const still = reducedMotion()
    uniforms.morph.value = still ? 1 : 0
    morphStart.current = still ? -1 : performance.now()
    shown.current = { spectrum, textures }
    invalidate(2)
  }, [spectrum, textures, materials, columns, rows, invalidate])
  useEffect(() => { invalidate() }, [playing, view, invalidate])

  useComposer()
  const litNow = useRef([0, 0, 0, 0])
  const lastFrame = useRef(performance.now())
  useFrame(() => {
    const uniforms = materials.relief.uniforms
    let again = false
    const now = performance.now()
    const delta = Math.min(0.1, (now - lastFrame.current) / 1000)
    lastFrame.current = now
    if (morphStart.current >= 0) {
      // While a hand moves a control the relief is rendered again and again: it follows the hand
      // instead of easing, so the waves change as the control does.
      const t = Math.min(1, (now - morphStart.current) / (live ? 110 : MORPH_MS))
      materials.data.morph.value = 1 - Math.pow(1 - t, 3)
      if (t < 1) again = true
      else morphStart.current = -1
    }
    for (let i = 0; i < 4; i++) {
      const want = marks[i]?.lit ?? 0
      const held = litNow.current[i]!
      if (Math.abs(want - held) > 0.002) { litNow.current[i] = held + (want - held) * (1 - Math.exp(-delta / 0.09)); again = true } else litNow.current[i] = want
      uniforms.marks!.value[i]!.w = litNow.current[i]!
    }
    let head = -1
    const context = audioContext()
    if (playing && context) {
      const at = (context.currentTime - playing.startedAt) / Math.max(0.001, playing.duration)
      if (at >= 0 && at <= 1) head = at
      if (at <= 1.05) again = true
    }
    uniforms.head!.value = head
    if (again) invalidate()
  })

  const lines = view !== 'waveform'
  return (
    <>
      <mesh geometry={backdrop} material={materials.backdrop} frustumCulled={false} renderOrder={0} />
      <mesh geometry={surface} material={materials.occluder} frustumCulled={false} renderOrder={1} visible={lines} />
      <mesh geometry={floor} material={materials.floor} frustumCulled={false} renderOrder={2} visible={lines} />
      <mesh geometry={surface} material={materials.glass} frustumCulled={false} renderOrder={2.5} visible={lines && !!spectrum} />
      <mesh geometry={relief} material={materials.relief} frustumCulled={false} renderOrder={3} visible={lines} />
      <mesh geometry={relief} material={materials.xray} frustumCulled={false} renderOrder={4} visible={lines} />
    </>
  )
}

/** Where WebGL is missing or has been taken away: the same rows, drawn flat by the 2D canvas. */
function FlatRelief({ spectrum, layout }: { spectrum: LabSpectrum | null; layout: ReliefLayout }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context || typeof context.beginPath !== 'function') return
    const ratio = window.devicePixelRatio || 1
    element.width = Math.round(layout.w * ratio); element.height = Math.round(layout.h * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.fillStyle = SCREEN.edge
    context.fillRect(0, 0, layout.w, layout.h)
    if (!spectrum || layout.height <= 0) return
    context.globalCompositeOperation = 'lighter'
    context.lineWidth = 1
    for (let r = spectrum.rows - 1; r >= 0; r--) {
      const v = r / Math.max(1, spectrum.rows - 1)
      context.strokeStyle = `rgba(44, 205, 192, ${(0.55 - v * 0.35).toFixed(3)})`
      context.beginPath()
      for (let c = 0; c < spectrum.columns; c++) {
        const p = projectRelief(layout, c / (spectrum.columns - 1), v, Math.pow(spectrum.values[r * spectrum.columns + c] ?? 0, RELIEF_GAMMA))
        if (c) context.lineTo(p.x, p.y); else context.moveTo(p.x, p.y)
      }
      context.stroke()
    }
  }, [spectrum, layout])
  return <canvas ref={canvas} className="labs-relief__flat" aria-hidden="true" />
}

function useBox(host: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const read = () => {
      const rect = element.getBoundingClientRect()
      const next = { w: Math.round(rect.width), h: Math.round(rect.height) }
      setBox((held) => (held.w === next.w && held.h === next.h ? held : next))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [host])
  return box
}

/**
 * Where the voice is, shown by light alone. On the relief the lines it crosses light up in the
 * shader; on the waveform, which has no lines to carry it, a band of light runs along the wave.
 * It follows the voice by hand, sixty times a second, without asking React.
 */
function usePlayhead(playing: LabPlaying | null, head: RefObject<SVGGraphicsElement | null>, layout: ReliefLayout) {
  useEffect(() => {
    const element = head.current
    if (!element) return
    if (!playing) { element.setAttribute('visibility', 'hidden'); return }
    let frame = 0
    const step = () => {
      const context = audioContext()
      const at = context ? (context.currentTime - playing.startedAt) / Math.max(0.001, playing.duration) : -1
      if (at >= 0 && at <= 1) {
        element.setAttribute('transform', `translate(${(layout.x0 + (layout.x1 - layout.x0) * at).toFixed(2)} 0)`)
        element.setAttribute('visibility', 'visible')
      } else element.setAttribute('visibility', 'hidden')
      if (at <= 1.05) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(frame); element.setAttribute('visibility', 'hidden') }
  }, [playing, head, layout])
}

function wavePath(wave: Float32Array, layout: ReliefLayout): string {
  if (!layout.wave) return ''
  const columns = wave.length / 2
  const mid = (layout.wave.top + layout.wave.bottom) / 2, half = (layout.wave.bottom - layout.wave.top) / 2
  const x = (c: number) => (layout.x0 + (layout.x1 - layout.x0) * c / Math.max(1, columns - 1)).toFixed(1)
  const top: string[] = [], bottom: string[] = []
  for (let c = 0; c < columns; c++) {
    top.push(`${x(c)} ${(mid - (wave[c * 2 + 1] ?? 0) * half).toFixed(1)}`)
    bottom.push(`${x(c)} ${(mid - (wave[c * 2] ?? 0) * half).toFixed(1)}`)
  }
  return `M${top.join('L')}L${bottom.reverse().join('L')}Z`
}

/** The scales belong to the volume: its front rim, left receding edge and front-right post. */
function Axes({ layout, spectrum, durationMs, view }: { layout: ReliefLayout; spectrum: LabSpectrum | null; durationMs: number; view: ReliefView }) {
  const relief = view !== 'waveform'
  const range = spectrum ?? { minHz: SPECTRUM_MIN_HZ, maxHz: 20000 }
  const frequencies = frequencyTicks(layout.shiftY, (hz) => projectedDepth(layout, spectrumPosition(hz, range)))
  const span = layout.x1 - layout.x0
  const ticks = timeTicks(durationMs).filter((ms, i, all) => {
    if (i === 0 || i === all.length - 1) return true
    const x = span * ms / durationMs
    return x >= 48 && span - x >= 70 && (span >= 320 || i % 2 === 0)
  })
  const point = (t: number, depth: number, level = 0) => projectRelief(layout, t, depth, level)
  const path = (points: { x: number; y: number }[]) => `M${points.map((p) => `${p.x},${p.y}`).join('L')}`
  const frontLeft = point(0, 0), frontRight = point(1, 0), backLeft = point(0, 1)
  const levels = levelTicks(layout.height).filter((db) => point(1, 0, heightOf(db)).y > SWITCH_BOTTOM + 14)
  return (
    <g className="labs-relief__axes">
      {relief ? <>
        <path className="labs-axis__rim" d={path([frontLeft, backLeft])} />
        {ticks.slice(1, -1).map((ms) => <path key={ms} className="labs-axis__guide" d={path([point(ms / durationMs, 0), point(ms / durationMs, 1)])} />)}
      </> : null}
      {relief && layout.axes.frequency ? <g>
        {frequencies.map((hz) => {
          const depth = spectrumPosition(hz, range)
          const p = point(0, depth), inside = point(0.012, depth)
          return <g key={hz}>
            <path className="labs-axis__tick" d={path([p, inside])} />
            <text className="labs-axis__label" x={p.x - 8} y={p.y} textAnchor="end" dominantBaseline="central">{frequencyLabel(hz)}</text>
          </g>
        })}
      </g> : null}
      {ticks.length ? <g>
        <path className="labs-axis__rule" d={path([frontLeft, frontRight])} />
        {ticks.map((ms, i) => {
          const t = ms / durationMs
          // Tick lengths and label padding are visual distances, independent of frequency focus.
          const p = point(t, 0), inside = point(t, relief ? unprojectedDepth(layout, 0.036) : 0)
          const label = point(t, relief ? unprojectedDepth(layout, 0.096) : 0)
          return <g key={`${ms}-${i}`}>
            <path className="labs-axis__tick" d={path([p, relief ? inside : { x: p.x, y: p.y + 4 }])} />
            <text className="labs-axis__label" x={label.x} y={relief ? label.y : label.y + 18} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'} dominantBaseline="central">{i === ticks.length - 1 ? `${ms} ms` : ms}</text>
          </g>
        })}
      </g> : null}
      {relief && layout.axes.level && levels.length > 1 ? <g>
        {levels.map((db, i) => {
          const p = point(1, 0, heightOf(db))
          return <g key={db}>
            <path className="labs-axis__tick" d={path([p, { x: p.x - 5, y: p.y }])} />
            <text className="labs-axis__label" x={p.x + 8} y={p.y} dominantBaseline="central">{db}{i === 0 ? <tspan x={p.x + 8} dy={-15}>dB rel.</tspan> : null}</text>
          </g>
        })}
      </g> : null}
    </g>
  )
}

/**
 * The sound as a landscape of light: one line per frequency band, time running across, the
 * higher bands further back, level standing up. Built from the rendered samples, so what stands
 * up is what is heard. The block is the canvas, edge to edge; the axes, the playhead and the
 * view switch are drawn over it, and the camera never moves.
 */
export const Relief = memo(function Relief({ render, playing, loading, view, onView, durationMs, empty, name, sound, grips }: {
  render: LabRender | null
  playing: LabPlaying | null
  loading: boolean
  view: ReliefView
  onView: (view: ReliefView) => void
  durationMs: number
  empty: boolean
  name: string
  /** The sound on the bench: while it is being rendered again after a change, its picture stays. */
  sound?: LabSound | null
  /** What a hand on the marks does to it, when the bench offers them. */
  grips?: GripHandlers | null
}) {
  // While a mark is held the sound is rendered again where the hand rests; the relief says so by
  // changing, not with a notice.
  const [gripHeld, setGripHeld] = useState<MarkKind | null>(null)
  const [lit, setLit] = useState<MarkLit>({})
  // The moment Motion's stem stands on is measured, and a gesture keeps the one it began with.
  const frozen = useRef<BusiestMoment | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const head = useRef<SVGRectElement>(null)
  const box = useBox(host)
  const id = useId().replace(/:/g, '')
  const layout = useMemo(() => reliefLayout(box.w, box.h, view), [box.w, box.h, view])
  const [lost, setLost] = useState(false)
  const gl = supportsWebGL()
  // While the next sound renders, the last one stays up rather than collapsing to the floor.
  const [held, setHeld] = useState<LabRender | null>(null)
  useEffect(() => { if (render) setHeld(render) }, [render])
  // Taking a kept sound creates an editable copy. Keep its picture and pointer field mounted
  // across that handoff, then throughout the gesture while its new audio is being measured.
  const shown = render ?? (held && (loading || gripHeld || held.sound.id === sound?.id || held.sound.fingerprint === sound?.fingerprint) ? held : null)
  const spectrum = shown?.spectrum ?? null
  const wave = useMemo(() => (shown && layout.wave ? wavePath(shown.wave, layout) : ''), [shown, layout])
  usePlayhead(playing, head, layout)
  const band = Math.round(Math.min(44, Math.max(18, (layout.x1 - layout.x0) * 0.035)))
  const ready = box.w > 0 && box.h > 0
  // Each control is measured on the picture that is up, so the marks ride the waves as they change.
  const measured = useMemo(() => (sound && spectrum && view !== 'waveform' ? reliefMarks(sound, spectrum, durationMs, frozen.current) : null), [sound, spectrum, view, durationMs])
  useEffect(() => { frozen.current = gripHeld ? frozen.current ?? measured?.busiest ?? null : null }, [gripHeld, measured])
  const marks = useMemo(() => measured?.marks ?? [], [measured])
  const uniforms = useMemo(() => (spectrum ? marks.map((mark) => markUniform(mark, lit[mark.kind] ?? 0, spectrum)) : []), [marks, lit, spectrum])

  return (
    <div ref={host} className="labs-relief" data-view={view} data-loading={(loading && !gripHeld) || undefined} data-empty={empty || undefined}>
      <div className="labs-relief__gl" role="img" aria-label={empty ? 'No sound on the bench yet' : `${name}: spectral relief`}>
        {gl ? (
          <Canvas frameloop="demand" dpr={[1, 2]} flat gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false }}
            onCreated={({ gl: renderer }) => {
              renderer.setClearColor(0x000000, 1)
              // A context taken away while the canvas is on the page is a real loss; the one three
              // forces when the canvas is unmounted is not.
              renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); if (renderer.domElement.isConnected) setLost(true) })
              renderer.domElement.addEventListener('webglcontextrestored', () => setLost(false))
            }}>
            <Scene spectrum={spectrum} view={view} playing={playing} marks={uniforms} live={!!gripHeld} />
          </Canvas>
        ) : null}
        {(!gl || lost) && ready ? <FlatRelief spectrum={view === 'waveform' ? null : spectrum} layout={layout} /> : null}
      </div>
      {ready ? (
        <svg className="labs-relief__overlay" width={layout.w} height={layout.h} viewBox={`0 0 ${layout.w} ${layout.h}`} aria-hidden="true">
          {shown ? <Axes layout={layout} spectrum={spectrum} durationMs={durationMs} view={view} /> : null}
          {wave && layout.wave ? (
            <>
              <defs>
                <linearGradient id={`${id}-sweep`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="0.5" stopColor="#fff" stopOpacity="1" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
                <mask id={`${id}-lit`} maskUnits="userSpaceOnUse" x="0" y="0" width={layout.w} height={layout.h}>
                  <rect ref={head} className="labs-relief__sweep" x={-band / 2} width={band} y={layout.wave.top - 6} height={layout.wave.bottom - layout.wave.top + 12} fill={`url(#${id}-sweep)`} visibility="hidden" />
                </mask>
              </defs>
              <g className="labs-relief__wave"><line x1={layout.x0} x2={layout.x1} y1={(layout.wave.top + layout.wave.bottom) / 2} y2={(layout.wave.top + layout.wave.bottom) / 2} /><path d={wave} /></g>
              <path className="labs-relief__wave-lit" d={wave} mask={`url(#${id}-lit)`} />
            </>
          ) : null}
        </svg>
      ) : null}
      {grips && spectrum && ready && marks.length ? <ReliefGrips spectrum={spectrum} layout={layout} marks={marks} handlers={grips} drawn={gl && !lost} onHeld={setGripHeld} onLit={setLit} /> : null}
      <div className="labs-views" role="radiogroup" aria-label="Relief view">
        {RELIEF_VIEWS.map((entry) => (
          <label key={entry} className="labs-views__opt" data-checked={view === entry || undefined}>
            <input type="radio" name="labs-relief-view" value={entry} checked={view === entry} onChange={() => onView(entry)} />
            <span>{entry}</span>
          </label>
        ))}
      </div>
      {empty ? <p className="labs-relief__empty">Generate a sound to see its relief.</p> : null}
      {loading && !gripHeld ? <p className="labs-relief__loading">Rendering…</p> : null}
    </div>
  )
})
