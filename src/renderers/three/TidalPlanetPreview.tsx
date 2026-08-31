import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { GradientStop, ParamValue } from '@/rigs/types'
import type { RigSession } from '@/state/session'

type PreviewProps = { session: RigSession; values: Record<string, ParamValue> }

export function TidalPlanetPreview({ session, values }: PreviewProps) {
  return (
    <div className="planet-stage">
      <Canvas
        className="planet-canvas"
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        camera={{ position: [0.18, 0.26, 5.7], fov: 26 }}
        onCreated={({ gl }) => {
          gl.setClearColor('#141C1C')
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.08
        }}
      >
        <Scene session={session} values={values} />
      </Canvas>
    </div>
  )
}

function Scene({ session, values }: PreviewProps) {
  const seed = numeric(values.seed, 1)
  const terrainScale = numeric(values.terrainScale, 2.4)
  const ridge = numeric(values.ridgeStrength, 0.62)
  const density = numeric(values.atmosphere, 0.28)
  const maps = useMemo(() => {
    const stops = (values.elevation as GradientStop[]) ?? []
    return makeTerrainMaps(seed, terrainScale, ridge, stops)
  }, [seed, terrainScale, ridge, values.elevation])
  const group = useRef<THREE.Group>(null)
  const clouds = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.DirectionalLight>(null)

  useFrame(() => {
    const rotationY = (session.previewNumber('rotationY', 0) * Math.PI) / 180
    const cloudDrift = session.previewNumber('cloudDrift', 0)
    const lightAngle = session.previewNumber('lightAngle', 12)
    if (group.current) group.current.rotation.y = rotationY
    if (clouds.current) clouds.current.rotation.y = rotationY + cloudDrift * Math.PI * 2
    if (light.current) {
      const a = (lightAngle * Math.PI) / 180
      light.current.position.set(Math.cos(a) * 4.4, 1.35, Math.sin(a) * 4.4)
    }
  })

  useEffect(
    () => () => {
      maps.color.dispose()
      maps.bump.dispose()
    },
    [maps],
  )

  return (
    <>
      <color attach="background" args={['#141C1C']} />
      <hemisphereLight args={['#c5d4cc', '#243230', 0.48]} />
      <ambientLight intensity={0.16} />
      <directionalLight ref={light} intensity={1.85} color="#f4f3eb" />
      <mesh rotation={[1.18, 0.16, -0.26]}>
        <ringGeometry args={[1.2, 1.24, 96]} />
        <meshBasicMaterial color="#c5d4cc" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[1.22, 0.1, -0.2]}>
        <ringGeometry args={[1.4, 1.45, 96]} />
        <meshBasicMaterial color="#8aa39c" transparent opacity={0.32} side={THREE.DoubleSide} />
      </mesh>
      <group ref={group}>
        <mesh>
          <sphereGeometry args={[1, 96, 64]} />
          <meshStandardMaterial
            map={maps.color}
            bumpMap={maps.bump}
            bumpScale={0.08 + ridge * 0.22}
            roughness={0.78}
            metalness={0.03}
          />
        </mesh>
        <mesh ref={clouds} scale={1.018}>
          <sphereGeometry args={[1, 64, 48]} />
          <meshStandardMaterial color="#d7e2dc" transparent opacity={0.06 + density * 0.12} depthWrite={false} />
        </mesh>
        <mesh scale={1.08}>
          <sphereGeometry args={[1, 32, 24]} />
          <meshBasicMaterial color="#7ea8a4" transparent opacity={0.07 + density * 0.2} side={THREE.BackSide} />
        </mesh>
      </group>
      <Controls />
    </>
  )
}

function numeric(value: ParamValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function Controls() {
  const { camera, gl } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  useEffect(() => {
    const next = new OrbitControls(camera, gl.domElement)
    next.enableDamping = true
    next.enablePan = false
    next.minDistance = 3.4
    next.maxDistance = 8
    next.target.set(0, 0, 0)
    controls.current = next
    return () => {
      next.dispose()
      controls.current = null
    }
  }, [camera, gl])
  useFrame(() => controls.current?.update())
  return null
}

function makeTerrainMaps(seed: number, scale: number, ridge: number, stops: GradientStop[]): {
  color: THREE.CanvasTexture
  bump: THREE.CanvasTexture
} {
  const size = 384
  const colorCanvas = document.createElement('canvas')
  const bumpCanvas = document.createElement('canvas')
  colorCanvas.width = bumpCanvas.width = size
  colorCanvas.height = bumpCanvas.height = size
  const colorCtx = colorCanvas.getContext('2d')
  const bumpCtx = bumpCanvas.getContext('2d')
  if (!colorCtx || !bumpCtx) {
    return { color: new THREE.CanvasTexture(colorCanvas), bump: new THREE.CanvasTexture(bumpCanvas) }
  }
  const colorImage = colorCtx.createImageData(size, size)
  const bumpImage = bumpCtx.createImageData(size, size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const theta = (x / size) * Math.PI * 2
      const phi = (y / size) * Math.PI
      const px = Math.sin(phi) * Math.cos(theta) * scale
      const py = Math.cos(phi) * scale
      const pz = Math.sin(phi) * Math.sin(theta) * scale
      const sx = px + seed * 0.01
      const sz = pz - seed * 0.013
      const warp = fbm(sx + 3.1, sz - 1.7) * 0.52
      const n = fbm(sx + warp, py + warp * 0.5)
      const ridged = 1 - Math.abs(n)
      const elev = Math.min(1, Math.max(0, ridged * ridge + ((n + 1) / 2) * (1 - ridge)))
      const color = sampleStops(stops, elev)
      const interval = 0.09
      const phase = (elev % interval) / interval
      const edge = Math.min(phase, 1 - phase)
      const line = edge < 0.14 ? (1 - edge / 0.14) * 0.52 : 0
      const i = (y * size + x) * 4
      colorImage.data[i] = Math.round(color.r * (1 - line))
      colorImage.data[i + 1] = Math.round(color.g * (1 - line))
      colorImage.data[i + 2] = Math.round(color.b * (1 - line))
      colorImage.data[i + 3] = 255
      const h = Math.round(elev * 255)
      bumpImage.data[i] = h
      bumpImage.data[i + 1] = h
      bumpImage.data[i + 2] = h
      bumpImage.data[i + 3] = 255
    }
  }
  colorCtx.putImageData(colorImage, 0, 0)
  bumpCtx.putImageData(bumpImage, 0, 0)
  const color = new THREE.CanvasTexture(colorCanvas)
  const bump = new THREE.CanvasTexture(bumpCanvas)
  color.colorSpace = THREE.SRGBColorSpace
  color.anisotropy = 4
  bump.anisotropy = 4
  color.generateMipmaps = false
  color.minFilter = THREE.LinearFilter
  color.magFilter = THREE.LinearFilter
  bump.generateMipmaps = false
  bump.minFilter = THREE.LinearFilter
  bump.magFilter = THREE.LinearFilter
  color.needsUpdate = true
  bump.needsUpdate = true
  return { color, bump }
}

function fbm(x: number, y: number): number {
  let v = 0
  let a = 0.5
  let f = 1
  for (let i = 0; i < 6; i += 1) {
    v += a * noise(x * f, y * f)
    f *= 2
    a *= 0.5
  }
  return v
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), ux), lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), ux), uy) * 2 - 1
}

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function sampleStops(stops: GradientStop[], t: number): { r: number; g: number; b: number } {
  const sorted = [...stops].sort((a, b) => a.t - b.t)
  if (sorted.length === 0) return { r: 38, g: 61, b: 66 }
  const clamped = Math.min(1, Math.max(0, t))
  let a = sorted[0]
  let b = sorted[sorted.length - 1]
  if (!a || !b) return { r: 38, g: 61, b: 66 }
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const left = sorted[i]
    const right = sorted[i + 1]
    if (left && right && clamped >= left.t && clamped <= right.t) {
      a = left
      b = right
    }
  }
  const span = b.t - a.t || 1
  const u = (clamped - a.t) / span
  const ca = hexRgb(a.color)
  const cb = hexRgb(b.color)
  return { r: lerp(ca.r, cb.r, u), g: lerp(ca.g, cb.g, u), b: lerp(ca.b, cb.b, u) }
}

function hexRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace('#', '')
  const n = Number.parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
