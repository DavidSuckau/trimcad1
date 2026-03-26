import type { DxfPoint } from './dxfParser'

/**
 * DXF ELLIPSE: 10/20 Zentrum, 11/21 Major-Achsenvektor, 40 Verhältnis Minor/Major.
 * Parameter u = 0..2π; Start/Endwinkel (41/42) optional in rad.
 */
export function tessellateEllipseEntity(
  cx: number,
  cy: number,
  majX: number,
  majY: number,
  ratio: number,
  startParam: number | null,
  endParam: number | null,
  maxSegments = 48
): DxfPoint[] {
  const a = Math.hypot(majX, majY)
  if (a < 1e-12) return []
  const b = a * Math.max(1e-9, ratio)
  const cosR = majX / a
  const sinR = majY / a
  let u0 = startParam != null && !Number.isNaN(startParam) ? startParam : 0
  let u1 = endParam != null && !Number.isNaN(endParam) ? endParam : u0 + 2 * Math.PI
  let sweep = u1 - u0
  if (sweep <= 0) sweep += 2 * Math.PI
  if (sweep > 2 * Math.PI - 1e-9) sweep = 2 * Math.PI

  const arcLenApprox = (a + b) * 0.5 * sweep
  const seg = Math.max(8, Math.min(maxSegments, Math.ceil(arcLenApprox / (a * 0.12))))
  const pts: DxfPoint[] = []
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
    const u = u0 + sweep * t
    const ca = Math.cos(u) * a
    const sa = Math.sin(u) * b
    pts.push({
      x: cx + ca * cosR - sa * sinR,
      y: cy + ca * sinR + sa * cosR,
    })
  }
  return pts
}
