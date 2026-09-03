import {
  Color,
  DirectionalLight,
  Group,
  Object3D,
  PointLight,
  RectAreaLight,
  SpotLight,
  type Light,
  type Matrix4,
} from 'three'
import type { LightData, SceneDocument, SceneObject } from '@/scene/types'
import { worldMatrix } from '@/scene/objects'

/**
 * The scene's own lights, as three.js draws them.
 *
 * Solid shading does not use these — it lights the scene with a fixed studio rig so that a model
 * reads the same wherever its lamps happen to be — but rendered shading does, and that is the whole
 * difference between the two modes.
 *
 * Shadows are the expensive part: each one is another pass over the scene from the light's own
 * point of view, at a resolution that has to be paid for in memory. Blender caps them too. Here the
 * cap is a number the caller passes, and the lights that get one are the strongest — the ones whose
 * shadow a person would miss.
 */

export type SceneLights = {
  group: Group
  /** Rebuilds from the document. Returns how many lights are casting a shadow. */
  sync: (document: SceneDocument, options: { shadows: boolean; maxShadows: number }) => number
  dispose: () => void
}

/** Blender's watts to three's intensity: a point light of 1000 W is bright, not a thousand suns. */
const WATTS_TO_INTENSITY = 1 / 40

export function createSceneLights(): SceneLights {
  const group = new Group()
  group.name = 'scene-lights'
  const built = new Map<string, Light>()

  const place = (light: Object3D, matrix: Matrix4): void => {
    light.matrixAutoUpdate = false
    light.matrix.copy(matrix)
    light.matrixWorldNeedsUpdate = true
  }

  return {
    group,
    sync: (document, options) => {
      const lights = document.objects.filter((object) => object.data.kind === 'light' && object.visible)
      const alive = new Set(lights.map((object) => object.id))
      for (const [id, light] of [...built]) {
        if (alive.has(id)) continue
        group.remove(light)
        light.dispose()
        built.delete(id)
      }
      /*
       * The brightest first, so that when there are more lights than shadows allowed the ones that
       * keep theirs are the ones whose absence would be noticed.
       */
      const order = [...lights].sort((a, b) => power(b) - power(a))
      let casting = 0
      for (const object of order) {
        const data = object.data as LightData
        const existing = built.get(object.id)
        const light = existing && matches(existing, data) ? existing : rebuild(existing, data, group, built, object.id)
        write(light, data)
        place(light, worldMatrix(document, object))
        const wantsShadow = options.shadows && data.shadow !== false && casting < options.maxShadows
        light.castShadow = wantsShadow
        if (wantsShadow && light.shadow) {
          light.shadow.mapSize.set(2048, 2048)
          light.shadow.bias = -0.0005
          casting += 1
        }
      }
      return casting
    },
    dispose: () => {
      for (const light of built.values()) light.dispose()
      built.clear()
      group.clear()
    },
  }
}

function power(object: SceneObject): number {
  const data = object.data as LightData
  return typeof data.power === 'number' ? data.power : 0
}

function matches(light: Light, data: LightData): boolean {
  if (data.light === 'point') return light instanceof PointLight
  if (data.light === 'sun') return light instanceof DirectionalLight
  if (data.light === 'spot') return light instanceof SpotLight
  return light instanceof RectAreaLight
}

function rebuild(
  existing: Light | undefined,
  data: LightData,
  group: Group,
  built: Map<string, Light>,
  id: string,
): Light {
  if (existing) {
    group.remove(existing)
    existing.dispose()
  }
  const light = data.light === 'point'
    ? new PointLight()
    : data.light === 'sun'
      ? new DirectionalLight()
      : data.light === 'spot' ? new SpotLight() : new RectAreaLight()
  group.add(light)
  built.set(id, light)
  return light
}

function write(light: Light, data: LightData): void {
  light.color = new Color(data.color ?? '#ffffff')
  if (light instanceof PointLight) {
    light.intensity = Math.max(0, (data.power ?? 100) * WATTS_TO_INTENSITY)
    light.distance = Math.max(0, data.distance ?? 0)
    light.decay = 2
    return
  }
  if (light instanceof DirectionalLight) {
    /*
     * A sun's power is an irradiance in watts a square metre rather than a wattage, and it reaches
     * everywhere alike — so it is taken as an intensity directly instead of through the falloff the
     * others need.
     */
    light.intensity = Math.max(0, data.power ?? 1)
    return
  }
  if (light instanceof SpotLight) {
    light.intensity = Math.max(0, (data.power ?? 100) * WATTS_TO_INTENSITY)
    light.angle = Math.max(0.01, ((data.spotAngle ?? 45) * Math.PI) / 180 / 2)
    light.penumbra = Math.min(1, Math.max(0, data.spotBlur ?? 0.15))
    light.decay = 2
    return
  }
  if (light instanceof RectAreaLight) {
    light.intensity = Math.max(0, (data.power ?? 100) * WATTS_TO_INTENSITY)
    light.width = Math.max(0.001, data.areaSize?.[0] ?? 1)
    light.height = Math.max(0.001, data.areaSize?.[1] ?? data.areaSize?.[0] ?? 1)
  }
}
