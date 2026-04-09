import type { Point, Curve } from '../types/model'

/** Geschlossenes Polygon als Punktliste (erste und letzte nicht wiederholt). */
export function curvesToPolygon(curves: Curve[]): Point[] {
  if (curves.length === 0) return []
  const pts: Point[] = []
  for (const c of curves) {
    if (pts.length === 0) pts.push({ ...c.start })
    pts.push({ ...c.end })
  }
  return pts
}

/** Ray-casting: Liegt p im Polygon (pts)? */
export function isPointInPolygon(p: Point, pts: Point[]): boolean {
  if (pts.length < 3) return false
  const n = pts.length
  let inside = false
  const x = p.x
  const y = p.y
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x
    const yi = pts[i].y
    const xj = pts[j].x
    const yj = pts[j].y
    if (yi === yj) continue
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function isPointInClosedCurves(p: Point, curves: Curve[]): boolean {
  const pts = curvesToPolygon(curves)
  return isPointInPolygon(p, pts)
}
