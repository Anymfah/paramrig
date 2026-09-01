import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { Gizmo3DValue } from '@/rigs/extended-types'

type Props = {
  value: Gizmo3DValue
  onChange: (value: Gizmo3DValue) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onGestureCancel?: () => void
}

export function Gizmo3DScene(props: Props) {
  return <div className="three-gizmo-stage" aria-label="3D transform preview">
    <Canvas dpr={[1, 1.5]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} camera={{ position: [3, 3, 5], fov: 42 }}>
      <Scene {...props}/>
    </Canvas>
  </div>
}

function Scene({ value, onChange, onGestureStart, onGestureEnd, onGestureCancel }: Props) {
  const { camera, gl, scene } = useThree()
  const object = useRef<THREE.Mesh>(null)
  const transform = useRef<TransformControls | null>(null)
  const orbit = useRef<OrbitControls | null>(null)
  const latest = useRef({ value, onChange, onGestureStart, onGestureEnd, onGestureCancel })
  latest.current = { value, onChange, onGestureStart, onGestureEnd, onGestureCancel }
  const dragging = useRef(false)

  useEffect(() => {
    if (!object.current || dragging.current) return
    object.current.position.set(...value.position)
    object.current.rotation.set(...value.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
    object.current.scale.set(...value.scale)
  }, [value])

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement)
    controls.enableDamping = true
    controls.enablePan = false
    controls.minDistance = 3
    controls.maxDistance = 8
    controls.target.set(0, 0, 0)
    orbit.current = controls
    const gizmo = new TransformControls(camera, gl.domElement)
    transform.current = gizmo
    scene.add(gizmo.getHelper())
    if (object.current) gizmo.attach(object.current)
    const onStart = () => { dragging.current = true; latest.current.onGestureStart?.() }
    const onEnd = () => { dragging.current = false; latest.current.onGestureEnd?.() }
    const onCancel = () => { dragging.current = false; latest.current.onGestureCancel?.() }
    const onDrag = (event: { value: unknown }) => { controls.enabled = event.value !== true }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragging.current) return
      event.preventDefault()
      controls.enabled = true
      onCancel()
    }
    const onObjectChange = () => {
      const mesh = object.current
      if (!mesh) return
      const previous = latest.current.value
      latest.current.onChange({
        ...previous,
        position: [mesh.position.x, mesh.position.y, mesh.position.z],
        rotation: [THREE.MathUtils.radToDeg(mesh.rotation.x), THREE.MathUtils.radToDeg(mesh.rotation.y), THREE.MathUtils.radToDeg(mesh.rotation.z)],
        scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
      })
    }
    gizmo.addEventListener('mouseDown', onStart)
    gizmo.addEventListener('mouseUp', onEnd)
    gizmo.addEventListener('dragging-changed', onDrag)
    gizmo.addEventListener('objectChange', onObjectChange)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      gizmo.removeEventListener('mouseDown', onStart)
      gizmo.removeEventListener('mouseUp', onEnd)
      gizmo.removeEventListener('dragging-changed', onDrag)
      gizmo.removeEventListener('objectChange', onObjectChange)
      window.removeEventListener('keydown', onKeyDown, true)
      gizmo.detach()
      scene.remove(gizmo.getHelper())
      gizmo.dispose()
      controls.dispose()
      if (dragging.current) onCancel()
    }
  }, [camera, gl, scene])

  useEffect(() => {
    transform.current?.setMode(value.mode)
  }, [value.mode])

  return <>
    <color attach="background" args={['#151516']}/>
    <ambientLight intensity={1.2}/>
    <directionalLight position={[3, 4, 4]} intensity={2.2}/>
    <gridHelper args={[4, 8, '#68706c', '#343837']}/>
    <mesh ref={object}>
      <boxGeometry args={[1, 1, 1]}/>
      <meshStandardMaterial color="#b8c5b2" roughness={0.5} metalness={0.12}/>
    </mesh>
    <OrbitFrame controls={orbit}/>
  </>
}

function OrbitFrame({ controls }: { controls: MutableRefObject<OrbitControls | null> }) {
  useFrame(() => controls.current?.update())
  return null
}
