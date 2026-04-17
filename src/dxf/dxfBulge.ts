type Pt = { x: number; y: number }

export type VertexWithBulge = { x: number; y: number; bulge: number }

const MIN_BULGE = 1e-10

/**
 * Stützpunkte entlang der LWPOLYLINE, Segmente mit Bulge als Kreisbogen unterteilt.
 * Bulge auf Vertex i gilt für das Segment von Vertex i bis Vertex i+1 (bei geschlossen: letztes → erstes).
 */
export function expandLwPolylineWithBulge(
  verts: VertexWithBulge[],
  closed: boolean,
  segmentsPerArc = 8
): Pt[] {
  const n = verts.length
  if (n < 2) return verts.map((v) => ({ x: v.x, y: v.y }))

  const out: Pt[] = [{ x: verts[0].x, y: verts[0].y }]
  const segCount = closed ? n : n - 1

  for (let i = 0; i < segCount; i++) {
    const a = verts[i]
    const b = verts[(i + 1) % n]
    const bulge = a.bulge
    if (Math.abs(bulge) < MIN_BULGE) {
      out.push({ x: b.x, y: b.y })
      continue
    }
    const arcPts = tessellateBulgeArc(
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
      bulge,
      segmentsPerArc
    )
    for (let k = 1; k < arcPts.length; k++) out.push(arcPts[k])
  }
  return out
}

/**
 * AutoCAD-Bulge: tan(θ/4) für den Mittelpunktwinkel θ von a nach b.
 * Positiver Bulge = CCW-Bogen.
 */
function tessellateBulgeArc(a: Pt, b: Pt, bulge: number, segments: number): Pt[] {
  const theta = 4 * Math.atan(bulge)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const chord = Math.hypot(dx, dy)
  if (chord < 1e-12) return [a, b]

  const absHalf = Math.abs(theta) / 2
  if (absHalf < 1e-12) return [a, b]
  const radius = chord / (2 * Math.sin(absHalf))
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const nx = -dy / chord
  const ny = dx / chord
  const halfChord = chord / 2
  const h = Math.sqrt(Math.max(0, radius * radius - halfChord * halfChord))
  const sign = bulge > 0 ? 1 : -1
  const cx = mx + sign * nx * h
  const cy = my + sign * ny * h

  const a1 = Math.atan2(a.y - cy, a.x - cx)
  const a2 = Math.atan2(b.y - cy, b.x - cx)
  const start = a1
  let end = a2
  if (bulge > 0) {
    if (end < start) end += 2 * Math.PI
  } else {
    if (end > start) end -= 2 * Math.PI
  }

  const pts: Pt[] = [a]
  const steps = Math.max(2, Math.min(64, segments))
  for (let s = 1; s < steps; s++) {
    const t = s / steps
    const ang = start + (end - start) * t
    pts.push({
      x: cx + radius * Math.cos(ang),
      y: cy + radius * Math.sin(ang),
    })
  }
  pts.push(b)
  return pts
}
