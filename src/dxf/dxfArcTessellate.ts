import type { DxfPoint } from './dxfParser'

/** DXF ARC: Mittelpunkt, Radius, Start-/Endwinkel in Grad (CCW von +X). */
export function tessellateArcEntity(
  cx: number,
  cy: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  maxSegments = 32
): DxfPoint[] {
  if (radius <= 0) return []
  let s0 = (startAngleDeg * Math.PI) / 180
  let s1 = (endAngleDeg * Math.PI) / 180
  let sweep = s1 - s0
  if (sweep <= 0) sweep += 2 * Math.PI
  if (sweep > 2 * Math.PI - 1e-9) sweep = 2 * Math.PI

  const arcLen = radius * sweep
  const seg = Math.max(
    4,
    Math.min(maxSegments, Math.ceil(arcLen / (radius * 0.15)))
  )
  const pts: DxfPoint[] = []
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
    const ang = s0 + sweep * t
    pts.push({
      x: cx + radius * Math.cos(ang),
      y: cy + radius * Math.sin(ang),
    })
  }
  return pts
}
