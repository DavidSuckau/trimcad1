import type { Curve, Point } from '../types/model'
import { bezierAt } from '../geometry/curveToPath'

/** Geschlossene Kontur → Punktring (mm), für ShapeGeometry. */
export function sampleClosedContour(curves: Curve[], stepsPerBezier = 10): Point[] {
  if (curves.length < 3) return []
  const out: Point[] = []
  for (const c of curves) {
    if (c.type === 'line') {
      out.push({ ...c.start })
    } else {
      for (let i = 0; i < stepsPerBezier; i++) {
        out.push(bezierAt(c, i / stepsPerBezier))
      }
    }
  }
  if (out.length >= 2) {
    const a = out[0]!
    const b = out[out.length - 1]!
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) out.pop()
  }
  return out
}

export function contourBounds(pts: Point[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  cx: number
  cy: number
  w: number
  h: number
} | null {
  if (pts.length < 3) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  }
}
