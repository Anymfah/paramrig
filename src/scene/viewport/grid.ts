import { Color, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Uniform } from 'three'
import { splitAlpha } from '@/scene/viewport/theme'

/**
 * The floor.
 *
 * A grid made of line geometry has to end somewhere, and wherever it ends is a visible edge that
 * tells the user the world stops there. This one is a single large quad on the XY plane with the
 * lines drawn in the fragment shader from the world position, which means it has no edge at all:
 * it fades out with distance and with the angle the floor is seen at, the way Blender's does.
 *
 * Two scales are drawn at once, one every unit and one every ten, and each fades in over the range
 * where its lines are far enough apart to be worth drawing — so zooming out never produces the
 * grey mush of a hundred lines a pixel apart.
 */

export type GridOptions = {
  line: string
  major: string
  axisX: string
  axisY: string
  axisZ: string
  showFloor: boolean
  showAxisX: boolean
  showAxisY: boolean
  showAxisZ: boolean
  /** The plane the grid lies on. Blender turns the floor into a side grid in an axis view. */
  plane: 'xy' | 'xz' | 'yz'
}

export type ViewportGrid = {
  mesh: Mesh
  update: (options: Partial<GridOptions>) => void
  setCamera: (position: [number, number, number], distance: number) => void
  dispose: () => void
}

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    // The quad is drawn in the plane the grid lies on, centred on the camera and scaled to cover
    // the far plane, so the shader always has world coordinates to work from.
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform vec3 uLine;
  uniform vec3 uMajor;
  uniform float uLineAlpha;
  uniform float uMajorAlpha;
  uniform vec3 uAxisA;
  uniform vec3 uAxisB;
  uniform vec3 uNormal;
  uniform float uShowAxisA;
  uniform float uShowAxisB;
  uniform float uShowFloor;
  uniform vec3 uCamera;
  uniform float uFade;
  uniform int uPlane;

  /** How close this fragment is to a line of the given spacing, in pixels. */
  float gridLine(vec2 coord, float spacing) {
    vec2 scaled = coord / spacing;
    vec2 derivative = fwidth(scaled);
    vec2 grid = abs(fract(scaled - 0.5) - 0.5) / max(derivative, vec2(1e-6));
    return 1.0 - min(min(grid.x, grid.y), 1.0);
  }

  /** A scale is worth drawing only while its lines are more than a few pixels apart. */
  float scaleWeight(vec2 coord, float spacing) {
    vec2 derivative = fwidth(coord);
    float pixels = spacing / max(max(derivative.x, derivative.y), 1e-6);
    return smoothstep(2.0, 12.0, pixels);
  }

  void main() {
    vec2 coord = uPlane == 0 ? vWorld.xy : (uPlane == 1 ? vWorld.xz : vWorld.yz);
    vec3 toCamera = uCamera - vWorld;
    float distance = length(toCamera);
    float fade = 1.0 - smoothstep(uFade * 0.25, uFade * 0.85, distance);
    // Seen edge on, a grid is a wall of lines; fading it out at a grazing angle is what keeps the
    // horizon clean and stops the floor from reading as fog.
    float grazing = abs(dot(normalize(toCamera), uNormal));
    fade *= smoothstep(0.02, 0.28, grazing);
    if (fade <= 0.002) discard;

    float fine = gridLine(coord, 1.0) * scaleWeight(coord, 1.0);
    float coarse = gridLine(coord, 10.0) * scaleWeight(coord, 10.0);
    float fineAlpha = fine * uLineAlpha;
    float coarseAlpha = coarse * uMajorAlpha;
    float alpha = max(fineAlpha, coarseAlpha) * fade * uShowFloor;
    vec3 colour = coarseAlpha > fineAlpha ? uMajor : uLine;

    // The two axis lines of the plane, drawn on top of the grid in their own colours.
    vec2 axisDistance = abs(coord) / max(fwidth(coord), vec2(1e-6));
    float axisA = (1.0 - min(axisDistance.y, 1.0)) * uShowAxisA;
    float axisB = (1.0 - min(axisDistance.x, 1.0)) * uShowAxisB;
    if (axisA > 0.0 || axisB > 0.0) {
      colour = axisB > axisA ? uAxisB : uAxisA;
      alpha = max(alpha, max(axisA, axisB) * fade * 0.85);
    }

    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(colour, alpha);
    // A hand-written shader writes whatever it is given, and three.js hands over colours in the
    // linear working space. Without this the grid reaches the screen darker and more saturated
    // than the token asked for -- a bug nobody sees until they measure the picture.
    #include <colorspace_fragment>
  }
`

export function createGrid(options: GridOptions): ViewportGrid {
  const geometry = new PlaneGeometry(1, 1)
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uLine: new Uniform(new Color(splitAlpha(options.line).colour)),
      uMajor: new Uniform(new Color(splitAlpha(options.major).colour)),
      uLineAlpha: new Uniform(splitAlpha(options.line).alpha),
      uMajorAlpha: new Uniform(splitAlpha(options.major).alpha),
      uNormal: new Uniform([0, 0, 1]),
      uAxisA: new Uniform(new Color(splitAlpha(options.axisX).colour)),
      uAxisB: new Uniform(new Color(splitAlpha(options.axisY).colour)),
      uShowAxisA: new Uniform(options.showAxisX ? 1 : 0),
      uShowAxisB: new Uniform(options.showAxisY ? 1 : 0),
      uShowFloor: new Uniform(options.showFloor ? 1 : 0),
      uCamera: new Uniform([0, 0, 0]),
      uFade: new Uniform(120),
      uPlane: new Uniform(0),
    },
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'grid'
  mesh.frustumCulled = false
  // Behind everything else in the transparent pass, so an object never picks up the grid's tint.
  mesh.renderOrder = -1000
  let current: GridOptions = { ...options }

  const applyPlane = () => {
    mesh.rotation.set(0, 0, 0)
    if (current.plane === 'xz') mesh.rotation.set(Math.PI / 2, 0, 0)
    if (current.plane === 'yz') mesh.rotation.set(0, Math.PI / 2, 0)
    material.uniforms.uPlane!.value = current.plane === 'xy' ? 0 : current.plane === 'xz' ? 1 : 2
    material.uniforms.uNormal!.value = current.plane === 'xy' ? [0, 0, 1] : current.plane === 'xz' ? [0, 1, 0] : [1, 0, 0]
    const axes: Record<GridOptions['plane'], [string, string, boolean, boolean]> = {
      xy: [current.axisX, current.axisY, current.showAxisX, current.showAxisY],
      xz: [current.axisX, current.axisZ, current.showAxisX, current.showAxisZ],
      yz: [current.axisY, current.axisZ, current.showAxisY, current.showAxisZ],
    }
    const [a, b, showA, showB] = axes[current.plane]
    ;(material.uniforms.uAxisA!.value as Color).set(splitAlpha(a).colour)
    ;(material.uniforms.uAxisB!.value as Color).set(splitAlpha(b).colour)
    // The first axis colour paints the line along it, which is the one at the other coordinate's zero.
    material.uniforms.uShowAxisA!.value = showA ? 1 : 0
    material.uniforms.uShowAxisB!.value = showB ? 1 : 0
  }
  applyPlane()

  return {
    mesh,
    update: (next) => {
      current = { ...current, ...next }
      ;(material.uniforms.uLine!.value as Color).set(splitAlpha(current.line).colour)
      ;(material.uniforms.uMajor!.value as Color).set(splitAlpha(current.major).colour)
      material.uniforms.uLineAlpha!.value = splitAlpha(current.line).alpha
      material.uniforms.uMajorAlpha!.value = splitAlpha(current.major).alpha
      material.uniforms.uShowFloor!.value = current.showFloor ? 1 : 0
      applyPlane()
    },
    setCamera: (position, distance) => {
      // The quad follows the camera and grows with the view, so the grid is never seen to end.
      const reach = Math.max(40, distance * 12)
      if (current.plane === 'xy') mesh.position.set(position[0], position[1], 0)
      else if (current.plane === 'xz') mesh.position.set(position[0], 0, position[2])
      else mesh.position.set(0, position[1], position[2])
      mesh.scale.setScalar(reach * 2)
      material.uniforms.uCamera!.value = position
      material.uniforms.uFade!.value = reach
    },
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}
