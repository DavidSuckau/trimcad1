import * as THREE from 'three'
import type { Point } from '../types/model'
import type { SeatRegion } from './types'
import { contourBounds } from './sampleContour'

/** Sitz-Dummy Maße (mm), Y = oben. */
export const SEAT_MM = {
  cushionW: 480,
  cushionD: 520,
  cushionY: 380,
  backW: 460,
  backH: 620,
  backRadius: 520,
  backBaseY: 400,
  backBaseZ: -40,
} as const

/**
 * Flacher 2D-Punkt (zentriert um 0) → 3D auf Sitzschale / Lehne.
 * Abwickelbare Näherung: Schale = flache Mulde, Lehne = Zylindersegment.
 */
export function mapFlatToSeat(
  u: number,
  v: number,
  region: SeatRegion,
  offsetU = 0,
  offsetV = 0,
): THREE.Vector3 {
  const x = u + offsetU
  const y = v + offsetV
  if (region === 'cushion') {
    const nx = x / (SEAT_MM.cushionW / 2)
    const nz = y / (SEAT_MM.cushionD / 2)
    const dish = -12 * (nx * nx * 0.7 + nz * nz)
    return new THREE.Vector3(x, SEAT_MM.cushionY + dish, y)
  }
  // Lehne: Bogenlänge v entlang Zylinder (Radius R), u = Breite
  const R = SEAT_MM.backRadius
  const angle = y / R
  const px = x
  const py = SEAT_MM.backBaseY + R * Math.sin(angle)
  const pz = SEAT_MM.backBaseZ - R * (1 - Math.cos(angle))
  return new THREE.Vector3(px, py, pz)
}

/** ShapeGeometry aus 2D-Ring, Vertices auf Sitz-Region biegen. */
export function buildBentPieceGeometry(
  ring: Point[],
  region: SeatRegion,
  offsetU = 0,
  offsetV = 0,
): THREE.BufferGeometry | null {
  const b = contourBounds(ring)
  if (!b || b.w < 1 || b.h < 1) return null

  const centered = ring.map((p) => ({ x: p.x - b.cx, y: p.y - b.cy }))
  const shape = new THREE.Shape()
  shape.moveTo(centered[0]!.x, centered[0]!.y)
  for (let i = 1; i < centered.length; i++) {
    shape.lineTo(centered[i]!.x, centered[i]!.y)
  }
  shape.closePath()

  const geom = new THREE.ShapeGeometry(shape, 12)
  const pos = geom.attributes.position
  if (!pos) return null

  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i)
    const v = pos.getY(i)
    const p = mapFlatToSeat(u, v, region, offsetU, offsetV)
    pos.setXYZ(i, p.x, p.y, p.z)
  }
  pos.needsUpdate = true
  geom.computeVertexNormals()
  return geom
}
