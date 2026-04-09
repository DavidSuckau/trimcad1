import type { Point, Curve, BezierCurve } from '../types/model'
import { bezierAt } from './curveToPath'

/** Nächster Punkt auf einer Strecke (Start–Ende), beschränkt auf die Strecke; t in [0,1]. */
function nearestPointOnSegment(
  p: Point,
  start: Point,
  end: Point
): { point: Point; distSq: number; t: number } {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return { point: { ...start }, distSq: (p.x - start.x) ** 2 + (p.y - start.y) ** 2, t: 0 }
  let t = ((p.x - start.x) * dx + (p.y - start.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const q = { x: start.x + t * dx, y: start.y + t * dy }
  const distSq = (p.x - q.x) ** 2 + (p.y - q.y) ** 2
  return { point: q, distSq, t }
}

/** Nächster Punkt auf einer kubischen Bézier-Kurve (Stichproben + Verfeinerung); liefert Punkt und Parameter t. */
function nearestPointOnBezier(p: Point, c: BezierCurve): { point: Point; t: number; distSq: number } {
  const samples = 24
  let bestT = 0.5
  let bestPoint = bezierAt(c, bestT)
  let bestDistSq = (p.x - bestPoint.x) ** 2 + (p.y - bestPoint.y) ** 2
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const q = bezierAt(c, t)
    const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2
    if (d < bestDistSq) {
      bestDistSq = d
      bestT = t
      bestPoint = q
    }
  }
  for (let refine = 0; refine < 2; refine++) {
    const step = 0.5 / (samples * (refine + 1))
    for (let j = -2; j <= 2; j++) {
      const t = Math.max(0, Math.min(1, bestT + j * step))
      const q = bezierAt(c, t)
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2
      if (d < bestDistSq) {
        bestDistSq = d
        bestT = t
        bestPoint = q
      }
    }
  }
  return { point: bestPoint, t: bestT, distSq: bestDistSq }
}

/** Nächster Punkt auf einer Kurve (Linie: exakt; Bézier: auf der Kurve inkl. t). */
function nearestOnCurve(
  p: Point,
  c: Curve
): { point: Point; distSq: number; t: number } {
  if (c.type === 'line') {
    const r = nearestPointOnSegment(p, c.start, c.end)
    return { point: r.point, distSq: r.distSq, t: r.t }
  }
  const r = nearestPointOnBezier(p, c)
  return { point: r.point, distSq: r.distSq, t: r.t }
}

/**
 * Nächster Punkt auf einer der Kurven.
 * Wenn curves leer ist, wird { point: p, distance: Infinity } zurückgegeben.
 */
export function nearestPointOnCurves(
  p: Point,
  curves: Curve[]
): { point: Point; distance: number } {
  if (curves.length === 0) return { point: { ...p }, distance: Infinity }
  let best = { point: { ...p }, distSq: Infinity }
  for (const c of curves) {
    const r = nearestOnCurve(p, c)
    if (r.distSq < best.distSq) best = r
  }
  return { point: best.point, distance: Math.sqrt(best.distSq) }
}

/**
 * Nächster Punkt auf einer der Kurven inkl. Kurvenindex.
 * Für Linie: point + distance; für Bézier zusätzlich t (Parameter zum Teilen der Kurve).
 */
export function nearestCurveIndexAndPoint(
  p: Point,
  curves: Curve[]
): { curveIndex: number; point: Point; distance: number; t?: number } | null {
  if (curves.length === 0) return null
  let best: { curveIndex: number; point: Point; distSq: number; t?: number } = {
    curveIndex: 0,
    point: { ...p },
    distSq: Infinity,
  }
  for (let i = 0; i < curves.length; i++) {
    const r = nearestOnCurve(p, curves[i])
    if (r.distSq < best.distSq)
      best = { curveIndex: i, point: r.point, distSq: r.distSq, t: r.t }
  }
  return {
    curveIndex: best.curveIndex,
    point: best.point,
    distance: Math.sqrt(best.distSq),
    t: best.t,
  }
}
