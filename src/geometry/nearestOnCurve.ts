import type { Point, Curve, BezierCurve } from '../types/model'
import { bezierAt } from './curveToPath'

export type NearestOnCurveQuality = 'coarse' | 'fine'

export type NearestOnCurveOptions = {
  quality?: NearestOnCurveQuality
  /** Skip Bézier sampling when point is farther than this from the control-point AABB (mm). */
  maxDistMm?: number
}

const QUALITY_PARAMS: Record<NearestOnCurveQuality, { samples: number; refine: number }> = {
  coarse: { samples: 8, refine: 1 },
  fine: { samples: 24, refine: 2 },
}

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

function bezierControlAabb(c: BezierCurve): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Math.min(c.start.x, c.end.x, c.cp1.x, c.cp2.x)
  let minY = Math.min(c.start.y, c.end.y, c.cp1.y, c.cp2.y)
  let maxX = Math.max(c.start.x, c.end.x, c.cp1.x, c.cp2.x)
  let maxY = Math.max(c.start.y, c.end.y, c.cp1.y, c.cp2.y)
  return { minX, minY, maxX, maxY }
}

function pointOutsideAabbByMoreThan(
  p: Point,
  aabb: { minX: number; minY: number; maxX: number; maxY: number },
  maxDistMm: number,
): boolean {
  const dx = p.x < aabb.minX ? aabb.minX - p.x : p.x > aabb.maxX ? p.x - aabb.maxX : 0
  const dy = p.y < aabb.minY ? aabb.minY - p.y : p.y > aabb.maxY ? p.y - aabb.maxY : 0
  return dx * dx + dy * dy > maxDistMm * maxDistMm
}

/** Nächster Punkt auf einer kubischen Bézier-Kurve (Stichproben + Verfeinerung); liefert Punkt und Parameter t. */
function nearestPointOnBezier(
  p: Point,
  c: BezierCurve,
  quality: NearestOnCurveQuality = 'fine',
): { point: Point; t: number; distSq: number } {
  const { samples, refine: refinePasses } = QUALITY_PARAMS[quality]
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
  for (let refine = 0; refine < refinePasses; refine++) {
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
  c: Curve,
  options?: NearestOnCurveOptions,
): { point: Point; distSq: number; t: number } | null {
  if (c.type === 'line') {
    const r = nearestPointOnSegment(p, c.start, c.end)
    return { point: r.point, distSq: r.distSq, t: r.t }
  }
  if (options?.maxDistMm != null) {
    const aabb = bezierControlAabb(c)
    if (pointOutsideAabbByMoreThan(p, aabb, options.maxDistMm)) return null
  }
  const quality = options?.quality ?? 'fine'
  const r = nearestPointOnBezier(p, c, quality)
  return { point: r.point, distSq: r.distSq, t: r.t }
}

/**
 * Nächster Punkt auf einer der Kurven.
 * Wenn curves leer ist, wird { point: p, distance: Infinity } zurückgegeben.
 */
export function nearestPointOnCurves(
  p: Point,
  curves: Curve[],
  options?: NearestOnCurveOptions,
): { point: Point; distance: number } {
  if (curves.length === 0) return { point: { ...p }, distance: Infinity }
  let best = { point: { ...p }, distSq: Infinity }
  for (const c of curves) {
    const r = nearestOnCurve(p, c, options)
    if (r != null && r.distSq < best.distSq) best = r
  }
  return { point: best.point, distance: Math.sqrt(best.distSq) }
}

/**
 * Nächster Punkt auf einer der Kurven inkl. Kurvenindex.
 * Für Linie: point + distance; für Bézier zusätzlich t (Parameter zum Teilen der Kurve).
 */
export function nearestCurveIndexAndPoint(
  p: Point,
  curves: Curve[],
  options?: NearestOnCurveOptions,
): { curveIndex: number; point: Point; distance: number; t?: number } | null {
  if (curves.length === 0) return null
  let best: { curveIndex: number; point: Point; distSq: number; t?: number } = {
    curveIndex: 0,
    point: { ...p },
    distSq: Infinity,
  }
  for (let i = 0; i < curves.length; i++) {
    const r = nearestOnCurve(p, curves[i], options)
    if (r != null && r.distSq < best.distSq)
      best = { curveIndex: i, point: r.point, distSq: r.distSq, t: r.t }
  }
  if (!Number.isFinite(best.distSq)) return null
  return {
    curveIndex: best.curveIndex,
    point: best.point,
    distance: Math.sqrt(best.distSq),
    t: best.t,
  }
}
