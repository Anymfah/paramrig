import {
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  LinearFilter,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  MeshStandardMaterial,
  RGBAFormat,
  ShaderMaterial,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three'
import { matcapPixels, type MatcapName } from '@/scene/viewport/matcap'

/**
 * How a mesh is lit in "solid" shading.
 *
 * Blender's solid mode does not light the scene with the scene's own lights: it lights it with a
 * small rig fixed to the camera, so an object is legible while it is being built, whatever the
 * lighting is meant to become. Three lights, one strong from the upper left, one fill from the
 * right, one rim from behind — enough to read a form without pretending to be a render.
 */

export type StudioLights = {
  group: Group
  /** Off in rendered shading, where the scene's own lamps are what is being looked at. */
  setEnabled: (enabled: boolean) => void
  dispose: () => void
}

export function createStudioLights(): StudioLights {
  const group = new Group()
  group.name = 'studio'
  const key = new DirectionalLight(0xffffff, 2.1)
  key.position.set(-0.4, 0.5, 1)
  const fill = new DirectionalLight(0xffffff, 0.75)
  fill.position.set(0.9, -0.2, 0.35)
  const rim = new DirectionalLight(0xffffff, 0.5)
  rim.position.set(0.1, -0.9, -0.6)
  group.add(key, fill, rim)
  return {
    group,
    setEnabled: (enabled) => {
      group.visible = enabled
    },
    dispose: () => {
      for (const light of [key, fill, rim]) light.dispose()
      group.clear()
    },
  }
}

/** The grey Blender shows an object in until it is given a material. */
export const SOLID_BASE_COLOUR = 0xb4b4b4

export function createSolidMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(SOLID_BASE_COLOUR),
    roughness: 0.62,
    metalness: 0,
    flatShading: false,
  })
}

/**
 * Face orientation: blue where a face turns towards the viewer, red where it turns away.
 *
 * It is the only way to see a mesh that has been turned inside out, and a mesh that has been turned
 * inside out is the commonest reason a boolean or a solidify comes out wrong. `gl_FrontFacing` is
 * the whole of it — the winding is what the graphics card already knows.
 */
export function createFaceOrientationMaterial(front: string, back: string): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform vec3 uFront;
      uniform vec3 uBack;
      void main() {
        gl_FragColor = vec4(gl_FrontFacing ? uFront : uBack, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: DoubleSide,
    uniforms: {
      uFront: { value: new Color(front) },
      uBack: { value: new Color(back) },
    },
  })
}

/**
 * What solid shading is set to, as the material has to know it.
 *
 * Blender's solid mode is not one look but a small stack of decisions — how it is lit, what colour
 * it takes, whether the far side of a surface is drawn, whether creases are darkened — and several
 * of them change *which kind* of material is needed rather than a number on one. So a look is
 * described here, a key says whether two looks need the same material, and the viewport rebuilds
 * only when the key changes.
 */
export type SolidLook = {
  lighting: 'studio' | 'matcap' | 'flat'
  matcap: string
  backfaceCulling: boolean
  cavity: boolean
  cavityStrength: number
  /** Off takes the highlight away, which is what Blender's "specular lighting" switch does. */
  specular: boolean
  /** X-ray makes every surface see-through so that what is behind can be picked and judged. */
  xray: boolean
  xrayAlpha: number
}

export const DEFAULT_SOLID_LOOK: SolidLook = {
  lighting: 'studio',
  matcap: 'basic',
  backfaceCulling: false,
  cavity: false,
  cavityStrength: 0.5,
  specular: true,
  xray: false,
  xrayAlpha: 0.5,
}

/** Two looks with the same key can share a material; a different key needs a new one. */
export function solidLookKey(look: SolidLook): string {
  return [
    look.lighting,
    look.lighting === 'matcap' ? look.matcap : '',
    look.backfaceCulling ? 'cull' : '',
    look.cavity ? `cavity${Math.round(look.cavityStrength * 100)}` : '',
    look.specular ? '' : 'matte',
    look.xray ? `xray${Math.round(look.xrayAlpha * 100)}` : '',
  ].join('|')
}

/** The matcaps, made once each and kept: they are a quarter of a megabyte and never change. */
const matcaps = new Map<string, Texture>()

export function matcapTexture(name: string): Texture {
  const kept = matcaps.get(name)
  if (kept) return kept
  const size = 256
  const texture = new DataTexture(matcapPixels(name as MatcapName, size), size, size, RGBAFormat)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.needsUpdate = true
  matcaps.set(name, texture)
  return texture
}

export function disposeMatcaps(): void {
  for (const texture of matcaps.values()) texture.dispose()
  matcaps.clear()
}

/**
 * The material one object wears in solid shading.
 *
 * Three kinds, because the three ways of lighting it are three different things: a lit surface, a
 * sphere's photograph looked up by the normal, and a flat colour. The colour itself is written by
 * the caller — it is a property of the object rather than of the look.
 */
export function createSolidLook(look: SolidLook): MeshStandardMaterial | MeshMatcapMaterial | MeshBasicMaterial {
  const shared = {
    side: look.backfaceCulling ? FrontSide : DoubleSide,
    transparent: look.xray,
    opacity: look.xray ? Math.min(1, Math.max(0.05, look.xrayAlpha)) : 1,
    depthWrite: !look.xray,
  }
  const material = look.lighting === 'matcap'
    ? new MeshMatcapMaterial({ ...shared, color: new Color(SOLID_BASE_COLOUR), matcap: matcapTexture(look.matcap) })
    : look.lighting === 'flat'
      ? new MeshBasicMaterial({ ...shared, color: new Color(SOLID_BASE_COLOUR) })
      : new MeshStandardMaterial({
        ...shared,
        color: new Color(SOLID_BASE_COLOUR),
        // No highlight is a rough surface, which is the nearest a standard material has to it.
        roughness: look.specular ? 0.62 : 1,
        metalness: 0,
      })
  if (look.cavity) applyCavity(material, look.cavityStrength)
  return material
}

/**
 * Cavity: creases darkened so that a form reads without lighting doing all the work.
 *
 * Blender offers two — a screen-space one from the depth buffer and a curvature one from the
 * geometry. This is the curvature one, and it is a shader patch rather than a pass: the rate at
 * which the surface normal changes across a pixel *is* the curvature, and a graphics card already
 * has it in `fwidth`. That costs one instruction where a screen-space pass costs a full-screen
 * read of depth and normals — and, more to the point here, it cannot flicker while the view turns,
 * because nothing about it depends on the previous frame.
 *
 * It is applied to the lit and matcap materials. A flat colour has no shading to deepen, which is
 * what makes it flat.
 */
function applyCavity(material: MeshStandardMaterial | MeshMatcapMaterial | MeshBasicMaterial, strength: number): void {
  if (material instanceof MeshBasicMaterial) return
  const amount = Math.min(2, Math.max(0, strength))
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCavity = { value: amount }
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uCavity;\nvoid main() {')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          // How fast the normal turns across this pixel: large on a crease, nought on a flat face.
          // Twenty-five is a scale rather than a physical constant: the derivative of a unit normal
          // is a hundredth or so across a crease, and this is what turns that into a shadow a person
          // can see. The cavity strength is measured against it.
          float curvature = length(fwidth(normal)) * 25.0 * uCavity;
          gl_FragColor.rgb *= clamp(1.0 - curvature, 0.25, 1.0);
        }`,
      )
  }
  // The patch is part of what the programme is: without this two materials that differ only in
  // their cavity would share a compiled shader and one of them would be drawn wrong.
  material.customProgramCacheKey = () => `cavity-${amount}`
}

export function disposeMaterial(material: Material | Material[] | null | undefined): void {
  if (!material) return
  for (const entry of Array.isArray(material) ? material : [material]) entry.dispose()
}
