import {
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  MeshStandardMaterial,
  ShaderMaterial,
  type Material,
} from 'three'

/**
 * How a mesh is lit in "solid" shading.
 *
 * Blender's solid mode does not light the scene with the scene's own lights: it lights it with a
 * small rig fixed to the camera, so an object is legible while it is being built, whatever the
 * lighting is meant to become. Three lights, one strong from the upper left, one fill from the
 * right, one rim from behind — enough to read a form without pretending to be a render.
 */

export type StudioLights = { group: Group; dispose: () => void }

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

export function disposeMaterial(material: Material | Material[] | null | undefined): void {
  if (!material) return
  for (const entry of Array.isArray(material) ? material : [material]) entry.dispose()
}
