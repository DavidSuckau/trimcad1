import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { meshBoundingRadius } from '../scan3d/objImport'
import {
  buildSeamDisplayPoints,
  raycastSurfaceAtNdc,
  sampleSurfaceLineScreen,
  vertexPathToDisplayPoints,
} from '../scan3d/surfaceRaycast'
import { useScan3dStore } from '../scan3d/useScan3dStore'
import type { MeshHandle, Scan3dSeam } from '../scan3d/types'

const SEAM_COLORS = ['#e85d04', '#d00000', '#ff6b35', '#c1121f', '#f48c06']

function seamLinePoints(
  seam: Scan3dSeam,
  mesh: MeshHandle,
  visualRoot: THREE.Object3D,
  camera: THREE.Camera,
): THREE.Vector3[] {
  let pts: THREE.Vector3[]
  if (seam.vertexPath.length >= 2) {
    pts = vertexPathToDisplayPoints(mesh, seam.vertexPath)
  } else if (seam.surfacePoints.length >= 6) {
    pts = buildSeamDisplayPoints(camera, visualRoot, seam.surfacePoints)
  } else {
    pts = []
    for (let i = 0; i < seam.surfacePoints.length; i += 3) {
      pts.push(new THREE.Vector3(seam.surfacePoints[i], seam.surfacePoints[i + 1], seam.surfacePoints[i + 2]))
    }
  }
  if (seam.closed && pts.length > 1) pts.push(pts[0].clone())
  return pts
}

function CameraFit({ meshRadius }: { meshRadius: number }) {
  const { camera } = useThree()
  const fitted = useRef(false)

  useEffect(() => {
    if (fitted.current) return
    fitted.current = true
    const radius = Math.max(meshRadius, 1)
    const dist = radius * 2.8
    camera.position.set(dist * 0.6, dist * 0.45, dist)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = radius / 100
      camera.far = radius * 20
      camera.updateProjectionMatrix()
    }
    camera.lookAt(0, 0, 0)
  }, [camera, meshRadius])

  return null
}

function SeamLines({
  seams,
  activeSeamId,
  previewPoints,
  mesh,
  visualRoot,
}: {
  seams: Scan3dSeam[]
  activeSeamId: string | null
  previewPoints: number[]
  mesh: MeshHandle
  visualRoot: THREE.Object3D
}) {
  const { camera } = useThree()

  return (
    <>
      {seams.map((seam, idx) => {
        const points = seamLinePoints(seam, mesh, visualRoot, camera)
        if (points.length < 2) return null
        const color = seam.id === activeSeamId ? '#ff2222' : SEAM_COLORS[idx % SEAM_COLORS.length]
        return (
          <Line
            key={seam.id}
            points={points}
            color={color}
            lineWidth={seam.id === activeSeamId ? 4 : 2.5}
            depthTest={false}
            transparent
            opacity={0.95}
          />
        )
      })}
      {previewPoints.length >= 6 && (
        <Line
          points={buildSeamDisplayPoints(camera, visualRoot, previewPoints)}
          color="#ffaa00"
          lineWidth={3}
          dashed
          dashSize={8}
          gapSize={4}
          depthTest={false}
          transparent
          opacity={0.85}
        />
      )}
    </>
  )
}

function TexturedModel({
  visualRoot,
  tool,
  minSampleDistMm,
  onStrokeStart,
  onStrokeMove,
  onStrokeEnd,
  onLineStart,
  onLineMove,
  onLineEnd,
}: {
  visualRoot: THREE.Object3D
  tool: 'navigate' | 'drawSeam' | 'drawLine'
  minSampleDistMm: number
  onStrokeStart: (x: number, y: number, z: number) => void
  onStrokeMove: (x: number, y: number, z: number) => void
  onStrokeEnd: () => void
  onLineStart: (x: number, y: number, z: number, ndc: THREE.Vector2) => void
  onLineMove: (ndc: THREE.Vector2) => void
  onLineEnd: (x: number, y: number, z: number, ndc: THREE.Vector2) => void
}) {
  const { camera } = useThree()
  const isDrawingRef = useRef(false)
  const lastSampleRef = useRef<{ x: number; y: number; z: number } | null>(null)

  const addSample = useCallback(
    (x: number, y: number, z: number, isStart: boolean) => {
      if (!isStart) {
        const last = lastSampleRef.current
        if (last) {
          const dx = x - last.x
          const dy = y - last.y
          const dz = z - last.z
          if (dx * dx + dy * dy + dz * dz < minSampleDistMm * minSampleDistMm) return
        }
      }
      lastSampleRef.current = { x, y, z }
      if (isStart) onStrokeStart(x, y, z)
      else onStrokeMove(x, y, z)
    },
    [minSampleDistMm, onStrokeStart, onStrokeMove],
  )

  const ndcFromEvent = useCallback((e: ThreeEvent<PointerEvent | MouseEvent>) => {
    return new THREE.Vector2(e.pointer.x, e.pointer.y)
  }, [])

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (tool === 'navigate') return
      e.stopPropagation()
      ;(e.nativeEvent.target as HTMLElement | undefined)?.setPointerCapture?.(e.pointerId)

      const ndc = ndcFromEvent(e)

      if (tool === 'drawLine') {
        const hit = raycastSurfaceAtNdc(camera, visualRoot, ndc)
        if (!hit) return
        onLineStart(hit.x, hit.y, hit.z, ndc)
        return
      }

      const hit = raycastSurfaceAtNdc(camera, visualRoot, ndc)
      if (!hit) return
      isDrawingRef.current = true
      lastSampleRef.current = null
      addSample(hit.x, hit.y, hit.z, true)
    },
    [tool, camera, visualRoot, addSample, ndcFromEvent, onLineStart],
  )

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const ndc = ndcFromEvent(e)

      if (tool === 'drawLine') {
        e.stopPropagation()
        onLineMove(ndc)
        return
      }
      if (tool !== 'drawSeam' || !isDrawingRef.current) return
      e.stopPropagation()
      const hit = raycastSurfaceAtNdc(camera, visualRoot, ndc)
      if (!hit) return
      addSample(hit.x, hit.y, hit.z, false)
    },
    [tool, camera, visualRoot, addSample, ndcFromEvent, onLineMove],
  )

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const ndc = ndcFromEvent(e)

      if (tool === 'drawLine') {
        e.stopPropagation()
        const hit = raycastSurfaceAtNdc(camera, visualRoot, ndc)
        if (hit) onLineEnd(hit.x, hit.y, hit.z, ndc)
        return
      }
      if (tool !== 'drawSeam' || !isDrawingRef.current) return
      e.stopPropagation()
      isDrawingRef.current = false
      lastSampleRef.current = null
      onStrokeEnd()
    },
    [tool, camera, visualRoot, onStrokeEnd, ndcFromEvent, onLineEnd],
  )

  return (
    <primitive
      object={visualRoot}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={(e: ThreeEvent<PointerEvent>) => {
        if (tool === 'drawSeam' && isDrawingRef.current) handlePointerUp(e)
      }}
    />
  )
}

function SceneContent() {
  const session = useScan3dStore((s) => s.session)
  const startSeamAtPoint = useScan3dStore((s) => s.startSeamAtPoint)
  const extendActiveSeamToPoint = useScan3dStore((s) => s.extendActiveSeamToPoint)
  const simplifyActiveSeam = useScan3dStore((s) => s.simplifyActiveSeam)
  const finishActiveSeam = useScan3dStore((s) => s.finishActiveSeam)
  const setLinePreview = useScan3dStore((s) => s.setLinePreview)
  const addSeamFromSurfacePoints = useScan3dStore((s) => s.addSeamFromSurfacePoints)

  const { camera } = useThree()
  const lineStartRef = useRef<{ world: THREE.Vector3; ndc: THREE.Vector2 } | null>(null)

  const meshRadius = useMemo(() => (session ? meshBoundingRadius(session.mesh) : 1), [session])
  const minSampleDistMm = useMemo(() => Math.max(4, meshRadius * 0.004), [meshRadius])

  const onStrokeStart = useCallback(
    (x: number, y: number, z: number) => {
      startSeamAtPoint(x, y, z)
    },
    [startSeamAtPoint],
  )

  const onStrokeMove = useCallback(
    (x: number, y: number, z: number) => {
      extendActiveSeamToPoint(x, y, z)
    },
    [extendActiveSeamToPoint],
  )

  const onStrokeEnd = useCallback(() => {
    simplifyActiveSeam()
    finishActiveSeam()
  }, [simplifyActiveSeam, finishActiveSeam])

  const onLineStart = useCallback(
    (x: number, y: number, z: number, ndc: THREE.Vector2) => {
      if (!session) return
      lineStartRef.current = { world: new THREE.Vector3(x, y, z), ndc: ndc.clone() }
      setLinePreview([x, y, z])
    },
    [session, setLinePreview],
  )

  const onLineMove = useCallback(
    (ndc: THREE.Vector2) => {
      if (!session || !lineStartRef.current) return
      const start = lineStartRef.current
      const preview = sampleSurfaceLineScreen(camera, session.visualRoot, start.ndc, ndc, 48)
      setLinePreview(preview.length >= 6 ? preview : [start.world.x, start.world.y, start.world.z])
    },
    [session, camera, setLinePreview],
  )

  const onLineEnd = useCallback(
    (_x: number, _y: number, _z: number, ndc: THREE.Vector2) => {
      if (!session || !lineStartRef.current) return
      const start = lineStartRef.current
      const surfacePoints = sampleSurfaceLineScreen(camera, session.visualRoot, start.ndc, ndc, 56)
      lineStartRef.current = null
      setLinePreview([])
      if (surfacePoints.length >= 6) addSeamFromSurfacePoints(surfacePoints)
    },
    [session, camera, setLinePreview, addSeamFromSurfacePoints],
  )

  if (!session) return null

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[120, 180, 100]} intensity={0.95} />
      <directionalLight position={[-80, -40, -120]} intensity={0.4} />
      <CameraFit meshRadius={meshRadius} />
      <TexturedModel
        visualRoot={session.visualRoot}
        tool={session.tool}
        minSampleDistMm={minSampleDistMm}
        onStrokeStart={onStrokeStart}
        onStrokeMove={onStrokeMove}
        onStrokeEnd={onStrokeEnd}
        onLineStart={onLineStart}
        onLineMove={onLineMove}
        onLineEnd={onLineEnd}
      />
      <SeamLines
        seams={session.seams}
        activeSeamId={session.activeSeamId}
        previewPoints={session.linePreviewPoints}
        mesh={session.mesh}
        visualRoot={session.visualRoot}
      />
      <OrbitControls
        makeDefault
        enableRotate={session.tool === 'navigate'}
        enableDamping
        dampingFactor={0.08}
      />
      <gridHelper args={[meshRadius * 4, 20, '#999', '#ccc']} position={[0, -meshRadius - 1, 0]} />
    </>
  )
}

export function Scan3dViewport() {
  return (
    <div className="scan3d-viewport">
      <Canvas
        camera={{ fov: 45, near: 0.1, far: 100000 }}
        gl={{ antialias: true }}
        style={{ width: '100%', height: '100%' }}
        onCreated={({ gl }) => {
          gl.setClearColor('#2a2d32')
        }}
      >
        <SceneContent />
      </Canvas>
    </div>
  )
}
