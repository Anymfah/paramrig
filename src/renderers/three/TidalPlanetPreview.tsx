import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { GradientStop, ParamValue } from '@/rigs/types'
import type { RigSession } from '@/state/session'
import { terrainFragmentShader, terrainVertexShader } from './heliosPlanetShaders'
import { createHeliosCubeSphereGeometry } from './heliosCubeSphere'

type PreviewProps = { session: RigSession; values: Record<string, ParamValue> }

const PARAMRIG_PALETTE: GradientStop[] = [
  { t: 0, color: '#222324' },
  { t: 0.1, color: '#343837' },
  { t: 0.13, color: '#68706c' },
  { t: 0.42, color: '#929793' },
  { t: 0.72, color: '#c6c6c6' },
  { t: 1, color: '#f2f2f2' },
]

export function TidalPlanetPreview({ session, values }: PreviewProps) {
  return (
    <div className="planet-stage">
      <Canvas
        className="planet-canvas"
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        camera={{ position: [0.15, 0.12, 4.35], fov: 28 }}
        onCreated={({ gl }) => {
          gl.setClearColor('#151516')
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.05
          gl.outputColorSpace = THREE.SRGBColorSpace
        }}
      >
        <Scene session={session} values={values} />
      </Canvas>
    </div>
  )
}

function Scene({ session, values }: PreviewProps) {
  const { camera, gl } = useThree()
  const group = useRef<THREE.Group>(null)
  const terrain = useRef<THREE.ShaderMaterial>(null)
  const worldLightDirection = useMemo(() => new THREE.Vector3(1, 0.35, 0.5).normalize(), [])
  const localLightDirection = useMemo(() => new THREE.Vector3(1, 0.35, 0.5).normalize(), [])
  const localCameraPosition = useMemo(() => new THREE.Vector3(), [])
  const localCameraDirection = useMemo(() => new THREE.Vector3(0, 0, -1), [])
  const inverseRotation = useMemo(() => new THREE.Quaternion(), [])
  const terrainGeometry = useMemo(() => createHeliosCubeSphereGeometry(1, 128), [])
  const seed = numeric(values.seed, 4817)
  const radius = 0.92
  const amplitude = numeric(values.planetRelief, 0.052)
  const elevation = gradient(values.terrainPalette)
  const terrainColorMap = useMemo(() => createGradientTexture(elevation), [elevation])
  const terrainBumpMap = useMemo(() => createBumpTexture(), [])

  useEffect(() => () => terrainColorMap.dispose(), [terrainColorMap])
  useEffect(() => () => terrainBumpMap.dispose(), [terrainBumpMap])

  useEffect(() => {
    gl.toneMappingExposure = numeric(values.exposure, 1.05)
  }, [gl, values.exposure])

  const terrainUniforms = useMemo(() => ({
    type: { value: 2 },
    seed: { value: seed },
    radius: { value: radius },
    amplitude: { value: amplitude },
    sharpness: { value: 2 },
    offset: { value: -0.00092 },
    period: { value: numeric(values.planetScale, 0.78) * 1.22 },
    persistence: { value: 0.46 },
    lacunarity: { value: 2.02 },
    octaves: { value: Math.round(numeric(values.surfaceDetail, 7)) },
    warpStrength: { value: 0.15 },
    warpScale: { value: 1.7 },
    hemisphereContrast: { value: 0.14 },
    hemisphereAngle: { value: 0.7 },
    continentalShelf: { value: 0.00644 },
    continentalDropoff: { value: 2.8 },
    continentalDepth: { value: 0.01564 },
    noiseBlend: { value: 0.5 },
    noiseBlendType: { value: 3 },
    terrainColorMap: { value: terrainColorMap },
    terrainBumpMap: { value: terrainBumpMap },
    terrainColorHMax: { value: Math.max(0.025, amplitude * 1.3) },
    bumpStrength: { value: numeric(values.surfaceRoughness, 0.52) },
    bumpOffset: { value: 0.0025 },
    specularThreshold: { value: 0.035 },
    ambientIntensity: { value: numeric(values.lightAmbient, 0.58) },
    diffuseIntensity: { value: numeric(values.lightIntensity, 1.02) },
    specularIntensity: { value: 0.04 },
    shininess: { value: 18 },
    fillLightIntensity: { value: 0.14 },
    cameraTorchIntensity: { value: 0.08 },
    lightDirection: { value: localLightDirection },
    lightColor: { value: new THREE.Color('#f2f2f2') },
    uCameraPosition: { value: localCameraPosition },
    uCameraDirection: { value: localCameraDirection },
  }), [amplitude, localCameraDirection, localCameraPosition, localLightDirection, seed, terrainBumpMap, terrainColorMap, values.lightAmbient, values.lightIntensity, values.planetScale, values.surfaceDetail, values.surfaceRoughness])

  useFrame(() => {
    const rotationY = (session.previewNumber('rotationY', 0) * Math.PI) / 180
    const azimuth = THREE.MathUtils.degToRad(session.previewNumber('keyDirection', 32))
    const elevationAngle = THREE.MathUtils.degToRad(session.previewNumber('keyElevation', 26))
    worldLightDirection.set(
      Math.cos(elevationAngle) * Math.cos(azimuth),
      Math.sin(elevationAngle),
      Math.cos(elevationAngle) * Math.sin(azimuth),
    ).normalize()
    if (group.current) {
      group.current.rotation.y = rotationY
      group.current.updateWorldMatrix(true, false)
      group.current.getWorldQuaternion(inverseRotation).invert()
      localLightDirection.copy(worldLightDirection).applyQuaternion(inverseRotation).normalize()
      localCameraPosition.copy(camera.position)
      group.current.worldToLocal(localCameraPosition)
      camera.getWorldDirection(localCameraDirection).applyQuaternion(inverseRotation).normalize()
    }
    if (terrain.current) terrain.current.uniformsNeedUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#151516']} />
      <group ref={group} rotation={[0.08, 0, -0.08]}>
        <mesh>
          <primitive object={terrainGeometry} attach="geometry" />
          <shaderMaterial
            ref={terrain}
            vertexShader={terrainVertexShader}
            fragmentShader={terrainFragmentShader}
            uniforms={terrainUniforms}
          />
        </mesh>
      </group>
      <Controls />
    </>
  )
}

function numeric(value: ParamValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function gradient(value: ParamValue | undefined): GradientStop[] {
  if (!Array.isArray(value)) return PARAMRIG_PALETTE
  const stops = (value as unknown[]).filter(isGradientStop).sort((a, b) => a.t - b.t)
  if (stops.length < 2) return PARAMRIG_PALETTE
  return stops
}

function isGradientStop(value: unknown): value is GradientStop {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as { t?: unknown; color?: unknown }
  return typeof candidate.t === 'number' && typeof candidate.color === 'string'
}

function createGradientTexture(stops: GradientStop[]): THREE.DataTexture {
  const size = 256
  const data = new Uint8Array(size * 4)
  for (let index = 0; index < size; index += 1) {
    const mixed = gradientColorAt(stops, index / (size - 1))
    const offset = index * 4
    data[offset] = Math.round(THREE.MathUtils.clamp(mixed.r, 0, 1) * 255)
    data[offset + 1] = Math.round(THREE.MathUtils.clamp(mixed.g, 0, 1) * 255)
    data[offset + 2] = Math.round(THREE.MathUtils.clamp(mixed.b, 0, 1) * 255)
    data[offset + 3] = 255
  }
  const texture = new THREE.DataTexture(data, 1, size, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function createBumpTexture(): THREE.DataTexture {
  const data = new Uint8Array([166, 166, 166, 255])
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.needsUpdate = true
  return texture
}

function gradientColorAt(stops: GradientStop[], height: number): THREE.Color {
  const first = stops[0]!
  if (height <= first.t) return new THREE.Color(first.color)
  for (let index = 0; index < stops.length - 1; index += 1) {
    const low = stops[index]!
    const high = stops[index + 1]!
    if (height > high.t) continue
    const blend = (height - low.t) / Math.max(0.0001, high.t - low.t)
    return new THREE.Color(low.color).lerp(new THREE.Color(high.color), blend)
  }
  return new THREE.Color(stops.at(-1)!.color)
}

function Controls() {
  const { camera, gl } = useThree()
  const controls = useRef<OrbitControls | null>(null)

  useEffect(() => {
    const instance = new OrbitControls(camera, gl.domElement)
    instance.enablePan = false
    instance.enableDamping = true
    instance.dampingFactor = 0.07
    instance.minDistance = 3.15
    instance.maxDistance = 6.4
    controls.current = instance
    return () => instance.dispose()
  }, [camera, gl])

  useFrame(() => controls.current?.update())
  return null
}
