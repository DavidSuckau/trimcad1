import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import type { PatternPiece } from '../types/model'
import { buildBentPieceGeometry } from './bendPiece'
import { createSeatDummyGroup } from './seatDummy'
import { sampleClosedContour } from './sampleContour'
import { useSeat3dStore } from './useSeat3dStore'
import type { SeatPiecePlacement } from './types'

const PIECE_COLORS = ['#c4a574', '#8fbc8f', '#6b9bd1', '#d4a5a5', '#b8a9c9', '#e8c07a']

function SeatDummy() {
  const group = useMemo(() => createSeatDummyGroup(), [])
  return <primitive object={group} />
}

function BentPiece({
  piece,
  placement,
  color,
}: {
  piece: PatternPiece
  placement: SeatPiecePlacement
  color: string
}) {
  const geom = useMemo(() => {
    const contour = piece.seamLine.length >= 3 ? piece.seamLine : piece.cutLine
    const ring = sampleClosedContour(contour)
    return buildBentPieceGeometry(ring, placement.region, placement.offsetU, placement.offsetV)
  }, [piece, placement.region, placement.offsetU, placement.offsetV])

  if (!geom) return null
  return (
    <mesh geometry={geom} renderOrder={2}>
      <meshStandardMaterial
        color={color}
        roughness={0.65}
        metalness={0.05}
        side={THREE.DoubleSide}
        transparent
        opacity={0.92}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  )
}

function Scene({ pieces }: { pieces: PatternPiece[] }) {
  const placements = useSeat3dStore((s) => s.placements)
  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces])

  return (
    <>
      <color attach="background" args={['#1a1d24']} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[400, 800, 300]} intensity={1.1} castShadow />
      <directionalLight position={[-300, 400, -200]} intensity={0.35} />
      <SeatDummy />
      {placements.map((pl, i) => {
        const piece = byId.get(pl.pieceId)
        if (!piece) return null
        return (
          <BentPiece
            key={pl.pieceId}
            piece={piece}
            placement={pl}
            color={PIECE_COLORS[i % PIECE_COLORS.length]!}
          />
        )
      })}
      <ContactShadows position={[0, 0, 0]} opacity={0.35} scale={1200} blur={2.5} far={800} />
      <OrbitControls makeDefault target={[0, 550, 0]} maxDistance={3500} minDistance={200} />
    </>
  )
}

export function Seat3dViewport({ pieces }: { pieces: PatternPiece[] }) {
  return (
    <Canvas
      shadows
      camera={{ position: [900, 900, 900], fov: 40, near: 1, far: 8000 }}
      gl={{ antialias: true }}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <Scene pieces={pieces} />
    </Canvas>
  )
}
