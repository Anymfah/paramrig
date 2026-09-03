import {
  Color,
  DoubleSide,
  Mesh,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Uniform,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three'

/**
 * The outline around what is selected.
 *
 * Drawing a selected object's own wireframe on top of it does not read: on a dense mesh it is a
 * grey haze, and on a smooth one it disappears against the shading. Blender draws a silhouette
 * instead, and so does this: the selected objects are rendered flat into a small buffer, then a
 * full-screen pass draws a band wherever that buffer changes value. The result is one clean line
 * around the outside of the selection whatever the mesh is made of, and it survives a screenshot,
 * which is the test the plan sets.
 *
 * Three states share one buffer, told apart by the value written: hovered, selected, active.
 */

export const OUTLINE_HOVER = 1 / 255
export const OUTLINE_SELECTED = 2 / 255
export const OUTLINE_ACTIVE = 3 / 255

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uMask;
  uniform vec2 uTexel;
  uniform vec3 uHover;
  uniform vec3 uSelected;
  uniform vec3 uActive;
  uniform float uWidth;

  float maskAt(vec2 uv) {
    return texture2D(uMask, uv).r;
  }

  void main() {
    float centre = maskAt(vUv);
    // The band is drawn outside the silhouette, never over it: an outline that ate into the object
    // would hide the very edge a modeller is looking at.
    if (centre > 0.0) discard;
    float found = 0.0;
    for (int index = 0; index < 8; index++) {
      float angle = float(index) * 0.7853981634;
      vec2 offset = vec2(cos(angle), sin(angle)) * uTexel * uWidth;
      found = max(found, maskAt(vUv + offset));
    }
    if (found <= 0.0) discard;
    vec3 colour = uHover;
    if (found > 2.5 / 255.0) colour = uActive;
    else if (found > 1.5 / 255.0) colour = uSelected;
    gl_FragColor = vec4(colour, 1.0);
  }
`

export type OutlinePass = {
  /** Objects to draw into the mask, each with a flat material carrying its state value. */
  scene: Scene
  render: (renderer: WebGLRenderer, camera: Camera) => void
  draw: (renderer: WebGLRenderer) => void
  setSize: (width: number, height: number) => void
  setColours: (colours: { hover: string; selected: string; active: string }) => void
  setWidth: (pixels: number) => void
  dispose: () => void
}

export function createOutlinePass(): OutlinePass {
  const scene = new Scene()
  scene.name = 'outline-mask'
  const target = new WebGLRenderTarget(1, 1, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  })
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uMask: new Uniform(target.texture),
      uTexel: new Uniform([1, 1]),
      uHover: new Uniform(new Color('#ffffff')),
      uSelected: new Uniform(new Color('#f0a02e')),
      uActive: new Uniform(new Color('#ffce6a')),
      uWidth: new Uniform(1),
    },
  })
  const quad = new Mesh(new PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  const quadScene = new Scene()
  quadScene.add(quad)
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  return {
    scene,
    render: (renderer, camera) => {
      const previous = renderer.getRenderTarget()
      const clear = renderer.getClearColor(new Color()).getHex()
      const alpha = renderer.getClearAlpha()
      renderer.setRenderTarget(target)
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, true, false)
      renderer.render(scene, camera)
      renderer.setRenderTarget(previous)
      renderer.setClearColor(clear, alpha)
    },
    draw: (renderer) => {
      if (scene.children.length === 0) return
      const autoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.render(quadScene, quadCamera)
      renderer.autoClear = autoClear
    },
    setSize: (width, height) => {
      const w = Math.max(1, Math.floor(width))
      const h = Math.max(1, Math.floor(height))
      target.setSize(w, h)
      material.uniforms.uTexel!.value = [1 / w, 1 / h]
    },
    setColours: (colours) => {
      ;(material.uniforms.uHover!.value as Color).set(colours.hover)
      ;(material.uniforms.uSelected!.value as Color).set(colours.selected)
      ;(material.uniforms.uActive!.value as Color).set(colours.active)
    },
    setWidth: (pixels) => {
      material.uniforms.uWidth!.value = Math.max(0.75, pixels)
    },
    dispose: () => {
      target.dispose()
      material.dispose()
      quad.geometry.dispose()
      scene.clear()
      quadScene.clear()
    },
  }
}

/** The flat material a selected object is drawn into the mask with. */
export function createMaskMaterial(state: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uState; void main() { gl_FragColor = vec4(uState, 0.0, 0.0, 1.0); }`,
    uniforms: { uState: new Uniform(state) },
    blending: NoBlending,
    side: DoubleSide,
  })
}
