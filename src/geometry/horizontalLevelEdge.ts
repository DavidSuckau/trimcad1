import type { Curve, Point } from '../types/model'
import type { EnumeratedEdge } from './edgeEnumeration'

const CONNECT_EPS_MM = 0.02
const COLLINEAR_CROSS_EPS_MM2 = 0.05

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * true, wenn die Kanten-Kette nur Liniensegmente enthält und geometrisch eine einzige Gerade bildet
 * (verbunden + kollinear).
 */
export function masterEdgeIsStraightLine(curves: Curve[], edge: EnumeratedEdge): boolean {
  const indices = edge.curveIndices
  if (indices.length === 0) return false
  for (const ci of indices) {
    const c = curves[ci]
    if (!c || c.type !== 'line') return false
  }
  for (let i = 1; i < indices.length; i++) {
    const prev = curves[indices[i - 1]]
    const cur = curves[indices[i]]
    if (dist(prev.end, cur.start) > CONNECT_EPS_MM) return false
  }
  const first = curves[indices[0]]
  const vx = first.end.x - first.start.x
  const vy = first.end.y - first.start.y
  const len0 = Math.hypot(vx, vy)
  if (len0 < 1e-9) return false
  for (let i = 1; i < indices.length; i++) {
    const c = curves[indices[i]]
    const wx = c.end.x - c.start.x
    const wy = c.end.y - c.start.y
    const len1 = Math.hypot(wx, wy)
    if (len1 < 1e-9) return false
    const cross = vx * wy - vy * wx
    if (Math.abs(cross) > COLLINEAR_CROSS_EPS_MM2 * Math.max(1, len0, len1)) return false
  }
  return true
}

/** Kleinster Drehwinkel (Grad), sodass eine Gerade mit Richtungswinkel thetaDeg waagerecht wird (mod 180°). */
export function deltaMinimalDegToHorizontal(thetaDeg: number): number {
  let delta = -thetaDeg
  while (delta <= -180) delta += 360
  while (delta > 180) delta -= 360
  if (delta > 90) delta -= 180
  if (delta < -90) delta += 180
  return delta === 0 ? 0 : delta
}
