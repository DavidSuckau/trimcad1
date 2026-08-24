import type { Curve, PatternPiece, Point } from '../types/model'
import { bezierAt } from './curveToPath'
import { getEffectiveSoftVerticesCut } from './seamUtils'
import { interiorAngleAtVertexDegrees } from './softVertexPromotion'

const MIN_CHAMFER_MM = 0.5
/**
 * Nur echte Knicke chamfern. Tessellationspunkte entlang einer Kurve (Clipper-Offset)
 * sind nahezu kollinear (~180°) und würden sonst die gesamte Nahtzugabe „auffressen“.
 */
const MAX_INTERIOR_DEG_FOR_CHAMFER = 165

function cloneCurves(curves: Curve[]): Curve[] {
  return curves.map((c) =>
    c.type === 'line'
      ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
      : {
          type: 'bezier' as const,
          start: { ...c.start },
          end: { ...c.end },
          cp1: { ...c.cp1 },
          cp2: { ...c.cp2 },
        }
  )
}

function vertexAt(curves: Curve[], vi: number): Point {
  const n = curves.length
  const i = ((vi % n) + n) % n
  return { ...curves[i].start }
}

function nearestSeamVertex(seam: Curve[], cutCorner: Point): Point | null {
  if (seam.length < 3) return null
  let best: Point | null = null
  let bestD = Infinity
  for (let i = 0; i < seam.length; i++) {
    const p = vertexAt(seam, i)
    const d = Math.hypot(p.x - cutCorner.x, p.y - cutCorner.y)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

/** Geschlossene Kontur → Punktring (Start jedes Segments). Bézier werden grob abgetastet. */
function curvesToRing(curves: Curve[]): Point[] {
  const ring: Point[] = []
  for (const c of curves) {
    if (c.type === 'line') {
      ring.push({ ...c.start })
    } else {
      const steps = 12
      for (let i = 0; i < steps; i++) {
        const t = i / steps
        ring.push(bezierAt(c, t))
      }
    }
  }
  return ring
}

function ringToLineCurves(ring: Point[]): Curve[] {
  if (ring.length < 3) return []
  const out: Curve[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) continue
    out.push({ type: 'line', start: { ...a }, end: { ...b } })
  }
  return out.length >= 3 ? out : []
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

/**
 * Sutherland–Hodgman: behält Punkte mit (P − S) · n ≤ 0
 * (Naht-Ecke S auf der Grenze, Cut-Ecke C mit (C−S)·n > 0 wird abgeschnitten).
 */
function clipRingByHalfPlane(ring: Point[], S: Point, n: Point): Point[] {
  if (ring.length < 3) return ring
  const nLen = Math.hypot(n.x, n.y)
  if (nLen < 1e-12) return ring

  const inside = (p: Point) => dot(sub(p, S), n) <= 1e-9
  const intersect = (a: Point, b: Point): Point => {
    const da = dot(sub(a, S), n)
    const db = dot(sub(b, S), n)
    const t = da / (da - db)
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
  }

  const out: Point[] = []
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i]
    const prev = ring[(i - 1 + ring.length) % ring.length]
    const curIn = inside(cur)
    const prevIn = inside(prev)
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur))
      out.push({ ...cur })
    } else if (prevIn) {
      out.push(intersect(prev, cur))
    }
  }
  return out
}

/**
 * Schneidet scharfe Ecken der **Schnittkontur** maximal in der Nahtzugabe ab:
 * die Fase ist die Gerade durch den Naht-Eckpunkt, senkrecht zu (Cut-Ecke − Naht-Ecke).
 * Die Nahtlinie bleibt unverändert.
 */
export function chamferCutLineCornersInSeamAllowance(piece: PatternPiece): Curve[] {
  const cut = piece.cutLine
  const n = cut.length
  if (n < 3) return cloneCurves(cut)

  const soft = new Set(getEffectiveSoftVerticesCut(piece))
  const saDefault = piece.seamAllowanceMm ?? 0
  if (saDefault <= 0 && !(piece.edgeSeamAllowances && piece.edgeSeamAllowances.length > 0)) {
    return cloneCurves(cut)
  }

  const seam = piece.seamLine.length >= 3 ? piece.seamLine : null
  if (!seam) return cloneCurves(cut)

  type Plane = { S: Point; n: Point }
  const planes: Plane[] = []

  for (let i = 0; i < n; i++) {
    if (soft.has(i)) continue
    const interiorDeg = interiorAngleAtVertexDegrees(cut, i)
    if (interiorDeg == null || interiorDeg > MAX_INTERIOR_DEG_FOR_CHAMFER) continue

    const C = vertexAt(cut, i)
    const S = seam.length === n ? vertexAt(seam, i) : nearestSeamVertex(seam, C)
    if (!S) continue
    const nVec = sub(C, S)
    if (Math.hypot(nVec.x, nVec.y) < MIN_CHAMFER_MM) continue
    planes.push({ S: { ...S }, n: nVec })
  }

  if (planes.length === 0) return cloneCurves(cut)

  let ring = curvesToRing(cut)
  for (const pl of planes) {
    ring = clipRingByHalfPlane(ring, pl.S, pl.n)
    if (ring.length < 3) return cloneCurves(cut)
  }

  // Nahe beieinander liegende Punkte zusammenfassen (numerische Schnittpunkte)
  const cleaned: Point[] = []
  for (const p of ring) {
    const prev = cleaned[cleaned.length - 1]
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= 1e-4) cleaned.push(p)
  }
  if (
    cleaned.length >= 2 &&
    Math.hypot(cleaned[0].x - cleaned[cleaned.length - 1].x, cleaned[0].y - cleaned[cleaned.length - 1].y) <
      1e-4
  ) {
    cleaned.pop()
  }

  const out = ringToLineCurves(cleaned)
  return out.length >= 3 ? out : cloneCurves(cut)
}
